<script lang="ts">
  import { Copy, Plus, Trash2 } from '@lucide/svelte';
  import type { Item, SlidesSection } from '../../../model/types.ts';
  import { themeColors } from '../../../pack/build.ts';
  import { newId } from '../../state/assets.ts';
  import { newSlide, slideHeight } from '../../state/defaults.ts';
  import { duplicateItems, pasteItems, removeItems, updateItem } from '../../state/items.ts';
  import { store } from '../../state/project.svelte.ts';
  import FrameStage from './FrameStage.svelte';
  import ItemToolbar from './ItemToolbar.svelte';

  let { section }: { section: SlidesSection } = $props();
  let box: HTMLDivElement | undefined = $state();
  let boxW = $state(700);
  let boxH = $state(500);
  let dragging = $state<number | null>(null);
  let over = $state<number | null>(null);

  const theme = $derived(themeColors(store.project!.theme));
  const h = $derived(slideHeight(section));
  const slide = $derived(section.slides.find((s) => s.id === store.selection.slide) ?? section.slides[0]);
  const slideIndex = $derived(slide ? section.slides.indexOf(slide) : -1);
  const scale = $derived(Math.max(0.5, Math.min((boxW - 48) / 320, (boxH - 40) / h, 3)));
  const bg = (s: { background?: string }) => s.background ?? section.background ?? theme.bg;

  $effect(() => {
    if (!box) return;
    const ro = new ResizeObserver(([e]) => {
      boxW = e.contentRect.width;
      boxH = e.contentRect.height;
    });
    ro.observe(box);
    return () => ro.disconnect();
  });

  function edit(fn: (s: SlidesSection) => void, key = '') {
    const id = section.id;
    store.edit((p) => {
      const s = p.sections.find((x) => x.id === id);
      if (s?.mode === 'slides') fn(s);
    }, key);
  }

  function addSlide() {
    const created = newSlide([]);
    edit((s) => s.slides.splice(slideIndex + 1, 0, created));
    store.select({ slide: created.id, items: [] });
  }

  function duplicateSlide(i: number) {
    const copy = structuredClone($state.snapshot(section.slides[i]));
    copy.id = newId('s');
    for (const it of copy.items) it.id = newId('i');
    edit((s) => s.slides.splice(i + 1, 0, copy));
    store.select({ slide: copy.id, items: [] });
  }

  function removeSlide(i: number) {
    if (section.slides.length <= 1) return;
    edit((s) => s.slides.splice(i, 1));
    store.select({ slide: section.slides[Math.max(0, i - 1)]?.id ?? null, items: [] });
  }

  function drop(to: number) {
    const from = dragging;
    dragging = over = null;
    if (from === null || from === to) return;
    edit((s) => {
      const [m] = s.slides.splice(from, 1);
      s.slides.splice(to > from ? to - 1 : to, 0, m);
    });
  }
</script>

<div class="slides-editor">
  <ItemToolbar origin={{ x: 160, y: h / 2 }} area={{ w: 320, h }} />
  <div class="stage-area" bind:this={box}>
    {#if slide}
      <FrameStage
        items={slide.items}
        width={320}
        height={h}
        {scale}
        background={bg(slide)}
        textColor={theme.fg}
        accent={theme.accent}
        selected={store.selection.items}
        onselect={(ids) => store.select({ items: ids })}
        onupdate={(id, patch, key) => updateItem(id, patch, key)}
        onremove={removeItems}
        onduplicate={(ids) => duplicateItems(ids)}
        onpaste={(items: Item[]) => pasteItems(items)}
      />
    {/if}
  </div>
  <div class="strip" role="listbox" aria-label="Slides">
    {#each section.slides as s, i (s.id)}
      <div
        class="thumb-wrap"
        class:drop-before={over === i && dragging !== null && dragging !== i}
        draggable="true"
        ondragstart={() => (dragging = i)}
        ondragover={(e) => {
          if (dragging === null) return;
          e.preventDefault();
          over = i;
        }}
        ondrop={(e) => {
          e.preventDefault();
          drop(i);
        }}
        ondragend={() => (dragging = over = null)}
        role="presentation"
      >
        <button class="thumb" class:on={s.id === slide?.id} role="option" aria-selected={s.id === slide?.id} onclick={() => store.select({ slide: s.id, items: [] })}>
          <FrameStage items={s.items} width={320} height={h} scale={0.3} background={bg(s)} textColor={theme.fg} readonly />
        </button>
        <span class="num">{i + 1}</span>
        <div class="thumb-actions">
          <button title="Duplicate slide" aria-label="Duplicate slide" onclick={() => duplicateSlide(i)}><Copy size={12} /></button>
          {#if section.slides.length > 1}
            <button title="Delete slide" aria-label="Delete slide" onclick={() => removeSlide(i)}><Trash2 size={12} /></button>
          {/if}
        </div>
      </div>
    {/each}
    <button class="new" onclick={addSlide} title="Add slide"><Plus size={18} /></button>
  </div>
</div>

<style>
  .slides-editor {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .stage-area {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    background: var(--layout);
    background-image: radial-gradient(var(--line-strong) 1px, transparent 1px);
    background-size: 16px 16px;
    overflow: hidden;
  }
  .stage-area :global(.stage) {
    box-shadow: 0 2px 12px rgba(38, 44, 80, 0.12);
  }
  .strip {
    display: flex;
    gap: 12px;
    padding: 12px 16px 12px;
    overflow-x: auto;
    border-top: 1px solid var(--line);
    align-items: flex-start;
    flex: none;
  }
  .thumb-wrap {
    position: relative;
    flex: none;
  }
  .thumb-wrap.drop-before::before {
    content: '';
    position: absolute;
    left: -8px;
    top: 0;
    bottom: 18px;
    width: 3px;
    border-radius: 2px;
    background: var(--purple);
  }
  .thumb {
    padding: 0;
    border: 2px solid var(--line);
    border-radius: var(--radius-sm);
    overflow: hidden;
    display: block;
    background: transparent;
  }
  .thumb:hover {
    border-color: var(--card-hover);
  }
  .thumb.on {
    border-color: var(--accent);
  }
  .num {
    display: block;
    text-align: center;
    font-size: 11px;
    font-weight: 700;
    color: var(--label);
    margin-top: 4px;
  }
  .thumb-actions {
    position: absolute;
    top: 5px;
    right: 5px;
    display: flex;
    gap: 3px;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .thumb-wrap:hover .thumb-actions {
    opacity: 1;
  }
  .thumb-actions button {
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--panel);
    color: var(--label);
    box-shadow: var(--shadow);
  }
  .thumb-actions button:hover {
    color: var(--purple);
  }
  .new {
    flex: none;
    width: 100px;
    height: 76px;
    border-radius: var(--radius-sm);
    border: 2px dashed var(--card-hover);
    background: var(--layout);
    color: var(--purple);
    display: grid;
    place-items: center;
  }
  .new:hover {
    border-color: var(--purple);
  }
</style>
