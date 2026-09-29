<script lang="ts">
  import { importFile } from '../../import/index.ts';
  import type { Editor } from '@tiptap/core';
  import {
    Bold,
    Code,
    Highlighter,
    Image,
    Italic,
    List,
    ListOrdered,
    Minus,
    Palette,
    Quote,
    Sigma,
    Strikethrough,
    Table,
    TextAlignCenter,
    TextAlignEnd,
    TextAlignJustify,
    TextAlignStart,
    Underline,
    Rows3,
    Columns3,
    Trash2,
    SquareCode,
  } from '@lucide/svelte';
  import IconButton from '../ui/IconButton.svelte';
  import { assets } from '../state/assets.ts';

  interface Props {
    editor: Editor;
    /** Bumped on every editor transaction so button states refresh. */
    tick: number;
    compact?: boolean;
    pictures?: boolean;
  }
  let { editor, tick, compact = false, pictures = true }: Props = $props();

  let colorOpen = $state<'text' | 'highlight' | 'cell' | null>(null);
  const TEXT_COLORS = ['#1c1c1f', '#6c6c74', '#e5484d', '#f28c28', '#c79a00', '#2fa84f', '#0091c2', '#3f6ff5', '#8e4ec6', '#d6409f'];
  const HIGHLIGHTS = ['#ffe27a', '#ffd3b3', '#ffc9c9', '#c9f2c7', '#c8e7ff', '#e3d4ff', '#f2f2f5'];
  const CELLS = ['#ffe1e1', '#ffe8d1', '#fff1cc', '#e2f7dc', '#d9f5f0', '#dcebff', '#ebe1ff', '#ffe2f2', '#efeff2'];

  const is = (name: string, attrs?: Record<string, unknown>) => {
    void tick;
    return editor.isActive(name, attrs);
  };
  const style = $derived.by(() => {
    void tick;
    if (editor.isActive('heading', { level: 1 })) return 'h1';
    if (editor.isActive('heading', { level: 2 })) return 'h2';
    if (editor.isActive('heading', { level: 3 })) return 'h3';
    return 'p';
  });
  const inTable = $derived.by(() => {
    void tick;
    return editor.isActive('table');
  });

  function setStyle(v: string) {
    const chain = editor.chain().focus();
    if (v === 'p') chain.setParagraph().run();
    else chain.toggleHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
  }

  function setSize(v: string) {
    const chain = editor.chain().focus();
    if (!v) chain.unsetFontSize().run();
    else chain.setFontSize(v).run();
  }

  function insertPicture() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.heic,.heif';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      for (const item of await importFile(file)) {
        for (const meta of await assets.add(item)) {
          editor.chain().focus().insertContent({ type: 'picture', attrs: { asset: meta.id, width: 100, align: 'center', caption: '' } }).run();
        }
      }
    };
    input.click();
  }

  function insertMath() {
    const before = editor.state.selection.from;
    editor.chain().focus().insertContent({ type: 'mathBlock', attrs: { latex: 'E = mc^2' } }).run();
    // Select the new formula so its LaTeX field opens.
    let target = -1;
    editor.state.doc.descendants((node, pos) => {
      if (target < 0 && node.type.name === 'mathBlock' && pos >= before - 2) target = pos;
      return target < 0;
    });
    if (target >= 0) editor.commands.setNodeSelection(target);
  }

  function pickColor(kind: 'text' | 'highlight' | 'cell', color: string | null) {
    const chain = editor.chain().focus();
    if (kind === 'text') (color ? chain.setColor(color) : chain.unsetColor()).run();
    else if (kind === 'highlight') (color ? chain.setHighlight({ color }) : chain.unsetHighlight()).run();
    else chain.setCellAttribute('backgroundColor', color).run();
    colorOpen = null;
  }
</script>

