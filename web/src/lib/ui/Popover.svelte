<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X } from '@lucide/svelte';

  interface Props {
    open: boolean;
    title: string;
    align?: 'left' | 'right';
    width?: number;
    onclose: () => void;
    trigger: Snippet;
    children: Snippet;
  }
  let { open, title, align = 'right', width = 320, onclose, trigger, children }: Props = $props();
  let root: HTMLElement | undefined = $state();

  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // Dialogs opened from inside (like Crop) live in the top layer.
      if (root?.contains(t) || (t as Element).closest?.('dialog[open]')) return;
      onclose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onclose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="pop-root" bind:this={root}>
  {@render trigger()}
  {#if open}
    <div class="pop {align}" style="--w: {width}px" role="dialog" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <button class="close" aria-label="Close" onclick={onclose}><X size={16} /></button>
      </header>
      <div class="body">{@render children()}</div>
    </div>
  {/if}
</div>

<style>
  .pop-root {
    position: relative;
    display: inline-flex;
  }
  .pop {
    position: absolute;
    top: calc(100% + 6px);
    z-index: 60;
    width: var(--w);
    max-height: calc(100vh - 140px);
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
  }
  .left {
    left: 0;
  }
  .right {
    right: 0;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 6px 4px 14px;
  }
  h3 {
    font-size: 14px;
    font-weight: 600;
  }
  .close {
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--dim);
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
  }
  .close:hover {
    background: var(--hover);
    color: var(--text);
  }
  .body {
    padding: 8px 14px 16px;
    overflow: auto;
  }
  /* Phones: a sheet from the bottom. */
  @media (max-width: 700px) {
    .pop {
      position: fixed;
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      width: auto;
      max-height: 75vh;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    }
  }
</style>
