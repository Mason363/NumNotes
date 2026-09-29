// An in-memory calculator for UI development and tests: an 8 MiB external
// flash and 256 KiB of SRAM laid out like a real N0110/N0115/N0120 running
// Epsilon, with NOR-flash write semantics.

import {
  EXTERNAL_FLASH_LAYOUT,
  EXTERNAL_FLASH_START,
  FlashCalculator,
  defaultSramStart,
  type DeviceIdentity,
  type ProgressCallback,
} from './calculator';
import { DfuError, DfuStatus } from './dfu';
import {
  APP_ALIGNMENT,
  APP_HEADER_SIZE,
  APP_MAGIC,
  KERNEL_HEADER_MAGIC,
  KERNEL_HEADER_SIZE,
  NOTES_STORE_SIZE,
  NUMNOTES_MAGIC,
  SLOT_INFO_MAGIC,
  SLOT_INFO_SIZE,
  USERLAND_HEADER_MAGIC,
  roundUpToAppAlignment,
  type UserlandHeader,
} from './firmware';
import { formatAddress, parseMemoryLayout, sectorsInRange, type MemoryLayout } from './layout';
import { NWI_HEIGHT, NWI_PIXEL_BYTES, NWI_WIDTH } from './nwi';

export type MockModel = 'N0110' | 'N0115' | 'N0120';

export const MOCK_EXTERNAL_FLASH_SIZE = 8 * 1024 * 1024;
export const MOCK_SRAM_SIZE = 256 * 1024;
export const MOCK_KERNEL_HEADER_ADDRESS = 0x90000008;
export const MOCK_USERLAND_HEADER_ADDRESS = 0x90010008;
export const MOCK_EXTERNAL_APPS_FLASH_START = 0x90250000;
export const MOCK_EXTERNAL_APPS_FLASH_END = 0x903f0000;

const BCD_DEVICE: Record<MockModel, number> = { N0110: 0x0110, N0115: 0x0115, N0120: 0x0120 };

export interface MockAppSpec {
  name: string;
  /** Size in bytes (the header's app size). Defaults to 64 KiB, or 128 KiB for NumNotes apps. */
  size?: number;
  apiLevel?: number;
  /** RGB565 icon background. Derived from the name by default. */
  iconColor?: number;
  /** Makes it a NumNotes app; its last 64 KiB is the notes store (erased unless `store` is given). */
  numnotes?: { projectId: number; formatVersion?: number; store?: Uint8Array };
}

export interface MockMemoryOptions {
  model?: MockModel;
  firmwareVersion?: string;
  firmwarePatch?: string;
  /** Installed apps, placed one after the other from the start of the external apps area. */
  apps?: MockAppSpec[];
  externalAppsFlashStart?: number;
  externalAppsFlashEnd?: number;
  /** Leave out the SRAM slot info, like firmware older than Epsilon 16. */
  legacyFirmware?: boolean;
}

export interface MockMemory {
  model: MockModel;
  bcdDevice: number;
  flashStart: number;
  flash: Uint8Array;
  flashLayout: string;
  sramStart: number;
  sram: Uint8Array;
  sramLayout: string;
}

export const DEFAULT_MOCK_APPS: readonly MockAppSpec[] = [
  { name: 'Snake', size: 0x16400, iconColor: 0x2d6a },
  { name: 'Biology Notes', size: 0x30000, iconColor: 0xfb20, numnotes: { projectId: 0x1a2b3c4d, formatVersion: 1 } },
];

