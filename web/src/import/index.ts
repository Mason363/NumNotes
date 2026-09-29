/**
 * File importers: turn whatever the user drops, picks or pastes into a small
 * set of normalized kinds: images, animations, paged documents, rich text,
 * plain text and tables.
 *
 * Heavy decoders (pdf.js, mammoth, libheif, the GIF fallback, marked) are
 * loaded on first use as separate chunks.
 */
import { importAnimated } from './animation'
import { parseDelimited } from './csv'
import { collectFiles, snapshotTransfer, type SourceFile, type TransferSnapshot } from './datatransfer'
import { ImportError, UnsupportedFileError, isAbortError, toImportError } from './errors'
import { importHeic, importStillImage, importSvg } from './image'
import { naturalSortBy } from './naturalSort'
import { subProgress } from './progress'
import { rtfToHtml } from './rtf'
import { sanitizeHtml } from './sanitize'
import { detectKind, needsTail, type Detection } from './sniff'
import { decodeText, normalizeNewlines } from './text'
import type { Imported, ImportOptions, ProgressCallback } from './types'
import { importVideo } from './video'

export type {
  AnimationFrame,
  Imported,
  ImportedAnimation,
  ImportedImage,
  ImportedPages,
  ImportedRich,
  ImportedTable,
  ImportedText,
  ImportOptions,
  ProgressCallback,
} from './types'
export { ImportError, UnsupportedFileError } from './errors'
export { naturalCompare } from './naturalSort'

const DEFAULT_MAX_DIMENSION = 4096
const DEFAULT_VIDEO_FPS = 8
const DEFAULT_MAX_VIDEO_SECONDS = 10
const DEFAULT_MAX_VIDEO_FRAMES = 80
const DEFAULT_MAX_ANIMATION_FRAMES = 300

/** Enough for every signature we sniff, and for most JPEG headers (EXIF + frame size). */
const HEAD_BYTES = 128 * 1024
/** Covers the ZIP central directory of typical Office documents. */
const TAIL_BYTES = 64 * 1024 + 22

/** Value for `<input type="file" accept>` covering every importable type. */
export function acceptedTypes(): string {
  return [
    'image/*',
    '.heic',
    '.heif',
    '.avif',
    '.jxl',
    '.svg',
    'video/*',
    '.mp4',
    '.m4v',
    '.mov',
    '.webm',
    '.mkv',
    'application/pdf',
    '.pdf',
    'text/plain',
    '.txt',
    'text/markdown',
    '.md',
    '.markdown',
    'text/html',
    '.html',
    '.htm',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.docx',
    'application/rtf',
    'text/rtf',
    '.rtf',
    'text/csv',
    '.csv',
    'text/tab-separated-values',
    '.tsv',
    'application/json',
    '.json',
  ].join(',')
}

/**
 * Imports a single file. Resolves with one item per imported object (a single
 * item for every format supported today). Rejects with `ImportError` (message
 * suitable for display) or with the abort reason when `signal` aborts.
 */
export async function importFile(file: File, options: ImportOptions = {}): Promise<Imported[]> {
  options.signal?.throwIfAborted()
  options.onProgress?.(0, file.name)
  try {
    const items = await importOne(file, options, options.onProgress)
    options.onProgress?.(1, file.name)
    return items
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw error
    throw toImportError(error, file.name, "Couldn't import this file. It may be damaged.")
  }
}

/**
 * Imports several files (e.g. from a multi-select file picker), in natural
 * name order. See `ImportOptions.onFileError` for how failures are handled.
 */
export async function importFiles(files: Iterable<File> | ArrayLike<File>, options: ImportOptions = {}): Promise<Imported[]> {
  const sorted = naturalSortBy(Array.from(files), (file) => file.name)
  return importMany(
    sorted.map((file) => ({ file, fromFolder: false })),
    options,
  )
}

/**
 * Imports a paste. Call it synchronously from the `paste` handler with
 * `event.clipboardData` (the clipboard is only readable during the event).
 * Images win when the HTML carries no text (a copied picture); otherwise the
 * HTML is imported as rich text (copies from Word, web pages, spreadsheets),
 * then plain text, which becomes a table when it is tab-separated.
 */
