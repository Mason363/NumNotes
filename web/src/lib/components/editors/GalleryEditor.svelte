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
    padding: 20px;
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
  }
  figure.drop-before::before {
    content: '';
    position: absolute;
    left: -9px;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 2px;
    background: var(--purple);
  }
  .thumb {
    aspect-ratio: 1;
    border: 2px solid transparent;
    padding: 0;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--layout);
  }
  .thumb:hover {
    border-color: var(--card-hover);
  }
  .selected .thumb {
    border-color: var(--accent);
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
    font-size: 12px;
    font-weight: 600;
    color: var(--label);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
  }
  .caption:hover {
    background: var(--layout);
  }
  .caption:focus {
    border-color: var(--purple);
    background: var(--panel);
    outline: none;
  }
  .del {
    position: absolute;
    top: 8px;
    right: 8px;
    border: none;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--panel);
    color: var(--label);
    box-shadow: var(--shadow);
    opacity: 0;
    transition: opacity 0.15s;
  }
  .del:hover {
    color: var(--danger);
  }
  figure:hover .del {
    opacity: 1;
  }
  .add,
  .empty {
    border: 2px dashed var(--card-hover);
    border-radius: var(--radius);
    background: var(--layout);
    color: var(--purple);
    font-weight: 700;
    font-size: 13px;
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
    border-color: var(--purple);
  }
  .empty {
    width: 100%;
    max-width: 520px;
    margin: 40px auto;
    padding: 50px 20px;
  }
</style>
