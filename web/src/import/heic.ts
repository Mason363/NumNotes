import type { HeicRequest, HeicResponse } from './heic.worker'

export interface DecodedHeic {
  bitmap: ImageBitmap
  width: number
  height: number
  hasAlpha: boolean
}

/** Idle decoder workers are kept briefly so a batch of photos compiles the wasm once. */
const IDLE_TIMEOUT_MS = 30_000
const idleWorkers: Worker[] = []
let idleTimer: ReturnType<typeof setTimeout> | undefined
let nextRequestId = 1

function acquireWorker(): Worker {
  clearTimeout(idleTimer)
  return (
    idleWorkers.pop() ??
    new Worker(new URL('./heic.worker.ts', import.meta.url), { type: 'module', name: 'heic-decoder' })
  )
}

function releaseWorker(worker: Worker): void {
  idleWorkers.push(worker)
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    for (const idle of idleWorkers.splice(0)) idle.terminate()
  }, IDLE_TIMEOUT_MS)
}

/**
 * Decodes the primary image of a HEIC/HEIF file with libheif in a worker,
 * downscaled to fit `maxDimension`. `data` is transferred to the worker.
 * Aborting terminates the worker, which is the only way to interrupt wasm.
 */
export function decodeHeic(data: ArrayBuffer, maxDimension: number, signal?: AbortSignal): Promise<DecodedHeic> {
  if (signal?.aborted) return Promise.reject(signal.reason)
  const worker = acquireWorker()
  const id = nextRequestId++

  return new Promise<DecodedHeic>((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const onMessage = (event: MessageEvent<HeicResponse>) => {
      const response = event.data
      if (response.id !== id) return
      cleanup()
      releaseWorker(worker)
      if (response.ok) {
        resolve({ bitmap: response.bitmap, width: response.width, height: response.height, hasAlpha: response.hasAlpha })
      } else {
        reject(new Error(response.message))
      }
    }
    const onError = (event: Event) => {
      cleanup()
      worker.terminate()
      const message = event instanceof ErrorEvent && event.message ? event.message : 'The HEIC decoder failed to load'
      reject(new Error(message))
    }
    const onAbort = () => {
      cleanup()
      worker.terminate()
      reject(signal?.reason)
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    signal?.addEventListener('abort', onAbort, { once: true })
    const request: HeicRequest = { id, data, maxDimension }
    worker.postMessage(request, [data])
  })
}
