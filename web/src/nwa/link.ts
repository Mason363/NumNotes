// Links a NumNotes .nwa (ARM relocatable ELF) at a fixed flash address, the
// same way NumWorks' installer does, so the site can flash apps directly.
// Layout (mirrors the official EADK linker script):
//   32-byte app header, app name, app icon, .text, .rodata (content bundle,
//   then the notes store sector last), .data initializers; .data/.bss in RAM.

import {
  ElfError,
  type ElfFile,
  type ElfSection,
  SHF_ALLOC,
  SHF_EXECINSTR,
  SHF_WRITE,
  SHN_ABS,
  SHN_UNDEF,
  SHT_NOBITS,
  STT_FUNC,
  STT_SECTION,
} from './elf.ts';

export const APP_MAGIC = 0xdec0beba;
export const HEADER_SIZE = 32;
export const SECTOR = 0x10000;
export const STORE_SECTION = '.rodata.nn_store';

const R_ARM_NONE = 0;
const R_ARM_ABS32 = 2;
const R_ARM_REL32 = 3;
const R_ARM_THM_CALL = 10;
const R_ARM_THM_JUMP24 = 30;
const R_ARM_TARGET1 = 38;
const R_ARM_V4BX = 40;
const R_ARM_PREL31 = 42;
const R_ARM_THM_MOVW_ABS_NC = 47;
const R_ARM_THM_MOVT_ABS = 48;
const R_ARM_THM_JUMP19 = 51;

export interface LinkOptions {
  flashStart: number;
  ramStart: number;
  ramEnd: number;
  entry?: string; // defaults to nn_start
  /** Total app size to produce; the gap is filled before the store sector. */
  imageSize?: number;
}

export interface LinkResult {
  /** Bytes to write at flashStart; its length is the app size. */
  image: Uint8Array;
  appSize: number;
  symbols: Map<string, number>;
  ramUsed: number;
  sections: { name: string; address: number; size: number }[];
}

export class LinkError extends ElfError {}

const align = (n: number, a: number) => (a > 1 ? Math.ceil(n / a) * a : n);

interface Placed {
  section: ElfSection;
  address: number; // VMA
  load: number; // LMA (flash); equals address for flash sections
}

function isRodata(name: string) {
  return name === '.rodata' || name.startsWith('.rodata.');
}

function classify(s: ElfSection): 'name' | 'icon' | 'api' | 'text' | 'rodata' | 'data' | 'bss' | 'skip' | 'unknown' {
  if (!(s.flags & SHF_ALLOC)) return 'skip';
  if (s.name === '.rodata.eadk_app_name') return 'name';
  if (s.name === '.rodata.eadk_app_icon') return 'icon';
  if (s.name === '.rodata.eadk_api_level') return 'api';
  if (s.name === '.text' || s.name.startsWith('.text.')) return 'text';
  if (isRodata(s.name)) return 'rodata';
  if (s.name === '.data' || s.name.startsWith('.data.')) return 'data';
  if (s.name === '.bss' || s.name.startsWith('.bss.') || s.type === SHT_NOBITS) return 'bss';
  if ((s.flags & SHF_EXECINSTR) !== 0) return 'text';
  if ((s.flags & SHF_WRITE) === 0) return 'rodata';
  return 'unknown';
}

