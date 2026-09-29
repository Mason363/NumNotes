import { ascii, indexOfAscii, readU32BE, readU32LE } from './sniff'

export interface ImageInfo {
  /** Stored (pre-orientation) dimensions. */
  width: number
  height: number
  /** EXIF orientation, 1-8. 5-8 swap width and height when displayed. */
  orientation: number
  /** 'no' when the format or header rules out transparency. */
  alpha: 'no' | 'maybe'
}

/**
 * Reads dimensions, EXIF orientation and alpha capability from the first bytes
 * of a JPEG, PNG, GIF, WebP or BMP file without decoding it. Returns null for
 * other formats or when the needed header isn't within `bytes`.
 */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpegInfo(bytes)
    if (ascii(bytes, 1, 3) === 'PNG') return readPngInfo(bytes)
    if (ascii(bytes, 0, 3) === 'GIF' && bytes.length >= 10) {
      return { width: readU16LE(bytes, 6), height: readU16LE(bytes, 8), orientation: 1, alpha: 'maybe' }
    }
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return readWebpInfo(bytes)
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) return readBmpInfo(bytes)
  } catch {
    // Truncated or malformed header: let the decoder deal with it.
  }
  return null
}

/** The size an image appears at once its orientation is applied. */
export function orientedSize(info: ImageInfo): { width: number; height: number } {
  return info.orientation >= 5 && info.orientation <= 8
    ? { width: info.height, height: info.width }
    : { width: info.width, height: info.height }
}

function readJpegInfo(b: Uint8Array): ImageInfo | null {
  let orientation = 1
  let offset = 2
  while (offset + 4 <= b.length) {
    if (b[offset] !== 0xff) return null
    const marker = b[offset + 1]
    if (marker === 0xff) {
      offset++ // fill byte
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2 // standalone markers
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null // EOI / start of scan before any frame header
    const length = readU16BE(b, offset + 2)
    const segment = offset + 4
    if (marker === 0xe1 && ascii(b, segment, 6) === 'Exif\0\0') {
      orientation = readExifOrientation(b, segment + 6, Math.min(b.length, segment + length - 2)) ?? orientation
    }
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrameHeader && segment + 5 <= b.length) {
      return { width: readU16BE(b, segment + 3), height: readU16BE(b, segment + 1), orientation, alpha: 'no' }
    }
    offset = segment + length - 2
  }
  return null
}

/** Reads tag 0x0112 from IFD0 of the TIFF structure at `start`. */
export function readExifOrientation(b: Uint8Array, start: number, end: number): number | null {
  if (start + 8 > end) return null
  const little = b[start] === 0x49 && b[start + 1] === 0x49
  if (!little && !(b[start] === 0x4d && b[start + 1] === 0x4d)) return null
  const u16 = (o: number) => (little ? readU16LE(b, o) : readU16BE(b, o))
  const u32 = (o: number) => (little ? readU32LE(b, o) : readU32BE(b, o))
  const ifd = start + u32(start + 4)
  if (ifd + 2 > end) return null
  const entries = u16(ifd)
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > end) return null
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8)
      return value >= 1 && value <= 8 ? value : null
    }
  }
  return null
}

function readPngInfo(b: Uint8Array): ImageInfo | null {
  if (ascii(b, 12, 4) !== 'IHDR') return null
  const width = readU32BE(b, 16)
  const height = readU32BE(b, 20)
  const colorType = b[25]
  // Color types 4 and 6 carry an alpha channel; the others only via tRNS.
  let alpha: ImageInfo['alpha'] = colorType === 4 || colorType === 6 ? 'maybe' : 'no'
  let orientation = 1
  let offset = 8
  while (offset + 8 <= b.length) {
    const length = readU32BE(b, offset)
    const type = ascii(b, offset + 4, 4)
    if (type === 'IDAT' || type === 'IEND') break
    if (type === 'tRNS') alpha = 'maybe'
    if (type === 'eXIf') {
      orientation = readExifOrientation(b, offset + 8, Math.min(b.length, offset + 8 + length)) ?? orientation
    }
    offset += 12 + length
  }
  return { width, height, orientation, alpha }
}

