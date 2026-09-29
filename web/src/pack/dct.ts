/**
 * DCT tile codec for NN_IMG_DCT images: JPEG-like lossy coding of 32x32
 * tiles, each coded independently so the viewer can decode any tile directly.
 * viewer/src/dct.c is the calculator's decoder; decodeDctTile here matches it
 * bit for bit.
 *
 * Tile bitstream (not a JFIF file):
 *  - JFIF full-range YCbCr. Mode '420': 16x16 px MCUs of Y0 Y1 Y2 Y3 Cb Cr,
 *    chroma averaged over 2x2 px. '444': 8x8 px MCUs of Y Cb Cr. 'gray': 8x8
 *    px MCUs of Y only. MCUs are in raster order within the tile, and so are
 *    the four Y blocks of a 4:2:0 MCU.
 *  - Annex K quantization tables scaled by quality 1..100 (IJG formula).
 *  - Baseline Huffman coding with the four Annex K tables, coefficients in
 *    zigzag order, DC coded as the difference from the previous block of the
 *    same component. Predictors start at 0 in every tile.
 *  - Bits are packed MSB first with no byte stuffing or markers, and the tile
 *    is padded with 1 bits to a byte boundary.
 *
 * Decoding uses the libjpeg "islow" integer IDCT, triangle-filter chroma
 * upsampling within the tile, and a 4x4 ordered dither into RGB565.
 */

export type DctMode = '420' | '444' | 'gray';

/** nn_image_t.flags bits that select the DCT mode (format.h). */
export const IMGF_GRAY = 1 << 1;
export const IMGF_444 = 1 << 3;

export const DCT_TILE_SHIFT = 5;
export const DCT_TILE_SIZE = 1 << DCT_TILE_SHIFT;

export function dctModeFromFlags(flags: number): DctMode {
  if (flags & IMGF_GRAY) return 'gray';
  return flags & IMGF_444 ? '444' : '420';
}

export function dctModeFlags(mode: DctMode): number {
  return mode === 'gray' ? IMGF_GRAY : mode === '444' ? IMGF_444 : 0;
}

const TILE = DCT_TILE_SIZE;
const CHROMA_TILE = TILE / 2;

// ---------------------------------------------------------------------------
// Standard tables (ITU-T T.81 Annex K)

/** ZIGZAG[k] is the row-major index of the k-th coefficient in zigzag order. */
const ZIGZAG = Uint8Array.of(
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
);

/** Row-major. */
const LUMA_QUANT = Uint8Array.of(
  16, 11, 10, 16, 24, 40, 51, 61,
  12, 12, 14, 19, 26, 58, 60, 55,
  14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77,
  24, 35, 55, 64, 81, 104, 113, 92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103, 99,
);

const CHROMA_QUANT = Uint8Array.of(
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
);

interface HuffSpec {
  /** Number of codes of each length 1..16. */
  bits: Uint8Array;
  /** Symbols in order of increasing code. */
  vals: Uint8Array;
}

const DC_LUMA: HuffSpec = {
  bits: Uint8Array.of(0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0),
  vals: Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11),
};

const DC_CHROMA: HuffSpec = {
  bits: Uint8Array.of(0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0),
  vals: Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11),
};

const AC_LUMA: HuffSpec = {
  bits: Uint8Array.of(0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d),
  vals: Uint8Array.of(
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ),
};

const AC_CHROMA: HuffSpec = {
  bits: Uint8Array.of(0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77),
  vals: Uint8Array.of(
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
    0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
    0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
    0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
    0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
    0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ),
};

const EOB = 0x00;
const ZRL = 0xf0;
/** Largest AC magnitude a baseline Huffman symbol can carry (10 bits). */
const MAX_AC = 1023;

// ---------------------------------------------------------------------------
// Quantization

function clampQuality(quality: number): number {
  return Math.min(100, Math.max(1, Math.round(quality)));
}

function scaleQuant(base: Uint8Array, quality: number): Uint16Array {
  const q = clampQuality(quality);
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q;
  const table = new Uint16Array(64);
  for (let k = 0; k < 64; k++) {
    const v = Math.floor((base[ZIGZAG[k]] * scale + 50) / 100);
    table[k] = Math.min(255, Math.max(1, v));
  }
  return table;
}

/** Luma and chroma quantization tables for `quality`, in zigzag order. */
export function dctQuantTables(quality: number): [Uint16Array, Uint16Array] {
  return [scaleQuant(LUMA_QUANT, quality), scaleQuant(CHROMA_QUANT, quality)];
}

