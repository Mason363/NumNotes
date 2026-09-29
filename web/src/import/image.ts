import { canvasToBitmap, context2d, createCanvas, fitBitmap, hasTransparency } from './canvas'
import { ImportError, raceAbort } from './errors'
import { fitWithin, orientedSize, readImageInfo, type ImageInfo } from './imageInfo'
import type { Detection } from './sniff'
import { decodeText } from './text'
import type { ImportedImage, ProgressCallback } from './types'

export interface StillImageOptions {
  maxDimension: number
  signal?: AbortSignal
  onProgress?: ProgressCallback
}

/** Longest side SVGs are rasterized at (capped by `maxDimension`). */
const SVG_RASTER_SIZE = 2048

/** Decodes a still raster image (JPEG, PNG, WebP, AVIF, BMP, ICO, TIFF, JPEG XL...). */
export async function importStillImage(
  file: File,
  detection: Detection,
  head: Uint8Array,
  options: StillImageOptions,
): Promise<ImportedImage> {
  const info = readImageInfo(head)
  let bitmap: ImageBitmap
  try {
    bitmap = await raceAbort(decodeImageBlob(file, info, options.maxDimension), options.signal)
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ImportError(unsupportedImageMessage(detection), file.name, { cause: error })
  }
  const hasAlpha = info?.alpha === 'no' || detection.kind === 'jpeg' ? false : await hasTransparency(bitmap)
  return { kind: 'image', name: file.name, bitmap, width: bitmap.width, height: bitmap.height, hasAlpha, source: file }
}

function unsupportedImageMessage(detection: Detection): string {
  switch (detection.kind) {
    case 'tiff':
      return "TIFF images aren't supported by this browser. Try Safari, or convert the image to PNG or JPEG."
    case 'jxl':
      return "JPEG XL images aren't supported by this browser. Try Safari, or convert the image to PNG or JPEG."
    case 'avif':
    case 'avif-sequence':
      return "AVIF images aren't supported by this browser. Update your browser, or convert the image to PNG or JPEG."
    default:
      return "Couldn't read this image. The file may be damaged or in a format your browser can't open."
  }
}

/**
 * Decodes with the browser's codecs, honoring EXIF orientation, downscaled to
 * fit `maxDimension`. When the header told us the size, the downscale happens
 * during decoding, which avoids materializing huge photos at full size.
 */
export async function decodeImageBlob(blob: Blob, info: ImageInfo | null, maxDimension: number): Promise<ImageBitmap> {
  const oriented: ImageBitmapOptions = { imageOrientation: 'from-image' }
  if (info) {
    const shown = orientedSize(info)
    const target = fitWithin(shown.width, shown.height, maxDimension)
    if (target.scaled) {
      try {
        const bitmap = await createImageBitmap(blob, {
          ...oriented,
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'high',
        })
        // Browsers disagree on whether resizing happens before or after the
        // orientation is applied; a swapped result means "before", so the
        // image was distorted. Decode at full size and resize afterwards.
        if (bitmap.width === target.width && bitmap.height === target.height) return bitmap
        bitmap.close()
      } catch {
        // Retry without resize options below.
      }
    }
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, oriented)
  } catch (error) {
    // A few formats (ICO, JPEG 2000 in some browsers) decode through <img>
    // even where createImageBitmap refuses the blob.
    try {
      bitmap = await decodeViaImageElement(blob)
    } catch {
      throw error
    }
  }
  return fitBitmap(bitmap, maxDimension)
}

async function decodeViaImageElement(blob: Blob): Promise<ImageBitmap> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return await createImageBitmap(image)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * HEIC/HEIF (iPhone photos). Safari decodes these natively; elsewhere the
 * primary image is decoded by libheif in a lazily loaded worker.
 */
