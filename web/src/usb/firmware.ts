// Binary structures Epsilon (16+) exposes in memory: the slot info in SRAM,
// the kernel and userland headers in flash, and the chain of installed
// third-party apps. All little-endian.

import type { InstalledApp } from './calculator';
import { CalculatorError, FIRMWARE_TOO_OLD_MESSAGE } from './errors';
import { decodeNwi } from './nwi';

// Magics as the firmware's own C++ constants, read as little-endian u32s.
// (Epsilon's README writes the slot info magic byte-wise, as BADBEEEF.)
export const SLOT_INFO_MAGIC = 0xefeedbba;
export const KERNEL_HEADER_MAGIC = 0xdec00df0;
export const USERLAND_HEADER_MAGIC = 0xdec0edfe;
export const APP_MAGIC = 0xdec0beba;
/** "NMNT" as bytes. */
export const NUMNOTES_MAGIC = 0x544e4d4e;

export const SLOT_INFO_SIZE = 16;
export const KERNEL_HEADER_SIZE = 24;
export const USERLAND_HEADER_SIZE = 48;
export const APP_HEADER_SIZE = 32;
/** Apps start on 64 KiB boundaries. */
export const APP_ALIGNMENT = 0x10000;
/** A NumNotes app keeps on-calculator notes in its last 64 KiB. */
export const NOTES_STORE_SIZE = 0x10000;

const NAME_READ_SIZE = 256;
const NUMNOTES_MARKER_SIZE = 12;
const MAX_ICON_SIZE = 0x4000;

export type MemoryReader = (address: number, length: number) => Promise<Uint8Array>;

export interface SlotInfo {
  kernelHeaderAddress: number;
  userlandHeaderAddress: number;
}

export interface KernelHeader {
  version: string;
  patch: string;
}

export interface UserlandHeader {
  expectedVersion: string;
  storageAddress?: number;
  storageSize?: number;
  externalAppsFlashStart?: number;
  externalAppsFlashEnd?: number;
  externalAppsRamStart?: number;
  externalAppsRamEnd?: number;
  deviceNameFlashStart?: number;
  deviceNameFlashEnd?: number;
}

/** Userland header fields after the version, in memory order. Older firmware stops early. */
const USERLAND_FIELDS = [
  'storageAddress',
  'storageSize',
  'externalAppsFlashStart',
  'externalAppsFlashEnd',
  'externalAppsRamStart',
  'externalAppsRamEnd',
  'deviceNameFlashStart',
  'deviceNameFlashEnd',
] as const;

export interface AppHeader {
  apiLevel: number;
  nameOffset: number;
  iconSize: number;
  iconOffset: number;
  entryPointOffset: number;
  /** Bytes from the app start. */
  size: number;
}

export interface AppName {
  name: string;
  numnotes?: { formatVersion: number; projectId: number };
}

export interface FirmwareInfo {
  firmwareVersion: string;
  firmwarePatch?: string;
  externalAppsFlashStart: number;
  externalAppsFlashEnd: number;
  externalAppsRamStart?: number;
  externalAppsRamEnd?: number;
  storageAddress?: number;
  storageSize?: number;
}

export function parseSlotInfo(bytes: Uint8Array): SlotInfo | null {
  if (bytes.length < SLOT_INFO_SIZE) return null;
  const view = viewOf(bytes);
  if (view.getUint32(0, true) !== SLOT_INFO_MAGIC || view.getUint32(12, true) !== SLOT_INFO_MAGIC) return null;
  return { kernelHeaderAddress: view.getUint32(4, true), userlandHeaderAddress: view.getUint32(8, true) };
}

export function parseKernelHeader(bytes: Uint8Array): KernelHeader | null {
  if (bytes.length < KERNEL_HEADER_SIZE) return null;
  const view = viewOf(bytes);
  if (view.getUint32(0, true) !== KERNEL_HEADER_MAGIC || view.getUint32(20, true) !== KERNEL_HEADER_MAGIC) return null;
  return { version: readCString(bytes, 4, 8), patch: readCString(bytes, 12, 8) };
}

