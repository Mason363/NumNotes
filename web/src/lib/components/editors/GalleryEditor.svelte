<script lang="ts">
  import type { GallerySection } from '../../../model/types.ts';
  import { assets } from '../../state/assets.ts';
  import { store } from '../../state/project.svelte.ts';
  import { pickFiles } from '../DropZone.svelte';

  let { section }: { section: GallerySection } = $props();
  let dragging = $state<number | null>(null);
  let over = $state<number | null>(null);

  function update(fn: (s: GallerySection) => void, key = '') {
    const id = section.id;
    store.edit((p) => {
      const s = p.sections.find((x) => x.id === id);
      if (s?.mode === 'gallery') fn(s);
    }, key);
  }

  function move(from: number, to: number) {
    if (from === to) return;
    update((s) => {
      const [m] = s.images.splice(from, 1);
      s.images.splice(to > from ? to - 1 : to, 0, m);
    });
  }

  const selected = $derived(store.selection.items[0]);
</script>

<div class="gallery" style="--cols: {section.columns}">
  {#if !section.images.length}
    <button class="empty" onclick={pickFiles}>
      <strong>Add pictures</strong>
      <span class="muted small">Or drop them here</span>
    </button>
  {:else}
    <div class="grid">
      {#each section.images as img, i (img.id)}
        <figure
          class:selected={selected === img.id}
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
            if (dragging !== null) move(dragging, i);
            dragging = over = null;
          }}
          ondragend={() => (dragging = over = null)}
        >
          <button class="thumb" onclick={() => store.select({ items: [img.id] })} aria-label="Select picture {i + 1}">
            {#if assets.url(img.asset)}
              <img src={assets.url(img.asset)} alt={img.caption ?? ''} style="filter: {img.adjust.grayscale ? 'grayscale(1)' : ''}" />
            {/if}
          </button>
          <input
            class="caption"
            placeholder="Caption"
            value={img.caption ?? ''}
            oninput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              update((s) => (s.images[i].caption = v), `caption:${img.id}`);
            }}
          />
          <button class="del" aria-label="Remove picture" onclick={() => update((s) => s.images.splice(i, 1))}>×</button>
        </figure>
      {/each}
      <button class="add" onclick={pickFiles}>+ Add</button>
    </div>
  {/if}
</div>

<style>
  .gallery {
    overflow: auto;
    padding: 24px;
    flex: 1;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 14px;
  }
  figure {
    margin: 0;
    position: relative;
    display: grid;
    gap: 6px;
    border-radius: 2px;
  }
  figure.drop-before::before {
    content: '';
    position: absolute;
    left: -8px;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 3px;
    background: var(--accent);
  }
  .thumb {
    aspect-ratio: 1;
    border: none;
    padding: 0;
    border-radius: 2px;
    overflow: hidden;
    background: var(--hover);
    box-shadow: none;
  }
  .selected .thumb {
    box-shadow: 0 0 0 3px var(--accent);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .caption {
    border: 1px solid transparent;
    background: transparent;
    font-size: 12.5px;
    padding: 3px 6px;
    border-radius: 2px;
  }
  .caption:hover,
  .caption:focus {
    border-color: var(--line);
    background: var(--panel);
    outline: none;
  }
  .del {
    position: absolute;
    top: 6px;
    right: 6px;
    border: none;
    width: 26px;
    height: 26px;
    border-radius: 2px;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    opacity: 0;
    transition: opacity 0.15s;
  }
  figure:hover .del {
    opacity: 1;
  }
  .add,
  .empty {
    border: 1px dashed var(--line-strong);
    border-radius: 2px;
    background: transparent;
    color: var(--dim);
    display: grid;
    place-items: center;
    align-content: center;
    gap: 6px;
  }
  .add {
    aspect-ratio: 1;
  }
  .add:hover,
  .empty:hover {
    border-color: var(--accent);
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .empty {
    width: 100%;
    max-width: 520px;
    margin: 40px auto;
    padding: 50px 20px;
  }
</style>