export async function importHeic(file: File, options: StillImageOptions): Promise<ImportedImage> {
  let bitmap: ImageBitmap | null = null
  let alphaChannel: boolean | undefined
  try {
    bitmap = await raceAbort(
      createImageBitmap(file, { imageOrientation: 'from-image' }).then((b) => fitBitmap(b, options.maxDimension)),
      options.signal,
    )
  } catch (error) {
    if (options.signal?.aborted) throw error
  }

  if (!bitmap) {
    options.onProgress?.(0.1, 'Loading HEIC decoder')
    try {
      const { decodeHeic } = await import('./heic')
      const data = await file.arrayBuffer()
      options.onProgress?.(0.3, 'Decoding HEIC')
      const decoded = await decodeHeic(data, options.maxDimension, options.signal)
      bitmap = decoded.bitmap
      alphaChannel = decoded.hasAlpha
    } catch (error) {
      if (options.signal?.aborted) throw error
      throw new ImportError("Couldn't read this HEIC photo. The file may be damaged.", file.name, { cause: error })
    }
  }

  const hasAlpha = alphaChannel === false ? false : await hasTransparency(bitmap)
  return { kind: 'image', name: file.name, bitmap, width: bitmap.width, height: bitmap.height, hasAlpha, source: file }
}

/**
 * Rasterizes an SVG at SVG_RASTER_SIZE on its longest side (preserving the
 * aspect ratio). The SVG is rendered through an <img>, where scripts and
 * external resources are disabled.
 */
export async function importSvg(file: File, options: StillImageOptions): Promise<ImportedImage> {
  const text = decodeText(new Uint8Array(await file.arrayBuffer()))
  const prepared = prepareSvg(text, Math.min(SVG_RASTER_SIZE, options.maxDimension))
  if (!prepared) throw new ImportError("Couldn't read this SVG image. The file may be damaged.", file.name)

  const url = URL.createObjectURL(new Blob([prepared.markup], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = url
    await raceAbort(image.decode(), options.signal)
    const canvas = createCanvas(prepared.width, prepared.height)
    context2d(canvas).drawImage(image, 0, 0, prepared.width, prepared.height)
    const bitmap = await canvasToBitmap(canvas)
    const hasAlpha = await hasTransparency(bitmap)
    return { kind: 'image', name: file.name, bitmap, width: bitmap.width, height: bitmap.height, hasAlpha, source: file }
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new ImportError("Couldn't render this SVG image.", file.name, { cause: error })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Rewrites the root <svg> to render at a fixed raster size: explicit width
 * and height, and a viewBox so the drawing scales with them.
 */
function prepareSvg(text: string, longest: number): { markup: string; width: number; height: number } | null {
  let svg: Element | null = null
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (xml.documentElement?.localName === 'svg' && xml.getElementsByTagName('parsererror').length === 0) {
    svg = xml.documentElement
  } else {
    // Not well-formed XML (HTML entities, unquoted attributes...): the HTML
    // parser is forgiving and still produces an SVG element.
    svg = new DOMParser().parseFromString(text, 'text/html').querySelector('svg')
  }
  if (!svg) return null

  const widthAttr = parseSvgLength(svg.getAttribute('width'))
  const heightAttr = parseSvgLength(svg.getAttribute('height'))
  const viewBox = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const hasViewBox = viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0

  let aspect: number
  if (widthAttr && heightAttr) aspect = widthAttr / heightAttr
  else if (hasViewBox) aspect = viewBox[2] / viewBox[3]
  else aspect = 2 // the default replaced-element size, 300x150

  if (!hasViewBox) {
    const w = widthAttr ?? (heightAttr ? heightAttr * aspect : 300)
    const h = heightAttr ?? (widthAttr ? widthAttr / aspect : 150)
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  }
  const width = aspect >= 1 ? longest : Math.max(1, Math.round(longest * aspect))
  const height = aspect >= 1 ? Math.max(1, Math.round(longest / aspect)) : longest
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return { markup: new XMLSerializer().serializeToString(svg), width, height }
}

const LENGTH_UNITS: Record<string, number> = { '': 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 }

function parseSvgLength(value: string | null): number | null {
  if (!value) return null
  const match = /^\s*([+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|ex)?\s*$/i.exec(value)
  if (!match) return null // percentages and junk
  const length = parseFloat(match[1]) * LENGTH_UNITS[(match[2] ?? '').toLowerCase()]
  return length > 0 && Number.isFinite(length) ? length : null
}
