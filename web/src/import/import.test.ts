import { describe, expect, it } from 'vitest'
import { detectDelimiter, parseDelimited } from './csv'
import { collectFiles, isHiddenName, type TransferSnapshot } from './datatransfer'
import { GifCompositor, type GifFrame } from './gifCompose'
import {
  animationFrameSize,
  fitWithin,
  gifLoopsToPlays,
  normalizeDelay,
  orientedSize,
  readGifLoopCount,
  readImageInfo,
} from './imageInfo'
import { markdownToHtml } from './markdown'
import { naturalCompare, naturalSortBy } from './naturalSort'
import { assemblePageText, type PdfTextItem } from './pdfText'
import { rtfToHtml } from './rtf'
import { safeHref, safeImageSrc, sanitizeDom, type DomLikeNode } from './sanitize'
import { detectKind, type FileKind } from './sniff'
import { decodeText } from './text'

// ---------------------------------------------------------------------------
// Helpers

function bytes(...parts: Array<string | number[] | Uint8Array>): Uint8Array {
  const chunks = parts.map((part) =>
    typeof part === 'string' ? Uint8Array.from(part, (c) => c.charCodeAt(0)) : Uint8Array.from(part),
  )
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16le = (n: number) => [n & 255, (n >>> 8) & 255]

function ftyp(major: string, ...compatible: string[]): Uint8Array {
  const size = 16 + compatible.length * 4
  return bytes(u32be(size), 'ftyp', major, [0, 0, 0, 0], ...compatible, 'mdat')
}

function kindOf(head: Uint8Array, name = '', type = '', tail?: Uint8Array): FileKind {
  return detectKind({ head, tail, name, type }).kind
}

/**
 * A tiny HTML tokenizer producing DomLikeNode trees, enough to express
 * sanitizer inputs as strings. (No tree-construction fixups: inputs must be
 * well nested.)
 */
function parseHtml(html: string): DomLikeNode {
  const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'col', 'source'])
  type MutableNode = DomLikeNode & { childNodes: MutableNode[] }
  const decode = (s: string) =>
    s
      .replace(/&nbsp;/g, '\u00a0')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
      .replace(/&amp;/g, '&')
  const element = (name: string, attrs: Record<string, string>): MutableNode => ({
    nodeType: 1,
    nodeName: name.toUpperCase(),
    nodeValue: null,
    childNodes: [],
    getAttribute: (key: string) => (key in attrs ? attrs[key] : null),
  })
  const root = element('body', {})
  const stack: MutableNode[] = [root]
  const top = () => stack[stack.length - 1]
  const token = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|[^<]+|</g
  let match: RegExpExecArray | null
  while ((match = token.exec(html))) {
    const [raw, closing, opening, attrText] = match
    if (raw.startsWith('<!--')) {
      top().childNodes.push({ nodeType: 8, nodeName: '#comment', nodeValue: raw.slice(4, -3), childNodes: [] })
    } else if (closing) {
      const name = closing.toLowerCase()
      const index = stack.map((n) => n.nodeName.toLowerCase()).lastIndexOf(name)
      if (index > 0) stack.length = index
    } else if (opening) {
      const attrs: Record<string, string> = {}
      for (const a of (attrText ?? '').matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '')
      }
      const node = element(opening, attrs)
      top().childNodes.push(node)
      const name = opening.toLowerCase()
      if (name === 'script' || name === 'style') {
        const end = html.toLowerCase().indexOf(`</${name}`, token.lastIndex)
        const stop = end === -1 ? html.length : end
        node.childNodes.push({ nodeType: 3, nodeName: '#text', nodeValue: html.slice(token.lastIndex, stop), childNodes: [] })
        token.lastIndex = stop
      } else if (!VOID.has(name) && !raw.endsWith('/>')) {
        stack.push(node)
      }
    } else {
      top().childNodes.push({ nodeType: 3, nodeName: '#text', nodeValue: decode(raw), childNodes: [] })
    }
  }
  return root
}

const sanitize = (html: string) => sanitizeDom(parseHtml(html))

// ---------------------------------------------------------------------------

