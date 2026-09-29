import type { ImportError } from './errors'

export interface ImportedImage {
  kind: 'image'
  name: string
  bitmap: ImageBitmap
  width: number
  height: number
  /** Whether any pixel is (even partially) transparent. */
  hasAlpha: boolean
  source: Blob
}

export interface AnimationFrame {
  bitmap: ImageBitmap
  delayMs: number
}

export interface ImportedAnimation {
  kind: 'animation'
  name: string
  frames: AnimationFrame[]
  width: number
  height: number
  /** How many times the animation plays; 0 means it loops forever. */
  loops: number
  source: Blob
}

export interface ImportedPages {
  kind: 'pages'
  name: string
  pageCount: number
  /** Renders page `index` (0-based) `targetWidth` pixels wide on a white background. */
  renderPage(index: number, targetWidth: number): Promise<ImageBitmap>
  /** Extracts the text of page `index` (0-based), one line per text line. */
  pageText(index: number): Promise<string>
  /** Page size in PDF points (1/72 in), with the page rotation applied. */
  pageSize(index: number): Promise<{ width: number; height: number }>
  /** Releases the parsed document. Other methods reject afterwards. */
  dispose(): Promise<void>
  source: Blob
}

export interface ImportedRich {
  kind: 'rich'
  name: string
  /**
   * Sanitized HTML limited to: p, h1-h3, strong, em, u, s, code, pre,
   * blockquote, ul, ol, li, table, thead, tbody, tr, th, td, img (data:/blob:
   * sources only), br, hr, a (http, https, mailto, tel), and span. Only span,
   * td and th carry `style`, restricted to `color` and `background-color`.
   */
  html: string
}

export interface ImportedText {
  kind: 'text'
  name: string
  text: string
}

export interface ImportedTable {
  kind: 'table'
  name: string
  /** Rectangular: every row has the same number of cells. */
  rows: string[][]
}

export type Imported =
  | ImportedImage
  | ImportedAnimation
  | ImportedPages
  | ImportedRich
  | ImportedText
  | ImportedTable

export type ProgressCallback = (fraction: number, label: string) => void

export interface ImportOptions {
  /** Upper bound on frames sampled from a video. Default 80. */
  maxVideoFrames?: number
  /** Video sampling rate in frames per second. Default 8. */
  videoFps?: number
  /** Only the first this-many seconds of a video are sampled. Default 10. */
  maxVideoSeconds?: number
  /** Images and animation frames are downscaled to fit this many pixels on their longest side. Default 4096. */
  maxDimension?: number
  /** Upper bound on frames kept from an animated GIF, WebP, PNG or AVIF. Default 300. */
  maxAnimationFrames?: number
  /** Receives overall progress in [0, 1] with a short human-readable label. */
  onProgress?: ProgressCallback
  /**
   * Multi-file imports only. When provided, a file that fails is reported here
   * and skipped while the rest continue; when omitted, the first failure
   * rejects the whole import. Unsupported files found inside dropped folders
   * are always skipped (and reported here when a handler is given).
   */
  onFileError?: (error: ImportError) => void
  signal?: AbortSignal
}
