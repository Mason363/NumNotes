import { describe, expect, it } from 'vitest';
import {
  DCT_TILE_SIZE,
  IMGF_444,
  IMGF_GRAY,
  dctModeFlags,
  dctModeFromFlags,
  dctQuantTables,
  decodeDctTile,
  decodeDctTileRgb,
  encodeDctTile,
  tilePsnr,
  type DctMode,
} from './dct';
import { lz4Compress, lz4CompressBound, lz4Decompress } from './lz4';

// Bit-exact agreement with the C decoders is checked by viewer/test/run_codec_test.sh.

function rng(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function bytes(n: number, f: (i: number) => number): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => f(i));
}

// ---------------------------------------------------------------------------
// LZ4

interface Sequence {
  start: number; // output position of the sequence's literals
  literals: number;
  offset: number;
  matchLength: number; // 0 for the final sequence
}

/** Splits a block into sequences, checking only the syntax. */
function parseBlock(block: Uint8Array): Sequence[] {
  const sequences: Sequence[] = [];
  let ip = 0;
  let op = 0;
  const readLength = (length: number) => {
    let b: number;
    do {
      b = block[ip++];
      length += b;
    } while (b === 255);
    return length;
  };
  for (;;) {
    const token = block[ip++];
    let literals = token >> 4;
    if (literals === 15) literals = readLength(literals);
    const start = op;
    ip += literals;
    op += literals;
    if (ip >= block.length) {
      sequences.push({ start, literals, offset: 0, matchLength: 0 });
      return sequences;
    }
    const offset = block[ip] | (block[ip + 1] << 8);
    ip += 2;
    let matchLength = token & 15;
    if (matchLength === 15) matchLength = readLength(matchLength);
    matchLength += 4;
    sequences.push({ start, literals, offset, matchLength });
    op += matchLength;
  }
}

function lz4Inputs(): [string, Uint8Array][] {
  const random = rng(1);
  const inputs: [string, Uint8Array][] = [];
  for (const n of [0, 1, 2, 4, 5, 11, 12, 13, 14, 15, 16, 17, 19, 20, 31, 32, 64, 255, 256, 270, 271, 1000, 4096]) {
    inputs.push([`zeros(${n})`, new Uint8Array(n)]);
    inputs.push([`random(${n})`, bytes(n, () => random() * 256)]);
    inputs.push([`period3(${n})`, bytes(n, (i) => i % 3)]);
    inputs.push([`period7(${n})`, bytes(n, (i) => (i * 37) % 7)]);
  }
  inputs.push(['long runs', bytes(20000, (i) => (i / 700) & 0xff)]);
  inputs.push(['mostly repeats', bytes(50000, (i) => (random() < 0.05 ? random() * 256 : (i >> 4) & 0x3f))]);
  const block = bytes(70000, () => random() * 256);
  const far = new Uint8Array(140000);
  far.set(block);
  far.set(block, 70000); // repeats only beyond the 64 KiB window
  inputs.push(['far repeat', far]);
  return inputs;
}

