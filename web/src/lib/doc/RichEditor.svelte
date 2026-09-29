<script lang="ts">
  import { Editor } from '@tiptap/core';
  import { NodeSelection } from '@tiptap/pm/state';
  import { onMount } from 'svelte';
  import type { FontFamily, RichNode } from '../../model/types.ts';
  import { richExtensions } from './extensions.ts';
  import RichToolbar from './RichToolbar.svelte';
  import { store } from '../state/project.svelte.ts';

  interface Props {
    doc: RichNode;
    onchange: (doc: RichNode) => void;
    /** Pixels per calculator pixel, so line lengths match the calculator. */
    scale?: number;
    fontSize?: number;
    font?: FontFamily;
    lineHeight?: number;
    color?: string;
    background?: string;
    width?: number;
    placeholder?: string;
    toolbar?: boolean;
    compact?: boolean;
    autofocus?: boolean;
  }
  let {
    doc,
    onchange,
    scale = 1.5,
    fontSize = 13,
    font = 'inter',
    lineHeight = 1.35,
    color = '#1c1c1f',
    background = 'transparent',
    width,
    placeholder = 'Start typing…',
    toolbar = true,
    compact = false,
    autofocus = false,
  }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let editor = $state.raw<Editor | null>(null);
  let tick = $state(0);
  let lastEmitted = '';

  const FAMILIES: Record<FontFamily, string> = {
    inter: "'Inter', system-ui, sans-serif",
    atkinson: "'Atkinson Hyperlegible', system-ui, sans-serif",
    lora: "'Lora', Georgia, serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    system: 'system-ui, sans-serif',
  };

  onMount(() => {
    const initial = $state.snapshot(doc) as RichNode;
    lastEmitted = JSON.stringify(initial);
    const e = new Editor({
      element: host!,
      extensions: richExtensions(placeholder),
      content: initial,
      autofocus: autofocus ? 'end' : false,
      onUpdate: ({ editor: ed }) => {
        const json = ed.getJSON() as RichNode;
        lastEmitted = JSON.stringify(json);
        onchange(json);
      },
      onTransaction: ({ editor: ed }) => {
        tick++;
        store.editorTick++;
        const sel = ed.state.selection;
        if (sel instanceof NodeSelection && sel.node.type.name === 'picture') {
          const pos = sel.from;
          store.focusPicture = {
            attrs: { ...sel.node.attrs },
            apply: (attrs) => {
              ed.chain().setNodeSelection(pos).updateAttributes('picture', attrs).run();
            },
          };
        } else if (store.focusPicture && ed.isFocused) {
          store.focusPicture = null;
        }
      },
      onFocus: ({ editor: ed }) => {
        store.activeEditor = ed;
      },
    });
    editor = e;
    return () => {
      if (store.activeEditor === e) store.activeEditor = null;
      e.destroy();
    };
  });

  // Undo/redo and other outside changes replace the content.
  $effect(() => {
    const json = JSON.stringify($state.snapshot(doc));
    if (!editor || json === lastEmitted) return;
    lastEmitted = json;
    editor.commands.setContent(JSON.parse(json), { emitUpdate: false });
  });
</script>