/**
 * Parses the userland header. The closing magic follows the last field the
 * firmware knows about, so fields missing from older firmware are undefined.
 */
export function parseUserlandHeader(bytes: Uint8Array): UserlandHeader | null {
  if (bytes.length < 16) return null;
  const view = viewOf(bytes);
  if (view.getUint32(0, true) !== USERLAND_HEADER_MAGIC) return null;
  const header: UserlandHeader = { expectedVersion: readCString(bytes, 4, 8) };
  let offset = 12;
  for (const field of USERLAND_FIELDS) {
    if (offset + 4 > bytes.length) return null;
    const value = view.getUint32(offset, true);
    if (value === USERLAND_HEADER_MAGIC) return header;
    header[field] = value;
    offset += 4;
  }
  // Newer firmware may append fields after the ones we know.
  return header;
}

export function parseAppHeader(bytes: Uint8Array): AppHeader | null {
  if (bytes.length < APP_HEADER_SIZE) return null;
  const view = viewOf(bytes);
  if (view.getUint32(0, true) !== APP_MAGIC || view.getUint32(28, true) !== APP_MAGIC) return null;
  return {
    apiLevel: view.getUint32(4, true),
    nameOffset: view.getUint32(8, true),
    iconSize: view.getUint32(12, true),
    iconOffset: view.getUint32(16, true),
    entryPointOffset: view.getUint32(20, true),
    size: view.getUint32(24, true),
  };
}

/**
 * Parses an app name (NUL-terminated UTF-8) and the NumNotes marker that may
 * follow it: after the NUL, at the next 4-byte boundary relative to the name
 * start, u32 "NMNT", u32 format version, u32 project id.
 */
export function parseAppName(bytes: Uint8Array): AppName {
  const nul = bytes.indexOf(0);
  const name = new TextDecoder().decode(bytes.subarray(0, nul < 0 ? bytes.length : nul));
  if (nul < 0) return { name };
  const markerOffset = alignTo4(nul + 1);
  if (markerOffset + NUMNOTES_MARKER_SIZE > bytes.length) return { name };
  const view = viewOf(bytes);
  if (view.getUint32(markerOffset, true) !== NUMNOTES_MAGIC) return { name };
  return {
    name,
    numnotes: {
      formatVersion: view.getUint32(markerOffset + 4, true),
      projectId: view.getUint32(markerOffset + 8, true),
    },
  };
}

export function roundUpToAppAlignment(size: number): number {
  return Math.ceil(size / APP_ALIGNMENT) * APP_ALIGNMENT;
}

/** Where a userland header can sit: 64 KiB into a 4 MiB slot (128 KiB with
 * extra data), possibly after an 8-byte signature prefix. */
export const USERLAND_HEADER_CANDIDATES = [0x90000000, 0x90400000].flatMap((slot) =>
  [0x10000, 0x10008, 0x20000, 0x20008].map((offset) => slot + offset),
);

const FLASH_START = 0x90000000;
const FLASH_END = 0x90800000;
const inFlash = (address: number) => address >= FLASH_START && address < FLASH_END;

/**
 * Reads the slot info from SRAM, then the userland header (and the kernel
 * header, when the slot info points to it) from flash. Current firmware only
 * fills in the userland header address.
 */