// ---------------------------------------------------------------------------
// Encoder

interface HuffCodes {
  code: Uint16Array;
  size: Uint8Array;
}

/** Canonical Huffman codes for a table (T.81 Annex C). */
function buildCodes(spec: HuffSpec): HuffCodes {
  const codes: HuffCodes = { code: new Uint16Array(256), size: new Uint8Array(256) };
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    for (let i = 0; i < spec.bits[length - 1]; i++, k++, code++) {
      codes.code[spec.vals[k]] = code;
      codes.size[spec.vals[k]] = length;
    }
    code <<= 1;
  }
  return codes;
}

const ENC_DC = [buildCodes(DC_LUMA), buildCodes(DC_CHROMA)];
const ENC_AC = [buildCodes(AC_LUMA), buildCodes(AC_CHROMA)];

/** FDCT_BASIS[u * 8 + x] = C(u) / 2 * cos((2x + 1) u pi / 16). */
const FDCT_BASIS = (() => {
  const basis = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    const c = u === 0 ? Math.SQRT1_2 / 2 : 0.5;
    for (let x = 0; x < 8; x++) basis[u * 8 + x] = c * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
  return basis;
})();

/** Exact floating-point forward DCT of a level-shifted block, in place. */
function forwardDct(block: Float64Array, tmp: Float64Array): void {
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) sum += block[y * 8 + x] * FDCT_BASIS[u * 8 + x];
      tmp[y * 8 + u] = sum;
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) sum += tmp[y * 8 + u] * FDCT_BASIS[v * 8 + y];
      block[v * 8 + u] = sum;
    }
  }
}

function quantize(coef: number, q: number): number {
  const v = coef / q;
  return v < 0 ? -Math.floor(0.5 - v) : Math.floor(v + 0.5);
}

/** Number of bits needed for |v| (the JPEG magnitude category). */
function category(v: number): number {
  return v === 0 ? 0 : 32 - Math.clz32(Math.abs(v));
}

class BitWriter {
  private buf = new Uint8Array(2048);
  private length = 0;
  private acc = 0;
  private bits = 0;

  /** Appends the low `count` (<= 16) bits of `value`, MSB first. */
  write(value: number, count: number): void {
    this.acc = (this.acc << count) | value;
    this.bits += count;
    while (this.bits >= 8) {
      this.bits -= 8;
      this.push((this.acc >> this.bits) & 0xff);
    }
    this.acc &= (1 << this.bits) - 1;
  }

  /** Pads with 1 bits to a byte boundary and returns the bytes. */
  finish(): Uint8Array {
    if (this.bits > 0) this.write((1 << (8 - this.bits)) - 1, 8 - this.bits);
    return this.buf.slice(0, this.length);
  }

  private push(byte: number): void {
    if (this.length === this.buf.length) {
      const grown = new Uint8Array(this.buf.length * 2);
      grown.set(this.buf);
      this.buf = grown;
    }
    this.buf[this.length++] = byte;
  }
}

/** Codes blocks of one tile, tracking the per-component DC predictors. */
class BlockEncoder {
  private readonly writer = new BitWriter();
  private readonly quant: Uint16Array[];
  private readonly pred = [0, 0, 0];
  private readonly block = new Float64Array(64);
  private readonly tmp = new Float64Array(64);

  constructor(quality: number) {
    this.quant = dctQuantTables(quality);
  }

  /** Codes the 8x8 block at (bx, by) of `plane` for component 0 (Y), 1 (Cb) or 2 (Cr). */
  encode(plane: Float64Array, stride: number, bx: number, by: number, component: number): void {
    const block = this.block;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) block[y * 8 + x] = plane[(by + y) * stride + bx + x] - 128;
    }
    forwardDct(block, this.tmp);

    const cls = component === 0 ? 0 : 1;
    const quant = this.quant[cls];
    const dc = quantize(block[0], quant[0]);
    this.writeValue(ENC_DC[cls], 0, dc - this.pred[component]);
    this.pred[component] = dc;

    const ac = ENC_AC[cls];
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const v = Math.max(-MAX_AC, Math.min(MAX_AC, quantize(block[ZIGZAG[k]], quant[k])));
      if (v === 0) {
        run++;
        continue;
      }
      for (; run > 15; run -= 16) this.writer.write(ac.code[ZRL], ac.size[ZRL]);
      this.writeValue(ac, run << 4, v);
      run = 0;
    }
    if (run > 0) this.writer.write(ac.code[EOB], ac.size[EOB]);
  }

  finish(): Uint8Array {
    return this.writer.finish();
  }

  /** Writes the Huffman code for (symbol | category(v)) followed by v's extra bits. */
  private writeValue(codes: HuffCodes, symbol: number, v: number): void {
    const size = category(v);
    const s = symbol | size;
    this.writer.write(codes.code[s], codes.size[s]);
    if (size > 0) this.writer.write((v < 0 ? v - 1 : v) & ((1 << size) - 1), size);
  }
}

