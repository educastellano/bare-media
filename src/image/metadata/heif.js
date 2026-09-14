import {
  encodeBox,
  encodeBoxLike,
  encodeFullBoxLike,
  encodeZeroFilledFreeBox,
  parseBoxes,
  parseFullBox,
  readUInt,
  rewriteBoxes,
  writeUInt,
  zeroRanges
} from '../../container/isobmff'

const METADATA_ITEM_TYPES = new Set(['Exif', 'mime', 'uri '])
const MIME_IMAGE_CONTENT_TYPE = 'image/jpeg'
const METADATA_BOX_VALIDATORS = new Map([['sefd', validateSamsungBox]])

function readString(buffer, offset, end) {
  const nullIndex = buffer.indexOf(0, offset)
  if (nullIndex === -1 || nullIndex >= end) {
    throw new Error('Invalid HEIF item information string')
  }

  return {
    value: buffer.toString('utf8', offset, nullIndex),
    end: nullIndex + 1
  }
}

function itemInfoEntry(buffer, box) {
  if (box.type !== 'infe') return null

  const fullBox = parseFullBox(buffer, box)
  if (fullBox.version !== 2 && fullBox.version !== 3) return null

  const idSize = fullBox.version === 2 ? 2 : 4
  const typeOffset = fullBox.dataStart + idSize + 2

  if (typeOffset + 4 > box.end) {
    throw new Error('Invalid HEIF item information entry')
  }

  const type = buffer.toString('latin1', typeOffset, typeOffset + 4)
  const name = readString(buffer, typeOffset + 4, box.end)

  let contentType = null
  if (type === 'mime') {
    contentType = readString(buffer, name.end, box.end).value
  }

  return {
    id: readUInt(buffer, fullBox.dataStart, idSize),
    type,
    contentType
  }
}

function isMetadataItem(item) {
  return (
    METADATA_ITEM_TYPES.has(item.type) &&
    !(item.type === 'mime' && item.contentType === MIME_IMAGE_CONTENT_TYPE)
  )
}

function parseItemInfo(buffer, box) {
  const fullBox = parseFullBox(buffer, box)
  const countSize = fullBox.version === 0 ? 2 : 4
  const entriesStart = fullBox.dataStart + countSize

  if (entriesStart > box.end) {
    throw new Error('Invalid HEIF item information box')
  }

  return {
    ...fullBox,
    countSize,
    entries: parseBoxes(buffer, entriesStart, box.end)
  }
}

function rewriteItemInfo(buffer, box, info, removedItemIds) {
  const entries = info.entries.filter((entry) => {
    const item = itemInfoEntry(buffer, entry)
    return !item || !removedItemIds.has(item.id)
  })

  const count = readUInt(buffer, info.dataStart, info.countSize)
  const payload = Buffer.allocUnsafe(info.countSize)
  writeUInt(payload, count - (info.entries.length - entries.length), 0, info.countSize)

  return encodeFullBoxLike(
    box,
    info.version,
    info.flags,
    Buffer.concat([payload, ...entries.map((entry) => buffer.subarray(entry.start, entry.end))]),
    { extendsToEnd: false }
  )
}

