<script lang="ts">
  import { parseStore } from '../../pack/store.ts';
  import { Calculator, CalculatorError } from '../../usb/index.ts';
  import Button from '../ui/Button.svelte';
  import Modal from '../ui/Modal.svelte';
  import { store } from '../state/project.svelte.ts';

  interface Props {
    open: boolean;
    onclose: () => void;
    /** Notes section that receives the notes. */
    target: string;
  }
  let { open, onclose, target }: Props = $props();

  let step = $state<'intro' | 'reading' | 'pick' | 'error'>('intro');
  let error = $state('');
  let notes = $state<{ text: string; keep: boolean }[]>([]);

  $effect(() => {
    if (open) {
      step = 'intro';
      notes = [];
    }
  });

  async function read() {
    try {
      const calc = await Calculator.request();
      step = 'reading';
      await calc.open();
      const apps = await calc.listApps();
      const projectId = store.project!.projectId >>> 0;
      const app = apps.find((a) => a.numnotes?.projectId === projectId);
      if (!app) throw new Error('This app isn’t on the calculator yet.');
      const contents = parseStore(await calc.readNotesStore(app), projectId);
      await calc.close();
      notes = contents.notes.filter((n) => n.trim()).map((text) => ({ text, keep: true }));
      if (!notes.length) throw new Error('No notes saved yet.');
      step = 'pick';
    } catch (e) {
      error = e instanceof CalculatorError && e.code === 'no-device-selected' ? 'No calculator was chosen.' : (e as Error).message;
      step = 'error';
    }
  }

  function apply() {
    const chosen = notes.filter((n) => n.keep).map((n) => n.text);
    store.edit((p) => {
      const s = p.sections.find((x) => x.id === target);
      if (s?.mode === 'notes') s.notes = chosen;
    });
    onclose();
  }
</script>

<Modal title="Get notes" {open} {onclose} width={520}>
  {#if step === 'intro'}
    <p>Copies notes typed on the calculator into this section.</p>
  {:else if step === 'reading'}
    <p class="muted">Reading notes…</p>
  {:else if step === 'pick'}
    <p class="muted small">These replace the starter notes.</p>
    <ul class="list">
      {#each notes as n, i (i)}
        <li><label><input type="checkbox" bind:checked={n.keep} /><pre>{n.text}</pre></label></li>
      {/each}
    </ul>
  {:else}
    <div class="warning"><p>{error}</p></div>
  {/if}
  {#snippet footer()}
    {#if step === 'intro' || step === 'error'}
      <Button onclick={onclose}>Cancel</Button>
      <Button variant="primary" onclick={read}>Connect</Button>
    {:else if step === 'pick'}
      <Button onclick={onclose}>Cancel</Button>
      <Button variant="primary" onclick={apply}>Keep {notes.filter((n) => n.keep).length} notes</Button>
    {/if}
  {/snippet}
</Modal>

<style>
  .list {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
    max-height: 360px;
    overflow: auto;
  }
  label {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 2px;
  }
  pre {
    margin: 0;
    font: inherit;
    white-space: pre-wrap;
    font-size: 13px;
  }
  .warning {
    display: flex;
    gap: 10px;
    padding: 12px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--danger) 9%, transparent);
  }
</style>
