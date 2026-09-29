// Binary writer for the NumNotes bundle. Mirrors viewer/src/format.h; keep
// the two in sync.

export const BUNDLE_MAGIC = 0x31424e4e; // "NNB1"
export const BUNDLE_VERSION = 1;

export const START_HOME = 0;
export const START_FIRST_SECTION = 1;
export const START_RESUME = 2;

export const SET_NOTES = 1 << 0;
export const SET_BATTERY = 1 << 1;
export const SET_HINTS = 1 << 2;
export const SET_SEARCH = 1 << 3;
export const SET_BOOKMARKS = 1 << 4;
export const SET_DARK_UI = 1 << 5;

export const MODE_SLIDES = 0;
export const MODE_DOCUMENT = 1;
export const MODE_CANVAS = 2;
export const MODE_GALLERY = 3;
export const MODE_NOTES = 4;

export const SEC_LOOP = 1 << 0;
export const SEC_AUTOPLAY = 1 << 1;
export const SEC_TRANSITION = 1 << 2;
export const SEC_PAGE_NUMBERS = 1 << 3;
export const SEC_STATUS_BAR = 1 << 4;
export const SEC_MINIMAP = 1 << 5;
export const SEC_HIDDEN = 1 << 6;
export const SEC_CAPTIONS = 1 << 7;

export const SCENE_CENTER = 1 << 0;
export const SCENE_SORTED = 1 << 1;

export const PRIM_RECT = 1;
export const PRIM_IMAGE = 2;
export const PRIM_TEXT = 3;
export const PRIM_LINE = 4;
export const PRIM_ELLIPSE = 5;
export const PRIM_ANIM = 6;

export const TEXT_UNDERLINE = 1 << 0;
export const TEXT_STRIKE = 1 << 1;

export const ITEM_IMAGE = 1;
export const ITEM_ANIM = 2;
export const ITEM_STOP = 3;
export const ITEM_HEADING = 4;
export const ITEM_CELL = 5;
export const ITEM_LINK = 6;

export const FONT_WIDE = 1 << 0;

export const IMG_PALETTE = 1;
export const IMG_RGB565 = 2;
export const IMG_DCT = 3;

export const IMGF_TRANSPARENT = 1 << 0;
export const IMGF_GRAY = 1 << 1;
export const IMGF_SMOOTH = 1 << 2;
export const IMGF_444 = 1 << 3;

/** Decoded palette tiles use this value for transparent pixels. */
export const TRANSPARENT_KEY = 0x0020;

export const ICONS = [
  'slides',
  'document',
  'canvas',
  'gallery',
  'notes',
  'calendar',
  'star',
  'book',
  'flask',
  'chart',
  'heart',
  'music',
] as const;
export type IconName = (typeof ICONS)[number];

