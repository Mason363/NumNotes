<script lang="ts">
  interface Props {
    checked: boolean;
    label?: string;
    onchange?: (checked: boolean) => void;
  }
  let { checked = $bindable(), label, onchange }: Props = $props();
</script>

<!-- A plain square checkbox: on/off settings read like a settings screen. -->
<input
  type="checkbox"
  class="check"
  {checked}
  aria-label={label}
  onchange={(e) => {
    checked = (e.currentTarget as HTMLInputElement).checked;
    onchange?.(checked);
  }}
/>

<style>
  .check {
    appearance: none;
    width: 16px;
    height: 16px;
    margin: 0;
    border: 1px solid var(--line-strong);
    border-radius: 1px;
    background: var(--panel);
    display: grid;
    place-items: center;
    cursor: pointer;
    flex: none;
  }
  .check:checked {
    background: var(--accent);
    border-color: var(--accent-strong);
  }
  .check:checked::after {
    content: '';
    width: 4px;
    height: 8px;
    border: solid var(--on-accent);
    border-width: 0 2px 2px 0;
    transform: translateY(-1px) rotate(45deg);
  }
</style>
