// Turns source pictures into calculator images: crop/orient/adjust in a
// canvas, then pick the best of three encodings (palette, RGB565, DCT).

import { applyPaletteSync, buildPaletteSync, utils } from 'image-q';
import type { Crop, ImageAdjust, ImageQuality } from '../model/types.ts';
import { encodeDctTile, type DctMode } from './dct.ts';
import {
  IMG_DCT,
  IMG_PALETTE,
  IMG_RGB565,
  IMGF_444,
  IMGF_GRAY,
  IMGF_TRANSPARENT,
  type PackedImage,
  type PackedLevel,
  TRANSPARENT_KEY,
} from './format.ts';
import { lz4Compress } from './lz4.ts';

export const TILE_SHIFT = 5;
const TILE = 1 << TILE_SHIFT;

export const DEFAULT_ADJUST: ImageAdjust = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpen: 0,
  grayscale: false,
  invert: false,
  rotate: 0,
  flipX: false,
  flipY: false,
};

export const DEFAULT_QUALITY: ImageQuality = { mode: 'auto', level: 80, colors: 256, dither: true, zoomDetail: 2 };

type Canvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): { canvas: Canvas; ctx: Ctx } {
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })! };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true })! };
}

export interface RenderOptions {
  crop?: Crop;
  adjust?: ImageAdjust;
  /** Composite onto this color; omit to keep transparency. */
  background?: string;
  /** Rounded corners, in output pixels (corners get the background). */
  radius?: number;
}

function orientedSize(src: CanvasImageSource & { width: number; height: number }, rotate: number) {
  return rotate === 90 || rotate === 270 ? { w: src.height, h: src.width } : { w: src.width, h: src.height };
}

function filterString(a: ImageAdjust): string {
  const parts: string[] = [];
  if (a.brightness) parts.push(`brightness(${100 + a.brightness}%)`);
  if (a.contrast) parts.push(`contrast(${100 + a.contrast}%)`);
  if (a.saturation) parts.push(`saturate(${100 + a.saturation}%)`);
  if (a.grayscale) parts.push('grayscale(100%)');
  if (a.invert) parts.push('invert(100%)');
  return parts.join(' ') || 'none';
}

function unsharp(img: ImageData, amount: number) {
  const { width: w, height: h, data } = img;
  const src = new Uint8ClampedArray(data);
  const k = amount / 100;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const blur = (src[i - 4 + c] + src[i + 4 + c] + src[i - w * 4 + c] + src[i + w * 4 + c]) / 4;
        data[i + c] = src[i + c] + (src[i + c] - blur) * k * 1.5;
      }
    }
  }
}

/** Draws a source into a w×h image with high-quality downscaling. */
export function renderSource(
  source: CanvasImageSource & { width: number; height: number },
  w: number,
  h: number,
  opts: RenderOptions = {},
): ImageData {
  const adjust = opts.adjust ?? DEFAULT_ADJUST;
  const rot = adjust.rotate;
  const oriented = orientedSize(source, rot);
  const crop = opts.crop ?? { x: 0, y: 0, w: 1, h: 1 };

  // Orient first so crops are expressed in what the user sees.
  let current: Canvas | (CanvasImageSource & { width: number; height: number }) = source;
  if (rot || adjust.flipX || adjust.flipY) {
    const { canvas, ctx } = makeCanvas(oriented.w, oriented.h);
    ctx.translate(oriented.w / 2, oriented.h / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.scale(adjust.flipX ? -1 : 1, adjust.flipY ? -1 : 1);
    ctx.drawImage(source, -source.width / 2, -source.height / 2);
    current = canvas;
  }
  let sx = crop.x * oriented.w;
  let sy = crop.y * oriented.h;
  let sw = Math.max(1, crop.w * oriented.w);
  let sh = Math.max(1, crop.h * oriented.h);

  // Halve repeatedly while far larger than the target (sharper results).
  while (sw / 2 >= w * 1.5 && sh / 2 >= h * 1.5) {
    const { canvas, ctx } = makeCanvas(sw / 2, sh / 2);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current as CanvasImageSource, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    current = canvas;
    sx = 0;
    sy = 0;
    sw = canvas.width;
    sh = canvas.height;
  }

  const { ctx } = makeCanvas(w, h);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const filter = filterString(adjust);
  if (filter !== 'none') ctx.filter = filter;
  ctx.drawImage(current as CanvasImageSource, sx, sy, sw, sh, 0, 0, Math.round(w), Math.round(h));
  ctx.filter = 'none';
  const img = ctx.getImageData(0, 0, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  if (adjust.sharpen) unsharp(img, adjust.sharpen);
  if (opts.radius) roundCorners(img, opts.radius, opts.background);
  return img;
}

function roundCorners(img: ImageData, radius: number, background?: string) {
  const { width: w, height: h, data } = img;
  const r = Math.min(radius, w / 2, h / 2);
  const bg = background ? hexToRgb(background) : null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x < r ? r : x >= w - r ? w - r : -1;
      const cy = y < r ? r : y >= h - r ? h - r : -1;
      if (cx < 0 || cy < 0) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const cover = Math.max(0, Math.min(1, r - d + 0.5));
      if (cover >= 1) continue;
      const i = (y * w + x) * 4;
      if (bg) {
        for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * cover + bg[c] * (1 - cover);
      } else {
        data[i + 3] = data[i + 3] * cover;
      }
    }
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const to565 = (r: number, g: number, b: number) => ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);

interface Analysis {
  colors: Map<number, number>; // rgb565 -> count (capped at 257 entries)
  many: boolean;
  gray: boolean;
  transparent: boolean;
  topCoverage: number; // share of pixels covered by the 32 most common colors
}

function analyze(img: ImageData): Analysis {
  const { data } = img;
  const colors = new Map<number, number>();
  let many = false;
  let gray = true;
  let transparent = false;
  const step = Math.max(1, Math.floor(data.length / 4 / 250000));
  let sampled = 0;
  for (let i = 0; i < data.length; i += 4 * step) {
    sampled++;
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) {
      transparent = true;
      continue;
    }
    if (gray && (Math.abs(r - g) > 6 || Math.abs(g - b) > 6)) gray = false;
    const c = to565(r, g, b);
    const n = colors.get(c);
    if (n !== undefined) colors.set(c, n + 1);
    else if (colors.size <= 4096) colors.set(c, 1);
    else many = true;
  }
  const counts = [...colors.values()].sort((a, b) => b - a);
  const top = counts.slice(0, 32).reduce((a, b) => a + b, 0);
  return { colors, many: many || colors.size > 256, gray, transparent, topCoverage: sampled ? top / sampled : 1 };
}

