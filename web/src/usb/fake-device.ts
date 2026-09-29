// A fake USBDevice emulating a NumWorks calculator's DfuSe interface over a
// MockMemory image, for exercising dfu.ts and Calculator without hardware.
// It follows the DFU 1.1 state machine: invalid requests stall and move to
// dfuERROR, and downloaded commands/blocks run during the GETSTATUS that
// moves the device from dfuDNLOAD-SYNC to dfuDNBUSY.

import { DfuRequest, DfuState, DfuStatus } from './dfu';
import { parseMemoryLayout, sectorsInRange, type MemoryLayout } from './layout';
import { createMockMemory, type MockMemory } from './mock';

const TRANSFER_SIZE = 2048;

export interface FakeDfuDeviceOptions {
  memory?: MockMemory;
  /** Overrides the model's bcdDevice, e.g. 0x0100 for an N0100. */
  bcdDevice?: number;
  serialNumber?: string;
  /** Report interface strings through WebUSB. When false, clients must read the descriptors. */
  exposeInterfaceNames?: boolean;
  /** Flash layout string of alternate setting 0. */
  flashLayout?: string;
  /** bwPollTimeout reported while erasing. */
  erasePollTimeout?: number;
  /** bwPollTimeout reported while writing a block. */
  writePollTimeout?: number;
  /** Virtual clock the client's sleep() advances; used to check poll timeouts are honoured. */
  clock?: { now: number };
}

type Pending =
  | { kind: 'command'; payload: Uint8Array }
  | { kind: 'data'; blockNumber: number; data: Uint8Array };

interface Region {
  start: number;
  bytes: Uint8Array;
}

export class FakeDfuDevice implements USBDevice {
  readonly vendorId = 0x0483;
  readonly productId = 0xa291;
  readonly productName = 'NumWorks Calculator';
  readonly manufacturerName = 'NumWorks';
  readonly serialNumber: string;
  readonly deviceVersionMajor: number;
  readonly deviceVersionMinor: number;
  readonly deviceVersionSubminor: number;
  readonly configurations: USBConfiguration[];
  configuration: USBConfiguration | null = null;
  opened = false;

  readonly memory: MockMemory;
  state: number = DfuState.idle;
  status: number = DfuStatus.ok;
  addressPointer = 0;
  alternateSetting = 0;
  claimed = false;

  /** Every class request received, for assertions. */
  readonly log: { request: number; value: number; length: number }[] = [];
  readonly erasedSectors: number[] = [];
  writtenBlocks = 0;
  pollViolations = 0;
  massEraseRequested = false;
  /** Set once the device left DFU mode; it is then gone from the bus. */
  leftDfu = false;
  leaveAddress?: number;

  private readonly flashLayout: MemoryLayout;
  private readonly flashLayoutString: string;
  private readonly exposeInterfaceNames: boolean;
  private readonly erasePollTimeout: number;
  private readonly writePollTimeout: number;
  private readonly clock: { now: number };
  private pending: Pending | null = null;
  private busyUntil = 0;
  private afterBusy: { state: number; status: number } = { state: DfuState.downloadIdle, status: DfuStatus.ok };
  private failNext: number | null = null;

  constructor(options: FakeDfuDeviceOptions = {}) {
    this.memory = options.memory ?? createMockMemory();
    const bcd = options.bcdDevice ?? this.memory.bcdDevice;
    this.deviceVersionMajor = bcd >> 8;
    this.deviceVersionMinor = (bcd >> 4) & 0xf;
    this.deviceVersionSubminor = bcd & 0xf;
    this.serialNumber = options.serialNumber ?? '0042004A3438510C31363631';
    this.flashLayoutString = options.flashLayout ?? this.memory.flashLayout;
    this.flashLayout = parseMemoryLayout(this.flashLayoutString);
    this.exposeInterfaceNames = options.exposeInterfaceNames ?? true;
    this.erasePollTimeout = options.erasePollTimeout ?? 25;
    this.writePollTimeout = options.writePollTimeout ?? 2;
    this.clock = options.clock ?? { now: 0 };
    this.configurations = [this.buildConfiguration()];
  }

  /** The next executed command or block fails with this DFU status. */
  failNextCommand(status: number): void {
    this.failNext = status;
  }

  async open(): Promise<void> {
    this.assertPresent();
    this.opened = true;
  }

