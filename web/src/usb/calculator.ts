// High-level access to a NumWorks calculator: identification, firmware info,
// installed apps, and verified flash writes. `FlashCalculator` holds the
// logic shared by the WebUSB `Calculator` and the in-memory `MockCalculator`.

import { DfuClient, DfuError, type DfuClientOptions, type ProgressCallback } from './dfu';
import { CalculatorError } from './errors';
import { NOTES_STORE_SIZE, readAppChain, readFirmwareInfo } from './firmware';
import { formatAddress, parseMemoryLayout, sectorsInRange, segmentAt, type FlashSector, type MemoryLayout } from './layout';

export type { ProgressCallback } from './dfu';

export const NUMWORKS_VENDOR_ID = 0x0483;
export const NUMWORKS_PRODUCT_ID = 0xa291;

export const EXTERNAL_FLASH_START = 0x90000000;
/** External flash of the N0110, N0115 and N0120, used if the device doesn't describe it. */
export const EXTERNAL_FLASH_LAYOUT = '@Flash/0x90000000/08*004Kg,01*032Kg,127*064Kg';

const ALT_FLASH = 0;
const ALT_SRAM = 1;

export type CalculatorModel = 'N0110' | 'N0115' | 'N0120' | 'unknown';

export interface CalculatorInfo {
  model: CalculatorModel;
  serial: string;
  firmwareVersion: string;
  firmwarePatch?: string;
  externalAppsFlashStart: number;
  externalAppsFlashEnd: number;
  externalAppsRamStart?: number;
  externalAppsRamEnd?: number;
  storageAddress?: number;
  storageSize?: number;
  sramStart: number;
}

export interface InstalledApp {
  address: number;
  /** Space the app occupies: its size rounded up to 64 KiB. */
  size: number;
  /** Size from the app header. */
  rawSize: number;
  name: string;
  apiLevel: number;
  /** 55x56 RGBA pixels. */
  iconRgba?: Uint8ClampedArray;
  numnotes?: { formatVersion: number; projectId: number; storeAddress: number };
}

export type FlashWritePhase = 'erase' | 'write' | 'verify';

/** `fraction` covers the whole write (0..1); `phase` says what is happening now. */
export type WriteProgressCallback = (fraction: number, phase: FlashWritePhase) => void;

/** What the UI and the installer need from a calculator, real or mocked. */
export interface CalculatorLike {
  open(): Promise<void>;
  close(): Promise<void>;
  /** Model, serial and firmware details. Cached after the first call. */
  info(): Promise<CalculatorInfo>;
  listApps(): Promise<InstalledApp[]>;
  readFlash(address: number, length: number, onProgress?: ProgressCallback): Promise<Uint8Array>;
  /**
   * Erases the sectors covering the range, writes `data`, then reads it back
   * and throws a `verify-failed` CalculatorError on mismatch. Bytes that share
   * a sector with the range but lie outside it are preserved. Only the
   * external apps area may be written.
   */
  writeFlash(address: number, data: Uint8Array, onProgress?: WriteProgressCallback): Promise<void>;
  /** The 64 KiB notes store of a NumNotes app. */
  readNotesStore(app: InstalledApp): Promise<Uint8Array>;
  /** Leaves DFU mode. The calculator restarts and disconnects. */
  reboot(): Promise<void>;
  /** Called when the calculator is unplugged (or reboots). Returns an unsubscribe function. */
  onDisconnect(listener: () => void): () => void;
}

export interface DeviceIdentity {
  model: CalculatorModel;
  serial: string;
  sramStart: number;
}

const MODELS_BY_DEVICE_VERSION = new Map<number, CalculatorModel | 'N0100'>([
  [0x0100, 'N0100'],
  [0x0110, 'N0110'],
  [0x0115, 'N0115'],
  [0x0120, 'N0120'],
]);

/** Maps the USB bcdDevice to a model. */
export function modelFromDeviceVersion(bcdDevice: number): CalculatorModel | 'N0100' {
  return MODELS_BY_DEVICE_VERSION.get(bcdDevice) ?? 'unknown';
}

