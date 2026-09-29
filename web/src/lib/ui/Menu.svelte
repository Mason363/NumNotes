<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    align?: 'left' | 'right';
    onclose: () => void;
    children: Snippet;
    trigger: Snippet;
  }
  let { open, align = 'left', onclose, children, trigger }: Props = $props();
  let root: HTMLElement | undefined = $state();

  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) onclose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onclose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="menu-root" bind:this={root}>
  {@render trigger()}
  {#if open}
    <div class="menu {align}" role="menu">{@render children()}</div>
  {/if}
</div>

<style>
.menu-root {
    position: relative;
    display: inline-flex;
  }
  .menu {
    position: absolute;
    top: calc(100% + 2px);
    z-index: 50;
    min-width: 220px;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg);
    padding: 2px 0;
    display: grid;
  }
  .left {
    left: 0;
  }
  .right {
    right: 0;
  }
  .menu :global(.item) {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    border: none;
    background: transparent;
    padding: 6px 12px;
    text-align: left;
    font-size: 13px;
  }
  .menu :global(.item:hover) {
    background: var(--accent-soft);
  }
  .menu :global(.item svg) {
    width: 14px;
    height: 14px;
    color: var(--dim);
  }
  .menu :global(.item .desc) {
    display: block;
    font-size: 11.5px;
    color: var(--dim);
  }
  .menu :global(.sep) {
    height: 1px;
    background: var(--line);
    margin: 2px 0;
  }
</style>
