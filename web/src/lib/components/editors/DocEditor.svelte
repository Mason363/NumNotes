<script lang="ts">
  import type { DocumentSection, RichNode } from '../../../model/types.ts';
  import RichEditor from '../../doc/RichEditor.svelte';
  import { store } from '../../state/project.svelte.ts';
  import { themeColors } from '../../../pack/build.ts';

  let { section }: { section: DocumentSection } = $props();
  const theme = $derived(themeColors(store.project!.theme));
  const bg = $derived(section.background ?? theme.bg);

  function onchange(doc: RichNode) {
    const id = section.id;
    store.edit((p) => {
      const s = p.sections.find((x) => x.id === id);
      if (s?.mode === 'document') s.doc = doc;
    }, `doc:${id}`);
  }
</script>

<div class="doc-editor" style="--page-bg: {bg}; --accent: {theme.accent}">
  <RichEditor
    doc={section.doc}
    {onchange}
    scale={1.5}
    width={320 - section.margin * 2}
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
    background: var(--bg);
  }
  .doc-editor :global(.scroll) {
    padding: 28px 20px 80px;
  }
  .doc-editor :global(.page) {
    background: var(--page-bg);
    box-shadow: none;
    border-radius: 2px;
    padding: 22px 15px;
    box-sizing: content-box;
    min-height: 60vh;
  }
</style>
