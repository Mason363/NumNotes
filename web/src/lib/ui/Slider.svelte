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
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--accent) var(--pct), #d9d9d9 var(--pct));
    min-width: 60px;
    cursor: pointer;
  }
  input::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.25);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
  input::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.25);
  }
  .value {
    min-width: 40px;
    text-align: right;
    font-size: 12px;
    color: var(--dim);
    font-variant-numeric: tabular-nums;
  }
</style>
