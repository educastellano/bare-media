const BOX_HEADER_SIZE = 8
const EXTENDED_BOX_HEADER_SIZE = 16
const MAX_UINT32 = 0xffffffff

function readUInt(buffer, offset, size) {
  if (size === 0) return 0
  if (size > 8 || offset < 0 || offset + size > buffer.byteLength) {
    throw new Error('Invalid ISO-BMFF integer')
  }

  let value = 0
  for (let i = 0; i < size; i++) {
    value = value * 0x100 + buffer[offset + i]
    if (!Number.isSafeInteger(value)) {
      throw new Error('ISO-BMFF integer exceeds the safe integer range')
    }
  }

  return value
}

function writeUInt(buffer, value, offset, size) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid ISO-BMFF integer')
  }

  let remaining = value
  for (let i = offset + size - 1; i >= offset; i--) {
    buffer[i] = remaining % 0x100
    remaining = Math.floor(remaining / 0x100)
  }

  if (remaining !== 0) {
    throw new Error('ISO-BMFF integer does not fit in its field')
  }
}

function parseBox(buffer, offset, end = buffer.byteLength) {
  if (offset < 0 || end > buffer.byteLength || offset + BOX_HEADER_SIZE > end) {
    throw new Error('Invalid ISO-BMFF box header')
  }

  const size32 = buffer.readUInt32BE(offset)
  const type = buffer.toString('latin1', offset + 4, offset + 8)

  let headerSize = BOX_HEADER_SIZE
  let size = size32

  if (size32 === 1) {
    if (offset + EXTENDED_BOX_HEADER_SIZE > end) {
      throw new Error(`Invalid ISO-BMFF ${type} box header`)
    }

    headerSize = EXTENDED_BOX_HEADER_SIZE
    size = readUInt(buffer, offset + 8, 8)
  } else if (size32 === 0) {
    size = end - offset
  }

  if (size < headerSize || offset + size > end) {
    throw new Error(`Invalid ISO-BMFF ${type} box size`)
  }

  return {
    type,
    start: offset,
    dataStart: offset + headerSize,
    end: offset + size,
    size,
    headerSize,
    extendsToEnd: size32 === 0
  }
}

function parseBoxes(buffer, start = 0, end = buffer.byteLength) {
  const boxes = []

  for (let offset = start; offset < end;) {
    const box = parseBox(buffer, offset, end)
    boxes.push(box)
    offset = box.end
  }

  return boxes
}

function parseFullBox(buffer, box) {
  if (box.dataStart + 4 > box.end) {
    throw new Error(`Invalid ISO-BMFF ${box.type} full box`)
  }

  return {
    version: buffer[box.dataStart],
    flags: readUInt(buffer, box.dataStart + 1, 3),
    dataStart: box.dataStart + 4
  }
}

function encodeBox(type, payload, opts = {}) {
  if (typeof type !== 'string' || Buffer.byteLength(type, 'latin1') !== 4) {
    throw new Error('ISO-BMFF box type must be four bytes')
  }

  const extended = opts.extended === true
  const headerSize = extended ? EXTENDED_BOX_HEADER_SIZE : BOX_HEADER_SIZE
  const size = headerSize + payload.byteLength

  if (!extended && size > MAX_UINT32) {
    throw new Error(`ISO-BMFF ${type} box requires an extended size`)
  }

  const result = Buffer.allocUnsafe(size)
  result.writeUInt32BE(opts.extendsToEnd ? 0 : extended ? 1 : size, 0)
  result.write(type, 4, 4, 'latin1')

  if (extended) writeUInt(result, size, 8, 8)
  payload.copy(result, headerSize)

  return result
}

function encodeBoxLike(box, payload, opts = {}) {
  return encodeBox(box.type, payload, {
    extended: box.headerSize === EXTENDED_BOX_HEADER_SIZE,
    extendsToEnd: opts.extendsToEnd ?? box.extendsToEnd
  })
}

function encodeFullBoxLike(box, version, flags, payload, opts) {
  const fullBox = Buffer.allocUnsafe(4 + payload.byteLength)
  fullBox[0] = version
  writeUInt(fullBox, flags, 1, 3)
  payload.copy(fullBox, 4)
  return encodeBoxLike(box, fullBox, opts)
}

function rewriteBoxes(buffer, boxes, transform) {
  const output = []

  for (const box of boxes) {
    const replacement = transform(box)
    if (replacement === null) continue
    output.push(replacement === undefined ? buffer.subarray(box.start, box.end) : replacement)
  }

  return Buffer.concat(output)
}

function zeroRanges(buffer, ranges) {
  const output = Buffer.from(buffer)
  if (ranges.length === 0) return output

  let offset = 0

  for (const range of ranges) {
    if (range.start < offset || range.end < range.start || range.end > buffer.byteLength) {
      throw new Error('Invalid ISO-BMFF zero range')
    }

    output.fill(0, range.start, range.end)
    offset = range.end
  }

  return output
}

export {
  encodeBox,
  encodeBoxLike,
  encodeFullBoxLike,
  parseBox,
  parseBoxes,
  parseFullBox,
  readUInt,
  rewriteBoxes,
  writeUInt,
  zeroRanges
}
