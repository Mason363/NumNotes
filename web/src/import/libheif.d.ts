// Types for the parts of libheif-js's self-contained ES module build (the
// wasm binary is embedded) that the HEIC worker uses. The package ships
// declarations only for the raw Emscripten module.
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  export interface HeifImage {
    get_width(): number
    get_height(): number
    is_primary(): boolean
    has_alpha_channel(): boolean
    /** Decodes into `target` (RGBA, sized get_width() x get_height()); calls back with null on failure. */
    display(target: ImageData, callback: (result: ImageData | null) => void): void
    free(): void
  }

  export interface HeifDecoder {
    /** Native heif_context of the last decode; freed with `heif_context_free`. */
    decoder: unknown
    /** Returns the top-level images of the file (empty on parse errors). */
    decode(data: Uint8Array): HeifImage[]
  }

  export interface LibHeif {
    HeifDecoder: new () => HeifDecoder
    heif_context_free(context: unknown): void
    calledRun?: boolean
    onRuntimeInitialized?: () => void
  }

  export default function createLibheif(options?: Record<string, unknown>): LibHeif
}
