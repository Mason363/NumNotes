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
  /* Round icon buttons, like the Board's help and card controls. */
  .icon-btn {
    display: inline-grid;
    place-items: center;
    border: 1px solid transparent;
    border-radius: 50%;
    background: transparent;
    color: var(--label);
    transition: background-color 0.12s, color 0.12s;
  }
  .md {
    width: 32px;
    height: 32px;
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
    background: var(--purple-soft);
    color: var(--purple);
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
    width: 14px;
    height: 14px;
  }
</style>
