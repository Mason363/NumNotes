// Lays out rich text (Tiptap/ProseMirror JSON) into scene primitives:
// paragraphs, headings, lists, quotes, code, tables, pictures and math.

import type { FontFamily, RichNode } from '../../model/types.ts';
import type { PackFont } from '../fonts.ts';
import { ITEM_ANIM, ITEM_HEADING, ITEM_IMAGE, rgb565 } from '../format.ts';
import { DEFAULT_ADJUST, DEFAULT_QUALITY } from '../images.ts';
import { type LayoutContext, SceneBuilder } from './context.ts';

export type Align = 'left' | 'center' | 'right' | 'justify';

export interface FlowOptions {
  x: number;
  y: number;
  width: number;
  family: FontFamily;
  size: number;
  lineHeight: number;
  color: string;
  background: string;
  align?: Align;
  /** Emit table-of-contents entries for headings. */
  headings?: boolean;
  /** Paragraph spacing multiplier (tight for tables and small boxes). */
  spacing?: number;
}

interface Style {
  family: FontFamily;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  underline: boolean;
  strike: boolean;
  highlight?: string;
  code: boolean;
}

interface Run {
  text: string;
  style: Style;
}

interface Piece {
  text: string;
  style: Style;
  font: { index: number; face: PackFont };
  w16: number;
  space: boolean;
  newline: boolean;
}

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯぀-ヿ]/u;
const TOKEN = /\n|[ \t]+|[⺀-鿿가-힯豈-﫿＀-￯぀-ヿ]|[^ \t\n⺀-鿿가-힯豈-﫿＀-￯぀-ヿ]+/gu;