export async function importClipboard(data: DataTransfer, options: ImportOptions = {}): Promise<Imported[]> {
  const snapshot = snapshotTransfer(data)
  const files: SourceFile[] = []
  for (const { file } of snapshot.items) if (file) files.push({ file, fromFolder: false })

  if (files.length > 0 && !htmlHasText(snapshot.html)) return importMany(files, options)
  const markup = importMarkup(snapshot)
  if (markup.length > 0) return markup
  return files.length > 0 ? importMany(files, options) : []
}

/**
 * Imports a drop. Call it synchronously from the `drop` handler with
 * `event.dataTransfer`. Dropped files keep their order; dropped folders are
 * walked recursively in natural name order, skipping hidden files. Drops that
 * carry no files (text or a selection dragged from another page) are imported
 * like a paste.
 */
export async function importDataTransfer(data: DataTransfer, options: ImportOptions = {}): Promise<Imported[]> {
  const snapshot = snapshotTransfer(data)
  if (snapshot.items.length === 0) return importMarkup(snapshot)
  const files = await collectFiles(snapshot, options.signal)
  if (files.length === 0) throw new ImportError('That folder has no files to import.')
  return importMany(files, options)
}

/** Releases what imported items hold: bitmaps and open PDF documents. */
export function disposeImported(items: readonly Imported[]): void {
  for (const item of items) {
    if (item.kind === 'image') item.bitmap.close()
    else if (item.kind === 'animation') for (const frame of item.frames) frame.bitmap.close()
    else if (item.kind === 'pages') void item.dispose()
  }
}

async function importMany(files: SourceFile[], options: ImportOptions): Promise<Imported[]> {
  const results: Imported[] = []
  const total = files.length
  try {
    for (let index = 0; index < total; index++) {
      options.signal?.throwIfAborted()
      const { file, fromFolder } = files[index]
      const label = total > 1 ? `${file.name} (${index + 1} of ${total})` : file.name
      options.onProgress?.(index / total, label)
      try {
        results.push(...(await importOne(file, options, subProgress(options.onProgress, index / total, (index + 1) / total, label))))
      } catch (error) {
        if (options.signal?.aborted || isAbortError(error)) throw error
        const failure = toImportError(error, file.name, "Couldn't import this file. It may be damaged.")
        if (options.onFileError) options.onFileError(failure)
        else if (!(fromFolder && failure instanceof UnsupportedFileError)) throw failure
      }
    }
  } catch (error) {
    // Don't leak what was imported before the failure.
    disposeImported(results)
    throw error
  }
  options.onProgress?.(1, total > 1 ? `Imported ${results.length} of ${total} files` : (files[0]?.file.name ?? ''))
  return results
}

async function importOne(file: File, options: ImportOptions, progress: ProgressCallback | undefined): Promise<Imported[]> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer())
  const tail =
    needsTail(head) && file.size > HEAD_BYTES
      ? new Uint8Array(await file.slice(file.size - TAIL_BYTES).arrayBuffer())
      : undefined
  const detection = detectKind({ head, tail, name: file.name, type: file.type })
  if (detection.kind === 'unsupported') {
    throw new UnsupportedFileError(detection.reason ?? "This file type isn't supported.", file.name)
  }
  if (file.size === 0) throw new ImportError('This file is empty.', file.name)
  options.signal?.throwIfAborted()
  return [await convert(file, detection, head, options, progress)]
}

