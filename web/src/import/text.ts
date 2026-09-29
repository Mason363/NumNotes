/**
 * Decodes a text file of unknown encoding. Honors UTF-8 and UTF-16 byte order
 * marks, recognizes BOM-less UTF-16 by its zero bytes, accepts valid UTF-8,
 * and otherwise falls back to Windows-1252 (the de facto encoding of legacy
 * Western text files, and a superset of Latin-1). Newlines are normalized to
 * "\n" and any byte order mark is removed.
 */
export function decodeText(bytes: Uint8Array): string {
  return normalizeNewlines(stripBom(decodeBytes(bytes)))
}

function decodeBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))

  const utf16 = guessUtf16(bytes)
  if (utf16) return new TextDecoder(utf16).decode(bytes)

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/**
 * Detects BOM-less UTF-16 from the pattern of zero bytes that mostly-ASCII
 * text leaves in every other position.
 */
export function guessUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const length = Math.min(bytes.length, 1024) & ~1
  if (length < 4) return null
  let evenZeros = 0
  let oddZeros = 0
  for (let i = 0; i < length; i += 2) {
    if (bytes[i] === 0) evenZeros++
    if (bytes[i + 1] === 0) oddZeros++
  }
  const pairs = length / 2
  if (oddZeros > pairs * 0.4 && evenZeros < pairs * 0.05) return 'utf-16le'
  if (evenZeros > pairs * 0.4 && oddZeros < pairs * 0.05) return 'utf-16be'
  return null
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}
