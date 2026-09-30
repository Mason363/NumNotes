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
      <button class="close" aria-label="Close" onclick={() => onclose?.()}><X size={16} strokeWidth={2.5} /></button>
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
    background: rgba(30, 33, 56, 0.4);
  }
  .box {
    background: var(--panel);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 48px);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 4px 20px;
  }
  h2 {
    font-size: 18px;
    font-weight: 700;
    color: var(--text);
  }
  .close {
    border: none;
    border-radius: 50%;
    background: var(--layout);
    color: var(--label);
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
  }
  .close:hover {
    background: var(--card);
  }
  .body {
    padding: 12px 20px 20px;
    overflow: auto;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    background: var(--layout);
  }
</style>
