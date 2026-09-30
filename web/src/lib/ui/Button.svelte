<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'purple' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    children?: Snippet;
  }
  let { variant = 'secondary', size = 'md', children, class: cls = '', ...rest }: Props = $props();
</script>

<button class="btn {variant} {size} {cls}" {...rest}>{@render children?.()}</button>

<style>
  /* Flat grey buttons like Desmos; yellow for the one main action. */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: var(--radius-sm);
    font-weight: 400;
    white-space: nowrap;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .sm {
    height: 28px;
    padding: 0 10px;
    font-size: 13px;
  }
  .md {
    height: 34px;
    padding: 0 14px;
    font-size: 14px;
  }
  .lg {
    height: 40px;
    padding: 0 20px;
    font-size: 15px;
  }
  .secondary {
    background: var(--btn);
    color: var(--text);
  }
  .secondary:hover:not(:disabled) {
    background: var(--btn-hover);
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent-strong);
    color: #fff;
    font-weight: 600;
  }
  .primary:hover:not(:disabled) {
    background: var(--accent-strong);
  }
  .purple {
    background: var(--blue);
    border-color: var(--purple-strong);
    color: #fff;
  }
  .purple:hover:not(:disabled) {
    background: var(--purple-strong);
  }
  .ghost {
    background: transparent;
    border-color: transparent;
    color: var(--text);
  }
  .ghost:hover:not(:disabled) {
    background: var(--hover);
  }
  .danger {
    background: var(--btn);
    color: var(--danger);
  }
  .danger:hover:not(:disabled) {
    background: var(--btn-hover);
  }
  .btn :global(svg) {
    width: 16px;
    height: 16px;
    flex: none;
  }
</style>
