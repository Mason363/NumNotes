/** One decoded GIF frame, as produced by gifuct-js's `decompressFrame`. */
export interface GifFrame {
  dims: { left: number; top: number; width: number; height: number }
  /** Palette indices, row-major over `dims`. */
  pixels: ArrayLike<number>
  colorTable: ArrayLike<ArrayLike<number>>
  transparentIndex?: number
  /** 0/1: leave in place, 2: restore to background (transparent), 3: restore previous. */
  disposalType?: number
}

/**
 * Composites GIF frames onto an RGBA canvas the way browsers do: the logical
 * screen starts fully transparent, transparent indices leave the pixels below
 * untouched, and each frame's disposal method is applied just before the next
 * frame is drawn.
 */
export class GifCompositor {
  readonly pixels: Uint8ClampedArray
  private disposal: { type: number; dims: GifFrame['dims'] } | null = null
  private saved: Uint8ClampedArray | null = null

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4)
  }

  /**
   * Draws `frame` and returns the composited image. The returned array is the
   * compositor's live buffer: copy it before rendering the next frame.
   */
  render(frame: GifFrame): Uint8ClampedArray {
    this.applyDisposal()
    const disposalType = frame.disposalType ?? 0
    if (disposalType === 3) this.saved = this.pixels.slice()

    const { left, top, width, height } = frame.dims
    const { pixels, colorTable, transparentIndex } = frame
    const canvas = this.pixels
    for (let y = 0; y < height; y++) {
      const cy = top + y
      if (cy < 0 || cy >= this.height) continue
      for (let x = 0; x < width; x++) {
        const cx = left + x
        if (cx < 0 || cx >= this.width) continue
        const index = pixels[y * width + x]
        if (index === transparentIndex) continue
        const color = colorTable[index]
        if (!color) continue
        const offset = (cy * this.width + cx) * 4
        canvas[offset] = color[0]
        canvas[offset + 1] = color[1]
        canvas[offset + 2] = color[2]
        canvas[offset + 3] = 255
      }
    }
    this.disposal = { type: disposalType, dims: frame.dims }
    return canvas
  }

  private applyDisposal(): void {
    const disposal = this.disposal
    this.disposal = null
    if (!disposal) return
    if (disposal.type === 2) {
      const { left, top, width, height } = disposal.dims
      const x0 = Math.max(0, left)
      const x1 = Math.min(this.width, left + width)
      if (x1 <= x0) return
      for (let y = Math.max(0, top); y < Math.min(this.height, top + height); y++) {
        this.pixels.fill(0, (y * this.width + x0) * 4, (y * this.width + x1) * 4)
      }
    } else if (disposal.type === 3 && this.saved) {
      this.pixels.set(this.saved)
      this.saved = null
    }
  }
}
