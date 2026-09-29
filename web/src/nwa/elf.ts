// Minimal ELF32 little-endian reader/writer for ARM relocatable objects
// (NumWorks .nwa apps).

export const SHT_NULL = 0;
export const SHT_PROGBITS = 1;
export const SHT_SYMTAB = 2;
export const SHT_STRTAB = 3;
export const SHT_RELA = 4;
export const SHT_NOBITS = 8;
export const SHT_REL = 9;

export const SHF_WRITE = 0x1;
export const SHF_ALLOC = 0x2;
export const SHF_EXECINSTR = 0x4;

export const SHN_UNDEF = 0;
export const SHN_ABS = 0xfff1;
export const SHN_COMMON = 0xfff2;

export const STB_LOCAL = 0;
export const STB_GLOBAL = 1;
export const STB_WEAK = 2;
export const STT_NOTYPE = 0;
export const STT_OBJECT = 1;
export const STT_FUNC = 2;
export const STT_SECTION = 3;

const EHDR_SIZE = 52;
const SHDR_SIZE = 40;
const SYM_SIZE = 16;

export interface ElfSection {
  index: number;
  name: string;
  nameOffset: number;
  type: number;
  flags: number;
  addr: number;
  offset: number;
  size: number;
  link: number;
  info: number;
  addralign: number;
  entsize: number;
  data: Uint8Array; // empty for SHT_NOBITS
}

export interface ElfSymbol {
  index: number;
  name: string;
  value: number;
  size: number;
  bind: number;
  type: number;
  other: number;
  shndx: number;
}

export interface ElfRelocation {
  offset: number;
  symbol: number;
  type: number;
  addend?: number; // RELA only
}

export interface ElfFile {
  header: Uint8Array; // raw 52-byte header
  type: number;
  machine: number;
  sections: ElfSection[];
  symbols: ElfSymbol[];
  /** Relocations keyed by the index of the section they patch. */
  relocations: Map<number, ElfRelocation[]>;
}

export class ElfError extends Error {}

function cString(bytes: Uint8Array, offset: number): string {
  let end = offset;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(offset, end));
}

export function parseElf(input: Uint8Array): ElfFile {
  // Copy into a plain Uint8Array: Node's Buffer.slice() returns views, which
  // would make the section copies below alias the input.
  const bytes = new Uint8Array(input);
  if (bytes.length < EHDR_SIZE || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
    throw new ElfError('Not an ELF file');
  }
  if (bytes[4] !== 1 || bytes[5] !== 1) throw new ElfError('Only 32-bit little-endian ELF is supported');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = view.getUint16(16, true);
  const machine = view.getUint16(18, true);
  const shoff = view.getUint32(32, true);
  const shentsize = view.getUint16(46, true);
  const shnum = view.getUint16(48, true);
  const shstrndx = view.getUint16(50, true);
  if (shentsize !== SHDR_SIZE || shoff + shnum * SHDR_SIZE > bytes.length) {
    throw new ElfError('Corrupt section header table');
  }

  const sections: ElfSection[] = [];
  for (let i = 0; i < shnum; i++) {
    const at = shoff + i * SHDR_SIZE;
    const s: ElfSection = {
      index: i,
      name: '',
      nameOffset: view.getUint32(at, true),
      type: view.getUint32(at + 4, true),
      flags: view.getUint32(at + 8, true),
      addr: view.getUint32(at + 12, true),
      offset: view.getUint32(at + 16, true),
      size: view.getUint32(at + 20, true),
      link: view.getUint32(at + 24, true),
      info: view.getUint32(at + 28, true),
      addralign: view.getUint32(at + 32, true),
      entsize: view.getUint32(at + 36, true),
      data: new Uint8Array(0),
    };
    if (s.type !== SHT_NOBITS && s.type !== SHT_NULL) {
      if (s.offset + s.size > bytes.length) throw new ElfError(`Section ${i} is out of bounds`);
      s.data = bytes.slice(s.offset, s.offset + s.size);
    }
    sections.push(s);
  }
  const shstr = sections[shstrndx]?.data ?? new Uint8Array(0);
  for (const s of sections) s.name = cString(shstr, s.nameOffset);

  let symbols: ElfSymbol[] = [];
  const symtab = sections.find((s) => s.type === SHT_SYMTAB);
  if (symtab) {
    const strtab = sections[symtab.link]?.data ?? new Uint8Array(0);
    const sv = new DataView(symtab.data.buffer, symtab.data.byteOffset, symtab.data.byteLength);
    symbols = [];
    for (let i = 0; i * SYM_SIZE < symtab.data.length; i++) {
      const at = i * SYM_SIZE;
      const info = sv.getUint8(at + 12);
      symbols.push({
        index: i,
        name: cString(strtab, sv.getUint32(at, true)),
        value: sv.getUint32(at + 4, true),
        size: sv.getUint32(at + 8, true),
        bind: info >> 4,
        type: info & 0xf,
        other: sv.getUint8(at + 13),
        shndx: sv.getUint16(at + 14, true),
      });
    }
  }

  const relocations = new Map<number, ElfRelocation[]>();
  for (const s of sections) {
    if (s.type !== SHT_REL && s.type !== SHT_RELA) continue;
    const rv = new DataView(s.data.buffer, s.data.byteOffset, s.data.byteLength);
    const entry = s.type === SHT_REL ? 8 : 12;
    const list = relocations.get(s.info) ?? [];
    for (let at = 0; at + entry <= s.data.length; at += entry) {
      const info = rv.getUint32(at + 4, true);
      const rel: ElfRelocation = { offset: rv.getUint32(at, true), symbol: info >>> 8, type: info & 0xff };
      if (s.type === SHT_RELA) rel.addend = rv.getInt32(at + 8, true);
      list.push(rel);
    }
    relocations.set(s.info, list);
  }

  return { header: bytes.slice(0, EHDR_SIZE), type, machine, sections, symbols, relocations };
}

