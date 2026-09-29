// Free-placed items (slides and canvases) and the gallery grid.

import type { FontFamily, GallerySection, ImageItem, Item, ShapeItem, TextItem } from '../../model/types.ts';
import { ITEM_ANIM, ITEM_CELL, ITEM_HEADING, ITEM_IMAGE, ITEM_LINK, ITEM_STOP, rgb565 } from '../format.ts';
import { type LayoutContext, SceneBuilder } from './context.ts';
import { Flow, rect, richPlainText, shift } from './rich.ts';

export interface FrameStyle {
  family: FontFamily;
  size: number;
  lineHeight: number;
  color: string;
  background: string;
  /** Pictures may be seen zoomed out (canvas). */
  zoomOut?: boolean;
}

/** Source crop that makes a picture cover a w×h box (centered). */
export function coverCrop(
  natural: { width: number; height: number },
  crop: { x: number; y: number; w: number; h: number } | undefined,
  w: number,
  h: number,
) {
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const srcW = natural.width * c.w;
  const srcH = natural.height * c.h;
  const target = w / h;
  if (srcW / srcH > target) {
    const cw = (srcH * target) / natural.width;
    return { x: c.x + (c.w - cw) / 2, y: c.y, w: cw, h: c.h };
  }
  const ch = srcW / target / natural.height;
  return { x: c.x, y: c.y + (c.h - ch) / 2, w: c.w, h: ch };
}

function imageItem(ctx: LayoutContext, scene: SceneBuilder, item: ImageItem, style: FrameStyle) {
  const natural = ctx.pictures.natural(item.asset);
  if (!natural) return;
  const crop = item.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const srcW = natural.width * crop.w;
  const srcH = natural.height * crop.h;
  let { x, y, w, h } = item;
  let cover: ReturnType<typeof coverCrop> | undefined;
  if (item.fit === 'contain') {
    const s = Math.min(w / srcW, h / srcH);
    const dw = Math.max(1, Math.round(srcW * s));
    const dh = Math.max(1, Math.round(srcH * s));
    x += Math.round((w - dw) / 2);
    y += Math.round((h - dh) / 2);
    w = dw;
    h = dh;
  } else if (item.fit === 'cover') {
    cover = coverCrop(natural, item.crop, w, h);
  }
  const result = ctx.pictures.request({
    ref: item,
    w: Math.round(w),
    h: Math.round(h),
    cover,
    background: style.background,
    radius: item.radius,
    keepAlpha: true,
    zoomOut: style.zoomOut,
  });
  if (!result) return;
  scene.prims.push(result.kind === 'anim' ? { type: 'anim', x, y, w, h, anim: result.index } : { type: 'image', x, y, w, h, image: result.index });
  if (item.border && item.border.width > 0) {
    scene.prims.push({ ...rect(x, y, w, h, '#000000', 0, item.radius), borderColor: rgb565(item.border.color), borderWidth: item.border.width });
  }
  scene.items.push({ kind: result.kind === 'anim' ? ITEM_ANIM : ITEM_IMAGE, flags: 0, ref: result.index, x, y, w, h, text: item.caption });
  if (item.caption) scene.search.push({ x, y, w, h, text: item.caption });
}

function textItem(ctx: LayoutContext, scene: SceneBuilder, item: TextItem, style: FrameStyle) {
  if (item.background) scene.prims.push(rect(item.x, item.y, item.w, item.h, item.background, 255, item.radius));
  const sub = new SceneBuilder();
  const pad = item.padding;
  const flow = new Flow(ctx, sub, {
    x: 0,
    y: 0,
    width: Math.max(8, item.w - pad * 2),
    family: item.font ?? style.family,
    size: item.fontSize ?? style.size,
    lineHeight: style.lineHeight,
    color: style.color,
    background: item.background ?? style.background,
    headings: true,
  });
  const used = Math.max(0, flow.run(item.doc) - Math.round((item.fontSize ?? style.size) * 0.55));
  const free = item.h - pad * 2 - used;
  const dy = item.valign === 'middle' ? Math.round(free / 2) : item.valign === 'bottom' ? free : 0;
  const ox = item.x + pad;
  const oy = item.y + pad + Math.max(dy, 0);
  for (const p of sub.prims) scene.prims.push(shift(p, ox, oy));
  for (const it of sub.items) scene.items.push({ ...it, x: it.x + ox, y: it.y + oy });
  for (const s of sub.search) scene.search.push({ ...s, x: s.x + ox, y: s.y + oy });
}

function shapeItem(scene: SceneBuilder, item: ShapeItem) {
  const fill = item.fill;
  const stroke = item.stroke;
  switch (item.shape) {
    case 'rect': {
      const r = rect(item.x, item.y, item.w, item.h, fill ?? '#000000', fill ? 255 : 0, item.radius);
      scene.prims.push(stroke && item.strokeWidth ? { ...r, borderColor: rgb565(stroke), borderWidth: item.strokeWidth } : r);
      break;
    }
    case 'ellipse':
      scene.prims.push({
        type: 'ellipse',
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        fill: rgb565(fill ?? '#000000'),
        filled: !!fill,
        stroke: rgb565(stroke ?? '#000000'),
        strokeWidth: stroke ? item.strokeWidth : 0,
      });
      break;
    case 'line':
    case 'arrow':
      scene.prims.push({
        type: 'line',
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        x0: item.x,
        y0: item.y,
        x1: item.x + item.w,
        y1: item.y + item.h,
        color: rgb565(stroke ?? fill ?? '#000000'),
        width: Math.max(1, item.strokeWidth),
        arrows: item.shape === 'arrow' ? 2 : 0,
      });
      break;
  }
}

