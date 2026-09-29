<script lang="ts">
  interface Props {
    value: string | undefined;
    swatches?: string[];
    allowNone?: boolean;
    onchange?: (value: string | undefined) => void;
  }
  const DEFAULT = ['#1c1c1f', '#ffffff', '#f28c28', '#ff3b30', '#ffcc00', '#34c759', '#00b8d9', '#4f7cff', '#af52de', '#8e8e93'];
  let { value = $bindable(), swatches = DEFAULT, allowNone = false, onchange }: Props = $props();
  const set = (v: string | undefined) => {
    value = v;
    onchange?.(v);
  };
</script>

<div class="colors">
  {#if allowNone}
    <button type="button" class="swatch none" class:on={!value} title="None" aria-label="None" onclick={() => set(undefined)}></button>
  {/if}
  {#each swatches as s (s)}
    <button type="button" class="swatch" class:on={value?.toLowerCase() === s} style="--c: {s}" title={s} aria-label={s} onclick={() => set(s)}></button>
  {/each}
  <label class="swatch custom" title="Pick any color" style="--c: {value ?? 'transparent'}">
    <input type="color" value={value ?? '#ffffff'} oninput={(e) => set((e.currentTarget as HTMLInputElement).value)} />
  </label>
</div>

<style>
.colors {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .swatch {
    width: 20px;
    height: 20px;
    border-radius: 1px;
    border: 1px solid rgba(0, 0, 0, 0.18);
    background: var(--c);
    padding: 0;
    position: relative;
  }
  .swatch.on {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
  .none {
    background: linear-gradient(135deg, transparent 45%, var(--danger) 45%, var(--danger) 55%, transparent 55%), var(--panel);
  }
  .custom {
    background: var(--panel);
    cursor: pointer;
    overflow: hidden;
    display: grid;
    place-items: center;
  }
  .custom::after {
    content: '+';
    font-size: 13px;
    color: var(--dim);
    pointer-events: none;
    position: absolute;
  }
  .custom input {
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }
</style>
