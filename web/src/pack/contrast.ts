// Readable text on colored backgrounds (table cells, highlights).

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a #rrggbb or rgb(...) color, or null if unknown. */
export function colorLuminance(color: string): number | null {
  let rgb: number[] | null = null;
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = color.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    if (m) rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  if (!rgb) return null;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function ratio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `fg` if it reads well on `bg`, otherwise near-black or white. */
export function readableOn(bg: string, fg: string): string {
  const lb = colorLuminance(bg);
  if (lb === null) return fg;
  const lf = colorLuminance(fg);
  if (lf !== null && ratio(lb, lf) >= 4.5) return fg;
  return ratio(lb, 0.012) >= ratio(lb, 1) ? '#1f1f1f' : '#ffffff';
}