interface YccPlanes {
  y: Float64Array;
  cb: Float64Array;
  cr: Float64Array;
}

/** Reads a tile as full-range YCbCr, replicating edge pixels past the image. */
function readTile(
  rgba: Uint8ClampedArray | Uint8Array,
  stride: number,
  x0: number,
  y0: number,
  width: number,
  height: number,
  withChroma: boolean,
): YccPlanes {
  const n = withChroma ? TILE * TILE : 0;
  const planes: YccPlanes = { y: new Float64Array(TILE * TILE), cb: new Float64Array(n), cr: new Float64Array(n) };
  for (let ty = 0; ty < TILE; ty++) {
    const row = Math.min(y0 + ty, height - 1) * stride;
    for (let tx = 0; tx < TILE; tx++) {
      const i = (row + Math.min(x0 + tx, width - 1)) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const o = ty * TILE + tx;
      planes.y[o] = 0.299 * r + 0.587 * g + 0.114 * b;
      if (withChroma) {
        planes.cb[o] = -0.168736 * r - 0.331264 * g + 0.5 * b + 128;
        planes.cr[o] = 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
      }
    }
  }
  return planes;
}

/** Averages 2x2 pixel groups of a full tile plane. */
function downsample(plane: Float64Array): Float64Array {
  const out = new Float64Array(CHROMA_TILE * CHROMA_TILE);
  for (let y = 0; y < CHROMA_TILE; y++) {
    for (let x = 0; x < CHROMA_TILE; x++) {
      const i = 2 * y * TILE + 2 * x;
      out[y * CHROMA_TILE + x] = (plane[i] + plane[i + 1] + plane[i + TILE] + plane[i + TILE + 1]) / 4;
    }
  }
  return out;
}

/**
 * Encodes the 32x32 tile whose top-left pixel is (x0, y0) in an RGBA image of
 * width x height pixels (row stride in pixels). Pixels past the right and
 * bottom edges replicate the edge. Alpha is ignored: composite first.
 * `quality` is rounded and clamped to 1..100; nn_level_t.quality must hold
 * the same value.
 */
export function encodeDctTile(
  rgba: Uint8ClampedArray | Uint8Array,
  stride: number,
  x0: number,
  y0: number,
  width: number,
  height: number,
  mode: DctMode,
  quality: number,
): Uint8Array {
  if (width < 1 || height < 1 || x0 < 0 || y0 < 0 || x0 >= width || y0 >= height || stride < width) {
    throw new RangeError('dct: tile outside the image');
  }
  if (rgba.length < ((height - 1) * stride + width) * 4) throw new RangeError('dct: pixel buffer too small');

  const coder = new BlockEncoder(quality);
  const planes = readTile(rgba, stride, x0, y0, width, height, mode !== 'gray');
  switch (mode) {
    case 'gray':
      for (let by = 0; by < TILE; by += 8) {
        for (let bx = 0; bx < TILE; bx += 8) coder.encode(planes.y, TILE, bx, by, 0);
      }
      break;
    case '444':
      for (let by = 0; by < TILE; by += 8) {
        for (let bx = 0; bx < TILE; bx += 8) {
          coder.encode(planes.y, TILE, bx, by, 0);
          coder.encode(planes.cb, TILE, bx, by, 1);
          coder.encode(planes.cr, TILE, bx, by, 2);
        }
      }
      break;
    case '420': {
      const cb = downsample(planes.cb);
      const cr = downsample(planes.cr);
      for (let my = 0; my < TILE; my += 16) {
        for (let mx = 0; mx < TILE; mx += 16) {
          for (let i = 0; i < 4; i++) coder.encode(planes.y, TILE, mx + (i & 1) * 8, my + (i >> 1) * 8, 0);
          coder.encode(cb, CHROMA_TILE, mx / 2, my / 2, 1);
          coder.encode(cr, CHROMA_TILE, mx / 2, my / 2, 2);
        }
      }
      break;
    }
    default:
      throw new RangeError(`dct: unknown mode ${String(mode)}`);
  }
  return coder.finish();
}

