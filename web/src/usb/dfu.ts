// A USB DFU 1.1 client with the ST DfuSe extensions (address pointer, sector
// erase, block-addressed transfers), talking to a USBDevice through WebUSB.

import { formatAddress, tryParseMemoryLayout, type MemoryLayout } from './layout';

/** Class-specific DFU requests (bRequest). */
export const DfuRequest = {
  detach: 0,
  download: 1,
  upload: 2,
  getStatus: 3,
  clearStatus: 4,
  getState: 5,
  abort: 6,
} as const;

/** bState values reported by GETSTATUS and GETSTATE. */
export const DfuState = {
  appIdle: 0,
  appDetach: 1,
  idle: 2,
  downloadSync: 3,
  downloadBusy: 4,
  downloadIdle: 5,
  manifestSync: 6,
  manifest: 7,
  manifestWaitReset: 8,
  uploadIdle: 9,
  error: 10,
} as const;

/** bStatus values reported by GETSTATUS. */
export const DfuStatus = {
  ok: 0x00,
  errTarget: 0x01,
  errFile: 0x02,
  errWrite: 0x03,
  errErase: 0x04,
  errCheckErased: 0x05,
  errProg: 0x06,
  errVerify: 0x07,
  errAddress: 0x08,
  errNotDone: 0x09,
  errFirmware: 0x0a,
  errVendor: 0x0b,
  errUsbReset: 0x0c,
  errPowerOnReset: 0x0d,
  errUnknown: 0x0e,
  errStalledPacket: 0x0f,
} as const;

const STATE_NAMES = [
  'appIDLE',
  'appDETACH',
  'dfuIDLE',
  'dfuDNLOAD-SYNC',
  'dfuDNBUSY',
  'dfuDNLOAD-IDLE',
  'dfuMANIFEST-SYNC',
  'dfuMANIFEST',
  'dfuMANIFEST-WAIT-RESET',
  'dfuUPLOAD-IDLE',
  'dfuERROR',
];

const STATUS_DESCRIPTIONS = [
  'no error',
  'the data is not meant for this device',
  'the data failed the device’s verification',
  'the device could not write to memory',
  'erasing memory failed',
  'memory was not blank after erasing',
  'programming memory failed',
  'memory content did not match after programming',
  'the address is outside the device’s memory',
  'the device expected more data',
  'the device firmware is corrupt',
  'vendor-specific error',
  'unexpected USB reset',
  'unexpected power-on reset',
  'unknown device error',
  'the device rejected an unexpected request',
];

export function dfuStateName(state: number): string {
  return STATE_NAMES[state] ?? `unknown state ${state}`;
}

export function dfuStatusDescription(status: number): string {
  return STATUS_DESCRIPTIONS[status] ?? `unknown status ${status}`;
}

export interface DfuStatusReport {
  status: number;
  /** Milliseconds the host must wait before the next GETSTATUS. */
  pollTimeout: number;
  state: number;
  stringIndex: number;
}

export type DfuErrorReason =
  /** GETSTATUS reported an error status. */
  | 'device-error'
  /** The device stalled a request. */
  | 'stall'
  /** The device went away mid-transfer. */
  | 'disconnected'
  /** WebUSB reported a transfer failure. */
  | 'transfer-failed'
  /** The device stopped answering. */
  | 'timeout'
  /** The device is in a state the operation can't recover from. */
  | 'unexpected-state'
  /** An upload returned fewer bytes than requested. */
  | 'short-read'
  /** The device doesn't look like a DFU device, or the client was misused. */
  | 'protocol';

export class DfuError extends Error {
  readonly reason: DfuErrorReason;
  /** DFU bStatus, when the device reported one. */
  readonly status?: number;
  /** DFU bState, when known. */
  readonly state?: number;