function parseSize(v: unknown, fallback: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function plainText(node: RichNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const parts = (node.content ?? []).map(plainText);
  const block = ['paragraph', 'heading', 'listItem', 'tableRow', 'codeBlock', 'blockquote'].includes(node.type);
  return parts.join(node.type === 'tableRow' ? '  ' : '') + (block ? '\n' : '');
}

export function richPlainText(node: RichNode): string {
  return plainText(node).replace(/\n+/g, '\n').trim();
}

export class Flow {
  private ctx: LayoutContext;
  private scene: SceneBuilder;
  private opts: FlowOptions;
  y: number;
  private first = true;

  constructor(ctx: LayoutContext, scene: SceneBuilder, opts: FlowOptions) {
    this.ctx = ctx;
    this.scene = scene;
    this.opts = opts;
    this.y = opts.y;
  }

  private baseStyle(): Style {
    return {
      family: this.opts.family,
      size: this.opts.size,
      bold: false,
      italic: false,
      color: this.opts.color,
      underline: false,
      strike: false,
      code: false,
    };
  }

  /** Lays out a whole document or a list of blocks; returns the end y. */
  run(doc: RichNode): number {
    for (const block of doc.type === 'doc' ? doc.content ?? [] : [doc]) this.block(block, 0, this.opts.width);
    return this.y;
  }

  private gap(px: number) {
    if (!this.first) this.y += Math.round(px);
  }

  private block(node: RichNode, indent: number, width: number, marker?: string) {
    const size = this.opts.size;
    const spacing = this.opts.spacing ?? 1;
    switch (node.type) {
      case 'paragraph': {
        const runs = this.inline(node, this.baseStyle());
        const start = this.y;
        this.paragraph(runs, indent, width, alignOf(node, this.opts.align), marker);
        this.searchEntry(node, indent, start, width);
        this.y += Math.round(size * 0.55 * spacing);
        break;
      }
      case 'heading': {
        const level = Number(node.attrs?.level ?? 1);
        const scale = level === 1 ? 1.55 : level === 2 ? 1.28 : 1.1;
        this.gap(size * 0.5 * spacing);
        const base = { ...this.baseStyle(), size: Math.round(size * scale), bold: true };
        const start = this.y;
        this.paragraph(this.inline(node, base), indent, width, alignOf(node, this.opts.align), marker);
        const text = richPlainText(node);
        if (this.opts.headings && text) {
          this.scene.items.push({ kind: ITEM_HEADING, flags: level, ref: 0, x: this.opts.x + indent, y: start, w: width, h: this.y - start, text });
        }
        this.searchEntry(node, indent, start, width);
        this.y += Math.round(size * 0.35 * spacing);
        break;
      }
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        let n = Number(node.attrs?.start ?? 1);
        const depth = Math.round(indent / 16);
        for (const item of node.content ?? []) {
          const checked = item.attrs?.checked;
          const m =
            node.type === 'orderedList'
              ? `${n++}.`
              : node.type === 'taskList'
                ? checked
                  ? '☑'
                  : '☐'
                : ['•', '◦', '▪'][depth % 3];
          (item.content ?? []).forEach((child, i) => {
            this.block(child, indent + 16, width - 16, i === 0 ? m : undefined);
          });
          this.first = false;
        }
        break;
      }
      case 'listItem':
      case 'taskItem':
        for (const child of node.content ?? []) this.block(child, indent, width, marker);
        break;
      case 'blockquote': {
        const start = this.y;
        for (const child of node.content ?? []) this.block(child, indent + 12, width - 12);
        this.scene.prims.push(rect(this.opts.x + indent + 2, start, 3, Math.max(4, this.y - start - size * 0.4), this.ctx.theme.dim, 150, 1));
        break;
      }
      case 'codeBlock':
        this.codeBlock(node, indent, width);
        break;
      case 'horizontalRule':
        this.gap(size * 0.3);
        this.scene.prims.push(rect(this.opts.x + indent, this.y, width, 1, this.ctx.theme.line));
        this.y += Math.round(size * 0.8);
        break;
      case 'image':
      case 'picture':
        this.picture(node, indent, width);
        break;
      case 'math':
      case 'mathBlock':
        this.mathBlock(node, indent, width);
        break;
      case 'table':
        this.table(node, indent, width);
        break;
      default:
        for (const child of node.content ?? []) this.block(child, indent, width, marker);
    }
    this.first = false;
  }

  private searchEntry(node: RichNode, indent: number, y: number, width: number) {
    const text = richPlainText(node);
    if (text) this.scene.search.push({ x: this.opts.x + indent, y, w: width, h: Math.max(1, this.y - y), text });
  }

  inline(node: RichNode, base: Style): Run[] {
    const runs: Run[] = [];
    const theme = this.ctx.theme;
    const walk = (n: RichNode) => {
      if (n.type === 'text' && n.text) {
        const s: Style = { ...base };
        for (const mark of n.marks ?? []) {
          switch (mark.type) {
            case 'bold':
            case 'strong':
              s.bold = true;
              break;
            case 'italic':
            case 'em':
              s.italic = true;
              break;
            case 'underline':
              s.underline = true;
              break;
            case 'strike':
              s.strike = true;
              break;
            case 'code':
              s.code = true;
              s.family = 'mono';
              s.size = Math.max(8, Math.round(s.size * 0.9));
              break;
            case 'highlight':
              s.highlight = (mark.attrs?.color as string) || theme.highlight;
              break;
            case 'link':
              s.color = theme.accent;
              s.underline = true;
              break;
            case 'textStyle': {
              const a = mark.attrs ?? {};
              if (a.color) s.color = String(a.color);
              if (a.fontSize) s.size = parseSize(a.fontSize, s.size);
              if (a.fontFamily) s.family = String(a.fontFamily) as FontFamily;
              if (a.backgroundColor) s.highlight = String(a.backgroundColor);
              break;
            }
          }
        }
        runs.push({ text: n.text, style: s });
      } else if (n.type === 'hardBreak') {
        runs.push({ text: '\n', style: base });
      } else {
        for (const c of n.content ?? []) walk(c);
      }
    };
    walk(node);
    return runs;
  }

  private pieces(runs: Run[]): Piece[] {
    const out: Piece[] = [];
    for (const run of runs) {
      const s = run.style;
      const font = this.ctx.font(s.family, s.size, s.bold, s.italic);
      for (const token of run.text.match(TOKEN) ?? []) {
        if (token === '\n') {
          out.push({ text: '', style: s, font, w16: 0, space: false, newline: true });
          continue;
        }
        const text = token.replace(/\t/g, '    ');
        let w16 = 0;
        for (const ch of text) w16 += font.face.advance16(ch.codePointAt(0)!);
        out.push({ text, style: s, font, w16, space: /^[ \t]+$/.test(token), newline: false });
      }
    }
    return out;
  }

  private splitWord(p: Piece, limit16: number): Piece[] {
    const parts: Piece[] = [];
    let text = '';
    let w16 = 0;
    for (const ch of p.text) {
      const a = p.font.face.advance16(ch.codePointAt(0)!);
      if (w16 + a > limit16 && text) {
        parts.push({ ...p, text, w16 });
        text = '';
        w16 = 0;
      }
      text += ch;
      w16 += a;
    }
    if (text) parts.push({ ...p, text, w16 });
    return parts;
  }

  private breakLines(pieces: Piece[], width: number): Piece[][] {
    const limit = width * 16;
    const lines: Piece[][] = [];
    let line: Piece[] = [];
    let w = 0;
    const flush = () => {
      while (line.length && line[line.length - 1].space) line.pop();
      lines.push(line);
      line = [];
      w = 0;
    };
    for (const p of pieces) {
      if (p.newline) {
        flush();
        continue;
      }
      if (p.space) {
        if (line.length) {
          line.push(p);
          w += p.w16;
        }
        continue;
      }
      if (w + p.w16 <= limit) {
        line.push(p);
        w += p.w16;
        continue;
      }
      if (line.some((q) => !q.space)) flush();
      else {
        line = [];
        w = 0;
      }
      const parts = p.w16 > limit ? this.splitWord(p, limit) : [p];
      parts.forEach((part, i) => {
        if (i > 0) flush();
        line.push(part);
        w = part.w16;
      });
    }
    flush();
    return lines;
  }

  /** Lays out runs as a paragraph at the current y. */
  paragraph(runs: Run[], indent: number, width: number, align: Align, marker?: string) {
    const pieces = this.pieces(runs);
    const lines = this.breakLines(pieces, width);
    if (!lines.length) lines.push([]);
    const x = this.opts.x + indent;
    lines.forEach((line, i) => {
      const top = this.y;
      const h = this.emitLine(line, x, top, width, align, i === lines.length - 1, runs[0]?.style ?? this.baseStyle());
      if (i === 0 && marker) this.marker(marker, x, top, h, runs[0]?.style ?? this.baseStyle());
      this.y += h;
    });
  }

  private marker(text: string, x: number, top: number, lineH: number, style: Style) {
    const font = this.ctx.font(this.opts.family, style.size, false, false);
    font.face.use(text);
    const w = font.face.width(text);
    const asc = font.face.ascent + Math.round((Math.round(style.size * this.opts.lineHeight) - font.face.lineHeight) / 2);
    this.scene.prims.push({
      type: 'text',
      x: x - w - 5,
      y: top + asc - font.face.ascent,
      w,
      h: font.face.lineHeight,
      font: font.index,
      color: rgb565(this.ctx.theme.dim),
      codepoints: [...text].map((c) => c.codePointAt(0)!),
      spaceExtra16: 0,
    });
    void lineH;
  }

  private emitLine(line: Piece[], x: number, top: number, width: number, align: Align, last: boolean, fallback: Style): number {
    const lh = this.opts.lineHeight;
    let lineH = Math.round(fallback.size * lh);
    let baseline = 0;
    for (const p of line.length ? line : []) {
      const box = Math.round(p.font.face.spec.size * lh);
      lineH = Math.max(lineH, box);
    }
    for (const p of line) {
      const box = Math.round(p.font.face.spec.size * lh);
      const asc = p.font.face.ascent + Math.round((box - p.font.face.lineHeight) / 2);
      baseline = Math.max(baseline, asc + Math.round((lineH - box) / 2));
    }
    if (!line.length) return lineH;
    baseline += top;

    const total16 = line.reduce((n, p) => n + p.w16, 0);
    const spaces = line.filter((p) => p.space).reduce((n, p) => n + [...p.text].length, 0);
    let x16 = x * 16;
    let extra16 = 0;
    if (align === 'center') x16 += Math.max(0, (width * 16 - total16) / 2);
    else if (align === 'right') x16 += Math.max(0, width * 16 - total16);
    else if (align === 'justify' && !last && spaces > 0) extra16 = Math.floor((width * 16 - total16) / spaces);

    // Group pieces sharing a font and decoration into one text primitive.
    let i = 0;
    while (i < line.length) {
      const first = line[i];
      let j = i;
      let text = '';
      let w16 = 0;
      let groupSpaces = 0;
      while (j < line.length && sameRun(line[j], first)) {
        text += line[j].text;
        w16 += line[j].w16;
        if (line[j].space) groupSpaces += [...line[j].text].length;
        j++;
      }
      w16 += groupSpaces * extra16;
      const s = first.style;
      const face = first.font.face;
      const gx = Math.floor(x16 / 16);
      const gw = Math.ceil(w16 / 16);
      if (s.highlight) this.scene.prims.push(rect(gx - 1, top, gw + 2, lineH, s.highlight, 255, 2));
      if (s.code) this.scene.prims.push(rect(gx - 2, baseline - face.ascent + 1, gw + 4, face.lineHeight - 1, this.ctx.theme.codeBg, 255, 3));
      face.use(text);
      this.scene.prims.push({
        type: 'text',
        x: gx,
        y: baseline - face.ascent,
        w: gw,
        h: face.lineHeight,
        font: first.font.index,
        color: rgb565(s.color),
        codepoints: [...text].map((c) => c.codePointAt(0)!),
        spaceExtra16: extra16,
        underline: s.underline,
        strike: s.strike,
      });
      x16 += w16;
      i = j;
    }
    return lineH;
  }

  private codeBlock(node: RichNode, indent: number, width: number) {
    const size = Math.max(8, Math.round(this.opts.size * 0.88));
    const style: Style = { ...this.baseStyle(), family: 'mono', size };
    const text = richPlainText(node);
    const pad = 6;
    this.gap(2);
    const start = this.y;
    const bgIndex = this.scene.prims.length;
    this.y += pad;
    const sub = new Flow(this.ctx, this.scene, { ...this.opts, x: this.opts.x + indent + pad, y: this.y, width: width - pad * 2, lineHeight: 1.3 });
    sub.paragraph([{ text, style }], 0, width - pad * 2, 'left');
    this.y = sub.y + pad;
    this.scene.prims.splice(bgIndex, 0, rect(this.opts.x + indent, start, width, this.y - start, this.ctx.theme.codeBg, 255, 4));
    this.scene.search.push({ x: this.opts.x + indent, y: start, w: width, h: this.y - start, text });
    this.y += Math.round(this.opts.size * 0.55);
  }

  private picture(node: RichNode, indent: number, width: number) {
    const a = node.attrs ?? {};
    const asset = String(a.asset ?? String(a.src ?? '').replace(/^asset:/, ''));
    const natural = this.ctx.pictures.natural(asset);
    if (!natural) return;
    const pct = Math.max(10, Math.min(100, Number(a.width ?? 100)));
    const w = Math.max(8, Math.round(Math.min(width * (pct / 100), natural.width)));
    const h = Math.max(4, Math.round((w * natural.height) / natural.width));
    const alignAttr = String(a.align ?? 'center');
    const x = this.opts.x + indent + (alignAttr === 'left' ? 0 : alignAttr === 'right' ? width - w : Math.round((width - w) / 2));
    this.gap(this.opts.size * 0.3);
    const caption = typeof a.caption === 'string' ? a.caption : '';
    const result = this.ctx.pictures.request({
      ref: {
        asset,
        adjust: (a.adjust as never) ?? DEFAULT_ADJUST,
        quality: (a.quality as never) ?? DEFAULT_QUALITY,
        crop: a.crop as never,
      },
      w,
      h,
      background: this.opts.background,
      radius: Number(a.radius ?? 0),
    });
    if (result) {
      const y = this.y;
      this.scene.prims.push(result.kind === 'anim' ? { type: 'anim', x, y, w, h, anim: result.index } : { type: 'image', x, y, w, h, image: result.index });
      this.scene.items.push({ kind: result.kind === 'anim' ? ITEM_ANIM : ITEM_IMAGE, flags: 0, ref: result.index, x, y, w, h, text: caption });
      this.y += h;
    }
    if (caption) {
      this.y += 3;
      const style = { ...this.baseStyle(), size: Math.max(8, Math.round(this.opts.size * 0.82)), color: this.ctx.theme.dim, italic: true };
      this.paragraph([{ text: caption, style }], indent, width, 'center');
    }
    this.y += Math.round(this.opts.size * 0.6);
  }

  private mathBlock(node: RichNode, indent: number, width: number) {
    const latex = String(node.attrs?.latex ?? node.attrs?.value ?? '');
    const rendered = latex && this.ctx.math?.get(latex, true);
    if (!rendered) {
      this.paragraph([{ text: latex, style: { ...this.baseStyle(), family: 'mono' } }], indent, width, 'center');
      return;
    }
    const scale = Math.min(1, width / rendered.width);
    const w = Math.round(rendered.width * scale);
    const h = Math.round(rendered.height * scale);
    const x = this.opts.x + indent + Math.round((width - w) / 2);
    this.gap(this.opts.size * 0.3);
    const result = this.ctx.pictures.request({
      ref: { asset: rendered.asset, adjust: DEFAULT_ADJUST, quality: { ...DEFAULT_QUALITY, mode: 'crisp', colors: 16, dither: false } },
      w,
      h,
      background: this.opts.background,
    });
    if (result) {
      this.scene.prims.push({ type: 'image', x, y: this.y, w, h, image: result.index });
      this.scene.items.push({ kind: ITEM_IMAGE, flags: 0, ref: result.index, x, y: this.y, w, h, text: latex });
    }
    this.scene.search.push({ x, y: this.y, w, h, text: latex });
    this.y += h + Math.round(this.opts.size * 0.6);
  }

  private table(node: RichNode, indent: number, width: number) {
    const rows = (node.content ?? []).filter((r) => r.type === 'tableRow');
    if (!rows.length) return;
    const pad = 4;
    const size = Math.max(8, Math.round(this.opts.size * 0.92));
    const theme = this.ctx.theme;
    const cols = Math.max(...rows.map((r) => (r.content ?? []).reduce((n, c) => n + Number(c.attrs?.colspan ?? 1), 0)));

    // Column weights: editor widths when present, otherwise natural widths.
    const weights = new Array(cols).fill(0);
    for (const row of rows) {
      let col = 0;
      for (const cell of row.content ?? []) {
        const span = Number(cell.attrs?.colspan ?? 1);
        const set = cell.attrs?.colwidth as number[] | null | undefined;
        const text = richPlainText(cell);
        const longest = Math.max(0, ...text.split('\n').map((l) => this.ctx.font(this.opts.family, size, cell.type === 'tableHeader').face.width(l)));
        for (let k = 0; k < span && col + k < cols; k++) {
          const wk = set?.[k] ?? Math.min(longest / span + pad * 2, width) ;
          weights[col + k] = Math.max(weights[col + k], wk, 24);
        }
        col += span;
      }
    }
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    const colW = weights.map((w) => Math.max(16, Math.floor((w / sum) * width)));
    colW[cols - 1] += width - colW.reduce((a, b) => a + b, 0);
    const colX = colW.map((_, i) => colW.slice(0, i).reduce((a, b) => a + b, 0));

    this.gap(this.opts.size * 0.3);
    const x0 = this.opts.x + indent;
    const top = this.y;
    for (const row of rows) {
      const rowY = this.y;
      const laid: { sub: SceneBuilder; h: number; x: number; w: number; header: boolean; bg?: string }[] = [];
      let col = 0;
      for (const cell of row.content ?? []) {
        const span = Number(cell.attrs?.colspan ?? 1);
        const w = colX[Math.min(cols - 1, col + span - 1)] + colW[Math.min(cols - 1, col + span - 1)] - colX[col];
        const header = cell.type === 'tableHeader';
        const bg = (cell.attrs?.backgroundColor as string | undefined) || (header ? theme.tableHeader : undefined);
        const sub = new SceneBuilder();
        const flow = new Flow(this.ctx, sub, {
          ...this.opts,
          x: 0,
          y: 0,
          width: w - pad * 2,
          size,
          lineHeight: 1.25,
          spacing: 0.3,
          headings: false,
          background: bg ?? this.opts.background,
        });
        for (const child of cell.content ?? []) {
          if (header && child.type === 'paragraph') {
            const runs = flow.inline(child, { ...flow.baseStyleFor(size), bold: true });
            flow.paragraph(runs, 0, w - pad * 2, alignOf(child, 'left'));
          } else {
            flow.run(child);
          }
        }
        laid.push({ sub, h: Math.max(flow.y, Math.round(size * 1.25)), x: x0 + colX[col], w, header, bg });
        col += span;
      }
      const rowH = Math.max(...laid.map((c) => c.h + pad * 2));
      for (const c of laid) {
        if (c.bg) this.scene.prims.push(rect(c.x, rowY, c.w, rowH, c.bg));
        for (const p of c.sub.prims) this.scene.prims.push(shift(p, c.x + pad, rowY + pad));
        for (const it of c.sub.items) this.scene.items.push({ ...it, x: it.x + c.x + pad, y: it.y + rowY + pad });
        const text = c.sub.search.map((s) => s.text).join(' ');
        if (text) this.scene.search.push({ x: c.x, y: rowY, w: c.w, h: rowH, text });
      }
      this.scene.prims.push(rect(x0, rowY, width, 1, theme.line));
      this.y += rowH;
    }
    // Outer border and column lines.
    this.scene.prims.push(rect(x0, this.y, width, 1, theme.line));
    for (let c = 0; c <= cols; c++) {
      const x = c === cols ? x0 + width - 1 : x0 + colX[c];
      this.scene.prims.push(rect(x, top, 1, this.y - top + 1, theme.line));
    }
    this.y += 1 + Math.round(this.opts.size * 0.6);
  }

  baseStyleFor(size: number): Style {
    return { ...this.baseStyle(), size };
  }
}