/** Builds the memory image of a calculator with the given firmware and apps. */
export function createMockMemory(options: MockMemoryOptions = {}): MockMemory {
  const model = options.model ?? 'N0120';
  const sramStart = defaultSramStart(model);
  const appsStart = options.externalAppsFlashStart ?? MOCK_EXTERNAL_APPS_FLASH_START;
  const appsEnd = options.externalAppsFlashEnd ?? MOCK_EXTERNAL_APPS_FLASH_END;
  const version = options.firmwareVersion ?? '23.2.0';

  const flash = new Uint8Array(MOCK_EXTERNAL_FLASH_SIZE).fill(0xff);
  // Stand-in for the kernel and userland code.
  fillPseudoRandom(flash.subarray(0, appsStart - EXTERNAL_FLASH_START), 0x5eed);
  flash.set(encodeKernelHeader(version, options.firmwarePatch ?? '1f3a9c2'), MOCK_KERNEL_HEADER_ADDRESS - EXTERNAL_FLASH_START);
  const userland = encodeUserlandHeader({
    expectedVersion: version,
    storageAddress: sramStart + 0xa000,
    storageSize: 0xf000,
    externalAppsFlashStart: appsStart,
    externalAppsFlashEnd: appsEnd,
    externalAppsRamStart: sramStart + 0x20000,
    externalAppsRamEnd: sramStart + MOCK_SRAM_SIZE,
    deviceNameFlashStart: appsEnd,
    deviceNameFlashEnd: appsEnd + 0x1000,
  });
  flash.set(userland, MOCK_USERLAND_HEADER_ADDRESS - EXTERNAL_FLASH_START);

  let address = appsStart;
  for (const spec of options.apps ?? DEFAULT_MOCK_APPS) {
    const image = buildMockApp(spec);
    if (address + image.length > appsEnd) throw new Error(`Mock app “${spec.name}” doesn’t fit`);
    flash.set(image, address - EXTERNAL_FLASH_START);
    address += roundUpToAppAlignment(image.length);
  }

  const sram = new Uint8Array(MOCK_SRAM_SIZE);
  if (!options.legacyFirmware) {
    sram.set(encodeSlotInfo(MOCK_KERNEL_HEADER_ADDRESS, MOCK_USERLAND_HEADER_ADDRESS), 0);
  }

  return {
    model,
    bcdDevice: BCD_DEVICE[model],
    flashStart: EXTERNAL_FLASH_START,
    flash,
    flashLayout: EXTERNAL_FLASH_LAYOUT,
    sramStart,
    sram,
    sramLayout: `@SRAM/0x${sramStart.toString(16)}/01*256Ke`,
  };
}

/** Builds a third-party app image: header, name (+ NumNotes marker), icon, filler, notes store. */
export function buildMockApp(spec: MockAppSpec): Uint8Array {
  const nameSection = encodeNameSection(spec);
  const icon = compressLz4Block(mockIconPixels(spec.iconColor ?? colorFromName(spec.name)));
  const nameOffset = APP_HEADER_SIZE;
  const iconOffset = nameOffset + nameSection.length;
  const entryPointOffset = alignTo(iconOffset + icon.length, 8);
  const minimumSize = entryPointOffset + 64 + (spec.numnotes ? NOTES_STORE_SIZE : 0);
  const size = spec.size ?? (spec.numnotes ? 2 * APP_ALIGNMENT : APP_ALIGNMENT);
  if (size < minimumSize) throw new Error(`Mock app “${spec.name}” needs at least ${minimumSize} bytes`);

  const image = new Uint8Array(size);
  // Stand-in for code and data.
  fillPseudoRandom(image, hashString(spec.name));
  const header = new DataView(image.buffer, 0, APP_HEADER_SIZE);
  const fields = [APP_MAGIC, spec.apiLevel ?? 0, nameOffset, icon.length, iconOffset, entryPointOffset, size, APP_MAGIC];
  fields.forEach((value, index) => header.setUint32(index * 4, value, true));
  image.set(nameSection, nameOffset);
  image.set(icon, iconOffset);

  if (spec.numnotes) {
    const store = image.subarray(size - NOTES_STORE_SIZE).fill(0xff);
    if (spec.numnotes.store) store.set(spec.numnotes.store.subarray(0, NOTES_STORE_SIZE));
  }
  return image;
}

