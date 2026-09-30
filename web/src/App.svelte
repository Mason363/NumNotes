<script lang="ts">
  import { onMount } from 'svelte';
  import DropZone from './lib/components/DropZone.svelte';
  import Inspector from './lib/components/Inspector.svelte';
  import Preview from './lib/components/Preview.svelte';
  import SectionEditor from './lib/components/SectionEditor.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import TopBar from './lib/components/TopBar.svelte';
  import Welcome from './lib/components/Welcome.svelte';
  import { build } from './lib/state/build.svelte.ts';
  import { store } from './lib/state/project.svelte.ts';

  let booting = $state(true);
  let mobileTab = $state<'sections' | 'edit' | 'preview' | 'settings'>('edit');

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
    <div class="body">
      <aside class="col left">
        <!-- On phones, picking a section opens it. -->
        <div
          class="sections"
          role="presentation"
          onclick={(e) => {
            if (mobileTab === 'sections' && (e.target as HTMLElement).closest('[role="option"]')) mobileTab = 'edit';
          }}
        >
          <Sidebar />
        </div>
        <div class="settings"><Inspector /></div>
      </aside>
      <main class="col edit"><SectionEditor /></main>
      <aside class="col device"><Preview /></aside>
    </div>
    <nav class="tabs">
      <button class:on={mobileTab === 'sections'} onclick={() => (mobileTab = 'sections')}>Sections</button>
      <button class:on={mobileTab === 'edit'} onclick={() => (mobileTab = 'edit')}>Edit</button>
      <button class:on={mobileTab === 'preview'} onclick={() => (mobileTab = 'preview')}>Preview</button>
      <button class:on={mobileTab === 'settings'} onclick={() => (mobileTab = 'settings')}>Settings</button>
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
    background: var(--layout);
  }
  .body {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr) auto;
    min-height: 0;
  }
  .col {
    min-height: 0;
  }
  .left {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 0 8px 8px;
    overflow: auto;
  }
  .sections {
    flex: none;
  }
  .settings {
    flex: 1 0 auto;
  }
  /* The editor sits on a white surface, like the Board's graph. */
  .edit {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    margin: 8px 8px 8px 8px;
    background: var(--panel);
    border-radius: var(--radius-lg);
  }
  .device {
    padding: 8px 8px 8px 0;
    height: 100%;
    overflow: hidden;
    min-width: 260px;
  }
  .tabs {
    display: none;
  }

  @media (max-width: 1180px) {
    .body {
      grid-template-columns: 268px minmax(0, 1fr) auto;
    }
  }

  @media (max-width: 900px) {
    .app {
      grid-template-rows: auto 1fr auto;
    }
    .body {
      grid-template-columns: 1fr;
    }
    .col {
      display: none;
    }
    .left {
      padding: 8px;
    }
    .app[data-tab='sections'] .left,
    .app[data-tab='settings'] .left,
    .app[data-tab='edit'] .edit,
    .app[data-tab='preview'] .device {
      display: flex;
      flex-direction: column;
    }
    .app[data-tab='sections'] .settings,
    .app[data-tab='settings'] .sections {
      display: none;
    }
    .device {
      height: auto;
      min-height: 0;
      padding: 8px;
    }
    .tabs {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      background: var(--panel);
      box-shadow: 0 -1px 0 var(--line);
    }
    .tabs button {
      border: none;
      border-top: 3px solid transparent;
      background: transparent;
      padding: 10px 4px 12px;
      font-size: 12px;
      font-weight: 700;
      color: var(--dim);
    }
    .tabs button.on {
      border-top-color: var(--accent);
      color: var(--text);
    }
  }
</style>