  async close(): Promise<void> {
    this.assertPresent();
    this.opened = false;
    this.claimed = false;
  }

  async selectConfiguration(configurationValue: number): Promise<void> {
    this.assertOpen();
    const configuration = this.configurations.find((config) => config.configurationValue === configurationValue);
    if (!configuration) throw new DOMException('Unknown configuration', 'NotFoundError');
    this.configuration = configuration;
  }

  async claimInterface(interfaceNumber: number): Promise<void> {
    this.assertOpen();
    if (interfaceNumber !== 0 || !this.configuration) throw new DOMException('Unknown interface', 'NotFoundError');
    this.claimed = true;
  }

  async releaseInterface(): Promise<void> {
    this.assertOpen();
    this.claimed = false;
  }

  async selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void> {
    this.assertClaimed(interfaceNumber);
    if (alternateSetting !== 0 && alternateSetting !== 1) throw new DOMException('Unknown alternate', 'NotFoundError');
    this.alternateSetting = alternateSetting;
  }

  async controlTransferOut(
    setup: USBControlTransferParameters,
    data?: ArrayBuffer | ArrayBufferView,
  ): Promise<USBOutTransferResult> {
    this.assertOpen();
    const bytes = toBytes(data);
    const stall: USBOutTransferResult = { bytesWritten: 0, status: 'stall' };
    if (setup.requestType !== 'class' || setup.recipient !== 'interface') return stall;
    this.assertClaimed(setup.index);
    this.log.push({ request: setup.request, value: setup.value, length: bytes.length });

    switch (setup.request) {
      case DfuRequest.download:
        return this.handleDownload(setup.value, bytes) ? { bytesWritten: bytes.length, status: 'ok' } : stall;
      case DfuRequest.clearStatus:
        if (this.state !== DfuState.error) return this.protocolError(stall);
        this.state = DfuState.idle;
        this.status = DfuStatus.ok;
        return { bytesWritten: 0, status: 'ok' };
      case DfuRequest.abort: {
        const abortable: number[] = [
          DfuState.idle,
          DfuState.downloadSync,
          DfuState.downloadIdle,
          DfuState.manifestSync,
          DfuState.uploadIdle,
        ];
        if (!abortable.includes(this.state)) return this.protocolError(stall);
        this.state = DfuState.idle;
        this.pending = null;
        return { bytesWritten: 0, status: 'ok' };
      }
      default:
        return this.protocolError(stall);
    }
  }

  async controlTransferIn(setup: USBControlTransferParameters, length: number): Promise<USBInTransferResult> {
    this.assertOpen();
    if (setup.requestType === 'standard' && setup.recipient === 'device' && setup.request === 6) {
      const descriptor = this.descriptor(setup.value >> 8, setup.value & 0xff);
      return descriptor ? ok(descriptor.subarray(0, length)) : { status: 'stall' };
    }
    if (setup.requestType !== 'class' || setup.recipient !== 'interface') return { status: 'stall' };
    this.assertClaimed(setup.index);
    this.log.push({ request: setup.request, value: setup.value, length });

    switch (setup.request) {
      case DfuRequest.getStatus:
        return this.handleGetStatus();
      case DfuRequest.getState:
        return ok(Uint8Array.of(this.state));
      case DfuRequest.upload:
        return this.handleUpload(setup.value, length);
      default:
        return this.protocolError({ status: 'stall' });
    }
  }

  private handleDownload(blockNumber: number, bytes: Uint8Array): boolean {
    if (this.state !== DfuState.idle && this.state !== DfuState.downloadIdle) return this.protocolError(false);
    if (bytes.length === 0) {
      if (blockNumber !== 0) return this.protocolError(false);
      this.state = DfuState.manifestSync;
      return true;
    }
    if (blockNumber === 1) return this.protocolError(false);
    this.pending = blockNumber === 0 ? { kind: 'command', payload: bytes } : { kind: 'data', blockNumber, data: bytes };
    this.state = DfuState.downloadSync;
    return true;
  }

