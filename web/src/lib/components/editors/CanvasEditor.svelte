<script lang="ts">
  import { Minus, Plus, Scan } from '@lucide/svelte';
  import type { CanvasSection, Item } from '../../../model/types.ts';
  import { themeColors } from '../../../pack/build.ts';
  import IconButton from '../../ui/IconButton.svelte';
  import { duplicateItems, pasteItems, removeItems, updateItem } from '../../state/items.ts';
  import { store } from '../../state/project.svelte.ts';
  import FrameStage from './FrameStage.svelte';
  import ItemToolbar from './ItemToolbar.svelte';

  let { section }: { section: CanvasSection } = $props();
  let box: HTMLDivElement | undefined = $state();
  let boxW = $state(700);
  let boxH = $state(500);
  let zoom = $state<number | null>(null); // null = fit
  let scrollX = $state(0);
  let scrollY = $state(0);

  const theme = $derived(themeColors(store.project!.theme));
  const fit = $derived(Math.max(0.1, Math.min((boxW - 40) / section.width, (boxH - 40) / section.height)));
  const scale = $derived(zoom ?? fit);

  $effect(() => {
    if (!box) return;
    const ro = new ResizeObserver(([e]) => {
      boxW = e.contentRect.width;
      boxH = e.contentRect.height;
    });
    ro.observe(box);
    return () => ro.disconnect();
  });

  const center = $derived({
    x: Math.round(Math.min(section.width - 40, Math.max(40, (scrollX + boxW / 2 - 20) / scale))),
    y: Math.round(Math.min(section.height - 40, Math.max(40, (scrollY + boxH / 2 - 20) / scale))),
  });

  function setZoom(z: number | null) {
    zoom = z === null ? null : Math.max(0.1, Math.min(4, z));
  }
</script>

<div class="canvas-editor">
  <ItemToolbar origin={center} area={{ w: 320 / Math.max(scale, 0.25), h: 240 / Math.max(scale, 0.25) }} />
  <div
    class="scroller"
    bind:this={box}
    onscroll={(e) => {
      scrollX = (e.currentTarget as HTMLElement).scrollLeft;
      scrollY = (e.currentTarget as HTMLElement).scrollTop;
    }}
  >
    <div class="pad">
      <FrameStage
        items={section.items}
        width={section.width}
        height={section.height}
        {scale}
        background={section.background ?? theme.bg}
        textColor={theme.fg}
        accent={theme.accent}
        selected={store.selection.items}
        onselect={(ids) => store.select({ items: ids })}
        onupdate={(id, patch, key) => updateItem(id, patch, key)}
        onremove={removeItems}
        onduplicate={(ids) => duplicateItems(ids)}
        onpaste={(items: Item[]) => pasteItems(items)}
      />
    </div>
  </div>
  <div class="zoom">
    <IconButton size="sm" label="Zoom out" onclick={() => setZoom(scale / 1.25)}><Minus /></IconButton>
    <button class="pct" onclick={() => setZoom(1)} title="Actual size (one calculator pixel per pixel)">{Math.round(scale * 100)}%</button>
    <IconButton size="sm" label="Zoom in" onclick={() => setZoom(scale * 1.25)}><Plus /></IconButton>
    <IconButton size="sm" label="Fit" active={zoom === null} onclick={() => setZoom(null)}><Scan /></IconButton>
    <span class="muted small">{section.width} × {section.height}. Screen: 320 × 240.</span>
  </div>
</div>

<style>
  .canvas-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .scroller {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--bg);
    background-image: radial-gradient(var(--line) 1px, transparent 1px);
    background-size: 16px 16px;
  }
  .pad {
    padding: 20px;
    width: max-content;
    min-width: 100%;
    display: flex;
    justify-content: center;
  }
  .pad :global(.stage) {
    box-shadow: var(--shadow-lg);
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    border-top: 1px solid var(--line);
    background: var(--panel);
  }
  .pct {
    border: none;
    background: transparent;
    font-variant-numeric: tabular-nums;
    font-size: 12.5px;
    min-width: 48px;
    padding: 4px;
    border-radius: 2px;
  }
  .pct:hover {
    background: var(--hover);
  }
  .zoom .muted {
    margin-left: 10px;
  }
</style>