function itemText(item: Item): string {
  if (item.type === 'text') return richPlainText(item.doc);
  if (item.type === 'image') return item.caption ?? '';
  return '';
}

/** Lays out items in paint order (first = bottom). */
export function layoutItems(ctx: LayoutContext, scene: SceneBuilder, items: Item[], style: FrameStyle, stops: 'marked' | 'auto' | 'none') {
  for (const item of items) {
    if (item.type === 'image') imageItem(ctx, scene, item, style);
    else if (item.type === 'text') textItem(ctx, scene, item, style);
    else shapeItem(scene, item);
    if (item.link) {
      const section = ctx.sectionIds.get(item.link);
      if (section !== undefined) scene.items.push({ kind: ITEM_LINK, flags: 0, ref: section, x: item.x, y: item.y, w: item.w, h: item.h, text: itemText(item) });
    }
  }
  if (stops === 'none') return;
  const marked = items.filter((i) => i.stop);
  const chosen =
    stops === 'marked' && marked.length
      ? marked
      : items
          .filter((i) => i.type !== 'shape' && i.w * i.h > 400)
          .sort((a, b) => (Math.abs(a.y - b.y) < 40 ? a.x - b.x : a.y - b.y));
  for (const item of chosen) {
    const x = Math.min(item.x, item.x + item.w);
    const y = Math.min(item.y, item.y + item.h);
    scene.items.push({ kind: ITEM_STOP, flags: 0, ref: 0, x, y, w: Math.abs(item.w), h: Math.abs(item.h), text: itemText(item) });
  }
}

/** Title shown in slide contents: the slide's own title or its first heading. */
export function slideHeading(scene: SceneBuilder, title: string | undefined, w: number, h: number) {
  if (title) {
    scene.items.unshift({ kind: ITEM_HEADING, flags: 1, ref: 0, x: 0, y: 0, w, h, text: title });
  }
}

export interface GalleryLayout {
  width: number;
  height: number;
}

export function layoutGallery(ctx: LayoutContext, scene: SceneBuilder, section: GallerySection, style: FrameStyle, screenH: number): GalleryLayout {
  const width = 320;
  const margin = 6;
  const gap = 6;
  const cols = section.columns;
  const cell = Math.floor((width - margin * 2 - gap * (cols - 1)) / cols);
  const captionFont = ctx.font(style.family, 11);
  const captionH = section.captionsInGrid ? captionFont.face.lineHeight + 2 : 0;
  let y = margin;
  section.images.forEach((img, i) => {
    const col = i % cols;
    if (i > 0 && col === 0) y += cell + gap + captionH;
    const x = margin + col * (cell + gap);
    const natural = ctx.pictures.natural(img.asset);
    if (!natural) return;
    const thumb = ctx.pictures.request({
      ref: img,
      w: cell,
      h: cell,
      cover: coverCrop(natural, img.crop, cell, cell),
      background: style.background,
      radius: 4,
      noDetail: true,
    });
    const crop = img.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const srcW = natural.width * crop.w;
    const srcH = natural.height * crop.h;
    const fit = Math.min(320 / srcW, screenH / srcH);
    const full = ctx.pictures.request({
      ref: img,
      w: Math.max(1, Math.round(srcW * fit)),
      h: Math.max(1, Math.round(srcH * fit)),
      background: '#000000',
    });
    if (thumb) scene.prims.push(thumb.kind === 'anim' ? { type: 'anim', x, y, w: cell, h: cell, anim: thumb.index } : { type: 'image', x, y, w: cell, h: cell, image: thumb.index });
    if (full) scene.items.push({ kind: full.kind === 'anim' ? ITEM_ANIM : ITEM_CELL, flags: 0, ref: full.index, x, y, w: cell, h: cell, text: img.caption });
    if (section.captionsInGrid && img.caption) {
      const face = captionFont.face;
      let text = img.caption;
      while (text.length > 1 && face.width(text + '…') > cell) text = text.slice(0, -1);
      if (text !== img.caption) text += '…';
      face.use(text);
      scene.prims.push({
        type: 'text',
        x: x + Math.max(0, Math.round((cell - face.width(text)) / 2)),
        y: y + cell + 1,
        w: Math.min(cell, face.width(text)),
        h: face.lineHeight,
        font: captionFont.index,
        color: rgb565(ctx.theme.dim),
        codepoints: [...text].map((c) => c.codePointAt(0)!),
        spaceExtra16: 0,
      });
    }
    if (img.caption) scene.search.push({ x, y, w: cell, h: cell, text: img.caption });
  });
  const rows = Math.ceil(section.images.length / cols);
  const height = margin * 2 + rows * (cell + captionH) + Math.max(0, rows - 1) * gap;
  return { width, height: Math.max(height, screenH) };
}