<div class="toolbar" class:compact role="toolbar" aria-label="Text formatting">
  <select class="style" value={style} onchange={(e) => setStyle((e.currentTarget as HTMLSelectElement).value)} aria-label="Paragraph style">
    <option value="p">Text</option>
    <option value="h1">Title</option>
    <option value="h2">Heading</option>
    <option value="h3">Subheading</option>
  </select>
  <select class="size" onchange={(e) => setSize((e.currentTarget as HTMLSelectElement).value)} aria-label="Text size" title="Text size">
    <option value="">Size</option>
    <option value="10px">Small</option>
    <option value="">Normal</option>
    <option value="16px">Large</option>
    <option value="20px">Huge</option>
  </select>
  <span class="sep"></span>
  <IconButton size="sm" label="Bold" active={is('bold')} onclick={() => editor.chain().focus().toggleBold().run()}><Bold /></IconButton>
  <IconButton size="sm" label="Italic" active={is('italic')} onclick={() => editor.chain().focus().toggleItalic().run()}><Italic /></IconButton>
  <IconButton size="sm" label="Underline" active={is('underline')} onclick={() => editor.chain().focus().toggleUnderline().run()}><Underline /></IconButton>
  <IconButton size="sm" label="Strikethrough" active={is('strike')} onclick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></IconButton>
  <IconButton size="sm" label="Code" active={is('code')} onclick={() => editor.chain().focus().toggleCode().run()}><Code /></IconButton>
  <span class="pop-root">
    <IconButton size="sm" label="Text color" active={colorOpen === 'text'} onclick={() => (colorOpen = colorOpen === 'text' ? null : 'text')}><Palette /></IconButton>
    <IconButton size="sm" label="Highlight" active={colorOpen === 'highlight' || is('highlight')} onclick={() => (colorOpen = colorOpen === 'highlight' ? null : 'highlight')}><Highlighter /></IconButton>
    {#if colorOpen}
      <div class="colors">
        {#each colorOpen === 'text' ? TEXT_COLORS : colorOpen === 'highlight' ? HIGHLIGHTS : CELLS as c (c)}
          <button class="swatch" style="background: {c}" aria-label={c} onclick={() => pickColor(colorOpen!, c)}></button>
        {/each}
        <button class="swatch none" aria-label="None" onclick={() => pickColor(colorOpen!, null)}></button>
      </div>
    {/if}
  </span>
  <span class="sep"></span>
  <IconButton size="sm" label="Align left" active={is('paragraph', { textAlign: 'left' })} onclick={() => editor.chain().focus().setTextAlign('left').run()}><TextAlignStart /></IconButton>
  <IconButton size="sm" label="Center" active={is('paragraph', { textAlign: 'center' }) || is('heading', { textAlign: 'center' })} onclick={() => editor.chain().focus().setTextAlign('center').run()}><TextAlignCenter /></IconButton>
  {#if !compact}
    <IconButton size="sm" label="Align right" active={is('paragraph', { textAlign: 'right' })} onclick={() => editor.chain().focus().setTextAlign('right').run()}><TextAlignEnd /></IconButton>
    <IconButton size="sm" label="Justify" active={is('paragraph', { textAlign: 'justify' })} onclick={() => editor.chain().focus().setTextAlign('justify').run()}><TextAlignJustify /></IconButton>
  {/if}
  <span class="sep"></span>
  <IconButton size="sm" label="Bullet list" active={is('bulletList')} onclick={() => editor.chain().focus().toggleBulletList().run()}><List /></IconButton>
  <IconButton size="sm" label="Numbered list" active={is('orderedList')} onclick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></IconButton>
  <IconButton size="sm" label="Quote" active={is('blockquote')} onclick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></IconButton>
  {#if !compact}
    <IconButton size="sm" label="Code block" active={is('codeBlock')} onclick={() => editor.chain().focus().toggleCodeBlock().run()}><SquareCode /></IconButton>
    <IconButton size="sm" label="Divider" onclick={() => editor.chain().focus().setHorizontalRule().run()}><Minus /></IconButton>
  {/if}
  <span class="sep"></span>
  <IconButton size="sm" label="Insert table" onclick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table /></IconButton>
  {#if pictures}
    <IconButton size="sm" label="Insert picture" onclick={insertPicture}><Image /></IconButton>
  {/if}
  <IconButton size="sm" label="Insert formula" onclick={insertMath}><Sigma /></IconButton>
  {#if inTable}
    <span class="table-tools">
      <span class="sep"></span>
      <button class="tt" onclick={() => editor.chain().focus().addRowAfter().run()} title="Add row"><Rows3 size={14} /> +</button>
      <button class="tt" onclick={() => editor.chain().focus().deleteRow().run()} title="Remove row"><Rows3 size={14} /> −</button>
      <button class="tt" onclick={() => editor.chain().focus().addColumnAfter().run()} title="Add column"><Columns3 size={14} /> +</button>
      <button class="tt" onclick={() => editor.chain().focus().deleteColumn().run()} title="Remove column"><Columns3 size={14} /> −</button>
      <button class="tt" onclick={() => (colorOpen = colorOpen === 'cell' ? null : 'cell')} title="Cell color">Cell color</button>
      <button class="tt" onclick={() => editor.chain().focus().toggleHeaderRow().run()} title="Header row">Header</button>
      <IconButton size="sm" label="Delete table" onclick={() => editor.chain().focus().deleteTable().run()}><Trash2 /></IconButton>
    </span>
  {/if}
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    padding: 6px 8px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .sep {
    width: 1px;
    height: 18px;
    background: var(--line);
    margin: 0 5px;
  }
  select {
    height: 28px;
    border: 1px solid var(--line);
    border-radius: 2px;
    background: var(--panel);
    padding: 0 6px;
    font-size: 12.5px;
  }
  .style {
    width: 104px;
  }
  .size {
    width: 70px;
  }
  .pop-root {
    position: relative;
    display: inline-flex;
    gap: 2px;
  }
  .colors {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 30;
    display: grid;
    grid-template-columns: repeat(6, 22px);
    gap: 5px;
    padding: 8px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 2px;
    box-shadow: var(--shadow-lg);
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 2px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    padding: 0;
  }
  .swatch.none {
    background: linear-gradient(135deg, transparent 45%, var(--danger) 45%, var(--danger) 55%, transparent 55%), var(--panel);
  }
  .table-tools {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-wrap: wrap;
  }
  .tt {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 26px;
    border: 1px solid var(--line);
    border-radius: 2px;
    background: var(--panel);
    font-size: 12px;
    padding: 0 7px;
    color: var(--dim);
  }
  .tt:hover {
    color: var(--text);
    background: var(--hover);
  }
</style>
