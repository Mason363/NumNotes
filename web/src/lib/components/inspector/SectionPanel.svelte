<script lang="ts">
  import type { Section } from '../../../model/types.ts';
  import { ICONS, type IconName } from '../../../pack/format.ts';
  import { FAMILY_LABELS } from '../../../pack/fonts.ts';
  import { SECTION_ICONS } from '../../icons.ts';
  import ColorInput from '../../ui/ColorInput.svelte';
  import Field from '../../ui/Field.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import Slider from '../../ui/Slider.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import { SECTION_COLORS } from '../../state/defaults.ts';
  import { store } from '../../state/project.svelte.ts';

  const section = $derived(store.section);
  const slide = $derived(store.slide);

  function set(fn: (s: Section) => void, key = '') {
    const id = section?.id;
    store.edit((p) => {
      const s = p.sections.find((x) => x.id === id);
      if (s) fn(s);
    }, key ? `${key}:${id}` : '');
  }

  function setSlide(fn: (s: NonNullable<typeof slide>) => void, key = '') {
    const sid = section?.id;
    const slideId = slide?.id;
    store.edit((p) => {
      const s = p.sections.find((x) => x.id === sid);
      if (s?.mode !== 'slides') return;
      const sl = s.slides.find((x) => x.id === slideId);
      if (sl) fn(sl);
    }, key ? `${key}:${slideId}` : '');
  }

  const BOARD_SIZES = [
    { label: 'Small', w: 640, h: 480 },
    { label: 'Medium', w: 960, h: 720 },
    { label: 'Large', w: 1600, h: 1200 },
    { label: 'Huge', w: 2400, h: 1800 },
  ];
</script>

