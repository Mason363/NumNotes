/**
 * Error raised when a file can't be imported. `message` is written for end
 * users and can be shown as-is; `file` names the offending file when known.
 */
export class ImportError extends Error {
  file?: string

  constructor(message: string, file?: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ImportError'
    if (file !== undefined) this.file = file
  }
}

/** The file's type isn't one that can be imported (as opposed to a damaged file). */
export class UnsupportedFileError extends ImportError {
  constructor(message: string, file?: string, options?: ErrorOptions) {
    super(message, file, options)
    this.name = 'UnsupportedFileError'
  }
}

/** True for the rejection produced by an aborted `AbortSignal`. */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  )
}

/**
 * Resolves or rejects with `promise`, but rejects with the signal's reason as
 * soon as `signal` aborts. `onAbort` runs once on abort so callers can release
 * whatever the pending work holds (workers, decoders, media elements).
 */
export function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort?: () => void,
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    onAbort?.()
    return Promise.reject(signal.reason)
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort?.()
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

/** Normalizes anything thrown during an import into an `ImportError`. */
export function toImportError(error: unknown, file: string, fallbackMessage: string): ImportError {
  if (error instanceof ImportError) {
    if (error.file === undefined) error.file = file
    return error
  }
  return new ImportError(fallbackMessage, file, { cause: error })
}
