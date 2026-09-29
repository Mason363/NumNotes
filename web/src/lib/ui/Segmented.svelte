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
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    width: 100%;
    overflow: hidden;
  }
  button {
    flex: 1;
    border: none;
    border-left: 1px solid var(--line-strong);
    background: var(--panel);
    height: 26px;
    padding: 0 8px;
    font-size: 12px;
    font-weight: 550;
    color: var(--dim);
    white-space: nowrap;
  }
  button:first-child {
    border-left: none;
  }
  .small button {
    height: 24px;
  }
  button:hover {
    background: var(--hover);
  }
  button.on {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 650;
  }
</style>