function tileGrid(w: number, h: number) {
  return { tilesX: Math.ceil(w / TILE), tilesY: Math.ceil(h / TILE) };
}

function bppFor(count: number): number {
  return count <= 2 ? 1 : count <= 4 ? 2 : count <= 16 ? 4 : 8;
}

function packIndices(indices: Uint8Array, w: number, h: number, bpp: number): Uint8Array[] {
  const { tilesX, tilesY } = tileGrid(w, h);
  const tiles: Uint8Array[] = [];
  const perByte = 8 / bpp;
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const out = new Uint8Array((TILE * TILE * bpp) / 8);
      for (let y = 0; y < TILE; y++) {
        const sy = Math.min(ty * TILE + y, h - 1);
        for (let x = 0; x < TILE; x++) {
          const sx = Math.min(tx * TILE + x, w - 1);
          const i = y * TILE + x;
          const v = indices[sy * w + sx];
          out[(i / perByte) | 0] |= v << (8 - bpp * ((i % perByte) + 1));
        }
      }
      tiles.push(lz4Compress(out));
    }
  }
  return tiles;
}

function encodePalette(levels: ImageData[], a: Analysis, q: ImageQuality, transparent: boolean): PackedImage {
  const reserve = transparent ? 1 : 0;
  const maxColors = Math.max(2, Math.min(256 - reserve, q.colors));
  let palette: number[];
  let mapped: Uint8Array[];

  if (!a.many && a.colors.size <= maxColors) {
    // Exact: every color already fits.
    palette = [...a.colors.keys()];
    const index = new Map<number, number>();
    palette.forEach((c, i) => index.set(c, i + reserve));
    mapped = levels.map((img) => {
      const out = new Uint8Array(img.width * img.height);
      const d = img.data;
      for (let p = 0, i = 0; p < out.length; p++, i += 4) {
        if (transparent && d[i + 3] < 128) continue;
        const c = to565(d[i], d[i + 1], d[i + 2]);
        out[p] = index.get(c) ?? nearestIndex(palette, c) + reserve;
      }
      return out;
    });
  } else {
    const largest = levels[levels.length - 1];
    const sample = largest.width * largest.height > 1_500_000 ? levels[0] : largest;
    const pal = buildPaletteSync([utils.PointContainer.fromUint8Array(sample.data, sample.width, sample.height)], {
      colors: maxColors,
      paletteQuantization: 'wuquant',
      colorDistanceFormula: 'euclidean-bt709-noalpha',
    });
    const points = pal.getPointContainer().getPointArray();
    palette = points.map((p) => to565(p.r, p.g, p.b));
    const lookup = new Map<number, number>();
    points.forEach((p, i) => lookup.set((p.r << 16) | (p.g << 8) | p.b, i + reserve));
    mapped = levels.map((img) => {
      const result = applyPaletteSync(utils.PointContainer.fromUint8Array(img.data, img.width, img.height), pal, {
        colorDistanceFormula: 'euclidean-bt709-noalpha',
        imageQuantization: q.dither ? 'floyd-steinberg' : 'nearest',
      }).toUint8Array();
      const out = new Uint8Array(img.width * img.height);
      for (let p = 0, i = 0; p < out.length; p++, i += 4) {
        if (transparent && img.data[i + 3] < 128) continue;
        out[p] = lookup.get((result[i] << 16) | (result[i + 1] << 8) | result[i + 2]) ?? reserve;
      }
      return out;
    });
  }

  // The transparent key must never appear as a real color.
  palette = palette.map((c) => (c === TRANSPARENT_KEY ? 0 : c));
  if (transparent) palette = [0, ...palette];
  const bpp = bppFor(palette.length);
  const packedLevels: PackedLevel[] = levels.map((img, i) => ({
    width: img.width,
    height: img.height,
    ...tileGrid(img.width, img.height),
    bpp,
    quality: 0,
    tiles: packIndices(mapped[i], img.width, img.height, bpp),
  }));
  return {
    width: levels[0].width,
    height: levels[0].height,
    format: IMG_PALETTE,
    flags: transparent ? IMGF_TRANSPARENT : 0,
    tileShift: TILE_SHIFT,
    palette,
    levels: packedLevels,
  };
}

