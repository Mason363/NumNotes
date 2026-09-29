import { guessUtf16 } from './text'

export type FileKind =
  | 'jpeg'
  | 'png'
  | 'apng'
  | 'gif'
  | 'webp'
  | 'webp-animated'
  | 'avif'
  | 'avif-sequence'
  | 'bmp'
  | 'ico'
  | 'tiff'
  | 'jxl'
  /** Some other image format; left to the browser to decode. */
  | 'image'
  | 'svg'
  | 'heic'
  | 'pdf'
  | 'video'
  | 'docx'
  | 'markdown'
  | 'html'
  | 'rtf'
  | 'csv'
  | 'tsv'
  | 'json'
  | 'text'
  | 'unsupported'

export interface Detection {
  kind: FileKind
  /** Canonical MIME type of the detected format. */
  mime: string
  /** User-facing explanation when `kind` is 'unsupported'. */
  reason?: string
}

export interface SniffInput {
  /** The first bytes of the file; 64 KiB or more gives the best results. */
  head: Uint8Array
  /** The last bytes of the file, used to look inside ZIP containers. */
  tail?: Uint8Array
  name?: string
  type?: string
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'mdtxt', 'mdtext'])
const HTML_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'shtml'])
const JSON_EXTENSIONS = new Set(['json', 'geojson', 'jsonl', 'ndjson', 'webmanifest'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'qt', 'webm', 'mkv', 'ogv'])
const BINARY_MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, 'heic', 'heif', 'avif', 'jpg', 'jpeg', 'png', 'gif', 'webp'])
const RAW_PHOTO_EXTENSIONS = new Set([
  'dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'pef', 'srw', 'x3f', 'raw',
])
/** Directory "packages" that macOS presents as single documents. */
export const PACKAGE_EXTENSIONS = new Set(['pages', 'numbers', 'key', 'app', 'bundle', 'photoslibrary', 'rtfd'])

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'mif2', 'msf1'])
const MP4_VIDEO_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9', 'mp41', 'mp42', 'mp71', 'avc1',
  'M4V ', 'M4VH', 'M4VP', 'dash', 'mmp4', 'f4v ', 'MSNV', 'XAVC', '3gp4', '3gp5', '3gp6', '3gp7', '3g2a', '3g2b', '3g2c',
])
const MP4_AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ', 'F4A ', 'F4B '])
const QUICKTIME_ATOMS = new Set(['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'])

const AUDIO_REASON = "Audio files can't be imported."
const ARCHIVE_REASON = "Archives can't be imported. Unzip it first, then drop the files inside."
const VIDEO_FORMAT_REASON = "This video format isn't supported. Convert it to MP4 and try again."

/** True when the head looks like a ZIP container, whose type can only be told from its tail. */
export function needsTail(head: Uint8Array): boolean {
  return startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])
}

/**
 * Identifies a file's format from its content first and its name or MIME type
 * second. Content wins because extensions and browser-reported types are often
 * missing or wrong (screenshots named ".png" that are JPEG, HEIC photos with an
 * empty type, and so on).
 */
export function detectKind({ head, tail, name = '', type = '' }: SniffInput): Detection {
  const ext = extensionOf(name)
  const mime = type.toLowerCase().split(';')[0].trim()

  if (RAW_PHOTO_EXTENSIONS.has(ext)) {
    return unsupported("RAW photos aren't supported. Export the photo as JPEG and try again.")
  }
  if (PACKAGE_EXTENSIONS.has(ext) && ext !== 'rtfd') return iWorkOrPackage(ext)

  // Byte order marks first: FF FE also looks like an MPEG audio frame header.
  if (hasTextBom(head)) return classifyText(head, ext, mime)
  const magic = sniffMagic(head, tail, ext)
  if (magic) return magic
  // A media file whose header we don't recognize is still not text.
  if (BINARY_MEDIA_EXTENSIONS.has(ext) || !looksLikeText(head)) return fromNameAndType(ext, mime)
  return classifyText(head, ext, mime)
}

function hasTextBom(head: Uint8Array): boolean {
  return (
    (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) ||
    (head[0] === 0xff && head[1] === 0xfe) ||
    (head[0] === 0xfe && head[1] === 0xff)
  )
}

export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

