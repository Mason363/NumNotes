<script lang="ts">
  import { importFile } from '../../import/index.ts';
  import type { IconStyle } from '../../model/types.ts';
  import Button from '../ui/Button.svelte';
  import Field from '../ui/Field.svelte';
  import Modal from '../ui/Modal.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import Slider from '../ui/Slider.svelte';
  import AppIcon from './AppIcon.svelte';
  import { assets } from '../state/assets.ts';
  import { store } from '../state/project.svelte.ts';

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  const project = $derived(store.project!);
  const icon = $derived(project.icon);

  const COLORS: [string, string][] = [
    ['#ffb734', '#1f1f1f'],
    ['#1f1f1f', '#ffb734'],
    ['#3f6ff5', '#ffffff'],
    ['#2e8b3d', '#ffffff'],
    ['#d8352a', '#ffffff'],
    ['#8e4ec6', '#ffffff'],
    ['#0091c2', '#ffffff'],
    ['#ffffff', '#1f1f1f'],
  ];
  const GLYPHS = ['N', 'Σ', 'π', '∫', 'Δ', 'λ', 'Aa', '#', 'Wk', 'Bio', 'Chem', 'Fr'];

  const set = (next: IconStyle) => store.edit((p) => (p.icon = next), 'icon');
  const glyph = $derived(icon.kind === 'glyph' ? icon : { kind: 'glyph' as const, glyph: 'N', background: '#ffb734', color: '#1f1f1f' });

  function pick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.heic,.heif';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const [item] = await importFile(file);
      if (!item) return;
      const [meta] = await assets.add(item);
      if (!meta) return;
      const side = Math.min(meta.width, meta.height);
      set({ kind: 'image', asset: meta.id, background: '#ffffff', crop: { x: (1 - side / meta.width) / 2, y: (1 - side / meta.height) / 2, w: side / meta.width, h: side / meta.height } });
    };
    input.click();
  }

  function zoomImage(z: number) {
    if (icon.kind !== 'image') return;
    const meta = assets.meta(icon.asset);
    if (!meta) return;
    const side = Math.min(meta.width, meta.height) / z;
    const w = side / meta.width;
    const h = side / meta.height;
    const c = icon.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    set({ ...icon, crop: { x: Math.min(1 - w, Math.max(0, cx - w / 2)), y: Math.min(1 - h, Math.max(0, cy - h / 2)), w, h } });
  }
  const imageZoom = $derived.by(() => {
    if (icon.kind !== 'image') return 1;
    const meta = assets.meta(icon.asset);
    if (!meta || !icon.crop) return 1;
    return Math.min(meta.width, meta.height) / (icon.crop.w * meta.width);
  });

  const APPS = ['Calculation', 'Grapher', 'Equations', 'Statistics', 'Python'];
</script>

<Modal title="App icon" {open} {onclose} width={600}>
  <div class="layout">
    <div class="controls">
      <Segmented
        value={icon.kind}
        options={[
          { value: 'glyph', label: 'Letters' },
          { value: 'image', label: 'Picture' },
        ]}
        onchange={(kind) => {
          if (kind === 'glyph') set(glyph);
          else pick();
        }}
      />
      {#if icon.kind === 'glyph'}
        <Field label="Text (up to 4 characters)">
          <input class="text" value={icon.glyph} maxlength="4" oninput={(e) => set({ ...glyph, glyph: (e.currentTarget as HTMLInputElement).value })} />
        </Field>
        <div class="glyphs">
          {#each GLYPHS as g (g)}
            <button class="g" class:on={icon.glyph === g} onclick={() => set({ ...glyph, glyph: g })}>{g}</button>
          {/each}
        </div>
        <Field label="Colors">
          <div class="gradients">
            {#each COLORS as [bg, fg] (bg)}
              <button
                class="grad"
                class:on={icon.background === bg}
                style="background: {bg}; color: {fg}"
                aria-label="Color {bg}"
                onclick={() => set({ ...glyph, background: bg, color: fg })}>A</button
              >
            {/each}
          </div>
        </Field>
      {:else}
        <Button onclick={pick}>Choose picture…</Button>
        <Field label="Zoom"><Slider value={imageZoom} min={1} max={4} step={0.05} unit="×" oninput={zoomImage} /></Field>
      {/if}
    </div>
    <div class="home" aria-label="Preview on the calculator home screen">
      <div class="bar">Applications</div>
      <div class="grid">
        {#each APPS as name (name)}
          <div class="app"><span class="stub"></span><span>{name}</span></div>
        {/each}
        <div class="app mine"><AppIcon {icon} size={52} /><span>{project.name || 'NumNotes'}</span></div>
      </div>
    </div>
  </div>
</Modal>

<style>
  .layout {
    display: grid;
    grid-template-columns: 1fr 250px;
    gap: 20px;
    align-items: start;
  }
  .controls {
    display: grid;
    gap: 14px;
  }
  .text {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 2px;
    padding: 7px 10px;
    font-size: 16px;
    background: var(--panel);
  }
  .glyphs {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
  }
  .g {
    height: 34px;
    border: 1px solid var(--line);
    background: var(--panel);
    border-radius: 2px;
    font-size: 17px;
  }
  .g.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .gradients {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .grad {
    width: 28px;
    height: 28px;
    border-radius: 2px;
    border: 1px solid rgba(0, 0, 0, 0.2);
    font-weight: 700;
    font-size: 12px;
  }
  .grad.on {
    box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px var(--accent);
  }
  .home {
    background: #fff;
    border-radius: 2px;
    overflow: hidden;
    border: 6px solid #2a2a2e;
    color: #333;
  }
  /* Mock of the calculator's home screen. */
  .bar {
    background: #ffb734;
    color: #fff;
    font-weight: 700;
    font-size: 11px;
    text-align: center;
    padding: 3px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px 6px;
    padding: 12px 8px;
  }
  .app {
    display: grid;
    justify-items: center;
    gap: 4px;
    font-size: 9.5px;
    text-align: center;
  }
  .stub {
    width: 52px;
    height: 53px;
    border-radius: 2px;
    background: #ececf0;
  }
  .mine span {
    font-weight: 700;
  }
  @media (max-width: 600px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
</style>