{#if section}
  <div class="panel">
    <Field label="Icon">
      <div class="icons">
        {#each ICONS as name (name)}
          {@const Icon = SECTION_ICONS[name]}
          <button class="ic" class:on={section.icon === name} title={name} aria-label={name} onclick={() => set((s) => (s.icon = name as IconName))} style="--c: {section.iconColor}">
            <Icon size={15} />
          </button>
        {/each}
      </div>
    </Field>
    <Field label="Icon color">
      <ColorInput value={section.iconColor} swatches={SECTION_COLORS} onchange={(c) => c && set((s) => (s.iconColor = c))} />
    </Field>
    <Field label="Home screen subtitle" hint="Empty: “12 slides” etc.">
      <input class="text" value={section.subtitle ?? ''} maxlength="40" oninput={(e) => set((s) => (s.subtitle = (e.currentTarget as HTMLInputElement).value || undefined), 'subtitle')} />
    </Field>
    {#if section.mode !== 'notes'}
      <Field label="Background">
        <ColorInput value={section.background} allowNone swatches={['#ffffff', '#f6efe2', '#fff8e1', '#eef6ff', '#f1f1f4', '#1c1c1f', '#000000', '#10243e']} onchange={(c) => set((s) => (s.background = c))} />
      </Field>
    {/if}
    <Field label="Status bar" inline>
      <Toggle checked={section.statusBar} onchange={(v) => set((s) => (s.statusBar = v))} />
    </Field>
    <Field label="Hide from home screen" inline>
      <Toggle checked={!!section.hidden} onchange={(v) => set((s) => (s.hidden = v))} />
    </Field>

    {#if section.mode === 'slides'}
      <h3>Slideshow</h3>
      <Field label="Autoplay (EXE toggles)" inline>
        <Toggle checked={section.autoplay} onchange={(v) => set((s) => s.mode === 'slides' && (s.autoplay = v))} />
      </Field>
      <Field label="Seconds per slide">
        <Slider value={section.autoplaySeconds} min={1} max={30} unit="s" oninput={(v) => set((s) => s.mode === 'slides' && (s.autoplaySeconds = v), 'autoplay')} />
      </Field>
      <Field label="Loop" inline><Toggle checked={section.loop} onchange={(v) => set((s) => s.mode === 'slides' && (s.loop = v))} /></Field>
      <Field label="Slide transition" inline><Toggle checked={section.transition} onchange={(v) => set((s) => s.mode === 'slides' && (s.transition = v))} /></Field>
      <Field label="Show page number" inline><Toggle checked={section.pageNumbers} onchange={(v) => set((s) => s.mode === 'slides' && (s.pageNumbers = v))} /></Field>
      {#if slide}
        <h3>This slide</h3>
        <Field label="Title (contents)">
          <input class="text" value={slide.title ?? ''} oninput={(e) => setSlide((sl) => (sl.title = (e.currentTarget as HTMLInputElement).value || undefined), 'slide-title')} />
        </Field>
        <Field label="Slide background">
          <ColorInput value={slide.background} allowNone onchange={(c) => setSlide((sl) => (sl.background = c))} />
        </Field>
      {/if}
    {:else if section.mode === 'document'}
      <h3>Text</h3>
      <Field label="Font">
        <select class="text" value={section.font} onchange={(e) => set((s) => s.mode === 'document' && (s.font = (e.currentTarget as HTMLSelectElement).value as typeof s.font))}>
          {#each Object.entries(FAMILY_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
        </select>
      </Field>
      <Field label="Text size"><Slider value={section.fontSize} min={9} max={22} unit="px" oninput={(v) => set((s) => s.mode === 'document' && (s.fontSize = v), 'fontSize')} /></Field>
      <Field label="Line spacing"><Slider value={section.lineHeight} min={1.1} max={1.9} step={0.05} oninput={(v) => set((s) => s.mode === 'document' && (s.lineHeight = v), 'lineHeight')} /></Field>
      <Field label="Margins"><Slider value={section.margin} min={2} max={30} unit="px" oninput={(v) => set((s) => s.mode === 'document' && (s.margin = v), 'margin')} /></Field>
    {:else if section.mode === 'canvas'}
      <h3>Board</h3>
      <Field label="Size">
        <Segmented
          value={BOARD_SIZES.find((b) => b.w === section.width && b.h === section.height)?.label ?? 'Custom'}
          small
          options={[...BOARD_SIZES.map((b) => ({ value: b.label, label: b.label, title: `${b.w} × ${b.h}` }))]}
          onchange={(label) => {
            const b = BOARD_SIZES.find((x) => x.label === label)!;
            set((s) => {
              if (s.mode !== 'canvas') return;
              s.width = b.w;
              s.height = b.h;
            });
          }}
        />
      </Field>
      <div class="grid2">
        <label>Width <input type="number" min="320" max="8000" value={section.width} onchange={(e) => set((s) => s.mode === 'canvas' && (s.width = Math.max(320, Number((e.currentTarget as HTMLInputElement).value) || 320)))} /></label>
        <label>Height <input type="number" min="240" max="8000" value={section.height} onchange={(e) => set((s) => s.mode === 'canvas' && (s.height = Math.max(240, Number((e.currentTarget as HTMLInputElement).value) || 240)))} /></label>
      </div>
      <Field label="Start">
        <Segmented
          value={section.startZoom === 0 ? 'fit' : 'actual'}
          small
          options={[
            { value: 'fit', label: 'Fit all' },
            { value: 'actual', label: 'Actual size' },
          ]}
          onchange={(v) => set((s) => s.mode === 'canvas' && (s.startZoom = v === 'fit' ? 0 : 1))}
        />
      </Field>
      <Field label="Maximum zoom"><Slider value={section.maxZoom} min={1} max={8} step={0.5} unit="×" oninput={(v) => set((s) => s.mode === 'canvas' && (s.maxZoom = v), 'maxZoom')} /></Field>
      <Field label="Minimap" inline><Toggle checked={section.minimap} onchange={(v) => set((s) => s.mode === 'canvas' && (s.minimap = v))} /></Field>
      <p class="muted small">OK jumps between stops. Mark items as stops, or every item is one.</p>
    {:else if section.mode === 'gallery'}
      <h3>Grid</h3>
      <Field label="Columns">
        <Segmented
          value={section.columns}
          small
          options={[
            { value: 2, label: '2' },
            { value: 3, label: '3' },
            { value: 4, label: '4' },
          ]}
          onchange={(v) => set((s) => s.mode === 'gallery' && (s.columns = v))}
        />
      </Field>
      <Field label="Captions in grid" inline><Toggle checked={section.captionsInGrid} onchange={(v) => set((s) => s.mode === 'gallery' && (s.captionsInGrid = v))} /></Field>
      <Field label="Captions full screen" inline><Toggle checked={section.captionsInViewer} onchange={(v) => set((s) => s.mode === 'gallery' && (s.captionsInViewer = v))} /></Field>
    {/if}
  </div>
{/if}

<style>
  .panel {
    display: grid;
    gap: 14px;
  }
  h3 {
    font-size: 13px;
    color: var(--dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 6px;
  }
  .icons {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 5px;
    width: 100%;
  }
  .ic {
    height: 32px;
    border-radius: 2px;
    border: 1px solid var(--line);
    background: var(--panel);
    display: grid;
    place-items: center;
    color: var(--dim);
  }
  .ic.on {
    background: var(--c);
    border-color: var(--c);
    color: #fff;
  }
  .text {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 2px;
    padding: 6px 8px;
    background: var(--panel);
    font-size: 13px;
  }
  .text:focus {
    border-color: var(--accent);
    outline: none;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .grid2 label {
    display: grid;
    gap: 3px;
    font-size: 12px;
    color: var(--dim);
    font-weight: 550;
  }
  .grid2 input {
    border: 1px solid var(--line);
    border-radius: 2px;
    padding: 5px 7px;
    background: var(--panel);
  }
</style>
