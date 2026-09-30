<script lang="ts">
  import { ChevronsLeft, EyeOff, Plus, Redo2, Settings, Undo2, X } from '@lucide/svelte';
  import type { SectionMode } from '../../model/types.ts';
  import { MODE_INFO, SECTION_ICONS } from '../icons.ts';
  import IconButton from '../ui/IconButton.svelte';
  import Menu from '../ui/Menu.svelte';
  import Popover from '../ui/Popover.svelte';
  import AppPanel from './inspector/AppPanel.svelte';
  import { newId } from '../state/assets.ts';
  import { newSection } from '../state/defaults.ts';
  import { store } from '../state/project.svelte.ts';
  import { pickFiles } from './DropZone.svelte';

  interface Props {
    oncollapse?: () => void;
  }
  let { oncollapse }: Props = $props();

  let addOpen = $state<'top' | 'bottom' | null>(null);
  let appOpen = $state(false);
  let rowMenu = $state<string | null>(null);
  let dragging = $state<number | null>(null);
  let over = $state<number | null>(null);

  const sections = $derived(store.project?.sections ?? []);
  const selected = $derived(store.section?.id);

  function add(mode: SectionMode) {
    addOpen = null;
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

  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  function summary(s: (typeof sections)[number]): string {
    const mode = MODE_INFO[s.mode].label;
    switch (s.mode) {
      case 'slides':
        return `${mode} · ${plural(s.slides.length, 'slide')}`;
      case 'gallery':
        return `${mode} · ${plural(s.images.length, 'picture')}`;
      case 'notes':
        return s.notes.length ? `${mode} · ${plural(s.notes.length, 'starter note')}` : mode;
      case 'canvas':
        return s.items.length ? `${mode} · ${plural(s.items.length, 'item')}` : mode;
      default:
        return mode;
    }
  }
</script>

<div class="list-panel">
  <div class="topbar">
    <Menu open={addOpen === 'top'} onclose={() => (addOpen = null)}>
      {#snippet trigger()}
        <IconButton label="Add" onclick={() => (addOpen = addOpen === 'top' ? null : 'top')}><Plus strokeWidth={2.5} /></IconButton>
      {/snippet}
      {@render addItems()}
    </Menu>
    <span class="history">
      <IconButton label="Undo (⌘Z)" disabled={!store.canUndo} onclick={() => store.undo()}><Undo2 /></IconButton>
      <IconButton label="Redo (⇧⌘Z)" disabled={!store.canRedo} onclick={() => store.redo()}><Redo2 /></IconButton>
    </span>
    <span class="spacer"></span>
    <Popover open={appOpen} title="App settings" align="left" onclose={() => (appOpen = false)}>
      {#snippet trigger()}
        <IconButton label="App settings" active={appOpen} onclick={() => (appOpen = !appOpen)}><Settings /></IconButton>
      {/snippet}
      <AppPanel />
    </Popover>
    {#if oncollapse}
      <IconButton label="Hide sections" class="collapse" onclick={oncollapse}><ChevronsLeft /></IconButton>
    {/if}
  </div>

  <ul class="rows" role="listbox" aria-label="Sections">
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
        <span class="tab" title="Drag to reorder">{i + 1}</span>
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
            <button class="more" aria-label="Section options" onclick={() => (rowMenu = rowMenu === s.id ? null : s.id)}>⋯</button>
          {/snippet}
          <button class="item" onclick={() => duplicate(s.id)}>Duplicate</button>
          <button class="item" onclick={() => toggleHidden(s.id)}>{s.hidden ? 'Show on home screen' : 'Hide from home screen'}</button>
        </Menu>
        <button class="delete" aria-label="Delete section" title="Delete" onclick={() => remove(s.id)}><X size={16} /></button>
      </li>
    {/each}
    <li
      class="new"
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
    >
      <span class="tab">{sections.length + 1}</span>
      <Menu open={addOpen === 'bottom'} onclose={() => (addOpen = null)}>
        {#snippet trigger()}
          <button class="row placeholder" onclick={() => (addOpen = addOpen === 'bottom' ? null : 'bottom')}>Add a section</button>
        {/snippet}
        {@render addItems()}
      </Menu>
    </li>
  </ul>

  <p class="foot">Drop pictures, PDFs and documents anywhere, or <button class="text-link" onclick={pickFiles}>choose files</button>.</p>
</div>

{#snippet addItems()}
  {#each Object.entries(MODE_INFO) as [mode, info] (mode)}
    {@const Icon = SECTION_ICONS[info.icon]}
    <button class="item" onclick={() => add(mode as SectionMode)}>
      <Icon />
      <span>{info.label}<span class="desc">{info.description}</span></span>
    </button>
  {/each}
  <div class="sep"></div>
  <button
    class="item"
    onclick={() => {
      addOpen = null;
      pickFiles();
    }}><span>Files<span class="desc">Pictures, PDFs, GIFs, Word, text</span></span></button
  >
{/snippet}

<style>
  .list-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 46px;
    padding: 0 6px;
    border-bottom: 1px solid var(--line-strong);
    flex: none;
  }
  .history {
    display: flex;
    margin-left: 8px;
  }
  .spacer {
    flex: 1;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow: auto;
    flex: 0 1 auto;
  }
  li {
    position: relative;
    display: flex;
    align-items: stretch;
    min-height: 56px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }
  li.drop-before::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: -2px;
    height: 3px;
    background: var(--accent);
    z-index: 1;
  }
  /* The numbered tab down the left edge, as in Desmos. */
  .tab {
    width: 38px;
    flex: none;
    background: var(--tab);
    border-right: 1px solid rgba(0, 0, 0, 0.06);
    color: rgba(0, 0, 0, 0.6);
    font-size: 11px;
    padding: 3px 0 0 4px;
    cursor: grab;
    user-select: none;
  }
  li.selected .tab {
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  li.selected {
    background: #fffcf5;
  }
  .row {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    border: none;
    background: transparent;
    padding: 8px 8px 8px 12px;
    text-align: left;
    min-width: 0;
  }
  .icon {
    width: 28px;
    height: 28px;
    border-radius: 6px;
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
    font-size: 15px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 12px;
    color: var(--dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hidden {
    display: grid;
    color: var(--faint);
  }
  .more,
  .delete {
    align-self: center;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--faint);
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    font-size: 16px;
    opacity: 0;
  }
  .delete {
    margin-right: 4px;
  }
  li:hover .more,
  li:hover .delete,
  li.selected .more,
  li.selected .delete,
  .more:focus-visible,
  .delete:focus-visible {
    opacity: 1;
  }
  .more:hover,
  .delete:hover {
    background: var(--hover);
    color: var(--text);
  }
  li.new :global(.menu-root) {
    flex: 1;
  }
  .placeholder {
    width: 100%;
    color: var(--faint);
    font-size: 15px;
  }
  .placeholder:hover {
    color: var(--dim);
  }
  .foot {
    padding: 14px 16px;
    font-size: 12px;
    color: var(--dim);
  }
  .foot .text-link {
    font-size: 12px;
  }
  @media (max-width: 900px) {
    .topbar :global(.collapse) {
      display: none;
    }
  }
</style>
