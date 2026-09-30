<script lang="ts">
  import type { DocumentSection, RichNode } from '../../../model/types.ts';
  import RichEditor from '../../doc/RichEditor.svelte';
  import { store } from '../../state/project.svelte.ts';
  import { themeColors } from '../../../pack/build.ts';

  let { section }: { section: DocumentSection } = $props();
  const theme = $derived(themeColors(store.project!.theme));
  const bg = $derived(section.background ?? theme.bg);
  // 1.5x on wide screens, smaller on phones so the page fits.
  let boxW = $state(0);
  const pageW = $derived(320 - section.margin * 2);
  const scale = $derived(boxW ? Math.max(0.8, Math.min(1.5, (boxW - 72) / pageW)) : 1.5);

  function onchange(doc: RichNode) {
    const id = section.id;
    store.edit((p) => {
      const s = p.sections.find((x) => x.id === id);
      if (s?.mode === 'document') s.doc = doc;
    }, `doc:${id}`);
  }
</script>

<div class="doc-editor" style="--page-bg: {bg}; --accent: {theme.accent}" bind:clientWidth={boxW}>
  <RichEditor
    doc={section.doc}
    {onchange}
    {scale}
    width={pageW}
    fontSize={section.fontSize}
    font={section.font}
    lineHeight={section.lineHeight}
    color={theme.fg}
    placeholder="Type, paste, or drop pictures and files…"
  />
</div>

<style>
  .doc-editor {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--layout);
  }
  .doc-editor :global(.scroll) {
    padding: 28px 20px 80px;
  }
  .doc-editor :global(.page) {
    background: var(--page-bg);
    box-shadow: 0 2px 12px rgba(38, 44, 80, 0.1);
    border-radius: var(--radius-sm);
    padding: 22px 15px;
    box-sizing: content-box;
    min-height: 60vh;
  }
</style>
