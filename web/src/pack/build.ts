// Builds the content bundle for a project: layout every section, encode the
// pictures it uses, rasterize fonts, and write the binary.

import type { AssetMeta, ImageQuality, Project, Section, Theme } from '../model/types.ts';
import { FontSet, loadFonts, type FontSpec } from './fonts.ts';
import {
  ICONS,
  MODE_CANVAS,
  MODE_DOCUMENT,
  MODE_GALLERY,
  MODE_NOTES,
  MODE_SLIDES,
  type PackedAnim,
  type PackedImage,
  type PackedScene,
  type PackedSection,
  SCENE_CENTER,
  SCENE_SORTED,
  SEC_AUTOPLAY,
  SEC_CAPTIONS,
  SEC_HIDDEN,
  SEC_LOOP,
  SEC_MINIMAP,
  SEC_PAGE_NUMBERS,
  SEC_STATUS_BAR,
  SEC_TRANSITION,
  SET_BATTERY,
  SET_BOOKMARKS,
  SET_DARK_UI,
  SET_HINTS,
  SET_NOTES,
  SET_SEARCH,
  START_FIRST_SECTION,
  START_HOME,
  START_RESUME,
  type BundleStats,
  type SearchEntry,
  rgb565,
  writeBundle,
} from './format.ts';
import { DEFAULT_QUALITY, SHRINK_STEPS, encodeAnimation, encodeImage, levelSizes, renderSource, shrinkQuality } from './images.ts';
import { LayoutContext, type MathSource, type PictureRequest, type PictureResult, type PictureSource, SceneBuilder, type ThemeColors } from './layout/context.ts';
import { layoutGallery, layoutItems, slideHeading } from './layout/frame.ts';
import { Flow } from './layout/rich.ts';

export interface AssetProvider {
  meta(id: string): AssetMeta | undefined;
  bitmap(id: string): Promise<ImageBitmap>;
  frames(id: string): Promise<{ bitmap: ImageBitmap; delayMs: number }[]>;
}

export interface BuildOptions {
  onProgress?: (fraction: number, label: string) => void;
  signal?: AbortSignal;
  math?: MathSource;
  /** Extra compression for every picture (0..3), used to make the app fit. */
  shrink?: number;
}

export interface SectionUsage {
  id: string;
  bytes: number;
}

export interface BuildResult {
  bundle: Uint8Array;
  stats: BundleStats & { sections: SectionUsage[] };
  warnings: string[];
}

// ---- Theme ----

function parseHex(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');
}

export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface FullTheme extends ThemeColors {
  accentFg: string;
  panel: string;
  dark: boolean;
}

export function themeColors(theme: Theme): FullTheme {
  const dark = luminance(theme.background) < 0.3;
  return {
    bg: theme.background,
    fg: theme.text,
    accent: theme.accent,
    accentFg: luminance(theme.accent) > 0.62 ? '#1f1f1f' : '#ffffff',
    dim: mix(theme.text, theme.background, 0.42),
    line: mix(theme.text, theme.background, 0.84),
    panel: dark ? mix(theme.background, '#ffffff', 0.05) : mix(theme.background, '#ffffff', 0.6),
    codeBg: mix(theme.text, theme.background, 0.91),
    highlight: dark ? '#806000' : '#ffe27a',
    tableHeader: mix(theme.accent, theme.background, 0.84),
    dark,
  };
}

// ---- Pictures ----

const encodeCache = new Map<string, Encoded & { bytes: number }>();
let encodeCacheBytes = 0;
const ENCODE_CACHE_LIMIT = 96 * 1024 * 1024;

function remember(key: string, entry: Encoded) {
  const images = entry.image ? [entry.image] : entry.frames ?? [];
  const bytes = images.reduce((n, im) => n + im.levels.reduce((m, l) => m + l.tiles.reduce((k, t) => k + t.length, 0), 0), 0);
  encodeCache.set(key, { ...entry, bytes });
  encodeCacheBytes += bytes;
  for (const [k, v] of encodeCache) {
    if (encodeCacheBytes <= ENCODE_CACHE_LIMIT) break;
    encodeCache.delete(k);
    encodeCacheBytes -= v.bytes;
  }
}

