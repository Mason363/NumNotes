<script lang="ts">
  import { importFiles } from '../../../import/index.ts';
  import type { Item } from '../../../model/types.ts';
  import RichToolbar from '../../doc/RichToolbar.svelte';
  import Button from '../../ui/Button.svelte';
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
    <Button size="sm" onclick={addText}>+ Text</Button>
    <Button size="sm" onclick={addPicture}>+ Picture</Button>
    <Menu open={shapesOpen} onclose={() => (shapesOpen = false)}>
      {#snippet trigger()}
        <Button size="sm" onclick={() => (shapesOpen = !shapesOpen)}>+ Shape ▾</Button>
      {/snippet}
      <button class="item" onclick={() => addShape('rect')}>Rectangle</button>
      <button class="item" onclick={() => addShape('ellipse')}>Ellipse</button>
      <button class="item" onclick={() => addShape('line')}>Line</button>
      <button class="item" onclick={() => addShape('arrow')}>Arrow</button>
    </Menu>
    <span class="spacer"></span>
    {#if selected.length}
      <Button size="sm" variant="ghost" onclick={() => reorderItems(selected, 'front')}>Front</Button>
      <Button size="sm" variant="ghost" onclick={() => reorderItems(selected, 'back')}>Back</Button>
      <Button size="sm" variant="ghost" title="⌘D" onclick={() => duplicateItems(selected)}>Duplicate</Button>
      <Button size="sm" variant="ghost" onclick={() => removeItems(selected)}>Delete</Button>
    {:else}
      <span class="hint muted small">Double-click text to edit</span>
    {/if}
  {/if}
</div>

<style>
  .item-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    min-height: 46px;
    flex-wrap: wrap;
  }
  .format {
    flex: 1;
    margin: -8px -12px;
  }
  .format :global(.toolbar) {
    border-bottom: none;
  }
  .spacer {
    flex: 1;
  }
</style>