  constructor(
    reason: DfuErrorReason,
    message: string,
    details: { status?: number; state?: number; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'DfuError';
    this.reason = reason;
    this.status = details.status;
    this.state = details.state;
  }
}

export interface DfuClientOptions {
  /** Bytes per DNLOAD/UPLOAD block. Defaults to 2048. */
  transferSize?: number;
  /** Milliseconds before an unanswered control transfer is abandoned. Defaults to 10 s. */
  transferTimeout?: number;
  /** Milliseconds a single command (erase, block write) may keep the device busy. Defaults to 60 s. */
  commandTimeout?: number;
  /** Replaceable for tests. */
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface DfuAlternateSetting {
  alternateSetting: number;
  /** The interface string, e.g. "@Flash/0x90000000/08*004Kg,...". */
  name: string | null;
  layout: MemoryLayout | null;
}

export type ProgressCallback = (fraction: number) => void;

export interface DownloadOptions {
  /**
   * Don't send blocks that are entirely 0xFF. Only correct when the target
   * range was erased beforehand.
   */
  skipBlankBlocks?: boolean;
  /**
   * Write the first block after all the others. An app's header (with its
   * magic) sits in the first block, so an interrupted install leaves no
   * half-written app for the calculator to list and run.
   */
  firstBlockLast?: boolean;
}

const DFU_INTERFACE_CLASS = 0xfe;
const DFU_INTERFACE_SUBCLASS = 0x01;

const DFUSE_SET_ADDRESS = 0x21;
const DFUSE_ERASE_SECTOR = 0x41;

// DfuSe block numbers 0 and 1 are reserved for commands; data blocks start at 2.
const FIRST_DATA_BLOCK = 2;
// Re-send the address pointer well before wValue (16 bits) could overflow.
const MAX_BLOCKS_PER_POINTER = 0x8000;

const LEAVE_STATUS_TIMEOUT = 3000;
const SHORT_WAIT = 20;
const MAX_IDLE_ATTEMPTS = 4;

const USB_GET_DESCRIPTOR = 6;
const USB_DESCRIPTOR_CONFIGURATION = 2;
const USB_DESCRIPTOR_STRING = 3;
const USB_DESCRIPTOR_INTERFACE = 4;
const USB_LANGUAGE_EN_US = 0x0409;

export class DfuClient {
  readonly device: USBDevice;
  readonly transferSize: number;
  private readonly transferTimeout: number;
  private readonly commandTimeout: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private claimedInterface: number | null = null;
  private currentAlternate: number | null = null;
  private alternateSettings: DfuAlternateSetting[] = [];

  constructor(device: USBDevice, options: DfuClientOptions = {}) {
    this.device = device;
    this.transferSize = options.transferSize ?? 2048;
    this.transferTimeout = options.transferTimeout ?? 10_000;
    this.commandTimeout = options.commandTimeout ?? 60_000;
    this.sleep = options.sleep ?? defaultSleep;
  }

  get isOpen(): boolean {
    return this.device.opened && this.claimedInterface !== null;
  }

  get interfaceNumber(): number {
    if (this.claimedInterface === null) {
      throw new DfuError('protocol', 'The DFU interface is not open');
    }
    return this.claimedInterface;
  }

  /** Opens the device, claims its DFU interface and reads the memory layouts. */
  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    if (!this.device.configuration) {
      await this.device.selectConfiguration(this.device.configurations[0]?.configurationValue ?? 1);
    }
    const dfuInterface = findDfuInterface(this.device.configuration);
    if (!dfuInterface) {
      throw new DfuError('protocol', 'This USB device has no DFU interface');
    }
    if (!dfuInterface.claimed) await this.device.claimInterface(dfuInterface.interfaceNumber);
    this.claimedInterface = dfuInterface.interfaceNumber;
    this.currentAlternate = null;
    this.alternateSettings = await this.describeAlternates(dfuInterface);
  }

  /** Releases the interface and closes the device. Never throws. */
  async close(): Promise<void> {
    const claimed = this.claimedInterface;
    this.forgetConnection();
    if (!this.device.opened) return;
    try {
      if (claimed !== null) await this.device.releaseInterface(claimed);
    } catch {
      // The device may already be gone.
    }
    try {
      await this.device.close();
    } catch {
      // Same.
    }
  }

  get alternates(): readonly DfuAlternateSetting[] {
    return this.alternateSettings;
  }

  memoryLayout(alternateSetting: number): MemoryLayout | null {
    return this.alternateSettings.find((alt) => alt.alternateSetting === alternateSetting)?.layout ?? null;
  }