export function defaultSramStart(model: CalculatorModel): number {
  return model === 'N0120' ? 0x24000000 : 0x20000000;
}

const WRITE_PHASES: Record<FlashWritePhase, { start: number; span: number }> = {
  erase: { start: 0, span: 0.2 },
  write: { start: 0.2, span: 0.5 },
  verify: { start: 0.7, span: 0.3 },
};

export abstract class FlashCalculator implements CalculatorLike {
  private cachedInfo: CalculatorInfo | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  abstract open(): Promise<void>;
  abstract close(): Promise<void>;
  abstract onDisconnect(listener: () => void): () => void;

  protected abstract get isOpen(): boolean;
  protected abstract identify(): Promise<DeviceIdentity>;
  protected abstract flashLayout(): Promise<MemoryLayout>;
  protected abstract readRamMemory(address: number, length: number): Promise<Uint8Array>;
  protected abstract readFlashMemory(address: number, length: number, onProgress?: ProgressCallback): Promise<Uint8Array>;
  protected abstract eraseFlashSector(address: number): Promise<void>;
  /** Writes into already-erased flash. */
  protected abstract programFlash(address: number, data: Uint8Array, onProgress?: ProgressCallback): Promise<void>;
  protected abstract leaveDfu(address: number): Promise<void>;

  info(): Promise<CalculatorInfo> {
    return this.exclusive(() => this.loadInfo());
  }

  listApps(): Promise<InstalledApp[]> {
    return this.exclusive(async () => {
      const info = await this.loadInfo();
      return readAppChain(
        (address, length) => this.readFlashMemory(address, length),
        info.externalAppsFlashStart,
        info.externalAppsFlashEnd,
      );
    });
  }

  readFlash(address: number, length: number, onProgress?: ProgressCallback): Promise<Uint8Array> {
    return this.exclusive(async () => {
      await this.ensureOpen();
      await this.sectorsFor(address, address + length);
      return this.readFlashMemory(address, length, onProgress);
    });
  }

  writeFlash(address: number, data: Uint8Array, onProgress?: WriteProgressCallback): Promise<void> {
    return this.exclusive(async () => {
      const info = await this.loadInfo();
      if (data.length === 0) return;
      const sectors = await this.sectorsFor(address, address + data.length);
      const spanStart = sectors[0].start;
      const spanEnd = sectors[sectors.length - 1].start + sectors[sectors.length - 1].size;
      assertWritable(sectors, spanStart, spanEnd, info);

      // Erasing works on whole sectors: keep the bytes that share a sector with the range.
      let payload = data;
      if (spanStart !== address || spanEnd !== address + data.length) {
        payload = await this.readFlashMemory(spanStart, spanEnd - spanStart);
        payload.set(data, address - spanStart);
      }

      const report = (phase: FlashWritePhase, fraction: number) => {
        const { start, span } = WRITE_PHASES[phase];
        onProgress?.(start + span * fraction, phase);
      };
      for (const [index, sector] of sectors.entries()) {
        report('erase', index / sectors.length);
        await this.eraseFlashSector(sector.start);
      }
      report('erase', 1);
      await this.programFlash(spanStart, payload, (fraction) => report('write', fraction));
      const readBack = await this.readFlashMemory(spanStart, payload.length, (fraction) => report('verify', fraction));
      const mismatch = firstMismatch(payload, readBack);
      if (mismatch >= 0) {
        throw new CalculatorError(
          'verify-failed',
          `Verification failed at ${formatAddress(spanStart + mismatch)}: wrote 0x${hexByte(payload[mismatch])}, ` +
            `read back 0x${hexByte(readBack[mismatch])}. Try installing again.`,
        );
      }
      report('verify', 1);
    });
  }

  async readNotesStore(app: InstalledApp): Promise<Uint8Array> {
    if (!app.numnotes) {
      throw new CalculatorError('not-numnotes', `“${app.name}” is not a NumNotes app`);
    }
    return this.readFlash(app.numnotes.storeAddress, NOTES_STORE_SIZE);
  }

