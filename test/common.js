import { test } from 'brittle'
import fs from 'bare-fs'
import path from 'bare-path'
import tmp from 'test-tmp'

import { detectMimeType } from '..'
import { isImageSupported, isVideoSupported, isMediaSupported } from '../types'

test('detectMimeType()', (t) => {
  t.is(detectMimeType(Buffer.from([0xff, 0xd8, 0xff])), 'image/jpeg')
  t.is(detectMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png')
  t.is(detectMimeType(Buffer.from([0x47, 0x49, 0x46, 0x38])), 'image/gif')
  t.is(detectMimeType(Buffer.from('<svg></svg>')), 'image/svg+xml')
  t.is(detectMimeType(Buffer.from('not an image')), null)
})

test('detectMimeType.fromPath()', async (t) => {
  t.is(await detectMimeType.fromPath('./test/fixtures/sample.png'), 'image/png')
  t.is(await detectMimeType.fromPath('./test/fixtures/sample.mp4'), 'video/mp4')

  // An ISO BMFF file without media tracks is not enough to infer a mimetype
  const filepath = path.join(await tmp(t), 'ambiguous.mp4')
  fs.writeFileSync(filepath, Buffer.from('000000186674797069736f6d0000000069736f6d6d703431', 'hex'))

  t.is(await detectMimeType.fromPath(filepath), null)
})

test('codecs support flags', (t) => {
  t.ok(isImageSupported('image/jpeg'))
  t.ok(isImageSupported('image/png'))
  t.absent(isImageSupported('video/mp4'))

  t.ok(isVideoSupported('video/mp4'))
  t.absent(isVideoSupported('image/jpeg'))

  t.ok(isMediaSupported('image/jpeg'))
  t.ok(isMediaSupported('video/mp4'))
  t.absent(isMediaSupported('application/pdf'))
})