  async selectAlternate(alternateSetting: number): Promise<void> {
    const interfaceNumber = this.interfaceNumber;
    if (this.currentAlternate === alternateSetting) return;
    if (!this.alternateSettings.some((alt) => alt.alternateSetting === alternateSetting)) {
      throw new DfuError('protocol', `The device has no DFU alternate setting ${alternateSetting}`);
    }
    await this.guard(
      this.device.selectAlternateInterface(interfaceNumber, alternateSetting),
      `Selecting alternate setting ${alternateSetting}`,
    );
    this.currentAlternate = alternateSetting;
  }

  async getStatus(timeout = this.transferTimeout): Promise<DfuStatusReport> {
    const bytes = await this.statusRequestIn(DfuRequest.getStatus, 6, 'Reading the DFU status', timeout);
    if (bytes.length < 6) {
      throw new DfuError('protocol', `GETSTATUS returned ${bytes.length} bytes instead of 6`);
    }
    return {
      status: bytes[0],
      pollTimeout: bytes[1] + bytes[2] * 0x100 + bytes[3] * 0x10000,
      state: bytes[4],
      stringIndex: bytes[5],
    };
  }

  async getState(): Promise<number> {
    const bytes = await this.statusRequestIn(DfuRequest.getState, 1, 'Reading the DFU state');
    if (bytes.length < 1) throw new DfuError('protocol', 'GETSTATE returned no data');
    return bytes[0];
  }

  async clearStatus(): Promise<void> {
    await this.statusRequestOut(DfuRequest.clearStatus, 'Clearing the DFU error');
  }

  async abort(): Promise<void> {
    await this.statusRequestOut(DfuRequest.abort, 'Aborting the DFU operation');
  }

  /**
   * Brings the device back to dfuIDLE: clears an error, or aborts a pending
   * download/upload. Uses GETSTATE, which (unlike GETSTATUS) never makes the
   * device execute a pending command.
   */
  async ensureIdle(): Promise<void> {
    let state: number = DfuState.idle;
    for (let attempt = 0; attempt < MAX_IDLE_ATTEMPTS; attempt++) {
      state = await this.getState();
      switch (state) {
        case DfuState.idle:
          return;
        case DfuState.error:
          await this.clearStatus();
          break;
        case DfuState.downloadSync:
        case DfuState.downloadIdle:
        case DfuState.uploadIdle:
        case DfuState.manifestSync:
          await this.abort();
          break;
        case DfuState.downloadBusy:
          await this.sleep(10);
          break;
        default:
          throw new DfuError(
            'unexpected-state',
            `The calculator is in the ${dfuStateName(state)} state and can't accept commands. Unplug it and plug it back in.`,
            { state },
          );
      }
    }
    throw new DfuError('unexpected-state', `The calculator is stuck in the ${dfuStateName(state)} state`, { state });
  }

  async setAddress(address: number): Promise<void> {
    await this.ensureIdle();
    await this.setAddressPointer(address);
  }

  /** Erases the flash sector containing `address`. */
  async eraseSector(address: number): Promise<void> {
    await this.ensureIdle();
    await this.runCommand(commandPayload(DFUSE_ERASE_SECTOR, address), `Erasing the sector at ${formatAddress(address)}`);
  }

  /**
   * Writes `data` at `address`. The target must already be erased.
   *
   * NumWorks' DFU code resets its address pointer to 0 after every executed
   * block (it clears the pending pointer to 0 instead of "none"), so each
   * block gets its own SET_ADDRESS and is sent as block 2.
   */
  async download(
    address: number,
    data: Uint8Array,
    onProgress?: ProgressCallback,
    options: DownloadOptions = {},
  ): Promise<void> {
    const blockCount = Math.ceil(data.length / this.transferSize);
    if (blockCount === 0) {
      onProgress?.(1);
      return;
    }
    await this.ensureIdle();
    const order = [...Array(blockCount).keys()];
    if (options.firstBlockLast) order.push(order.shift()!);
    for (const [done, block] of order.entries()) {
      const offset = block * this.transferSize;
      const chunk = data.subarray(offset, Math.min(offset + this.transferSize, data.length));
      if (!options.skipBlankBlocks || !isBlank(chunk)) {
        await this.setAddressPointer(address + offset);
        await this.writeBlock(FIRST_DATA_BLOCK, chunk, address + offset);
      }
      onProgress?.((done + 1) / blockCount);
    }
  }