  reboot(): Promise<void> {
    return this.exclusive(async () => {
      const info = await this.loadInfo();
      await this.leaveDfu(info.externalAppsFlashStart);
    });
  }

  private async loadInfo(): Promise<CalculatorInfo> {
    await this.ensureOpen();
    if (this.cachedInfo) return this.cachedInfo;
    const identity = await this.identify();
    const firmware = await readFirmwareInfo(
      (address, length) => this.readRamMemory(address, length),
      (address, length) => this.readFlashMemory(address, length),
      identity.sramStart,
    );
    this.cachedInfo = { model: identity.model, serial: identity.serial, sramStart: identity.sramStart, ...firmware };
    return this.cachedInfo;
  }

  private async ensureOpen(): Promise<void> {
    if (!this.isOpen) await this.open();
  }

  private async sectorsFor(start: number, end: number): Promise<FlashSector[]> {
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
      throw new CalculatorError('out-of-range', `Invalid flash range ${start}..${end}`);
    }
    try {
      return sectorsInRange(await this.flashLayout(), start, end);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      throw new CalculatorError('out-of-range', error.message, { cause: error });
    }
  }

  /** Runs USB operations one at a time; interleaving them would confuse the DFU state machine. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function assertWritable(sectors: FlashSector[], spanStart: number, spanEnd: number, info: CalculatorInfo): void {
  if (spanStart < info.externalAppsFlashStart || spanEnd > info.externalAppsFlashEnd) {
    throw new CalculatorError(
      'out-of-range',
      `Refusing to write ${formatAddress(spanStart)}..${formatAddress(spanEnd)}: outside the external apps area ` +
        `(${formatAddress(info.externalAppsFlashStart)}..${formatAddress(info.externalAppsFlashEnd)})`,
    );
  }
  const readOnly = sectors.find((sector) => !sector.segment.erasable || !sector.segment.writable);
  if (readOnly) {
    throw new CalculatorError('out-of-range', `The sector at ${formatAddress(readOnly.start)} is not writable`);
  }
}

function firstMismatch(expected: Uint8Array, actual: Uint8Array): number {
  if (actual.length !== expected.length) return Math.min(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== actual[i]) return i;
  }
  return -1;
}

function hexByte(value: number | undefined): string {
  return value === undefined ? '??' : value.toString(16).toUpperCase().padStart(2, '0');
}

/** A NumWorks calculator connected over WebUSB (Chrome, Edge). */
export class Calculator extends FlashCalculator {
  static readonly filters: USBDeviceFilter[] = [{ vendorId: NUMWORKS_VENDOR_ID, productId: NUMWORKS_PRODUCT_ID }];

