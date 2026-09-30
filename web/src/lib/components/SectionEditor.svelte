<script lang="ts">
  import { Plus, Settings, SlidersHorizontal } from '@lucide/svelte';
  import { MODE_INFO, SECTION_ICONS } from '../icons.ts';
  import Button from '../ui/Button.svelte';
  import Popover from '../ui/Popover.svelte';
  import ItemPanel from './inspector/ItemPanel.svelte';
  import SectionPanel from './inspector/SectionPanel.svelte';
  import { newSection } from '../state/defaults.ts';
  import { store } from '../state/project.svelte.ts';
  import CanvasEditor from './editors/CanvasEditor.svelte';
  import DocEditor from './editors/DocEditor.svelte';
  import GalleryEditor from './editors/GalleryEditor.svelte';
  import NotesEditor from './editors/NotesEditor.svelte';
  import SlidesEditor from './editors/SlidesEditor.svelte';

  const section = $derived(store.section);
  let settingsOpen = $state(false);
  let itemOpen = $state(false);

  // What's selected, for the options button.
  const itemLabel = $derived.by(() => {
    if (store.focusPicture) return 'Picture';
    const ids = store.selection.items;
    if (!ids.length) return null;
    if (section?.mode === 'gallery') return 'Picture';
    const items = store.selectedItems;
    if (items.length !== 1) return items.length ? `${items.length} items` : null;
    return items[0].type === 'image' ? 'Picture' : items[0].type === 'text' ? 'Text' : 'Shape';
  });
  $effect(() => {
    if (!itemLabel) itemOpen = false;
  });

  function addFirst() {
    const s = newSection('document', 'Notes', 0);
    store.edit((p) => p.sections.push(s));
    store.select({ section: s.id, slide: null, items: [] });
  }
</script>

{#if section}
  {@const Icon = SECTION_ICONS[section.icon]}
  <div class="section-editor">
    <header>
      <span class="icon" style="background: {section.iconColor}"><Icon size={16} color="#fff" strokeWidth={2.25} /></span>
      <input
        class="title"
        value={section.title}
        maxlength="40"
        aria-label="Section title"
        placeholder="Section title"
        oninput={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          const id = section.id;
          store.edit((p) => {
            const s = p.sections.find((x) => x.id === id);
            if (s) s.title = v;
          }, `title:${id}`);
        }}
      />
      <span class="mode">{MODE_INFO[section.mode].label}</span>
      {#if itemLabel}
        <Popover open={itemOpen} title="{itemLabel} options" onclose={() => (itemOpen = false)}>
          {#snippet trigger()}
            <Button size="sm" class="item-btn" onclick={() => (itemOpen = !itemOpen)}><SlidersHorizontal />{itemLabel} options</Button>
          {/snippet}
          <ItemPanel />
        </Popover>
      {/if}
      <Popover open={settingsOpen} title="Section settings" onclose={() => (settingsOpen = false)}>
        {#snippet trigger()}
          <Button size="sm" onclick={() => (settingsOpen = !settingsOpen)}><Settings />Settings</Button>
        {/snippet}
        <SectionPanel />
      </Popover>
    </header>
    <div class="body">
      {#key section.id}
        {#if section.mode === 'document'}
          <DocEditor {section} />
        {:else if section.mode === 'slides'}
          <SlidesEditor {section} />
        {:else if section.mode === 'canvas'}
          <CanvasEditor {section} />
        {:else if section.mode === 'gallery'}
          <GalleryEditor {section} />
        {:else}
          <NotesEditor {section} />
        {/if}
      {/key}
    </div>
  </div>
{:else}
  <div class="empty">
    <h2>Nothing here yet</h2>
    <p class="muted">Add a section, or drop files anywhere on the page.</p>
    <Button variant="primary" onclick={addFirst}><Plus strokeWidth={2.5} />Add a document</Button>
  </div>
{/if}

<style>
  .section-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px 0 12px;
    height: 46px;
    border-bottom: 1px solid var(--line-strong);
    background: var(--panel);
    flex: none;
  }
  .icon {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    flex: none;
  }
  .title {
    flex: 1;
    min-width: 0;
    border: 1px solid transparent;
    background: transparent;
    font-size: 16px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    color: var(--text);
  }
  .title:hover {
    border-color: var(--line);
  }
  .title:focus {
    border-color: var(--blue);
    outline: none;
  }
  .mode {
    font-size: 12px;
    color: var(--dim);
    margin-right: 4px;
  }
  header :global(.item-btn) {
    background: var(--accent-soft);
    border-color: rgba(245, 165, 28, 0.5);
  }
  header :global(.btn svg) {
    width: 15px;
    height: 15px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .empty {
    margin: auto;
    display: grid;
    gap: 12px;
    justify-items: center;
    text-align: center;
    padding: 40px;
  }
  .empty h2 {
    font-size: 22px;
    font-weight: 400;
  }
  @media (max-width: 640px) {
    .mode {
      display: none;
    }
  }
</style>