describe('lz4', () => {
  it('round-trips tiny, random, repetitive and large inputs', () => {
    for (const [name, input] of lz4Inputs()) {
      const block = lz4Compress(input);
      expect(block.length, name).toBeLessThanOrEqual(lz4CompressBound(input.length));
      expect(lz4Decompress(block, input.length), name).toEqual(input);
    }
  });

  it('follows the reference end-of-block rules', () => {
    for (const [name, input] of lz4Inputs()) {
      const n = input.length;
      const sequences = parseBlock(lz4Compress(input));
      const last = sequences[sequences.length - 1];
      expect(last.matchLength, name).toBe(0);
      expect(last.literals, name).toBeGreaterThanOrEqual(Math.min(n, 5));
      if (n < 13) expect(sequences.length, name).toBe(1);
      for (const s of sequences.slice(0, -1)) {
        const matchStart = s.start + s.literals;
        expect(s.offset, name).toBeGreaterThanOrEqual(1);
        expect(s.offset, name).toBeLessThanOrEqual(Math.min(65535, matchStart));
        expect(matchStart, name).toBeLessThanOrEqual(n - 12);
        expect(matchStart + s.matchLength, name).toBeLessThanOrEqual(n - 5);
      }
    }
  });

  it('encodes an empty input as a single empty sequence', () => {
    expect(lz4Compress(new Uint8Array(0))).toEqual(Uint8Array.of(0));
  });

  it('compresses redundant image data well', () => {
    expect(lz4Compress(new Uint8Array(8192)).length).toBeLessThan(48);
    // A flat-colored RGB565 chart tile: three colors in large regions.
    const chart = bytes(8192, (i) => {
      const p = i >> 1;
      const color = (p & 63) > 20 && (p & 63) < 40 ? 0xf800 : p >> 6 > 30 ? 0x07e0 : 0xffff;
      return i & 1 ? color >> 8 : color & 0xff;
    });
    expect(lz4Compress(chart).length).toBeLessThan(120);
    const text = new TextEncoder().encode('the quick brown fox jumps over the lazy dog. '.repeat(40));
    expect(lz4Compress(text).length).toBeLessThan(text.length / 10);
  });

  it('rejects malformed blocks', () => {
    const input = bytes(3000, (i) => (i * 7) % 251 ^ (i >> 5));
    const block = lz4Compress(input);
    for (let n = 0; n < block.length; n++) {
      expect(() => lz4Decompress(block.subarray(0, n), input.length)).toThrow();
    }
    expect(() => lz4Decompress(block, input.length - 1)).toThrow();
    expect(() => lz4Decompress(block, input.length + 1)).toThrow();
    // A match before any output, and a zero offset.
    expect(() => lz4Decompress(Uint8Array.of(0x00, 0x01, 0x00, 0x00), 4)).toThrow();
    expect(() => lz4Decompress(Uint8Array.of(0x10, 0x41, 0x00, 0x00, 0x00), 5)).toThrow();
    expect(lz4Decompress(Uint8Array.of(0x10, 0x41, 0x01, 0x00, 0x00), 5)).toEqual(bytes(5, () => 0x41));
  });
});

// ---------------------------------------------------------------------------
// DCT

type ImageKind = 'gradient' | 'smooth' | 'edges' | 'noise';

const W = 72;
const H = 56; // partial tiles at the right and bottom edges

function makeImage(kind: ImageKind, gray: boolean): Uint8ClampedArray {
  const random = rng(7);
  const img = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r: number, g: number, b: number;
      if (kind === 'gradient') {
        [r, g, b] = [x * 3.5, y * 4.5, 200 - x * 1.5 + y];
      } else if (kind === 'smooth') {
        r = 128 + 80 * Math.sin(x / 11) * Math.cos(y / 9);
        g = 128 + 70 * Math.sin((x + y) / 15);
        b = 110 + 60 * Math.cos(x / 7 - y / 13);
      } else if (kind === 'noise') {
        [r, g, b] = [random() * 256, random() * 256, random() * 256];
      } else {
        // Black and white checkers, then red and blue ones: sharp luma and chroma edges.
        const on = ((x >> 3) ^ (y >> 3)) & 1;
        [r, g, b] = x < 40 ? [on ? 240 : 20, on ? 240 : 20, on ? 240 : 20] : [on ? 220 : 30, on ? 30 : 60, on ? 40 : 200];
      }
      if (gray) r = g = b = 0.299 * r + 0.587 * g + 0.114 * b;
      const i = (y * W + x) * 4;
      [img[i], img[i + 1], img[i + 2], img[i + 3]] = [r, g, b, 255];
    }
  }
  return img;
}