  /** Whether this browser exposes WebUSB. */
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && navigator.usb !== undefined;
  }

  /**
   * Shows the browser's device picker, filtered to NumWorks calculators. Must
   * be called from a user gesture (e.g. a click handler), before any other
   * slow await.
   */
  static async request(): Promise<Calculator> {
    const usb = requireWebUsb();
    try {
      return new Calculator(await usb.requestDevice({ filters: Calculator.filters }));
    } catch (error) {
      if (errorName(error) === 'NotFoundError') {
        throw new CalculatorError('no-device-selected', 'No calculator was selected', { cause: error });
      }
      throw new CalculatorError('connection-failed', `Couldn’t access USB devices: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  }

  /** A calculator this site was already given access to, if it is plugged in. */
  static async reconnect(): Promise<Calculator | null> {
    if (!Calculator.isSupported()) return null;
    const devices = await requireWebUsb().getDevices();
    const device = devices.find(isNumWorksCalculator);
    return device ? new Calculator(device) : null;
  }

  readonly device: USBDevice;
  private readonly dfu: DfuClient;
  private layout: MemoryLayout | null = null;
  private opening: Promise<void> | null = null;

  constructor(device: USBDevice, options: DfuClientOptions = {}) {
    super();
    this.device = device;
    this.dfu = new DfuClient(device, options);
  }

  protected get isOpen(): boolean {
    return this.dfu.isOpen;
  }

  async open(): Promise<void> {
    if (this.dfu.isOpen) return;
    this.opening ??= this.connect().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async connect(): Promise<void> {
    try {
      await this.dfu.open();
    } catch (error) {
      await this.dfu.close();
      throw connectionError(error);
    }
  }

  async close(): Promise<void> {
    await this.dfu.close();
  }

  onDisconnect(listener: () => void): () => void {
    const usb = typeof navigator !== 'undefined' ? navigator.usb : undefined;
    if (!usb) return () => undefined;
    const handler = (event: USBConnectionEvent) => {
      if (event.device === this.device) listener();
    };
    usb.addEventListener('disconnect', handler);
    return () => usb.removeEventListener('disconnect', handler);
  }

  protected async identify(): Promise<DeviceIdentity> {
    const model = modelFromDeviceVersion(deviceVersion(this.device));
    if (model === 'N0100') {
      throw new CalculatorError(
        'unsupported-model',
        'This calculator is an N0100, which can’t run third-party apps. NumNotes needs an N0110, N0115 or N0120.',
      );
    }
    const sramStart = this.dfu.memoryLayout(ALT_SRAM)?.segments[0]?.start ?? defaultSramStart(model);
    return { model, serial: this.device.serialNumber ?? '', sramStart };
  }

  protected async flashLayout(): Promise<MemoryLayout> {
    if (!this.layout) {
      const reported = this.dfu.memoryLayout(ALT_FLASH);
      this.layout =
        reported && segmentAt(reported, EXTERNAL_FLASH_START) ? reported : parseMemoryLayout(EXTERNAL_FLASH_LAYOUT);
    }
    return this.layout;
  }

  protected async readRamMemory(address: number, length: number): Promise<Uint8Array> {
    await this.dfu.selectAlternate(ALT_SRAM);
    return this.dfu.upload(address, length);
  }

  protected async readFlashMemory(address: number, length: number, onProgress?: ProgressCallback): Promise<Uint8Array> {
    await this.dfu.selectAlternate(ALT_FLASH);
    return this.dfu.upload(address, length, onProgress);
  }

  protected async eraseFlashSector(address: number): Promise<void> {
    await this.dfu.selectAlternate(ALT_FLASH);
    await this.dfu.eraseSector(address);
  }

  protected async programFlash(address: number, data: Uint8Array, onProgress?: ProgressCallback): Promise<void> {
    await this.dfu.selectAlternate(ALT_FLASH);
    // writeFlash erased the range, so all-0xFF blocks are already in place.
    await this.dfu.download(address, data, onProgress, { skipBlankBlocks: true });
  }

  protected async leaveDfu(address: number): Promise<void> {
    await this.dfu.selectAlternate(ALT_FLASH);
    await this.dfu.leave(address);
    await this.dfu.close();
  }
}

export function isNumWorksCalculator(device: USBDevice): boolean {
  return device.vendorId === NUMWORKS_VENDOR_ID && device.productId === NUMWORKS_PRODUCT_ID;
}

/** Rebuilds bcdDevice from the fields WebUSB splits it into. */
function deviceVersion(device: USBDevice): number {
  return (device.deviceVersionMajor << 8) | (device.deviceVersionMinor << 4) | device.deviceVersionSubminor;
}

function requireWebUsb(): USB {
  const usb = typeof navigator !== 'undefined' ? navigator.usb : undefined;
  if (!usb) {
    throw new CalculatorError(
      'unsupported-browser',
      'This browser can’t talk to USB devices. Use Chrome or Edge on a computer.',
    );
  }
  return usb;
}

function connectionError(error: unknown): CalculatorError {
  if (error instanceof DfuError && error.reason === 'protocol') {
    return new CalculatorError('connection-failed', `This device doesn’t look like a NumWorks calculator: ${error.message}`, {
      cause: error,
    });
  }
  return new CalculatorError(
    'connection-failed',
    'Couldn’t connect to the calculator. Close other tabs or apps that may be using it (such as the NumWorks ' +
      'website), unplug and replug it, then try again.',
    { cause: error },
  );
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