// ---------------------------------------------------------------------------
// Reference decoder (mirrors viewer/src/dct.c)

/** Codes up to this many bits long are decoded with one table lookup. */
const LOOKAHEAD = 9;
/** Dequantized coefficients are clamped to this range (never hit by valid data). */
const COEF_MIN = -4096;
const COEF_MAX = 4095;
/** IDCT intermediate range, which keeps the second pass free of overflow. */
const WS_MIN = -16384;
const WS_MAX = 16383;

interface HuffDecoder {
  /** (length << 8) | symbol for each LOOKAHEAD-bit prefix; 0 if the code is longer. */
  look: Uint16Array;
  /** Largest code of each length, -1 if none. */
  maxcode: Int32Array;
  /** vals index of a code = code + valoffset[length]. */
  valoffset: Int32Array;
  vals: Uint8Array;
}

function buildDecoder(spec: HuffSpec): HuffDecoder {
  const dec: HuffDecoder = {
    look: new Uint16Array(1 << LOOKAHEAD),
    maxcode: new Int32Array(17).fill(-1),
    valoffset: new Int32Array(17),
    vals: spec.vals,
  };
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length++) {
    const count = spec.bits[length - 1];
    dec.valoffset[length] = k - code;
    for (let i = 0; i < count; i++, k++, code++) {
      if (length <= LOOKAHEAD) {
        const shift = LOOKAHEAD - length;
        dec.look.fill((length << 8) | spec.vals[k], code << shift, (code + 1) << shift);
      }
    }
    if (count > 0) dec.maxcode[length] = code - 1;
    code <<= 1;
  }
  return dec;
}

const DEC_DC = [buildDecoder(DC_LUMA), buildDecoder(DC_CHROMA)];
const DEC_AC = [buildDecoder(AC_LUMA), buildDecoder(AC_CHROMA)];

/** 4x4 Bayer thresholds as 16.16 fractions: (2b + 1) / 32. */
const DITHER = Uint16Array.from([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], (b) => (2 * b + 1) << 11);

/** MSB-first bit reader that yields 1 bits past the end of the data. */
class BitReader {
  /** Unconsumed bits, left-aligned. */
  acc = 0;
  /** Number of valid bits in acc. */
  bits = 0;
  private readonly data: Uint8Array;
  private pos = 0;
  /** Filler bytes supplied past the end. */
  private pad = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  /** Tops the accumulator up to at least 25 bits. */
  fill(): void {
    while (this.bits <= 24) {
      let byte = 0xff;
      if (this.pos < this.data.length) byte = this.data[this.pos++];
      else this.pad++;
      this.acc = (this.acc | (byte << (24 - this.bits))) >>> 0;
      this.bits += 8;
    }
  }

  skip(n: number): void {
    this.acc = (this.acc << n) >>> 0;
    this.bits -= n;
  }

  /** Whether any filler bits have been consumed, i.e. the data was too short. */
  get overrun(): boolean {
    return this.pad * 8 > this.bits;
  }
}

function decodeSymbol(br: BitReader, table: HuffDecoder): number {
  br.fill();
  const entry = table.look[br.acc >>> (32 - LOOKAHEAD)];
  if (entry !== 0) {
    br.skip(entry >> 8);
    return entry & 0xff;
  }
  for (let length = LOOKAHEAD + 1; length <= 16; length++) {
    const code = br.acc >>> (32 - length);
    if (code <= table.maxcode[length]) {
      br.skip(length);
      return table.vals[code + table.valoffset[length]];
    }
  }
  throw new Error('dct: invalid Huffman code');
}

/** Reads `size` (1..11) extra bits and sign-extends them (JPEG HUFF_EXTEND). */
function receiveExtend(br: BitReader, size: number): number {
  if (br.bits < size) br.fill();
  const v = br.acc >>> (32 - size);
  br.skip(size);
  return v < 1 << (size - 1) ? v - ((1 << size) - 1) : v;
}

function clampCoef(v: number): number {
  return v < COEF_MIN ? COEF_MIN : v > COEF_MAX ? COEF_MAX : v;
}

