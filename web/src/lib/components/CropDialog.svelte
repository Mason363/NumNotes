<script lang="ts">
  import type { Crop, ImageAdjust } from '../../model/types.ts';
  import Button from '../ui/Button.svelte';
  import Modal from '../ui/Modal.svelte';
  import Segmented from '../ui/Segmented.svelte';
  import { assets } from '../state/assets.ts';

  interface Props {
    open: boolean;
    asset: string;
    crop?: Crop;
    adjust?: Partial<ImageAdjust>;
    onapply: (crop: Crop | undefined) => void;
    onclose: () => void;
  }
  let { open, asset, crop, adjust, onapply, onclose }: Props = $props();

  const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };
  const MIN = 0.04;
  const BOX_W = 560;
  const BOX_H = 360;

  let url = $state<string | undefined>();
  let natural = $state({ w: 1, h: 1 });
  let rect = $state<Crop>({ ...FULL });
  let aspect = $state<string>('free');

  // Fresh state each time the dialog opens.
  $effect(() => {
    if (!open) return;
    rect = { ...(crop ?? FULL) };
    aspect = 'free';
    url = undefined;
    const orient = $state.snapshot(adjust) as Partial<ImageAdjust> | undefined;
    assets.preview(asset, undefined, orient, 1400).then(
      (u) => (url = u),
      () => {},
    );
  });

  const scale = $derived(Math.min(BOX_W / natural.w, BOX_H / natural.h));
  const dw = $derived(Math.round(natural.w * scale));
  const dh = $derived(Math.round(natural.h * scale));
  /** Width over height of the crop, in fractions of the picture. */
  const ratio = $derived(aspect === 'free' ? 0 : Number(aspect) * (natural.h / natural.w));
  const pixels = $derived(`${Math.round(rect.w * natural.w)} × ${Math.round(rect.h * natural.h)}`);

  function setAspect(a: string) {
    aspect = a;
    if (a === 'free') return;
    const r = Number(a) * (natural.h / natural.w);
    // Largest box of that shape around the current center.
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    let h = Math.min(1, 1 / r);
    let w = h * r;
    const x = Math.min(Math.max(cx - w / 2, 0), 1 - w);
    const y = Math.min(Math.max(cy - h / 2, 0), 1 - h);
    rect = { x, y, w, h };
  }

  type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
  let drag: { handle: Handle; px: number; py: number; start: Crop } | null = null;

  function down(e: PointerEvent, handle: Handle) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { handle, px: e.clientX, py: e.clientY, start: { ...rect } };
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const dx = (e.clientX - drag.px) / dw;
    const dy = (e.clientY - drag.py) / dh;
    const s = drag.start;
    const h = drag.handle;
    if (h === 'move') {
      rect = { ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) };
      return;
    }
    const dirX = h.includes('e') ? 1 : h.includes('w') ? -1 : 0;
    const dirY = h.includes('s') ? 1 : h.includes('n') ? -1 : 0;
    // The corner or edge opposite the handle stays put.
    const ax = dirX > 0 ? s.x : s.x + s.w;
    const ay = dirY > 0 ? s.y : s.y + s.h;
    const maxW = dirX > 0 ? 1 - ax : dirX < 0 ? ax : 1;
    const maxH = dirY > 0 ? 1 - ay : dirY < 0 ? ay : 1;
    let w = dirX ? clamp(s.w + dirX * dx, MIN, maxW) : s.w;
    let hh = dirY ? clamp(s.h + dirY * dy, MIN, maxH) : s.h;
    if (ratio) {
      hh = Math.max(hh, w / ratio);
      w = hh * ratio;
      if (w > maxW) {
        w = maxW;
        hh = w / ratio;
      }
      if (hh > maxH) {
        hh = maxH;
        w = hh * ratio;
      }
    }
    rect = {
      x: dirX > 0 ? ax : dirX < 0 ? ax - w : s.x,
      y: dirY > 0 ? ay : dirY < 0 ? ay - hh : s.y,
      w,
      h: hh,
    };
  }

  function up() {
    drag = null;
  }

  function clamp(v: number, lo: number, hi: number) {
    return Math.min(Math.max(v, lo), hi);
  }

  function apply() {
    const r = rect;
    const full = r.x < 0.002 && r.y < 0.002 && r.w > 0.996 && r.h > 0.996;
    onapply(full ? undefined : { x: r.x, y: r.y, w: r.w, h: r.h });
    onclose();
  }

  const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
