<script lang="ts">
  import { generateHTML } from '@tiptap/core';
  import type { Item, RichNode, TextItem } from '../../../model/types.ts';
  import { richExtensions } from '../../doc/extensions.ts';
  import RichEditor from '../../doc/RichEditor.svelte';
  import { assets } from '../../state/assets.ts';

  interface Props {
    items: Item[];
    width: number;
    height: number;
    scale: number;
    background: string;
    textColor: string;
    accent?: string;
    fontSize?: number;
    selected?: string[];
    readonly?: boolean;
    onselect?: (ids: string[]) => void;
    onupdate?: (id: string, patch: Partial<Item>, key: string) => void;
    onremove?: (ids: string[]) => void;
    onduplicate?: (ids: string[]) => void;
    onpaste?: (items: Item[]) => void;
  }
  let {
    items,
    width,
    height,
    scale,
    background,
    textColor,
    accent = '#f28c28',
    fontSize = 13,
    selected = [],
    readonly = false,
    onselect,
    onupdate,
    onremove,
    onduplicate,
    onpaste,
  }: Props = $props();

  let stage: HTMLDivElement | undefined = $state();
  let editing = $state<string | null>(null);
  let guides = $state<{ x: number[]; y: number[] }>({ x: [], y: [] });
  let clipboard: Item[] = [];

  const extensions = richExtensions();
  const htmlCache = new Map<string, string>();
  function html(doc: RichNode): string {
    const key = JSON.stringify(doc);
    let out = htmlCache.get(key);
    if (out === undefined) {
      try {
        out = generateHTML(doc as never, extensions);
      } catch {
        out = '';
      }
      htmlCache.set(key, out);
    }
    return out;
  }

  function filter(item: Item): string {
    if (item.type !== 'image') return '';
    const a = item.adjust;
    const f = [];
    if (a.brightness) f.push(`brightness(${100 + a.brightness}%)`);
    if (a.contrast) f.push(`contrast(${100 + a.contrast}%)`);
    if (a.saturation) f.push(`saturate(${100 + a.saturation}%)`);
    if (a.grayscale) f.push('grayscale(1)');
    if (a.invert) f.push('invert(1)');
    return f.join(' ');
  }

  function transform(item: Item): string {
    if (item.type !== 'image') return '';
    const a = item.adjust;
    return `rotate(${a.rotate}deg) scale(${a.flipX ? -1 : 1}, ${a.flipY ? -1 : 1})`;
  }

  // ---- Dragging ----

  type Drag = {
    kind: 'move' | 'resize' | 'end0' | 'end1';
    handle?: string;
    start: { x: number; y: number };
    origin: Map<string, { x: number; y: number; w: number; h: number }>;
    key: string;
    moved: boolean;
  };
  let drag: Drag | null = null;

  function point(e: PointerEvent) {
    const r = stage!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  const SNAP = 5;

  function snap(value: number, size: number, axis: 'x' | 'y', ignore: Set<string>): { v: number; line: number[] } {
    const total = axis === 'x' ? width : height;
    const targets = [0, total / 2, total];
    for (const it of items) {
      if (ignore.has(it.id)) continue;
      const p = axis === 'x' ? it.x : it.y;
      const s = axis === 'x' ? it.w : it.h;
      targets.push(p, p + s / 2, p + s);
    }
    const tol = SNAP / Math.max(scale, 0.5);
    let best = { v: value, d: tol + 1, line: [] as number[] };
    for (const t of targets) {
      for (const [offset, edge] of [
        [0, value],
        [size / 2, value + size / 2],
        [size, value + size],
      ] as const) {
        const d = Math.abs(edge - t);
        if (d < best.d) best = { v: t - offset, d, line: [t] };
      }
    }
    return best.d <= tol ? { v: best.v, line: best.line } : { v: value, line: [] };
  }

  function startMove(e: PointerEvent, item: Item) {
    if (readonly || e.button !== 0 || editing === item.id) return;
    e.stopPropagation();
    stage?.focus();
    let ids = selected;
    if (e.shiftKey) {
      ids = selected.includes(item.id) ? selected.filter((i) => i !== item.id) : [...selected, item.id];
      onselect?.(ids);
      return;
    }
    if (!selected.includes(item.id)) {
      ids = [item.id];
      onselect?.(ids);
    }
    if (item.locked) return;
    const origin = new Map(items.filter((i) => ids.includes(i.id)).map((i) => [i.id, { x: i.x, y: i.y, w: i.w, h: i.h }]));
    drag = { kind: 'move', start: point(e), origin, key: `move:${Date.now()}`, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function startResize(e: PointerEvent, item: Item, handle: string) {
    e.stopPropagation();
    const origin = new Map([[item.id, { x: item.x, y: item.y, w: item.w, h: item.h }]]);
    const kind = handle === 'end0' || handle === 'end1' ? handle : 'resize';
    drag = { kind, handle, start: point(e), origin, key: `resize:${Date.now()}`, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (!drag) return;
    const p = point(e);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 2 / scale) return;
    drag.moved = true;
    if (drag.kind === 'move') {
      const ignore = new Set(drag.origin.keys());
      const first = [...drag.origin.values()][0];
      const sx = snap(first.x + dx, first.w, 'x', ignore);
      const sy = snap(first.y + dy, first.h, 'y', ignore);
      guides = { x: e.altKey ? [] : sx.line, y: e.altKey ? [] : sy.line };
      const ddx = (e.altKey ? first.x + dx : sx.v) - first.x;
      const ddy = (e.altKey ? first.y + dy : sy.v) - first.y;
      for (const [id, o] of drag.origin) onupdate?.(id, { x: Math.round(o.x + ddx), y: Math.round(o.y + ddy) }, drag.key);
      return;
    }
    const [id, o] = [...drag.origin][0];
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if (drag.kind === 'end0') {
      onupdate?.(id, { x: Math.round(o.x + dx), y: Math.round(o.y + dy), w: Math.round(o.w - dx), h: Math.round(o.h - dy) }, drag.key);
      return;
    }
    if (drag.kind === 'end1') {
      onupdate?.(id, { w: Math.round(o.w + dx), h: Math.round(o.h + dy) }, drag.key);
      return;
    }
    const hnd = drag.handle!;
    let { x, y, w, h } = o;
    if (hnd.includes('e')) w = o.w + dx;
    if (hnd.includes('s')) h = o.h + dy;
    if (hnd.includes('w')) {
      w = o.w - dx;
      x = o.x + dx;
    }
    if (hnd.includes('n')) {
      h = o.h - dy;
      y = o.y + dy;
    }
    const keepAspect = (item.type === 'image') !== e.shiftKey;
    if (keepAspect && hnd.length === 2) {
      const ratio = o.w / o.h;
      if (w / h > ratio) w = h * ratio;
      else h = w / ratio;
      if (hnd.includes('w')) x = o.x + o.w - w;
      if (hnd.includes('n')) y = o.y + o.h - h;
    }
    w = Math.max(8, w);
    h = Math.max(8, h);
    onupdate?.(id, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }, drag.key);
  }

  function onUp() {
    drag = null;
    guides = { x: [], y: [] };
  }

  function onKey(e: KeyboardEvent) {
    if (readonly || editing) return;
    const mod = e.metaKey || e.ctrlKey;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
      e.preventDefault();
      onremove?.(selected);
    } else if (e.key === 'Escape') {
      onselect?.([]);
    } else if (mod && e.key.toLowerCase() === 'd' && selected.length) {
      e.preventDefault();
      onduplicate?.(selected);
    } else if (mod && e.key.toLowerCase() === 'c' && selected.length) {
      clipboard = structuredClone($state.snapshot(items.filter((i) => selected.includes(i.id))));
    } else if (mod && e.key.toLowerCase() === 'v' && clipboard.length) {
      e.preventDefault();
      e.stopPropagation();
      onpaste?.(structuredClone(clipboard));
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      onselect?.(items.map((i) => i.id));
    } else if (e.key.startsWith('Arrow') && selected.length) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      for (const it of items.filter((i) => selected.includes(i.id))) onupdate?.(it.id, { x: it.x + dx, y: it.y + dy }, 'nudge');
    }
  }

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const single = $derived(selected.length === 1 ? items.find((i) => i.id === selected[0]) : undefined);
  const isLine = (i: Item) => i.type === 'shape' && (i.shape === 'line' || i.shape === 'arrow');
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="stage"
  class:readonly
  bind:this={stage}
  tabindex={readonly ? -1 : 0}
  role={readonly ? 'img' : 'application'}
  aria-label="Slide editor"
  style="width: {width * scale}px; height: {height * scale}px; background: {background}; --s: {scale}; --fg: {textColor}; --accent: {accent}; --size: {fontSize * scale}px"
  onpointerdown={(e) => {
    if (readonly || e.target !== stage) return;
    editing = null;
    onselect?.([]);
  }}
  onpointermove={onMove}
  onpointerup={onUp}
  onpointercancel={onUp}
  onkeydown={onKey}