describe('detectKind', () => {
  it('recognizes image signatures regardless of name', () => {
    expect(kindOf(bytes([0xff, 0xd8, 0xff, 0xe0]), 'photo.png')).toBe('jpeg')
    expect(kindOf(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], u32be(13), 'IHDR'))).toBe('png')
    expect(kindOf(bytes('GIF89a', [1, 0, 1, 0]))).toBe('gif')
    expect(kindOf(bytes('GIF87a'))).toBe('gif')
    expect(kindOf(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe('webp')
    expect(kindOf(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8X', [10, 0, 0, 0], [0x02, 0, 0, 0]))).toBe('webp-animated')
    expect(kindOf(bytes('II*', [0]))).toBe('tiff')
    expect(kindOf(bytes('MM', [0, 42]))).toBe('tiff')
  })

  it('detects APNG by an acTL chunk before IDAT', () => {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = bytes(u32be(13), 'IHDR', new Array(13).fill(0), [0, 0, 0, 0])
    const actl = bytes(u32be(8), 'acTL', new Array(8).fill(0), [0, 0, 0, 0])
    const idat = bytes(u32be(0), 'IDAT', [0, 0, 0, 0])
    expect(kindOf(bytes(sig, ihdr, actl, idat))).toBe('apng')
    expect(kindOf(bytes(sig, ihdr, idat, actl))).toBe('png')
  })

  it('requires a plausible DIB header for BMP', () => {
    const bmp = bytes('BM', new Array(12).fill(0), [40, 0, 0, 0], new Array(20).fill(0))
    expect(kindOf(bmp)).toBe('bmp')
    expect(kindOf(bytes('BMW service notes: change oil at 10k'), 'notes')).toBe('text')
  })

  it('tells HEIC, AVIF and video apart in ISO media files', () => {
    expect(kindOf(ftyp('heic', 'mif1', 'heic'))).toBe('heic')
    expect(kindOf(ftyp('mif1', 'mif1', 'heic'))).toBe('heic')
    expect(kindOf(ftyp('heix', 'mif1'))).toBe('heic')
    expect(kindOf(ftyp('hevc', 'msf1'))).toBe('heic')
    expect(kindOf(ftyp('msf1', 'msf1', 'hevc'))).toBe('heic')
    expect(kindOf(ftyp('avif', 'mif1', 'miaf'))).toBe('avif')
    expect(kindOf(ftyp('mif1', 'avif', 'miaf'))).toBe('avif')
    expect(kindOf(ftyp('avis', 'avif', 'msf1'))).toBe('avif-sequence')
    expect(kindOf(ftyp('qt  ', 'qt  '), 'IMG_0001.MOV')).toBe('video')
    expect(detectKind({ head: ftyp('qt  '), name: 'IMG_0001.MOV' }).mime).toBe('video/quicktime')
    expect(kindOf(ftyp('isom', 'isom', 'iso2', 'avc1', 'mp41'))).toBe('video')
    expect(kindOf(ftyp('mp42', 'isom'))).toBe('video')
    expect(kindOf(ftyp('M4V ', 'M4V ', 'mp42'))).toBe('video')
    expect(kindOf(ftyp('M4A ', 'M4A ', 'mp42'))).toBe('unsupported')
  })

  it('recognizes WebM/Matroska, PDF, and a PDF header after leading junk', () => {
    expect(kindOf(bytes([0x1a, 0x45, 0xdf, 0xa3], '....B\x82\x84webm'))).toBe('video')
    expect(kindOf(bytes('%PDF-1.7\n'))).toBe('pdf')
    expect(kindOf(bytes('\n\n  garbage %PDF-1.4'))).toBe('pdf')
  })

  it('looks inside ZIP containers', () => {
    const zip = (entry: string) => bytes('PK', [3, 4], new Array(26).fill(0), entry)
    expect(kindOf(zip('[Content_Types].xml'), 'report.docx', '', bytes('PK', [1, 2], 'word/document.xml'))).toBe('docx')
    expect(kindOf(zip('word/document.xml'), 'x.bin')).toBe('docx')
    const xlsx = detectKind({ head: zip('xl/workbook.xml'), name: 'data.xlsx' })
    expect(xlsx.kind).toBe('unsupported')
    expect(xlsx.reason).toMatch(/CSV/)
    expect(detectKind({ head: zip('photos/a.jpg'), name: 'photos.zip' }).reason).toMatch(/Unzip/)
  })

  it('explains unsupported formats', () => {
    const ole = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect(detectKind({ head: ole, name: 'essay.doc' }).reason).toMatch(/\.docx/)
    expect(detectKind({ head: bytes([0xff, 0xd8, 0xff]), name: 'IMG_1.DNG' }).reason).toMatch(/RAW/)
    expect(kindOf(bytes('ID3', [4, 0, 0]))).toBe('unsupported')
    expect(kindOf(bytes('RIFF', [0, 0, 0, 0], 'AVI LIST'))).toBe('unsupported')
    expect(kindOf(bytes([0, 1, 2, 3, 0, 0, 0, 9]), 'mystery.bin')).toBe('unsupported')
  })

  it('classifies text files by extension first, then MIME type, then content', () => {
    const text = bytes('# Title\n\nSome *text*.')
    expect(kindOf(text, 'notes.md')).toBe('markdown')
    expect(kindOf(text, 'notes.markdown')).toBe('markdown')
    expect(kindOf(text, 'notes.txt')).toBe('text')
    expect(kindOf(text, 'notes', 'text/markdown')).toBe('markdown')
    expect(kindOf(bytes('a,b\n1,2\n'), 'data.csv')).toBe('csv')
    expect(kindOf(bytes('a\tb\n1\t2\n'), 'data.tsv')).toBe('tsv')
    expect(kindOf(bytes('{"a": 1}'), 'data.json')).toBe('json')
    expect(kindOf(bytes('<p>hi</p>'), 'page.htm')).toBe('html')
    expect(kindOf(bytes('<!DOCTYPE html><html><body>hi'), '', '')).toBe('html')
    expect(kindOf(bytes('<!DOCTYPE html><html><body>hi'), 'page.txt')).toBe('text')
    expect(kindOf(bytes('hello world'), 'pasted', 'text/plain')).toBe('text')
  })

  it('sniffs SVG and RTF by content', () => {
    expect(kindOf(bytes('<?xml version="1.0"?>\n<!-- Generator: x -->\n<svg xmlns="http://www.w3.org/2000/svg"/>'), 'logo.xml')).toBe('svg')
    expect(kindOf(bytes('<svg viewBox="0 0 1 1"></svg>'))).toBe('svg')
    expect(kindOf(bytes('{\\rtf1\\ansi hello}'), 'letter.txt')).toBe('rtf')
  })

  it('treats UTF-16 text as text', () => {
    const utf16 = bytes([0xff, 0xfe], [...'hi there'].flatMap((c) => [c.charCodeAt(0), 0]))
    expect(kindOf(utf16, 'a.txt')).toBe('text')
    const noBom = bytes([...'hello world, plain text'].flatMap((c) => [c.charCodeAt(0), 0]))
    expect(kindOf(noBom, 'b.csv')).toBe('csv')
  })

  it('falls back to name and type for unrecognized binary content', () => {
    expect(kindOf(bytes([0, 0, 0, 0x18, 0, 0, 0, 0, 1, 2]), 'IMG_4431.HEIC')).toBe('heic')
    expect(kindOf(bytes([0, 0, 0, 0, 1, 2, 3, 0]), 'clip.mov')).toBe('video')
    expect(kindOf(bytes([0, 0, 0, 0, 1, 2, 3, 0]), 'img', 'image/x-whatever')).toBe('image')
    // A media extension never falls through to text, even if the bytes look like it.
    expect(kindOf(bytes('not really a movie'), 'clip.mov')).toBe('video')
  })
})

describe('readImageInfo', () => {
  it('reads JPEG size and EXIF orientation', () => {
    const tiff = bytes('MM', [0, 42], u32be(8), [0, 1], [0x01, 0x12, 0, 3], u32be(1), [0, 6, 0, 0], u32be(0))
    const app1 = bytes([0xff, 0xe1], [0, tiff.length + 8], 'Exif', [0, 0], tiff)
    const sof = bytes([0xff, 0xc0, 0, 17, 8], [0x0b, 0xb8], [0x0f, 0xa0], [3], new Array(9).fill(0))
    const info = readImageInfo(bytes([0xff, 0xd8], app1, sof, [0xff, 0xda]))
    expect(info).toEqual({ width: 4000, height: 3000, orientation: 6, alpha: 'no' })
    expect(orientedSize(info!)).toEqual({ width: 3000, height: 4000 })
  })

  it('reads PNG size and alpha capability', () => {
    const png = (colorType: number, extra: Uint8Array = new Uint8Array()) =>
      bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], u32be(13), 'IHDR', u32be(640), u32be(480), [8, colorType, 0, 0, 0], [0, 0, 0, 0], extra, u32be(0), 'IDAT')
    expect(readImageInfo(png(2))).toMatchObject({ width: 640, height: 480, alpha: 'no' })
    expect(readImageInfo(png(6))).toMatchObject({ alpha: 'maybe' })
    expect(readImageInfo(png(3, bytes(u32be(1), 'tRNS', [0], [0, 0, 0, 0])))).toMatchObject({ alpha: 'maybe' })
  })

  it('reads GIF and WebP sizes', () => {
    expect(readImageInfo(bytes('GIF89a', u16le(320), u16le(200)))).toMatchObject({ width: 320, height: 200 })
    const vp8x = bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8X', [10, 0, 0, 0], [0x10, 0, 0, 0], [0x7f, 0x02, 0], [0xdf, 0x01, 0])
    expect(readImageInfo(vp8x)).toMatchObject({ width: 640, height: 480, alpha: 'maybe' })
  })
})

