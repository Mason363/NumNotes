// End-to-end checks of the bundle format against the real viewer (wasm) and
// of the .nwa patching/linking used for installs.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseElf, findSection } from '../nwa/elf.ts';
import { encodeName, makeNwa, NAME_MAGIC } from '../nwa/app.ts';
import { linkNwa, APP_MAGIC } from '../nwa/link.ts';
import { BUNDLE_MAGIC, MODE_DOCUMENT, MODE_NOTES, SCENE_SORTED, writeBundle, type BundleModel, type FontGlyph } from './format.ts';
import { parseStore, STORE_MAGIC } from './store.ts';

const viewerDir = fileURLToPath(new URL('../../../viewer/build/', import.meta.url));
const hasViewer = existsSync(viewerDir + 'viewer.wasm') && existsSync(viewerDir + 'viewer.nwa');

/** A 6x10 font where every glyph is a filled box: enough to see text land. */
function boxFont(chars: string) {
  const glyphs: FontGlyph[] = [...new Set([...chars, ' ', '?'])].map((ch) => ({
    codepoint: ch.codePointAt(0)!,
    advance16: 7 * 16,
    bx: 0,
    by: 9,
    w: ch === ' ' ? 0 : 6,
    h: ch === ' ' ? 0 : 10,
    bitmap: ch === ' ' ? new Uint8Array(0) : new Uint8Array(30).fill(0xff),
  }));
  return { lineHeight: 13, ascent: 10, descent: 3, bpp: 4 as const, glyphs, fallback: 0x3f };
}

function sampleModel(): BundleModel {
  const text = 'Hello Chemistry';
  return {
    settings: {
      appName: 'Test',
      projectId: 1234,
      bg: 0xffff,
      fg: 0,
      accent: 0xfda6,
      accentFg: 0xffff,
      dim: 0x8410,
      panel: 0xffff,
      line: 0xdefb,
      highlight: 0xff00,
      uiFont: 0,
      uiFontBold: 0,
      titleFont: 0,
      start: 1,
      flags: 1 | 8 | 16,
    },
    sections: [
      { title: 'Doc', mode: MODE_DOCUMENT, icon: 1, flags: 1 << 4, firstScene: 0, sceneCount: 1, iconColor: 0x07e0, bg: 0xffff, autoplayDs: 0, zoomMin: 0, zoomMax: 0, zoomStart: 0 },
      { title: 'Notes', mode: MODE_NOTES, icon: 4, flags: 0, firstScene: 1, sceneCount: 0, iconColor: 0xffe0, bg: 0xffff, autoplayDs: 0, zoomMin: 0, zoomMax: 0, zoomStart: 0 },
    ],
    scenes: [
      {
        width: 320,
        height: 600,
        bg: 0xffff,
        flags: SCENE_SORTED,
        prims: [
          { type: 'rect', x: 10, y: 10, w: 100, h: 40, color: 0xf800, alpha: 255, radius: 0, borderColor: 0, borderWidth: 0 },
          { type: 'text', x: 10, y: 60, w: 110, h: 13, font: 0, color: 0x001f, codepoints: [...text].map((c) => c.codePointAt(0)!), spaceExtra16: 0 },
        ],
        items: [{ kind: 4, flags: 1, ref: 0, x: 10, y: 60, w: 100, h: 13, text: 'Hello' }],
      },
    ],
    fonts: [boxFont(text + 'Test Doc Notes abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/%·…')],
    images: [],
    anims: [],
    notes: ['First note\nbody'],
    search: [{ section: 0, scene: 0, x: 10, y: 60, w: 100, h: 13, text }],
  };
}

describe('bundle writer', () => {
  it('writes a header the viewer can find', () => {
    const { data, stats } = writeBundle(sampleModel());
    const view = new DataView(data.buffer);
    expect(view.getUint32(0, true)).toBe(BUNDLE_MAGIC);
    expect(view.getUint32(8, true)).toBe(data.length);
    expect(view.getUint16(44, true)).toBe(2); // sections
    expect(data.length % 4).toBe(0);
    expect(stats.total).toBe(data.length);
  });
});