function nearestIndex(palette: number[], c: number): number {
  const r = c >> 11, g = (c >> 5) & 63, b = c & 31;
  let best = 0, bestD = Infinity;
  palette.forEach((p, i) => {
    const d = ((p >> 11) - r) ** 2 * 4 + (((p >> 5) & 63) - g) ** 2 + ((p & 31) - b) ** 2 * 4;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

function encodeRgb565(levels: ImageData[]): PackedImage {
  const packedLevels = levels.map((img) => {
    const { tilesX, tilesY } = tileGrid(img.width, img.height);
    const tiles: Uint8Array[] = [];
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const out = new Uint8Array(TILE * TILE * 2);
        for (let y = 0; y < TILE; y++) {
          const sy = Math.min(ty * TILE + y, img.height - 1);
          for (let x = 0; x < TILE; x++) {
            const sx = Math.min(tx * TILE + x, img.width - 1);
            const i = (sy * img.width + sx) * 4;
            const c = to565(img.data[i], img.data[i + 1], img.data[i + 2]);
            out[(y * TILE + x) * 2] = c & 0xff;
            out[(y * TILE + x) * 2 + 1] = c >> 8;
          }
        }
        tiles.push(lz4Compress(out));
      }
    }
    return { width: img.width, height: img.height, tilesX, tilesY, bpp: 16, quality: 0, tiles };
  });
  return { width: levels[0].width, height: levels[0].height, format: IMG_RGB565, flags: 0, tileShift: TILE_SHIFT, levels: packedLevels };
}

function encodeDct(levels: ImageData[], mode: DctMode, quality: number): PackedImage {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  const packedLevels = levels.map((img) => {
    const { tilesX, tilesY } = tileGrid(img.width, img.height);
    const tiles: Uint8Array[] = [];
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        tiles.push(encodeDctTile(img.data, img.width, tx * TILE, ty * TILE, img.width, img.height, mode, q));
      }
    }
    return { width: img.width, height: img.height, tilesX, tilesY, bpp: 0, quality: q, tiles };
  });
  const flags = mode === 'gray' ? IMGF_GRAY : mode === '444' ? IMGF_444 : 0;
  return { width: levels[0].width, height: levels[0].height, format: IMG_DCT, flags, tileShift: TILE_SHIFT, levels: packedLevels };
}

const size = (img: PackedImage) => img.levels.reduce((n, l) => n + l.tiles.reduce((m, t) => m + t.length + 4, 0), 0);

/**
 * Encodes one picture. `levels` are renderings of the same picture at
 * increasing sizes (level 0 is the size it has in the scene).
 */
/** How each shrink step limits picture quality and resolution. */
export const SHRINK_STEPS = [
  { level: 100, colors: 256, detail: 4, scale: 1 },
  { level: 68, colors: 128, detail: 2, scale: 1 },
  { level: 52, colors: 64, detail: 1, scale: 0.85 },
  { level: 38, colors: 32, detail: 1, scale: 0.7 },
] as const;

export function shrinkQuality(q: ImageQuality, shrink: number): ImageQuality {
  if (!shrink) return q;
  const t = SHRINK_STEPS[Math.min(shrink, SHRINK_STEPS.length - 1)];
  return {
    ...q,
    level: Math.min(q.level, t.level),
    colors: Math.min(q.colors, t.colors),
    zoomDetail: Math.min(q.zoomDetail, t.detail) as ImageQuality['zoomDetail'],
  };
}