function encodeNameSection(spec: MockAppSpec): Uint8Array {
  const name = new TextEncoder().encode(spec.name);
  const markerOffset = alignTo(name.length + 1, 4);
  const section = new Uint8Array(spec.numnotes ? markerOffset + 12 : markerOffset);
  section.set(name);
  if (spec.numnotes) {
    const view = new DataView(section.buffer);
    view.setUint32(markerOffset, NUMNOTES_MAGIC, true);
    view.setUint32(markerOffset + 4, spec.numnotes.formatVersion ?? 1, true);
    view.setUint32(markerOffset + 8, spec.numnotes.projectId, true);
  }
  return section;
}

export function encodeSlotInfo(kernelHeaderAddress: number, userlandHeaderAddress: number): Uint8Array {
  const bytes = new Uint8Array(SLOT_INFO_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, SLOT_INFO_MAGIC, true);
  view.setUint32(4, kernelHeaderAddress, true);
  view.setUint32(8, userlandHeaderAddress, true);
  view.setUint32(12, SLOT_INFO_MAGIC, true);
  return bytes;
}

export function encodeKernelHeader(version: string, patch: string): Uint8Array {
  const bytes = new Uint8Array(KERNEL_HEADER_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, KERNEL_HEADER_MAGIC, true);
  writeCString(bytes, 4, version, 8);
  writeCString(bytes, 12, patch, 8);
  view.setUint32(20, KERNEL_HEADER_MAGIC, true);
  return bytes;
}

/** Encodes fields in memory order up to the first undefined one, then the closing magic. */
export function encodeUserlandHeader(header: UserlandHeader): Uint8Array {
  const fields = [
    header.storageAddress,
    header.storageSize,
    header.externalAppsFlashStart,
    header.externalAppsFlashEnd,
    header.externalAppsRamStart,
    header.externalAppsRamEnd,
    header.deviceNameFlashStart,
    header.deviceNameFlashEnd,
  ];
  const present = fields.findIndex((value) => value === undefined);
  const count = present < 0 ? fields.length : present;
  const bytes = new Uint8Array(12 + 4 * count + 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, USERLAND_HEADER_MAGIC, true);
  writeCString(bytes, 4, header.expectedVersion, 8);
  for (let i = 0; i < count; i++) view.setUint32(12 + 4 * i, fields[i] as number, true);
  view.setUint32(12 + 4 * count, USERLAND_HEADER_MAGIC, true);
  return bytes;
}

/** A simple app icon: a colored tile with a white "page". RGB565 little-endian. */
export function mockIconPixels(background: number): Uint8Array {
  const pixels = new Uint8Array(NWI_PIXEL_BYTES);
  for (let y = 0; y < NWI_HEIGHT; y++) {
    for (let x = 0; x < NWI_WIDTH; x++) {
      const onPage = x >= 15 && x < 40 && y >= 10 && y < 46;
      const onLine = onPage && x >= 19 && x < 36 && y >= 16 && y < 40 && (y - 16) % 6 < 2;
      const color = onLine ? background : onPage ? 0xffff : background;
      const offset = 2 * (y * NWI_WIDTH + x);
      pixels[offset] = color & 0xff;
      pixels[offset + 1] = color >> 8;
    }
  }
  return pixels;
}

/**
 * A small greedy LZ4 block compressor, enough to produce valid icons. Follows
 * the format's end-of-block rules: the last 5 bytes are literals and no match
 * starts within the last 12 bytes.
 */