  private handleGetStatus(): USBInTransferResult {
    switch (this.state) {
      case DfuState.downloadSync: {
        // Answer "busy", then execute, like a DfuSe device does.
        const pollTimeout = this.execute();
        this.state = DfuState.downloadBusy;
        this.busyUntil = this.clock.now + pollTimeout;
        return ok(statusBytes(DfuStatus.ok, pollTimeout, DfuState.downloadBusy));
      }
      case DfuState.downloadBusy:
        if (this.clock.now < this.busyUntil) this.pollViolations++;
        this.state = this.afterBusy.state;
        this.status = this.afterBusy.status;
        return ok(statusBytes(this.status, 0, this.state));
      case DfuState.manifestSync:
        this.state = DfuState.manifest;
        this.leftDfu = true;
        this.leaveAddress = this.addressPointer;
        // The device resets right after answering and leaves the bus.
        this.opened = false;
        this.claimed = false;
        return ok(statusBytes(DfuStatus.ok, 0, DfuState.manifest));
      default:
        return ok(statusBytes(this.status, 0, this.state));
    }
  }

  private handleUpload(blockNumber: number, length: number): USBInTransferResult {
    if (this.state !== DfuState.idle && this.state !== DfuState.uploadIdle) return this.protocolError({ status: 'stall' });
    if (blockNumber < 2 || length > TRANSFER_SIZE) return this.protocolError({ status: 'stall' });
    const address = this.addressPointer + (blockNumber - 2) * TRANSFER_SIZE;
    const region = this.currentRegion();
    const offset = address - region.start;
    if (offset < 0 || offset + length > region.bytes.length) {
      this.state = DfuState.error;
      this.status = DfuStatus.errAddress;
      return { status: 'stall' };
    }
    // A short frame ends the upload.
    this.state = length < TRANSFER_SIZE ? DfuState.idle : DfuState.uploadIdle;
    return ok(region.bytes.slice(offset, offset + length));
  }

  /** Runs the pending command or block; returns the poll timeout to report. */
  private execute(): number {
    const pending = this.pending;
    this.pending = null;
    let outcome: { status: number; pollTimeout: number };
    if (this.failNext !== null) {
      outcome = { status: this.failNext, pollTimeout: this.writePollTimeout };
      this.failNext = null;
    } else if (!pending) {
      outcome = { status: DfuStatus.errStalledPacket, pollTimeout: 0 };
    } else if (pending.kind === 'command') {
      outcome = this.executeCommand(pending.payload);
    } else {
      outcome = this.writeBlock(pending.blockNumber, pending.data);
    }
    this.afterBusy =
      outcome.status === DfuStatus.ok
        ? { state: DfuState.downloadIdle, status: DfuStatus.ok }
        : { state: DfuState.error, status: outcome.status };
    return outcome.pollTimeout;
  }

  private executeCommand(payload: Uint8Array): { status: number; pollTimeout: number } {
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    if (payload[0] === 0x21 && payload.length === 5) {
      this.addressPointer = view.getUint32(1, true);
      return { status: DfuStatus.ok, pollTimeout: 0 };
    }
    if (payload[0] === 0x41 && payload.length === 1) {
      this.massEraseRequested = true;
      return { status: DfuStatus.errTarget, pollTimeout: 0 };
    }
    if (payload[0] === 0x41 && payload.length === 5) {
      return this.eraseSector(view.getUint32(1, true));
    }
    return { status: DfuStatus.errStalledPacket, pollTimeout: 0 };
  }

  private eraseSector(address: number): { status: number; pollTimeout: number } {
    if (this.alternateSetting !== 0) return { status: DfuStatus.errTarget, pollTimeout: 0 };
    let sectorStart: number;
    let sectorSize: number;
    try {
      [{ start: sectorStart, size: sectorSize }] = sectorsInRange(this.flashLayout, address, address + 1);
    } catch {
      return { status: DfuStatus.errAddress, pollTimeout: 0 };
    }
    const offset = sectorStart - this.memory.flashStart;
    if (offset < 0 || offset + sectorSize > this.memory.flash.length) return { status: DfuStatus.errAddress, pollTimeout: 0 };
    this.memory.flash.fill(0xff, offset, offset + sectorSize);
    this.erasedSectors.push(sectorStart);
    return { status: DfuStatus.ok, pollTimeout: this.erasePollTimeout };
  }