function clampWs(v: number): number {
  return v < WS_MIN ? WS_MIN : v > WS_MAX ? WS_MAX : v;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// libjpeg jidctint.c constants: FIX(x) = round(x * 2^13).
const CONST_BITS = 13;
const PASS1_BITS = 2;
const FIX_0_298631336 = 2446;
const FIX_0_390180644 = 3196;
const FIX_0_541196100 = 4433;
const FIX_0_765366865 = 6270;
const FIX_0_899976223 = 7373;
const FIX_1_175875602 = 9633;
const FIX_1_501321110 = 12299;
const FIX_1_847759065 = 15137;
const FIX_1_961570560 = 16069;
const FIX_2_053119869 = 16819;
const FIX_2_562915447 = 20995;
const FIX_3_072711026 = 25172;
const PASS1_SHIFT = CONST_BITS - PASS1_BITS;
const PASS2_SHIFT = CONST_BITS + PASS1_BITS + 3;
/** Rounding plus the +128 level shift, folded into the DC term of pass 2. */
const PASS2_BIAS = (1 << (PASS2_SHIFT - 1)) + (128 << PASS2_SHIFT);

/**
 * libjpeg "islow" IDCT of a dequantized row-major block into 8-bit samples.
 * All intermediates stay within 32 bits, so plain JS arithmetic matches C.
 */
function inverseDct(coef: Int32Array, ws: Int32Array, out: Uint8Array, offset: number, stride: number): void {
  // Pass 1: columns, results scaled up by 2^PASS1_BITS.
  for (let c = 0; c < 8; c++) {
    if (
      coef[8 + c] === 0 && coef[16 + c] === 0 && coef[24 + c] === 0 && coef[32 + c] === 0 &&
      coef[40 + c] === 0 && coef[48 + c] === 0 && coef[56 + c] === 0
    ) {
      const dc = coef[c] * (1 << PASS1_BITS);
      for (let r = 0; r < 8; r++) ws[r * 8 + c] = dc;
      continue;
    }
    let z2 = coef[16 + c];
    let z3 = coef[48 + c];
    let z1 = (z2 + z3) * FIX_0_541196100;
    let tmp2 = z1 - z3 * FIX_1_847759065;
    let tmp3 = z1 + z2 * FIX_0_765366865;
    z2 = coef[c];
    z3 = coef[32 + c];
    let tmp0 = (z2 + z3) * (1 << CONST_BITS) + (1 << (PASS1_SHIFT - 1));
    let tmp1 = (z2 - z3) * (1 << CONST_BITS) + (1 << (PASS1_SHIFT - 1));
    const tmp10 = tmp0 + tmp3;
    const tmp13 = tmp0 - tmp3;
    const tmp11 = tmp1 + tmp2;
    const tmp12 = tmp1 - tmp2;

    tmp0 = coef[56 + c];
    tmp1 = coef[40 + c];
    tmp2 = coef[24 + c];
    tmp3 = coef[8 + c];
    z1 = tmp0 + tmp3;
    z2 = tmp1 + tmp2;
    z3 = tmp0 + tmp2;
    let z4 = tmp1 + tmp3;
    const z5 = (z3 + z4) * FIX_1_175875602;
    tmp0 *= FIX_0_298631336;
    tmp1 *= FIX_2_053119869;
    tmp2 *= FIX_3_072711026;
    tmp3 *= FIX_1_501321110;
    z1 *= -FIX_0_899976223;
    z2 *= -FIX_2_562915447;
    z3 = z3 * -FIX_1_961570560 + z5;
    z4 = z4 * -FIX_0_390180644 + z5;
    tmp0 += z1 + z3;
    tmp1 += z2 + z4;
    tmp2 += z2 + z3;
    tmp3 += z1 + z4;

    ws[c] = clampWs((tmp10 + tmp3) >> PASS1_SHIFT);
    ws[56 + c] = clampWs((tmp10 - tmp3) >> PASS1_SHIFT);
    ws[8 + c] = clampWs((tmp11 + tmp2) >> PASS1_SHIFT);
    ws[48 + c] = clampWs((tmp11 - tmp2) >> PASS1_SHIFT);
    ws[16 + c] = clampWs((tmp12 + tmp1) >> PASS1_SHIFT);
    ws[40 + c] = clampWs((tmp12 - tmp1) >> PASS1_SHIFT);
    ws[24 + c] = clampWs((tmp13 + tmp0) >> PASS1_SHIFT);
    ws[32 + c] = clampWs((tmp13 - tmp0) >> PASS1_SHIFT);
  }

  // Pass 2: rows, descaled to samples.
  for (let r = 0; r < 8; r++) {
    const w = r * 8;
    const o = offset + r * stride;
    if (ws[w + 1] === 0 && ws[w + 2] === 0 && ws[w + 3] === 0 && ws[w + 4] === 0 &&
        ws[w + 5] === 0 && ws[w + 6] === 0 && ws[w + 7] === 0) {
      out.fill(clamp255((ws[w] * (1 << CONST_BITS) + PASS2_BIAS) >> PASS2_SHIFT), o, o + 8);
      continue;
    }
    let z2 = ws[w + 2];
    let z3 = ws[w + 6];
    let z1 = (z2 + z3) * FIX_0_541196100;
    let tmp2 = z1 - z3 * FIX_1_847759065;
    let tmp3 = z1 + z2 * FIX_0_765366865;
    z2 = ws[w];
    z3 = ws[w + 4];
    let tmp0 = (z2 + z3) * (1 << CONST_BITS) + PASS2_BIAS;
    let tmp1 = (z2 - z3) * (1 << CONST_BITS) + PASS2_BIAS;
    const tmp10 = tmp0 + tmp3;
    const tmp13 = tmp0 - tmp3;
    const tmp11 = tmp1 + tmp2;
    const tmp12 = tmp1 - tmp2;

    tmp0 = ws[w + 7];
    tmp1 = ws[w + 5];
    tmp2 = ws[w + 3];
    tmp3 = ws[w + 1];
    z1 = tmp0 + tmp3;
    z2 = tmp1 + tmp2;
    z3 = tmp0 + tmp2;
    let z4 = tmp1 + tmp3;
    const z5 = (z3 + z4) * FIX_1_175875602;
    tmp0 *= FIX_0_298631336;
    tmp1 *= FIX_2_053119869;
    tmp2 *= FIX_3_072711026;
    tmp3 *= FIX_1_501321110;
    z1 *= -FIX_0_899976223;
    z2 *= -FIX_2_562915447;
    z3 = z3 * -FIX_1_961570560 + z5;
    z4 = z4 * -FIX_0_390180644 + z5;
    tmp0 += z1 + z3;
    tmp1 += z2 + z4;
    tmp2 += z2 + z3;
    tmp3 += z1 + z4;

    out[o] = clamp255((tmp10 + tmp3) >> PASS2_SHIFT);
    out[o + 7] = clamp255((tmp10 - tmp3) >> PASS2_SHIFT);
    out[o + 1] = clamp255((tmp11 + tmp2) >> PASS2_SHIFT);
    out[o + 6] = clamp255((tmp11 - tmp2) >> PASS2_SHIFT);
    out[o + 2] = clamp255((tmp12 + tmp1) >> PASS2_SHIFT);
    out[o + 5] = clamp255((tmp12 - tmp1) >> PASS2_SHIFT);
    out[o + 3] = clamp255((tmp13 + tmp0) >> PASS2_SHIFT);
    out[o + 4] = clamp255((tmp13 - tmp0) >> PASS2_SHIFT);
  }
}

/** Decodes blocks of one tile, tracking the per-component DC predictors. */
class BlockDecoder {
  private readonly br: BitReader;
  private readonly quant: Uint16Array[];
  private readonly pred = [0, 0, 0];
  private readonly coef = new Int32Array(64);
  private readonly ws = new Int32Array(64);

  constructor(data: Uint8Array, quality: number) {
    this.br = new BitReader(data);
    this.quant = dctQuantTables(quality);
  }

  /** Decodes the next block of `component` into 8x8 samples at out[offset] with `stride`. */
  decode(component: number, out: Uint8Array, offset: number, stride: number): void {
    const br = this.br;
    const cls = component === 0 ? 0 : 1;
    const quant = this.quant[cls];
    const ac = DEC_AC[cls];
    const coef = this.coef;
    coef.fill(0);

    const dcSize = decodeSymbol(br, DEC_DC[cls]);
    if (dcSize > 0) this.pred[component] += receiveExtend(br, dcSize);
    coef[0] = clampCoef(this.pred[component] * quant[0]);

    let hasAc = false;
    for (let k = 1; k < 64; k++) {
      const rs = decodeSymbol(br, ac);
      const size = rs & 15;
      if (size === 0) {
        if (rs !== ZRL) break;
        k += 15;
        continue;
      }
      k += rs >> 4;
      if (k > 63) throw new Error('dct: coefficient index out of range');
      coef[ZIGZAG[k]] = clampCoef(receiveExtend(br, size) * quant[k]);
      hasAc = true;
    }
    if (br.overrun) throw new Error('dct: truncated tile');

    if (hasAc) {
      inverseDct(coef, this.ws, out, offset, stride);
    } else {
      // Same result as the full IDCT for a DC-only block.
      const v = clamp255(((coef[0] + 4) >> 3) + 128);
      for (let r = 0; r < 8; r++) out.fill(v, offset + r * stride, offset + r * stride + 8);
    }
  }
}

// JFIF YCbCr -> RGB in 16.16 fixed point (same constants as libjpeg).
const FIX_R_CR = 91881; // 1.402
const FIX_G_CB = 22554; // 0.344136
const FIX_G_CR = 46802; // 0.714136
const FIX_B_CB = 116130; // 1.772
const ONE_HALF = 1 << 15;
// 8-bit to 5/6-bit scale factors: 31/255 and 63/255 in 16.16.
const SCALE_5 = 7967;
const SCALE_6 = 16191;

function storeRgb(rgb: Uint8Array, o: number, y: number, cb: number, cr: number): void {
  cb -= 128;
  cr -= 128;
  rgb[o] = clamp255(y + ((FIX_R_CR * cr + ONE_HALF) >> 16));
  rgb[o + 1] = clamp255(y + ((-FIX_G_CB * cb - FIX_G_CR * cr + ONE_HALF) >> 16));
  rgb[o + 2] = clamp255(y + ((FIX_B_CB * cb + ONE_HALF) >> 16));
}

/** Converts 8x8 blocks of Y, Cb and Cr to RGB at (x0, y0) of the tile. */
function convertColorBlock(y: Uint8Array, cb: Uint8Array, cr: Uint8Array, rgb: Uint8Array, x0: number, y0: number): void {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const i = r * 8 + c;
      storeRgb(rgb, ((y0 + r) * TILE + x0 + c) * 3, y[i], cb[i], cr[i]);
    }
  }
}

