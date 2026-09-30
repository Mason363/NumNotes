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
    gap: 6px;
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.12);
    background: var(--c);
    padding: 0;
    position: relative;
  }
  .swatch.on {
    box-shadow: 0 0 0 2px var(--card), 0 0 0 4px var(--accent);
  }
  .none {
    background: linear-gradient(135deg, transparent 45%, var(--danger) 45%, var(--danger) 55%, transparent 55%), #fff;
  }
  .custom {
    background: var(--field);
    cursor: pointer;
    overflow: hidden;
    display: grid;
    place-items: center;
    border-style: dashed;
    border-color: var(--line-strong);
  }
  .custom::after {
    content: '+';
    font-size: 14px;
    font-weight: 700;
    color: var(--label);
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
