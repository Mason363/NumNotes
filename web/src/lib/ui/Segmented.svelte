<script lang="ts" generics="T extends string | number">
  interface Option {
    value: T;
    label: string;
    title?: string;
  }
  interface Props {
    value: T;
    options: Option[];
    onchange?: (value: T) => void;
    small?: boolean;
  }
  let { value = $bindable(), options, onchange, small = false }: Props = $props();
</script>

<div class="seg" class:small role="radiogroup">
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={value === o.value}
      class:on={value === o.value}
      title={o.title}
      onclick={() => {
        value = o.value;
        onchange?.(o.value);
      }}>{o.label}</button
    >
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--pill);
    background: var(--field);
    width: 100%;
  }
  button {
    flex: 1;
    border: none;
    border-radius: var(--pill);
    background: transparent;
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
    font-weight: 700;
    color: var(--label);
    white-space: nowrap;
    transition: background-color 0.12s, color 0.12s;
  }
  .small button {
    height: 24px;
  }
  button:hover:not(.on) {
    background: var(--hover);
  }
  button.on {
    background: var(--accent);
    color: var(--on-accent);
  }
</style>
