import { hasTransparency } from './canvas'
import { ImportError } from './errors'
import { decodeImageBlob } from './image'
import { animationFrameSize, normalizeDelay, readImageInfo } from './imageInfo'
import type { Detection } from './sniff'
import type { AnimationFrame, ImportedAnimation, ImportedImage, ProgressCallback } from './types'

export interface AnimationOptions {
  maxDimension: number
  maxFrames: number
  signal?: AbortSignal
  onProgress?: ProgressCallback
}

export interface DecodedAnimation {
  frames: AnimationFrame[]
  width: number
  height: number
  loops: number
}

/** Frames are held as bitmaps; beyond this many pixels in total they get smaller. */
export const ANIMATION_PIXEL_BUDGET = 100_000_000

/**
 * Imports a GIF, animated WebP, APNG or AVIF sequence. Uses WebCodecs'
 * ImageDecoder where available (composited frames and exact timing), falls
 * back to a JavaScript GIF decoder, and for other formats to the first frame.
 * A single-frame result is returned as a still image.
 */
export async function importAnimated(
  file: File,
  detection: Detection,
  head: Uint8Array,
  options: AnimationOptions,
): Promise<ImportedAnimation | ImportedImage> {
  const data = await file.arrayBuffer()
  options.signal?.throwIfAborted()

  let decoded: DecodedAnimation | null = null
  let failure: unknown = null
  try {
    decoded = await decodeWithImageDecoder(data, detection.mime, options)
  } catch (error) {
    if (options.signal?.aborted) throw error
    failure = error
  }

  if (!decoded && detection.kind === 'gif') {
    try {
      const { decodeGif } = await import('./gif')
      decoded = await decodeGif(data, options)
    } catch (error) {
      if (options.signal?.aborted) throw error
      failure = error
    }
  }

  if (!decoded) {
    // No animation decoder for this format: fall back to the still image.
    try {
      const bitmap = await decodeImageBlob(file, readImageInfo(head), options.maxDimension)
      return still(file, bitmap)
    } catch (error) {
      if (options.signal?.aborted) throw error
      throw new ImportError(
        "Couldn't read this image. The file may be damaged or in a format your browser can't open.",
        file.name,
        { cause: failure ?? error },
      )
    }
  }

  if (decoded.frames.length === 1) return still(file, decoded.frames[0].bitmap)
  return {
    kind: 'animation',
    name: file.name,
    frames: decoded.frames,
    width: decoded.width,
    height: decoded.height,
    loops: decoded.loops,
    source: file,
  }
}

async function still(file: File, bitmap: ImageBitmap): Promise<ImportedImage> {
  return {
    kind: 'image',
    name: file.name,
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    hasAlpha: await hasTransparency(bitmap),
    source: file,
  }
}

/** Returns null when WebCodecs' ImageDecoder is unavailable or can't handle `mime`. */
export async function decodeWithImageDecoder(
  data: ArrayBuffer,
  mime: string,
  options: AnimationOptions,
): Promise<DecodedAnimation | null> {
  if (typeof ImageDecoder === 'undefined') return null
  try {
    if (!(await ImageDecoder.isTypeSupported(mime))) return null
  } catch {
    return null
  }

  const decoder = new ImageDecoder({ data, type: mime, preferAnimation: true })
  const frames: AnimationFrame[] = []
  const abort = () => decoder.close()
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    await decoder.tracks.ready
    await decoder.completed
    const track = decoder.tracks.selectedTrack
    if (!track) return null
    const frameCount = Math.min(track.frameCount, options.maxFrames)
    const loops = Number.isFinite(track.repetitionCount) ? track.repetitionCount + 1 : 0

    let size: ReturnType<typeof animationFrameSize> | null = null
    for (let index = 0; index < frameCount; index++) {
      options.signal?.throwIfAborted()
      const { image } = await decoder.decode({ frameIndex: index, completeFramesOnly: true })
      try {
        size ??= animationFrameSize(image.displayWidth, image.displayHeight, frameCount, options.maxDimension, ANIMATION_PIXEL_BUDGET)
        const bitmap = await createImageBitmap(
          image,
          size.scaled ? { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' } : {},
        )
        // VideoFrame durations are in microseconds.
        frames.push({ bitmap, delayMs: normalizeDelay((image.duration ?? 0) / 1000) })
      } finally {
        image.close()
      }
      options.onProgress?.((index + 1) / frameCount, `Decoding frame ${index + 1} of ${frameCount}`)
    }
    if (!size || frames.length === 0) return null
    return { frames, width: frames[0].bitmap.width, height: frames[0].bitmap.height, loops }
  } catch (error) {
    for (const frame of frames) frame.bitmap.close()
    options.signal?.throwIfAborted()
    throw error
  } finally {
    options.signal?.removeEventListener('abort', abort)
    decoder.close()
  }
}
