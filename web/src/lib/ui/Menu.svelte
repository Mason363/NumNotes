<script lang="ts">
  import type { Snippet } from 'svelte';
  import { follow, place, placementStyle, type Placement } from './place.ts';

  interface Props {
    open: boolean;
    align?: 'left' | 'right';
    onclose: () => void;
    children: Snippet;
    trigger: Snippet;
  }
  let { open, align = 'left', onclose, children, trigger }: Props = $props();
  let root: HTMLElement | undefined = $state();
  let menu: HTMLElement | undefined = $state();
  let pos = $state<Placement | null>(null);

  $effect(() => {
    if (!open) {
      pos = null;
      return;
    }
    const stop = follow(() => {
      if (root) pos = place(root.getBoundingClientRect(), { align, gap: 4 });
    });
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (root?.contains(t) || menu?.contains(t)) return;
      onclose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onclose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      stop();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="menu-root" bind:this={root}>
  {@render trigger()}
  {#if open}
    <div class="menu" role="menu" bind:this={menu} style={placementStyle(pos)}>{@render children()}</div>
  {/if}
</div>

<style>
  .menu-root {
    position: relative;
    display: inline-flex;
  }
  .menu {
    position: fixed;
    z-index: 70;
    overflow: auto;
    min-width: 220px;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 4px 0;
    display: grid;
  }
  .menu :global(.item) {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    border: none;
    background: transparent;
    padding: 7px 14px;
    text-align: left;
    font-size: 14px;
    color: var(--text);
  }
  .menu :global(.item:hover) {
    background: var(--hover);
  }
  .menu :global(.item svg) {
    width: 18px;
    height: 18px;
    color: var(--dim);
    flex: none;
  }
  .menu :global(.item .desc) {
    display: block;
    font-size: 12px;
    color: var(--dim);
  }
  .menu :global(.sep) {
    height: 1px;
    background: var(--line);
    margin: 4px 0;
  }
  .menu :global(.menu-label) {
    padding: 6px 14px 2px;
    font-size: 12px;
    color: var(--dim);
  }
</style>
