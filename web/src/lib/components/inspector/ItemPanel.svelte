<script lang="ts">
  import type { ImageAdjust, ImageItem, ImageQuality, Item, ShapeItem, TextItem } from '../../../model/types.ts';
  import { FAMILY_LABELS } from '../../../pack/fonts.ts';
  import ColorInput from '../../ui/ColorInput.svelte';
  import Field from '../../ui/Field.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import Slider from '../../ui/Slider.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import { updateItem } from '../../state/items.ts';
  import { store } from '../../state/project.svelte.ts';
  import PictureSettings from './PictureSettings.svelte';

  const section = $derived(store.section);
  const items = $derived(store.selectedItems);
  const item = $derived(items.length === 1 ? items[0] : undefined);
  const galleryImage = $derived(
    section?.mode === 'gallery' ? section.images.find((i) => i.id === store.selection.items[0]) : undefined,
  );
  const picture = $derived(store.focusPicture);

  const set = (patch: Partial<Item>, key = 'item') => item && updateItem(item.id, patch, `${key}:${item.id}`);

  function setGallery(patch: { adjust?: ImageAdjust; quality?: ImageQuality; caption?: string }, key: string) {
    const id = galleryImage?.id;
    const sid = section?.id;
    store.edit((p) => {
      const s = p.sections.find((x) => x.id === sid);
      if (s?.mode !== 'gallery') return;
      const img = s.images.find((i) => i.id === id);
      if (img) Object.assign(img, patch);
    }, `gallery:${id}:${key}`);
  }

  const num = (v: string) => Math.round(Number(v) || 0);
  const sections = $derived(store.project?.sections ?? []);
</script>