export function encodeImage(levels: ImageData[], q: ImageQuality, keepAlpha = false, shrink = 0): PackedImage {
  const a = analyze(levels[0]);
  const transparent = keepAlpha && a.transparent;
  switch (q.mode) {
    case 'crisp':
      return encodePalette(levels, a, q, transparent);
    case 'photo':
      if (transparent) return encodePalette(levels, a, q, true);
      return encodeDct(levels, a.gray ? 'gray' : q.level >= 88 ? '444' : '420', q.level);
    case 'compact':
      if (transparent || (!a.many && a.colors.size <= 16)) return encodePalette(levels, a, { ...q, colors: Math.min(q.colors, 64) }, transparent);
      return encodeDct(levels, a.gray ? 'gray' : '420', Math.min(50, q.level));
    default: {
      if (transparent || (!a.many && a.colors.size <= q.colors)) return encodePalette(levels, a, q, transparent);
      if (a.topCoverage >= 0.7) {
        // Charts and screenshots: keep edges crisp; take whichever is smaller.
        const palette = encodePalette(levels, a, q, false);
        const dct = encodeDct(levels, a.gray ? 'gray' : shrink ? '420' : '444', shrink ? Math.min(90, q.level + 20) : 90);
        return size(palette) <= size(dct) * 1.15 ? palette : dct;
      }
      return encodeDct(levels, a.gray ? 'gray' : '420', shrink ? q.level : Math.max(q.level, 60));
    }
  }
}

export function packedSize(img: PackedImage): number {
  return size(img) + (img.palette ? img.palette.length * 2 + 4 : 0) + img.levels.length * 16 + 16;
}

/** Level sizes for a picture shown at w×h with extra detail for zooming. */
export function levelSizes(w: number, h: number, sourceW: number, sourceH: number, detail: number): { w: number; h: number }[] {
  const sizes = [{ w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }];
  const maxScale = Math.min(sourceW / w, sourceH / h);
  const factors = detail <= 1 ? [] : detail === 2 ? [2] : detail === 3 ? [3] : [2, 4];
  for (const z of factors) {
    const s = Math.min(z, maxScale);
    if (s < 1.25) break;
    const next = { w: Math.round(w * s), h: Math.round(h * s) };
    if (next.w <= sizes[sizes.length - 1].w) break;
    // Never keep more than ~4 megapixels of detail per picture.
    if (next.w * next.h > 4_000_000) break;
    sizes.push(next);
  }
  return sizes;
}

export { encodeRgb565 };

/** Encodes animation frames (all the same size). Graphic animations share one
 * palette; photographic ones (e.g. from videos) use DCT per frame. */
export function encodeAnimation(frames: ImageData[], q: ImageQuality): PackedImage[] {
  if (!frames.length) return [];
  const sample = frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length / 6)) === 0).slice(0, 6);
  const analyses = sample.map(analyze);
  const photographic = q.mode === 'photo' || (q.mode !== 'crisp' && analyses.some((a) => a.many && a.topCoverage < 0.7));
  if (photographic) {
    const gray = analyses.every((a) => a.gray);
    const quality = q.mode === 'compact' ? 50 : Math.min(q.level, 75);
    return frames.map((f) => encodeDct([f], gray ? 'gray' : '420', quality));
  }
  const colors = Math.max(2, Math.min(256, q.colors));
  const pal = buildPaletteSync(
    sample.map((f) => utils.PointContainer.fromUint8Array(f.data, f.width, f.height)),
    { colors, paletteQuantization: 'wuquant', colorDistanceFormula: 'euclidean-bt709-noalpha' },
  );
  const points = pal.getPointContainer().getPointArray();
  const palette = points.map((p) => {
    const c = to565(p.r, p.g, p.b);
    return c === TRANSPARENT_KEY ? 0 : c;
  });
  const lookup = new Map<number, number>();
  points.forEach((p, i) => lookup.set((p.r << 16) | (p.g << 8) | p.b, i));
  const bpp = bppFor(palette.length);
  return frames.map((f) => {
    const result = applyPaletteSync(utils.PointContainer.fromUint8Array(f.data, f.width, f.height), pal, {
      colorDistanceFormula: 'euclidean-bt709-noalpha',
      imageQuantization: q.dither ? 'floyd-steinberg' : 'nearest',
    }).toUint8Array();
    const indices = new Uint8Array(f.width * f.height);
    for (let p = 0, i = 0; p < indices.length; p++, i += 4) {
      indices[p] = lookup.get((result[i] << 16) | (result[i + 1] << 8) | result[i + 2]) ?? 0;
    }
    return {
      width: f.width,
      height: f.height,
      format: IMG_PALETTE,
      flags: 0,
      tileShift: TILE_SHIFT,
      palette,
      levels: [{ width: f.width, height: f.height, ...tileGrid(f.width, f.height), bpp, quality: 0, tiles: packIndices(indices, f.width, f.height, bpp) }],
    };
  });
}