function sniffMagic(b: Uint8Array, tail: Uint8Array | undefined, ext: string): Detection | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { kind: 'jpeg', mime: 'image/jpeg' }
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return isAnimatedPng(b) ? { kind: 'apng', mime: 'image/png' } : { kind: 'png', mime: 'image/png' }
  }
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return { kind: 'gif', mime: 'image/gif' }

  if (ascii(b, 0, 4) === 'RIFF') {
    const form = ascii(b, 8, 4)
    if (form === 'WEBP') {
      const animated = ascii(b, 12, 4) === 'VP8X' && (b[20] & 0x02) !== 0
      return { kind: animated ? 'webp-animated' : 'webp', mime: 'image/webp' }
    }
    if (form === 'WAVE') return unsupported(AUDIO_REASON)
    if (form === 'AVI ') return unsupported(VIDEO_FORMAT_REASON)
  }

  if (b[0] === 0x42 && b[1] === 0x4d && b.length >= 18) {
    // "BM" alone matches plenty of text; require a known DIB header size too.
    const dibHeaderSize = readU32LE(b, 14)
    if ([12, 40, 52, 56, 64, 108, 124].includes(dibHeaderSize)) return { kind: 'bmp', mime: 'image/bmp' }
  }

  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { kind: 'tiff', mime: 'image/tiff' }
  }

  if ((startsWith(b, [0, 0, 1, 0]) || startsWith(b, [0, 0, 2, 0])) && b.length >= 22) {
    const count = b[4] | (b[5] << 8)
    if (count > 0 && count <= 256 && b[9] === 0) return { kind: 'ico', mime: 'image/x-icon' }
  }

  if (startsWith(b, [0xff, 0x0a]) || startsWith(b, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) {
    return { kind: 'jxl', mime: 'image/jxl' }
  }
  if (startsWith(b, [0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) {
    return { kind: 'image', mime: 'image/jp2' }
  }

  const box = ascii(b, 4, 4)
  if (box === 'ftyp') return classifyIsoBmff(b, ext)
  if (QUICKTIME_ATOMS.has(box) && (ext === 'mov' || ext === 'qt' || ext === 'mp4' || ext === 'm4v')) {
    return { kind: 'video', mime: 'video/quicktime' }
  }

  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) {
    if (ext === 'weba' || ext === 'mka') return unsupported(AUDIO_REASON)
    const header = ascii(b, 0, Math.min(b.length, 64))
    return { kind: 'video', mime: header.includes('matroska') ? 'video/x-matroska' : 'video/webm' }
  }

  if (indexOfAscii(b, '%PDF-', 0, 1024) !== -1) return { kind: 'pdf', mime: 'application/pdf' }

  if (needsTail(b)) return classifyZip(b, tail, ext)
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return classifyLegacyOffice(ext)

  if (ascii(b, 0, 4) === '8BPS') {
    return unsupported("Photoshop files aren't supported. Export the image as PNG and try again.")
  }
  if (ascii(b, 0, 4) === 'OggS') {
    return ext === 'ogv' ? { kind: 'video', mime: 'video/ogg' } : unsupported(AUDIO_REASON)
  }
  if (
    ascii(b, 0, 3) === 'ID3' ||
    ascii(b, 0, 4) === 'fLaC' ||
    ascii(b, 0, 4) === 'MThd' ||
    (ascii(b, 0, 4) === 'FORM' && ascii(b, 8, 3) === 'AIF') ||
    (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) || // AAC ADTS
    isMpegAudioFrame(b)
  ) {
    return unsupported(AUDIO_REASON)
  }
  if (
    startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) || // 7z
    ascii(b, 0, 4) === 'Rar!' ||
    startsWith(b, [0x1f, 0x8b]) || // gzip
    startsWith(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]) || // xz
    (ascii(b, 0, 3) === 'BZh' && b[3] >= 0x31 && b[3] <= 0x39)
  ) {
    return unsupported(ARCHIVE_REASON)
  }
  return null
}

