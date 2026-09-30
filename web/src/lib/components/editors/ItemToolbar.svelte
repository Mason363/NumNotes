<script lang="ts">
  import { BringToFront, ChevronDown, Copy, Image, SendToBack, Shapes, Trash2, Type } from '@lucide/svelte';
  import { importFiles } from '../../../import/index.ts';
  import type { Item } from '../../../model/types.ts';
  import RichToolbar from '../../doc/RichToolbar.svelte';
  import Menu from '../../ui/Menu.svelte';
  import { assets } from '../../state/assets.ts';
  import { doc, imageItem, p, shapeItem, textItem } from '../../state/defaults.ts';
  import { addItems, duplicateItems, removeItems, reorderItems } from '../../state/items.ts';
  import { store } from '../../state/project.svelte.ts';

  interface Props {
    /** Where new items go (center of the visible area), and its size. */
    origin: { x: number; y: number };
    area: { w: number; h: number };
  }
  let { origin, area }: Props = $props();
  let shapesOpen = $state(false);

  const selected = $derived(store.selection.items);
  const editor = $derived(store.activeEditor);

  function addText() {
    const w = Math.min(240, area.w - 20);
    addItems([textItem(Math.round(origin.x - w / 2), Math.round(origin.y - 30), w, 60, doc(p('Text')))]);
  }

  function addShape(shape: 'rect' | 'ellipse' | 'line' | 'arrow') {
    shapesOpen = false;
    const line = shape === 'line' || shape === 'arrow';
    addItems([shapeItem(shape, Math.round(origin.x - 50), Math.round(origin.y - (line ? 0 : 35)), 100, line ? 0 : 70)]);
  }

  function addPicture() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,.heic,.heif,.gif';
    input.onchange = async () => {
      const imported = await importFiles([...(input.files ?? [])]);
      const added: Item[] = [];
      for (const item of imported) {
        for (const meta of await assets.add(item)) {
          const s = Math.min((area.w * 0.8) / meta.width, (area.h * 0.8) / meta.height, 1);
          const w = Math.round(meta.width * s);
          const h = Math.round(meta.height * s);
          added.push(imageItem(meta.id, Math.round(origin.x - w / 2 + added.length * 12), Math.round(origin.y - h / 2 + added.length * 12), w, h));
        }
      }
      if (added.length) addItems(added);
    };
    input.click();
  }
</script>

<div class="item-toolbar">
  {#if editor}
    <div class="format"><RichToolbar {editor} tick={store.editorTick} compact pictures={false} /></div>
  {:else}
    <button class="tool" onclick={addText}><Type />Text</button>
    <button class="tool" onclick={addPicture}><Image />Picture</button>
    <Menu open={shapesOpen} onclose={() => (shapesOpen = false)}>
      {#snippet trigger()}
        <button class="tool" onclick={() => (shapesOpen = !shapesOpen)}><Shapes />Shape<ChevronDown class="caret" /></button>
      {/snippet}
      <button class="item" onclick={() => addShape('rect')}>Rectangle</button>
      <button class="item" onclick={() => addShape('ellipse')}>Ellipse</button>
      <button class="item" onclick={() => addShape('line')}>Line</button>
      <button class="item" onclick={() => addShape('arrow')}>Arrow</button>
    </Menu>
    <span class="spacer"></span>
    {#if selected.length}
      <button class="tool" onclick={() => reorderItems(selected, 'front')}><BringToFront />Front</button>
      <button class="tool" onclick={() => reorderItems(selected, 'back')}><SendToBack />Back</button>
      <button class="tool" title="⌘D" onclick={() => duplicateItems(selected)}><Copy />Duplicate</button>
      <button class="tool" onclick={() => removeItems(selected)}><Trash2 />Delete</button>
    {:else}
      <span class="hint muted small">Double-click text to edit</span>
    {/if}
  {/if}
</div>

<style>
  .item-toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
    min-height: 44px;
    flex-wrap: wrap;
    flex: none;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    font-size: 13px;
    color: var(--text);
  }
  .tool:hover {
    background: var(--hover);
  }
  .tool :global(svg) {
    width: 17px;
    height: 17px;
    color: var(--dim);
    stroke-width: 1.75;
  }
  .tool :global(svg.caret) {
    width: 14px;
    height: 14px;
    margin-left: -2px;
  }
  .format {
    flex: 1;
    margin: -5px -8px;
  }
  .format :global(.toolbar) {
    border-bottom: none;
  }
  .spacer {
    flex: 1;
  }
  .hint {
    padding-right: 6px;
  }
</style>
