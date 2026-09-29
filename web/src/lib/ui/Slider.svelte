<script lang="ts">
  interface Props {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    label?: string;
    oninput?: (value: number) => void;
  }
  let { value = $bindable(), min = 0, max = 100, step = 1, unit = '', label, oninput }: Props = $props();
  const pct = $derived(((value - min) / (max - min)) * 100);
</script>

<div class="slider">
  <input
    type="range"
    {min}
    {max}
    {step}
    {value}
    aria-label={label}
    style="--pct: {pct}%"
    oninput={(e) => {
      value = Number((e.currentTarget as HTMLInputElement).value);
      oninput?.(value);
    }}
  />
  <span class="value">{Math.round(value * 100) / 100}{unit}</span>
</div>

<style>
.slider {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
  }
  input {
    flex: 1;
    appearance: none;
    height: 3px;
    background: linear-gradient(to right, var(--text) var(--pct), var(--line-strong) var(--pct));
    min-width: 60px;
  }
  input::-webkit-slider-thumb {
    appearance: none;
    width: 10px;
    height: 16px;
    border-radius: 1px;
    background: var(--panel);
    border: 1px solid var(--text);
  }
  input::-moz-range-thumb {
    width: 10px;
    height: 16px;
    border-radius: 1px;
    background: var(--panel);
    border: 1px solid var(--text);
  }
  .value {
    min-width: 40px;
    text-align: right;
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--dim);
  }
</style>