<div class="panel">
  {#if picture}
    <h3>Picture</h3>
    <Field label="Width">
      <Slider value={Number(picture.attrs.width ?? 100)} min={10} max={100} unit="%" oninput={(width) => picture.apply({ width })} />
    </Field>
    <Field label="Alignment">
      <Segmented
        value={String(picture.attrs.align ?? 'center')}
        small
        options={[
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Center' },
          { value: 'right', label: 'Right' },
        ]}
        onchange={(align) => picture.apply({ align })}
      />
    </Field>
    <Field label="Caption">
      <input class="text" value={String(picture.attrs.caption ?? '')} oninput={(e) => picture.apply({ caption: (e.currentTarget as HTMLInputElement).value })} />
    </Field>
    <PictureSettings
      adjust={picture.attrs.adjust as ImageAdjust | undefined}
      quality={picture.attrs.quality as ImageQuality | undefined}
      onchange={(patch) => picture.apply(patch)}
    />
  {:else if galleryImage}
    <h3>Picture</h3>
    <Field label="Caption">
      <input class="text" value={galleryImage.caption ?? ''} oninput={(e) => setGallery({ caption: (e.currentTarget as HTMLInputElement).value }, 'caption')} />
    </Field>
    <PictureSettings adjust={galleryImage.adjust} quality={galleryImage.quality} onchange={setGallery} />
  {:else if item}
    <h3>{item.type === 'image' ? 'Picture' : item.type === 'text' ? 'Text box' : 'Shape'}</h3>
    <div class="grid4">
      <label>X <input type="number" value={Math.round(item.x)} onchange={(e) => set({ x: num((e.currentTarget as HTMLInputElement).value) }, 'x')} /></label>
      <label>Y <input type="number" value={Math.round(item.y)} onchange={(e) => set({ y: num((e.currentTarget as HTMLInputElement).value) }, 'y')} /></label>
      <label>W <input type="number" value={Math.round(item.w)} onchange={(e) => set({ w: num((e.currentTarget as HTMLInputElement).value) }, 'w')} /></label>
      <label>H <input type="number" value={Math.round(item.h)} onchange={(e) => set({ h: num((e.currentTarget as HTMLInputElement).value) }, 'h')} /></label>
    </div>

    {#if item.type === 'image'}
      {@const img = item as ImageItem}
      <Field label="Fit">
        <Segmented
          value={img.fit}
          small
          options={[
            { value: 'contain', label: 'Fit' },
            { value: 'cover', label: 'Fill' },
            { value: 'fill', label: 'Stretch' },
          ]}
          onchange={(fit) => set({ fit } as Partial<Item>)}
        />
      </Field>
      <Field label="Rounded corners"><Slider value={img.radius} min={0} max={40} oninput={(radius) => set({ radius } as Partial<Item>, 'radius')} /></Field>
      <Field label="Caption">
        <input class="text" value={img.caption ?? ''} oninput={(e) => set({ caption: (e.currentTarget as HTMLInputElement).value } as Partial<Item>, 'caption')} />
      </Field>
      <PictureSettings adjust={img.adjust} quality={img.quality} onchange={(patch, key) => set(patch as Partial<Item>, key)} />
    {:else if item.type === 'text'}
      {@const t = item as TextItem}
      <Field label="Background"><ColorInput value={t.background} allowNone onchange={(background) => set({ background } as Partial<Item>)} /></Field>
      <Field label="Text size"><Slider value={t.fontSize ?? 13} min={8} max={40} unit="px" oninput={(fontSize) => set({ fontSize } as Partial<Item>, 'size')} /></Field>
      <Field label="Font">
        <select class="text" value={t.font ?? ''} onchange={(e) => set({ font: ((e.currentTarget as HTMLSelectElement).value || undefined) as TextItem['font'] } as Partial<Item>)}>
          <option value="">App font</option>
          {#each Object.entries(FAMILY_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
        </select>
      </Field>
      <Field label="Vertical position">
        <Segmented
          value={t.valign}
          small
          options={[
            { value: 'top', label: 'Top' },
            { value: 'middle', label: 'Middle' },
            { value: 'bottom', label: 'Bottom' },
          ]}
          onchange={(valign) => set({ valign } as Partial<Item>)}
        />
      </Field>
      <Field label="Padding"><Slider value={t.padding} min={0} max={24} oninput={(padding) => set({ padding } as Partial<Item>, 'padding')} /></Field>
      <Field label="Rounded corners"><Slider value={t.radius} min={0} max={30} oninput={(radius) => set({ radius } as Partial<Item>, 'radius')} /></Field>
    {:else}
      {@const sh = item as ShapeItem}
      {#if sh.shape === 'rect' || sh.shape === 'ellipse'}
        <Field label="Fill"><ColorInput value={sh.fill} allowNone onchange={(fill) => set({ fill } as Partial<Item>)} /></Field>
      {/if}
      <Field label={sh.shape === 'line' || sh.shape === 'arrow' ? 'Color' : 'Outline'}>
        <ColorInput value={sh.stroke} allowNone={sh.shape === 'rect' || sh.shape === 'ellipse'} onchange={(stroke) => set({ stroke, strokeWidth: sh.strokeWidth || 2 } as Partial<Item>)} />
      </Field>
      <Field label="Line width"><Slider value={sh.strokeWidth} min={0} max={12} oninput={(strokeWidth) => set({ strokeWidth } as Partial<Item>, 'stroke')} /></Field>
      {#if sh.shape === 'rect'}
        <Field label="Rounded corners"><Slider value={sh.radius} min={0} max={40} oninput={(radius) => set({ radius } as Partial<Item>, 'radius')} /></Field>
      {/if}
    {/if}

    {#if section?.mode === 'slides'}
      <Field label="Link (OK opens)">
        <select class="text" value={item.link ?? ''} onchange={(e) => set({ link: (e.currentTarget as HTMLSelectElement).value || undefined })}>
          <option value="">Nothing</option>
          {#each sections.filter((s) => s.id !== section.id) as s (s.id)}<option value={s.id}>{s.title}</option>{/each}
        </select>
      </Field>
    {/if}
    {#if section?.mode === 'canvas'}
      <Field label="Stop" inline>
        <Toggle checked={!!item.stop} onchange={(stop) => set({ stop })} />
      </Field>
    {/if}
    <Field label="Lock" inline>
      <Toggle checked={!!item.locked} onchange={(locked) => set({ locked })} />
    </Field>
  {:else if items.length > 1}
    <h3>{items.length} items selected</h3>

  {/if}
</div>

<style>
  .panel {
    display: grid;
    gap: 14px;
  }
  h3 {
    font-size: 14px;
  }
  .grid4 {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .grid4 label {
    display: grid;
    gap: 3px;
    font-size: 11.5px;
    color: var(--dim);
    font-weight: 600;
  }
  .grid4 input,
  .text {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 2px;
    padding: 5px 7px;
    background: var(--panel);
    font-size: 13px;
    min-width: 0;
  }
  .text:focus,
  .grid4 input:focus {
    border-color: var(--accent);
    outline: none;
  }
</style>