/** Converts an 8x8 block of Y to gray RGB at (x0, y0) of the tile. */
function convertGrayBlock(y: Uint8Array, rgb: Uint8Array, x0: number, y0: number): void {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const o = ((y0 + r) * TILE + x0 + c) * 3;
      rgb[o] = rgb[o + 1] = rgb[o + 2] = y[r * 8 + c];
    }
  }
}

/**
 * Upsamples 16x16 chroma planes to the tile with libjpeg's "fancy" triangle
 * filter (3/4 nearest + 1/4 next sample on each axis, edges replicated) and
 * converts to RGB.
 */
function convert420(y: Uint8Array, cb: Uint8Array, cr: Uint8Array, rgb: Uint8Array): void {
  const cbCol = new Int32Array(CHROMA_TILE);
  const crCol = new Int32Array(CHROMA_TILE);
  const last = CHROMA_TILE - 1;
  for (let row = 0; row < TILE; row++) {
    const nearest = row >> 1;
    const next = row & 1 ? Math.min(nearest + 1, last) : Math.max(nearest - 1, 0);
    for (let j = 0; j < CHROMA_TILE; j++) {
      cbCol[j] = 3 * cb[nearest * CHROMA_TILE + j] + cb[next * CHROMA_TILE + j];
      crCol[j] = 3 * cr[nearest * CHROMA_TILE + j] + cr[next * CHROMA_TILE + j];
    }
    for (let j = 0; j < CHROMA_TILE; j++) {
      const left = j > 0 ? j - 1 : 0;
      const right = j < last ? j + 1 : last;
      const i = row * TILE + 2 * j;
      storeRgb(rgb, i * 3, y[i], (3 * cbCol[j] + cbCol[left] + 8) >> 4, (3 * crCol[j] + crCol[left] + 8) >> 4);
      storeRgb(rgb, i * 3 + 3, y[i + 1], (3 * cbCol[j] + cbCol[right] + 7) >> 4, (3 * crCol[j] + crCol[right] + 7) >> 4);
    }
  }
}

