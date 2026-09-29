// NumWorks app icons: 55x56 RGB565 (little-endian) pixels, compressed as a
// single LZ4 block (the raw block format, without the LZ4 frame header).

export const NWI_WIDTH = 55;
export const NWI_HEIGHT = 56;
export const NWI_PIXEL_BYTES = NWI_WIDTH * NWI_HEIGHT * 2;

/** Decodes an app icon to RGBA pixels (row-major, 55x56, opaque). */
export function decodeNwi(data: Uint8Array): Uint8ClampedArray {
  const pixels = decompressLz4Block(data, NWI_PIXEL_BYTES);
  const rgba = new Uint8ClampedArray(NWI_WIDTH * NWI_HEIGHT * 4);
  for (let i = 0; i < NWI_WIDTH * NWI_HEIGHT; i++) {
    const color = pixels[2 * i] | (pixels[2 * i + 1] << 8);
    const red = color >> 11;
    const green = (color >> 5) & 0x3f;
    const blue = color & 0x1f;
    // Replicate the high bits into the low ones so full intensity maps to 255.
    rgba[4 * i] = (red << 3) | (red >> 2);
    rgba[4 * i + 1] = (green << 2) | (green >> 4);
    rgba[4 * i + 2] = (blue << 3) | (blue >> 2);
    rgba[4 * i + 3] = 255;
  }
  return rgba;
}

/**
 * Decompresses one LZ4 block whose decompressed size is known. Throws on
 * malformed input or if the output isn't exactly `outputSize` bytes.
 */
export function decompressLz4Block(input: Uint8Array, outputSize: number): Uint8Array {
  const output = new Uint8Array(outputSize);
  let inPos = 0;
  let outPos = 0;

  const readLength = (initial: number): number => {
    let length = initial;
    if (initial === 15) {
      let byte: number;
      do {
        if (inPos >= input.length) throw new Error('LZ4 block truncated inside a length');
        byte = input[inPos++];
        length += byte;
      } while (byte === 255);
    }
    return length;
  };

  while (inPos < input.length) {
    const token = input[inPos++];

    const literalLength = readLength(token >> 4);
    if (inPos + literalLength > input.length) throw new Error('LZ4 literals run past the end of the block');
    if (outPos + literalLength > outputSize) throw new Error('LZ4 block decodes to more data than expected');
    output.set(input.subarray(inPos, inPos + literalLength), outPos);
    inPos += literalLength;
    outPos += literalLength;

    // The last sequence has literals only.
    if (inPos === input.length) break;

    if (inPos + 2 > input.length) throw new Error('LZ4 block truncated inside a match offset');
    const offset = input[inPos] | (input[inPos + 1] << 8);
    inPos += 2;
    if (offset === 0 || offset > outPos) throw new Error('LZ4 match offset points before the start of the output');

    const matchLength = readLength(token & 0x0f) + 4;
    if (outPos + matchLength > outputSize) throw new Error('LZ4 block decodes to more data than expected');
    // Byte by byte: a match may overlap the bytes it is producing.
    for (let from = outPos - offset, end = outPos + matchLength; outPos < end; ) {
      output[outPos++] = output[from++];
    }
  }

  if (outPos !== outputSize) {
    throw new Error(`LZ4 block decoded to ${outPos} bytes instead of ${outputSize}`);
  }
  return output;
}
