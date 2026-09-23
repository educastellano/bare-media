import { test } from 'brittle'

import {
  encodeBox,
  parseBox,
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

test('ISO-BMFF rejects invalid integers', (t) => {
  t.exception(() => readUInt(Buffer.alloc(8), 0, 9), /Invalid ISO-BMFF integer/)
  t.exception(() => readUInt(Buffer.alloc(8), -1, 1), /Invalid ISO-BMFF integer/)
  t.exception(() => readUInt(Buffer.alloc(8), 1, 8), /Invalid ISO-BMFF integer/)
  t.exception(
    () => readUInt(Buffer.from([0x20, 0, 0, 0, 0, 0, 0, 0]), 0, 8),
    /ISO-BMFF integer exceeds the safe integer range/
  )
  t.exception(() => writeUInt(Buffer.alloc(1), -1, 0, 1), /Invalid ISO-BMFF integer/)
  t.exception(() => writeUInt(Buffer.alloc(1), NaN, 0, 1), /Invalid ISO-BMFF integer/)
  t.exception(() => writeUInt(Buffer.alloc(1), 256, 0, 1), /ISO-BMFF integer does not fit/)
})

test('ISO-BMFF rejects invalid boxes', (t) => {
  t.exception(() => parseBox(Buffer.alloc(7), 0), /Invalid ISO-BMFF box header/)
  t.exception(() => parseBox(Buffer.alloc(8), -1), /Invalid ISO-BMFF box header/)
  t.exception(() => parseBox(Buffer.alloc(8), 0, 9), /Invalid ISO-BMFF box header/)

  const shortExtended = Buffer.alloc(8)
  shortExtended.writeUInt32BE(1, 0)
  shortExtended.write('test', 4)
  t.exception(() => parseBox(shortExtended, 0), /Invalid ISO-BMFF test box header/)

  const invalidSize = Buffer.from(shortExtended)
  invalidSize.writeUInt32BE(4, 0)
  t.exception(() => parseBox(invalidSize, 0), /Invalid ISO-BMFF test box size/)
  invalidSize.writeUInt32BE(9, 0)
  t.exception(() => parseBox(invalidSize, 0), /Invalid ISO-BMFF test box size/)

  const shortFullBox = encodeBox('test', Buffer.alloc(3))
  t.exception(
    () => parseFullBox(shortFullBox, parseBox(shortFullBox, 0)),
    /Invalid ISO-BMFF test full box/
  )

  t.exception(() => encodeBox(null, Buffer.alloc(0)), /ISO-BMFF box type must be four bytes/)
  t.exception(() => encodeBox('bad', Buffer.alloc(0)), /ISO-BMFF box type must be four bytes/)
  t.exception(
    () => encodeBox('test', { byteLength: 0xffffffff }),
    /ISO-BMFF test box requires an extended size/
  )
})

test('ISO-BMFF rejects invalid zero ranges', (t) => {
  t.exception(
    () => copyWithZeroedRanges(Buffer.alloc(4), [{ start: 3, end: 2 }]),
    /Invalid ISO-BMFF zero range/
  )
  t.exception(
    () =>
      copyWithZeroedRanges(Buffer.alloc(4), [
        { start: 0, end: 2 },
        { start: 1, end: 3 }
      ]),
    /Invalid ISO-BMFF zero range/
  )
  t.exception(
    () => copyWithZeroedRanges(Buffer.alloc(4), [{ start: 0, end: 5 }]),
    /Invalid ISO-BMFF zero range/
  )
})
