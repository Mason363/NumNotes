<script lang="ts">
  import type { Crop, ImageAdjust } from '../../model/types.ts';
  import { assets } from '../state/assets.ts';

  interface Props {
    asset: string;
    crop?: Crop;
    adjust?: Partial<ImageAdjust>;
    fit?: 'contain' | 'cover' | 'fill';
    alt?: string;
  }
  let { asset, crop, adjust, fit = 'contain', alt = '' }: Props = $props();

  // Turned or cropped pictures are rendered once; plain ones use the file.
  const plain = $derived(!crop && !adjust?.rotate && !adjust?.flipX && !adjust?.flipY);
  let rendered = $state<string | undefined>();
  $effect(() => {
    if (plain) return;
    const key = { asset, crop: $state.snapshot(crop), adjust: $state.snapshot(adjust) };
    let cancelled = false;
    assets
      .preview(key.asset, key.crop as Crop | undefined, key.adjust as Partial<ImageAdjust> | undefined)
      .then((url) => {
        if (!cancelled) rendered = url;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });
  const src = $derived(plain ? assets.url(asset) : rendered);

  function filter(a: Partial<ImageAdjust> | undefined): string {
    if (!a) return '';
    const f = [];
    if (a.brightness) f.push(`brightness(${100 + a.brightness}%)`);
    if (a.contrast) f.push(`contrast(${100 + a.contrast}%)`);
    if (a.saturation) f.push(`saturate(${100 + a.saturation}%)`);
    if (a.grayscale) f.push('grayscale(1)');
    if (a.invert) f.push('invert(1)');
    return f.join(' ');
  }
</script>

{#if src}
  <img {src} {alt} draggable="false" style="object-fit: {fit}; filter: {filter(adjust)}" />
{/if}

<style>
  img {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