  /** Reads `length` bytes at `address` from the memory of the current alternate setting. */
  async upload(address: number, length: number, onProgress?: ProgressCallback): Promise<Uint8Array> {
    const result = new Uint8Array(length);
    const blockCount = Math.ceil(length / this.transferSize);
    if (blockCount === 0) return result;
    await this.ensureIdle();
    for (let first = 0; first < blockCount; first += MAX_BLOCKS_PER_POINTER) {
      const last = Math.min(blockCount, first + MAX_BLOCKS_PER_POINTER);
      await this.setAddressPointer(address + first * this.transferSize);
      // Setting the pointer leaves the device in dfuDNLOAD-IDLE; UPLOAD is only accepted from dfuIDLE.
      await this.abort();
      for (let block = first; block < last; block++) {
        const offset = block * this.transferSize;
        const size = Math.min(this.transferSize, length - offset);
        result.set(await this.readBlock(FIRST_DATA_BLOCK + block - first, size, address + offset), offset);
        onProgress?.((block + 1) / blockCount);
      }
    }
    await this.ensureIdle();
    return result;
  }

  /**
   * Leaves DFU mode: the device jumps to `address` (or simply resets) and
   * disconnects. A transfer failure once the request is sent means it worked.
   */
  async leave(address: number): Promise<void> {
    await this.ensureIdle();
    await this.setAddressPointer(address);
    try {
      const result = await this.classOut(DfuRequest.download, 0, undefined, 'Leaving DFU mode');
      if (result.status !== 'ok') throw await this.stallError('Leaving DFU mode', result.status);
    } catch (error) {
      if (!(error instanceof DfuError && error.reason === 'disconnected')) throw error;
      this.forgetConnection();
      return;
    }
    try {
      // The device leaves DFU mode while (or right after) answering this request.
      await this.getStatus(LEAVE_STATUS_TIMEOUT);
    } catch {
      // Expected: the device resets and disappears from the bus.
    }
    this.forgetConnection();
  }

  private forgetConnection(): void {
    this.claimedInterface = null;
    this.currentAlternate = null;
  }

  private async setAddressPointer(address: number): Promise<void> {
    await this.runCommand(
      commandPayload(DFUSE_SET_ADDRESS, address),
      `Setting the address pointer to ${formatAddress(address)}`,
    );
  }

  private async runCommand(payload: Uint8Array, context: string): Promise<void> {
    const result = await this.classOut(DfuRequest.download, 0, payload, context);
    if (result.status !== 'ok') throw await this.stallError(context, result.status);
    await this.waitUntilDownloadIdle(context);
  }

  private async writeBlock(blockNumber: number, chunk: Uint8Array, address: number): Promise<void> {
    const context = `Writing ${formatAddress(address)}`;
    const result = await this.classOut(DfuRequest.download, blockNumber, chunk, context);
    if (result.status !== 'ok') throw await this.stallError(context, result.status);
    await this.waitUntilDownloadIdle(context);
  }

  private async readBlock(blockNumber: number, size: number, address: number): Promise<Uint8Array> {
    const context = `Reading ${formatAddress(address)}`;
    const result = await this.classIn(DfuRequest.upload, blockNumber, size, context);
    if (result.status !== 'ok' || !result.data) throw await this.stallError(context, result.status);
    const bytes = dataViewBytes(result.data);
    if (bytes.length !== size) {
      throw new DfuError('short-read', `${context}: got ${bytes.length} bytes instead of ${size}`);
    }
    return bytes;
  }

  /**
   * DfuSe executes a downloaded command or block while answering the GETSTATUS
   * that moves it from dfuDNLOAD-SYNC to dfuDNBUSY. Poll, honouring
   * bwPollTimeout, until it settles in dfuDNLOAD-IDLE.
   */
  private async waitUntilDownloadIdle(context: string): Promise<void> {
    const deadline = Date.now() + this.commandTimeout;
    let report = await this.getStatus();
    while (report.state === DfuState.downloadBusy || report.state === DfuState.downloadSync) {
      if (Date.now() > deadline) {
        throw new DfuError('timeout', `${context} timed out: the calculator stayed busy`, report);
      }
      if (report.pollTimeout > 0) await this.sleep(report.pollTimeout);
      report = await this.getStatus();
    }
    if (report.state === DfuState.error || report.status !== DfuStatus.ok) {
      if (report.state === DfuState.error) await this.clearStatus().catch(() => undefined);
      throw new DfuError('device-error', `${context} failed: ${dfuStatusDescription(report.status)}`, report);
    }
    if (report.state !== DfuState.downloadIdle) {
      throw new DfuError(
        'unexpected-state',
        `${context}: the calculator went to ${dfuStateName(report.state)} instead of dfuDNLOAD-IDLE`,
        report,
      );
    }
  }