interface Pending {
  key: string;
  req: PictureRequest;
  kind: 'image' | 'anim';
  index: number;
  sections: Set<number>;
}

class PictureRegistry implements PictureSource {
  pending: Pending[] = [];
  private byKey = new Map<string, Pending>();
  images = 0;
  anims = 0;
  section = 0;
  /** Compression for pictures requested from now on. */
  shrink = 0;
  private assets: AssetProvider;

  constructor(assets: AssetProvider) {
    this.assets = assets;
  }

  natural(asset: string) {
    const m = this.assets.meta(asset);
    return m ? { width: m.width, height: m.height, animated: m.kind === 'animation' } : undefined;
  }

  request(req: PictureRequest): PictureResult | undefined {
    const meta = this.assets.meta(req.ref.asset);
    if (!meta) return undefined;
    if (this.shrink && !meta.id.startsWith('math:')) req = { ...req, shrink: this.shrink };
    const kind = meta.kind === 'animation' ? 'anim' : 'image';
    const key = pictureKey(req, kind);
    let p = this.byKey.get(key);
    if (!p) {
      p = { key, req, kind, index: kind === 'anim' ? this.anims++ : this.images++, sections: new Set() };
      this.byKey.set(key, p);
      this.pending.push(p);
    }
    p.sections.add(this.section);
    return { kind, index: p.index, width: meta.width, height: meta.height };
  }
}

function pictureKey(req: PictureRequest, kind: string): string {
  const q: ImageQuality = { ...DEFAULT_QUALITY, ...req.ref.quality };
  return JSON.stringify([
    kind,
    req.ref.asset,
    Math.round(req.w),
    Math.round(req.h),
    req.cover ?? req.ref.crop ?? null,
    req.ref.adjust ?? null,
    q,
    req.keepAlpha ? null : req.background,
    req.radius ?? 0,
    !!req.keepAlpha,
    !!req.noDetail,
    !!req.zoomOut,
    req.shrink ?? 0,
  ]);
}

interface Encoded {
  image?: PackedImage;
  frames?: PackedImage[];
  delays?: number[];
}

async function encodePicture(p: Pending, assets: AssetProvider, warnings: string[]): Promise<Encoded | undefined> {
  const cached = encodeCache.get(p.key);
  if (cached) return cached;
  const meta = assets.meta(p.req.ref.asset)!;
  const shrink = p.req.shrink ?? 0;
  const q: ImageQuality = shrinkQuality({ ...DEFAULT_QUALITY, ...p.req.ref.quality }, shrink);
  // Stronger steps also store fewer pixels; the calculator scales them up.
  const scale = SHRINK_STEPS[Math.min(shrink, SHRINK_STEPS.length - 1)].scale;
  const w = Math.max(1, Math.round(p.req.w * scale));
  const h = Math.max(1, Math.round(p.req.h * scale));
  const crop = p.req.cover ?? p.req.ref.crop;
  const opts = {
    crop,
    adjust: p.req.ref.adjust,
    background: p.req.keepAlpha ? undefined : p.req.background,
    radius: p.req.radius,
  };
  try {
    if (p.kind === 'anim') {
      const frames = (await assets.frames(meta.id)).slice(0, 150);
      const rendered = frames.map((f) => renderSource(f.bitmap, w, h, { ...opts, background: p.req.background }));
      const entry: Encoded = { frames: encodeAnimation(rendered, q), delays: frames.map((f) => f.delayMs) };
      remember(p.key, entry);
      return entry;
    }
    const bitmap = await assets.bitmap(meta.id);
    const srcW = meta.width * (crop?.w ?? 1);
    const srcH = meta.height * (crop?.h ?? 1);
    const sizes = p.req.noDetail ? [{ w, h }] : levelSizes(w, h, srcW, srcH, q.zoomDetail);
    if (p.req.zoomOut && w >= 96 && h >= 64) {
      sizes.unshift({ w: Math.round(w / 2), h: Math.round(h / 2) });
    }
    const levels = sizes.map((s) => renderSource(bitmap, s.w, s.h, opts));
    const entry: Encoded = { image: encodeImage(levels, q, !!p.req.keepAlpha, shrink) };
    remember(p.key, entry);
    return entry;
  } catch (e) {
    warnings.push(`Couldn't prepare “${meta.name}”: ${(e as Error).message}`);
    return undefined;
  }
}