export async function readFirmwareInfo(
  readRam: MemoryReader,
  readFlash: MemoryReader,
  sramStart: number,
): Promise<FirmwareInfo> {
  const slot = parseSlotInfo(await readRam(sramStart, SLOT_INFO_SIZE));
  let userland: UserlandHeader | null = null;
  if (slot && inFlash(slot.userlandHeaderAddress)) {
    userland = parseUserlandHeader(await readFlash(slot.userlandHeaderAddress, USERLAND_HEADER_SIZE));
  }
  if (!userland) {
    // No usable slot info: accept the userland header only if exactly one slot has one.
    const found: UserlandHeader[] = [];
    for (const address of USERLAND_HEADER_CANDIDATES) {
      const header = parseUserlandHeader(await readFlash(address, USERLAND_HEADER_SIZE));
      if (header?.externalAppsFlashStart !== undefined) found.push(header);
    }
    if (found.length === 1) userland = found[0];
  }
  if (!userland) throw new CalculatorError('unsupported-firmware', FIRMWARE_TOO_OLD_MESSAGE);
  let kernel: KernelHeader | null = null;
  if (slot && inFlash(slot.kernelHeaderAddress)) {
    kernel = parseKernelHeader(await readFlash(slot.kernelHeaderAddress, KERNEL_HEADER_SIZE));
  }

  const { externalAppsFlashStart, externalAppsFlashEnd } = userland;
  if (
    externalAppsFlashStart === undefined ||
    externalAppsFlashEnd === undefined ||
    externalAppsFlashEnd <= externalAppsFlashStart
  ) {
    throw new CalculatorError(
      'unsupported-firmware',
      'This firmware doesn’t support apps. Update it at numworks.com/update',
    );
  }
  return {
    firmwareVersion: kernel?.version || userland.expectedVersion,
    firmwarePatch: kernel?.patch || undefined,
    externalAppsFlashStart,
    externalAppsFlashEnd,
    externalAppsRamStart: userland.externalAppsRamStart,
    externalAppsRamEnd: userland.externalAppsRamEnd,
    storageAddress: userland.storageAddress,
    storageSize: userland.storageSize,
  };
}

/**
 * Walks the chain of installed apps in [start, end). Each app starts with a
 * header; the next one begins at the following 64 KiB boundary after it. The
 * chain ends at the first address without an app header.
 */
export async function readAppChain(readFlash: MemoryReader, start: number, end: number): Promise<InstalledApp[]> {
  const apps: InstalledApp[] = [];
  let address = start;
  while (address + APP_HEADER_SIZE <= end) {
    const header = parseAppHeader(await readFlash(address, APP_HEADER_SIZE));
    if (!header || header.size < APP_HEADER_SIZE || address + header.size > end) break;
    apps.push(await describeApp(readFlash, address, header));
    address += roundUpToAppAlignment(header.size);
  }
  return apps;
}

async function describeApp(readFlash: MemoryReader, address: number, header: AppHeader): Promise<InstalledApp> {
  const appEnd = address + header.size;
  const { name, numnotes } = await readAppName(readFlash, address + header.nameOffset, appEnd);
  const app: InstalledApp = {
    address,
    size: roundUpToAppAlignment(header.size),
    rawSize: header.size,
    name,
    apiLevel: header.apiLevel,
    iconRgba: await readIcon(readFlash, address, header),
  };
  if (numnotes && header.size > NOTES_STORE_SIZE) {
    app.numnotes = { ...numnotes, storeAddress: appEnd - NOTES_STORE_SIZE };
  }
  return app;
}

async function readAppName(readFlash: MemoryReader, nameAddress: number, appEnd: number): Promise<AppName> {
  if (nameAddress >= appEnd) return { name: '' };
  let bytes = await readFlash(nameAddress, Math.min(NAME_READ_SIZE, appEnd - nameAddress));
  const nul = bytes.indexOf(0);
  if (nul >= 0) {
    const markerEnd = alignTo4(nul + 1) + NUMNOTES_MARKER_SIZE;
    if (markerEnd > bytes.length && nameAddress + markerEnd <= appEnd) {
      bytes = await readFlash(nameAddress, markerEnd);
    }
  }
  return parseAppName(bytes);
}

async function readIcon(
  readFlash: MemoryReader,
  address: number,
  header: AppHeader,
): Promise<Uint8ClampedArray | undefined> {
  const { iconOffset, iconSize } = header;
  if (iconSize === 0 || iconSize > MAX_ICON_SIZE || iconOffset + iconSize > header.size) return undefined;
  const compressed = await readFlash(address + iconOffset, iconSize);
  try {
    return decodeNwi(compressed);
  } catch {
    return undefined;
  }
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readCString(bytes: Uint8Array, offset: number, maxLength: number): string {
  const field = bytes.subarray(offset, offset + maxLength);
  const nul = field.indexOf(0);
  return new TextDecoder().decode(nul < 0 ? field : field.subarray(0, nul));
}

function alignTo4(value: number): number {
  return Math.ceil(value / 4) * 4;
}
