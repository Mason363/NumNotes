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
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--dim);
  }
  .md {
    width: 28px;
    height: 28px;
  }
  .sm {
    width: 24px;
    height: 24px;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--hover);
    color: var(--text);
  }
  .icon-btn.active {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--text);
  }
  .icon-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .icon-btn :global(svg) {
    width: 15px;
    height: 15px;
  }
  .sm :global(svg) {
    width: 14px;
    height: 14px;
  }
</style>
