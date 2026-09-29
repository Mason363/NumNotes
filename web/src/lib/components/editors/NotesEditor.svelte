<script lang="ts">
  import type { NotesSection } from '../../../model/types.ts';
  import Button from '../../ui/Button.svelte';
  import { store } from '../../state/project.svelte.ts';
  import PullNotesDialog from '../PullNotesDialog.svelte';

  let { section }: { section: NotesSection } = $props();
  let pullOpen = $state(false);

  function update(fn: (s: NotesSection) => void, key = '') {
    const id = section.id;
    store.edit((p) => {
      const s = p.sections.find((x) => x.id === id);
      if (s?.mode === 'notes') fn(s);
    }, key);
  }
</script>

<div class="notes">
  <div class="intro">
    <p>A notebook on the calculator. Notes typed there are saved there.</p>
    <p class="muted small">Starter notes are copied over on first run.</p>
    {#if 'usb' in navigator}
      <div><Button size="sm" onclick={() => (pullOpen = true)}>Get notes from calculator</Button></div>
    {/if}
  </div>
  <div class="list">
    {#each section.notes as note, i (i)}
      <div class="note">
        <textarea
          value={note}
          rows="4"
          placeholder="First line is the title"
          oninput={(e) => {
            const v = (e.currentTarget as HTMLTextAreaElement).value;
            update((s) => (s.notes[i] = v), `note:${section.id}:${i}`);
          }}
        ></textarea>
        <button class="del" aria-label="Delete note" onclick={() => update((s) => s.notes.splice(i, 1))}>×</button>
      </div>
    {/each}
    <button class="add" onclick={() => update((s) => s.notes.push(''))}>+ Starter note</button>
  </div>
</div>
<PullNotesDialog open={pullOpen} onclose={() => (pullOpen = false)} target={section.id} />

<style>
  .notes {
    overflow: auto;
    padding: 24px;
    display: grid;
    gap: 18px;
    align-content: start;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
  }
  .intro {
    display: grid;
    gap: 8px;
    padding: 16px;
    border-radius: 2px;
    background: var(--accent-soft);
  }
  .list {
    display: grid;
    gap: 10px;
  }
  .note {
    position: relative;
  }
  textarea {
    width: 100%;
    resize: vertical;
    border: 1px solid var(--line);
    border-radius: 2px;
    padding: 12px 40px 12px 14px;
    background: var(--panel);
    font-size: 14px;
    line-height: 1.45;
  }
  textarea:focus {
    border-color: var(--accent);
    outline: none;
  }
  .del {
    position: absolute;
    top: 8px;
    right: 8px;
    border: none;
    background: transparent;
    color: var(--faint);
    padding: 4px;
    border-radius: 2px;
  }
  .del:hover {
    color: var(--danger);
    background: var(--hover);
  }
  .add {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 44px;
    border: 1px dashed var(--line-strong);
    border-radius: 2px;
    background: transparent;
    color: var(--dim);
    font-weight: 560;
  }
  .add:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }
</style>