export function findSection(elf: ElfFile, name: string): ElfSection | undefined {
  return elf.sections.find((s) => s.name === name);
}

export function findSymbol(elf: ElfFile, name: string): ElfSymbol | undefined {
  return elf.symbols.find((s) => s.name === name && s.bind !== STB_LOCAL) ?? elf.symbols.find((s) => s.name === name);
}

const align = (n: number, a: number) => (a > 1 ? Math.ceil(n / a) * a : n);

/**
 * Rewrites an ELF file with some section contents replaced. Section indices,
 * symbols and relocations are untouched, so this is safe for relocatable
 * objects as long as symbols inside replaced sections stay at the same
 * offsets (here they're all at offset 0).
 */
export function replaceSections(
  bytes: Uint8Array,
  replacements: Record<string, Uint8Array>,
  symbolSizes: Record<string, number> = {},
): Uint8Array {
  const elf = parseElf(bytes);
  for (const name of Object.keys(replacements)) {
    if (!findSection(elf, name)) throw new ElfError(`Missing section ${name}`);
  }
  const symtab = elf.sections.find((s) => s.type === SHT_SYMTAB);
  if (symtab && Object.keys(symbolSizes).length) {
    const data = symtab.data.slice();
    const view = new DataView(data.buffer);
    for (const sym of elf.symbols) {
      if (sym.name in symbolSizes) view.setUint32(sym.index * SYM_SIZE + 8, symbolSizes[sym.name], true);
    }
    symtab.data = data;
  }

  // Lay out section data after the header, then the section header table.
  let cursor = EHDR_SIZE;
  const placed = elf.sections.map((s) => {
    const data = replacements[s.name] ?? s.data;
    const size = s.type === SHT_NOBITS ? s.size : data.length;
    let offset = 0;
    if (s.type !== SHT_NULL && s.type !== SHT_NOBITS) {
      offset = align(cursor, Math.max(4, Math.min(s.addralign || 1, 16)));
      cursor = offset + data.length;
    }
    return { s, data, size, offset };
  });
  const shoff = align(cursor, 4);
  const out = new Uint8Array(shoff + placed.length * SHDR_SIZE);
  const view = new DataView(out.buffer);
  out.set(elf.header, 0);
  view.setUint32(32, shoff, true);
  view.setUint16(48, placed.length, true);
  for (const p of placed) {
    if (p.s.type !== SHT_NOBITS && p.s.type !== SHT_NULL) out.set(p.data, p.offset);
    const at = shoff + p.s.index * SHDR_SIZE;
    view.setUint32(at, p.s.nameOffset, true);
    view.setUint32(at + 4, p.s.type, true);
    view.setUint32(at + 8, p.s.flags, true);
    view.setUint32(at + 12, p.s.addr, true);
    view.setUint32(at + 16, p.offset, true);
    view.setUint32(at + 20, p.size, true);
    view.setUint32(at + 24, p.s.link, true);
    view.setUint32(at + 28, p.s.info, true);
    view.setUint32(at + 32, p.s.addralign, true);
    view.setUint32(at + 36, p.s.entsize, true);
  }
  return out;
}
