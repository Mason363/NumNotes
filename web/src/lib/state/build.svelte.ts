// Rebuilds the app bundle after edits (debounced) for the live preview, and
// produces the final .nwa for downloads and installs.

import { appSize, loadViewer, makeNwa } from '../../nwa/app.ts';
import { encodeNwi, renderIcon } from '../../nwa/icon.ts';
import type { Project } from '../../model/types.ts';
import { buildBundle, themeColors, type AssetProvider, type BuildResult } from '../../pack/build.ts';
import type { MathSource } from '../../pack/layout/context.ts';
import type { AssetMeta, RichNode } from '../../model/types.ts';
import { assets } from './assets.ts';
import { kvGet, kvSet } from './db.ts';
import { store } from './project.svelte.ts';

/** Typical free space for apps; replaced by the real figure once a
 * calculator has been connected. */
export const DEFAULT_CAPACITY = 2 * 1024 * 1024;

class BuildStore {
  building = $state(false);
  progress = $state(0);
  label = $state('');
  error = $state<string | null>(null);
  warnings = $state<string[]>([]);
  stats = $state<BuildResult['stats'] | null>(null);
  /** Flash the app takes when installed from this site. */
  appBytes = $state(0);
  capacity = $state(DEFAULT_CAPACITY);
  capacityKnown = $state(false);
  /** Bumped after every successful build. */
  version = $state(0);
  bundle: Uint8Array | null = null;
  builtRevision = -1;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor() {
    kvGet<number>('capacity').then((c) => {
      if (c) {
        this.capacity = c;
        this.capacityKnown = true;
      }
    });
  }

  setCapacity(bytes: number) {
    this.capacity = bytes;
    this.capacityKnown = true;
    kvSet('capacity', bytes);
  }

  schedule(delay = 350) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), delay);
  }

  async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.buildOnce();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
    if (this.again) {
      this.again = false;
      return this.run();
    }
  }

  private async buildOnce() {
    const project = store.project;
    if (!project) return;
    const revision = store.revision;
    const snapshot = $state.snapshot(project) as Project;
    this.building = true;
    this.error = null;
    try {
      const { provider, math } = await prepareMath(snapshot);
      const result = await buildBundle(snapshot, provider, {
        math,
        onProgress: (f, label) => {
          this.progress = f;
          this.label = label;
        },
      });
      this.bundle = result.bundle;
      this.builtRevision = revision;
      this.stats = result.stats;
      this.warnings = result.warnings;
      try {
        const icon = await iconNwi(snapshot);
        const viewer = await loadViewer();
        this.appBytes = appSize(makeNwa(viewer, { name: snapshot.name, projectId: snapshot.projectId, icon, bundle: result.bundle }));
      } catch {
        this.appBytes = Math.ceil((result.bundle.length + 48 * 1024) / 65536) * 65536 + 65536;
      }
      this.version++;
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.building = false;
    }
  }

  /** Waits for a bundle that includes every edit so far. */
  async fresh(): Promise<Uint8Array> {
    if (!this.bundle || this.builtRevision !== store.revision) await this.run();
    if (!this.bundle) throw new Error(this.error ?? 'Nothing to build yet');
    return this.bundle;
  }

  /** The finished app as a standalone .nwa file. */
  async nwa(): Promise<Uint8Array> {
    const project = store.project!;
    const bundle = await this.fresh();
    const snapshot = $state.snapshot(project) as Project;
    return makeNwa(await loadViewer(), { name: snapshot.name, projectId: snapshot.projectId, icon: await iconNwi(snapshot), bundle });
  }
}

const mathCache = new Map<string, Promise<{ meta: AssetMeta; bitmap: ImageBitmap } | null>>();

/** Renders every formula in the project to a picture the builder can use. */
async function prepareMath(project: Project): Promise<{ provider: AssetProvider; math?: MathSource }> {
  const formulas = new Set<string>();
  const walk = (n: RichNode | undefined) => {
    if (!n) return;
    if (n.type === 'mathBlock' && typeof n.attrs?.latex === 'string' && n.attrs.latex.trim()) formulas.add(n.attrs.latex);
    n.content?.forEach(walk);
  };
  for (const s of project.sections) {
    if (s.mode === 'document') walk(s.doc);
    const items = s.mode === 'slides' ? s.slides.flatMap((x) => x.items) : s.mode === 'canvas' ? s.items : [];
    for (const it of items) if (it.type === 'text') walk(it.doc);
  }
  if (!formulas.size) return { provider: assets };
  const color = themeColors(project.theme).fg;
  const rendered = new Map<string, { meta: AssetMeta; bitmap: ImageBitmap }>();
  const { mathBitmap } = await import('../doc/math.ts');
  for (const latex of formulas) {
    const key = `${color}|${latex}`;
    let p = mathCache.get(key);
    if (!p) {
      // Twice the size it's shown at, so zooming in stays sharp.
      p = mathBitmap(latex, 30, color).then((bitmap) =>
        bitmap
          ? {
              bitmap,
              meta: { id: `math:${key}`, kind: 'image' as const, name: latex, width: Math.ceil(bitmap.width / 2), height: Math.ceil(bitmap.height / 2), hasAlpha: false, bytes: 0 },
            }
          : null,
      );
      mathCache.set(key, p);
    }
    const r = await p;
    if (r) rendered.set(latex, r);
  }
  const byId = new Map([...rendered.values()].map((r) => [r.meta.id, r]));
  const provider: AssetProvider = {
    meta: (id) => byId.get(id)?.meta ?? assets.meta(id),
    bitmap: (id) => (byId.has(id) ? Promise.resolve(byId.get(id)!.bitmap) : assets.bitmap(id)),
    frames: (id) => assets.frames(id),
  };
  const math: MathSource = {
    get: (latex) => {
      const r = rendered.get(latex);
      return r ? { asset: r.meta.id, width: r.meta.width, height: r.meta.height } : undefined;
    },
  };
  return { provider, math };
}

export async function iconNwi(project: Project): Promise<Uint8Array> {
  const bitmap = project.icon.kind === 'image' ? await assets.bitmap(project.icon.asset).catch(() => undefined) : undefined;
  return encodeNwi(renderIcon(project.icon, bitmap));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

export const build = new BuildStore();
