import { test } from 'brittle'

import { cleanMetadata } from '../lib/bin'

test('cleanMetadata() summarizes binary buffers', (t) => {
  t.is(cleanMetadata(Buffer.alloc(0)), '<binary data: 0 bytes>')
  t.is(cleanMetadata(Buffer.from([0x00])), '<binary data: 1 byte>')
  t.is(cleanMetadata(Buffer.from([0xff, 0x00])), '<binary data: 2 bytes>')
})

test('cleanMetadata() keeps readable buffers', (t) => {
  t.is(cleanMetadata(Buffer.from('0210')), '0210')
  t.is(cleanMetadata(Buffer.from('CameraBrand')), 'CameraBrand')
})

test('cleanMetadata() recursively cleans metadata', (t) => {
  const input = {
    version: Buffer.from('0210'),
    items: [{ data: Buffer.from([0xff]) }]
  }

  const clean = cleanMetadata(input)

  t.alike(clean, {
    version: '0210',
    items: [{ data: '<binary data: 1 byte>' }]
  })
})
