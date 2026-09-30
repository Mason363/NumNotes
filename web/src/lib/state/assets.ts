// Uploaded pictures and animations. Blobs live in IndexedDB; decoded bitmaps
// are cached in memory for the editor and the bundle builder.

import type { Imported } from '../../import/index.ts';
import type { AssetMeta, Crop, ImageAdjust } from '../../model/types.ts';
import type { AssetProvider } from '../../pack/build.ts';
import { DEFAULT_ADJUST, renderSource } from '../../pack/images.ts';
import { db, type StoredAsset } from './db.ts';

const WEB_SAFE = /^image\/(jpeg|png|webp|gif|avif|bmp)$/;

export function newId(prefix = ''): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return prefix + [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

async function bitmapToBlob(bitmap: ImageBitmap, alpha: boolean): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob(alpha ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.94 });
}

export class AssetStore implements AssetProvider {
  private metas = new Map<string, AssetMeta>();
  private records = new Map<string, StoredAsset>();
  private bitmaps = new Map<string, Promise<ImageBitmap>>();
  private frameCache = new Map<string, Promise<{ bitmap: ImageBitmap; delayMs: number }[]>>();
  private urls = new Map<string, string>();
  private previews = new Map<string, Promise<string>>();
  /** Bumped whenever the set of assets changes (for reactive UIs). */
  version = 0;
  onChange?: () => void;

  async load(ids: Iterable<string>): Promise<void> {
    const database = await db().catch(() => null);
    if (!database) return;
    for (const id of ids) {
      if (this.metas.has(id)) continue;
      const rec = await database.get('assets', id);
      if (rec) {
        this.records.set(id, rec);
        this.metas.set(id, rec.meta);
      }
    }
    this.changed();
  }

  private changed() {
    this.version++;
    this.onChange?.();
  }

  meta(id: string): AssetMeta | undefined {
    return this.metas.get(id);
  }

  all(): AssetMeta[] {
    return [...this.metas.values()];
  }

  private async save(rec: StoredAsset) {
    this.records.set(rec.meta.id, rec);
    this.metas.set(rec.meta.id, rec.meta);
    try {
      await (await db()).put('assets', rec, rec.meta.id);
    } catch {
      /* in-memory only */
    }
    this.changed();
  }

  /** Stores an imported picture/animation; PDFs become one picture per page. */
  async add(item: Imported, onProgress?: (f: number) => void): Promise<AssetMeta[]> {
    switch (item.kind) {
      case 'image': {
        const blob = WEB_SAFE.test(item.source.type) ? item.source : await bitmapToBlob(item.bitmap, item.hasAlpha);
        const meta: AssetMeta = { id: newId('a'), kind: 'image', name: item.name, width: item.width, height: item.height, hasAlpha: item.hasAlpha, bytes: blob.size };
        this.bitmaps.set(meta.id, Promise.resolve(item.bitmap));
        await this.save({ meta, blob });
        return [meta];
      }
      case 'animation': {
        const frames = [];
        for (let i = 0; i < item.frames.length; i++) {
          frames.push({ blob: await bitmapToBlob(item.frames[i].bitmap, true), delayMs: item.frames[i].delayMs });
          onProgress?.((i + 1) / item.frames.length);
        }
        const meta: AssetMeta = {
          id: newId('a'),
          kind: 'animation',
          name: item.name,
          width: item.width,
          height: item.height,
          hasAlpha: true,
          frameCount: frames.length,
          bytes: frames.reduce((n, f) => n + f.blob.size, 0),
        };
        this.frameCache.set(meta.id, Promise.resolve(item.frames.map((f) => ({ bitmap: f.bitmap, delayMs: f.delayMs }))));
        await this.save({ meta, blob: frames[0]?.blob, frames });
        return [meta];
      }
      case 'pages': {
        const metas: AssetMeta[] = [];
        for (let i = 0; i < item.pageCount; i++) {
          const bitmap = await item.renderPage(i, 1600);
          const blob = await bitmapToBlob(bitmap, false);
          const meta: AssetMeta = {
            id: newId('a'),
            kind: 'image',
            name: `${item.name}, page ${i + 1}`,
            width: bitmap.width,
            height: bitmap.height,
            hasAlpha: false,
            bytes: blob.size,
          };
          this.bitmaps.set(meta.id, Promise.resolve(bitmap));
          await this.save({ meta, blob });
          metas.push(meta);
          onProgress?.((i + 1) / item.pageCount);
        }
        return metas;
      }
      default:
        return [];
    }
  }