function classifyIsoBmff(b: Uint8Array, ext: string): Detection {
  const size = Math.min(readU32BE(b, 0), b.length)
  const major = ascii(b, 8, 4)
  const compatible: string[] = []
  for (let offset = 16; offset + 4 <= size; offset += 4) compatible.push(ascii(b, offset, 4))
  const has = (brand: string) => major === brand || compatible.includes(brand)

  if (major === 'qt  ') return { kind: 'video', mime: 'video/quicktime' }
  if (major === 'crx ') return unsupported("RAW photos aren't supported. Export the photo as JPEG and try again.")
  if (major === 'avis' || (has('avis') && !has('avif'))) return { kind: 'avif-sequence', mime: 'image/avif' }
  if (major === 'avif' || has('avif')) return { kind: 'avif', mime: 'image/avif' }
  if (HEIF_BRANDS.has(major)) return { kind: 'heic', mime: major === 'mif1' || major === 'msf1' ? 'image/heif' : 'image/heic' }
  if (MP4_AUDIO_BRANDS.has(major)) return unsupported(AUDIO_REASON)
  if (MP4_VIDEO_BRANDS.has(major)) return { kind: 'video', mime: ext === 'mov' ? 'video/quicktime' : 'video/mp4' }
  if (compatible.some((brand) => HEIF_BRANDS.has(brand))) return { kind: 'heic', mime: 'image/heic' }
  if (compatible.some((brand) => MP4_AUDIO_BRANDS.has(brand)) && !compatible.some((brand) => MP4_VIDEO_BRANDS.has(brand))) {
    return unsupported(AUDIO_REASON)
  }
  // Unknown brands in an ISO media container are overwhelmingly video.
  return { kind: 'video', mime: ext === 'mov' ? 'video/quicktime' : 'video/mp4' }
}

