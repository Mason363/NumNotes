<script lang="ts">
  import { Ellipsis, EyeOff, GripVertical, Plus } from '@lucide/svelte';
  import type { SectionMode } from '../../model/types.ts';
  import { MODE_INFO, SECTION_ICONS } from '../icons.ts';
  import Button from '../ui/Button.svelte';
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

<div class="deck">
  <div class="head">
    <h2 class="panel-title">Sections</h2>
    <Menu open={addOpen} align="right" onclose={() => (addOpen = false)}>
      {#snippet trigger()}
        <Button variant="primary" size="sm" onclick={() => (addOpen = !addOpen)}><Plus strokeWidth={2.5} />Add a section</Button>
      {/snippet}
      {#each Object.entries(MODE_INFO) as [mode, info] (mode)}
        {@const Icon = SECTION_ICONS[info.icon]}
        <button class="item" onclick={() => add(mode as SectionMode)}>
          <Icon />
          <span>{info.label}<span class="desc">{info.description}</span></span>
        </button>
      {/each}
    </Menu>
  </div>

  <ul class="list" role="listbox" aria-label="Sections">
    {#each sections as s, i (s.id)}
      {@const Icon = SECTION_ICONS[s.icon]}
      <li
        class="card"
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
        <span class="grip" aria-hidden="true"><GripVertical size={14} /></span>
        <button class="row" role="option" aria-selected={s.id === selected} onclick={() => store.select({ section: s.id, slide: null, items: [] })}>
          <span class="icon" style="background: {s.iconColor}"><Icon size={16} color="#fff" strokeWidth={2.25} /></span>
          <span class="text">
            <span class="name">{s.title || 'Untitled'}</span>
            <span class="sub">{summary(s)}</span>
          </span>
          {#if s.hidden}<span class="hidden" title="Hidden from the home screen"><EyeOff size={14} /></span>{/if}
        </button>
        <Menu open={rowMenu === s.id} align="right" onclose={() => (rowMenu = null)}>
          {#snippet trigger()}
            <button class="more" aria-label="Section options" onclick={() => (rowMenu = rowMenu === s.id ? null : s.id)}><Ellipsis size={14} strokeWidth={2.5} /></button>
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

  <p class="foot small muted">
    <button class="text-link" onclick={pickFiles} title="Pictures, PDFs, GIFs, videos, text, Word, CSV">Add files</button> or drop them anywhere.
  </p>
</div>

<style>
  .deck {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 0 2px 8px;
    min-height: 36px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .card {
    position: relative;
    display: flex;
    align-items: center;
    background: var(--card);
    border: 2px solid transparent;
    border-radius: var(--radius);
    transition: border-color 0.12s;
  }
  .card:hover {
    border-color: var(--card-hover);
  }
  .card.selected {
    border-color: var(--accent);
  }
  .card.drop-before::before,
  .end.drop-before::before {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    top: -5px;
    height: 3px;
    border-radius: 2px;
    background: var(--purple);
  }
  .end {
    position: relative;
    height: 4px;
  }
  .grip {
    display: grid;
    place-items: center;
    width: 18px;
    align-self: stretch;
    color: var(--faint);
    cursor: grab;
    flex: none;
  }
  .row {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    border: none;
    background: transparent;
    padding: 8px 4px 8px 0;
    text-align: left;
    min-width: 0;
  }
  .icon {
    width: 30px;
    height: 30px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    flex: none;
  }
  .text {
    display: grid;
    min-width: 0;
    flex: 1;
  }
  .name {
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 12px;
    color: var(--label);
  }
  .hidden {
    display: grid;
    color: var(--dim);
  }
  .more {
    border: none;
    border-radius: 50%;
    background: var(--panel);
    color: var(--label);
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    margin-right: 8px;
    opacity: 0;
  }
  .card:hover .more,
  .card.selected .more,
  .more:focus-visible {
    opacity: 1;
  }
  .more:hover {
    color: var(--purple);
  }
  .foot {
    padding: 0 8px;
  }
</style>
