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
    width: 100%;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--panel);
  }
  button {
    flex: 1;
    border: none;
    border-left: 1px solid var(--line);
    background: transparent;
    height: 30px;
    padding: 0 8px;
    font-size: 13px;
    color: var(--text);
    white-space: nowrap;
  }
  button:first-child {
    border-left: none;
  }
  .small button {
    height: 28px;
  }
  button:hover:not(.on) {
    background: var(--hover);
  }
  button.on {
    background: var(--select);
    font-weight: 600;
  }
</style>