describe('animation helpers', () => {
  it('reads GIF loop counts', () => {
    const netscape = (count: number) => bytes('GIF89a', [0x21, 0xff, 0x0b], 'NETSCAPE2.0', [3, 1], u16le(count), [0])
    expect(readGifLoopCount(netscape(0))).toBe(0)
    expect(readGifLoopCount(netscape(3))).toBe(3)
    expect(readGifLoopCount(bytes('GIF89a no extension'))).toBeUndefined()
    expect(gifLoopsToPlays(undefined)).toBe(1)
    expect(gifLoopsToPlays(0)).toBe(0)
    expect(gifLoopsToPlays(3)).toBe(4)
  })

  it('normalizes tiny frame delays like browsers do', () => {
    expect(normalizeDelay(0)).toBe(100)
    expect(normalizeDelay(10)).toBe(100)
    expect(normalizeDelay(19.9)).toBe(100)
    expect(normalizeDelay(20)).toBe(20)
    expect(normalizeDelay(70)).toBe(70)
    expect(normalizeDelay(Number.NaN)).toBe(100)
  })

  it('fits sizes within bounds', () => {
    expect(fitWithin(8064, 6048, 4096)).toEqual({ width: 4096, height: 3072, scaled: true })
    expect(fitWithin(100, 50, 4096)).toEqual({ width: 100, height: 50, scaled: false })
    expect(fitWithin(10000, 1, 100)).toEqual({ width: 100, height: 1, scaled: true })
  })

  it('shrinks animation frames to stay within the pixel budget', () => {
    const size = animationFrameSize(1000, 1000, 400, 4096, 100_000_000)
    expect(size.scaled).toBe(true)
    expect(size.width * size.height * 400).toBeLessThanOrEqual(100_000_000)
    expect(animationFrameSize(200, 100, 10, 4096, 100_000_000)).toEqual({ width: 200, height: 100, scaled: false })
  })
})