export function rgb565(hex: string): number {
  const v = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

/** Growable little-endian byte buffer. */
export class ByteWriter {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  length = 0;

  private ensure(extra: number) {
    if (this.length + extra <= this.buf.length) return;
    let size = this.buf.length;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number) {
    this.ensure(1);
    this.view.setUint8(this.length, v);
    this.length += 1;
  }
  i8(v: number) {
    this.ensure(1);
    this.view.setInt8(this.length, v);
    this.length += 1;
  }
  u16(v: number) {
    this.ensure(2);
    this.view.setUint16(this.length, v, true);
    this.length += 2;
  }
  i16(v: number) {
    this.ensure(2);
    this.view.setInt16(this.length, v, true);
    this.length += 2;
  }
  u32(v: number) {
    this.ensure(4);
    this.view.setUint32(this.length, v >>> 0, true);
    this.length += 4;
  }
  i32(v: number) {
    this.ensure(4);
    this.view.setInt32(this.length, v | 0, true);
    this.length += 4;
  }
  bytes(data: Uint8Array) {
    this.ensure(data.length);
    this.buf.set(data, this.length);
    this.length += data.length;
  }
  align(n = 4) {
    while (this.length % n) this.u8(0);
  }
  patchU32(offset: number, v: number) {
    this.view.setUint32(offset, v >>> 0, true);
  }
  patchU16(offset: number, v: number) {
    this.view.setUint16(offset, v, true);
  }
  finish(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

// ---- In-memory bundle model, written by BundleWriter ----

export interface FontGlyph {
  codepoint: number;
  advance16: number; // 12.4 fixed point
  bx: number;
  by: number;
  w: number;
  h: number;
  bitmap: Uint8Array; // rows byte aligned, `bpp` bits per pixel
}

export interface PackedFont {
  lineHeight: number;
  ascent: number;
  descent: number;
  bpp: 1 | 2 | 4;
  glyphs: FontGlyph[]; // any order; sorted when written
  fallback: number; // codepoint used for missing characters
}

export interface PackedLevel {
  width: number;
  height: number;
  tilesX: number;
  tilesY: number;
  bpp: number;
  quality: number;
  tiles: Uint8Array[];
}

export interface PackedImage {
  width: number;
  height: number;
  format: number;
  flags: number;
  tileShift: number;
  palette?: number[]; // RGB565
  levels: PackedLevel[];
}

export interface PackedAnim {
  width: number;
  height: number;
  loops: number;
  frames: { image: number; delayMs: number }[];
}

interface PrimBase {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Prim =
  | (PrimBase & { type: 'rect'; color: number; alpha: number; radius: number; borderColor: number; borderWidth: number })
  | (PrimBase & { type: 'image'; image: number })
  | (PrimBase & { type: 'anim'; anim: number })
  | (PrimBase & { type: 'text'; font: number; color: number; codepoints: number[]; spaceExtra16: number; underline?: boolean; strike?: boolean })
  | (PrimBase & { type: 'line'; x0: number; y0: number; x1: number; y1: number; color: number; width: number; arrows: number })
  | (PrimBase & { type: 'ellipse'; fill: number; stroke: number; strokeWidth: number; filled: boolean });

export interface PackedItem {
  kind: number;
  flags: number;
  ref: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
}

export interface PackedScene {
  width: number;
  height: number;
  bg: number;
  flags: number;
  prims: Prim[];
  items: PackedItem[];
}

export interface PackedSection {
  title: string;
  subtitle?: string;
  mode: number;
  icon: number;
  flags: number;
  firstScene: number;
  sceneCount: number;
  iconColor: number;
  bg: number;
  autoplayDs: number;
  zoomMin: number; // 8.8, 0 = default
  zoomMax: number;
  zoomStart: number;
}

export interface PackedSettings {
  appName: string;
  projectId: number;
  bg: number;
  fg: number;
  accent: number;
  accentFg: number;
  dim: number;
  panel: number;
  line: number;
  highlight: number;
  uiFont: number;
  uiFontBold: number;
  titleFont: number;
  start: number;
  flags: number;
}

export interface SearchEntry {
  section: number;
  scene: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface BundleModel {
  settings: PackedSettings;
  sections: PackedSection[];
  scenes: PackedScene[];
  fonts: PackedFont[];
  images: PackedImage[];
  anims: PackedAnim[];
  notes: string[];
  search: SearchEntry[];
}

export interface BundleStats {
  total: number;
  images: number;
  fonts: number;
  scenes: number;
  other: number;
  perImage: number[];
}

const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
const clampU16 = (v: number) => Math.max(0, Math.min(65535, Math.round(v)));

function primBox(p: Prim): PrimBase {
  if (p.type === 'line') {
    const pad = Math.ceil(p.width / 2) + (p.arrows ? 4 + p.width * 3 : 0);
    const x = Math.floor(Math.min(p.x0, p.x1) - pad);
    const y = Math.floor(Math.min(p.y0, p.y1) - pad);
    return { x, y, w: Math.ceil(Math.abs(p.x1 - p.x0) + 2 * pad), h: Math.ceil(Math.abs(p.y1 - p.y0) + 2 * pad) };
  }
  return { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), h: Math.round(p.h) };
}

export function writeBundle(model: BundleModel): { data: Uint8Array; stats: BundleStats } {
  const w = new ByteWriter();
  const strings = new Map<string, number>();
  const str = (s: string | undefined): number => {
    if (!s) return 0;
    const known = strings.get(s);
    if (known !== undefined) return known;
    const offset = w.length;
    w.bytes(new TextEncoder().encode(s));
    w.u8(0);
    strings.set(s, offset);
    return offset;
  };

  // Header placeholder.
  for (let i = 0; i < 16; i++) w.u32(0);

  // Fonts: sort glyphs by codepoint, write bitmaps then glyph tables.
  const fontStart = w.length;
  const fontGlyphIndex: Map<number, number>[] = [];
  const fontEntries: { glyphs: number; bitmaps: number; font: PackedFont; sorted: FontGlyph[] }[] = [];
  for (const font of model.fonts) {
    const sorted = [...font.glyphs].sort((a, b) => a.codepoint - b.codepoint);
    const index = new Map<number, number>();
    sorted.forEach((g, i) => index.set(g.codepoint, i));
    fontGlyphIndex.push(index);
    const bitmaps = w.length;
    const offsets: number[] = [];
    for (const g of sorted) {
      offsets.push(w.length - bitmaps);
      w.bytes(g.bitmap);
    }
    w.align();
    const glyphs = w.length;
    sorted.forEach((g, i) => {
      w.u32(g.codepoint);
      w.u16(clampU16(g.advance16));
      w.i8(Math.max(-128, Math.min(127, g.bx)));
      w.i8(Math.max(-128, Math.min(127, g.by)));
      w.u8(Math.min(255, g.w));
      w.u8(Math.min(255, g.h));
      w.u16(0);
      w.u32(offsets[i]);
    });
    fontEntries.push({ glyphs, bitmaps, font, sorted });
  }
  const fontBytes = w.length - fontStart;

  // Images: tiles, tile tables, palettes, level tables.
  const perImage: number[] = [];
  const imageEntries: { palette: number; levels: number; image: PackedImage }[] = [];
  const palettes = new Map<number[], number>(); // animation frames share one
  for (const image of model.images) {
    const start = w.length;
    const levelTables: number[] = [];
    for (const level of image.levels) {
      const tileOffsets: number[] = [];
      for (const tile of level.tiles) {
        tileOffsets.push(w.length);
        w.bytes(tile);
      }
      tileOffsets.push(w.length);
      w.align();
      levelTables.push(w.length);
      for (const off of tileOffsets) w.u32(off);
    }
    let palette = 0;
    if (image.palette) {
      palette = palettes.get(image.palette) ?? 0;
      if (!palette) {
        palette = w.length;
        w.u16(image.palette.length);
        for (const c of image.palette) w.u16(c);
        w.align();
        palettes.set(image.palette, palette);
      }
    }
    const levels = w.length;
    image.levels.forEach((level, i) => {
      w.u16(level.width);
      w.u16(level.height);
      w.u16(level.tilesX);
      w.u16(level.tilesY);
      w.u8(level.bpp);
      w.u8(level.quality);
      w.u16(0);
      w.u32(levelTables[i]);
    });
    imageEntries.push({ palette, levels, image });
    perImage.push(w.length - start);
  }
  const imageBytes = perImage.reduce((a, b) => a + b, 0);

  // Animation frame tables.
  const animFrames: number[] = [];
  for (const anim of model.anims) {
    animFrames.push(w.length);
    for (const f of anim.frames) {
      w.u16(f.image);
      w.u16(clampU16(f.delayMs));
    }
    w.align();
  }

  // Scenes: primitive streams, offset tables, items.
  const sceneStart = w.length;
  const sceneEntries: { prims: number; items: number; maxH: number; scene: PackedScene }[] = [];
  for (const scene of model.scenes) {
    const offsets: number[] = [];
    let maxH = 0;
    for (const p of scene.prims) {
      const box = primBox(p);
      maxH = Math.max(maxH, box.h);
      offsets.push(w.length);
      writePrim(w, p, box, fontGlyphIndex, model.fonts);
    }
    const prims = w.length;
    for (const off of offsets) w.u32(off);
    const texts = scene.items.map((it) => str(it.text));
    w.align();
    const items = w.length;
    scene.items.forEach((it, i) => {
      w.u8(it.kind);
      w.u8(it.flags);
      w.u16(it.ref);
      w.i32(Math.round(it.x));
      w.i32(Math.round(it.y));
      w.u16(clampU16(it.w));
      w.u16(clampU16(it.h));
      w.u32(texts[i]);
    });
    sceneEntries.push({ prims, items, maxH, scene });
  }
  const sceneBytes = w.length - sceneStart;

  // Strings referenced by the tables below are written as they come up;
  // tables must be 4-byte aligned, so align after each string burst.
  const sectionStrings = model.sections.map((s) => [str(s.title), str(s.subtitle)]);
  const noteStrings = model.notes.map((n) => str(n));
  const searchStrings = model.search.map((e) => str(e.text));
  const appName = str(model.settings.appName);
  w.align();

  const settingsOff = w.length;
  const st = model.settings;
  w.u32(appName);
  w.u32(st.projectId);
  for (const c of [st.bg, st.fg, st.accent, st.accentFg, st.dim, st.panel, st.line, st.highlight]) w.u16(c);
  w.u16(st.uiFont);
  w.u16(st.uiFontBold);
  w.u16(st.titleFont);
  w.u8(st.start);
  w.u8(st.flags);
  w.u32(0);
  w.u32(0);

  const sectionsOff = w.length;
  model.sections.forEach((s, i) => {
    w.u32(sectionStrings[i][0]);
    w.u32(sectionStrings[i][1]);
    w.u8(s.mode);
    w.u8(s.icon);
    w.u16(s.flags);
    w.u16(s.firstScene);
    w.u16(s.sceneCount);
    w.u16(s.iconColor);
    w.u16(s.bg);
    w.u16(clampU16(s.autoplayDs));
    w.u16(clampU16(s.zoomMin));
    w.u16(clampU16(s.zoomMax));
    w.u16(clampU16(s.zoomStart));
    w.u32(0);
  });

  const fontsOff = w.length;
  fontEntries.forEach(({ glyphs, bitmaps, font, sorted }) => {
    const wide = sorted.length > 256;
    const fallback = Math.max(0, sorted.findIndex((g) => g.codepoint === font.fallback));
    const space = sorted.findIndex((g) => g.codepoint === 32);
    w.u16(font.lineHeight);
    w.u8(font.ascent);
    w.u8(font.descent);
    w.u8(font.bpp);
    w.u8(wide ? FONT_WIDE : 0);
    w.u16(sorted.length);
    w.u32(glyphs);
    w.u32(bitmaps);
    w.u16(fallback);
    w.u16(space < 0 ? 0xffff : space);
  });

  const imagesOff = w.length;
  for (const { palette, levels, image } of imageEntries) {
    w.u16(image.width);
    w.u16(image.height);
    w.u8(image.format);
    w.u8(image.levels.length);
    w.u8(image.tileShift);
    w.u8(image.flags);
    w.u32(palette);
    w.u32(levels);
  }

  const animsOff = w.length;
  model.anims.forEach((a, i) => {
    w.u16(a.width);
    w.u16(a.height);
    w.u16(a.frames.length);
    w.u16(a.loops);
    w.u32(animFrames[i]);
  });

  const scenesOff = w.length;
  for (const { prims, items, maxH, scene } of sceneEntries) {
    w.i32(Math.round(scene.width));
    w.i32(Math.round(scene.height));
    w.u16(scene.bg);
    w.u16(scene.flags);
    w.u32(prims);
    w.u32(scene.prims.length);
    w.i32(maxH);
    w.u32(items);
    w.u16(scene.items.length);
    w.u16(0);
  }

  let notesOff = 0;
  if (model.notes.length) {
    notesOff = w.length;
    w.u16(model.notes.length);
    w.u16(0);
    for (const s of noteStrings) w.u32(s);
  }

  const searchOff = w.length;
  model.search.forEach((e, i) => {
    w.u16(e.section);
    w.u16(e.scene);
    w.i32(Math.round(e.x));
    w.i32(Math.round(e.y));
    w.u16(clampU16(e.w));
    w.u16(clampU16(e.h));
    w.u32(searchStrings[i]);
  });
  w.align();

  const total = w.length;
  w.patchU32(0, BUNDLE_MAGIC);
  w.patchU16(4, BUNDLE_VERSION);
  w.patchU16(6, 0);
  w.patchU32(8, total);
  w.patchU32(12, settingsOff);
  w.patchU32(16, sectionsOff);
  w.patchU32(20, fontsOff);
  w.patchU32(24, imagesOff);
  w.patchU32(28, animsOff);
  w.patchU32(32, scenesOff);
  w.patchU32(36, notesOff);
  w.patchU32(40, model.search.length ? searchOff : 0);
  w.patchU16(44, model.sections.length);
  w.patchU16(46, model.fonts.length);
  w.patchU16(48, model.images.length);
  w.patchU16(50, model.anims.length);
  w.patchU16(52, model.scenes.length);
  w.patchU16(54, model.search.length);

  const data = w.finish();
  return {
    data,
    stats: {
      total,
      images: imageBytes,
      fonts: fontBytes,
      scenes: sceneBytes,
      other: total - imageBytes - fontBytes - sceneBytes,
      perImage,
    },
  };
}

function writePrim(w: ByteWriter, p: Prim, box: PrimBase, glyphIndex: Map<number, number>[], fonts: PackedFont[]) {
  const start = w.length;
  const header = (type: number, flags: number) => {
    w.u8(type);
    w.u8(flags);
    w.u16(0); // size, patched below
    w.i32(box.x);
    w.i32(box.y);
    w.u16(clampU16(box.w));
    w.u16(clampU16(box.h));
  };
  switch (p.type) {
    case 'rect':
      header(PRIM_RECT, 0);
      w.u16(p.color);
      w.u8(Math.round(p.alpha));
      w.u8(Math.min(255, Math.round(p.radius)));
      w.u16(p.borderColor);
      w.u8(Math.min(255, Math.round(p.borderWidth)));
      w.u8(0);
      break;
    case 'image':
      header(PRIM_IMAGE, 0);
      w.u16(p.image);
      w.u16(0);
      break;
    case 'anim':
      header(PRIM_ANIM, 0);
      w.u16(p.anim);
      w.u16(0);
      break;
    case 'text': {
      header(PRIM_TEXT, (p.underline ? TEXT_UNDERLINE : 0) | (p.strike ? TEXT_STRIKE : 0));
      const index = glyphIndex[p.font];
      const font = fonts[p.font];
      const fallback = index.get(font.fallback) ?? 0;
      const wide = font.glyphs.length > 256;
      w.u16(p.font);
      w.u16(p.color);
      w.u16(p.codepoints.length);
      w.i16(clamp16(p.spaceExtra16));
      for (const cp of p.codepoints) {
        const g = index.get(cp) ?? fallback;
        if (wide) w.u16(g);
        else w.u8(g);
      }
      w.align();
      break;
    }
    case 'line':
      header(PRIM_LINE, 0);
      w.i32(Math.round(p.x0));
      w.i32(Math.round(p.y0));
      w.i32(Math.round(p.x1));
      w.i32(Math.round(p.y1));
      w.u16(p.color);
      w.u8(Math.max(1, Math.min(255, Math.round(p.width))));
      w.u8(p.arrows);
      break;
    case 'ellipse':
      header(PRIM_ELLIPSE, 0);
      w.u16(p.fill);
      w.u16(p.stroke);
      w.u8(Math.min(255, Math.round(p.strokeWidth)));
      w.u8(p.filled ? 1 : 0);
      w.u16(0);
      break;
  }
  w.patchU16(start + 2, w.length - start);
}
