<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X } from '@lucide/svelte';

  interface Props {
    title: string;
    open: boolean;
    width?: number;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  }
  let { title, open, width = 520, onclose, children, footer }: Props = $props();
  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  style="--w: {width}px"
  onclose={() => onclose?.()}
  onclick={(e) => {
    if (e.target === dialog) onclose?.();
  }}
>
  <div class="box">
    <header>
      <h2>{title}</h2>
      <button class="close" aria-label="Close" onclick={() => onclose?.()}><X size={18} /></button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</dialog>

<style>
dialog {
    border: none;
    padding: 0;
    background: transparent;
    max-width: min(var(--w), calc(100vw - 32px));
    width: 100%;
    color: var(--text);
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.35);
  }
  .box {
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 48px);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 6px 0 14px;
    height: 36px;
    background: var(--accent);
    color: var(--on-accent);
  }
  h2 {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .close {
    border: none;
    background: transparent;
    color: inherit;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
  }
  .close:hover {
    background: rgba(0, 0, 0, 0.08);
  }
  .body {
    padding: 16px;
    overflow: auto;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    padding: 10px 16px;
    border-top: 1px solid var(--line);
    background: var(--panel-2);
  }
</style>