describe('GifCompositor', () => {
  const palette = [
    [0, 0, 0],
    [255, 0, 0],
    [0, 255, 0],
  ]
  const frame = (pixels: number[], dims: GifFrame['dims'], disposalType = 0, transparentIndex?: number): GifFrame => ({
    dims,
    pixels,
    colorTable: palette,
    disposalType,
    transparentIndex,
  })
  const pixel = (buffer: Uint8ClampedArray, x: number, y: number, width = 2) =>
    Array.from(buffer.slice((y * width + x) * 4, (y * width + x) * 4 + 4))

  it('starts transparent and keeps pixels under transparent indices', () => {
    const gif = new GifCompositor(2, 2)
    let out = gif.render(frame([1, 1, 1, 1], { left: 0, top: 0, width: 2, height: 2 }))
    expect(pixel(out, 1, 1)).toEqual([255, 0, 0, 255])
    out = gif.render(frame([2, 0], { left: 0, top: 0, width: 2, height: 1 }, 0, 0))
    expect(pixel(out, 0, 0)).toEqual([0, 255, 0, 255])
    expect(pixel(out, 1, 0)).toEqual([255, 0, 0, 255])
  })

  it('restores to background (transparent) for disposal 2', () => {
    const gif = new GifCompositor(2, 2)
    gif.render(frame([1, 1, 1, 1], { left: 0, top: 0, width: 2, height: 2 }))
    gif.render(frame([2], { left: 1, top: 1, width: 1, height: 1 }, 2))
    const out = gif.render(frame([0], { left: 0, top: 0, width: 1, height: 1 }, 0, 0))
    expect(pixel(out, 1, 1)).toEqual([0, 0, 0, 0])
    expect(pixel(out, 0, 1)).toEqual([255, 0, 0, 255])
  })

  it('restores the previous image for disposal 3', () => {
    const gif = new GifCompositor(2, 2)
    gif.render(frame([1, 1, 1, 1], { left: 0, top: 0, width: 2, height: 2 }))
    const during = gif.render(frame([2, 2, 2, 2], { left: 0, top: 0, width: 2, height: 2 }, 3))
    expect(pixel(during, 0, 0)).toEqual([0, 255, 0, 255])
    const after = gif.render(frame([0], { left: 0, top: 0, width: 1, height: 1 }, 0, 0))
    expect(pixel(after, 0, 0)).toEqual([255, 0, 0, 255])
  })

  it('clips frames that extend past the logical screen', () => {
    const gif = new GifCompositor(2, 2)
    const out = gif.render(frame([1, 1, 1, 1], { left: 1, top: 1, width: 2, height: 2 }))
    expect(pixel(out, 1, 1)).toEqual([255, 0, 0, 255])
    expect(pixel(out, 0, 0)).toEqual([0, 0, 0, 0])
  })
})