async function convert(
  file: File,
  detection: Detection,
  head: Uint8Array,
  options: ImportOptions,
  progress: ProgressCallback | undefined,
): Promise<Imported> {
  const { signal } = options
  const maxDimension = positive(options.maxDimension, DEFAULT_MAX_DIMENSION)
  const name = file.name

  switch (detection.kind) {
    case 'jpeg':
    case 'png':
    case 'webp':
    case 'avif':
    case 'bmp':
    case 'ico':
    case 'tiff':
    case 'jxl':
    case 'image':
      progress?.(0.2, 'Decoding image')
      return importStillImage(file, detection, head, { maxDimension, signal, onProgress: progress })

    case 'gif':
    case 'apng':
    case 'webp-animated':
    case 'avif-sequence':
      return importAnimated(file, detection, head, {
        maxDimension,
        maxFrames: positive(options.maxAnimationFrames, DEFAULT_MAX_ANIMATION_FRAMES),
        signal,
        onProgress: progress,
      })

    case 'heic':
      progress?.(0.05, 'Decoding image')
      return importHeic(file, { maxDimension, signal, onProgress: progress })

    case 'svg':
      return importSvg(file, { maxDimension, signal, onProgress: progress })

    case 'video':
      progress?.(0, 'Opening video')
      return importVideo(file, {
        fps: positive(options.videoFps, DEFAULT_VIDEO_FPS),
        maxSeconds: positive(options.maxVideoSeconds, DEFAULT_MAX_VIDEO_SECONDS),
        maxFrames: Math.floor(positive(options.maxVideoFrames, DEFAULT_MAX_VIDEO_FRAMES)),
        maxDimension,
        signal,
        onProgress: progress,
      })

    case 'pdf': {
      progress?.(0, 'Loading PDF reader')
      const { importPdf } = await import('./pdf')
      return importPdf(file, { signal, onProgress: progress })
    }

    case 'docx': {
      progress?.(0.1, 'Loading Word reader')
      const [{ docxToHtml }, data] = await Promise.all([import('./docx'), file.arrayBuffer()])
      signal?.throwIfAborted()
      progress?.(0.4, 'Converting document')
      let html: string
      try {
        html = await docxToHtml(data)
      } catch (error) {
        throw new ImportError("Couldn't read this Word document. It may be damaged.", name, { cause: error })
      }
      signal?.throwIfAborted()
      return { kind: 'rich', name, html: sanitizeHtml(html) }
    }

    case 'markdown': {
      const [{ markdownToHtml }, text] = await Promise.all([import('./markdown'), readText(file)])
      signal?.throwIfAborted()
      return { kind: 'rich', name, html: sanitizeHtml(markdownToHtml(text)) }
    }

    case 'html':
      return { kind: 'rich', name, html: sanitizeHtml(await readText(file)) }

    case 'rtf':
      return { kind: 'rich', name, html: rtfToHtml(await readText(file)) }

    case 'csv':
    case 'tsv': {
      const rows = parseDelimited(await readText(file), detection.kind === 'tsv' ? '\t' : undefined)
      return { kind: 'table', name, rows }
    }

    case 'json':
    case 'text':
      return { kind: 'text', name, text: await readText(file) }

    case 'unsupported':
      throw new UnsupportedFileError(detection.reason ?? "This file type isn't supported.", name)
  }
}

async function readText(file: File): Promise<string> {
  return decodeText(new Uint8Array(await file.arrayBuffer()))
}

function importMarkup(snapshot: TransferSnapshot): Imported[] {
  if (snapshot.html.trim() !== '') {
    const html = sanitizeHtml(snapshot.html)
    if (html !== '') return [{ kind: 'rich', name: 'Pasted text', html }]
  }
  const text = normalizeNewlines(snapshot.text)
  if (text.trim() === '') return []
  const rows = tabularRows(text)
  return rows ? [{ kind: 'table', name: 'Pasted table', rows }] : [{ kind: 'text', name: 'Pasted text', text }]
}

/** Spreadsheet selections are copied as plain text with one tab-separated row per line. */
function tabularRows(text: string): string[][] | null {
  const rows = parseDelimited(text, '\t')
  if (rows.length < 2 || rows[0].length < 2) return null
  const columnsPerLine = text.replace(/\n+$/, '').split('\n').map((line) => line.split('\t').length)
  return columnsPerLine.every((count) => count === columnsPerLine[0]) ? rows : null
}

function htmlHasText(html: string): boolean {
  if (html.trim() === '') return false
  const body = new DOMParser().parseFromString(html, 'text/html').body
  return (body?.textContent ?? '').trim() !== ''
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}
