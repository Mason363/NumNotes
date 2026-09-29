// Turns a content bundle into a NumWorks app: patch the name, icon and
// content into viewer.nwa, and (for direct installs) link it in place.

import { replaceSections, parseElf } from './elf.ts';
import { linkNwa, type LinkResult } from './link.ts';

export const NAME_MAGIC = 0x544e4d4e; // "NMNT"
export const NAME_FORMAT_VERSION = 1;
export const MAX_NAME_BYTES = 64;

let viewerNwa: Promise<Uint8Array> | null = null;

/** The prebuilt viewer, served next to the site. */
export function loadViewer(): Promise<Uint8Array> {
  viewerNwa ??= fetch(`${import.meta.env.BASE_URL}viewer/viewer.nwa`).then(async (r) => {
    if (!r.ok) throw new Error(`Couldn't load the calculator app template (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  });
  return viewerNwa;
}

/** Name section: NFKD UTF-8 name, NUL, then the NumNotes marker. */
export function encodeName(name: string, projectId: number): Uint8Array {
  let bytes = new TextEncoder().encode(name.normalize('NFKD'));
  while (bytes.length > MAX_NAME_BYTES) {
    name = [...name].slice(0, -1).join('');
    bytes = new TextEncoder().encode(name.normalize('NFKD'));
  }
  const padded = Math.ceil((bytes.length + 1) / 4) * 4;
  const out = new Uint8Array(padded + 12);
  out.set(bytes, 0);
  const view = new DataView(out.buffer);
  view.setUint32(padded, NAME_MAGIC, true);
  view.setUint32(padded + 4, NAME_FORMAT_VERSION, true);
  view.setUint32(padded + 8, projectId >>> 0, true);
  return out;
}

export interface AppParts {
  name: string;
  projectId: number;
  icon: Uint8Array; // NWI
  bundle: Uint8Array;
}

/** A standalone .nwa for my.numworks.com/apps. */
export function makeNwa(viewer: Uint8Array, parts: AppParts): Uint8Array {
  return replaceSections(
    viewer,
    {
      '.rodata.eadk_app_name': encodeName(parts.name, parts.projectId),
      '.rodata.eadk_app_icon': parts.icon,
      '.rodata.nn_content': parts.bundle,
    },
    { nn_content: parts.bundle.length },
  );
}

export interface InstallTarget {
  flashStart: number;
  ramStart: number;
  ramEnd: number;
  imageSize?: number;
}

/** Links a patched .nwa for a specific spot in the calculator's flash. */
export function linkApp(nwa: Uint8Array, target: InstallTarget): LinkResult {
  return linkNwa(parseElf(nwa), target);
}

/** Flash the app will need, before knowing where it goes. */
export function appSize(nwa: Uint8Array): number {
  return linkNwa(parseElf(nwa), { flashStart: 0x90000000, ramStart: 0x24000000, ramEnd: 0x24040000 }).appSize;
}
