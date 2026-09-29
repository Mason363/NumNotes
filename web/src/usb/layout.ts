// DfuSe memory-layout descriptors.
//
// A DfuSe device names each alternate setting with a string describing the
// memory behind it, for example "@Flash/0x90000000/08*004Kg,01*032Kg,127*064Kg":
// a name, then one or more "/<start address>/<sector groups>" pairs. Each group
// is "<count>*<size><multiplier><access>", where the multiplier is empty (or
// 'B'/space) for bytes, 'K' or 'M', and the access letter 'a'..'g' encodes the
// bits readable (1), erasable (2) and writable (4).

export interface MemorySegment {
  /** Address of the first byte. */
  start: number;
  /** Address one past the last byte. */
  end: number;
  sectorSize: number;
  sectorCount: number;
  readable: boolean;
  erasable: boolean;
  writable: boolean;
}

export interface MemoryLayout {
  name: string;
  segments: MemorySegment[];
}

export interface FlashSector {
  start: number;
  size: number;
  segment: MemorySegment;
}

const SECTOR_GROUP = /^(\d+)\*(\d+)\s*([BKM]?)\s*([a-g])$/i;
const ADDRESS = /^0x[0-9a-f]{1,8}$/i;

const MULTIPLIERS: Record<string, number> = { '': 1, B: 1, K: 1024, M: 1024 * 1024 };

/** Parses a DfuSe memory-layout string. Throws a SyntaxError if it is malformed. */
export function parseMemoryLayout(descriptor: string): MemoryLayout {
  const text = descriptor.trim();
  if (!text.startsWith('@')) {
    throw new SyntaxError(`Not a DfuSe memory layout: "${descriptor}"`);
  }
  const parts = text.slice(1).split('/');
  // A name followed by (address, groups) pairs.
  if (parts.length < 3 || parts.length % 2 === 0) {
    throw new SyntaxError(`Malformed DfuSe memory layout: "${descriptor}"`);
  }

  const segments: MemorySegment[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    let address = parseAddress(parts[i], descriptor);
    for (const group of parts[i + 1].split(',')) {
      const segment = parseSectorGroup(group, address, descriptor);
      if (segment.sectorCount > 0) segments.push(segment);
      address = segment.end;
    }
  }
  return { name: parts[0].trim(), segments };
}

/** Like parseMemoryLayout, but returns null instead of throwing. */
export function tryParseMemoryLayout(descriptor: string | null | undefined): MemoryLayout | null {
  if (!descriptor) return null;
  try {
    return parseMemoryLayout(descriptor);
  } catch {
    return null;
  }
}

function parseAddress(text: string, descriptor: string): number {
  const trimmed = text.trim();
  if (!ADDRESS.test(trimmed)) {
    throw new SyntaxError(`Bad address "${trimmed}" in DfuSe memory layout "${descriptor}"`);
  }
  return parseInt(trimmed.slice(2), 16);
}

function parseSectorGroup(text: string, start: number, descriptor: string): MemorySegment {
  const match = SECTOR_GROUP.exec(text.trim());
  if (!match) {
    throw new SyntaxError(`Bad sector group "${text.trim()}" in DfuSe memory layout "${descriptor}"`);
  }
  const sectorCount = parseInt(match[1], 10);
  const sectorSize = parseInt(match[2], 10) * MULTIPLIERS[match[3].toUpperCase()];
  const access = match[4].toLowerCase().charCodeAt(0) - 'a'.charCodeAt(0) + 1;
  return {
    start,
    end: start + sectorCount * sectorSize,
    sectorSize,
    sectorCount,
    readable: (access & 1) !== 0,
    erasable: (access & 2) !== 0,
    writable: (access & 4) !== 0,
  };
}

/** The segment holding `address`, if any. */
export function segmentAt(layout: MemoryLayout, address: number): MemorySegment | undefined {
  return layout.segments.find((segment) => address >= segment.start && address < segment.end);
}

/**
 * Every sector overlapping [start, end), in address order. Throws a RangeError
 * if part of the range isn't described by the layout.
 */
export function sectorsInRange(layout: MemoryLayout, start: number, end: number): FlashSector[] {
  const sectors: FlashSector[] = [];
  if (end <= start) return sectors;

  const segments = [...layout.segments].sort((a, b) => a.start - b.start);
  let cursor = start;
  for (const segment of segments) {
    if (segment.end <= cursor) continue;
    if (segment.start > cursor) break;
    let sectorStart = segment.start + Math.floor((cursor - segment.start) / segment.sectorSize) * segment.sectorSize;
    while (sectorStart < segment.end && sectorStart < end) {
      sectors.push({ start: sectorStart, size: segment.sectorSize, segment });
      sectorStart += segment.sectorSize;
    }
    cursor = sectorStart;
    if (cursor >= end) return sectors;
  }
  throw new RangeError(`${formatAddress(cursor)} is outside the "${layout.name}" memory layout`);
}

/** Formats an address as 0x-prefixed, zero-padded uppercase hex. */
export function formatAddress(address: number): string {
  return `0x${address.toString(16).toUpperCase().padStart(8, '0')}`;
}