export function compressLz4Block(input: Uint8Array): Uint8Array {
  const MIN_MATCH = 4;
  const LAST_LITERALS = 5;
  const MATCH_START_LIMIT = input.length - 12;
  const MATCH_END_LIMIT = input.length - LAST_LITERALS;
  const HASH_BITS = 12;
  const table = new Int32Array(1 << HASH_BITS).fill(-1);
  const output: number[] = [];
  const read32 = (at: number) => input[at] | (input[at + 1] << 8) | (input[at + 2] << 16) | (input[at + 3] << 24);

  let anchor = 0;
  let position = 0;
  while (position <= MATCH_START_LIMIT) {
    const sequence = read32(position);
    const hash = Math.imul(sequence, 2654435761) >>> (32 - HASH_BITS);
    const candidate = table[hash];
    table[hash] = position;
    if (candidate >= 0 && position - candidate <= 0xffff && read32(candidate) === sequence) {
      let length = MIN_MATCH;
      while (position + length < MATCH_END_LIMIT && input[candidate + length] === input[position + length]) length++;
      emitSequence(output, input.subarray(anchor, position), position - candidate, length);
      position += length;
      anchor = position;
    } else {
      position++;
    }
  }
  emitSequence(output, input.subarray(anchor), 0, 0);
  return Uint8Array.from(output);
}

function emitSequence(output: number[], literals: Uint8Array, offset: number, matchLength: number): void {
  const matchCode = matchLength === 0 ? 0 : matchLength - 4;
  output.push((Math.min(literals.length, 15) << 4) | Math.min(matchCode, 15));
  if (literals.length >= 15) pushLength(output, literals.length - 15);
  for (const byte of literals) output.push(byte);
  if (matchLength === 0) return;
  output.push(offset & 0xff, offset >> 8);
  if (matchCode >= 15) pushLength(output, matchCode - 15);
}

function pushLength(output: number[], remainder: number): void {
  for (; remainder >= 255; remainder -= 255) output.push(255);
  output.push(remainder);
}

export type MockFault = {
  operation: 'read' | 'erase' | 'program' | 'leave';
  /** 'error' makes the operation throw; 'corrupt' (program only) flips a written byte. */
  kind: 'error' | 'corrupt';
};

export interface MockCalculatorOptions extends MockMemoryOptions {
  serial?: string;
  /** Simulated transfer speed in bytes per second. 0 (the default) is instant. */
  bytesPerSecond?: number;
  /** Simulated time to erase one sector. Defaults to 0. */
  eraseMilliseconds?: number;
}

/** A calculator backed by memory, sharing all high-level logic with `Calculator`. */
export class MockCalculator extends FlashCalculator {
  readonly memory: MockMemory;
  readonly serial: string;
  /** Number of times the calculator left DFU mode. */
  rebootCount = 0;
  private opened = false;
  private readonly layout: MemoryLayout;
  private readonly bytesPerSecond: number;
  private readonly eraseMilliseconds: number;
  private readonly faults: MockFault[] = [];
  private readonly disconnectListeners = new Set<() => void>();

  constructor(options: MockCalculatorOptions = {}) {
    super();
    this.memory = createMockMemory(options);
    this.serial = options.serial ?? '0042004A3438510C31363631';
    this.layout = parseMemoryLayout(this.memory.flashLayout);
    this.bytesPerSecond = options.bytesPerSecond ?? 0;
    this.eraseMilliseconds = options.eraseMilliseconds ?? 0;
  }

  async open(): Promise<void> {
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => {
      this.disconnectListeners.delete(listener);
    };
  }

  /** Makes the next matching operation fail. */
  injectFault(fault: MockFault): void {
    this.faults.push(fault);
  }

  /** Simulates unplugging the cable. Calling any method afterwards "plugs it back in". */
  unplug(): void {
    this.opened = false;
    for (const listener of [...this.disconnectListeners]) listener();
  }

  protected get isOpen(): boolean {
    return this.opened;
  }

  protected async identify(): Promise<DeviceIdentity> {
    return { model: this.memory.model, serial: this.serial, sramStart: this.memory.sramStart };
  }

  protected async flashLayout(): Promise<MemoryLayout> {
    return this.layout;
  }

