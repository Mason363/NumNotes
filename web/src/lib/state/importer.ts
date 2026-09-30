// Puts imported files into the project: pictures become slides, gallery
// entries, canvas items or document pictures; text becomes documents/notes.

import { generateJSON } from '@tiptap/core';
import type { Imported } from '../../import/index.ts';
import type { AssetMeta, CanvasSection, DocumentSection, GallerySection, Project, RichNode, Section, SectionMode, SlidesSection } from '../../model/types.ts';
import { DEFAULT_ADJUST, DEFAULT_QUALITY } from '../../pack/images.ts';
import { richExtensions } from '../doc/extensions.ts';
import { assets, newId } from './assets.ts';
import { doc, imageItem, newSection, newSlide, p, slideHeight, table } from './defaults.ts';
import { store } from './project.svelte.ts';

export type Destination = { kind: 'current' } | { kind: 'new'; mode: SectionMode };

export interface ImportSummary {
  pictures: number;
  animations: number;
  texts: number;
  names: string[];
}

export function summarize(items: Imported[]): ImportSummary {
  const s: ImportSummary = { pictures: 0, animations: 0, texts: 0, names: [] };
  for (const it of items) {
    s.names.push(it.name);
    if (it.kind === 'image') s.pictures++;
    else if (it.kind === 'animation') s.animations++;
    else if (it.kind === 'pages') s.pictures += it.pageCount;
    else s.texts++;
  }
  return s;
}

/** Where dropped files should go when the user doesn't say. */
export function suggestDestination(items: Imported[], current: Section | undefined): Destination {
  const s = summarize(items);
  const visual = s.pictures + s.animations;
  if (current) {
    if (visual && !s.texts && current.mode !== 'notes') return { kind: 'current' };
    if (s.texts && !visual && (current.mode === 'document' || current.mode === 'notes')) return { kind: 'current' };
  }
  if (s.texts && !visual) return { kind: 'new', mode: 'document' };
  if (items.some((i) => i.kind === 'pages')) return { kind: 'new', mode: 'slides' };
  return { kind: 'new', mode: visual >= 4 ? 'gallery' : 'slides' };
}

async function dataUrlAssets(html: string): Promise<string> {
  // Pictures embedded in pasted/converted documents become assets.
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const img of [...parsed.querySelectorAll('img')]) {
    const src = img.getAttribute('src') ?? '';
    try {
      const blob = await (await fetch(src)).blob();
      const bitmap = await createImageBitmap(blob);
      const meta = await assets.addBitmap(img.getAttribute('alt') || 'Picture', bitmap, blob.type === 'image/png');
      const figure = parsed.createElement('figure');
      figure.dataset.asset = meta.id;
      figure.dataset.width = '100';
      img.replaceWith(figure);
    } catch {
      img.remove();
    }
  }
  return parsed.body.innerHTML;
}

async function richFrom(item: Imported): Promise<RichNode[]> {
  switch (item.kind) {
    case 'rich': {
      const html = await dataUrlAssets(item.html);
      const json = generateJSON(html, richExtensions()) as RichNode;
      return json.content ?? [];
    }
    case 'text':
      return item.text
        .split(/\n{2,}/)
        .filter((block) => block.trim())
        .map((block) => {
          const lines = block.split('\n');
          const content: RichNode[] = [];
          lines.forEach((line, i) => {
            if (i > 0) content.push({ type: 'hardBreak' });
            if (line) content.push({ type: 'text', text: line });
          });
          return { type: 'paragraph', content };
        });
    case 'table':
      return [table(item.rows, { header: true })];
    default:
      return [];
  }
}

function pictureNode(meta: AssetMeta): RichNode {
  return { type: 'picture', attrs: { asset: meta.id, width: 100, align: 'center', caption: '' } };
}

function galleryImage(meta: AssetMeta) {
  return { id: newId('g'), asset: meta.id, caption: '', adjust: { ...DEFAULT_ADJUST }, quality: { ...DEFAULT_QUALITY } };
}

