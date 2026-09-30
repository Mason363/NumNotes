<script lang="ts">
  import { ChevronRight, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from '@lucide/svelte';
  import type { Crop, ImageAdjust, ImageQuality } from '../../../model/types.ts';
  import { DEFAULT_ADJUST, DEFAULT_QUALITY } from '../../../pack/images.ts';
  import Button from '../../ui/Button.svelte';
  import Field from '../../ui/Field.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import Slider from '../../ui/Slider.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import CropDialog from '../CropDialog.svelte';

  type PicturePatch = { adjust?: ImageAdjust; quality?: ImageQuality; crop?: Crop };

  interface Props {
    asset?: string;
    crop?: Crop;
    adjust?: ImageAdjust;
    quality?: ImageQuality;
    onchange: (patch: PicturePatch, key: string) => void;
  }
  let { asset, crop, adjust, quality, onchange }: Props = $props();
  let cropOpen = $state(false);
  const a = $derived({ ...DEFAULT_ADJUST, ...adjust });
  const q = $derived({ ...DEFAULT_QUALITY, ...quality });
  let showAdjust = $state(false);

  const setA = (patch: Partial<ImageAdjust>, key = 'adjust') => onchange({ adjust: { ...a, ...patch } }, key);
  // Crops are drawn on the turned picture, so turning starts over.
  const turn = (patch: Partial<ImageAdjust>) => onchange({ adjust: { ...a, ...patch }, crop: undefined }, 'turn');
  const setQ = (patch: Partial<ImageQuality>, key = 'quality') => onchange({ quality: { ...q, ...patch } }, key);

  const MODES: Record<ImageQuality['mode'], string> = {
    auto: 'Best format per picture.',
    crisp: 'Sharp edges. Charts, diagrams, screenshots.',
    photo: 'Smaller. Photos.',
    compact: 'Smallest, lower quality.',
  };
</script>

<div class="picture-settings">
  {#if asset}
    <div class="crop-row">
      <Button size="sm" onclick={() => (cropOpen = true)}>Crop</Button>
      {#if crop}<button class="text-link" onclick={() => onchange({ crop: undefined }, 'crop')}>Remove crop</button>{/if}
    </div>
  {/if}
  <Field label="Quality" hint={MODES[q.mode]}>
    <Segmented
      value={q.mode}
      small
      options={[
        { value: 'auto', label: 'Auto' },
        { value: 'crisp', label: 'Crisp' },
        { value: 'photo', label: 'Photo' },
        { value: 'compact', label: 'Compact' },
      ]}
      onchange={(mode) => setQ({ mode })}
    />
  </Field>
  {#if q.mode === 'photo' || q.mode === 'auto'}
    <Field label="Photo detail">
      <Slider value={q.level} min={40} max={95} label="Photo detail" oninput={(level) => setQ({ level }, 'quality-level')} />
    </Field>
  {/if}
  {#if q.mode === 'crisp'}
    <Field label="Colors">
      <Segmented
        value={q.colors}
        small
        options={[
          { value: 16, label: '16' },
          { value: 64, label: '64' },
          { value: 256, label: '256' },
        ]}
        onchange={(colors) => setQ({ colors })}
      />
    </Field>
    <Field label="Smooth gradients (dithering)" inline>
      <Toggle checked={q.dither} onchange={(dither) => setQ({ dither })} />
    </Field>
  {/if}
  <Field label="Zoom detail" hint="Extra resolution for zooming in. Uses space.">
    <Segmented
      value={q.zoomDetail}
      small
      options={[
        { value: 1, label: 'None' },
        { value: 2, label: '2×' },
        { value: 4, label: '4×' },
      ]}
      onchange={(zoomDetail) => setQ({ zoomDetail })}
    />
  </Field>

  <button class="text-link disclosure" onclick={() => (showAdjust = !showAdjust)} aria-expanded={showAdjust}>
    <ChevronRight size={14} strokeWidth={2.5} />Adjust colors and orientation
  </button>
  {#if showAdjust}
    <div class="adjust">
      <div class="orient">
        <IconButton size="sm" label="Rotate left" onclick={() => turn({ rotate: ((a.rotate + 270) % 360) as ImageAdjust['rotate'] })}><RotateCcw /></IconButton>
        <IconButton size="sm" label="Rotate right" onclick={() => turn({ rotate: ((a.rotate + 90) % 360) as ImageAdjust['rotate'] })}><RotateCw /></IconButton>
        <IconButton size="sm" label="Flip horizontally" active={a.flipX} onclick={() => turn({ flipX: !a.flipX })}><FlipHorizontal2 /></IconButton>
        <IconButton size="sm" label="Flip vertically" active={a.flipY} onclick={() => turn({ flipY: !a.flipY })}><FlipVertical2 /></IconButton>
      </div>
      <Field label="Brightness"><Slider value={a.brightness} min={-60} max={60} oninput={(brightness) => setA({ brightness }, 'brightness')} /></Field>
      <Field label="Contrast"><Slider value={a.contrast} min={-60} max={80} oninput={(contrast) => setA({ contrast }, 'contrast')} /></Field>
      <Field label="Saturation"><Slider value={a.saturation} min={-100} max={100} oninput={(saturation) => setA({ saturation }, 'saturation')} /></Field>
      <Field label="Sharpen"><Slider value={a.sharpen} min={0} max={100} oninput={(sharpen) => setA({ sharpen }, 'sharpen')} /></Field>
      <Field label="Black & white" inline><Toggle checked={a.grayscale} onchange={(grayscale) => setA({ grayscale })} /></Field>
      <Field label="Invert colors" inline><Toggle checked={a.invert} onchange={(invert) => setA({ invert })} /></Field>
      <button class="text-link reset" onclick={() => onchange({ adjust: { ...DEFAULT_ADJUST } }, 'reset')}>Reset adjustments</button>
    </div>
  {/if}
</div>

{#if asset}
  <CropDialog open={cropOpen} {asset} {crop} adjust={a} onapply={(c) => onchange({ crop: c }, 'crop')} onclose={() => (cropOpen = false)} />
{/if}

<style>
  .picture-settings,
  .adjust {
    display: grid;
    gap: 16px;
  }
  .orient {
    display: flex;
    gap: 4px;
  }
  .crop-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .orient :global(.icon-btn) {
    background: var(--field);
  }
  .disclosure {
    justify-self: start;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .disclosure :global(svg) {
    transition: transform 0.15s;
  }
  .disclosure[aria-expanded='true'] :global(svg) {
    transform: rotate(90deg);
  }
  .reset {
    justify-self: start;
  }
</style>
