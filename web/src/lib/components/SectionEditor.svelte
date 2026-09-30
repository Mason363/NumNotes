<script lang="ts">
  import { Plus } from '@lucide/svelte';
  import { MODE_INFO, SECTION_ICONS } from '../icons.ts';
  import Button from '../ui/Button.svelte';
  import { newSection } from '../state/defaults.ts';
  import { store } from '../state/project.svelte.ts';
  import CanvasEditor from './editors/CanvasEditor.svelte';
  import DocEditor from './editors/DocEditor.svelte';
  import GalleryEditor from './editors/GalleryEditor.svelte';
  import NotesEditor from './editors/NotesEditor.svelte';
  import SlidesEditor from './editors/SlidesEditor.svelte';

  const section = $derived(store.section);

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
    gap: 10px;
    padding: 0 16px 0 12px;
    height: 52px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }
  .icon {
    width: 30px;
    height: 30px;
    border-radius: 7px;
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
    font-weight: 700;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    color: var(--text);
  }
  .title:hover {
    background: var(--layout);
  }
  .title:focus {
    background: var(--panel);
    border-color: var(--purple);
    outline: none;
  }
  .mode {
    font-size: 12px;
    font-weight: 700;
    color: var(--purple);
    background: var(--purple-soft);
    padding: 3px 10px;
    border-radius: var(--pill);
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
    font-size: 28px;
    font-weight: 300;
  }
</style>