function placeholderImage(w: number, h: number): PackedImage {
  return {
    width: Math.max(1, Math.round(w)),
    height: Math.max(1, Math.round(h)),
    format: 1,
    flags: 0,
    tileShift: 5,
    palette: [rgb565('#d0d0d4')],
    levels: [],
  };
}

// ---- Fonts used by the calculator's own screens ----

const UI_EXTRA =
  '…·▶◀▲▼⊞⇧↩−•◦▪☐☑' +
  '←↑→↓≤≥≠≈±×÷°µπ√∞' +
  'ΔθαβλσΣ∫∂∈½²³€✓';

function uiCharset(): string {
  let s = '';
  for (let c = 32; c < 127; c++) s += String.fromCharCode(c);
  for (let c = 160; c < 256; c++) s += String.fromCharCode(c);
  return s + UI_EXTRA;
}

// ---- Sections ----

const SLIDE_W = 320;

function iconIndex(name: string): number {
  return Math.max(0, ICONS.indexOf(name as (typeof ICONS)[number]));
}

function sectionScenes(
  section: Section,
  ctx: LayoutContext,
  theme: FullTheme,
  project: Project,
): { scenes: PackedScene[]; search: Omit<SearchEntry, 'section'>[]; extra: Partial<PackedSection> } {
  const bg = section.background ?? theme.bg;
  const style = { family: project.theme.font, size: 13, lineHeight: 1.35, color: theme.fg, background: bg };
  const screenH = section.statusBar ? 220 : 240;
  const scenes: PackedScene[] = [];
  const search: Omit<SearchEntry, 'section'>[] = [];
  const collect = (b: SceneBuilder, sceneIndex: number) => {
    for (const s of b.search) search.push({ ...s, scene: sceneIndex });
  };

  switch (section.mode) {
    case 'slides': {
      section.slides.forEach((slide, i) => {
        const b = new SceneBuilder();
        const slideBg = slide.background ?? bg;
        layoutItems(ctx, b, slide.items, { ...style, background: slideBg }, 'none');
        slideHeading(b, slide.title, SLIDE_W, screenH);
        scenes.push({ width: SLIDE_W, height: screenH, bg: rgb565(slideBg), flags: SCENE_CENTER, prims: b.prims, items: b.items });
        collect(b, i);
      });
      if (!scenes.length) scenes.push({ width: SLIDE_W, height: screenH, bg: rgb565(bg), flags: SCENE_CENTER, prims: [], items: [] });
      return {
        scenes,
        search,
        extra: {
          flags:
            (section.loop ? SEC_LOOP : 0) |
            (section.autoplay ? SEC_AUTOPLAY : 0) |
            (section.transition ? SEC_TRANSITION : 0) |
            (section.pageNumbers ? SEC_PAGE_NUMBERS : 0),
          autoplayDs: Math.round(section.autoplaySeconds * 10),
        },
      };
    }
    case 'document': {
      const b = new SceneBuilder();
      const flow = new Flow(ctx, b, {
        x: section.margin,
        y: section.margin,
        width: SLIDE_W - section.margin * 2,
        family: section.font,
        size: section.fontSize,
        lineHeight: section.lineHeight,
        color: theme.fg,
        background: bg,
        headings: true,
      });
      const end = flow.run(section.doc);
      const prims = b.prims.map((p, i) => ({ p, i })).sort((a, b2) => a.p.y - b2.p.y || a.i - b2.i).map((e) => e.p);
      scenes.push({ width: SLIDE_W, height: Math.max(end + section.margin, screenH), bg: rgb565(bg), flags: SCENE_SORTED, prims, items: b.items });
      collect(b, 0);
      return { scenes, search, extra: {} };
    }
    case 'canvas': {
      const b = new SceneBuilder();
      layoutItems(ctx, b, section.items, { ...style, zoomOut: true }, 'marked');
      scenes.push({ width: section.width, height: section.height, bg: rgb565(bg), flags: SCENE_CENTER, prims: b.prims, items: b.items });
      collect(b, 0);
      return {
        scenes,
        search,
        extra: {
          flags: section.minimap ? SEC_MINIMAP : 0,
          zoomMax: Math.round(section.maxZoom * 256),
          zoomStart: Math.round(section.startZoom * 256),
          zoomMin: 0,
        },
      };
    }
    case 'gallery': {
      const b = new SceneBuilder();
      const size = layoutGallery(ctx, b, section, style, screenH);
      scenes.push({ width: size.width, height: size.height, bg: rgb565(bg), flags: 0, prims: b.prims, items: b.items });
      collect(b, 0);
      return { scenes, search, extra: { flags: section.captionsInViewer ? SEC_CAPTIONS : 0 } };
    }
    case 'notes':
      return { scenes: [], search: [], extra: {} };
  }
}

