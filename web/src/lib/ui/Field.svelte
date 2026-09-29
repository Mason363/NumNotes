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
    gap: 4px;
  }
  .field.inline {
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 10px;
  }
  .label {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--dim);
  }
  .inline .label {
    color: var(--text);
    font-weight: 500;
    font-size: 12.5px;
  }
  .hint {
    grid-column: 1 / -1;
    font-size: 11.5px;
    color: var(--faint);
  }
  .control {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }
</style>
