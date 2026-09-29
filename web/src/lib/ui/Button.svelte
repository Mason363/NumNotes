<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    children?: Snippet;
  }
  let { variant = 'secondary', size = 'md', children, class: cls = '', ...rest }: Props = $props();
</script>

<button class="btn {variant} {size} {cls}" {...rest}>{@render children?.()}</button>

<style>
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    font-weight: 600;
    white-space: nowrap;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .sm {
    height: 26px;
    padding: 0 9px;
    font-size: 12px;
  }
  .md {
    height: 30px;
    padding: 0 12px;
  }
  .lg {
    height: 38px;
    padding: 0 18px;
    font-size: 14px;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent-strong);
    color: var(--on-accent);
  }
  .primary:hover:not(:disabled) {
    background: var(--accent-strong);
  }
  .secondary {
    background: var(--panel);
    border-color: var(--line-strong);
  }
  .secondary:hover:not(:disabled) {
    background: var(--hover);
  }
  .ghost {
    background: transparent;
  }
  .ghost:hover:not(:disabled) {
    background: var(--hover);
  }
  .danger {
    background: var(--panel);
    color: var(--danger);
    border-color: var(--line-strong);
  }
  .danger:hover:not(:disabled) {
    background: var(--hover);
  }
  .btn :global(svg) {
    width: 14px;
    height: 14px;
    flex: none;
  }
</style>
