<script lang="ts">
  import Modal from '../ui/Modal.svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
  }
  let { open, onclose }: Props = $props();

  const KEYS: [string, string][] = [
    ['Arrows', 'Move, scroll, pan'],
    ['OK', 'Open, or view a picture full screen'],
    ['+ and −', 'Zoom'],
    ['EXE', 'Play slides, or go to the next stop'],
    ['0 to 9', 'Go to a page'],
    ['Toolbox', 'Menu'],
    ['var', 'Bookmarks'],
    ['alpha', 'Search, or type in a note'],
    ['ans', 'Jump back'],
    ['Back', 'Back'],
    ['Home', 'Leave the app'],
  ];
</script>

<Modal title="Keys on the calculator" {open} {onclose} width={440}>
  <table>
    <tbody>
      {#each KEYS as [key, does] (key)}
        <tr><th><span class="key">{key}</span></th><td>{does}</td></tr>
      {/each}
    </tbody>
  </table>
  <p class="muted small tip">Here, click the calculator's screen to use your keyboard, or click its keys.</p>
</Modal>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
  }
  tr + tr {
    border-top: 1px solid var(--line);
  }
  th {
    width: 110px;
    padding: 7px 0;
    text-align: left;
  }
  td {
    padding: 7px 0;
    font-size: 13px;
  }
  /* Styled like the calculator's key caps. */
  .key {
    display: inline-block;
    min-width: 34px;
    padding: 2px 10px;
    border-radius: var(--pill);
    background: var(--layout);
    box-shadow: inset 0 -2px 0 var(--line-strong);
    font-size: 12px;
    font-weight: 700;
    color: var(--label);
    text-align: center;
  }
  .tip {
    margin-top: 12px;
  }
</style>
