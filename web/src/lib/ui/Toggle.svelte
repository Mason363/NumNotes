<script lang="ts">
  interface Props {
    checked: boolean;
    label?: string;
    onchange?: (checked: boolean) => void;
  }
  let { checked = $bindable(), label, onchange }: Props = $props();
</script>

<input
  type="checkbox"
  class="switch"
  role="switch"
  {checked}
  aria-label={label}
  onchange={(e) => {
    checked = (e.currentTarget as HTMLInputElement).checked;
    onchange?.(checked);
  }}
/>

<style>
  .switch {
    appearance: none;
    position: relative;
    width: 32px;
    height: 18px;
    margin: 0;
    border-radius: 9px;
    background: #c4c7cf;
    cursor: pointer;
    flex: none;
    transition: background-color 0.15s;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: transform 0.15s;
  }
  .switch:checked {
    background: var(--accent);
  }
  .switch:checked::after {
    transform: translateX(14px);
  }
</style>