  private writeBlock(blockNumber: number, data: Uint8Array): { status: number; pollTimeout: number } {
    const address = this.addressPointer + (blockNumber - 2) * TRANSFER_SIZE;
    const region = this.currentRegion();
    const offset = address - region.start;
    if (offset < 0 || offset + data.length > region.bytes.length) return { status: DfuStatus.errAddress, pollTimeout: 0 };
    const isFlash = this.alternateSetting === 0;
    // NOR flash can only clear bits; SRAM is plain memory.
    for (let i = 0; i < data.length; i++) {
      region.bytes[offset + i] = isFlash ? region.bytes[offset + i] & data[i] : data[i];
    }
    this.writtenBlocks++;
    return { status: DfuStatus.ok, pollTimeout: this.writePollTimeout };
  }

  private currentRegion(): Region {
    return this.alternateSetting === 0
      ? { start: this.memory.flashStart, bytes: this.memory.flash }
      : { start: this.memory.sramStart, bytes: this.memory.sram };
  }

  private protocolError<T>(result: T): T {
    this.state = DfuState.error;
    this.status = DfuStatus.errStalledPacket;
    return result;
  }

  private assertPresent(): void {
    if (this.leftDfu) throw new DOMException('The device was disconnected.', 'NotFoundError');
  }

  private assertOpen(): void {
    this.assertPresent();
    if (!this.opened) throw new DOMException('The device must be opened first.', 'InvalidStateError');
  }

  private assertClaimed(interfaceNumber: number): void {
    this.assertOpen();
    if (interfaceNumber !== 0 || !this.claimed) {
      throw new DOMException(`Interface ${interfaceNumber} is not claimed.`, 'InvalidStateError');
    }
  }

  private interfaceStrings(): string[] {
    return [this.flashLayoutString, this.memory.sramLayout];
  }

  private buildConfiguration(): USBConfiguration {
    const alternates: USBAlternateInterface[] = this.interfaceStrings().map((name, alternateSetting) => ({
      alternateSetting,
      interfaceClass: 0xfe,
      interfaceSubclass: 0x01,
      interfaceProtocol: 0x02,
      interfaceName: this.exposeInterfaceNames ? name : null,
    }));
    const device = this;
    const dfuInterface: USBInterface = {
      interfaceNumber: 0,
      alternates,
      get alternate() {
        return alternates[device.alternateSetting];
      },
      get claimed() {
        return device.claimed;
      },
    };
    return { configurationValue: 1, configurationName: null, interfaces: [dfuInterface] };
  }

  private descriptor(type: number, index: number): Uint8Array | null {
    const strings = this.interfaceStrings();
    if (type === 2 && index === 0) {
      const parts: number[][] = [];
      strings.forEach((_, alternateSetting) => {
        parts.push([9, 4, 0, alternateSetting, 0, 0xfe, 0x01, 0x02, 4 + alternateSetting]);
        // DFU functional descriptor: can download/upload, 2048-byte transfers, DFU 1.1a.
        parts.push([9, 0x21, 0x0b, 0xff, 0x00, TRANSFER_SIZE & 0xff, TRANSFER_SIZE >> 8, 0x1a, 0x01]);
      });
      const body = parts.flat();
      const total = 9 + body.length;
      return Uint8Array.from([9, 2, total & 0xff, total >> 8, 1, 1, 0, 0x80, 50, ...body]);
    }
    if (type === 3 && index === 0) return Uint8Array.of(4, 3, 0x09, 0x04);
    if (type === 3 && index >= 4 && index - 4 < strings.length) {
      const text = strings[index - 4];
      const bytes = new Uint8Array(2 + 2 * text.length);
      bytes[0] = bytes.length;
      bytes[1] = 3;
      for (let i = 0; i < text.length; i++) {
        bytes[2 + 2 * i] = text.charCodeAt(i) & 0xff;
        bytes[3 + 2 * i] = text.charCodeAt(i) >> 8;
      }
      return bytes;
    }
    return null;
  }
}

function toBytes(data: ArrayBuffer | ArrayBufferView | undefined): Uint8Array {
  if (!data) return new Uint8Array(0);
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

function ok(bytes: Uint8Array): USBInTransferResult {
  const copy = bytes.slice();
  return { status: 'ok', data: new DataView(copy.buffer, copy.byteOffset, copy.byteLength) };
}

function statusBytes(status: number, pollTimeout: number, state: number): Uint8Array {
  return Uint8Array.of(status, pollTimeout & 0xff, (pollTimeout >> 8) & 0xff, (pollTimeout >> 16) & 0xff, state, 0);
}
