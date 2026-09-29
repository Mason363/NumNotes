<script lang="ts" module>
  let openPicker: (() => void) | null = null;
  /** Opens the file picker (used by "Add files" buttons). */
  export function pickFiles() {
    openPicker?.();
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { acceptedTypes, importClipboard, importDataTransfer, importFiles, type ImportError, type Imported } from '../../import/index.ts';
  import type { SectionMode } from '../../model/types.ts';
  import { MODE_INFO, SECTION_ICONS } from '../icons.ts';
  import Button from '../ui/Button.svelte';
  import Modal from '../ui/Modal.svelte';
  import { addImports, type Destination, suggestDestination, summarize } from '../state/importer.ts';
  import { store } from '../state/project.svelte.ts';

  let dragDepth = $state(0);
  let items = $state<Imported[] | null>(null);
  let reading = $state(false);
  let adding = $state(false);
  let progress = $state(0);
  let label = $state('');
  let errors = $state<string[]>([]);
  let choice = $state<string>('current');

  const current = $derived(store.section);
  const summary = $derived(items ? summarize(items) : null);

  function describe(s: NonNullable<typeof summary>): string {
    const parts: string[] = [];
    if (s.pictures) parts.push(`${s.pictures} picture${s.pictures === 1 ? '' : 's'}`);
    if (s.animations) parts.push(`${s.animations} animation${s.animations === 1 ? '' : 's'}`);
    if (s.texts) parts.push(`${s.texts} document${s.texts === 1 ? '' : 's'}`);
    return parts.join(', ');
  }

  const options = $derived.by(() => {
    if (!summary) return [];
    const visual = summary.pictures + summary.animations > 0;
    const list: { id: string; label: string; detail: string; icon: keyof typeof SECTION_ICONS }[] = [];
    if (current && (visual ? current.mode !== 'notes' : current.mode === 'document' || current.mode === 'notes' || current.mode === 'slides')) {
      list.push({ id: 'current', label: `Add to “${current.title}”`, detail: MODE_INFO[current.mode].label, icon: current.icon });
    }
    const modes: SectionMode[] = visual ? ['slides', 'gallery', 'canvas', 'document'] : ['document', 'slides', 'notes'];
    for (const m of modes) list.push({ id: m, label: `New ${MODE_INFO[m].label.toLowerCase()}`, detail: MODE_INFO[m].description, icon: MODE_INFO[m].icon });
    return list;
  });

  async function receive(pending: Promise<Imported[]>) {
    reading = true;
    errors = [];
    items = [];
    try {
      const result = await pending;
      if (!result.length) {
        items = null;
        if (!errors.length) errors = ['Nothing usable found.'];
        return;
      }
      items = result;
      const d = suggestDestination(result, current);
      choice = d.kind === 'current' ? 'current' : d.mode;
    } catch (e) {
      items = null;
      errors = [...errors, (e as Error).message];
    } finally {
      reading = false;
    }
  }

  const importOptions = {
    onProgress: (f: number, l: string) => {
      progress = f;
      label = l;
    },
    onFileError: (e: ImportError) => {
      errors = [...errors, e.file ? `${e.file}: ${e.message}` : e.message];
    },
  };

  async function confirmAdd() {
    if (!items?.length) return;
    adding = true;
    const destination: Destination = choice === 'current' ? { kind: 'current' } : { kind: 'new', mode: choice as SectionMode };
    try {
      await addImports($state.snapshot(items) as Imported[], destination, (f, l) => {
        progress = f;
        label = l;
      });
      items = null;
    } catch (e) {
      errors = [...errors, (e as Error).message];
    } finally {
      adding = false;
    }
  }

  function close() {
    if (adding) return;
    items = null;
    errors = [];
  }

  function isEditable(el: EventTarget | null): boolean {
    const e = el as HTMLElement | null;
    return !!e && (e.isContentEditable || ['INPUT', 'TEXTAREA'].includes(e.tagName));
  }

  onMount(() => {
    openPicker = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = acceptedTypes();
      input.onchange = () => {
        const files = [...(input.files ?? [])];
        if (files.length) receive(importFiles(files, importOptions));
      };
      input.click();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || !e.clipboardData) return;
      const hasContent = e.clipboardData.files.length || e.clipboardData.types.some((t) => t === 'text/html' || t === 'text/plain');
      if (!hasContent) return;
      e.preventDefault();
      receive(importClipboard(e.clipboardData, importOptions));
    };
    window.addEventListener('paste', onPaste);
    return () => {
      openPicker = null;
      window.removeEventListener('paste', onPaste);
    };
  });

  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
