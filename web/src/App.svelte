<script lang="ts">
  import { onMount } from 'svelte';
  import DropZone from './lib/components/DropZone.svelte';
  import Preview from './lib/components/Preview.svelte';
  import SectionEditor from './lib/components/SectionEditor.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import TopBar from './lib/components/TopBar.svelte';
  import Welcome from './lib/components/Welcome.svelte';
  import { build } from './lib/state/build.svelte.ts';
  import { removeItems } from './lib/state/items.ts';
  import { store } from './lib/state/project.svelte.ts';

  let booting = $state(true);
  let mobileTab = $state<'sections' | 'edit' | 'preview'>('edit');
  let listOpen = $state(true);

  onMount(async () => {
    await store.refreshList();
    await store.restoreLast();
    booting = false;
  });

  // Rebuild the calculator app shortly after every edit.
  $effect(() => {
    store.revision;
    if (store.project) build.schedule();
  });

  function isEditable(el: EventTarget | null): boolean {
    const e = el as HTMLElement | null;
    return !!e && (e.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName));
  }

  function onKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    // Delete selected items even when focus left the slide (e.g. after a popover).
    if ((e.key === 'Delete' || e.key === 'Backspace') && e.target === document.body && store.selection.items.length) {
      const mode = store.section?.mode;
      if (mode === 'slides' || mode === 'canvas') {
        e.preventDefault();
        removeItems(store.selection.items);
      }
      return;
    }
    if (!mod || isEditable(e.target)) return;
    if (e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if booting}
  <div class="boot"></div>
{:else if !store.project}
  <Welcome />
{:else}
  <div class="app" data-tab={mobileTab}>
    <TopBar />
    <div class="body" class:no-list={!listOpen}>
      {#if listOpen}
        <!-- On phones, picking a section opens it. -->
        <aside
          class="col list"
          role="presentation"
          onclick={(e) => {
            if (mobileTab === 'sections' && (e.target as HTMLElement).closest('[role="option"]')) mobileTab = 'edit';
          }}
        >
          <Sidebar oncollapse={() => (listOpen = false)} />
        </aside>
      {/if}
      <main class="col edit">
        {#if !listOpen}
          <button class="show-list" title="Show sections" aria-label="Show sections" onclick={() => (listOpen = true)}>»</button>
        {/if}
        <SectionEditor />
      </main>
      <aside class="col device"><Preview /></aside>
    </div>
    <nav class="tabs">
      <button class:on={mobileTab === 'sections'} onclick={() => ((mobileTab = 'sections'), (listOpen = true))}>Sections</button>
      <button class:on={mobileTab === 'edit'} onclick={() => (mobileTab = 'edit')}>Edit</button>
      <button class:on={mobileTab === 'preview'} onclick={() => (mobileTab = 'preview')}>Calculator</button>
    </nav>
  </div>
  <DropZone />
{/if}

<style>
  .boot {
    height: 100%;
  }
  .app {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 0;
    background: var(--bg);
  }
  .body {
    display: grid;
    grid-template-columns: 340px minmax(0, 1fr) auto;
    min-height: 0;
  }
  .body.no-list {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .col {
    min-height: 0;
  }
  .list {
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border-right: 1px solid var(--line-strong);
    overflow: hidden;
  }
  .edit {
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .show-list {
    position: absolute;
    left: 8px;
    top: 52px;
    z-index: 5;
    width: 34px;
    height: 34px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: var(--radius);
    background: var(--btn);
    box-shadow: var(--shadow);
    font-size: 18px;
    line-height: 1;
  }
  .show-list:hover {
    background: var(--btn-hover);
  }
  .device {
    height: 100%;
    overflow: hidden;
    border-left: 1px solid var(--line-strong);
    background: var(--panel);
    min-width: 260px;
  }
  .tabs {
    display: none;
  }

  @media (max-width: 1180px) {
    .body {
      grid-template-columns: 290px minmax(0, 1fr) auto;
    }
  }

  @media (max-width: 900px) {
    .app {
      grid-template-rows: auto 1fr auto;
    }
    .body,
    .body.no-list {
      grid-template-columns: 1fr;
    }
    .col {
      display: none;
      border: none;
    }
    .app[data-tab='sections'] .list,
    .app[data-tab='edit'] .edit,
    .app[data-tab='preview'] .device {
      display: flex;
      flex-direction: column;
    }
    .device {
      height: auto;
      min-height: 0;
    }
    .show-list {
      display: none;
    }
    .tabs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      background: var(--panel);
      border-top: 1px solid var(--line-strong);
    }
    .tabs button {
      border: none;
      border-top: 3px solid transparent;
      background: transparent;
      padding: 9px 4px 11px;
      font-size: 13px;
      color: var(--dim);
    }
    .tabs button.on {
      border-top-color: var(--accent);
      color: var(--text);
      font-weight: 600;
    }
  }
</style>
