import { decompressFrame, parseGIF, type ParsedGif } from 'gifuct-js'
import { ANIMATION_PIXEL_BUDGET, type AnimationOptions, type DecodedAnimation } from './animation'
import { GifCompositor, type GifFrame } from './gifCompose'
import { animationFrameSize, gifLoopsToPlays, normalizeDelay, readGifLoopCount } from './imageInfo'
import type { AnimationFrame } from './types'

type ParsedFrame = Extract<ParsedGif['frames'][number], { image: unknown }>

/** A macrotask break that, unlike setTimeout, isn't throttled in background tabs. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

/** Decodes and composites a GIF in JavaScript (used when ImageDecoder is unavailable). */
export async function decodeGif(data: ArrayBuffer, options: AnimationOptions): Promise<DecodedAnimation> {
  const gif = parseGIF(data)
  const { width, height } = gif.lsd
  if (!width || !height) throw new Error('GIF has no logical screen size')

  const imageFrames = gif.frames.filter((frame): frame is ParsedFrame => 'image' in frame)
  const frameCount = Math.min(imageFrames.length, options.maxFrames)
  if (frameCount === 0) throw new Error('GIF contains no frames')

  const size = animationFrameSize(width, height, frameCount, options.maxDimension, ANIMATION_PIXEL_BUDGET)
  const compositor = new GifCompositor(width, height)
  const frames: AnimationFrame[] = []
  try {
    for (let index = 0; index < frameCount; index++) {
      options.signal?.throwIfAborted()
      const frame = decompressFrame(imageFrames[index], gif.gct, false) as GifFrame & { delay?: number }
      const pixels = compositor.render(frame)
      const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height)
      const bitmap = await createImageBitmap(
        imageData,
        size.scaled ? { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' } : {},
      )
      frames.push({ bitmap, delayMs: normalizeDelay(frame.delay ?? 0) })
      options.onProgress?.((index + 1) / frameCount, `Decoding frame ${index + 1} of ${frameCount}`)
      // Keep the page responsive while decoding long animations.
      if (index % 8 === 7) await yieldToEventLoop()
    }
  } catch (error) {
    for (const frame of frames) frame.bitmap.close()
    throw error
  }

  return {
    frames,
    width: frames[0].bitmap.width,
    height: frames[0].bitmap.height,
    loops: gifLoopsToPlays(readGifLoopCount(new Uint8Array(data))),
  }
}