</script>

<svelte:window
  ondragenter={(e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
  }}
  ondragleave={(e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
  }}
  ondragover={(e) => {
    if (hasFiles(e)) e.preventDefault();
  }}
  ondrop={(e) => {
    if (!hasFiles(e) || !e.dataTransfer) return;
    e.preventDefault();
    dragDepth = 0;
    receive(importDataTransfer(e.dataTransfer, importOptions));
  }}
/>

{#if dragDepth > 0}
  <div class="overlay" aria-hidden="true">
    <div class="target">
      <strong>Drop to add</strong>
    </div>
  </div>
{/if}

<Modal title={reading ? 'Reading…' : adding ? 'Adding…' : 'Add files'} open={items !== null || errors.length > 0} onclose={close} width={480}>
  {#if reading || adding}
    <div class="progress">
      <div class="bar"><span style="width: {Math.round(progress * 100)}%"></span></div>
      <span class="muted small">{label || 'Working…'}</span>
    </div>
  {:else if summary && items?.length}
    <p class="muted">{describe(summary)}. Add to:</p>
    <div class="choices" role="radiogroup">
      {#each options as o (o.id)}
        <button class="choice" class:on={choice === o.id} role="radio" aria-checked={choice === o.id} onclick={() => (choice = o.id)} ondblclick={confirmAdd}>
          <span class="dot"></span>
          <span class="txt"><strong>{o.label}</strong><span class="muted small">{o.detail}</span></span>
        </button>
      {/each}
    </div>
  {/if}
  {#if errors.length}
    <ul class="errors">
      {#each errors as err, i (i)}<li>{err}</li>{/each}
    </ul>
  {/if}
  {#snippet footer()}
    {#if items?.length && !reading && !adding}
      <Button onclick={close}>Cancel</Button>
      <Button variant="primary" onclick={confirmAdd}>Add</Button>
    {:else if !reading && !adding}
      <Button onclick={close}>Close</Button>
    {/if}
  {/snippet}
</Modal>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(255, 183, 52, 0.12);
    display: grid;
    place-items: center;
    pointer-events: none;
    padding: 24px;
  }
  .target {
    border: 1px dashed var(--accent);
    border-radius: 2px;
    background: var(--panel);
    box-shadow: var(--shadow-lg);
    padding: 36px 44px;
    display: grid;
    gap: 6px;
    text-align: center;
  }
  .target strong {
    font-size: 20px;
  }
  .choices {
    display: grid;
    gap: 6px;
    margin-top: 12px;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
    padding: 10px 12px;
    border-radius: 2px;
    border: 1px solid var(--line);
    background: var(--panel);
  }
  .choice:hover {
    background: var(--hover);
  }
  .choice.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .dot {
    width: 12px;
    height: 12px;
    border: 1px solid var(--line-strong);
    border-radius: 50%;
    flex: none;
  }
  .choice.on .dot {
    border: 4px solid var(--text);
  }
  .txt {
    display: grid;
  }
  .progress {
    display: grid;
    gap: 8px;
    padding: 10px 0;
  }
  .bar {
    height: 6px;
    border-radius: 2px;
    background: var(--line);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .errors {
    margin: 12px 0 0;
    padding: 10px 12px 10px 28px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--danger) 9%, transparent);
    color: var(--danger);
    font-size: 13px;
  }
</style>
