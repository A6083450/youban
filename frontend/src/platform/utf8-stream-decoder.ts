export interface Utf8StreamDecoder {
  decode: (input?: Uint8Array, options?: { stream?: boolean }) => string
}

function sequenceWidth(lead: number): number {
  if (lead >= 0xC2 && lead <= 0xDF)
    return 2
  if (lead >= 0xE0 && lead <= 0xEF)
    return 3
  if (lead >= 0xF0 && lead <= 0xF4)
    return 4
  return 0
}

function isContinuation(value: number): boolean {
  return value >= 0x80 && value <= 0xBF
}

function validSequence(bytes: Uint8Array, offset: number, width: number): boolean {
  for (let index = 1; index < width; index += 1) {
    if (!isContinuation(bytes[offset + index]))
      return false
  }
  const lead = bytes[offset]
  const second = bytes[offset + 1]
  if (width === 3 && lead === 0xE0 && second < 0xA0)
    return false
  if (width === 3 && lead === 0xED && second > 0x9F)
    return false
  if (width === 4 && lead === 0xF0 && second < 0x90)
    return false
  return width !== 4 || lead !== 0xF4 || second <= 0x8F
}

function decodeCodePoint(bytes: Uint8Array, offset: number, width: number): number {
  if (width === 2)
    return ((bytes[offset] & 0x1F) << 6) | (bytes[offset + 1] & 0x3F)
  if (width === 3) {
    return ((bytes[offset] & 0x0F) << 12)
      | ((bytes[offset + 1] & 0x3F) << 6)
      | (bytes[offset + 2] & 0x3F)
  }
  return ((bytes[offset] & 0x07) << 18)
    | ((bytes[offset + 1] & 0x3F) << 12)
    | ((bytes[offset + 2] & 0x3F) << 6)
    | (bytes[offset + 3] & 0x3F)
}

function codePointText(value: number): string {
  if (value <= 0xFFFF)
    return String.fromCharCode(value)
  const normalized = value - 0x10000
  return String.fromCharCode(0xD800 + (normalized >> 10), 0xDC00 + (normalized & 0x3FF))
}

function joinBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  if (!first.length)
    return second
  if (!second.length)
    return first
  const joined = new Uint8Array(first.length + second.length)
  joined.set(first)
  joined.set(second, first.length)
  return joined
}

class PortableUtf8StreamDecoder implements Utf8StreamDecoder {
  private pending = new Uint8Array(0)

  decode(input = new Uint8Array(0), options: { stream?: boolean } = {}): string {
    const bytes = joinBytes(this.pending, input)
    this.pending = new Uint8Array(0)
    let output = ''
    let offset = 0
    while (offset < bytes.length) {
      const lead = bytes[offset]
      if (lead <= 0x7F) {
        output += String.fromCharCode(lead)
        offset += 1
        continue
      }
      const width = sequenceWidth(lead)
      if (!width) {
        output += '\uFFFD'
        offset += 1
        continue
      }
      if (offset + width > bytes.length) {
        if (options.stream)
          this.pending = bytes.slice(offset)
        else
          output += '\uFFFD'
        break
      }
      if (!validSequence(bytes, offset, width)) {
        output += '\uFFFD'
        offset += 1
        continue
      }
      output += codePointText(decodeCodePoint(bytes, offset, width))
      offset += width
    }
    return output
  }
}

export function createUtf8StreamDecoder(): Utf8StreamDecoder {
  const Decoder = globalThis.TextDecoder
  return typeof Decoder === 'function' ? new Decoder() : new PortableUtf8StreamDecoder()
}