  /** Adds a picture drawn by the site itself (math, icons...). */
  async addBitmap(name: string, bitmap: ImageBitmap, alpha = true): Promise<AssetMeta> {
    const blob = await bitmapToBlob(bitmap, alpha);
    const meta: AssetMeta = { id: newId('a'), kind: 'image', name, width: bitmap.width, height: bitmap.height, hasAlpha: alpha, bytes: blob.size };
    this.bitmaps.set(meta.id, Promise.resolve(bitmap));
    await this.save({ meta, blob });
    return meta;
  }

  bitmap(id: string): Promise<ImageBitmap> {
    let p = this.bitmaps.get(id);
    if (!p) {
      const rec = this.records.get(id);
      if (!rec?.blob) return Promise.reject(new Error('Missing picture'));
      p = createImageBitmap(rec.blob);
      this.bitmaps.set(id, p);
    }
    return p;
  }

  frames(id: string): Promise<{ bitmap: ImageBitmap; delayMs: number }[]> {
    let p = this.frameCache.get(id);
    if (!p) {
      const rec = this.records.get(id);
      if (!rec?.frames) return this.bitmap(id).then((bitmap) => [{ bitmap, delayMs: 100 }]);
      p = Promise.all(rec.frames.map(async (f) => ({ bitmap: await createImageBitmap(f.blob), delayMs: f.delayMs })));
      this.frameCache.set(id, p);
    }
    return p;
  }

  /** Object URL for showing the picture (first frame) in the editor. */
  url(id: string): string | undefined {
    let url = this.urls.get(id);
    if (!url) {
      const blob = this.records.get(id)?.blob;
      if (!blob) return undefined;
      url = URL.createObjectURL(blob);
      this.urls.set(id, url);
    }
    return url;
  }

  /** Object URL of the picture turned and cropped as it will appear, at
   * most `max` pixels on its long side. */
  preview(id: string, crop?: Crop, adjust?: Partial<ImageAdjust>, max = 1200): Promise<string> {
    const orient = { rotate: adjust?.rotate ?? 0, flipX: !!adjust?.flipX, flipY: !!adjust?.flipY };
    const key = JSON.stringify([id, crop ?? null, orient, max]);
    let p = this.previews.get(key);
    if (!p) {
      p = (async () => {
        const bitmap = await this.bitmap(id);
        const turned = orient.rotate === 90 || orient.rotate === 270;
        const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
        const sw = (turned ? bitmap.height : bitmap.width) * c.w;
        const sh = (turned ? bitmap.width : bitmap.height) * c.h;
        const s = Math.min(1, max / Math.max(sw, sh));
        const w = Math.max(1, Math.round(sw * s));
        const h = Math.max(1, Math.round(sh * s));
        const data = renderSource(bitmap, w, h, { crop, adjust: { ...DEFAULT_ADJUST, ...orient } });
        const canvas = new OffscreenCanvas(w, h);
        canvas.getContext('2d')!.putImageData(data, 0, 0);
        return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
      })();
      p.catch(() => this.previews.delete(key));
      this.previews.set(key, p);
    }
    return p;
  }

  blob(id: string): Blob | undefined {
    return this.records.get(id)?.blob;
  }

  record(id: string): StoredAsset | undefined {
    return this.records.get(id);
  }

  /** Imports a record exported from another browser/project file. */
  async restore(rec: StoredAsset): Promise<void> {
    await this.save(rec);
  }
}

export const assets = new AssetStore();
