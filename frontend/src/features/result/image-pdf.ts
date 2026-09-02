export interface ImagePdfPage {
  jpegBytes: Uint8Array
  width: number
  height: number
}

const encoder = new TextEncoder()
const encode = (value: string): Uint8Array => encoder.encode(value)

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function wrapObject(objectNumber: number, body: Uint8Array): Uint8Array {
  return concatBytes([encode(`${objectNumber} 0 obj\n`), body, encode('\nendobj\n')])
}

export function buildImagePdf(pages: ImagePdfPage[]): Uint8Array {
  if (!pages.length)
    throw new Error('At least one PDF page is required')

  const pageWidth = 595.28
  const pageHeight = 841.89
  const objectCount = 2 + pages.length * 3
  const objects: Uint8Array[] = []
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 3)

  objects[1] = encode('<< /Type /Catalog /Pages 2 0 R >>')
  objects[2] = encode(
    `<< /Type /Pages /Kids [${pageObjectNumbers.map(number => `${number} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  )

  pages.forEach((page, index) => {
    if (!page.jpegBytes.length)
      throw new Error(`PDF page ${index + 1} has no JPEG data`)
    if (!Number.isFinite(page.width) || page.width <= 0 || !Number.isFinite(page.height) || page.height <= 0)
      throw new Error(`PDF page ${index + 1} has invalid dimensions`)

    const pageObjectNumber = pageObjectNumbers[index]
    const imageObjectNumber = pageObjectNumber + 1
    const contentObjectNumber = pageObjectNumber + 2
    const imageName = `PageImage${index + 1}`
    const drawCommand = encode(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/${imageName} Do\nQ`)

    objects[pageObjectNumber] = encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] `
      + `/Resources << /XObject << /${imageName} ${imageObjectNumber} 0 R >> >> `
      + `/Contents ${contentObjectNumber} 0 R >>`,
    )
    objects[imageObjectNumber] = concatBytes([
      encode(
        `<< /Type /XObject /Subtype /Image /Width ${Math.round(page.width)} `
        + `/Height ${Math.round(page.height)} /ColorSpace /DeviceRGB `
        + `/BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpegBytes.length} >>\nstream\n`,
      ),
      page.jpegBytes,
      encode('\nendstream'),
    ])
    objects[contentObjectNumber] = concatBytes([
      encode(`<< /Length ${drawCommand.length} >>\nstream\n`),
      drawCommand,
      encode('\nendstream'),
    ])
  })

  const header = concatBytes([
    encode('%PDF-1.4\n%'),
    new Uint8Array([0xE2, 0xE3, 0xCF, 0xD3]),
    encode('\n'),
  ])
  const chunks = [header]
  const offsets = Array.from({ length: objectCount + 1 }, () => 0)
  let byteOffset = header.length

  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    offsets[objectNumber] = byteOffset
    const wrapped = wrapObject(objectNumber, objects[objectNumber])
    chunks.push(wrapped)
    byteOffset += wrapped.length
  }

  const xrefEntries = offsets.slice(1)
    .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  chunks.push(encode(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n${xrefEntries}trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${byteOffset}\n%%EOF\n`))
  return concatBytes(chunks)
}
