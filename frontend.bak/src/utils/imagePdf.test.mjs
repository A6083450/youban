import assert from 'node:assert/strict'
import test from 'node:test'

import { buildImagePdf } from './imagePdf.js'

const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

test('buildImagePdf creates one page per image with a valid xref', () => {
  const bytes = buildImagePdf([
    { jpegBytes: fakeJpeg, width: 794, height: 1123 },
    { jpegBytes: fakeJpeg, width: 794, height: 1123 },
  ])
  const text = new TextDecoder('latin1').decode(bytes)

  assert.match(text, /^%PDF-1\.4/)
  assert.match(text, /\/Type \/Pages .*\/Count 2/)
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 2)
  assert.match(text, /\/Filter \/DCTDecode/)
  assert.match(text, /xref\n0 9\n/)
  assert.match(text, /startxref\n\d+\n%%EOF/)
})

test('buildImagePdf rejects empty and invalid pages', () => {
  assert.throws(() => buildImagePdf([]), /At least one PDF page/)
  assert.throws(
    () => buildImagePdf([{ jpegBytes: new Uint8Array(), width: 1, height: 1 }]),
    /has no JPEG data/,
  )
})
