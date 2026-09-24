import { test } from 'brittle'

import {
  encodeBox,
  parseBox,
  parseBoxes,
  parseFullBox,
  readUInt,
  writeUInt,
  copyWithZeroedRanges
} from '../src/container/isobmff'

test('ISO-BMFF boxes encode and parse round trip', (t) => {
  const payload = Buffer.from('data')

  for (const opts of [{}, { extended: true }, { extendsToEnd: true }]) {
    const buffer = encodeBox('test', payload, opts)
    const box = parseBox(buffer, 0)
    const headerSize = opts.extended ? 16 : 8

    t.alike(box, {
      type: 'test',
      start: 0,
      dataStart: headerSize,
      end: buffer.byteLength,
      size: buffer.byteLength,
      headerSize,
      extendsToEnd: opts.extendsToEnd === true
    })
    t.alike(buffer.subarray(box.dataStart, box.end), payload)
  }
})

test('ISO-BMFF copyWithZeroedRanges clears only requested bytes', (t) => {
  const input = Buffer.from([1, 2, 3, 4, 5, 6, 7])
  const output = copyWithZeroedRanges(input, [
    { start: 1, end: 3 },
    { start: 5, end: 6 }
  ])

  t.alike(input, Buffer.from([1, 2, 3, 4, 5, 6, 7]))
  t.alike(output, Buffer.from([1, 0, 0, 4, 5, 0, 7]))
})

test('ISO-BMFF readUInt rejects fields larger than eight bytes', (t) => {
  t.exception(() => readUInt(Buffer.alloc(8), 0, 9), /Invalid ISO-BMFF integer/)
})

test('ISO-BMFF readUInt rejects negative offsets', (t) => {
  t.exception(() => readUInt(Buffer.alloc(8), -1, 1), /Invalid ISO-BMFF integer/)
})

test('ISO-BMFF readUInt rejects fields past the buffer end', (t) => {
  t.exception(() => readUInt(Buffer.alloc(8), 1, 8), /Invalid ISO-BMFF integer/)
})

test('ISO-BMFF readUInt rejects values beyond the safe integer range', (t) => {
  t.exception(
    () => readUInt(Buffer.from([0x20, 0, 0, 0, 0, 0, 0, 0]), 0, 8),
    /ISO-BMFF integer exceeds the safe integer range/
  )
})

test('ISO-BMFF writeUInt rejects negative values', (t) => {
  t.exception(() => writeUInt(Buffer.alloc(1), -1, 0, 1), /Invalid ISO-BMFF integer/)
})

test('ISO-BMFF writeUInt rejects non-integer values', (t) => {
  t.exception(() => writeUInt(Buffer.alloc(1), NaN, 0, 1), /Invalid ISO-BMFF integer/)
})

test('ISO-BMFF writeUInt rejects values too large for the field', (t) => {
  t.exception(() => writeUInt(Buffer.alloc(1), 256, 0, 1), /ISO-BMFF integer does not fit/)
})

test('ISO-BMFF parseBox rejects short headers', (t) => {
  t.exception(() => parseBox(Buffer.alloc(7), 0), /Invalid ISO-BMFF box header/)
})

test('ISO-BMFF parseBox rejects negative offsets', (t) => {
  t.exception(() => parseBox(Buffer.alloc(8), -1), /Invalid ISO-BMFF box header/)
})

test('ISO-BMFF parseBox rejects ends past the buffer', (t) => {
  t.exception(() => parseBox(Buffer.alloc(8), 0, 9), /Invalid ISO-BMFF box header/)
})

test('ISO-BMFF parseBox rejects short extended headers', (t) => {
  const shortExtended = Buffer.alloc(8)
  shortExtended.writeUInt32BE(1, 0)
  shortExtended.write('test', 4)
  t.exception(() => parseBox(shortExtended, 0), /Invalid ISO-BMFF test box header/)
})

test('ISO-BMFF parseBox rejects sizes smaller than the header', (t) => {
  const invalidSize = encodeBox('test', Buffer.alloc(0))
  invalidSize.writeUInt32BE(4, 0)
  t.exception(() => parseBox(invalidSize, 0), /Invalid ISO-BMFF test box size/)
})

test('ISO-BMFF parseBox rejects sizes past the buffer end', (t) => {
  const invalidSize = encodeBox('test', Buffer.alloc(0))
  invalidSize.writeUInt32BE(9, 0)
  t.exception(() => parseBox(invalidSize, 0), /Invalid ISO-BMFF test box size/)
})

test('ISO-BMFF parseBoxes rejects more than the maximum number of boxes', (t) => {
  const box = encodeBox('test', Buffer.alloc(0))
  const buffer = Buffer.concat(Array(4097).fill(box))

  t.exception(() => parseBoxes(buffer), /Too many ISO-BMFF boxes/)
})

test('ISO-BMFF parseBoxes accepts up to the maximum number of boxes', (t) => {
  const box = encodeBox('test', Buffer.alloc(0))
  const buffer = Buffer.concat(Array(4096).fill(box))

  t.is(parseBoxes(buffer).length, 4096)
})

test('ISO-BMFF parseFullBox rejects short payloads', (t) => {
  const shortFullBox = encodeBox('test', Buffer.alloc(3))
  t.exception(
    () => parseFullBox(shortFullBox, parseBox(shortFullBox, 0)),
    /Invalid ISO-BMFF test full box/
  )
})

test('ISO-BMFF encodeBox rejects non-string box types', (t) => {
  t.exception(() => encodeBox(null, Buffer.alloc(0)), /ISO-BMFF box type must be four bytes/)
})

test('ISO-BMFF encodeBox rejects box types that are not four bytes', (t) => {
  t.exception(() => encodeBox('bad', Buffer.alloc(0)), /ISO-BMFF box type must be four bytes/)
})

test('ISO-BMFF encodeBox rejects oversized standard boxes', (t) => {
  t.exception(
    () => encodeBox('test', { byteLength: 0xffffffff }),
    /ISO-BMFF test box requires an extended size/
  )
})

test('ISO-BMFF copyWithZeroedRanges rejects reversed ranges', (t) => {
  t.exception(
    () => copyWithZeroedRanges(Buffer.alloc(4), [{ start: 3, end: 2 }]),
    /Invalid ISO-BMFF zero range/
  )
})

test('ISO-BMFF copyWithZeroedRanges rejects overlapping ranges', (t) => {
  t.exception(
    () =>
      copyWithZeroedRanges(Buffer.alloc(4), [
        { start: 0, end: 2 },
        { start: 1, end: 3 }
      ]),
    /Invalid ISO-BMFF zero range/
  )
})

test('ISO-BMFF copyWithZeroedRanges rejects ranges past the buffer end', (t) => {
  t.exception(
    () => copyWithZeroedRanges(Buffer.alloc(4), [{ start: 0, end: 5 }]),
    /Invalid ISO-BMFF zero range/
  )
})
