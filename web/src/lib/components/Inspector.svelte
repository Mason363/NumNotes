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
.inspector {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--line-strong);
    position: sticky;
    top: 0;
    background: var(--panel-2);
    z-index: 3;
  }
  .tabs button {
    flex: 1;
    border: none;
    border-right: 1px solid var(--line);
    background: transparent;
    height: 32px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--dim);
  }
  .tabs button:last-child {
    border-right: none;
  }
  .tabs button.on {
    background: var(--accent);
    color: var(--on-accent);
  }
  .content {
    padding: 14px 14px 40px;
  }
</style>