describe('parseDelimited', () => {
  it('parses quoted fields with delimiters, newlines and escaped quotes', () => {
    const csv = 'name,quote\r\n"Smith, J.","He said ""hi""\nthen left"\r\nDoe,plain\r\n'
    expect(parseDelimited(csv)).toEqual([
      ['name', 'quote'],
      ['Smith, J.', 'He said "hi"\nthen left'],
      ['Doe', 'plain'],
    ])
  })

  it('strips a BOM, handles CR-only lines, and pads ragged rows', () => {
    expect(parseDelimited('\ufeffa,b,c\r1,2\r3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', ''],
      ['3', '', ''],
    ])
  })

  it('keeps empty fields and drops trailing blank lines', () => {
    expect(parseDelimited('a,,c\n,,\n1,2,3\n\n\n')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
      ['1', '2', '3'],
    ])
  })

  it('tolerates spaces around quoted fields and unterminated quotes', () => {
    expect(parseDelimited('a, "b" ,c\n1,"unterminated\n2')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'unterminated\n2', ''],
    ])
  })

  it('detects the delimiter', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectDelimiter('x;y\n1,5;2,25\n4,1;5,5')).toBe(';')
    expect(detectDelimiter('price;qty\n1,5;2\n3,25;4')).toBe(';')
    expect(detectDelimiter('"a;b",c\n"d;e",f')).toBe(',')
    expect(detectDelimiter('single column\nvalues')).toBe(',')
    expect(parseDelimited('Name;Betrag\nMiete;1.200,50\n')).toEqual([
      ['Name', 'Betrag'],
      ['Miete', '1.200,50'],
    ])
  })
})

describe('naturalCompare', () => {
  it('orders digit runs numerically and ignores case', () => {
    const names = ['img10.png', 'IMG2.png', 'img1.png', 'img2b.png', 'Img20.png', 'a.png']
    expect(naturalSortBy(names, (n) => n)).toEqual(['a.png', 'img1.png', 'IMG2.png', 'img2b.png', 'img10.png', 'Img20.png'])
    expect(naturalCompare('page 9', 'page 10')).toBeLessThan(0)
    expect(naturalCompare('x', 'x')).toBe(0)
  })

  it('is stable and total', () => {
    expect(naturalCompare('a', 'A')).not.toBe(0)
    const items = [{ n: 'b', i: 0 }, { n: 'a', i: 1 }, { n: 'b', i: 2 }]
    expect(naturalSortBy(items, (x) => x.n).map((x) => x.i)).toEqual([1, 0, 2])
  })
})

