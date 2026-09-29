// Reads the notes store sector of an installed app (see viewer/src/store.h).

export const STORE_MAGIC = 0x31534e4e; // "NNS1"
const REC_NOTES = 1;
const REC_PLACE = 2;

export interface StoreContents {
  notes: string[];
  bookmarks: number;
  hasPlace: boolean;
}

function crc32(data: Uint8Array): number {
  let crc = ~0;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}

export function parseStore(sector: Uint8Array, projectId: number): StoreContents {
  const view = new DataView(sector.buffer, sector.byteOffset, sector.byteLength);
  const result: StoreContents = { notes: [], bookmarks: 0, hasPlace: false };
  let at = 0;
  while (at + 16 <= sector.length) {
    if (view.getUint32(at, true) !== STORE_MAGIC) break;
    const type = view.getUint16(at + 4, true);
    const length = view.getUint32(at + 8, true);
    const crc = view.getUint32(at + 12, true);
    if (length > sector.length - at - 16 || length % 4) break;
    const payload = sector.subarray(at + 16, at + 16 + length);
    if (crc32(payload) === crc) {
      const pv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      if (type === REC_NOTES && length >= 12 && pv.getUint32(0, true) === projectId >>> 0) {
        const bookmarks = pv.getUint16(6, true);
        const notesLen = pv.getUint32(8, true);
        const start = 12 + bookmarks * 16;
        const text = new TextDecoder().decode(payload.subarray(start, start + notesLen));
        result.notes = text.split('\0').slice(0, pv.getUint16(4, true));
        result.bookmarks = bookmarks;
      } else if (type === REC_PLACE && pv.getUint32(0, true) === projectId >>> 0) {
        result.hasPlace = true;
      }
    }
    at += 16 + length;
  }
  return result;
}
