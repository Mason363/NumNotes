// Positions menus and popovers with `position: fixed`, so panels that scroll
// or clip their content (like the sections list) can't cut them off.

export interface Placement {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  width?: number;
  maxHeight: number;
  /** Phones: show as a sheet along the bottom edge instead. */
  sheet: boolean;
}

const MARGIN = 8;

export function place(
  anchor: DOMRect,
  opts: { align: 'left' | 'right'; width?: number; gap?: number; sheetBelow?: number },
): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (opts.sheetBelow && vw <= opts.sheetBelow) {
    return { sheet: true, maxHeight: Math.round(vh * 0.75) };
  }
  const gap = opts.gap ?? 6;
  const below = vh - anchor.bottom - gap - MARGIN;
  const above = anchor.top - gap - MARGIN;
  // Open downward unless there's clearly more room above.
  const down = below >= 240 || below >= above;
  const p: Placement = { sheet: false, maxHeight: Math.max(120, down ? below : above) };
  if (down) p.top = anchor.bottom + gap;
  else p.bottom = vh - anchor.top + gap;
  if (opts.width) {
    const w = Math.min(opts.width, vw - 2 * MARGIN);
    const left = opts.align === 'left' ? anchor.left : anchor.right - w;
    p.left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
    p.width = w;
  } else if (opts.align === 'left') {
    p.left = Math.max(MARGIN, anchor.left);
  } else {
    p.right = Math.max(MARGIN, vw - anchor.right);
  }
  return p;
}

export function placementStyle(p: Placement | null): string {
  if (!p || p.sheet) return p ? `max-height: ${p.maxHeight}px` : 'visibility: hidden';
  const parts = [`max-height: ${p.maxHeight}px`];
  for (const k of ['top', 'bottom', 'left', 'right', 'width'] as const) {
    if (p[k] !== undefined) parts.push(`${k}: ${Math.round(p[k]!)}px`);
  }
  return parts.join('; ');
}

/** Keeps a placement up to date while open: on resize and on any scroll. */
export function follow(update: () => void): () => void {
  update();
  window.addEventListener('resize', update);
  window.addEventListener('scroll', update, true);
  return () => {
    window.removeEventListener('resize', update);
    window.removeEventListener('scroll', update, true);
  };
}