describe('decodeText', () => {
  it('decodes UTF-8 and strips the BOM', () => {
    expect(decodeText(new TextEncoder().encode('\ufeffcafé ✓'))).toBe('café ✓')
    expect(decodeText(new TextEncoder().encode('naïve'))).toBe('naïve')
  })

  it('falls back to Windows-1252 for invalid UTF-8', () => {
    expect(decodeText(bytes([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x35]))).toBe('café €5')
  })

  it('decodes UTF-16 with and without a BOM', () => {
    const le = bytes([0xff, 0xfe], [0x68, 0, 0x69, 0, 0x0d, 0, 0x0a, 0, 0x21, 0])
    expect(decodeText(le)).toBe('hi\n!')
    const be = bytes([0xfe, 0xff], [0, 0x68, 0, 0x69])
    expect(decodeText(be)).toBe('hi')
    const bare = bytes([...'plain utf-16 text'].flatMap((c) => [c.charCodeAt(0), 0]))
    expect(decodeText(bare)).toBe('plain utf-16 text')
  })

  it('normalizes CRLF and CR newlines', () => {
    expect(decodeText(new TextEncoder().encode('a\r\nb\rc\n'))).toBe('a\nb\nc\n')
  })
})

describe('sanitizeDom', () => {
  it('keeps allowed structure and canonicalizes tags', () => {
    expect(sanitize('<h1>Title</h1><p>Some <b>bold</b>, <i>italic</i>, <u>under</u> and <strike>gone</strike>.</p>')).toBe(
      '<h1>Title</h1><p>Some <strong>bold</strong>, <em>italic</em>, <u>under</u> and <s>gone</s>.</p>',
    )
    expect(sanitize('<h5>Small heading</h5>')).toBe('<h3>Small heading</h3>')
  })

  it('drops scripts, styles, event handlers and unknown attributes', () => {
    const html = sanitize(
      '<p onclick="evil()" class="x" id="y">Hi<script>alert(1)</script><style>p{}</style><img src="x" onerror="evil()"></p><iframe src="https://evil"></iframe>',
    )
    expect(html).toBe('<p>Hi</p>')
  })

  it('filters link and image URLs', () => {
    expect(sanitize('<p><a href="javascript:alert(1)">x</a> <a href="https://example.com/?a=1&b=2">ok</a></p>')).toBe(
      '<p>x <a href="https://example.com/?a=1&amp;b=2">ok</a></p>',
    )
    expect(safeHref(' java\tscript:alert(1)')).toBeNull()
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(safeImageSrc('data:text/html;base64,AAAA')).toBeNull()
    expect(safeImageSrc('data:image/x-emf;base64,AAAA')).toBeNull()
    expect(safeImageSrc('blob:https://app/123')).toBe('blob:https://app/123')
    expect(safeImageSrc('https://example.com/a.png')).toBeNull()
    expect(sanitize('<p><img src="data:image/png;base64,AAAA" alt="A &quot;pic&quot;" width="5"></p>')).toBe(
      '<p><img src="data:image/png;base64,AAAA" alt="A &quot;pic&quot;"></p>',
    )
  })

  it('turns inline styles into semantic formatting and keeps only colors', () => {
    expect(sanitize('<p><span style="font-weight: 700; font-family: Arial">bold</span> <span style="font-style:italic">it</span></p>')).toBe(
      '<p><strong>bold</strong> <em>it</em></p>',
    )
    expect(sanitize('<p><span style="color: #c00; background-color: rgb(255, 255, 0); font-size: 30px">hot</span></p>')).toBe(
      '<p><span style="color: #c00; background-color: rgb(255, 255, 0)">hot</span></p>',
    )
    expect(sanitize('<p><span style="color: black; background: white">plain</span></p>')).toBe('<p>plain</p>')
    expect(sanitize('<p><span style="color: url(javascript:x)">x</span></p>')).toBe('<p>x</p>')
    expect(sanitize('<p><font color="red">red</font></p>')).toBe('<p><span style="color: red">red</span></p>')
  })

  it('unwraps the Google Docs <b style="font-weight:normal"> wrapper', () => {
    expect(sanitize('<b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;white-space:pre-wrap">A</span><span>b</span></p></b>')).toBe(
      '<p><strong>A</strong>b</p>',
    )
  })

  it('turns layout containers into paragraphs', () => {
    expect(sanitize('<div>one</div><div>two <b>2</b></div><section><div>three</div></section>')).toBe(
      '<p>one</p><p>two <strong>2</strong></p><p>three</p>',
    )
    expect(sanitize('loose text<br>next line')).toBe('<p>loose text<br>next line</p>')
  })

  it('applies a styled container to the text of its paragraphs', () => {
    expect(sanitize('<div style="color: #333"><p>a</p><p>b</p></div>')).toBe(
      '<p><span style="color: #333">a</span></p><p><span style="color: #333">b</span></p>',
    )
  })

  it('keeps intentional blank lines but drops empty paragraphs', () => {
    expect(sanitize('<p>a</p><p><br></p><p></p><p>   </p><p>b</p>')).toBe('<p>a</p><p><br></p><p>b</p>')
  })

  it('normalizes lists', () => {
    expect(sanitize('<ul>\n  <li>one</li>\n  <ul><li>nested</li></ul>\n  <li>two</li>\n</ul>')).toBe(
      '<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>',
    )
    expect(sanitize('<ol><li><p>para</p></li><li>tight</li></ol>')).toBe('<ol><li><p>para</p></li><li>tight</li></ol>')
    expect(sanitize('<ul><li><input type="checkbox" checked disabled> done</li><li><input type="checkbox"> todo</li></ul>')).toBe(
      '<ul><li>\u2611 done</li><li>\u2610 todo</li></ul>',
    )
  })

  it('normalizes tables, keeps spans and cell colors, and moves captions out', () => {
    expect(
      sanitize(
        '<table border="1"><caption>ignored</caption><thead><tr><th style="font-weight:bold">H</th></tr></thead><tr><td colspan="2" rowspan="x" style="background-color:#ff0; width: 20px">1</td><td bgcolor="#0f0">2</td></tr><tfoot><tr><td>f</td></tr></tfoot></table>',
      ),
    ).toBe(
      '<p>ignored</p><table><thead><tr><th>H</th></tr></thead><tbody><tr><td colspan="2" style="background-color: #ff0">1</td><td style="background-color: #0f0">2</td></tr><tr><td>f</td></tr></tbody></table>',
    )
  })

  it('preserves preformatted text, including editor pastes styled white-space: pre', () => {
    expect(sanitize('<pre><code class="language-js">const a = 1;\n  if (a &lt; 2) {}\n</code></pre>')).toBe(
      '<pre><code>const a = 1;\n  if (a &lt; 2) {}</code></pre>',
    )
    expect(sanitize('<div style="white-space: pre;"><div><span style="color:#569cd6">let</span> x = 1</div><div>  y</div></div>')).toBe(
      '<pre><code>let x = 1\n  y</code></pre>',
    )
  })

  it('collapses whitespace, removes redundant nesting and comments', () => {
    expect(sanitize('<p>  a \n\n <b><b>b</b></b><!-- note --> c  </p>')).toBe('<p>a <strong>b</strong> c</p>')
    expect(sanitize('<p><b> </b>x<b></b></p>')).toBe('<p>x</p>')
  })

  it('flattens blocks nested inside headings and inline elements', () => {
    expect(sanitize('<h2><p>one</p><p>two</p></h2>')).toBe('<h2>one<br>two</h2>')
    expect(sanitize('<p><a href="https://x.y"><div>card</div></a></p>')).toBe('<p><a href="https://x.y">card</a></p>')
  })

  it('escapes text and non-breaking spaces', () => {
    expect(sanitize('<p>1 &lt; 2 &amp; 3&nbsp;4</p>')).toBe('<p>1 &lt; 2 &amp; 3&nbsp;4</p>')
  })
})