  /** After a stalled DNLOAD/UPLOAD: fetch the reason, clear the error, describe it. */
  private async stallError(context: string, transferStatus: USBTransferStatus): Promise<DfuError> {
    let report: DfuStatusReport | undefined;
    try {
      report = await this.getStatus();
      if (report.state === DfuState.error) await this.clearStatus();
    } catch {
      // Keep the original failure.
    }
    const detail =
      report && report.status !== DfuStatus.ok
        ? dfuStatusDescription(report.status)
        : `the calculator rejected the request (${transferStatus})`;
    return new DfuError('stall', `${context} failed: ${detail}`, { status: report?.status, state: report?.state });
  }

  private async statusRequestIn(
    request: number,
    length: number,
    context: string,
    timeout = this.transferTimeout,
  ): Promise<Uint8Array> {
    const result = await this.classIn(request, 0, length, context, timeout);
    if (result.status !== 'ok' || !result.data) {
      throw new DfuError('stall', `${context} failed: the calculator rejected the request (${result.status})`);
    }
    return dataViewBytes(result.data);
  }

  private async statusRequestOut(request: number, context: string): Promise<void> {
    const result = await this.classOut(request, 0, undefined, context);
    if (result.status !== 'ok') {
      throw new DfuError('stall', `${context} failed: the calculator rejected the request (${result.status})`);
    }
  }

  private classSetup(request: number, value: number): USBControlTransferParameters {
    return { requestType: 'class', recipient: 'interface', request, value, index: this.interfaceNumber };
  }

  private classIn(
    request: number,
    value: number,
    length: number,
    context: string,
    timeout = this.transferTimeout,
  ): Promise<USBInTransferResult> {
    return this.guard(this.device.controlTransferIn(this.classSetup(request, value), length), context, timeout);
  }

  private classOut(
    request: number,
    value: number,
    data: Uint8Array | undefined,
    context: string,
  ): Promise<USBOutTransferResult> {
    const setup = this.classSetup(request, value);
    const transfer = data ? this.device.controlTransferOut(setup, data) : this.device.controlTransferOut(setup);
    return this.guard(transfer, context);
  }

  /** Adds a timeout to a WebUSB call and turns its exceptions into DfuErrors. */
  private guard<T>(operation: Promise<T>, context: string, timeout = this.transferTimeout): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new DfuError('timeout', `${context} timed out: the calculator stopped responding`)),
        timeout,
      );
      operation.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(transferError(error, context));
        },
      );
    });
  }

  private async describeAlternates(dfuInterface: USBInterface): Promise<DfuAlternateSetting[]> {
    const alternates = dfuInterface.alternates.filter(isDfuAlternate);
    const names = new Map(alternates.map((alt) => [alt.alternateSetting, alt.interfaceName ?? null]));
    if ([...names.values()].some((name) => !name)) {
      // Some platforms don't expose interface strings; read them from the descriptors.
      try {
        const fromDescriptors = await this.readInterfaceNames(dfuInterface.interfaceNumber);
        for (const [alternateSetting, name] of fromDescriptors) {
          if (!names.get(alternateSetting)) names.set(alternateSetting, name);
        }
      } catch {
        // Callers fall back to known layouts.
      }
    }
    return alternates.map((alt) => {
      const name = names.get(alt.alternateSetting) ?? null;
      return { alternateSetting: alt.alternateSetting, name, layout: tryParseMemoryLayout(name) };
    });
  }

  private async readInterfaceNames(interfaceNumber: number): Promise<Map<number, string>> {
    const stringIndices = new Map<number, number>();
    for (const descriptor of splitDescriptors(await this.readConfigurationDescriptor())) {
      const isOurInterface =
        descriptor[1] === USB_DESCRIPTOR_INTERFACE && descriptor.length >= 9 && descriptor[2] === interfaceNumber;
      // bAlternateSetting is at offset 3, iInterface at offset 8.
      if (isOurInterface && descriptor[8] !== 0) stringIndices.set(descriptor[3], descriptor[8]);
    }
    const names = new Map<number, string>();
    if (stringIndices.size === 0) return names;
    const languages = await this.readDescriptor(USB_DESCRIPTOR_STRING, 0, 0, 255);
    const languageId = languages.length >= 4 ? languages[2] | (languages[3] << 8) : USB_LANGUAGE_EN_US;
    for (const [alternateSetting, stringIndex] of stringIndices) {
      const descriptor = await this.readDescriptor(USB_DESCRIPTOR_STRING, stringIndex, languageId, 255);
      names.set(alternateSetting, decodeStringDescriptor(descriptor));
    }
    return names;
  }

  private async readConfigurationDescriptor(): Promise<Uint8Array> {
    const active = this.device.configuration?.configurationValue;
    const index = Math.max(0, this.device.configurations.findIndex((config) => config.configurationValue === active));
    const header = await this.readDescriptor(USB_DESCRIPTOR_CONFIGURATION, index, 0, 9);
    if (header.length < 4) throw new DfuError('protocol', 'Truncated configuration descriptor');
    const totalLength = header[2] | (header[3] << 8);
    return this.readDescriptor(USB_DESCRIPTOR_CONFIGURATION, index, 0, totalLength);
  }

  private async readDescriptor(type: number, index: number, languageId: number, length: number): Promise<Uint8Array> {
    const setup: USBControlTransferParameters = {
      requestType: 'standard',
      recipient: 'device',
      request: USB_GET_DESCRIPTOR,
      value: (type << 8) | index,
      index: languageId,
    };
    const result = await this.guard(this.device.controlTransferIn(setup, length), 'Reading USB descriptors');
    if (result.status !== 'ok' || !result.data) {
      throw new DfuError('stall', `Reading USB descriptor ${type}/${index} failed (${result.status})`);
    }
    return dataViewBytes(result.data);
  }
}