>
  {#each items as item (item.id)}
    {@const sel = selected.includes(item.id)}
    <div
      class="item {item.type}"
      class:sel
      class:link={!!item.link}
      style="left: {Math.min(item.x, item.x + item.w) * scale}px; top: {Math.min(item.y, item.y + item.h) * scale}px; width: {Math.abs(item.w) * scale}px; height: {Math.abs(item.h) * scale}px"
      onpointerdown={(e) => startMove(e, item)}
      ondblclick={() => {
        if (!readonly && item.type === 'text') editing = item.id;
      }}
      role="presentation"
    >
      {#if item.type === 'image'}
        {@const url = assets.url(item.asset)}
        <div class="img-wrap" style="border-radius: {item.radius * scale}px; {item.border ? `box-shadow: inset 0 0 0 ${item.border.width * scale}px ${item.border.color}` : ''}">
          {#if url}
            <img src={url} alt={item.caption ?? ''} draggable="false" style="object-fit: {item.fit === 'fill' ? 'fill' : item.fit}; filter: {filter(item)}; transform: {transform(item)}" />
          {:else}
            <span class="missing">Missing picture</span>
          {/if}
        </div>
      {:else if item.type === 'text'}
        {@const t = item as TextItem}
        <div
          class="text-box"
          style="background: {t.background ?? 'transparent'}; border-radius: {t.radius * scale}px; padding: {t.padding * scale}px; justify-content: {t.valign === 'middle' ? 'center' : t.valign === 'bottom' ? 'flex-end' : 'flex-start'}; --size: {(t.fontSize ?? fontSize) * scale}px"
        >
          {#if editing === item.id}
            <div class="editing" onpointerdown={(e) => e.stopPropagation()} role="presentation">
              <RichEditor
                doc={t.doc}
                scale={scale}
                fontSize={t.fontSize ?? fontSize}
                font={t.font}
                color={textColor}
                toolbar={false}
                autofocus
                onchange={(doc) => onupdate?.(item.id, { doc } as Partial<Item>, `text:${item.id}`)}
              />
            </div>
          {:else}
            <div class="static">{@html html(t.doc)}</div>
          {/if}
        </div>
      {:else if item.shape === 'rect'}
        <div class="shape" style="background: {item.fill ?? 'transparent'}; border-radius: {item.radius * scale}px; box-shadow: {item.stroke ? `inset 0 0 0 ${item.strokeWidth * scale}px ${item.stroke}` : 'none'}"></div>
      {:else if item.shape === 'ellipse'}
        <div class="shape" style="background: {item.fill ?? 'transparent'}; border-radius: 50%; box-shadow: {item.stroke ? `inset 0 0 0 ${item.strokeWidth * scale}px ${item.stroke}` : 'none'}"></div>
      {:else}
        {@const flipX = item.w < 0}
        {@const flipY = item.h < 0}
        <svg class="line" viewBox="0 0 {Math.max(Math.abs(item.w), 1)} {Math.max(Math.abs(item.h), 1)}" preserveAspectRatio="none" overflow="visible">
          <defs>
            <marker id="arrow-{item.id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={item.stroke ?? '#000'} />
            </marker>
          </defs>
          <line
            x1={flipX ? Math.abs(item.w) : 0}
            y1={flipY ? Math.abs(item.h) : 0}
            x2={flipX ? 0 : Math.abs(item.w)}
            y2={flipY ? 0 : Math.abs(item.h)}
            stroke={item.stroke ?? '#000'}
            stroke-width={item.strokeWidth}
            vector-effect="non-scaling-stroke"
            style="stroke-width: {item.strokeWidth * scale}px"
            marker-end={item.shape === 'arrow' ? `url(#arrow-${item.id})` : undefined}
          />
        </svg>
      {/if}
    </div>
  {/each}

  {#if !readonly && single && !editing}
    {#if isLine(single)}
      {#each ['end0', 'end1'] as h (h)}
        <div
          class="handle end"
          style="left: {(h === 'end0' ? single.x : single.x + single.w) * scale}px; top: {(h === 'end0' ? single.y : single.y + single.h) * scale}px"
          onpointerdown={(e) => startResize(e, single, h)}
          role="presentation"
        ></div>
      {/each}
    {:else if !single.locked}
      {#each HANDLES as h (h)}
        {@const hx = h.includes('w') ? single.x : h.includes('e') ? single.x + single.w : single.x + single.w / 2}
        {@const hy = h.includes('n') ? single.y : h.includes('s') ? single.y + single.h : single.y + single.h / 2}
        <div class="handle {h}" style="left: {hx * scale}px; top: {hy * scale}px" onpointerdown={(e) => startResize(e, single, h)} role="presentation"></div>
      {/each}
    {/if}
  {/if}

  {#each guides.x as gx (gx)}
    <div class="guide v" style="left: {gx * scale}px"></div>
  {/each}
  {#each guides.y as gy (gy)}
    <div class="guide h" style="top: {gy * scale}px"></div>
  {/each}
</div>

<style>
  .stage {
    position: relative;
    overflow: hidden;
    outline: none;
    flex: none;
    touch-action: none;
    user-select: none;
  }
  .item {
    position: absolute;
    cursor: move;
  }
  .readonly .item {
    cursor: default;
    pointer-events: none;
  }
  .item.sel {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .item.link::after {
    content: '↗';
    position: absolute;
    right: 2px;
    top: 0;
    font-size: 11px;
    color: var(--accent);
    opacity: 0.8;
  }
  .readonly .item.link::after {
    display: none;
  }
  .img-wrap {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .img-wrap img {
    width: 100%;
    height: 100%;
    display: block;
  }
  .missing {
    display: grid;
    place-items: center;
    height: 100%;
    font-size: 11px;
    color: var(--dim);
    background: var(--hover);
  }
  .text-box {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: visible;
  }
  .static,
  .editing {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: var(--size);
    line-height: 1.35;
    color: var(--fg);
  }
  .editing {
    cursor: text;
    user-select: text;
  }
  .static :global(p) {
    margin: 0 0 0.55em;
  }
  .static :global(h1) {
    font-size: 1.55em;
    margin: 0 0 0.35em;
    line-height: 1.25;
  }
  .static :global(h2) {
    font-size: 1.28em;
    margin: 0 0 0.35em;
    line-height: 1.25;
  }
  .static :global(h3) {
    font-size: 1.1em;
    margin: 0 0 0.3em;
  }
  .static :global(ul),
  .static :global(ol) {
    margin: 0 0 0.55em;
    padding-left: 1.25em;
  }
  .static :global(li p) {
    margin: 0;
  }
  .static :global(table) {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
    font-size: 0.92em;
    line-height: 1.25;
  }
  .static :global(td),
  .static :global(th) {
    border: 1px solid color-mix(in srgb, var(--fg) 18%, transparent);
    padding: calc(4px * var(--s));
    text-align: left;
    vertical-align: top;
  }
  .static :global(th) {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .static :global(td p),
  .static :global(th p) {
    margin: 0;
  }
  .static :global(:last-child) {
    margin-bottom: 0;
  }
  .static :global(mark) {
    color: inherit;
    border-radius: 2px;
  }
  .shape {
    width: 100%;
    height: 100%;
  }
  .line {
    width: 100%;
    height: 100%;
    display: block;
    overflow: visible;
  }
  .handle {
    position: absolute;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    background: #fff;
    border: 1.5px solid var(--accent);
    border-radius: 3px;
    z-index: 5;
  }
  .handle.end {
    border-radius: 50%;
    cursor: crosshair;
  }
  .nw,
  .se {
    cursor: nwse-resize;
  }
  .ne,
  .sw {
    cursor: nesw-resize;
  }
  .n,
  .s {
    cursor: ns-resize;
  }
  .e,
  .w {
    cursor: ew-resize;
  }
  .guide {
    position: absolute;
    background: #ff2d8a;
    pointer-events: none;
    z-index: 6;
  }
  .guide.v {
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .guide.h {
    left: 0;
    right: 0;
    height: 1px;
  }
</style>