/** Codes a whole image; returns the PSNR of the decoded RGB (or RGB565) and bits per pixel. */
function codeImage(img: Uint8ClampedArray, mode: DctMode, quality: number, rgb565 = false) {
  let sse = 0;
  let samples = 0;
  let size = 0;
  for (let y0 = 0; y0 < H; y0 += DCT_TILE_SIZE) {
    for (let x0 = 0; x0 < W; x0 += DCT_TILE_SIZE) {
      const tile = encodeDctTile(img, W, x0, y0, W, H, mode, quality);
      const decoded = rgb565 ? decodeDctTile(tile, mode, quality) : decodeDctTileRgb(tile, mode, quality);
      const n = 3 * Math.min(DCT_TILE_SIZE, W - x0) * Math.min(DCT_TILE_SIZE, H - y0);
      sse += (n * 255 * 255) / 10 ** (tilePsnr(decoded, img, W, x0, y0, W, H) / 10); // back to squared error
      samples += n;
      size += tile.length;
    }
  }
  return { psnr: 10 * Math.log10((samples * 255 * 255) / sse), bpp: (size * 8) / (W * H) };
}

describe('dct', () => {
  it('maps image flags to modes as format.h defines them', () => {
    expect(IMGF_GRAY).toBe(1 << 1);
    expect(IMGF_444).toBe(1 << 3);
    expect(DCT_TILE_SIZE).toBe(32);
    expect(dctModeFromFlags(0)).toBe('420');
    expect(dctModeFromFlags(IMGF_444 | 1)).toBe('444');
    expect(dctModeFromFlags(IMGF_GRAY | IMGF_444)).toBe('gray');
    for (const mode of ['420', '444', 'gray'] as DctMode[]) expect(dctModeFromFlags(dctModeFlags(mode))).toBe(mode);
  });

  it('scales the Annex K quantization tables with the IJG formula', () => {
    const [luma50, chroma50] = dctQuantTables(50);
    expect([...luma50.subarray(0, 6)]).toEqual([16, 11, 12, 14, 12, 10]); // zigzag order
    expect([...chroma50.subarray(0, 6)]).toEqual([17, 18, 18, 24, 21, 24]);
    expect(dctQuantTables(75)[0][0]).toBe(8);
    expect(dctQuantTables(10)[0][0]).toBe(80);
    expect([...dctQuantTables(100)[0]].every((q) => q === 1)).toBe(true);
    expect([...dctQuantTables(1)[1]].every((q) => q === 255)).toBe(true);
  });

  // Minimum PSNR (dB) of the decoded RGB, a few dB below measured values.
  const expectations: [ImageKind, DctMode, number, number][] = [
    ['gradient', '420', 50, 38], ['gradient', '420', 85, 41], ['gradient', '444', 85, 44], ['gradient', 'gray', 85, 49],
    ['smooth', '420', 50, 34], ['smooth', '420', 85, 39], ['smooth', '444', 85, 42], ['smooth', 'gray', 85, 49],
    ['edges', '444', 50, 34], ['edges', '444', 85, 42], ['edges', 'gray', 85, 53],
    // 4:2:0 cannot keep sharp chroma edges; this is what 4:4:4 is for.
    ['edges', '420', 85, 22],
    ['noise', '444', 85, 24], ['noise', 'gray', 85, 30], ['noise', 'gray', 95, 40],
  ];

  it.each(expectations)('codes %s images in %s at q%i above %i dB', (kind, mode, quality, minPsnr) => {
    const { psnr } = codeImage(makeImage(kind, mode === 'gray'), mode, quality);
    expect(psnr).toBeGreaterThan(minPsnr);
  });

  it('keeps smooth content above 35 dB at q85 as displayed in RGB565', () => {
    for (const mode of ['420', '444', 'gray'] as DctMode[]) {
      for (const kind of ['gradient', 'smooth'] as ImageKind[]) {
        expect(codeImage(makeImage(kind, mode === 'gray'), mode, 85, true).psnr, `${kind} ${mode}`).toBeGreaterThan(35);
      }
    }
  });

  it('trades size for quality', () => {
    const img = makeImage('smooth', false);
    const sizes = [20, 50, 80, 95].map((q) => codeImage(img, '420', q));
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i].bpp).toBeGreaterThan(sizes[i - 1].bpp);
      expect(sizes[i].psnr).toBeGreaterThan(sizes[i - 1].psnr);
    }
    const gray = codeImage(makeImage('smooth', true), 'gray', 80).bpp;
    const full = codeImage(img, '444', 80).bpp;
    expect(gray).toBeLessThan(sizes[2].bpp);
    expect(sizes[2].bpp).toBeLessThan(full);
  });

  it('reproduces flat colors', () => {
    const colors = [[255, 255, 255], [0, 0, 0], [128, 128, 128], [255, 0, 0], [0, 200, 0], [30, 60, 220], [250, 200, 20]];
    for (const [r, g, b] of colors) {
      const img = new Uint8ClampedArray(DCT_TILE_SIZE * DCT_TILE_SIZE * 4);
      for (let i = 0; i < img.length; i += 4) [img[i], img[i + 1], img[i + 2], img[i + 3]] = [r, g, b, 255];
      for (const mode of ['420', '444'] as DctMode[]) {
        const tile = encodeDctTile(img, DCT_TILE_SIZE, 0, 0, DCT_TILE_SIZE, DCT_TILE_SIZE, mode, 85);
        const rgb = decodeDctTileRgb(tile, mode, 85);
        for (let i = 0; i < rgb.length; i += 3) {
          expect(Math.abs(rgb[i] - r) + Math.abs(rgb[i + 1] - g) + Math.abs(rgb[i + 2] - b)).toBeLessThanOrEqual(6);
        }
      }
    }
    const white = new Uint8ClampedArray(DCT_TILE_SIZE * DCT_TILE_SIZE * 4).fill(255);
    const tile = encodeDctTile(white, DCT_TILE_SIZE, 0, 0, DCT_TILE_SIZE, DCT_TILE_SIZE, '420', 50);
    expect([...decodeDctTile(tile, '420', 50)].every((p) => p === 0xffff)).toBe(true);
  });

  it('replicates edge pixels into partial tiles', () => {
    const w = 40;
    const h = 20;
    const img = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        [img[i], img[i + 1], img[i + 2], img[i + 3]] = [x * 6, y * 12, 100, 255];
      }
    }
    const tile = encodeDctTile(img, w, 32, 0, w, h, '444', 90);
    const rgb = decodeDctTileRgb(tile, '444', 90);
    expect(rgb.length).toBe(DCT_TILE_SIZE * DCT_TILE_SIZE * 3);
    expect(tilePsnr(rgb, img, w, 32, 0, w, h)).toBeGreaterThan(40);
    // Beyond the image the tile continues the last column and row.
    const at = (x: number, y: number) => rgb[(y * DCT_TILE_SIZE + x) * 3];
    expect(Math.abs(at(31, 5) - (w - 1) * 6)).toBeLessThan(6);
    expect(Math.abs(rgb[(31 * DCT_TILE_SIZE + 3) * 3 + 1] - (h - 1) * 12)).toBeLessThan(6);
  });

  it('rejects truncated and corrupt tiles without crashing', () => {
    const img = makeImage('smooth', false);
    const random = rng(3);
    for (const mode of ['420', '444', 'gray'] as DctMode[]) {
      const tile = encodeDctTile(img, W, 0, 0, W, H, mode, 75);
      for (let n = 0; n < tile.length; n++) {
        expect(() => decodeDctTile(tile.subarray(0, n), mode, 75)).toThrow(/dct:/);
      }
      for (let i = 0; i < 300; i++) {
        const bad = tile.slice();
        bad[Math.floor(random() * bad.length)] ^= 1 << Math.floor(random() * 8);
        try {
          expect(decodeDctTile(bad, mode, 75).length).toBe(DCT_TILE_SIZE * DCT_TILE_SIZE);
        } catch (e) {
          expect(String(e)).toMatch(/dct:/);
        }
      }
    }
  });

  it('validates arguments', () => {
    const img = makeImage('gradient', false);
    expect(() => encodeDctTile(img, W, W, 0, W, H, '420', 50)).toThrow(RangeError);
    expect(() => encodeDctTile(img, W, 0, 0, W, H, 'rgb' as DctMode, 50)).toThrow(RangeError);
    expect(() => decodeDctTile(Uint8Array.of(0), 'rgb' as DctMode, 50)).toThrow(RangeError);
    expect(() => encodeDctTile(img.subarray(0, 100), W, 0, 0, W, H, '420', 50)).toThrow(RangeError);
  });
});