export function linkNwa(elf: ElfFile, opts: LinkOptions): LinkResult {
  if (elf.machine !== 40) throw new LinkError('Not an ARM object');
  if (opts.flashStart % SECTOR !== 0) throw new LinkError('Apps must start on a 64 KiB boundary');

  const groups: Record<string, ElfSection[]> = { name: [], icon: [], api: [], text: [], rodata: [], data: [], bss: [] };
  for (const s of elf.sections) {
    const kind = classify(s);
    if (kind === 'skip') continue;
    if (kind === 'unknown') throw new LinkError(`Don't know where to put section ${s.name}`);
    groups[kind].push(s);
  }
  // The store sector must end the app.
  const store = groups.rodata.find((s) => s.name === STORE_SECTION);
  if (!store) throw new LinkError('Missing notes store section');
  groups.rodata = groups.rodata.filter((s) => s !== store);
  if (groups.api.length !== 1 || groups.api[0].size !== 4) throw new LinkError('Missing API level');
  if (!groups.name.length || !groups.icon.length) throw new LinkError('Missing app name or icon');

  const placed = new Map<number, Placed>();
  const layout: { name: string; address: number; size: number }[] = [];
  let pc = opts.flashStart + HEADER_SIZE;
  const place = (list: ElfSection[], minAlign = 1) => {
    for (const s of list) {
      pc = align(pc, Math.max(s.addralign || 1, minAlign));
      placed.set(s.index, { section: s, address: pc, load: pc });
      layout.push({ name: s.name, address: pc, size: s.size });
      pc += s.size;
    }
  };
  place(groups.name);
  place(groups.icon);
  pc = align(pc, 4);
  place(groups.text, 4);
  place(groups.rodata);

  // Notes store: last 64 KiB of the app, optionally pushed further out so the
  // app fills a requested slot size.
  let storeAddress = align(pc, SECTOR);
  if (opts.imageSize !== undefined) {
    const requested = opts.flashStart + opts.imageSize - SECTOR;
    if (opts.imageSize % SECTOR !== 0 || requested < storeAddress) {
      throw new LinkError(`App needs ${storeAddress + SECTOR - opts.flashStart} bytes, more than the ${opts.imageSize} requested`);
    }
    storeAddress = requested;
  }
  placed.set(store.index, { section: store, address: storeAddress, load: storeAddress });
  layout.push({ name: store.name, address: storeAddress, size: store.size });
  const appEnd = storeAddress + store.size;

  // RAM: .data (initialized from flash right after the app) then .bss.
  let ram = align(opts.ramStart, 4);
  let lma = appEnd;
  const dataStartRam = ram;
  for (const s of groups.data) {
    ram = align(ram, s.addralign || 1);
    lma = align(lma, s.addralign || 1);
    placed.set(s.index, { section: s, address: ram, load: lma });
    layout.push({ name: s.name, address: ram, size: s.size });
    ram += s.size;
    lma += s.size;
  }
  const dataEndRam = ram;
  if (dataEndRam > dataStartRam) {
    throw new LinkError('The app has initialized globals (.data); they would not fit the app layout');
  }
  ram = align(ram, 4);
  const bssStart = ram;
  for (const s of groups.bss) {
    ram = align(ram, s.addralign || 1);
    placed.set(s.index, { section: s, address: ram, load: 0 });
    layout.push({ name: s.name, address: ram, size: s.size });
    ram += s.size;
  }
  const bssEnd = ram;
  const heapStart = align(ram, 4);
  if (heapStart >= opts.ramEnd) throw new LinkError('The app does not fit in RAM');

  const linkerSymbols = new Map<string, number>([
    ['_eadk_app_end', appEnd],
    ['_data_section_start_flash', appEnd],
    ['_data_section_start_ram', dataStartRam],
    ['_data_section_end_ram', dataEndRam],
    ['_bss_section_start_ram', bssStart],
    ['_bss_section_end_ram', bssEnd],
    ['_heap_start', heapStart],
    ['_heap_end', opts.ramEnd],
  ]);

  const resolve = (index: number): number => {
    const sym = elf.symbols[index];
    if (!sym) throw new LinkError(`Bad symbol index ${index}`);
    if (sym.shndx === SHN_UNDEF) {
      const value = linkerSymbols.get(sym.name);
      if (value === undefined) throw new LinkError(`Undefined symbol ${sym.name}`);
      return value;
    }
    if (sym.shndx === SHN_ABS) return sym.value;
    const target = placed.get(sym.shndx);
    if (!target) throw new LinkError(`Symbol ${sym.name || index} is in an unplaced section`);
    // Thumb function symbols carry bit 0 in their value already.
    return (target.address + sym.value) >>> 0;
  };

  const symbols = new Map<string, number>(linkerSymbols);
  for (const sym of elf.symbols) {
    if (!sym.name || sym.type === STT_SECTION || sym.shndx === SHN_UNDEF) continue;
    if (placed.has(sym.shndx) || sym.shndx === SHN_ABS) symbols.set(sym.name, resolve(sym.index));
  }

  // Apply relocations to copies of section data.
  const contents = new Map<number, Uint8Array>();
  for (const [index, p] of placed) {
    if (p.section.type === SHT_NOBITS) continue;
    const data = p.section.data.slice();
    const relocs = elf.relocations.get(index) ?? [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (const r of relocs) {
      const sym = elf.symbols[r.symbol];
      try {
        applyRelocation(view, r.offset, r.type, resolve(r.symbol), p.address + r.offset, r.addend, sym?.type === STT_FUNC);
      } catch (e) {
        const target = sym?.name || elf.sections[sym?.shndx ?? 0]?.name;
        throw new LinkError(`${(e as Error).message} (${p.section.name}+0x${r.offset.toString(16)} -> ${target})`);
      }
    }
    contents.set(index, data);
  }

  const entryName = opts.entry ?? 'nn_start';
  const entry = symbols.get(entryName);
  if (entry === undefined) throw new LinkError(`Missing entry point ${entryName}`);

  const appSize = appEnd - opts.flashStart;
  const image = new Uint8Array(appSize); // gaps are zero, like objcopy -O binary
  for (const [index, p] of placed) {
    const data = contents.get(index);
    if (data && p.load) image.set(data, p.load - opts.flashStart);
  }
  const header = new DataView(image.buffer, image.byteOffset, HEADER_SIZE);
  const nameAddr = placed.get(groups.name[0].index)!.address;
  const icon = groups.icon[0];
  const iconAddr = placed.get(icon.index)!.address;
  header.setUint32(0, APP_MAGIC, true);
  const api = groups.api[0].data;
  header.setUint32(4, new DataView(api.buffer, api.byteOffset, 4).getUint32(0, true), true);
  header.setUint32(8, nameAddr - opts.flashStart, true);
  header.setUint32(12, icon.size, true);
  header.setUint32(16, iconAddr - opts.flashStart, true);
  header.setUint32(20, ((entry & ~1) - opts.flashStart) >>> 0, true); // Epsilon sets the Thumb bit
  header.setUint32(24, appSize, true);
  header.setUint32(28, APP_MAGIC, true);

  return { image, appSize, symbols, ramUsed: heapStart - opts.ramStart, sections: layout };
}

function readThumbBranch(view: DataView, at: number, type: number): number {
  const hi = view.getUint16(at, true);
  const lo = view.getUint16(at + 2, true);
  if (type === R_ARM_THM_JUMP19) {
    const s = (hi >> 10) & 1;
    const imm6 = hi & 0x3f;
    const j1 = (lo >> 13) & 1;
    const j2 = (lo >> 11) & 1;
    const imm11 = lo & 0x7ff;
    const value = (s << 20) | (j2 << 19) | (j1 << 18) | (imm6 << 12) | (imm11 << 1);
    return (value << 11) >> 11;
  }
  const s = (hi >> 10) & 1;
  const imm10 = hi & 0x3ff;
  const j1 = (lo >> 13) & 1;
  const j2 = (lo >> 11) & 1;
  const imm11 = lo & 0x7ff;
  const i1 = ~(j1 ^ s) & 1;
  const i2 = ~(j2 ^ s) & 1;
  const value = (s << 24) | (i1 << 23) | (i2 << 22) | (imm10 << 12) | (imm11 << 1);
  return (value << 7) >> 7;
}

function writeThumbBranch(view: DataView, at: number, type: number, offset: number) {
  const hi = view.getUint16(at, true);
  const lo = view.getUint16(at + 2, true);
  if (type === R_ARM_THM_JUMP19) {
    if (offset < -(1 << 20) || offset >= 1 << 20) throw new LinkError('Conditional branch out of range');
    const s = (offset >> 20) & 1;
    const j2 = (offset >> 19) & 1;
    const j1 = (offset >> 18) & 1;
    const imm6 = (offset >> 12) & 0x3f;
    const imm11 = (offset >> 1) & 0x7ff;
    view.setUint16(at, (hi & 0xfbc0) | (s << 10) | imm6, true);
    view.setUint16(at + 2, (lo & 0xd000) | (j1 << 13) | (j2 << 11) | imm11, true);
    return;
  }
  if (offset < -(1 << 24) || offset >= 1 << 24) throw new LinkError('Branch out of range');
  const s = (offset >> 24) & 1;
  const i1 = (offset >> 23) & 1;
  const i2 = (offset >> 22) & 1;
  const imm10 = (offset >> 12) & 0x3ff;
  const imm11 = (offset >> 1) & 0x7ff;
  const j1 = (~i1 ^ s) & 1;
  const j2 = (~i2 ^ s) & 1;
  view.setUint16(at, (hi & 0xf800) | (s << 10) | imm10, true);
  view.setUint16(at + 2, (lo & 0xd000) | (j1 << 13) | (j2 << 11) | imm11, true);
}

function readMovw(view: DataView, at: number): number {
  const hi = view.getUint16(at, true);
  const lo = view.getUint16(at + 2, true);
  const imm4 = hi & 0xf;
  const i = (hi >> 10) & 1;
  const imm3 = (lo >> 12) & 7;
  const imm8 = lo & 0xff;
  const value = (imm4 << 12) | (i << 11) | (imm3 << 8) | imm8;
  return (value << 16) >> 16; // addend is signed
}

function writeMovw(view: DataView, at: number, value: number) {
  const hi = view.getUint16(at, true);
  const lo = view.getUint16(at + 2, true);
  const imm4 = (value >> 12) & 0xf;
  const i = (value >> 11) & 1;
  const imm3 = (value >> 8) & 7;
  const imm8 = value & 0xff;
  view.setUint16(at, (hi & 0xfbf0) | (i << 10) | imm4, true);
  view.setUint16(at + 2, (lo & 0x8f00) | (imm3 << 12) | imm8, true);
}

function applyRelocation(
  view: DataView,
  at: number,
  type: number,
  S: number,
  P: number,
  addend: number | undefined,
  isFunc: boolean,
) {
  switch (type) {
    case R_ARM_NONE:
    case R_ARM_V4BX:
      return;
    case R_ARM_ABS32:
    case R_ARM_TARGET1: {
      const A = addend ?? view.getUint32(at, true);
      view.setUint32(at, (S + A) >>> 0, true);
      return;
    }
    case R_ARM_REL32: {
      const A = addend ?? view.getUint32(at, true);
      view.setUint32(at, (S + A - P) >>> 0, true);
      return;
    }
    case R_ARM_PREL31: {
      const word = view.getUint32(at, true);
      const A = addend ?? ((word << 1) >> 1);
      const value = (S + A - P) & 0x7fffffff;
      view.setUint32(at, ((word & 0x80000000) | value) >>> 0, true);
      return;
    }
    case R_ARM_THM_CALL:
    case R_ARM_THM_JUMP24:
    case R_ARM_THM_JUMP19: {
      const A = addend ?? readThumbBranch(view, at, type);
      // Branch targets are Thumb; drop the interworking bit.
      const target = isFunc ? S & ~1 : S;
      writeThumbBranch(view, at, type, (target + A - P) | 0);
      return;
    }
    case R_ARM_THM_MOVW_ABS_NC: {
      const A = addend ?? readMovw(view, at);
      writeMovw(view, at, (S + A) & 0xffff);
      return;
    }
    case R_ARM_THM_MOVT_ABS: {
      const A = addend ?? readMovw(view, at);
      writeMovw(view, at, ((S + A) >>> 16) & 0xffff);
      return;
    }
    default:
      throw new LinkError(`Unsupported relocation type ${type}`);
  }
}