function readWebpInfo(b: Uint8Array): ImageInfo | null {
  const chunk = ascii(b, 12, 4)
  if (chunk === 'VP8 ' && b.length >= 30) {
    return { width: readU16LE(b, 26) & 0x3fff, height: readU16LE(b, 28) & 0x3fff, orientation: 1, alpha: 'no' }
  }
  if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = readU32LE(b, 21)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      orientation: 1,
      alpha: (bits >>> 28) & 1 ? 'maybe' : 'no',
    }
  }
  if (chunk === 'VP8X' && b.length >= 30) {
    const flags = b[20]
    let orientation = 1
    if (flags & 0x08) {
      const exif = indexOfAscii(b, 'EXIF', 30)
      if (exif !== -1) {
        let start = exif + 8
        if (ascii(b, start, 6) === 'Exif\0\0') start += 6
        orientation = readExifOrientation(b, start, Math.min(b.length, start + readU32LE(b, exif + 4))) ?? 1
      }
    }
    return {
      width: readU24LE(b, 24) + 1,
      height: readU24LE(b, 27) + 1,
      orientation,
      alpha: flags & 0x10 ? 'maybe' : 'no',
    }
  }
  return null
}

function readBmpInfo(b: Uint8Array): ImageInfo | null {
  const headerSize = readU32LE(b, 14)
  if (headerSize === 12) {
    return { width: readU16LE(b, 18), height: readU16LE(b, 20), orientation: 1, alpha: 'no' }
  }
  if (headerSize < 40 || b.length < 30) return null
  const width = readU32LE(b, 18) | 0
  const height = readU32LE(b, 22) | 0
  const bitsPerPixel = readU16LE(b, 28)
  return { width: Math.abs(width), height: Math.abs(height), orientation: 1, alpha: bitsPerPixel === 32 ? 'maybe' : 'no' }
}

/**
 * Reads the NETSCAPE2.0 / ANIMEXTS1.0 loop count of a GIF: undefined when the
 * block is absent (the animation plays once), 0 for "forever", else the number
 * of extra repetitions.
 */
export function readGifLoopCount(bytes: Uint8Array): number | undefined {
  for (const id of ['NETSCAPE2.0', 'ANIMEXTS1.0']) {
    let from = 0
    for (;;) {
      const at = indexOfAscii(bytes, id, from)
      if (at === -1) break
      // 0x21 0xFF 0x0B <id> then sub-block 0x03 0x01 <u16 loop count>
      if (at >= 3 && bytes[at - 3] === 0x21 && bytes[at - 2] === 0xff && bytes[at - 1] === 0x0b) {
        const sub = at + id.length
        if (bytes[sub] === 0x03 && bytes[sub + 1] === 0x01 && sub + 3 < bytes.length) {
          return readU16LE(bytes, sub + 2)
        }
      }
      from = at + 1
    }
  }
  return undefined
}

/**
 * Converts a GIF loop count into this module's `loops` convention (total
 * plays, 0 = forever). Browsers play a GIF with loop count N a total of N + 1
 * times, and once when the block is missing.
 */
export function gifLoopsToPlays(loopCount: number | undefined): number {
  if (loopCount === undefined) return 1
  return loopCount === 0 ? 0 : loopCount + 1
}

/** Browsers stretch frame delays under 20 ms (including 0) to 100 ms. */
export function normalizeDelay(delayMs: number): number {
  return Number.isFinite(delayMs) && delayMs >= 20 ? Math.round(delayMs) : 100
}

export interface FittedSize {
  width: number
  height: number
  /** True when the result is smaller than the input. */
  scaled: boolean
}

/** Scales (width, height) down, preserving aspect ratio, so neither side exceeds `max`. */
export function fitWithin(width: number, height: number, max: number): FittedSize {
  const longest = Math.max(width, height)
  if (longest <= max || longest <= 0) return { width, height, scaled: false }
  const scale = max / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  }
}

/**
 * Frame size for an animation: fits `maxDimension`, and shrinks further when
 * the decoded frames would exceed `pixelBudget` pixels in total, since every
 * frame is held in memory as a bitmap.
 */
export function animationFrameSize(
  width: number,
  height: number,
  frameCount: number,
  maxDimension: number,
  pixelBudget: number,
): FittedSize {
  const fitted = fitWithin(width, height, maxDimension)
  const total = fitted.width * fitted.height * Math.max(1, frameCount)
  if (total <= pixelBudget) return fitted
  const scale = Math.sqrt(pixelBudget / total)
  const longest = Math.max(fitted.width, fitted.height)
  const reduced = fitWithin(fitted.width, fitted.height, Math.max(16, Math.floor(longest * scale)))
  return { ...reduced, scaled: reduced.scaled || fitted.scaled }
}

function readU16LE(b: Uint8Array, offset: number): number {
  return b[offset] | (b[offset + 1] << 8)
}

function readU16BE(b: Uint8Array, offset: number): number {
  return (b[offset] << 8) | b[offset + 1]
}

function readU24LE(b: Uint8Array, offset: number): number {
  return b[offset] | (b[offset + 1] << 8) | (b[offset + 2] << 16)
}
