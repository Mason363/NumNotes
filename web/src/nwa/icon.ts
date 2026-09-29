// App icons: 55x56 RGB565, LZ4-compressed (NumWorks' NWI format).

import type { IconStyle } from '../model/types.ts';
import { lz4Compress } from '../pack/lz4.ts';

export const ICON_W = 55;
export const ICON_H = 56;

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function canvas(w: number, h: number): { ctx: Ctx; el: OffscreenCanvas | HTMLCanvasElement } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const el = new OffscreenCanvas(w, h);
    return { el, ctx: el.getContext('2d')! };
  }
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  return { el, ctx: el.getContext('2d')! };
}

/** Draws the icon at 55x56 (the home screen shows it on white). */
export function renderIcon(style: IconStyle, image?: ImageBitmap): ImageData {
  const { ctx } = canvas(ICON_W, ICON_H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ICON_W, ICON_H);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0.5, 1, ICON_W - 1, ICON_H - 2, 6);
  ctx.clip();
  if (style.kind === 'image' && image) {
    ctx.fillStyle = style.background;
    ctx.fillRect(0, 0, ICON_W, ICON_H);
    const c = style.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, c.x * image.width, c.y * image.height, c.w * image.width, c.h * image.height, 0, 0, ICON_W, ICON_H);
  } else if (style.kind === 'glyph') {
    ctx.fillStyle = style.background;
    ctx.fillRect(0, 0, ICON_W, ICON_H);
    const text = style.glyph || 'N';
    const chars = [...text].length;
    const size = chars <= 1 ? 34 : chars === 2 ? 26 : 19;
    ctx.fillStyle = style.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${size}px "Inter", system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.fillText(text, ICON_W / 2, ICON_H / 2 + 1);
  }
  ctx.restore();
  return ctx.getImageData(0, 0, ICON_W, ICON_H);
}

export function encodeNwi(icon: ImageData): Uint8Array {
  const out = new Uint8Array(ICON_W * ICON_H * 2);
  const d = icon.data;
  for (let i = 0; i < ICON_W * ICON_H; i++) {
    const c = ((d[i * 4] & 0xf8) << 8) | ((d[i * 4 + 1] & 0xfc) << 3) | (d[i * 4 + 2] >> 3);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = c >> 8;
  }
  return lz4Compress(out);
}