/** Adds imported content; returns the section that received it. */
export async function addImports(
  items: Imported[],
  destination: Destination,
  onProgress?: (fraction: number, label: string) => void,
): Promise<Section | undefined> {
  const project = store.project;
  if (!project) return undefined;

  // Store binary content first (slow: PDFs render, animations encode).
  const metas: AssetMeta[] = [];
  const blocks: { name: string; nodes: RichNode[] }[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.(i / items.length, `Adding ${item.name}`);
    if (item.kind === 'image' || item.kind === 'animation' || item.kind === 'pages') {
      metas.push(...(await assets.add(item, (f) => onProgress?.((i + f) / items.length, `Adding ${item.name}`))));
    } else {
      blocks.push({ name: item.name, nodes: await richFrom(item) });
    }
  }
  onProgress?.(1, 'Done');

  let target: Section | undefined;
  let firstNewSlide: string | null = null;
  store.edit((proj: Project) => {
    const current = proj.sections.find((s) => s.id === store.section?.id);
    if (destination.kind === 'current' && current) {
      target = current;
    } else {
      const mode = destination.kind === 'new' ? destination.mode : 'slides';
      const title = items.length === 1 ? items[0].name.replace(/\.[^.]+$/, '').slice(0, 40) : undefined;
      target = newSection(mode, title, proj.sections.length);
      if (target.mode === 'slides') target.slides = [];
      if (target.mode === 'document') target.doc = doc();
      proj.sections.push(target);
    }
    const before = target.mode === 'slides' ? target.slides.length : 0;
    place(target, metas, blocks);
    if (target.mode === 'slides') firstNewSlide = target.slides[before]?.id ?? null;
  });
  // Show what was just added.
  if (target) store.select({ section: target.id, slide: firstNewSlide, items: [] });
  return target;
}

function place(target: Section, metas: AssetMeta[], blocks: { name: string; nodes: RichNode[] }[]) {
  switch (target.mode) {
    case 'slides': {
      const s = target as SlidesSection;
      const h = slideHeight(s);
      for (const m of metas) s.slides.push(newSlide([imageItem(m.id, 0, 0, 320, h, { fit: 'contain' })], m.name));
      for (const b of blocks) {
        s.slides.push(newSlide([{ id: newId('i'), type: 'text', x: 10, y: 8, w: 300, h: h - 16, doc: doc(...b.nodes), radius: 0, padding: 4, valign: 'top' }], b.name));
      }
      break;
    }
    case 'gallery':
      (target as GallerySection).images.push(...metas.map(galleryImage));
      break;
    case 'canvas': {
      const c = target as CanvasSection;
      const cols = Math.ceil(Math.sqrt(metas.length || 1));
      const cell = 280;
      metas.forEach((m, i) => {
        const scale = Math.min(cell / m.width, cell / m.height, 1);
        const w = Math.round(m.width * scale);
        const h = Math.round(m.height * scale);
        const x = 20 + (i % cols) * (cell + 20);
        const y = 20 + Math.floor(i / cols) * (cell + 20);
        c.items.push({ ...imageItem(m.id, x, y, w, h), stop: true });
      });
      const maxX = Math.max(c.width, ...c.items.map((it) => it.x + it.w + 20));
      const maxY = Math.max(c.height, ...c.items.map((it) => it.y + it.h + 20));
      c.width = maxX;
      c.height = maxY;
      break;
    }
    case 'document': {
      const d = target as DocumentSection;
      const content = d.doc.content ?? (d.doc.content = []);
      for (const b of blocks) content.push(...b.nodes);
      for (const m of metas) content.push(pictureNode(m));
      if (!content.length) content.push(p(''));
      break;
    }
    case 'notes':
      for (const b of blocks) {
        const text = b.nodes.map((n) => plain(n)).join('\n').trim();
        if (text) target.notes.push(text);
      }
      break;
  }
}

function plain(node: RichNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content ?? []).map(plain).join('');
  return node.type === 'paragraph' || node.type === 'heading' ? inner + '\n' : inner;
}
