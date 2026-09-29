import {
  GlobalWorkerOptions,
  PasswordException,
  PDFWorker,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { context2d, createCanvas, canvasToBitmap } from './canvas'
import { ImportError } from './errors'
import { assemblePageText } from './pdfText'
import type { ImportedPages, ProgressCallback } from './types'

GlobalWorkerOptions.workerSrc = workerUrl

/**
 * pdf.js loads a few binary resources on demand: CMaps for CJK text, the two
 * non-embeddable standard fonts, and WebAssembly decoders for JBIG2/CCITT
 * (typical of scanned documents) and JPEG 2000 images. Vite emits them as
 * hashed assets, so they're mapped by file name instead of by directory URL.
 */
const RESOURCE_URLS: Record<'cMapUrl' | 'standardFontDataUrl' | 'wasmUrl', Record<string, string>> = {
  cMapUrl: byFileName(
    import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap', {
      eager: true,
      import: 'default',
      query: '?url&no-inline',
      exhaustive: true,
    }),
  ),
  standardFontDataUrl: byFileName(
    import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/{FoxitSymbol,FoxitDingbats}.pfb', {
      eager: true,
      import: 'default',
      query: '?url&no-inline',
      exhaustive: true,
    }),
  ),
  wasmUrl: byFileName(
    import.meta.glob('/node_modules/pdfjs-dist/wasm/{jbig2,openjpeg}.wasm', {
      eager: true,
      import: 'default',
      query: '?url&no-inline',
      exhaustive: true,
    }),
  ),
}

function byFileName(modules: Record<string, unknown>): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [path, url] of Object.entries(modules)) map[path.slice(path.lastIndexOf('/') + 1)] = url as string
  return map
}

/** Serves pdf.js's binary-resource requests (see RESOURCE_URLS). */
class BundledBinaryDataFactory {
  async fetch({ kind, filename }: { kind: keyof typeof RESOURCE_URLS; filename: string }): Promise<Uint8Array> {
    const url = RESOURCE_URLS[kind]?.[filename]
    if (!url) throw new Error(`pdf.js resource not bundled: ${kind}/${filename}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

/** One pdf.js worker shared by every open document. */
let sharedWorker: PDFWorker | null = null

function worker(): PDFWorker {
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new PDFWorker()
  return sharedWorker
}

export interface PdfOptions {
  signal?: AbortSignal
  onProgress?: ProgressCallback
}

/** Browsers cap canvas dimensions (Safari at 16384 px per side and ~268 MP). */
const MAX_CANVAS_SIDE = 16384
const MAX_CANVAS_PIXELS = 16384 * 16384 * 0.25

/** Opens a PDF and returns lazy page accessors. The document stays open until `dispose()`. */
export async function importPdf(file: File, options: PdfOptions): Promise<ImportedPages> {
  const data = new Uint8Array(await file.arrayBuffer())
  options.signal?.throwIfAborted()

  const task = getDocument({
    data,
    worker: worker(),
    BinaryDataFactory: BundledBinaryDataFactory,
    useWorkerFetch: false,
    enableXfa: false,
  })
  task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
    if (total > 0) options.onProgress?.(Math.min(1, loaded / total), 'Opening PDF')
  }
  const abort = () => void task.destroy()
  options.signal?.addEventListener('abort', abort, { once: true })

  let doc: PDFDocumentProxy
  try {
    doc = await task.promise
  } catch (error) {
    options.signal?.throwIfAborted()
    if (error instanceof PasswordException) {
      throw new ImportError('This PDF is password-protected. Remove the password and try again.', file.name, { cause: error })
    }
    throw new ImportError("Couldn't open this PDF. The file may be damaged.", file.name, { cause: error })
  } finally {
    options.signal?.removeEventListener('abort', abort)
  }

  let disposed = false
  const page = async (index: number): Promise<PDFPageProxy> => {
    if (disposed) throw new ImportError('This PDF has been closed.', file.name)
    if (!Number.isInteger(index) || index < 0 || index >= doc.numPages) {
      throw new RangeError(`Page index ${index} is out of range (0-${doc.numPages - 1})`)
    }
    return doc.getPage(index + 1)
  }

  return {
    kind: 'pages',
    name: file.name,
    pageCount: doc.numPages,
    source: file,

    async renderPage(index, targetWidth) {
      if (!(targetWidth > 0) || !Number.isFinite(targetWidth)) {
        throw new RangeError(`targetWidth must be a positive number, got ${targetWidth}`)
      }
      const pdfPage = await page(index)
      const base = pdfPage.getViewport({ scale: 1 })
      let width = Math.max(1, Math.round(targetWidth))
      let height = Math.max(1, Math.round((width * base.height) / base.width))
      // Clamp to what a canvas can hold, preserving the aspect ratio.
      const shrink = Math.min(1, MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)))
      if (shrink < 1) {
        width = Math.max(1, Math.floor(width * shrink))
        height = Math.max(1, Math.floor(height * shrink))
      }
      const viewport = pdfPage.getViewport({ scale: width / base.width })
      const canvas = createCanvas(width, height)
      const context = context2d(canvas, { alpha: false })
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      await pdfPage.render({
        // pdf.js only needs getContext('2d') from the canvas, which
        // OffscreenCanvas provides; its typings name HTMLCanvasElement only.
        canvas: canvas as HTMLCanvasElement,
        viewport,
        background: '#ffffff',
        // The "display" intent paces rendering with requestAnimationFrame,
        // which stalls in background tabs. "print" renders straight through
        // (and shows printable annotations such as filled-in form fields).
        intent: 'print',
      }).promise
      pdfPage.cleanup()
      return canvasToBitmap(canvas)
    },

    async pageText(index) {
      const pdfPage = await page(index)
      const content = await pdfPage.getTextContent()
      return assemblePageText(content.items.filter((item) => 'str' in item))
    },

    async pageSize(index) {
      const viewport = (await page(index)).getViewport({ scale: 1 })
      return { width: viewport.width, height: viewport.height }
    },

    async dispose() {
      if (disposed) return
      disposed = true
      // Destroying the loading task tears down the document; the shared worker stays up.
      await task.destroy()
    },
  }
}