describe('rtfToHtml', () => {
  it('converts paragraphs and character formatting', () => {
    const rtf =
      '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2761{\\fonttbl\\f0\\fswiss Helvetica;}{\\colortbl;\\red255\\green0\\blue0;}' +
      '{\\*\\generator Riched20;}\\pard\\f0\\fs24 Hello \\b bold\\b0  and \\i italic\\i0 .\\par\n' +
      'Second\\line line \\ul under\\ulnone\\par\n}'
    expect(rtfToHtml(rtf)).toBe('<p>Hello <strong>bold</strong> and <em>italic</em>.</p><p>Second<br>line <u>under</u></p>')
  })

  it('decodes \\u escapes, skips their fallbacks, and decodes code page bytes', () => {
    expect(rtfToHtml("{\\rtf1\\ansi\\uc1 caf\\u233? \\'80 5 \\u8364\\'80}")).toBe('<p>café € 5 €</p>')
    expect(rtfToHtml("{\\rtf1\\ansi\\ansicpg1251 \\'cf\\'f0\\'e8}")).toBe('<p>При</p>')
  })

  it('keeps list bullets and blank lines, drops ignorable destinations', () => {
    const rtf = '{\\rtf1 {\\*\\listtable x}{\\listtext \\uc0\\u8226 \\tab}Item\\\n\\\n{\\field{\\*\\fldinst HYPERLINK "u"}{\\fldrslt link}}\\par}'
    expect(rtfToHtml(rtf)).toBe('<p>• Item</p><p><br></p><p>link</p>')
  })

  it('handles escaped braces and backslashes', () => {
    expect(rtfToHtml('{\\rtf1 a \\{b\\} \\\\c}')).toBe('<p>a {b} \\c</p>')
  })
})

