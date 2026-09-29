// Pre-rasterizes the glyphs a bundle uses. The browser does the font
// rendering (any font, any script); the calculator just blits coverage masks.

import type { FontFamily } from '../model/types.ts';
import type { FontGlyph, PackedFont } from './format.ts';

export interface FontSpec {
  family: FontFamily;
  size: number; // px
  bold: boolean;
  italic: boolean;
}

const FAMILY_CSS: Record<FontFamily, string> = {
  inter: '"Inter", system-ui, sans-serif',
  atkinson: '"Atkinson Hyperlegible", system-ui, sans-serif',
  lora: '"Lora", Georgia, serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};

export const FAMILY_LABELS: Record<FontFamily, string> = {
  inter: 'Inter',
  atkinson: 'Atkinson (extra legible)',
  lora: 'Lora (serif)',
  mono: 'JetBrains Mono',
  system: 'System (all languages)',
};

export function cssFont(spec: FontSpec): string {
  return `${spec.italic ? 'italic ' : ''}${spec.bold ? 700 : 400} ${spec.size}px ${FAMILY_CSS[spec.family]}`;
}

/** Makes sure web fonts are loaded before measuring. */
export async function loadFonts(specs: FontSpec[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(specs.map((s) => document.fonts.load(cssFont(s), 'Ag').catch(() => [])));
}

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeContext(w: number, h: number): Ctx2D {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    return c.getContext('2d', { willReadFrequently: true })!;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true })!;
}

let measureCtx: Ctx2D | null = null;
function measurer(): Ctx2D {
  measureCtx ??= makeContext(8, 8);
  return measureCtx;
}

/** A font at one size and style, measured on demand and rasterized at the end. */
export class PackFont {
  readonly spec: FontSpec;
  readonly ascent: number;
  readonly descent: number;
  readonly lineHeight: number;
  private advances = new Map<number, number>();
  readonly used = new Set<number>();

  constructor(spec: FontSpec) {
    this.spec = spec;
    const ctx = measurer();
    ctx.font = cssFont(spec);
    const m = ctx.measureText('Hgjpq|ÉÅ');
    const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent ?? spec.size * 0.9;
    const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent ?? spec.size * 0.25;
    this.ascent = Math.ceil(ascent);
    this.descent = Math.ceil(descent);
    this.lineHeight = this.ascent + this.descent;
  }

  /** Advance in 1/16 px (what the calculator accumulates). */
  advance16(cp: number): number {
    let a = this.advances.get(cp);
    if (a === undefined) {
      const ctx = measurer();
      ctx.font = cssFont(this.spec);
      a = Math.round(ctx.measureText(String.fromCodePoint(cp)).width * 16);
      this.advances.set(cp, a);
    }
    return a;
  }

  /** Width in px of a string, the way the calculator will lay it out. */
  width(text: string): number {
    let w = 0;
    for (const ch of text) w += this.advance16(ch.codePointAt(0)!);
    return Math.ceil(w / 16);
  }

  use(text: string) {
    for (const ch of text) this.used.add(ch.codePointAt(0)!);
  }

  useCodepoints(cps: Iterable<number>) {
    for (const cp of cps) this.used.add(cp);
  }

  pack(bpp: 1 | 2 | 4 = 4): PackedFont {
    this.used.add(32);
    this.used.add(0x3f); // '?' is the fallback glyph
    const glyphs: FontGlyph[] = [];
    for (const cp of this.used) glyphs.push(rasterize(this, cp, bpp));
    return { lineHeight: this.lineHeight, ascent: this.ascent, descent: this.descent, bpp, glyphs, fallback: 0x3f };
  }
}

const glyphCache = new Map<string, FontGlyph>();

function rasterize(face: PackFont, cp: number, bpp: 1 | 2 | 4): FontGlyph {
  const key = `${cssFont(face.spec)}|${cp}|${bpp}`;
  const cached = glyphCache.get(key);
  if (cached) return cached;
  const ch = String.fromCodePoint(cp);
  const advance16 = face.advance16(cp);
  const ctx0 = measurer();
  ctx0.font = cssFont(face.spec);
  const m = ctx0.measureText(ch);
  const left = Math.floor(-m.actualBoundingBoxLeft);
  const right = Math.ceil(m.actualBoundingBoxRight);
  const top = Math.ceil(m.actualBoundingBoxAscent);
  const bottom = Math.ceil(m.actualBoundingBoxDescent);
  const w = Math.max(0, right - left);
  const h = Math.max(0, top + bottom);
  let glyph: FontGlyph;
  if (cp === 32 || w === 0 || h === 0) {
    glyph = { codepoint: cp, advance16, bx: 0, by: 0, w: 0, h: 0, bitmap: new Uint8Array(0) };
  } else {
    const pad = 2;
    const ctx = makeContext(w + pad * 2, h + pad * 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w + pad * 2, h + pad * 2);
    ctx.fillStyle = '#fff';
    ctx.font = cssFont(face.spec);
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(ch, pad - left, pad + top);
    const data = ctx.getImageData(0, 0, w + pad * 2, h + pad * 2).data;
    // Trim to the inked area (measureText boxes are sometimes generous).
    let x0 = w + pad * 2, y0 = h + pad * 2, x1 = -1, y1 = -1;
    for (let y = 0; y < h + pad * 2; y++) {
      for (let x = 0; x < w + pad * 2; x++) {
        if (data[(y * (w + pad * 2) + x) * 4] > 24) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      }
    }
    if (x1 < 0) {
      glyph = { codepoint: cp, advance16, bx: 0, by: 0, w: 0, h: 0, bitmap: new Uint8Array(0) };
    } else {
      const gw = x1 - x0 + 1;
      const gh = y1 - y0 + 1;
      const levels = (1 << bpp) - 1;
      const stride = Math.ceil((gw * bpp) / 8);
      const bitmap = new Uint8Array(stride * gh);
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const v = data[((y + y0) * (w + pad * 2) + (x + x0)) * 4];
          const q = Math.round((v / 255) * levels);
          const bit = x * bpp;
          bitmap[y * stride + (bit >> 3)] |= q << (8 - bpp - (bit & 7));
        }
      }
      glyph = {
        codepoint: cp,
        advance16,
        bx: x0 - pad + left,
        by: pad + top - y0,
        w: gw,
        h: gh,
        bitmap,
      };
    }
  }
  glyphCache.set(key, glyph);
  return glyph;
}

/** Collects the fonts a bundle uses and assigns their indices. */
export class FontSet {
  private faces: PackFont[] = [];
  private byKey = new Map<string, number>();

  get(spec: FontSpec): { index: number; face: PackFont } {
    const size = Math.max(6, Math.min(96, Math.round(spec.size)));
    const normalized = { ...spec, size };
    const key = cssFont(normalized);
    let index = this.byKey.get(key);
    if (index === undefined) {
      index = this.faces.length;
      this.faces.push(new PackFont(normalized));
      this.byKey.set(key, index);
    }
    return { index, face: this.faces[index] };
  }

  face(index: number): PackFont {
    return this.faces[index];
  }

  pack(): PackedFont[] {
    return this.faces.map((f) => f.pack(4));
  }
}
