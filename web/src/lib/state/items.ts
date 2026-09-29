// Edits to the free-placed items of the current slide or canvas.

import type { Item, Project } from '../../model/types.ts';
import { newId } from './assets.ts';
import { store } from './project.svelte.ts';

/** Items array of the currently edited slide/canvas inside a project draft. */
function container(p: Project): Item[] | undefined {
  const section = p.sections.find((s) => s.id === store.section?.id);
  if (section?.mode === 'canvas') return section.items;
  if (section?.mode === 'slides') {
    const slide = section.slides.find((s) => s.id === store.slide?.id) ?? section.slides[0];
    return slide?.items;
  }
  return undefined;
}

export function updateItem(id: string, patch: Partial<Item>, key = `item:${id}`) {
  store.edit((p) => {
    const item = container(p)?.find((i) => i.id === id);
    if (item) Object.assign(item, patch);
  }, key);
}

export function addItems(items: Item[]) {
  store.edit((p) => container(p)?.push(...items));
  store.select({ items: items.map((i) => i.id) });
}

export function removeItems(ids: string[]) {
  store.edit((p) => {
    const list = container(p);
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) if (ids.includes(list[i].id)) list.splice(i, 1);
  });
  store.select({ items: [] });
}

export function duplicateItems(ids: string[], offset = 12) {
  const copies: Item[] = [];
  store.edit((p) => {
    const list = container(p);
    if (!list) return;
    for (const item of list.filter((i) => ids.includes(i.id))) {
      const copy = structuredClone($state.snapshot(item)) as Item;
      copy.id = newId('i');
      copy.x += offset;
      copy.y += offset;
      copies.push(copy);
    }
    list.push(...copies);
  });
  store.select({ items: copies.map((c) => c.id) });
}

export function pasteItems(items: Item[]) {
  for (const it of items) {
    it.id = newId('i');
    it.x += 12;
    it.y += 12;
  }
  addItems(items);
}

export function reorderItems(ids: string[], where: 'front' | 'back' | 'forward' | 'backward') {
  store.edit((p) => {
    const list = container(p);
    if (!list) return;
    const picked = list.filter((i) => ids.includes(i.id));
    if (where === 'front' || where === 'back') {
      const rest = list.filter((i) => !ids.includes(i.id));
      list.splice(0, list.length, ...(where === 'front' ? [...rest, ...picked] : [...picked, ...rest]));
      return;
    }
    for (const item of where === 'forward' ? [...picked].reverse() : picked) {
      const i = list.indexOf(item);
      const j = where === 'forward' ? i + 1 : i - 1;
      if (j < 0 || j >= list.length) continue;
      [list[i], list[j]] = [list[j], list[i]];
    }
  });
}
