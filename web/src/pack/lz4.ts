/**
 * LZ4 block format (raw blocks, no frame header), decodable by the reference
 * LZ4_decompress_safe and by the viewer's nn_lz4_decompress (viewer/src/lz4.c).
 *
 * The compressor uses hash chains with one step of lazy matching, which gets
 * close to LZ4HC ratios on image tiles while staying fast for the small
 * blocks the packer produces.
 */

const MIN_MATCH = 4;
/** The last 5 bytes of a block are always literals. */
const LAST_LITERALS = 5;
/** The last match must start at least 12 bytes before the end of the block. */
const MF_LIMIT = 12;
const MAX_OFFSET = 65535;
const HASH_LOG = 15;
/** Chain candidates examined per position: more is slower but smaller. */
const MAX_ATTEMPTS = 64;

/** Worst-case compressed size of `size` input bytes (same as LZ4_compressBound). */
export function lz4CompressBound(size: number): number {
  return size + Math.floor(size / 255) + 16;
}

interface Match {
  length: number;
  offset: number;
}

function hash4(src: Uint8Array, pos: number): number {
  const v = src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16) | (src[pos + 3] << 24);
  return Math.imul(v, 2654435761) >>> (32 - HASH_LOG);
}

/** Finds the longest earlier occurrence of the bytes at a position. */
class MatchFinder {
  private readonly src: Uint8Array;
  private readonly head = new Int32Array(1 << HASH_LOG).fill(-1);
  private readonly chain: Int32Array;
  private inserted = 0;

  constructor(src: Uint8Array) {
    this.src = src;
    this.chain = new Int32Array(src.length);
  }

  /**
   * Stores in `best` the longest match for `pos` that ends at or before
   * `limit`. Positions must be queried in non-decreasing order.
   */
  find(pos: number, limit: number, best: Match): boolean {
    const src = this.src;
    this.insertUpTo(pos);
    const maxLength = limit - pos;
    let bestLength = MIN_MATCH - 1;
    let candidate = this.head[hash4(src, pos)];
    for (let attempts = MAX_ATTEMPTS; candidate >= 0 && attempts > 0; attempts--) {
      const offset = pos - candidate;
      if (offset > MAX_OFFSET) break;
      // Only a candidate that also matches one byte past the current best can beat it.
      if (src[candidate + bestLength] === src[pos + bestLength]) {
        let length = 0;
        while (length < maxLength && src[candidate + length] === src[pos + length]) length++;
        if (length > bestLength) {
          bestLength = length;
          best.offset = offset;
          if (length === maxLength) break;
        }
      }
      candidate = this.chain[candidate];
    }
    this.insertUpTo(pos + 1);
    best.length = bestLength;
    return bestLength >= MIN_MATCH;
  }

  private insertUpTo(end: number): void {
    for (let pos = this.inserted; pos < end; pos++) {
      const h = hash4(this.src, pos);
      this.chain[pos] = this.head[h];
      this.head[h] = pos;
    }
    this.inserted = Math.max(this.inserted, end);
  }
}

/** Writes the extension bytes of a length whose nibble was saturated at 15. */
function writeLength(out: Uint8Array, op: number, length: number): number {
  let rest = length - 15;
  while (rest >= 255) {
    out[op++] = 255;
    rest -= 255;
  }
  out[op++] = rest;
  return op;
}

function writeLiterals(out: Uint8Array, op: number, src: Uint8Array, start: number, count: number): number {
  if (count >= 15) op = writeLength(out, op, count);
  out.set(src.subarray(start, start + count), op);
  return op + count;
}

function writeSequence(
  out: Uint8Array,
  op: number,
  src: Uint8Array,
  literalStart: number,
  literalCount: number,
  match: Match,
): number {
  const extra = match.length - MIN_MATCH;
  out[op++] = (Math.min(literalCount, 15) << 4) | Math.min(extra, 15);
  op = writeLiterals(out, op, src, literalStart, literalCount);
  out[op++] = match.offset & 0xff;
  out[op++] = match.offset >> 8;
  return extra >= 15 ? writeLength(out, op, extra) : op;
}

function writeLastLiterals(out: Uint8Array, op: number, src: Uint8Array, start: number): number {
  const count = src.length - start;
  out[op++] = Math.min(count, 15) << 4;
  return writeLiterals(out, op, src, start, count);
}

/** Compresses `input` into one LZ4 block. */
export function lz4Compress(input: Uint8Array): Uint8Array {
  const n = input.length;
  const out = new Uint8Array(lz4CompressBound(n));
  let op = 0;
  let anchor = 0;

  if (n > MF_LIMIT) {
    const finder = new MatchFinder(input);
    const lastMatchStart = n - MF_LIMIT;
    const matchLimit = n - LAST_LITERALS;
    const match: Match = { length: 0, offset: 0 };
    const next: Match = { length: 0, offset: 0 };
    let ip = 0;
    while (ip <= lastMatchStart) {
      if (!finder.find(ip, matchLimit, match)) {
        ip++;
        continue;
      }
      // Lazy matching: emit a literal instead if the next position matches longer.
      while (ip < lastMatchStart && finder.find(ip + 1, matchLimit, next) && next.length > match.length) {
        ip++;
        match.length = next.length;
        match.offset = next.offset;
      }
      op = writeSequence(out, op, input, anchor, ip - anchor, match);
      ip += match.length;
      anchor = ip;
    }
  }

  op = writeLastLiterals(out, op, input, anchor);
  return out.slice(0, op);
}

function malformed(): Error {
  return new Error('lz4: malformed block');
}

/**
 * Decompresses one LZ4 block that must expand to exactly `outputSize` bytes.
 * Throws on malformed input.
 */
export function lz4Decompress(input: Uint8Array, outputSize: number): Uint8Array {
  const out = new Uint8Array(outputSize);
  const end = input.length;
  let ip = 0;
  let op = 0;

  const readLength = (length: number): number => {
    let b: number;
    do {
      if (ip >= end) throw malformed();
      b = input[ip++];
      length += b;
    } while (b === 255);
    return length;
  };

  for (;;) {
    if (ip >= end) throw malformed();
    const token = input[ip++];

    let literals = token >> 4;
    if (literals === 15) literals = readLength(literals);
    if (literals > end - ip || literals > outputSize - op) throw malformed();
    out.set(input.subarray(ip, ip + literals), op);
    ip += literals;
    op += literals;
    if (ip === end) break;

    if (end - ip < 2) throw malformed();
    const offset = input[ip] | (input[ip + 1] << 8);
    ip += 2;
    if (offset === 0 || offset > op) throw malformed();

    let length = token & 15;
    if (length === 15) length = readLength(length);
    length += MIN_MATCH;
    if (length > outputSize - op) throw malformed();
    if (offset >= length) {
      out.copyWithin(op, op - offset, op - offset + length);
      op += length;
    } else {
      for (let i = 0; i < length; i++, op++) out[op] = out[op - offset];
    }
  }

  if (op !== outputSize) throw new Error(`lz4: expected ${outputSize} bytes, got ${op}`);
  return out;
}