function parseItemLocation(buffer, box) {
  const fullBox = parseFullBox(buffer, box)
  if (fullBox.version > 2) throw new Error('Unsupported HEIF item location version')

  let offset = fullBox.dataStart
  if (offset + 2 > box.end) throw new Error('Invalid HEIF item location box')

  const sizes = buffer[offset++]
  const sizes2 = buffer[offset++]
  const offsetSize = sizes >> 4
  const lengthSize = sizes & 0x0f
  const baseOffsetSize = sizes2 >> 4
  const indexSize = fullBox.version > 0 ? sizes2 & 0x0f : 0
  const itemIdSize = fullBox.version < 2 ? 2 : 4
  const itemCountSize = fullBox.version < 2 ? 2 : 4
  const itemCount = readUInt(buffer, offset, itemCountSize)
  offset += itemCountSize

  const items = []

  for (let i = 0; i < itemCount; i++) {
    const start = offset
    const id = readUInt(buffer, offset, itemIdSize)
    offset += itemIdSize

    let constructionField = 0
    if (fullBox.version > 0) {
      constructionField = readUInt(buffer, offset, 2)
      offset += 2
    }

    const dataReferenceIndex = readUInt(buffer, offset, 2)
    offset += 2
    const baseOffset = readUInt(buffer, offset, baseOffsetSize)
    offset += baseOffsetSize
    const extentCount = readUInt(buffer, offset, 2)
    offset += 2

    const extents = []
    for (let j = 0; j < extentCount; j++) {
      if (fullBox.version > 0 && indexSize > 0) {
        readUInt(buffer, offset, indexSize)
        offset += indexSize
      }

      const extentOffset = readUInt(buffer, offset, offsetSize)
      offset += offsetSize
      const length = readUInt(buffer, offset, lengthSize)
      offset += lengthSize
      extents.push({ offset: extentOffset, length })
    }

    if (offset > box.end) throw new Error('Invalid HEIF item location box')

    items.push({
      id,
      start,
      end: offset,
      constructionMethod: constructionField & 0x0f,
      dataReferenceIndex,
      baseOffset,
      extents
    })
  }

  if (offset !== box.end) throw new Error('Invalid HEIF item location box')

  return {
    ...fullBox,
    itemCountSize,
    items
  }
}

function rewriteItemLocation(buffer, box, location, items) {
  const header = Buffer.from(
    buffer.subarray(location.dataStart, location.dataStart + 2 + location.itemCountSize)
  )
  writeUInt(header, items.length, 2, location.itemCountSize)

  const payload = Buffer.concat([
    header,
    ...items.map((item) => buffer.subarray(item.start, item.end))
  ])
  return encodeFullBoxLike(box, location.version, location.flags, payload, {
    extendsToEnd: false
  })
}

function parsePrimaryItem(buffer, box) {
  const fullBox = parseFullBox(buffer, box)
  const idSize = fullBox.version === 0 ? 2 : 4
  return readUInt(buffer, fullBox.dataStart, idSize)
}

function rewriteItemReferences(buffer, box, removedItemIds) {
  const fullBox = parseFullBox(buffer, box)
  if (fullBox.version > 1) throw new Error('Unsupported HEIF item reference version')

  const idSize = fullBox.version === 0 ? 2 : 4
  const references = parseBoxes(buffer, fullBox.dataStart, box.end)
  const rewritten = []

  for (const reference of references) {
    let offset = reference.dataStart
    const fromItemId = readUInt(buffer, offset, idSize)
    offset += idSize
    const referenceCount = readUInt(buffer, offset, 2)
    offset += 2

    const toItemIds = []
    for (let i = 0; i < referenceCount; i++) {
      toItemIds.push(readUInt(buffer, offset, idSize))
      offset += idSize
    }

    if (offset !== reference.end) throw new Error('Invalid HEIF item reference')
    if (removedItemIds.has(fromItemId)) continue

    const retainedItemIds = toItemIds.filter((id) => !removedItemIds.has(id))
    if (retainedItemIds.length === 0) continue

    const payload = Buffer.allocUnsafe(idSize + 2 + retainedItemIds.length * idSize)
    offset = 0
    writeUInt(payload, fromItemId, offset, idSize)
    offset += idSize
    writeUInt(payload, retainedItemIds.length, offset, 2)
    offset += 2
    for (const id of retainedItemIds) {
      writeUInt(payload, id, offset, idSize)
      offset += idSize
    }

    rewritten.push(encodeBoxLike(reference, payload))
  }

  return encodeFullBoxLike(box, fullBox.version, fullBox.flags, Buffer.concat(rewritten), {
    extendsToEnd: false
  })
}

function rewritePropertyAssociations(buffer, box, removedItemIds) {
  const fullBox = parseFullBox(buffer, box)
  if (fullBox.version > 1) throw new Error('Unsupported HEIF property association version')

  const itemIdSize = fullBox.version === 0 ? 2 : 4
  const associationSize = fullBox.flags & 1 ? 2 : 1
  let offset = fullBox.dataStart
  const entryCount = readUInt(buffer, offset, 4)
  offset += 4
  const entries = []

  for (let i = 0; i < entryCount; i++) {
    const start = offset
    const itemId = readUInt(buffer, offset, itemIdSize)
    offset += itemIdSize
    const associationCount = readUInt(buffer, offset, 1)
    offset += 1 + associationCount * associationSize
    if (offset > box.end) throw new Error('Invalid HEIF property association box')
    if (!removedItemIds.has(itemId)) entries.push(buffer.subarray(start, offset))
  }

  if (offset !== box.end) throw new Error('Invalid HEIF property association box')

  const count = Buffer.allocUnsafe(4)
  writeUInt(count, entries.length, 0, 4)
  return encodeFullBoxLike(box, fullBox.version, fullBox.flags, Buffer.concat([count, ...entries]))
}