<div class="rich" class:bare={!toolbar}>
  {#if toolbar && editor}
    <div class="bar"><RichToolbar {editor} {tick} {compact} /></div>
  {/if}
  <div class="scroll">
    <div
      class="page"
      style="--s: {scale}; --size: {fontSize * scale}px; --lh: {lineHeight}; --fg: {color}; --bg: {background}; --family: {FAMILIES[font]}; {width ? `width: ${width * scale}px;` : ''}"
      bind:this={host}
    ></div>
  </div>
</div>

<style>
  .rich {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 5;
  }
  .scroll {
    flex: 1;
    overflow: auto;
  }
  .bare .scroll {
    overflow: visible;
  }
  .page {
    margin: 0 auto;
    font-family: var(--family);
    font-size: var(--size);
    line-height: var(--lh);
    color: var(--fg);
    background: var(--bg);
  }
  .page :global(.ProseMirror) {
    outline: none;
    box-shadow: none;
    min-height: 100%;
    word-wrap: break-word;
  }
  .page :global(.ProseMirror > * + *) {
    margin-top: 0;
  }
  .page :global(p) {
    margin: 0 0 0.55em;
  }
  .page :global(h1) {
    font-size: 1.55em;
    font-weight: 700;
    margin: 0.5em 0 0.35em;
    line-height: 1.25;
  }
  .page :global(h2) {
    font-size: 1.28em;
    font-weight: 700;
    margin: 0.5em 0 0.35em;
    line-height: 1.25;
  }
  .page :global(h3) {
    font-size: 1.1em;
    font-weight: 700;
    margin: 0.5em 0 0.3em;
  }
  .page :global(.ProseMirror > :first-child) {
    margin-top: 0;
  }
  .page :global(ul),
  .page :global(ol) {
    padding-left: 1.25em;
    margin: 0 0 0.55em;
  }
  .page :global(li p) {
    margin: 0;
  }
  .page :global(blockquote) {
    border-left: calc(3px * var(--s)) solid color-mix(in srgb, var(--fg) 40%, transparent);
    margin: 0 0 0.55em;
    padding-left: 0.8em;
  }
  .page :global(code) {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.9em;
    background: color-mix(in srgb, var(--fg) 9%, transparent);
    padding: 0.05em 0.25em;
    border-radius: 4px;
  }
  .page :global(pre) {
    background: color-mix(in srgb, var(--fg) 9%, transparent);
    border-radius: 6px;
    padding: 0.5em 0.6em;
    font-size: 0.88em;
    white-space: pre-wrap;
  }
  .page :global(pre code) {
    background: none;
    padding: 0;
  }
  .page :global(hr) {
    border: none;
    border-top: 1px solid color-mix(in srgb, var(--fg) 20%, transparent);
    margin: 0.4em 0 0.8em;
  }
  .page :global(mark) {
    border-radius: 3px;
    padding: 0 1px;
    color: inherit;
  }
  .page :global(table) {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
    margin: 0.3em 0 0.6em;
    font-size: 0.92em;
    line-height: 1.25;
  }
  .page :global(td),
  .page :global(th) {
    border: 1px solid color-mix(in srgb, var(--fg) 18%, transparent);
    padding: calc(4px * var(--s));
    vertical-align: top;
    position: relative;
    text-align: left;
  }
  .page :global(th) {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    font-weight: 700;
  }
  .page :global(td p),
  .page :global(th p) {
    margin: 0;
  }
  .page :global(.selectedCell::after) {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(242, 140, 40, 0.18);
    pointer-events: none;
  }
  .page :global(.column-resize-handle) {
    position: absolute;
    right: -2px;
    top: 0;
    bottom: 0;
    width: 4px;
    background: var(--accent);
    pointer-events: none;
  }
  .page :global(.tableWrapper) {
    overflow-x: auto;
  }
  .page :global(.resize-cursor) {
    cursor: col-resize;
  }
  .page :global(.nn-picture) {
    margin: 0.3em 0 0.6em;
    text-align: center;
  }
  .page :global(.nn-picture[data-align='left']) {
    text-align: left;
  }
  .page :global(.nn-picture[data-align='right']) {
    text-align: right;
  }
  .page :global(.nn-picture img) {
    max-width: 100%;
    border-radius: 3px;
    display: inline-block;
  }
  .page :global(.nn-picture figcaption) {
    font-size: 0.82em;
    font-style: italic;
    opacity: 0.65;
  }
  .page :global(.ProseMirror-selectednode) {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .page :global(.nn-math) {
    text-align: center;
    margin: 0.3em 0 0.6em;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.9em;
  }
  .page :global(.nn-math svg) {
    max-width: 100%;
  }
  .page :global(.nn-math-input) {
    display: none;
    width: 100%;
    margin-top: 6px;
    font: 13px var(--mono, monospace);
    padding: 6px 8px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--panel, #fff);
    color: var(--text, #1c1c1f);
  }
  .page :global(.nn-math.editing .nn-math-input) {
    display: block;
  }
  .page :global(p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    color: color-mix(in srgb, var(--fg) 35%, transparent);
    float: left;
    height: 0;
    pointer-events: none;
  }
</style>