  protected async readRamMemory(address: number, length: number): Promise<Uint8Array> {
    const offset = this.offsetIn(this.memory.sramStart, this.memory.sram.length, address, length);
    await this.simulateTransfer(length);
    return this.memory.sram.slice(offset, offset + length);
  }

  protected async readFlashMemory(address: number, length: number, onProgress?: ProgressCallback): Promise<Uint8Array> {
    const offset = this.offsetIn(this.memory.flashStart, this.memory.flash.length, address, length);
    this.consumeFault('read');
    await this.simulateTransfer(length, onProgress);
    return this.memory.flash.slice(offset, offset + length);
  }

  protected async eraseFlashSector(address: number): Promise<void> {
    const [sector] = sectorsInRange(this.layout, address, address + 1);
    this.consumeFault('erase');
    if (this.eraseMilliseconds > 0) await delay(this.eraseMilliseconds);
    const offset = sector.start - this.memory.flashStart;
    this.memory.flash.fill(0xff, offset, offset + sector.size);
  }

  protected async programFlash(address: number, data: Uint8Array, onProgress?: ProgressCallback): Promise<void> {
    const offset = this.offsetIn(this.memory.flashStart, this.memory.flash.length, address, data.length);
    const corrupt = this.consumeFault('program');
    await this.simulateTransfer(data.length, onProgress);
    // NOR flash: programming can only clear bits.
    for (let i = 0; i < data.length; i++) this.memory.flash[offset + i] &= data[i];
    if (corrupt && data.length > 0) this.memory.flash[offset + (data.length >> 1)] ^= 0x01;
  }

  protected async leaveDfu(): Promise<void> {
    this.consumeFault('leave');
    this.rebootCount++;
    this.unplug();
  }

  private offsetIn(regionStart: number, regionLength: number, address: number, length: number): number {
    this.assertOpen();
    const offset = address - regionStart;
    if (offset < 0 || length < 0 || offset + length > regionLength) {
      throw new DfuError('device-error', `${formatAddress(address)} is outside the device’s memory`, {
        status: DfuStatus.errAddress,
      });
    }
    return offset;
  }

  private assertOpen(): void {
    if (!this.opened) throw new DfuError('disconnected', 'The mock calculator is not open');
  }

  /** Consumes a pending fault for `operation`. Throws for 'error' faults; returns true for 'corrupt' ones. */
  private consumeFault(operation: MockFault['operation']): boolean {
    const index = this.faults.findIndex((fault) => fault.operation === operation);
    if (index < 0) return false;
    const [fault] = this.faults.splice(index, 1);
    if (fault.kind === 'corrupt') return true;
    throw new DfuError('device-error', `Simulated ${operation} failure`, { status: DfuStatus.errUnknown });
  }

  private async simulateTransfer(length: number, onProgress?: ProgressCallback): Promise<void> {
    if (this.bytesPerSecond <= 0) {
      onProgress?.(1);
      return;
    }
    const steps = Math.max(1, Math.min(20, Math.ceil(length / 2048)));
    const stepMilliseconds = (length / this.bytesPerSecond) * 1000 / steps;
    for (let step = 1; step <= steps; step++) {
      await delay(stepMilliseconds);
      onProgress?.(step / steps);
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function writeCString(bytes: Uint8Array, offset: number, text: string, maxLength: number): void {
  bytes.set(new TextEncoder().encode(text).subarray(0, maxLength), offset);
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

/** Deterministic filler so different regions don't look alike. */
function fillPseudoRandom(bytes: Uint8Array, seed: number): void {
  let state = seed >>> 0 || 1;
  for (let i = 0; i < bytes.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[i] = state & 0xff;
  }
}

function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}

function colorFromName(name: string): number {
  const hash = hashString(name);
  // Keep colors mid-bright so the white page stays visible.
  const red = 8 + (hash & 0x0f);
  const green = 16 + ((hash >>> 4) & 0x1f);
  const blue = 8 + ((hash >>> 9) & 0x0f);
  return (red << 11) | (green << 5) | blue;
}
