<script lang="ts">
    import type { SectionMode } from '../../model/types.ts';
  import { MODE_INFO, SECTION_ICONS } from '../icons.ts';
  import Menu from '../ui/Menu.svelte';
  import { newId } from '../state/assets.ts';
  import { newSection } from '../state/defaults.ts';
  import { store } from '../state/project.svelte.ts';
  import { pickFiles } from './DropZone.svelte';

  let addOpen = $state(false);
  let rowMenu = $state<string | null>(null);
  let dragging = $state<number | null>(null);
  let over = $state<number | null>(null);

  const sections = $derived(store.project?.sections ?? []);
  const selected = $derived(store.section?.id);

  function add(mode: SectionMode) {
    addOpen = false;
    const section = newSection(mode, undefined, sections.length);
    store.edit((p) => p.sections.push(section));
    store.select({ section: section.id, slide: null, items: [] });
  }

  function duplicate(id: string) {
    rowMenu = null;
    store.edit((p) => {
      const i = p.sections.findIndex((s) => s.id === id);
      const copy = structuredClone($state.snapshot(p.sections[i]));
      copy.id = newId('sec');
      copy.title = `${copy.title} copy`;
      p.sections.splice(i + 1, 0, copy);
    });
  }

  function remove(id: string) {
    rowMenu = null;
    const s = sections.find((x) => x.id === id);
    if (!s || !confirm(`Delete the section “${s.title}”?`)) return;
    store.edit((p) => (p.sections = p.sections.filter((x) => x.id !== id)));
    if (selected === id) store.select({ section: store.project?.sections[0]?.id ?? null, slide: null, items: [] });
  }

  function toggleHidden(id: string) {
    rowMenu = null;
    store.edit((p) => {
      const s = p.sections.find((x) => x.id === id);
      if (s) s.hidden = !s.hidden;
    });
  }

  function drop(to: number) {
    const from = dragging;
    dragging = over = null;
    if (from === null || from === to) return;
    store.edit((p) => {
      const [moved] = p.sections.splice(from, 1);
      p.sections.splice(to > from ? to - 1 : to, 0, moved);
    });
  }

  const summary = (s: (typeof sections)[number]) =>
    s.mode === 'slides'
      ? `${s.slides.length} slide${s.slides.length === 1 ? '' : 's'}`
      : s.mode === 'gallery'
        ? `${s.images.length} picture${s.images.length === 1 ? '' : 's'}`
        : s.mode === 'notes'
          ? `${s.notes.length} starter note${s.notes.length === 1 ? '' : 's'}`
          : MODE_INFO[s.mode].label;
</script>

<div class="sidebar">
  <div class="head">
    <h2>Sections</h2>
    <span class="muted small">Listed on the app's home screen</span>
  </div>

  <ul class="list" role="listbox" aria-label="Sections">
    {#each sections as s, i (s.id)}
      {@const Icon = SECTION_ICONS[s.icon]}
      <li
        class:selected={s.id === selected}
        class:drop-before={over === i && dragging !== null && dragging !== i}
        draggable="true"
        ondragstart={(e) => {
          dragging = i;
          e.dataTransfer?.setData('text/x-numnotes-section', s.id);
        }}
        ondragover={(e) => {
          if (dragging === null) return;
          e.preventDefault();
          over = i;
        }}
        ondrop={(e) => {
          e.preventDefault();
          drop(i);
        }}
        ondragend={() => (dragging = over = null)}
      >
        <button class="row" role="option" aria-selected={s.id === selected} onclick={() => store.select({ section: s.id, slide: null, items: [] })}>
          <span class="icon" style="background: {s.iconColor}"><Icon size={15} color="#fff" /></span>
          <span class="text">
            <span class="title">{s.title || 'Untitled'}</span>
            <span class="sub">{summary(s)}{s.hidden ? ' · hidden' : ''}</span>
          </span>
        </button>
        <Menu open={rowMenu === s.id} align="right" onclose={() => (rowMenu = null)}>
          {#snippet trigger()}
            <button class="more" aria-label="Section options" onclick={() => (rowMenu = rowMenu === s.id ? null : s.id)}>⋯</button>
          {/snippet}
          <button class="item" onclick={() => duplicate(s.id)}>Duplicate</button>
          <button class="item" onclick={() => toggleHidden(s.id)}>{s.hidden ? 'Show on home screen' : 'Hide from home screen'}</button>
          <div class="sep"></div>
          <button class="item" onclick={() => remove(s.id)}>Delete section</button>
        </Menu>
      </li>
    {/each}
    <li
      class="end"
      class:drop-before={over === sections.length && dragging !== null}
      ondragover={(e) => {
        if (dragging === null) return;
        e.preventDefault();
        over = sections.length;
      }}
      ondrop={(e) => {
        e.preventDefault();
        drop(sections.length);
      }}
    ></li>
  </ul>

  <div class="actions">
    <Menu open={addOpen} onclose={() => (addOpen = false)}>
      {#snippet trigger()}
        <button class="add" onclick={() => (addOpen = !addOpen)}>+ Add section</button>
      {/snippet}
      {#each Object.entries(MODE_INFO) as [mode, info] (mode)}
        {@const Icon = SECTION_ICONS[info.icon]}
        <button class="item" onclick={() => add(mode as SectionMode)}>
          <Icon />
          <span>{info.label}<span class="desc">{info.description}</span></span>
        </button>
      {/each}
    </Menu>
    <button class="add ghost" onclick={pickFiles} title="Pictures, PDFs, GIFs, videos, text, Word, CSV…">Add files…</button>
  </div>
  <p class="drop-hint muted small">Or drop files anywhere on the page.</p>
</div>

<style>
.sidebar {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }
  .head {
    padding: 10px 12px 6px;
    display: grid;
    gap: 1px;
  }
  h2 {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--dim);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  li {
    position: relative;
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  li.drop-before::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: -1px;
    height: 2px;
    background: var(--text);
  }
  li.end {
    height: 10px;
    border: none;
    background: transparent;
  }
  li:hover {
    background: var(--hover);
  }
  li.selected {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .row {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 9px;
    border: none;
    background: transparent;
    padding: 7px 10px 7px 12px;
    text-align: left;
    min-width: 0;
  }
  .icon {
    width: 22px;
    height: 22px;
    border-radius: 2px;
    display: grid;
    place-items: center;
    flex: none;
  }
  .text {
    display: grid;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 11.5px;
    color: var(--dim);
  }
  .more {
    border: none;
    background: transparent;
    color: var(--faint);
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    margin-right: 4px;
    opacity: 0;
  }
  li:hover .more,
  li.selected .more,
  .more:focus-visible {
    opacity: 1;
  }
  .more:hover {
    background: var(--line);
    color: var(--text);
  }
  .actions {
    display: grid;
    gap: 4px;
    padding: 8px 10px;
  }
  .actions :global(.menu-root) {
    display: block;
  }
  .add {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    font-weight: 600;
    border-radius: var(--radius-sm);
  }
  .add:hover {
    background: var(--hover);
  }
  .add.ghost {
    border-style: dashed;
    color: var(--dim);
    font-weight: 500;
  }
  .drop-hint {
    text-align: center;
    padding: 0 10px;
  }
</style>