function rewriteItemProperties(buffer, box, removedItemIds) {
  const children = parseBoxes(buffer, box.dataStart, box.end)
  const payload = rewriteBoxes(buffer, children, (child) => {
    if (child.type === 'ipma') {
      return rewritePropertyAssociations(buffer, child, removedItemIds)
    }
  })
  return encodeBoxLike(box, payload, { extendsToEnd: false })
}

function mergeRanges(ranges) {
  const sorted = ranges.filter((range) => range.end > range.start).sort((a, b) => a.start - b.start)
  const merged = []

  for (const range of sorted) {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }

  return merged
}

function overlaps(left, right) {
  return left.start < right.end && right.start < left.end
}

function localItemRanges(
  items,
  removedItemIds,
  constructionMethod,
  sourceLength,
  extraRanges = []
) {
  const removed = [...extraRanges]
  const retained = []

  for (const item of items) {
    if (item.constructionMethod > 2) {
      throw new Error(`Unsupported HEIF item construction method ${item.constructionMethod}`)
    }

    if (item.constructionMethod !== constructionMethod || item.dataReferenceIndex !== 0) continue

    for (const extent of item.extents) {
      // A zero (or omitted) length denotes the entire source, not an empty extent.
      if (extent.length === 0 && (sourceLength === null || item.extents.length !== 1)) {
        throw new Error('Invalid HEIF implicit extent length')
      }

      const range = {
        start: item.baseOffset + extent.offset,
        end: item.baseOffset + extent.offset + (extent.length || sourceLength)
      }
      ;(removedItemIds.has(item.id) ? removed : retained).push(range)
    }
  }

  const removedRanges = mergeRanges(removed)
  for (const removedRange of removedRanges) {
    if (retained.some((retainedRange) => overlaps(removedRange, retainedRange))) {
      throw new Error('HEIF metadata shares storage with a retained item')
    }
  }

  return removedRanges
}

function assertRangesAreInBoxes(ranges, boxes) {
  for (const range of ranges) {
    if (!boxes.some((box) => range.start >= box.dataStart && range.end <= box.end)) {
      throw new Error('HEIF metadata is stored outside a media data box')
    }
  }
}

function validateSamsungBox(buffer, box) {
  const invalid = () => {
    throw new Error('Unsupported Samsung sefd metadata structure')
  }

  if (box.end - box.dataStart < 20) invalid()
  if (buffer.toString('latin1', box.end - 4, box.end) !== 'SEFT') invalid()

  const directorySize = buffer.readUInt32LE(box.end - 8)
  const directoryStart = box.end - 8 - directorySize
  if (directorySize < 12 || directoryStart < box.dataStart) invalid()
  if (buffer.toString('latin1', directoryStart, directoryStart + 4) !== 'SEFH') invalid()

  const count = buffer.readUInt32LE(directoryStart + 8)
  if (12 + count * 12 !== directorySize) invalid()

  for (let i = 0; i < count; i++) {
    const entry = directoryStart + 12 + i * 12
    const offset = buffer.readUInt32LE(entry + 4)
    const size = buffer.readUInt32LE(entry + 8)
    const start = directoryStart - offset

    if (start < box.dataStart || size < 8 || size > offset) invalid()
    if (buffer.readUInt32LE(start) !== buffer.readUInt32LE(entry)) invalid()
    if (buffer.readUInt32LE(start + 4) > size - 8) invalid()
  }
}

