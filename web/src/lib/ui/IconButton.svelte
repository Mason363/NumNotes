<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    label: string;
    active?: boolean;
    size?: 'sm' | 'md';
    children?: Snippet;
  }
  let { label, active = false, size = 'md', children, class: cls = '', ...rest }: Props = $props();
</script>

<button class="icon-btn {size} {cls}" class:active title={label} aria-label={label} aria-pressed={active} {...rest}>
  {@render children?.()}
</button>

<style>
  .icon-btn {
    display: inline-grid;
    place-items: center;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
  }
  .md {
    width: 34px;
    height: 34px;
  }
  .sm {
    width: 28px;
    height: 28px;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--hover);
  }
  .icon-btn.active {
    background: var(--select);
  }
  .icon-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .icon-btn :global(svg) {
    width: 18px;
    height: 18px;
  }
  .sm :global(svg) {
    width: 16px;
    height: 16px;
  }
</style>
