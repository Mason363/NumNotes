// .numnotes project files: a zip with project.json and the assets it uses.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { AssetMeta, Project } from '../../model/types.ts';
import { assets } from './assets.ts';
import { assetIds } from './project.svelte.ts';

interface Manifest {
  format: 'numnotes';
  version: 1;
  project: Project;
  assets: { meta: AssetMeta; blob?: string; type?: string; frames?: { file: string; delayMs: number }[] }[];
}

export async function exportProject(project: Project): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const manifest: Manifest = { format: 'numnotes', version: 1, project: $state.snapshot(project) as Project, assets: [] };
  for (const id of assetIds(project)) {
    const rec = assets.record(id);
    if (!rec) continue;
    const entry: Manifest['assets'][number] = { meta: rec.meta };
    if (rec.blob) {
      entry.blob = `assets/${id}`;
      entry.type = rec.blob.type;
      files[entry.blob] = new Uint8Array(await rec.blob.arrayBuffer());
    }
    if (rec.frames) {
      entry.frames = [];
      for (let i = 0; i < rec.frames.length; i++) {
        const file = `assets/${id}-${i}`;
        files[file] = new Uint8Array(await rec.frames[i].blob.arrayBuffer());
        entry.frames.push({ file, delayMs: rec.frames[i].delayMs });
      }
    }
    manifest.assets.push(entry);
  }
  files['project.json'] = strToU8(JSON.stringify(manifest));
  return new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' });
}

export async function importProjectFile(file: File): Promise<Project> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files['project.json'])) as Manifest;
  if (manifest.format !== 'numnotes') throw new Error('Not a NumNotes project');
  for (const a of manifest.assets) {
    if (assets.meta(a.meta.id)) continue;
    await assets.restore({
      meta: a.meta,
      blob: a.blob ? new Blob([files[a.blob] as BlobPart], { type: a.type }) : undefined,
      frames: a.frames?.map((f) => ({ blob: new Blob([files[f.file] as BlobPart], { type: 'image/png' }), delayMs: f.delayMs })),
    });
  }
  return manifest.project;
}
