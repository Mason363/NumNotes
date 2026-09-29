<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { KEY_NAMES, KEYS, Modifiers, PHOTO_ASPECT, PHOTO_URL, SCREEN } from '../../preview/calcPhoto.ts';
  import { ViewerRuntime, eventForKey } from '../../preview/runtime.ts';
  import { build } from '../state/build.svelte.ts';
  import { db } from '../state/db.ts';
  import { store } from '../state/project.svelte.ts';
  import Keypad from './Keypad.svelte';

  let canvas: HTMLCanvasElement | undefined = $state();
  let runtime: ViewerRuntime | null = null;
  let exited = $state(false);
  let ready = $state(false);
  let focused = $state(false);
  let photoFailed = $state(false);
  let pressed = $state<number | null>(null);
  let savedStore: Uint8Array | undefined;
  let storeProject = '';

  const mods = new Modifiers();
  let modState = $state({ shift: false, alpha: false, lock: false });

  async function loadStore(projectId: string) {
    if (storeProject === projectId) return;
    storeProject = projectId;
    savedStore = await (await db()).get('stores', projectId).catch(() => undefined);
  }

  $effect(() => {
    if (!canvas || runtime) return;
    runtime = new ViewerRuntime(canvas, {
      onExit: () => (exited = true),
      onStoreChange: (s) => {
        savedStore = s;
        const id = store.project?.id;
        if (id) db().then((d) => d.put('stores', s, id)).catch(() => {});
      },
    });
  });

  // Reload the app whenever a new bundle is built.
  $effect(() => {
    const version = build.version;
    if (!version || !runtime) return;
    untrack(() => restart());
  });

  async function restart() {
    const bundle = build.bundle;
    const project = store.project;
    if (!bundle || !runtime || !project) return;
    await loadStore(project.id);
    exited = false;
    await runtime.load(bundle, savedStore);
    ready = true;
    showSelection();
  }

  function showSelection() {
    runtime?.goto(store.sectionIndex, store.slideIndex);
  }

  // Follow the section/slide being edited.
  let lastShown = '';
  $effect(() => {
    const key = `${store.sectionIndex}:${store.slideIndex}`;
    if (key === lastShown || !ready) return;
    lastShown = key;
    untrack(showSelection);
  });

  onDestroy(() => runtime?.destroy());

  function send(ev: number) {
    if (exited && ev === 6) return;
    runtime?.send(ev);
  }

  function press(k: number) {
    send(mods.press(k));
    modState = { shift: mods.shift, alpha: mods.alpha, lock: mods.lock };
    pressed = k;
    setTimeout(() => {
      if (pressed === k) pressed = null;
    }, 120);
    canvas?.focus({ preventScroll: true });
  }

  function onKey(e: KeyboardEvent) {
    const ev = eventForKey(e);
    if (ev === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    send(ev);
  }
</script>

<div class="preview">
  {#if !photoFailed}
    <div class="photo" style="aspect-ratio: {PHOTO_ASPECT}">
      <img src={PHOTO_URL} alt="NumWorks calculator" draggable="false" onerror={() => (photoFailed = true)} />
      <div class="screen" class:focused style="left: {SCREEN.x}%; top: {SCREEN.y}%; width: {SCREEN.w}%; height: {SCREEN.h}%">
        {@render screen()}
      </div>
      {#each Object.entries(KEYS) as [k, [x, y, w, h]] (k)}
        {@const key = Number(k)}
        <button
          class="key"
          class:down={pressed === key}
          class:mod={(key === 12 && modState.shift) || (key === 13 && (modState.alpha || modState.lock))}
          style="left: {x}%; top: {y}%; width: {w}%; height: {h}%"
          aria-label={KEY_NAMES[key]}
          title={KEY_NAMES[key]}
          onpointerdown={(e) => {
            e.preventDefault();
            press(key);
          }}
        ></button>
      {/each}
    </div>
  {:else}
    <div class="fallback">
      <div class="fallback-screen">{@render screen()}</div>
      <Keypad {send} />
    </div>
  {/if}
  <p class="caption muted small">Click the screen to type with your keyboard.</p>
  <button class="tool" onclick={restart}>Restart app</button>
</div>

{#snippet screen()}
  <canvas
    bind:this={canvas}
    tabindex="0"
    aria-label="Calculator screen"
    onkeydown={onKey}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
  ></canvas>
  {#if exited}
    <button class="overlay" onclick={restart}>App closed. Click to reopen.</button>
  {:else if !ready}
    <div class="overlay">{build.error ?? 'Building…'}</div>
  {/if}
{/snippet}

<style>
  .preview {
    display: grid;
    justify-items: center;
    gap: 6px;
  }
  .photo {
    position: relative;
    height: calc(100vh - 124px);
    min-height: 420px;
    user-select: none;
  }
  @media (max-width: 900px) {
    .photo {
      height: calc(100vh - 180px);
    }
  }
  .photo img {
    width: 100%;
    height: 100%;
    display: block;
  }
  .screen {
    position: absolute;
    background: #000;
  }
  .screen.focused {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
    outline: none;
    cursor: text;
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.75);
    color: #eee;
    border: none;
    font-size: 12px;
    text-align: center;
    padding: 12px;
  }
  .key {
    position: absolute;
    border: none;
    padding: 0;
    background: transparent;
    border-radius: 40%;
    cursor: pointer;
  }
  .key:hover {
    background: rgba(0, 0, 0, 0.05);
  }
  .key.down {
    background: rgba(0, 0, 0, 0.14);
  }
  .key.mod {
    background: rgba(255, 183, 52, 0.45);
  }
  .fallback {
    width: 350px;
    padding: 14px;
    background: #ececec;
    border: 1px solid #c9c9c9;
    display: grid;
    gap: 14px;
  }
  .fallback-screen {
    position: relative;
    width: 320px;
    height: 240px;
    background: #000;
  }
  .caption {
    text-align: center;
  }
  .tool {
    border: 1px solid var(--line-strong);
    background: var(--panel);
    font-size: 11.5px;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
  }
  .tool:hover {
    background: var(--hover);
  }
</style>