/** Packs RGB888 tile pixels into RGB565 with the 4x4 ordered dither. */
function packRgb565(rgb: Uint8Array): Uint16Array {
  const out = new Uint16Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      const d = DITHER[(y & 3) * 4 + (x & 3)];
      const r = (rgb[3 * i] * SCALE_5 + d) >> 16;
      const g = (rgb[3 * i + 1] * SCALE_6 + d) >> 16;
      const b = (rgb[3 * i + 2] * SCALE_5 + d) >> 16;
      out[i] = (r << 11) | (g << 5) | b;
    }
  }
  return out;
}

/**
 * Decodes one tile to 32x32 RGB888 pixels (3 bytes each, row-major): the
 * decoder's exact result before RGB565 conversion, which makes a better
 * basis than decodeDctTile for estimating quality. Throws if the data is
 * corrupt or truncated.
 */
export function decodeDctTileRgb(data: Uint8Array, mode: DctMode, quality: number): Uint8Array {
  const dec = new BlockDecoder(data, quality);
  const rgb = new Uint8Array(TILE * TILE * 3);
  const y = new Uint8Array(64);
  const cb = new Uint8Array(64);
  const cr = new Uint8Array(64);
  switch (mode) {
    case 'gray':
      for (let by = 0; by < TILE; by += 8) {
        for (let bx = 0; bx < TILE; bx += 8) {
          dec.decode(0, y, 0, 8);
          convertGrayBlock(y, rgb, bx, by);
        }
      }
      break;
    case '444':
      for (let by = 0; by < TILE; by += 8) {
        for (let bx = 0; bx < TILE; bx += 8) {
          dec.decode(0, y, 0, 8);
          dec.decode(1, cb, 0, 8);
          dec.decode(2, cr, 0, 8);
          convertColorBlock(y, cb, cr, rgb, bx, by);
        }
      }
      break;
    case '420': {
      const yPlane = new Uint8Array(TILE * TILE);
      const cbPlane = new Uint8Array(CHROMA_TILE * CHROMA_TILE);
      const crPlane = new Uint8Array(CHROMA_TILE * CHROMA_TILE);
      for (let my = 0; my < TILE; my += 16) {
        for (let mx = 0; mx < TILE; mx += 16) {
          for (let i = 0; i < 4; i++) {
            dec.decode(0, yPlane, (my + (i >> 1) * 8) * TILE + mx + (i & 1) * 8, TILE);
          }
          const c = (my / 2) * CHROMA_TILE + mx / 2;
          dec.decode(1, cbPlane, c, CHROMA_TILE);
          dec.decode(2, crPlane, c, CHROMA_TILE);
        }
      }
      convert420(yPlane, cbPlane, crPlane, rgb);
      break;
    }
    default:
      throw new RangeError(`dct: unknown mode ${String(mode)}`);
  }
  return rgb;
}

