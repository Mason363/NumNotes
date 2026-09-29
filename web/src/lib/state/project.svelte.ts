// The open project: reactive state, selection, undo/redo and autosave.

import type { Item, Project, Section, Slide } from '../../model/types.ts';
import { assets } from './assets.ts';
import { db, kvGet, kvSet } from './db.ts';

export interface Selection {
  section: string | null;
  slide: string | null;
  items: string[];
}

const HISTORY_LIMIT = 100;
const COALESCE_MS = 900;

function clone<T>(v: T): T {
  return structuredClone($state.snapshot(v)) as T;
}

class ProjectStore {
  project = $state<Project | null>(null);
  selection = $state<Selection>({ section: null, slide: null, items: [] });
  /** Bumped on every edit; the preview rebuilds when it changes. */
  revision = $state(0);
  saving = $state(false);
  projects = $state<{ id: string; name: string; updatedAt: number }[]>([]);
  /** Picture selected inside a rich text editor (for the inspector). */
  focusPicture = $state.raw<{ attrs: Record<string, unknown>; apply: (attrs: Record<string, unknown>) => void } | null>(null);
  /** Rich text editor that has focus (for inserting pictures/formulas). */
  activeEditor = $state.raw<import('@tiptap/core').Editor | null>(null);
  /** Bumped on every rich text transaction (toolbar button states). */
  editorTick = $state(0);

  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private lastKey = '';
  private lastTime = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  canUndo = $state(false);
  canRedo = $state(false);

  get section(): Section | undefined {
    const p = this.project;
    return p?.sections.find((s) => s.id === this.selection.section) ?? p?.sections[0];
  }

  get sectionIndex(): number {
    const p = this.project;
    const s = this.section;
    return p && s ? p.sections.indexOf(s) : -1;
  }

  get slide(): Slide | undefined {
    const s = this.section;
    if (s?.mode !== 'slides') return undefined;
    return s.slides.find((x) => x.id === this.selection.slide) ?? s.slides[0];
  }

  get slideIndex(): number {
    const s = this.section;
    const sl = this.slide;
    return s?.mode === 'slides' && sl ? s.slides.indexOf(sl) : 0;
  }

  /** Items of the current slide or canvas. */
  get items(): Item[] {
    const s = this.section;
    if (s?.mode === 'slides') return this.slide?.items ?? [];
    if (s?.mode === 'canvas') return s.items;
    return [];
  }

  get selectedItems(): Item[] {
    return this.items.filter((i) => this.selection.items.includes(i.id));
  }

  async open(project: Project) {
    await assets.load(assetIds(project));
    this.project = project;
    this.undoStack = [];
    this.redoStack = [];
    this.updateFlags();
    this.selection = { section: project.sections[0]?.id ?? null, slide: null, items: [] };
    this.revision++;
    await kvSet('lastProject', project.id);
    this.scheduleSave();
  }

  async openById(id: string): Promise<boolean> {
    const p = await (await db()).get('projects', id).catch(() => undefined);
    if (!p) return false;
    await this.open(p);
    return true;
  }

  async restoreLast(): Promise<boolean> {
    const id = await kvGet<string>('lastProject');
    return id ? this.openById(id) : false;
  }

  async refreshList() {
    try {
      const all = await (await db()).getAll('projects');
      this.projects = all.map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      this.projects = [];
    }
  }

  async remove(id: string) {
    await (await db()).delete('projects', id).catch(() => {});
    await this.refreshList();
  }

  /**
   * Applies an edit. Edits with the same `key` in quick succession (typing,
   * dragging) collapse into one undo step.
   */
  edit(fn: (p: Project) => void, key = '') {
    const p = this.project;
    if (!p) return;
    const now = Date.now();
    if (!key || key !== this.lastKey || now - this.lastTime > COALESCE_MS) {
      this.undoStack.push(clone(p));
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
    }
    this.lastKey = key;
    this.lastTime = now;
    fn(p);
    p.updatedAt = now;
    this.changed();
  }

  private changed() {
    this.revision++;
    this.updateFlags();
    this.scheduleSave();
  }

  private updateFlags() {
    this.canUndo = this.undoStack.length > 0;
    this.canRedo = this.redoStack.length > 0;
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev || !this.project) return;
    this.redoStack.push(clone(this.project));
    this.project = prev;
    this.lastKey = '';
    this.fixSelection();
    this.changed();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next || !this.project) return;
    this.undoStack.push(clone(this.project));
    this.project = next;
    this.lastKey = '';
    this.fixSelection();
    this.changed();
  }

  private fixSelection() {
    const p = this.project;
    if (!p) return;
    if (!p.sections.some((s) => s.id === this.selection.section)) {
      this.selection = { section: p.sections[0]?.id ?? null, slide: null, items: [] };
    }
    const ids = new Set(this.items.map((i) => i.id));
    this.selection.items = this.selection.items.filter((i) => ids.has(i));
  }

  select(patch: Partial<Selection>) {
    this.selection = { ...this.selection, ...patch };
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 700);
  }

  async save() {
    const p = this.project;
    if (!p) return;
    this.saving = true;
    try {
      await (await db()).put('projects', clone(p), p.id);
    } catch {
      /* storage unavailable */
    } finally {
      this.saving = false;
    }
  }
}

export function assetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  if (project.icon.kind === 'image') ids.add(project.icon.asset);
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; attrs?: { asset?: unknown }; content?: unknown[] };
    if ((n.type === 'image' || n.type === 'picture') && typeof n.attrs?.asset === 'string') ids.add(n.attrs.asset);
    n.content?.forEach(walk);
  };
  for (const s of project.sections) {
    if (s.mode === 'slides') for (const sl of s.slides) for (const it of sl.items) if (it.type === 'image') ids.add(it.asset);
    if (s.mode === 'canvas') for (const it of s.items) if (it.type === 'image') ids.add(it.asset);
    if (s.mode === 'gallery') for (const im of s.images) ids.add(im.asset);
    if (s.mode === 'document') walk(s.doc);
    if (s.mode === 'slides' || s.mode === 'canvas') {
      const items = s.mode === 'slides' ? s.slides.flatMap((x) => x.items) : s.items;
      for (const it of items) if (it.type === 'text') walk(it.doc);
    }
  }
  return ids;
}

export const store = new ProjectStore();