function sameRun(a: Piece, b: Piece): boolean {
  return (
    a.font.index === b.font.index &&
    a.style.color === b.style.color &&
    a.style.underline === b.style.underline &&
    a.style.strike === b.style.strike &&
    a.style.highlight === b.style.highlight &&
    a.style.code === b.style.code
  );
}

function alignOf(node: RichNode, fallback: Align = 'left'): Align {
  const a = node.attrs?.textAlign;
  return a === 'center' || a === 'right' || a === 'justify' || a === 'left' ? a : fallback;
}

export function rect(x: number, y: number, w: number, h: number, color: string, alpha = 255, radius = 0) {
  return {
    type: 'rect' as const,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.max(0, Math.round(w)),
    h: Math.max(0, Math.round(h)),
    color: rgb565(color),
    alpha,
    radius,
    borderColor: 0,
    borderWidth: 0,
  };
}

export function shift<T extends { x: number; y: number }>(p: T, dx: number, dy: number): T {
  const moved = { ...p, x: p.x + dx, y: p.y + dy };
  if ((p as { type?: string }).type === 'line') {
    const l = moved as unknown as { x0: number; y0: number; x1: number; y1: number };
    l.x0 += dx;
    l.x1 += dx;
    l.y0 += dy;
    l.y1 += dy;
  }
  return moved;
}

export { CJK };