describe.skipIf(!hasViewer)('viewer (wasm)', () => {
  async function boot(bundle: Uint8Array) {
    const frame = new Uint16Array(320 * 240);
    let exports!: Record<string, CallableFunction> & { memory: WebAssembly.Memory };
    let now = 0;
    const { instance } = await WebAssembly.instantiate(readFileSync(viewerDir + 'viewer.wasm'), {
      env: {
        push_rect: (x: number, y: number, w: number, h: number, ptr: number) => {
          const src = new Uint16Array(exports.memory.buffer, ptr, w * h);
          for (let r = 0; r < h; r++) frame.set(src.subarray(r * w, r * w + w), (y + r) * 320 + x);
        },
        fill_rect: () => {},
        millis: () => now,
        battery: () => 3,
        store_changed: () => {},
      },
    });
    exports = instance.exports as typeof exports;
    const ptr = exports.nn_alloc(bundle.length) as number;
    new Uint8Array(exports.memory.buffer, ptr, bundle.length).set(bundle);
    const store = exports.nn_alloc(65536) as number;
    new Uint8Array(exports.memory.buffer, store, 65536).fill(0xff);
    const ok = exports.nn_boot(ptr, bundle.length, store);
    const send = (ev: number) => {
      now += 50;
      exports.nn_event(ev, now);
      exports.nn_tick(now);
    };
    return { ok, frame, send, exports, storePtr: store };
  }

  it('boots into the first section and draws it', async () => {
    const { ok, frame } = await boot(writeBundle(sampleModel()).data);
    expect(ok).toBe(1);
    // Status bar in the accent color, red rect, blue text.
    expect(frame[5 * 320 + 200]).toBe(0xfda6);
    expect(frame[(20 + 30) * 320 + 50]).toBe(0xf800);
    expect(frame.some((p, i) => p === 0x001f && i > 20 * 320)).toBe(true);
  });

  it('survives every key on every screen it reaches', async () => {
    const { send, exports } = await boot(writeBundle(sampleModel()).data);
    for (let round = 0; round < 3; round++) {
      for (let ev = 0; ev < 216; ev++) if (ev !== 5 && ev !== 6 && ev !== 8) send(ev);
    }
    expect(exports.nn_exited()).toBe(0);
  });

  it('saves notes typed on the calculator', async () => {
    const { send, exports, storePtr } = await boot(writeBundle(sampleModel()).data);
    send(5); // back to the home screen
    send(2); // Notes
    send(4); // open
    send(4); // New note
    send(108 + 18 + 7); // h
    send(108 + 18 + 8); // i
    send(5); // close: saves
    const store = new Uint8Array(exports.memory.buffer, storePtr, 65536).slice();
    expect(new DataView(store.buffer).getUint32(0, true)).toBe(STORE_MAGIC);
    expect(parseStore(store, 1234).notes).toEqual(['First note\nbody', 'hi']);
  });

  it('rejects a corrupt bundle without crashing', async () => {
    const data = writeBundle(sampleModel()).data;
    data[0] ^= 0xff;
    const { ok, send } = await boot(data);
    expect(ok).toBe(0);
    send(4);
  });
});

describe.skipIf(!hasViewer)('app file', () => {
  const viewer = new Uint8Array(readFileSync(viewerDir + 'viewer.nwa'));
  const bundle = writeBundle(sampleModel()).data;
  const icon = new Uint8Array([0x10, 0x00, 0x01, 0x00]);

  it('patches name, icon and content into the .nwa', () => {
    const nwa = makeNwa(viewer, { name: 'Schedule', projectId: 7, icon, bundle });
    const elf = parseElf(nwa);
    expect(findSection(elf, '.rodata.nn_content')!.data).toEqual(bundle);
    expect(findSection(elf, '.rodata.eadk_app_icon')!.data).toEqual(icon);
    const name = findSection(elf, '.rodata.eadk_app_name')!.data;
    expect(new TextDecoder().decode(name.subarray(0, 8))).toBe('Schedule');
    expect(name).toEqual(encodeName('Schedule', 7));
    const marker = new DataView(name.buffer, name.byteOffset);
    expect(marker.getUint32(12, true)).toBe(NAME_MAGIC);
    expect(marker.getUint32(20, true)).toBe(7);
  });

  it('links anywhere with the notes store last', () => {
    const nwa = makeNwa(viewer, { name: 'A', projectId: 1, icon, bundle });
    for (const flashStart of [0x90250000, 0x90400000]) {
      const { image, appSize, symbols } = linkNwa(parseElf(nwa), { flashStart, ramStart: 0x24000000, ramEnd: 0x24030000 });
      const v = new DataView(image.buffer);
      expect(v.getUint32(0, true)).toBe(APP_MAGIC);
      expect(v.getUint32(28, true)).toBe(APP_MAGIC);
      expect(v.getUint32(24, true)).toBe(appSize);
      expect(appSize % 0x10000).toBe(0);
      expect(symbols.get('nn_store')).toBe(flashStart + appSize - 0x10000);
      expect(image.subarray(appSize - 0x10000).every((b) => b === 0xff)).toBe(true);
    }
  });

  it('can grow to fill a bigger slot', () => {
    const nwa = makeNwa(viewer, { name: 'A', projectId: 1, icon, bundle });
    const small = linkNwa(parseElf(nwa), { flashStart: 0x90250000, ramStart: 0x24000000, ramEnd: 0x24030000 });
    const big = linkNwa(parseElf(nwa), { flashStart: 0x90250000, ramStart: 0x24000000, ramEnd: 0x24030000, imageSize: small.appSize + 0x20000 });
    expect(big.appSize).toBe(small.appSize + 0x20000);
    expect(() => linkNwa(parseElf(nwa), { flashStart: 0x90250000, ramStart: 0x24000000, ramEnd: 0x24030000, imageSize: 0x10000 })).toThrow();
  });
});