function classifyZip(head: Uint8Array, tail: Uint8Array | undefined, ext: string): Detection {
  // Entry names appear in local headers (head) and the central directory (tail).
  const contains = (text: string) => indexOfAscii(head, text) !== -1 || (tail !== undefined && indexOfAscii(tail, text) !== -1)

  if (contains('word/')) return { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  if (contains('xl/')) return unsupported("Excel spreadsheets aren't supported. Save the sheet as CSV and try again.")
  if (contains('ppt/')) return unsupported("PowerPoint presentations aren't supported. Export as PDF and try again.")
  if (contains('mimetypeapplication/vnd.oasis.opendocument.text')) {
    return unsupported("OpenDocument text isn't supported. Save it as Word (.docx) and try again.")
  }
  if (contains('mimetypeapplication/vnd.oasis.opendocument.spreadsheet')) {
    return unsupported("OpenDocument spreadsheets aren't supported. Save the sheet as CSV and try again.")
  }
  if (contains('mimetypeapplication/vnd.oasis.opendocument')) {
    return unsupported("OpenDocument files aren't supported. Export as PDF and try again.")
  }
  if (contains('mimetypeapplication/epub+zip')) return unsupported("E-books aren't supported. Export as PDF and try again.")
  if (contains('Index/Document.iwa') || PACKAGE_EXTENSIONS.has(ext)) return iWorkOrPackage(ext)
  return unsupported(ARCHIVE_REASON)
}

function classifyLegacyOffice(ext: string): Detection {
  switch (ext) {
    case 'xls':
      return unsupported("Excel spreadsheets aren't supported. Save the sheet as CSV and try again.")
    case 'ppt':
    case 'pps':
      return unsupported("PowerPoint presentations aren't supported. Export as PDF and try again.")
    default:
      return unsupported("Older Word documents (.doc) aren't supported. Save it as .docx and try again.")
  }
}

function iWorkOrPackage(ext: string): Detection {
  switch (ext) {
    case 'pages':
      return unsupported("Pages documents aren't supported. Export as PDF or Word and try again.")
    case 'numbers':
      return unsupported("Numbers spreadsheets aren't supported. Export as CSV and try again.")
    case 'key':
      return unsupported("Keynote presentations aren't supported. Export as PDF and try again.")
    default:
      return unsupported("This file type isn't supported.")
  }
}

function classifyText(head: Uint8Array, ext: string, mime: string): Detection {
  const start = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0
  const snippet = ascii(head, start, Math.min(head.length - start, 4096))

  if (/^\s*\{\\rtf/.test(snippet)) return { kind: 'rtf', mime: 'application/rtf' }
  if (ext === 'svg' || mime === 'image/svg+xml' || isSvgMarkup(snippet)) return { kind: 'svg', mime: 'image/svg+xml' }

  if (MARKDOWN_EXTENSIONS.has(ext)) return { kind: 'markdown', mime: 'text/markdown' }
  if (HTML_EXTENSIONS.has(ext)) return { kind: 'html', mime: 'text/html' }
  if (ext === 'csv') return { kind: 'csv', mime: 'text/csv' }
  if (ext === 'tsv' || ext === 'tab') return { kind: 'tsv', mime: 'text/tab-separated-values' }
  if (JSON_EXTENSIONS.has(ext)) return { kind: 'json', mime: 'application/json' }
  if (ext !== '') {
    // Any other extension on a text file (txt, log, source code...) is plain text.
    return { kind: 'text', mime: 'text/plain' }
  }

  switch (mime) {
    case 'text/markdown':
    case 'text/x-markdown':
      return { kind: 'markdown', mime: 'text/markdown' }
    case 'text/html':
      return { kind: 'html', mime: 'text/html' }
    case 'text/csv':
      return { kind: 'csv', mime: 'text/csv' }
    case 'text/tab-separated-values':
      return { kind: 'tsv', mime: 'text/tab-separated-values' }
    case 'application/json':
      return { kind: 'json', mime: 'application/json' }
  }
  if (/^\s*(<!--[\s\S]*?-->\s*)*<(!doctype\s+html|html[\s>]|head[\s>]|body[\s>])/i.test(snippet)) {
    return { kind: 'html', mime: 'text/html' }
  }
  return { kind: 'text', mime: 'text/plain' }
}

function isSvgMarkup(snippet: string): boolean {
  return /^\s*(<\?xml[^>]*>\s*)?((<!--[\s\S]*?-->|<!doctype[^>]*>)\s*)*<svg[\s>]/i.test(snippet)
}

function fromNameAndType(ext: string, mime: string): Detection {
  if (ext === 'heic' || ext === 'heif' || mime === 'image/heic' || mime === 'image/heif') {
    return { kind: 'heic', mime: 'image/heic' }
  }
  if (VIDEO_EXTENSIONS.has(ext) || mime.startsWith('video/')) return { kind: 'video', mime: mime || 'video/mp4' }
  if (mime.startsWith('image/')) return { kind: 'image', mime }
  if (mime.startsWith('audio/')) return unsupported(AUDIO_REASON)
  return unsupported("This file type isn't supported.")
}

/**
 * Heuristic: text files have no NUL bytes (unless UTF-16) and few C0 control
 * characters beyond tab, newline, carriage return, form feed and escape.
 */
export function looksLikeText(head: Uint8Array): boolean {
  if (head.length === 0) return true
  if (hasTextBom(head) || guessUtf16(head)) return true
  const length = Math.min(head.length, 8192)
  let control = 0
  for (let i = 0; i < length; i++) {
    const c = head[i]
    if (c === 0) return false
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c && c !== 0x1b) control++
  }
  return control <= length * 0.01
}

/** An MPEG audio frame header (MP3 without ID3 tag): sync, a layer, and valid rate indices. */
function isMpegAudioFrame(b: Uint8Array): boolean {
  if (b.length < 4 || b[0] !== 0xff || (b[1] & 0xe0) !== 0xe0) return false
  const version = (b[1] >> 3) & 3
  const layer = (b[1] >> 1) & 3
  const bitrate = b[2] >> 4
  const sampleRate = (b[2] >> 2) & 3
  return version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 15 && sampleRate !== 3
}

/** Detects APNG: an `acTL` chunk must precede the first `IDAT`. */
function isAnimatedPng(b: Uint8Array): boolean {
  let offset = 8
  while (offset + 8 <= b.length) {
    const length = readU32BE(b, offset)
    const type = ascii(b, offset + 4, 4)
    if (type === 'acTL') return true
    if (type === 'IDAT' || type === 'IEND') return false
    offset += 12 + length
  }
  return false
}

function unsupported(reason: string): Detection {
  return { kind: 'unsupported', mime: 'application/octet-stream', reason }
}

export function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false
  }
  return true
}

/** Reads bytes as Latin-1 characters; handy for comparing ASCII signatures. */
export function ascii(bytes: Uint8Array, offset: number, length: number): string {
  const end = Math.min(bytes.length, offset + length)
  let out = ''
  for (let i = offset; i < end; i++) out += String.fromCharCode(bytes[i])
  return out
}

export function indexOfAscii(bytes: Uint8Array, needle: string, from = 0, to = bytes.length): number {
  const first = needle.charCodeAt(0)
  const last = Math.min(to, bytes.length) - needle.length
  outer: for (let i = from; i <= last; i++) {
    if (bytes[i] !== first) continue
    for (let j = 1; j < needle.length; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer
    }
    return i
  }
  return -1
}

export function readU32BE(b: Uint8Array, offset: number): number {
  return ((b[offset] << 24) | (b[offset + 1] << 16) | (b[offset + 2] << 8) | b[offset + 3]) >>> 0
}

export function readU32LE(b: Uint8Array, offset: number): number {
  return (b[offset] | (b[offset + 1] << 8) | (b[offset + 2] << 16) | (b[offset + 3] << 24)) >>> 0
}
