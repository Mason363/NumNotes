import { canvasToBitmap, context2d, createCanvas } from './canvas'
import { ImportError } from './errors'
import { fitWithin } from './imageInfo'
import type { AnimationFrame, ImportedAnimation, ProgressCallback } from './types'

export interface VideoOptions {
  fps: number
  maxSeconds: number
  maxFrames: number
  maxDimension: number
  signal?: AbortSignal
  onProgress?: ProgressCallback
}

/** Video frames are downscaled to fit this many pixels on their longest side. */
export const VIDEO_MAX_SIDE = 640

const UNSUPPORTED_VIDEO = "This video format can't be played in this browser. Try Safari, or convert it to MP4."
const HAVE_CURRENT_DATA = 2
const EVENT_TIMEOUT_MS = 20_000

/**
 * Samples a video into animation frames by seeking a muted, inline
 * <video> element to evenly spaced times and drawing each frame.
 */
export async function importVideo(file: File, options: VideoOptions): Promise<ImportedAnimation> {
  const video = document.createElement('video')
  video.muted = true
  video.defaultMuted = true
  video.playsInline = true
  video.preload = 'auto'
  const url = URL.createObjectURL(file)
  const frames: AnimationFrame[] = []

  try {
    const metadata = waitForEvent(video, 'loadedmetadata', options.signal)
    video.src = url
    await metadata
    // Audio-only files, or video tracks the browser can't decode (typically
    // HEVC outside Safari), report no picture size.
    if (!video.videoWidth || !video.videoHeight) throw new ImportError(UNSUPPORTED_VIDEO, file.name)

    const duration = await resolveDuration(video, options)
    await ensureCurrentFrame(video, options.signal)

    const fps = Math.min(60, Math.max(0.5, options.fps))
    const span = Math.min(duration, options.maxSeconds)
    const count = Math.max(1, Math.min(options.maxFrames, Math.floor(span * fps + 1e-6)))
    const size = fitWithin(video.videoWidth, video.videoHeight, Math.min(VIDEO_MAX_SIDE, options.maxDimension))
    const canvas = createCanvas(size.width, size.height)
    const context = context2d(canvas, { alpha: false })
    context.imageSmoothingQuality = 'high'
    const delayMs = Math.round(1000 / fps)

    for (let index = 0; index < count; index++) {
      options.signal?.throwIfAborted()
      // Never seek to the very end, where some browsers have no frame to show.
      const time = Math.min(index / fps, Math.max(0, duration - 0.05))
      await seek(video, time, options.signal)
      context.drawImage(video, 0, 0, size.width, size.height)
      frames.push({ bitmap: await canvasToBitmap(canvas), delayMs })
      options.onProgress?.((index + 1) / count, `Extracting frame ${index + 1} of ${count}`)
    }

    return { kind: 'animation', name: file.name, frames, width: size.width, height: size.height, loops: 0, source: file }
  } catch (error) {
    for (const frame of frames) frame.bitmap.close()
    if (options.signal?.aborted || error instanceof ImportError) throw error
    throw new ImportError(UNSUPPORTED_VIDEO, file.name, { cause: error })
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

/**
 * Some files (notably MediaRecorder WebM) don't declare a duration; seeking
 * far past the end makes the browser work it out.
 */
async function resolveDuration(video: HTMLVideoElement, options: VideoOptions): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration
  try {
    const settled = waitForEvent(video, 'seeked', options.signal, 5_000)
    video.currentTime = 1e9
    await settled
  } catch (error) {
    if (options.signal?.aborted) throw error
  }
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : options.maxSeconds
  return duration
}

async function ensureCurrentFrame(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  if (video.readyState >= HAVE_CURRENT_DATA) return
  const loaded = waitForEvent(video, 'loadeddata', signal)
  // iOS Safari doesn't fetch media data until playback has been requested.
  video.play().then(
    () => video.pause(),
    () => undefined,
  )
  await loaded
}

/**
 * Always performs a real seek, even to the current time: right after loading,
 * hardware decoders (HEVC in particular) may report a current frame that
 * hasn't been decoded yet and draws as black.
 */
async function seek(video: HTMLVideoElement, time: number, signal?: AbortSignal): Promise<void> {
  const seeked = waitForEvent(video, 'seeked', signal)
  video.currentTime = time
  await seeked
}

/** Resolves on `type`; rejects on a media error, abort, or timeout. */
function waitForEvent(
  video: HTMLVideoElement,
  type: 'loadedmetadata' | 'loadeddata' | 'seeked',
  signal?: AbortSignal,
  timeoutMs = EVENT_TIMEOUT_MS,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener(type, onEvent)
      video.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const onEvent = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(`Media error ${video.error?.code ?? '?'}: ${video.error?.message ?? ''}`))
    }
    const onAbort = () => {
      cleanup()
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for "${type}"`))
    }, timeoutMs)
    video.addEventListener(type, onEvent, { once: true })
    video.addEventListener('error', onError, { once: true })
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