/**
 * Waits `milliseconds`. Browsers throttle timers in background tabs to about
 * one per second, which would make the short waits between blocks crawl if
 * the user switches tabs mid-install, so short waits yield through a
 * MessageChannel instead.
 */
function defaultSleep(milliseconds: number): Promise<void> {
  if (milliseconds > SHORT_WAIT || typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
  const deadline = performance.now() + milliseconds;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      if (performance.now() < deadline) {
        channel.port2.postMessage(null);
        return;
      }
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

function findDfuInterface(configuration: USBConfiguration | null | undefined): USBInterface | undefined {
  return configuration?.interfaces.find((candidate) => candidate.alternates.some(isDfuAlternate));
}

function isDfuAlternate(alternate: USBAlternateInterface): boolean {
  return alternate.interfaceClass === DFU_INTERFACE_CLASS && alternate.interfaceSubclass === DFU_INTERFACE_SUBCLASS;
}

function commandPayload(command: number, address: number): Uint8Array {
  if (!Number.isInteger(address) || address < 0 || address > 0xffffffff) {
    throw new DfuError('protocol', `Invalid address ${address}`);
  }
  const payload = new Uint8Array(5);
  payload[0] = command;
  new DataView(payload.buffer).setUint32(1, address, true);
  return payload;
}

function isBlank(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0xff) return false;
  }
  return true;
}

function dataViewBytes(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

/** Splits a configuration descriptor into its individual descriptors. */
function splitDescriptors(bytes: Uint8Array): Uint8Array[] {
  const descriptors: Uint8Array[] = [];
  for (let offset = 0; offset + 2 <= bytes.length; ) {
    const length = bytes[offset];
    if (length < 2 || offset + length > bytes.length) break;
    descriptors.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  return descriptors;
}

function decodeStringDescriptor(descriptor: Uint8Array): string {
  const length = Math.min(descriptor[0] ?? 0, descriptor.length);
  let text = '';
  for (let offset = 2; offset + 1 < length; offset += 2) {
    text += String.fromCharCode(descriptor[offset] | (descriptor[offset + 1] << 8));
  }
  return text;
}

function transferError(error: unknown, context: string): DfuError {
  if (error instanceof DfuError) return error;
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'NotFoundError' || /disconnected/i.test(message)) {
    return new DfuError('disconnected', `${context} failed: the calculator was disconnected`, { cause: error });
  }
  return new DfuError('transfer-failed', `${context} failed: ${message}`, { cause: error });
}
