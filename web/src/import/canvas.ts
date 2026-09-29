import { ImportError } from './errors'
import { fitWithin } from './imageInfo'

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement
export type Any2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/** An OffscreenCanvas where available, else a detached <canvas>. */
export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export function context2d(canvas: AnyCanvas, settings?: CanvasRenderingContext2DSettings): Any2D {
  const context =
    typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas
      ? canvas.getContext('2d', settings)
      : (canvas as HTMLCanvasElement).getContext('2d', settings)
  if (!context) throw new ImportError('Your browser ran out of memory for images. Try a smaller file.')
  return context
}

/** Snapshots the canvas into an ImageBitmap (zero-copy for OffscreenCanvas). */
export async function canvasToBitmap(canvas: AnyCanvas): Promise<ImageBitmap> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.transferToImageBitmap()
  }
  return createImageBitmap(canvas)
}

/**
 * Resizes a bitmap to exactly (width, height) with high-quality filtering.
 * Browsers that ignore createImageBitmap's resize options get a canvas-based
 * fallback that halves repeatedly, which avoids the aliasing of a single
 * large bilinear step.
 */
export async function resizeBitmap(source: ImageBitmap, width: number, height: number): Promise<ImageBitmap> {
  try {
    const resized = await createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
    if (resized.width === width && resized.height === height) return resized
    resized.close()
  } catch {
    // Fall through to the canvas path.
  }

  let current: CanvasImageSource = source
  let currentWidth = source.width
  let currentHeight = source.height
  while (currentWidth / 2 >= width && currentHeight / 2 >= height) {
    const stepWidth = Math.round(currentWidth / 2)
    const stepHeight = Math.round(currentHeight / 2)
    const step = createCanvas(stepWidth, stepHeight)
    const ctx = context2d(step)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(current, 0, 0, stepWidth, stepHeight)
    current = step
    currentWidth = stepWidth
    currentHeight = stepHeight
  }
  const target = createCanvas(width, height)
  const ctx = context2d(target)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(current, 0, 0, width, height)
  return canvasToBitmap(target)
}

/** Returns `bitmap` downscaled to fit `maxDimension`, closing the original when replaced. */
export async function fitBitmap(bitmap: ImageBitmap, maxDimension: number): Promise<ImageBitmap> {
  const target = fitWithin(bitmap.width, bitmap.height, maxDimension)
  if (!target.scaled) return bitmap
  try {
    return await resizeBitmap(bitmap, target.width, target.height)
  } finally {
    bitmap.close()
  }
}

/**
 * Whether any pixel is not fully opaque. Checked on a small copy: the
 * mipmapped downscale averages neighborhoods, so transparent regions still
 * pull the sampled alpha below 255.
 */
export async function hasTransparency(bitmap: ImageBitmap | ImageData | AnyCanvas): Promise<boolean> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, 256)
  let small: ImageBitmap | null = null
  try {
    small = await createImageBitmap(bitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' })
  } catch {
    small = null
  }
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas, { willReadFrequently: true })
  if (small) {
    ctx.drawImage(small, 0, 0, width, height)
    small.close()
  } else if (bitmap instanceof ImageData) {
    return scanAlpha(bitmap.data)
  } else {
    ctx.drawImage(bitmap, 0, 0, width, height)
  }
  return scanAlpha(ctx.getImageData(0, 0, width, height).data)
}

function scanAlpha(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true
  }
  return false
}
