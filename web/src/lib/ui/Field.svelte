<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    hint?: string;
    inline?: boolean;
    children: Snippet;
  }
  let { label, hint, inline = false, children }: Props = $props();
</script>

<label class="field" class:inline>
  <span class="label">{label}</span>
  <span class="control">{@render children()}</span>
  {#if hint}<span class="hint">{hint}</span>{/if}
</label>

<style>
  .field {
    display: grid;
    gap: 6px;
  }
  .field.inline {
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 10px;
    min-height: 24px;
  }
  .label {
    font-size: 12px;
    color: var(--text);
  }
  .hint {
    grid-column: 1 / -1;
    font-size: 11px;
    color: var(--dim);
  }
  .control {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }
</style>