/**
 * Decodes one tile to 32x32 RGB565 pixels (row-major), exactly as the
 * calculator shows it. Throws if the data is corrupt or truncated.
 */
export function decodeDctTile(data: Uint8Array, mode: DctMode, quality: number): Uint16Array {
  return packRgb565(decodeDctTileRgb(data, mode, quality));
}

/**
 * PSNR in dB of a decoded tile against the source pixels it was encoded from,
 * over the part of the tile inside the image. `decoded` is either RGB565
 * (decodeDctTile, expanded to 8 bits per channel) or RGB888 (decodeDctTileRgb).
 * RGB565 output includes the display's quantization and dither, which caps
 * its PSNR near 39 dB.
 */
export function tilePsnr(
  decoded: Uint16Array | Uint8Array,
  rgba: Uint8ClampedArray | Uint8Array,
  stride: number,
  x0: number,
  y0: number,
  width: number,
  height: number,
): number {
  const pixel = new Uint8Array(3);
  let sum = 0;
  let count = 0;
  for (let ty = 0; ty < TILE && y0 + ty < height; ty++) {
    for (let tx = 0; tx < TILE && x0 + tx < width; tx++) {
      const t = ty * TILE + tx;
      if (decoded instanceof Uint16Array) {
        const p = decoded[t];
        pixel[0] = ((p >> 11) << 3) | (p >> 13);
        pixel[1] = (((p >> 5) & 63) << 2) | ((p >> 9) & 3);
        pixel[2] = ((p & 31) << 3) | ((p >> 2) & 7);
      } else {
        pixel.set(decoded.subarray(3 * t, 3 * t + 3));
      }
      const i = ((y0 + ty) * stride + x0 + tx) * 4;
      for (let c = 0; c < 3; c++) {
        const d = pixel[c] - rgba[i + c];
        sum += d * d;
      }
      count += 3;
    }
  }
  return sum === 0 ? Infinity : 10 * Math.log10((255 * 255 * count) / sum);
}
