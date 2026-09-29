// Factories for new projects, sections, slides and items.

import type {
  AppSettings,
  CanvasSection,
  DocumentSection,
  GallerySection,
  ImageItem,
  NotesSection,
  Project,
  RichNode,
  Section,
  SectionMode,
  ShapeItem,
  Slide,
  SlidesSection,
  TextItem,
  Theme,
} from '../../model/types.ts';
import { DEFAULT_ADJUST, DEFAULT_QUALITY } from '../../pack/images.ts';
import { newId } from './assets.ts';

export const THEMES: Record<Exclude<Theme['preset'], 'custom'>, Omit<Theme, 'preset' | 'font'>> = {
  light: { background: '#ffffff', text: '#1f1f1f', accent: '#ffb734' },
  dark: { background: '#161616', text: '#e8e8e8', accent: '#ffb734' },
  sepia: { background: '#f6efe2', text: '#3a2f25', accent: '#b8672a' },
  contrast: { background: '#000000', text: '#ffffff', accent: '#ffd400' },
};

export const SECTION_COLORS = ['#4f7cff', '#34c759', '#ff9500', '#af52de', '#ff3b30', '#00b8d9', '#ffcc00', '#8e8e93'];

export const SLIDE_W = 320;
export function slideHeight(section: { statusBar: boolean }): number {
  return section.statusBar ? 220 : 240;
}

// ---- Rich text helpers ----

export const text = (t: string, marks?: RichNode['marks']): RichNode => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
export const p = (...content: (RichNode | string)[]): RichNode => ({
  type: 'paragraph',
  content: content.filter((c) => c !== '').map((c) => (typeof c === 'string' ? text(c) : c)),
});
export const h = (level: 1 | 2 | 3, t: string): RichNode => ({ type: 'heading', attrs: { level }, content: [text(t)] });
export const bold = (t: string) => text(t, [{ type: 'bold' }]);
export const ul = (...items: string[]): RichNode => ({
  type: 'bulletList',
  content: items.map((i) => ({ type: 'listItem', content: [p(i)] })),
});
export const doc = (...content: RichNode[]): RichNode => ({ type: 'doc', content });

export function table(rows: string[][], opts: { header?: boolean; colors?: (string | undefined)[][] } = {}): RichNode {
  return {
    type: 'table',
    content: rows.map((row, r) => ({
      type: 'tableRow',
      content: row.map((cell, c) => ({
        type: opts.header && r === 0 ? 'tableHeader' : 'tableCell',
        attrs: { colspan: 1, rowspan: 1, colwidth: null, backgroundColor: opts.colors?.[r]?.[c] ?? null },
        content: [p(cell)],
      })),
    })),
  };
}

// ---- Items ----

export function textItem(x: number, y: number, w: number, h2: number, content: RichNode, extra: Partial<TextItem> = {}): TextItem {
  return { id: newId('i'), type: 'text', x, y, w, h: h2, doc: content, radius: 6, padding: 6, valign: 'top', ...extra };
}

export function imageItem(asset: string, x: number, y: number, w: number, h2: number, extra: Partial<ImageItem> = {}): ImageItem {
  return {
    id: newId('i'),
    type: 'image',
    asset,
    x,
    y,
    w,
    h: h2,
    fit: 'contain',
    radius: 0,
    adjust: { ...DEFAULT_ADJUST },
    quality: { ...DEFAULT_QUALITY },
    ...extra,
  };
}

export function shapeItem(shape: ShapeItem['shape'], x: number, y: number, w: number, h2: number, extra: Partial<ShapeItem> = {}): ShapeItem {
  const line = shape === 'line' || shape === 'arrow';
  return {
    id: newId('i'),
    type: 'shape',
    shape,
    x,
    y,
    w,
    h: h2,
    fill: line ? undefined : '#ffd8a8',
    stroke: line ? '#1d1d1f' : undefined,
    strokeWidth: line ? 2 : 0,
    radius: 8,
    ...extra,
  };
}

export function newSlide(items: Slide['items'] = [], title?: string): Slide {
  return { id: newId('s'), items, title };
}

// ---- Sections ----

export function newSection(mode: SectionMode, title?: string, colorIndex = 0): Section {
  const base = {
    id: newId('sec'),
    iconColor: SECTION_COLORS[colorIndex % SECTION_COLORS.length],
  };
  switch (mode) {
    case 'slides':
      return {
        ...base,
        mode,
        title: title ?? 'Slides',
        icon: 'slides',
        statusBar: false,
        slides: [newSlide([textItem(20, 80, 280, 80, doc({ ...h(1, 'New slide'), attrs: { level: 1, textAlign: 'center' } }), { valign: 'middle' })])],
        loop: false,
        autoplay: false,
        autoplaySeconds: 5,
        transition: true,
        pageNumbers: true,
      } satisfies SlidesSection;
    case 'document':
      return {
        ...base,
        mode,
        title: title ?? 'Document',
        icon: 'document',
        statusBar: true,
        doc: doc(h(1, title ?? 'Document'), p('Start typing here.')),
        font: 'inter',
        fontSize: 13,
        lineHeight: 1.35,
        margin: 10,
      } satisfies DocumentSection;
    case 'canvas':
      return {
        ...base,
        mode,
        title: title ?? 'Canvas',
        icon: 'canvas',
        statusBar: false,
        width: 960,
        height: 720,
        items: [],
        minimap: true,
        startZoom: 0,
        maxZoom: 4,
      } satisfies CanvasSection;
    case 'gallery':
      return {
        ...base,
        mode,
        title: title ?? 'Pictures',
        icon: 'gallery',
        statusBar: true,
        images: [],
        columns: 3,
        captionsInViewer: true,
        captionsInGrid: false,
      } satisfies GallerySection;
    case 'notes':
      return {
        ...base,
        mode,
        title: title ?? 'Notes',
        icon: 'notes',
        statusBar: true,
        notes: [],
      } satisfies NotesSection;
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  start: 'home',
  notes: true,
  search: true,
  bookmarks: true,
  battery: true,
  hints: true,
};

export function newProject(name = 'My Notes'): Project {
  const now = Date.now();
  return {
    version: 1,
    id: newId('p'),
    projectId: crypto.getRandomValues(new Uint32Array(1))[0],
    name,
    icon: { kind: 'glyph', glyph: 'N', background: '#ffb734', color: '#1f1f1f' },
    theme: { preset: 'light', font: 'inter', ...THEMES.light },
    settings: { ...DEFAULT_SETTINGS },
    sections: [],
    createdAt: now,
    updatedAt: now,
  };
}
