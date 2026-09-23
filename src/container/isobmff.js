const BYTE_BASE = 0x100
const MAX_UINT_BYTES = 8
const BOX_SIZE_BYTES = 4
const BOX_TYPE_BYTES = 4
const BOX_HEADER_SIZE = BOX_SIZE_BYTES + BOX_TYPE_BYTES
const EXTENDED_SIZE_BYTES = 8
const EXTENDED_BOX_HEADER_SIZE = BOX_HEADER_SIZE + EXTENDED_SIZE_BYTES
const FULL_BOX_VERSION_BYTES = 1
const FULL_BOX_FLAGS_BYTES = 3
const FULL_BOX_HEADER_SIZE = FULL_BOX_VERSION_BYTES + FULL_BOX_FLAGS_BYTES
const SIZE_TO_END_MARKER = 0
const EXTENDED_SIZE_MARKER = 1
const MAX_UINT32 = 0xffffffff

function readUInt(buffer, offset, size) {
  if (size === 0) return 0
  if (size > MAX_UINT_BYTES || offset < 0 || offset + size > buffer.byteLength) {
    throw new Error('Invalid ISO-BMFF integer')
  }

  let value = 0
  for (let i = 0; i < size; i++) {
    value = value * BYTE_BASE + buffer[offset + i]
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
    buffer[i] = remaining % BYTE_BASE
    remaining = Math.floor(remaining / BYTE_BASE)
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
  const type = buffer.toString('latin1', offset + BOX_SIZE_BYTES, offset + BOX_HEADER_SIZE)

  let headerSize = BOX_HEADER_SIZE
  let size = size32

  if (size32 === EXTENDED_SIZE_MARKER) {
    if (offset + EXTENDED_BOX_HEADER_SIZE > end) {
      throw new Error(`Invalid ISO-BMFF ${type} box header`)
    }

    headerSize = EXTENDED_BOX_HEADER_SIZE
    size = readUInt(buffer, offset + BOX_HEADER_SIZE, EXTENDED_SIZE_BYTES)
  } else if (size32 === SIZE_TO_END_MARKER) {
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
    extendsToEnd: size32 === SIZE_TO_END_MARKER
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
  if (box.dataStart + FULL_BOX_HEADER_SIZE > box.end) {
    throw new Error(`Invalid ISO-BMFF ${box.type} full box`)
  }

  return {
    version: buffer[box.dataStart],
    flags: readUInt(buffer, box.dataStart + FULL_BOX_VERSION_BYTES, FULL_BOX_FLAGS_BYTES),
    dataStart: box.dataStart + FULL_BOX_HEADER_SIZE
  }
}

function encodeBox(type, payload, opts = {}) {
  if (typeof type !== 'string' || Buffer.byteLength(type, 'latin1') !== BOX_TYPE_BYTES) {
    throw new Error('ISO-BMFF box type must be four bytes')
  }

  const extended = opts.extended === true
  const headerSize = extended ? EXTENDED_BOX_HEADER_SIZE : BOX_HEADER_SIZE
  const size = headerSize + payload.byteLength

  if (!extended && size > MAX_UINT32) {
    throw new Error(`ISO-BMFF ${type} box requires an extended size`)
  }

  const result = Buffer.allocUnsafe(size)
  result.writeUInt32BE(
    opts.extendsToEnd ? SIZE_TO_END_MARKER : extended ? EXTENDED_SIZE_MARKER : size,
    0
  )
  result.write(type, BOX_SIZE_BYTES, BOX_TYPE_BYTES, 'latin1')

  if (extended) writeUInt(result, size, BOX_HEADER_SIZE, EXTENDED_SIZE_BYTES)
  payload.copy(result, headerSize)

  return result
}

function rewriteBox(box, payload, opts = {}) {
  return encodeBox(box.type, payload, {
    extended: box.headerSize === EXTENDED_BOX_HEADER_SIZE,
    extendsToEnd: opts.extendsToEnd ?? box.extendsToEnd
  })
}

function rewriteFullBox(box, version, flags, payload, opts) {
  const fullBox = Buffer.allocUnsafe(FULL_BOX_HEADER_SIZE + payload.byteLength)
  fullBox[0] = version
  writeUInt(fullBox, flags, FULL_BOX_VERSION_BYTES, FULL_BOX_FLAGS_BYTES)
  payload.copy(fullBox, FULL_BOX_HEADER_SIZE)
  return rewriteBox(box, fullBox, opts)
}

function rewriteAsZeroFilledBox(box, type) {
  const payloadSize = box.size - box.headerSize
  const payload = Buffer.alloc(payloadSize)

  return rewriteBox({ ...box, type }, payload)
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

function copyWithZeroedRanges(buffer, ranges) {
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
  parseBox,
  parseBoxes,
  parseFullBox,
  readUInt,
  rewriteBox,
  rewriteAsZeroFilledBox,
  rewriteBoxes,
  rewriteFullBox,
  writeUInt,
  copyWithZeroedRanges
}