</script>

<Modal title="Crop" {open} {onclose} width={620}>
  <div class="tools">
    <Segmented
      value={aspect}
      small
      options={[
        { value: 'free', label: 'Free' },
        { value: '1', label: 'Square' },
        { value: String(4 / 3), label: 'Screen', title: '4:3, the calculator screen' },
        { value: String(16 / 9), label: 'Wide' },
      ]}
      onchange={setAspect}
    />
    <span class="size">{pixels}</span>
  </div>
  <div class="box">
    {#if url}
      <div class="stage" style="width: {dw}px; height: {dh}px" role="presentation" onpointermove={move} onpointerup={up} onpointercancel={up}>
        <img
          src={url}
          alt=""
          draggable="false"
          onload={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            natural = { w: img.naturalWidth, h: img.naturalHeight };
          }}
        />
        <div
          class="rect"
          style="left: {rect.x * 100}%; top: {rect.y * 100}%; width: {rect.w * 100}%; height: {rect.h * 100}%"
          role="presentation"
          onpointerdown={(e) => down(e, 'move')}
        >
          <span class="third v1"></span><span class="third v2"></span><span class="third h1"></span><span class="third h2"></span>
          {#each HANDLES as h (h)}
            {#if !ratio || h.length === 2}
              <span class="handle {h}" role="presentation" onpointerdown={(e) => down(e, h)}></span>
            {/if}
          {/each}
        </div>
      </div>
    {:else}
      <div class="loading muted small">Loading…</div>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (rect = { ...FULL })}>Reset</Button>
    <span class="grow"></span>
    <Button onclick={onclose}>Cancel</Button>
    <Button variant="primary" onclick={apply}>Apply</Button>
  {/snippet}
</Modal>

<style>
  .tools {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  .tools :global(.seg) {
    width: auto;
    background: var(--layout);
  }
  .size {
    margin-left: auto;
    font-size: 12px;
    font-weight: 700;
    color: var(--label);
    font-variant-numeric: tabular-nums;
  }
  .box {
    display: grid;
    place-items: center;
    min-height: 200px;
    padding: 12px;
    border-radius: var(--radius);
    background: var(--layout);
    background-image: linear-gradient(45deg, var(--card) 25%, transparent 25%, transparent 75%, var(--card) 75%),
      linear-gradient(45deg, var(--card) 25%, transparent 25%, transparent 75%, var(--card) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
  }
  .stage {
    position: relative;
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }
  .stage img {
    width: 100%;
    height: 100%;
    display: block;
  }
  .rect {
    position: absolute;
    outline: 2px solid var(--accent);
    box-shadow: 0 0 0 9999px rgba(20, 22, 36, 0.55);
    cursor: move;
  }
  .third {
    position: absolute;
    background: rgba(255, 255, 255, 0.45);
    pointer-events: none;
  }
  .v1,
  .v2 {
    top: 0;
    bottom: 0;
    width: 1px;
  }
  .v1 {
    left: 33.33%;
  }
  .v2 {
    left: 66.66%;
  }
  .h1,
  .h2 {
    left: 0;
    right: 0;
    height: 1px;
  }
  .h1 {
    top: 33.33%;
  }
  .h2 {
    top: 66.66%;
  }
  .handle {
    position: absolute;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid var(--accent);
  }
  .nw {
    left: 0;
    top: 0;
    cursor: nwse-resize;
  }
  .n {
    left: 50%;
    top: 0;
    cursor: ns-resize;
  }
  .ne {
    left: 100%;
    top: 0;
    cursor: nesw-resize;
  }
  .e {
    left: 100%;
    top: 50%;
    cursor: ew-resize;
  }
  .se {
    left: 100%;
    top: 100%;
    cursor: nwse-resize;
  }
  .s {
    left: 50%;
    top: 100%;
    cursor: ns-resize;
  }
  .sw {
    left: 0;
    top: 100%;
    cursor: nesw-resize;
  }
  .w {
    left: 0;
    top: 50%;
    cursor: ew-resize;
  }
  .loading {
    padding: 40px;
  }
  .grow {
    flex: 1;
  }
</style>
