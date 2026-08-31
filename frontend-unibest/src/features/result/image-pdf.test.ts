import { describe, expect, it } from 'vitest'
import { buildImagePdf } from './image-pdf'

describe('image PDF builder', () => {
  it('builds a valid one-page PDF around JPEG bytes', () => {
    const pdf = buildImagePdf([{ jpegBytes: new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]), width: 2, height: 2 }])
    const text = new TextDecoder().decode(pdf)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Count 1')
    expect(text).toContain('/Filter /DCTDecode')
    expect(text.endsWith('%%EOF\n')).toBe(true)
  })

  it('rejects missing pages', () => {
    expect(() => buildImagePdf([])).toThrow('At least one PDF page is required')
  })
})