describe('assemblePageText', () => {
  const item = (str: string, x: number, y: number, width: number, hasEOL = false, height = 10): PdfTextItem => ({
    str,
    transform: [height, 0, 0, height, x, y],
    width,
    height,
    hasEOL,
  })

  it('breaks lines on baseline changes and adds paragraph gaps', () => {
    const text = assemblePageText([
      item('Hello', 10, 700, 25),
      item('world', 40, 700, 25),
      item('Next line', 10, 688, 45),
      item('New paragraph', 10, 650, 60),
    ])
    expect(text).toBe('Hello world\nNext line\n\nNew paragraph')
  })

  it('honors hasEOL and keeps adjacent items joined', () => {
    const text = assemblePageText([
      item('Sub', 10, 700, 15),
      item('script', 25, 700, 30, true),
      item('', 0, 0, 0, true),
      item('x', 10, 688, 5),
    ])
    expect(text).toBe('Subscript\nx')
  })
})

describe('markdownToHtml', () => {
  it('renders GFM tables and strips front matter', () => {
    const html = markdownToHtml('---\ntitle: x\n---\n| a | b |\n|---|---|\n| 1 | 2 |\n')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
    expect(html).not.toContain('title')
  })
})

describe('collectFiles', () => {
  type FakeEntry = FileSystemEntry & { children?: FakeEntry[] }

  const file = (name: string): FakeEntry =>
    ({
      name,
      isFile: true,
      isDirectory: false,
      file: (resolve: (f: File) => void) => resolve(new File([name], name)),
    }) as unknown as FakeEntry

  const dir = (name: string, children: FakeEntry[]): FakeEntry =>
    ({
      name,
      isFile: false,
      isDirectory: true,
      createReader: () => {
        // Hand out entries in small batches, like Chrome's 100-entry pages.
        let offset = 0
        return {
          readEntries: (resolve: (entries: FakeEntry[]) => void) => {
            const batch = children.slice(offset, offset + 2)
            offset += batch.length
            setTimeout(() => resolve(batch), 0)
          },
        }
      },
    }) as unknown as FakeEntry

  it('walks folders in natural order, skipping hidden files, keeping top-level order', async () => {
    const snapshot: TransferSnapshot = {
      html: '',
      text: '',
      items: [
        { entry: file('z-first.png'), file: new File(['z'], 'z-first.png') },
        {
          entry: dir('Photos', [
            file('img10.jpg'),
            file('.DS_Store'),
            file('img2.jpg'),
            dir('.git', [file('config')]),
            dir('sub', [file('b.txt'), file('a.txt')]),
            file('Thumbs.db'),
            file('img1.jpg'),
            dir('Report.pages', [file('Index.zip')]),
          ]),
          file: null,
        },
        { entry: null, file: new File(['x'], 'loose.txt') },
      ],
    }
    const files = await collectFiles(snapshot)
    expect(files.map((f) => [f.file.name, f.fromFolder])).toEqual([
      ['z-first.png', false],
      ['img1.jpg', true],
      ['img2.jpg', true],
      ['img10.jpg', true],
      ['Report.pages', true],
      ['a.txt', true],
      ['b.txt', true],
      ['loose.txt', false],
    ])
  })

  it('recognizes hidden and system files', () => {
    expect(isHiddenName('.env')).toBe(true)
    expect(isHiddenName('desktop.ini')).toBe(true)
    expect(isHiddenName('__MACOSX')).toBe(true)
    expect(isHiddenName('notes.txt')).toBe(false)
  })
})
