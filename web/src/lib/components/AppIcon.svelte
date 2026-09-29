<script lang="ts">
  import type { IconStyle } from '../../model/types.ts';
  import { renderIcon } from '../../nwa/icon.ts';
  import { assets } from '../state/assets.ts';

  interface Props {
    icon: IconStyle;
    size?: number;
  }
  let { icon, size = 40 }: Props = $props();
  let canvas: HTMLCanvasElement | undefined = $state();

  $effect(() => {
    const style = $state.snapshot(icon) as IconStyle;
    const el = canvas;
    if (!el) return;
    let cancelled = false;
    (async () => {
      const bitmap = style.kind === 'image' ? await assets.bitmap(style.asset).catch(() => undefined) : undefined;
      if (cancelled) return;
      await document.fonts.ready;
      el.getContext('2d')!.putImageData(renderIcon(style, bitmap), 0, 0);
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<canvas bind:this={canvas} width="55" height="56" style="width: {size}px; height: {(size * 56) / 55}px" aria-hidden="true"></canvas>

<style>
  canvas {
    display: block;
    border-radius: 0;
  }
</style>