function stripHEIFMetadata(buffer) {
  const topLevel = parseBoxes(buffer)
  const metadataBoxes = topLevel.filter((box) => {
    const validate = METADATA_BOX_VALIDATORS.get(box.type)
    if (!validate) return false
    validate(buffer, box)
    return true
  })
  const metaBoxes = topLevel.filter((box) => box.type === 'meta')
  if (metaBoxes.length !== 1) throw new Error('Invalid HEIF metadata container')

  const meta = metaBoxes[0]
  const metaFullBox = parseFullBox(buffer, meta)
  const children = parseBoxes(buffer, metaFullBox.dataStart, meta.end)
  const itemInfoBox = children.find((box) => box.type === 'iinf')
  if (!itemInfoBox) throw new Error('Invalid HEIF item information')

  const itemInfo = parseItemInfo(buffer, itemInfoBox)
  const removedItemIds = new Set()

  for (const entry of itemInfo.entries) {
    const item = itemInfoEntry(buffer, entry)
    if (item && isMetadataItem(item)) {
      removedItemIds.add(item.id)
    }
  }

  if (removedItemIds.size === 0 && metadataBoxes.length === 0) {
    return Buffer.from(buffer)
  }

  const primaryItemBox = children.find((box) => box.type === 'pitm')
  if (primaryItemBox && removedItemIds.has(parsePrimaryItem(buffer, primaryItemBox))) {
    throw new Error('Cannot remove the primary HEIF item')
  }

  const itemLocationBox = children.find((box) => box.type === 'iloc')
  const itemLocation = itemLocationBox ? parseItemLocation(buffer, itemLocationBox) : null
  const itemLocations = itemLocation ? itemLocation.items : []
  const retainedItemLocations = itemLocations.filter((item) => !removedItemIds.has(item.id))

  const mediaDataBoxes = topLevel.filter((box) => box.type === 'mdat')
  const mediaDataRanges = localItemRanges(itemLocations, removedItemIds, 0, buffer.byteLength)
  assertRangesAreInBoxes(mediaDataRanges, mediaDataBoxes)

  const itemDataBoxes = children.filter((box) => box.type === 'idat')
  const itemDataLength =
    itemDataBoxes.length === 1 ? itemDataBoxes[0].end - itemDataBoxes[0].dataStart : null
  const itemDataRanges = localItemRanges(itemLocations, removedItemIds, 1, itemDataLength)
  if (itemDataRanges.length > 0 && itemDataBoxes.length !== 1) {
    throw new Error('Invalid HEIF item data storage')
  }

  if (itemDataRanges.some((range) => range.start < 0 || range.end > itemDataLength)) {
    throw new Error('Invalid HEIF item data location')
  }

  const metadataRanges = metadataBoxes.map((box) => ({ start: box.start, end: box.end }))
  const output = zeroRanges(
    buffer,
    localItemRanges(itemLocations, removedItemIds, 0, buffer.byteLength, metadataRanges)
  )
  for (const box of metadataBoxes) {
    encodeZeroFilledFreeBox(box).copy(output, box.start)
  }

  if (removedItemIds.size === 0) return output

  const rewrittenChildren = rewriteBoxes(buffer, children, (box) => {
    switch (box.type) {
      case 'iinf':
        return rewriteItemInfo(buffer, box, itemInfo, removedItemIds)
      case 'iloc':
        return rewriteItemLocation(buffer, box, itemLocation, retainedItemLocations)
      case 'iref':
        return rewriteItemReferences(buffer, box, removedItemIds)
      case 'iprp':
        return rewriteItemProperties(buffer, box, removedItemIds)
      case 'idat': {
        const payload = buffer.subarray(box.dataStart, box.end)
        return encodeBoxLike(box, zeroRanges(payload, itemDataRanges), { extendsToEnd: false })
      }
      default:
        return box.extendsToEnd
          ? encodeBoxLike(box, buffer.subarray(box.dataStart, box.end), { extendsToEnd: false })
          : undefined
    }
  })

  const padding = meta.size - meta.headerSize - 4 - rewrittenChildren.byteLength
  if (padding < 8) throw new Error('Cannot preserve the HEIF metadata box size')

  const free = encodeBox('free', Buffer.alloc(padding - 8))
  const paddedMeta = encodeFullBoxLike(
    meta,
    metaFullBox.version,
    metaFullBox.flags,
    Buffer.concat([rewrittenChildren, free])
  )

  paddedMeta.copy(output, meta.start)
  return output
}

export { stripHEIFMetadata }
