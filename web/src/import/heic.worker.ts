/**
 * Decodes HEIC/HEIF images with libheif (LGPL, compiled to WebAssembly) off
 * the main thread. Kept in its own worker bundle so the library is only
 * downloaded when a browser can't decode HEIC natively.
 */
import createLibheif, { type LibHeif } from 'libheif-js/libheif-wasm/libheif-bundle.mjs'

export interface HeicRequest {
  id: number
  data: ArrayBuffer
  maxDimension: number
}

export type HeicResponse =
  | { id: number; ok: true; bitmap: ImageBitmap; width: number; height: number; hasAlpha: boolean }
  | { id: number; ok: false; message: string }

let library: Promise<LibHeif> | null = null

function loadLibrary(): Promise<LibHeif> {
  library ??= new Promise<LibHeif>((resolve) => {
    const lib = createLibheif()
    // The bundled build instantiates synchronously, but don't depend on it.
    if (lib.calledRun) resolve(lib)
    else lib.onRuntimeInitialized = () => resolve(lib)
  })
  return library
}

async function decode({ data, maxDimension }: HeicRequest) {
  const lib = await loadLibrary()
  const decoder = new lib.HeifDecoder()
  const images = decoder.decode(new Uint8Array(data))
  try {
    if (images.length === 0) throw new Error('No image found in HEIF file')
    // Burst and multi-image files: import only the primary image.
    const image = images.find((candidate) => candidate.is_primary()) ?? images[0]
    const width = image.get_width()
    const height = image.get_height()
    const pixels = new ImageData(width, height)
    await new Promise<void>((resolve, reject) => {
      image.display(pixels, (result) => (result ? resolve() : reject(new Error('HEIF decoding failed'))))
    })

    const longest = Math.max(width, height)
    const scale = longest > maxDimension ? maxDimension / longest : 1
    const bitmap =
      scale < 1
        ? await createImageBitmap(pixels, {
            resizeWidth: Math.max(1, Math.round(width * scale)),
            resizeHeight: Math.max(1, Math.round(height * scale)),
            resizeQuality: 'high',
          })
        : await createImageBitmap(pixels)
    return { bitmap, width: bitmap.width, height: bitmap.height, hasAlpha: image.has_alpha_channel() }
  } finally {
    for (const image of images) image.free()
    if (decoder.decoder) lib.heif_context_free(decoder.decoder)
  }
}

/** Requests being decoded; the pool sends one at a time, but be general. */
const pending = new Set<number>()

function fail(id: number, error: unknown) {
  if (!pending.delete(id)) return
  const response: HeicResponse = { id, ok: false, message: error instanceof Error ? error.message : String(error) }
  self.postMessage(response)
}

self.addEventListener('message', (event: MessageEvent<HeicRequest>) => {
  const request = event.data
  pending.add(request.id)
  decode(request).then(
    (result) => {
      if (!pending.delete(request.id)) return
      const response: HeicResponse = { id: request.id, ok: true, ...result }
      self.postMessage(response, { transfer: [result.bitmap] })
    },
    (error: unknown) => fail(request.id, error),
  )
})

// libheif decodes inside a timer callback, so a failure there surfaces as an
// unhandled rejection rather than through the display() callback.
self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  event.preventDefault()
  for (const id of [...pending]) fail(id, event.reason)
})