const MODES: Record<Section['mode'], number> = {
  slides: MODE_SLIDES,
  document: MODE_DOCUMENT,
  canvas: MODE_CANVAS,
  gallery: MODE_GALLERY,
  notes: MODE_NOTES,
};

export function projectFontSpecs(project: Project): FontSpec[] {
  const families = new Set([project.theme.font, 'mono' as const]);
  for (const s of project.sections) if (s.mode === 'document') families.add(s.font);
  const specs: FontSpec[] = [];
  for (const family of families) {
    for (const bold of [false, true]) for (const italic of [false, true]) specs.push({ family, size: 16, bold, italic });
  }
  return specs;
}

export async function buildBundle(project: Project, assets: AssetProvider, opts: BuildOptions = {}): Promise<BuildResult> {
  const warnings: string[] = [];
  const progress = opts.onProgress ?? (() => {});
  progress(0, 'Loading fonts');
  await loadFonts(projectFontSpecs(project));

  const theme = themeColors(project.theme);
  const fonts = new FontSet();
  // UI fonts come first so their indices are stable.
  const ui = fonts.get({ family: project.theme.font, size: 13, bold: false, italic: false });
  const uiBold = fonts.get({ family: project.theme.font, size: 13, bold: true, italic: false });
  const title = fonts.get({ family: project.theme.font, size: 22, bold: true, italic: false });
  const charset = uiCharset();
  ui.face.use(charset);
  uiBold.face.use(charset);
  title.face.use('0123456789');

  const pictures = new PictureRegistry(assets);
  const sectionIds = new Map(project.sections.map((s, i) => [s.id, i]));
  const ctx = new LayoutContext(fonts, pictures, theme, sectionIds, opts.math);

  progress(0.05, 'Laying out pages');
  const scenes: PackedScene[] = [];
  const sections: PackedSection[] = [];
  const search: SearchEntry[] = [];
  const notes: string[] = [];
  project.sections.forEach((section, i) => {
    pictures.section = i;
    pictures.shrink = Math.min(3, Math.max(opts.shrink ?? 0, section.shrink ?? 0));
    const first = scenes.length;
    const laid = sectionScenes(section, ctx, theme, project);
    scenes.push(...laid.scenes);
    for (const e of laid.search) search.push({ ...e, section: i, scene: first + e.scene });
    if (section.mode === 'notes') notes.push(...section.notes.filter((n) => n.trim()));
    const extra = laid.extra;
    sections.push({
      title: section.title,
      subtitle: section.subtitle,
      mode: MODES[section.mode],
      icon: iconIndex(section.icon),
      flags: (extra.flags ?? 0) | (section.statusBar ? SEC_STATUS_BAR : 0) | (section.hidden ? SEC_HIDDEN : 0),
      firstScene: first,
      sceneCount: laid.scenes.length,
      iconColor: rgb565(section.iconColor),
      bg: rgb565(section.background ?? theme.bg),
      autoplayDs: extra.autoplayDs ?? 0,
      zoomMin: extra.zoomMin ?? 0,
      zoomMax: extra.zoomMax ?? 0,
      zoomStart: extra.zoomStart ?? 0,
    });
  });

  // Text the UI font must be able to show: titles, notes, captions, search.
  for (const s of project.sections) ui.face.use(s.title + (s.subtitle ?? ''));
  for (const s of project.sections) uiBold.face.use(s.title);
  uiBold.face.use(project.name);
  for (const n of notes) {
    ui.face.use(n);
    uiBold.face.use(n);
  }
  for (const e of search) ui.face.use(e.text);
  for (const sc of scenes) for (const it of sc.items) if (it.text) {
    ui.face.use(it.text);
    uiBold.face.use(it.text);
  }

  // Encode pictures.
  const images: PackedImage[] = new Array(pictures.images);
  const anims: PackedAnim[] = new Array(pictures.anims);
  const animFrames: { index: number; frames: PackedImage[]; delays: number[]; w: number; h: number }[] = [];
  const total = pictures.pending.length || 1;
  for (let i = 0; i < pictures.pending.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('Build cancelled', 'AbortError');
    const p = pictures.pending[i];
    progress(0.1 + 0.8 * (i / total), `Preparing pictures (${i + 1}/${total})`);
    await new Promise((r) => setTimeout(r, 0));
    const entry = await encodePicture(p, assets, warnings);
    if (p.kind === 'image') {
      images[p.index] = entry?.image ?? placeholderImage(p.req.w, p.req.h);
    } else {
      animFrames.push({ index: p.index, frames: entry?.frames ?? [placeholderImage(p.req.w, p.req.h)], delays: entry?.delays ?? [100], w: p.req.w, h: p.req.h });
    }
  }
  for (const a of animFrames) {
    const first = images.length;
    images.push(...a.frames);
    anims[a.index] = {
      width: Math.round(a.w),
      height: Math.round(a.h),
      loops: 0,
      frames: a.frames.map((_, k) => ({ image: first + k, delayMs: a.delays[k] ?? 100 })),
    };
  }
  // Placeholders with no levels can't be decoded; give them one flat tile.
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    if (im.levels.length) continue;
    images[i] = encodeImage([flatImage(im.width, im.height)], { ...DEFAULT_QUALITY, mode: 'crisp' });
  }

  progress(0.92, 'Rendering text');
  await new Promise((r) => setTimeout(r, 0));
  const packedFonts = fonts.pack();

  const s = project.settings;
  const { data, stats } = writeBundle({
    settings: {
      appName: project.name,
      projectId: project.projectId >>> 0,
      bg: rgb565(theme.bg),
      fg: rgb565(theme.fg),
      accent: rgb565(theme.accent),
      accentFg: rgb565(theme.accentFg),
      dim: rgb565(theme.dim),
      panel: rgb565(theme.panel),
      line: rgb565(theme.line),
      highlight: rgb565(theme.highlight),
      uiFont: ui.index,
      uiFontBold: uiBold.index,
      titleFont: title.index,
      start: s.start === 'home' ? START_HOME : s.start === 'first' ? START_FIRST_SECTION : START_RESUME,
      flags:
        (s.notes ? SET_NOTES : 0) |
        (s.battery ? SET_BATTERY : 0) |
        (s.hints ? SET_HINTS : 0) |
        (s.search ? SET_SEARCH : 0) |
        (s.bookmarks ? SET_BOOKMARKS : 0) |
        (theme.dark ? SET_DARK_UI : 0),
    },
    sections,
    scenes,
    fonts: packedFonts,
    images,
    anims,
    notes,
    search,
  });

  // Attribute picture bytes to the sections that use them.
  const usage = project.sections.map((sec) => ({ id: sec.id, bytes: 0 }));
  for (const p of pictures.pending) {
    const bytes = p.kind === 'image' ? stats.perImage[p.index] ?? 0 : 0;
    for (const si of p.sections) usage[si].bytes += bytes / p.sections.size;
  }
  progress(1, 'Done');
  return { bundle: data, stats: { ...stats, sections: usage }, warnings };
}

function flatImage(w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4).fill(208);
  return new ImageData(data, Math.max(1, w), Math.max(1, h));
}
