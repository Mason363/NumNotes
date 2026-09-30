<script lang="ts">
  import { store } from '../state/project.svelte.ts';
  import AppPanel from './inspector/AppPanel.svelte';
  import ItemPanel from './inspector/ItemPanel.svelte';
  import SectionPanel from './inspector/SectionPanel.svelte';

  type Tab = 'item' | 'section' | 'app';
  let tab = $state<Tab>('section');
  const hasItem = $derived(store.selection.items.length > 0 || store.focusPicture !== null);

  $effect(() => {
    if (hasItem) tab = 'item';
    else if (tab === 'item') tab = 'section';
  });
</script>

<div class="inspector">
  <div class="tabs" role="tablist">
    {#if hasItem}
      <button role="tab" aria-selected={tab === 'item'} class:on={tab === 'item'} onclick={() => (tab = 'item')}>Selected</button>
    {/if}
    <button role="tab" aria-selected={tab === 'section'} class:on={tab === 'section'} onclick={() => (tab = 'section')}>Section</button>
    <button role="tab" aria-selected={tab === 'app'} class:on={tab === 'app'} onclick={() => (tab = 'app')}>App</button>
  </div>
  <div class="content">
    {#if tab === 'item' && hasItem}
      <ItemPanel />
    {:else if tab === 'app'}
      <AppPanel />
    {:else}
      <SectionPanel />
    {/if}
  </div>
</div>

<style>
  /* A settings widget, like the Board's Settings panel, with the tab
   * underline from NumWorks' workshop. */
  .inspector {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    background: var(--card);
    border-radius: var(--radius);
  }
  .tabs {
    display: flex;
    gap: 4px;
    padding: 6px 12px 0;
  }
  .tabs button {
    flex: 1;
    border: none;
    border-bottom: 3px solid var(--card-hover);
    background: transparent;
    padding: 8px 4px 7px;
    font-size: 13px;
    font-weight: 500;
    color: var(--label);
  }
  .tabs button:hover {
    color: var(--text);
  }
  .tabs button.on {
    border-bottom-color: var(--accent);
    font-weight: 800;
    color: var(--text);
  }
  .content {
    padding: 16px 12px 24px;
  }
</style>
