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
  /* NumWorks buttons: bold pills. Yellow for the main action, grey outline
   * for the rest. */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid transparent;
    border-radius: var(--pill);
    font-weight: 700;
    white-space: nowrap;
    transition: background-color 0.12s, border-color 0.12s, color 0.12s;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .sm {
    height: 28px;
    padding: 0 12px;
    font-size: 12px;
  }
  .md {
    height: 32px;
    padding: 0 14px;
    font-size: 13px;
  }
  .lg {
    height: 38px;
    padding: 0 18px;
    font-size: 15px;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .primary:hover:not(:disabled) {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
  }
  .purple {
    background: var(--purple);
    border-color: var(--purple);
    color: #fff;
  }
  .purple:hover:not(:disabled) {
    background: var(--purple-strong);
    border-color: var(--purple-strong);
  }
  .secondary {
    background: transparent;
    border-color: var(--grey-btn);
    color: var(--grey-btn);
  }
  .secondary:hover:not(:disabled) {
    background: var(--grey-btn);
    color: var(--panel);
  }
  .ghost {
    background: transparent;
    color: var(--label);
  }
  .ghost:hover:not(:disabled) {
    background: var(--hover);
  }
  .danger {
    background: transparent;
    color: var(--danger);
    border-color: var(--danger);
  }
  .danger:hover:not(:disabled) {
    background: var(--danger);
    color: #fff;
  }
  .btn :global(svg) {
    width: 16px;
    height: 16px;
    flex: none;
  }
</style>
