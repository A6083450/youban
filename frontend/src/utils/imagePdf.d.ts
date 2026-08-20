export interface ImagePdfPage {
  jpegBytes: Uint8Array
  width: number
  height: number
}

export function buildImagePdf(pages: ImagePdfPage[]): Uint8Array
