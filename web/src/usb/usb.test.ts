import { describe, expect, it } from 'vitest';
import { Calculator, EXTERNAL_FLASH_LAYOUT, type CalculatorInfo, type InstalledApp } from './calculator';
import { DfuClient, DfuError, DfuRequest, DfuState, DfuStatus } from './dfu';
import { CalculatorError } from './errors';
import { FakeDfuDevice, type FakeDfuDeviceOptions } from './fake-device';
import {
  parseAppName,
  parseKernelHeader,
  parseSlotInfo,
  parseUserlandHeader,
  readAppChain,
  type MemoryReader,
} from './firmware';
import { InstallError, InsufficientSpaceError, install, planInstall, type InstallStage } from './install';
import { parseMemoryLayout, sectorsInRange, tryParseMemoryLayout } from './layout';
import {
  MOCK_EXTERNAL_APPS_FLASH_END as APPS_END,
  MOCK_EXTERNAL_APPS_FLASH_START as APPS_START,
  MockCalculator,
  buildMockApp,
  compressLz4Block,
  createMockMemory,
  encodeKernelHeader,
  encodeSlotInfo,
  encodeUserlandHeader,
  mockIconPixels,
  type MockMemory,
} from './mock';
import { NWI_PIXEL_BYTES, decodeNwi, decompressLz4Block } from './nwi';

const KiB = 1024;
const SECTOR = 64 * KiB;

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected the promise to reject');
}

function flashReader(memory: MockMemory): MemoryReader {
  return async (address, length) => {
    const offset = address - memory.flashStart;
    return memory.flash.slice(offset, offset + length);
  };
}

function flashAt(memory: MockMemory, address: number, length: number): Uint8Array {
  const offset = address - memory.flashStart;
  return memory.flash.subarray(offset, offset + length);
}

function isErased(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0xff);
}

describe('firmware magics', () => {
  // Bytes as they sit in the calculator's memory (little-endian C++ constants).
  it('recognizes the slot info written by the firmware', () => {
    const bytes = new Uint8Array([0xba, 0xdb, 0xee, 0xef, 0, 0, 0, 0, 0x00, 0x00, 0x01, 0x90, 0xba, 0xdb, 0xee, 0xef]);
    expect(parseSlotInfo(bytes)).toEqual({ kernelHeaderAddress: 0, userlandHeaderAddress: 0x90010000 });
  });

  it('recognizes the kernel and userland headers', () => {
    const kernel = new Uint8Array(24);
    kernel.set([0xf0, 0x0d, 0xc0, 0xde], 0);
    kernel.set(new TextEncoder().encode('24.4.0'), 4);
    kernel.set([0xf0, 0x0d, 0xc0, 0xde], 20);
    expect(parseKernelHeader(kernel)?.version).toBe('24.4.0');
    const userland = new Uint8Array(48);
    userland.set([0xfe, 0xed, 0xc0, 0xde], 0);
    userland.set([0xfe, 0xed, 0xc0, 0xde], 44);
    expect(parseUserlandHeader(userland)).not.toBeNull();
  });
});

describe('parseMemoryLayout', () => {
  it('parses the NumWorks external flash layout', () => {
    const layout = parseMemoryLayout(EXTERNAL_FLASH_LAYOUT);
    expect(layout.name).toBe('Flash');
    expect(layout.segments).toEqual([
      { start: 0x90000000, end: 0x90008000, sectorSize: 4 * KiB, sectorCount: 8, readable: true, erasable: true, writable: true },
      { start: 0x90008000, end: 0x90010000, sectorSize: 32 * KiB, sectorCount: 1, readable: true, erasable: true, writable: true },
      { start: 0x90010000, end: 0x90800000, sectorSize: 64 * KiB, sectorCount: 127, readable: true, erasable: true, writable: true },
    ]);
  });

  it('parses several address blocks and trims the name', () => {
    const layout = parseMemoryLayout('@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg/0x90000000/08*004Kg');
    expect(layout.name).toBe('Internal Flash');
    expect(layout.segments.map((segment) => [segment.start, segment.sectorSize, segment.sectorCount])).toEqual([
      [0x08000000, 16 * KiB, 4],
      [0x08010000, 64 * KiB, 1],
      [0x08020000, 128 * KiB, 7],
      [0x90000000, 4 * KiB, 8],
    ]);
  });

  it('decodes multipliers and access letters', () => {
    const sram = parseMemoryLayout('@SRAM/0x24000000/01*256Ke').segments[0];
    expect(sram).toMatchObject({ end: 0x24040000, readable: true, erasable: false, writable: true });
    const option = parseMemoryLayout('@Option/0x1FFF0000/01*001Ma').segments[0];
    expect(option).toMatchObject({ sectorSize: 1024 * KiB, readable: true, erasable: false, writable: false });
    const bytes = parseMemoryLayout('@Raw/0x0/02*512 g').segments[0];
    expect(bytes).toMatchObject({ sectorSize: 512, end: 1024, erasable: true });
  });

  it('rejects malformed descriptors', () => {
    for (const bad of ['Flash/0x0/01*4Kg', '@Flash/0x90000000', '@Flash/zzz/01*4Kg', '@Flash/0x0/4Kg', '@Flash/0x0/01*4Kz']) {
      expect(() => parseMemoryLayout(bad)).toThrow(SyntaxError);
      expect(tryParseMemoryLayout(bad)).toBeNull();
    }
    expect(tryParseMemoryLayout(null)).toBeNull();
  });
});

describe('sectorsInRange', () => {
  const layout = parseMemoryLayout(EXTERNAL_FLASH_LAYOUT);

  it('lists every sector overlapping an unaligned range across segments', () => {
    const sectors = sectorsInRange(layout, 0x90007000, 0x90010001);
    expect(sectors.map((sector) => [sector.start, sector.size])).toEqual([
      [0x90007000, 4 * KiB],
      [0x90008000, 32 * KiB],
      [0x90010000, 64 * KiB],
    ]);
  });

  it('lists exactly the covered sectors of an aligned range', () => {
    expect(sectorsInRange(layout, APPS_START, APPS_START + 2 * SECTOR).map((sector) => sector.start)).toEqual([
      APPS_START,
      APPS_START + SECTOR,
    ]);
    expect(sectorsInRange(layout, APPS_START, APPS_START)).toEqual([]);
  });

  it('throws for ranges outside the layout', () => {
    expect(() => sectorsInRange(layout, 0x907f0000, 0x90800001)).toThrow(RangeError);
    expect(() => sectorsInRange(layout, 0x8fffffff, 0x90000010)).toThrow(RangeError);
  });
});

describe('firmware headers', () => {
  it('parses the slot info', () => {
    expect(parseSlotInfo(encodeSlotInfo(0x90000008, 0x90010008))).toEqual({
      kernelHeaderAddress: 0x90000008,
      userlandHeaderAddress: 0x90010008,
    });
    const corrupt = encodeSlotInfo(0x90000008, 0x90010008);
    corrupt[12] ^= 0xff;
    expect(parseSlotInfo(corrupt)).toBeNull();
    expect(parseSlotInfo(new Uint8Array(16))).toBeNull();
  });

  it('parses the kernel header', () => {
    expect(parseKernelHeader(encodeKernelHeader('23.2.0', 'a1b2c3d4'))).toEqual({ version: '23.2.0', patch: 'a1b2c3d4' });
    expect(parseKernelHeader(new Uint8Array(24))).toBeNull();
  });

  it('parses a complete userland header', () => {
    const header = {
      expectedVersion: '23.2.0',
      storageAddress: 0x2400a000,
      storageSize: 0xf000,
      externalAppsFlashStart: APPS_START,
      externalAppsFlashEnd: APPS_END,
      externalAppsRamStart: 0x24020000,
      externalAppsRamEnd: 0x24040000,
      deviceNameFlashStart: 0x903f0000,
      deviceNameFlashEnd: 0x903f1000,
    };
    const bytes = encodeUserlandHeader(header);
    expect(bytes.length).toBe(48);
    expect(parseUserlandHeader(bytes)).toEqual(header);
  });

  it('reports fields missing from older userland headers as undefined', () => {
    const encoded = encodeUserlandHeader({
      expectedVersion: '16.3.0',
      storageAddress: 0x20000400,
      storageSize: 0x8000,
      externalAppsFlashStart: 0x90400000,
      externalAppsFlashEnd: 0x90800000,
    });
    // Whatever follows the header in flash is also read.
    const bytes = new Uint8Array(48).fill(0xab);
    bytes.set(encoded);
    expect(parseUserlandHeader(bytes)).toEqual({
      expectedVersion: '16.3.0',
      storageAddress: 0x20000400,
      storageSize: 0x8000,
      externalAppsFlashStart: 0x90400000,
      externalAppsFlashEnd: 0x90800000,
    });
    expect(parseUserlandHeader(new Uint8Array(48))).toBeNull();
  });
});

describe('app chain', () => {
  const specs = [
    { name: 'Snake', size: 0x16400 },
    { name: 'Chemistry', size: 3 * SECTOR, numnotes: { projectId: 0xcafebabe, formatVersion: 2 } },
    { name: 'Été', size: SECTOR, iconColor: 0x001f },
  ];

  it('walks the chain, detecting NumNotes apps and decoding icons', async () => {
    const memory = createMockMemory({ apps: specs });
    const apps = await readAppChain(flashReader(memory), APPS_START, APPS_END);
    expect(apps.map(({ address, size, rawSize, name }) => ({ address, size, rawSize, name }))).toEqual([
      { address: APPS_START, size: 2 * SECTOR, rawSize: 0x16400, name: 'Snake' },
      { address: APPS_START + 2 * SECTOR, size: 3 * SECTOR, rawSize: 3 * SECTOR, name: 'Chemistry' },
      { address: APPS_START + 5 * SECTOR, size: SECTOR, rawSize: SECTOR, name: 'Été' },
    ]);
    expect(apps[0].numnotes).toBeUndefined();
    expect(apps[1].numnotes).toEqual({
      formatVersion: 2,
      projectId: 0xcafebabe,
      storeAddress: APPS_START + 4 * SECTOR,
    });
    expect(apps[2].numnotes).toBeUndefined();
    expect(apps[2].iconRgba?.length).toBe(55 * 56 * 4);
    expect([...apps[2].iconRgba!.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
  });

  it('stops at the end of the external apps area', async () => {
    const memory = createMockMemory({ apps: specs });
    const apps = await readAppChain(flashReader(memory), APPS_START, APPS_START + 5 * SECTOR);
    expect(apps.map((app) => app.name)).toEqual(['Snake', 'Chemistry']);
  });

  it('stops at the first address without an app header', async () => {
    const memory = createMockMemory({ apps: specs });
    flashAt(memory, APPS_START + 2 * SECTOR, 4).fill(0);
    const apps = await readAppChain(flashReader(memory), APPS_START, APPS_END);
    expect(apps.map((app) => app.name)).toEqual(['Snake']);
    expect(await readAppChain(flashReader(createMockMemory({ apps: [] })), APPS_START, APPS_END)).toEqual([]);
  });

  it('finds the NumNotes marker at the 4-byte boundary after the name', () => {
    for (let length = 1; length <= 9; length++) {
      const name = 'n'.repeat(length);
      const markerOffset = Math.ceil((length + 1) / 4) * 4;
      const bytes = new Uint8Array(markerOffset + 12).fill(0);
      bytes.set(new TextEncoder().encode(name));
      const view = new DataView(bytes.buffer);
      view.setUint32(markerOffset, 0x544e4d4e, true);
      view.setUint32(markerOffset + 4, 1, true);
      view.setUint32(markerOffset + 8, 1234, true);
      expect(parseAppName(bytes)).toEqual({ name, numnotes: { formatVersion: 1, projectId: 1234 } });
      expect(new TextDecoder().decode(bytes.subarray(markerOffset, markerOffset + 4))).toBe('NMNT');
    }
    expect(parseAppName(new TextEncoder().encode('Plain\0\0\0junkjunkjunk'))).toEqual({ name: 'Plain' });
  });
});

describe('nwi icons', () => {
  it('decodes RGB565 pixels to RGBA', () => {
    const pixels = new Uint8Array(NWI_PIXEL_BYTES).fill(0xff);
    pixels.set([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00, 0x00, 0x00], 0);
    const rgba = decodeNwi(compressLz4Block(pixels));
    expect([...rgba.subarray(0, 20)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('round-trips through the compressor', () => {
    const pixels = mockIconPixels(0xfb20);
    const compressed = compressLz4Block(pixels);
    expect(compressed.length).toBeLessThan(1000);
    expect(decompressLz4Block(compressed, pixels.length)).toEqual(pixels);

    const mixed = new Uint8Array(5000);
    for (let i = 3000; i < mixed.length; i++) mixed[i] = (i * 7919) % 251;
    expect(decompressLz4Block(compressLz4Block(mixed), mixed.length)).toEqual(mixed);
  });

  it('handles matches that overlap their own output', () => {
    const block = Uint8Array.of(0x26, 0x61, 0x62, 0x02, 0x00, 0x50, 0x78, 0x78, 0x78, 0x78, 0x78);
    expect(new TextDecoder().decode(decompressLz4Block(block, 17))).toBe('abababababab' + 'xxxxx');
  });

  it('rejects malformed blocks', () => {
    expect(() => decompressLz4Block(Uint8Array.of(0x10, 0x61, 0x05, 0x00), 10)).toThrow();
    expect(() => decompressLz4Block(Uint8Array.of(0x30, 0x61, 0x62), 3)).toThrow();
    expect(() => decompressLz4Block(Uint8Array.of(0x20, 0x61, 0x62), 3)).toThrow();
    expect(() => decodeNwi(Uint8Array.of(0x00))).toThrow();
  });
});

describe('planInstall', () => {
  const info: CalculatorInfo = {
    model: 'N0120',
    serial: 'test',
    firmwareVersion: '23.2.0',
    externalAppsFlashStart: APPS_START,
    externalAppsFlashEnd: APPS_START + 10 * SECTOR,
    sramStart: 0x24000000,
  };

  function app(slot: number, sectors: number, projectId?: number): InstalledApp {
    const address = APPS_START + slot * SECTOR;
    return {
      address,
      size: sectors * SECTOR,
      rawSize: sectors * SECTOR,
      name: `app ${slot}`,
      apiLevel: 0,
      numnotes: projectId === undefined ? undefined : { formatVersion: 1, projectId, storeAddress: address + (sectors - 1) * SECTOR },
    };
  }

  it('appends to an empty area', () => {
    const plan = planInstall(info, [], 7, 2 * SECTOR);
    expect(plan).toMatchObject({ address: APPS_START, keeps: [], removes: [], freeBytesAfter: 8 * SECTOR, lastInChain: true });
    expect(plan.replaces).toBeUndefined();
  });

  it('appends after the last app when the project is not installed', () => {
    const apps = [app(0, 1), app(1, 2, 3)];
    const plan = planInstall(info, apps, 7, 0x18000);
    expect(plan).toMatchObject({ address: APPS_START + 3 * SECTOR, keeps: apps, removes: [], imageSize: 0x18000 });
    expect(plan.freeBytesAfter).toBe(5 * SECTOR);
  });

  it('replaces the last app in the chain where it is, even if it grows', () => {
    const apps = [app(0, 1), app(1, 2, 7)];
    const plan = planInstall(info, apps, 7, 4 * SECTOR);
    expect(plan).toMatchObject({ address: APPS_START + SECTOR, replaces: apps[1], keeps: [apps[0]], removes: [], lastInChain: true });
    expect(plan.freeBytesAfter).toBe(5 * SECTOR);
  });

  it('replaces an app in place when the new version fits its slot', () => {
    const apps = [app(0, 2, 7), app(2, 1)];
    const same = planInstall(info, apps, 7, 2 * SECTOR);
    expect(same).toMatchObject({ address: APPS_START, replaces: apps[0], keeps: [apps[1]], removes: [], lastInChain: false });
    expect(same.imageSize).toBe(2 * SECTOR);
    expect(same.freeBytesAfter).toBe(7 * SECTOR);
    // A smaller version must still fill the slot, or the next app would become unreachable.
    expect(planInstall(info, apps, 7, SECTOR).imageSize).toBe(2 * SECTOR);
  });

  it('lists the apps to remove when a version outgrows a slot in the middle', () => {
    const apps = [app(0, 1), app(1, 1, 7), app(2, 1), app(3, 2)];
    const plan = planInstall(info, apps, 7, 2 * SECTOR);
    expect(plan).toMatchObject({
      address: APPS_START + SECTOR,
      replaces: apps[1],
      keeps: [apps[0]],
      removes: [apps[1], apps[2], apps[3]],
      lastInChain: true,
      freeBytesAfter: 7 * SECTOR,
    });
  });

  it('only matches NumNotes apps with the same project id', () => {
    const apps = [app(0, 1), app(1, 1, 8)];
    expect(planInstall(info, apps, 7, SECTOR).address).toBe(APPS_START + 2 * SECTOR);
  });

  it('reports how many bytes are missing', () => {
    const error = (() => {
      try {
        planInstall(info, [app(0, 8)], 7, 3 * SECTOR - 100);
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(InsufficientSpaceError);
    expect(error).toMatchObject({ code: 'insufficient-space', requiredBytes: 3 * SECTOR, availableBytes: 2 * SECTOR, missingBytes: SECTOR });
    expect(() => planInstall(info, [app(0, 1, 7), app(1, 8)], 7, 11 * SECTOR)).toThrow(InsufficientSpaceError);
    expect(() => planInstall(info, [], 7, 0)).toThrow(InstallError);
  });
});

describe('install on the mock calculator', () => {
  const notes = new TextEncoder().encode('Mitochondria: the powerhouse of the cell');

  function recordProgress() {
    const events: { stage: InstallStage; fraction: number }[] = [];
    return { events, onProgress: (stage: InstallStage, fraction: number) => events.push({ stage, fraction }) };
  }

  it('appends an app, terminates the chain and reboots', async () => {
    const calc = new MockCalculator();
    const info = await calc.info();
    const before = await calc.listApps();
    const chainEnd = before[1].address + before[1].size;
    // A stale app right after the new one must not show up once installed.
    calc.memory.flash.set(buildMockApp({ name: 'Stale' }), chainEnd + 2 * SECTOR - calc.memory.flashStart);

    const image = buildMockApp({ name: 'Physics', size: 2 * SECTOR, numnotes: { projectId: 99 } });
    const plan = planInstall(info, before, 99, image.length);
    expect(plan.address).toBe(chainEnd);
    const progress = recordProgress();
    await install(calc, plan, image, { onProgress: progress.onProgress });

    expect(flashAt(calc.memory, plan.address, image.length)).toEqual(image);
    expect(isErased(flashAt(calc.memory, plan.address + image.length, SECTOR))).toBe(true);
    expect(calc.rebootCount).toBe(1);
    const after = await calc.listApps();
    expect(after.map((app) => app.name)).toEqual(['Snake', 'Biology Notes', 'Physics']);
    expect(after[2].numnotes?.projectId).toBe(99);

    const stages = new Set(progress.events.map((event) => event.stage));
    expect([...stages]).toEqual(['erasing', 'writing', 'verifying', 'rebooting']);
    const fractions = progress.events.map((event) => event.fraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.at(-1)).toBe(1);
  });

  it('replaces the last NumNotes app and keeps its notes store', async () => {
    const calc = new MockCalculator({
      apps: [{ name: 'Snake' }, { name: 'Bio v1', size: 3 * SECTOR, numnotes: { projectId: 5, store: notes } }],
    });
    const image = buildMockApp({ name: 'Bio v2', size: 2 * SECTOR, numnotes: { projectId: 5, formatVersion: 2 } });
    const plan = planInstall(await calc.info(), await calc.listApps(), 5, image.length);
    expect(plan.replaces?.name).toBe('Bio v1');
    await install(calc, plan, image, { preserveStore: true });

    const apps = await calc.listApps();
    expect(apps.map((app) => [app.name, app.rawSize])).toEqual([
      ['Snake', SECTOR],
      ['Bio v2', 2 * SECTOR],
    ]);
    const store = await calc.readNotesStore(apps[1]);
    expect(store.length).toBe(SECTOR);
    expect(store.subarray(0, notes.length)).toEqual(notes);
    expect(isErased(store.subarray(notes.length))).toBe(true);
    // The rest of the image is the new version; the old app's leftover sector now ends the chain.
    expect(flashAt(calc.memory, plan.address, SECTOR)).toEqual(image.subarray(0, SECTOR));
    expect(isErased(flashAt(calc.memory, plan.address + 2 * SECTOR, SECTOR))).toBe(true);
  });

  it('uses the new image’s store unless asked to preserve the old one', async () => {
    const calc = new MockCalculator({ apps: [{ name: 'Bio v1', numnotes: { projectId: 5, store: notes } }] });
    const image = buildMockApp({ name: 'Bio v2', numnotes: { projectId: 5 } });
    await install(calc, planInstall(await calc.info(), await calc.listApps(), 5, image.length), image);
    const [app] = await calc.listApps();
    expect(isErased(await calc.readNotesStore(app))).toBe(true);
  });

  it('replaces an app in place without touching the apps after it', async () => {
    const calc = new MockCalculator({
      apps: [{ name: 'Bio v1', size: 2 * SECTOR, numnotes: { projectId: 5, store: notes } }, { name: 'Snake', size: 0x12345 }],
    });
    const [, snake] = await calc.listApps();
    const snakeBytes = flashAt(calc.memory, snake.address, snake.size).slice();
    const plan = planInstall(await calc.info(), await calc.listApps(), 5, SECTOR);
    expect(plan).toMatchObject({ lastInChain: false, imageSize: 2 * SECTOR });

    expect(await rejection(install(calc, plan, new Uint8Array(SECTOR)))).toMatchObject({ code: 'invalid-image' });

    const image = buildMockApp({ name: 'Bio v2', size: plan.imageSize, numnotes: { projectId: 5 } });
    await install(calc, plan, image, { preserveStore: true });
    const apps = await calc.listApps();
    expect(apps.map((app) => app.name)).toEqual(['Bio v2', 'Snake']);
    expect(flashAt(calc.memory, snake.address, snake.size)).toEqual(snakeBytes);
    expect((await calc.readNotesStore(apps[0])).subarray(0, notes.length)).toEqual(notes);
  });

  it('removes the apps after a version that outgrew its slot', async () => {
    const calc = new MockCalculator({
      apps: [{ name: 'Bio v1', numnotes: { projectId: 5 } }, { name: 'Snake' }, { name: 'Tetris' }],
    });
    const image = buildMockApp({ name: 'Bio v2', size: 3 * SECTOR, numnotes: { projectId: 5 } });
    const plan = planInstall(await calc.info(), await calc.listApps(), 5, image.length);
    expect(plan.removes.map((app) => app.name)).toEqual(['Bio v1', 'Snake', 'Tetris']);
    await install(calc, plan, image);
    expect((await calc.listApps()).map((app) => app.name)).toEqual(['Bio v2']);
  });

  it('fails when the written data does not verify', async () => {
    const calc = new MockCalculator();
    const image = buildMockApp({ name: 'Physics', numnotes: { projectId: 99 } });
    const plan = planInstall(await calc.info(), await calc.listApps(), 99, image.length);
    calc.injectFault({ operation: 'program', kind: 'corrupt' });
    const error = await rejection(install(calc, plan, image));
    expect(error).toBeInstanceOf(CalculatorError);
    expect(error).toMatchObject({ code: 'verify-failed' });
    expect(calc.rebootCount).toBe(0);
  });

  it('refuses to write outside the external apps area', async () => {
    const calc = new MockCalculator();
    expect(await rejection(calc.writeFlash(0x90010000, new Uint8Array(16)))).toMatchObject({ code: 'out-of-range' });
    expect(await rejection(calc.writeFlash(APPS_END - 8, new Uint8Array(16)))).toMatchObject({ code: 'out-of-range' });
  });

  it('keeps the rest of a partially written sector', async () => {
    const calc = new MockCalculator();
    const [snake] = await calc.listApps();
    const before = flashAt(calc.memory, snake.address, SECTOR).slice();
    await calc.writeFlash(snake.address + 0x100, new Uint8Array(16).fill(0x42));
    const expected = before.slice();
    expected.fill(0x42, 0x100, 0x110);
    expect(flashAt(calc.memory, snake.address, SECTOR)).toEqual(expected);
  });

  it('rejects stores of non-NumNotes apps', async () => {
    const calc = new MockCalculator();
    const [snake] = await calc.listApps();
    expect(await rejection(calc.readNotesStore(snake))).toMatchObject({ code: 'not-numnotes' });
  });

  it('notifies disconnect listeners when rebooting', async () => {
    const calc = new MockCalculator();
    let disconnects = 0;
    const unsubscribe = calc.onDisconnect(() => disconnects++);
    await calc.reboot();
    unsubscribe();
    calc.unplug();
    expect(disconnects).toBe(1);
  });
});

function fakeDevice(options: FakeDfuDeviceOptions = {}) {
  const clock = { now: 0 };
  const device = new FakeDfuDevice({ clock, ...options });
  const sleep = async (milliseconds: number) => {
    clock.now += milliseconds;
  };
  return { device, clock, sleep };
}

async function openClient(options: FakeDfuDeviceOptions = {}) {
  const { device, clock, sleep } = fakeDevice(options);
  const client = new DfuClient(device, { sleep });
  await client.open();
  return { device, clock, client };
}

function classOut(device: FakeDfuDevice, request: number, value: number, data?: Uint8Array) {
  return device.controlTransferOut({ requestType: 'class', recipient: 'interface', request, value, index: 0 }, data);
}

function command(code: number, address: number): Uint8Array {
  const payload = new Uint8Array(5);
  payload[0] = code;
  new DataView(payload.buffer).setUint32(1, address, true);
  return payload;
}

describe('DfuClient against a fake DfuSe device', () => {
  it('claims the DFU interface and parses the memory layouts', async () => {
    const { device, client } = await openClient();
    expect(device.claimed).toBe(true);
    expect(client.alternates.map((alt) => alt.alternateSetting)).toEqual([0, 1]);
    expect(client.memoryLayout(0)?.segments[0].start).toBe(0x90000000);
    expect(client.memoryLayout(1)?.segments[0].start).toBe(0x24000000);
  });

  it('reads interface strings from the descriptors when WebUSB lacks them', async () => {
    const { client } = await openClient({ exposeInterfaceNames: false });
    expect(client.alternates[0].name).toBe(EXTERNAL_FLASH_LAYOUT);
    expect(client.memoryLayout(1)?.name).toBe('SRAM');
  });

  it('executes a command only when GETSTATUS is sent', async () => {
    const { device, client } = await openClient();
    await classOut(device, DfuRequest.download, 0, command(0x21, 0x90250000));
    expect(device.addressPointer).toBe(0);
    expect((await client.getStatus()).state).toBe(DfuState.downloadBusy);
    expect(device.addressPointer).toBe(0x90250000);
    expect((await client.getStatus()).state).toBe(DfuState.downloadIdle);

    await client.setAddress(0x90260000);
    expect(device.addressPointer).toBe(0x90260000);
  });

  it('erases a sector, honouring bwPollTimeout', async () => {
    const { device, client, clock } = await openClient({ erasePollTimeout: 40 });
    await client.selectAlternate(0);
    await client.eraseSector(0x90260010);
    expect(device.erasedSectors).toEqual([0x90260000]);
    expect(isErased(flashAt(device.memory, 0x90260000, SECTOR))).toBe(true);
    expect(clock.now).toBeGreaterThanOrEqual(40);
    expect(device.pollViolations).toBe(0);
  });

  it('uploads in 2048-byte blocks with a short final block', async () => {
    const { device, client } = await openClient();
    await client.selectAlternate(0);
    const progress: number[] = [];
    const data = await client.upload(APPS_START + 10, 5000, (fraction) => progress.push(fraction));
    expect(data).toEqual(flashAt(device.memory, APPS_START + 10, 5000));
    const uploads = device.log.filter((entry) => entry.request === DfuRequest.upload);
    expect(uploads.map((entry) => [entry.value, entry.length])).toEqual([
      [2, 2048],
      [3, 2048],
      [4, 904],
    ]);
    expect(progress.at(-1)).toBe(1);
    expect(device.state).toBe(DfuState.idle);
  });

  it('reads SRAM through alternate setting 1', async () => {
    const { device, client } = await openClient();
    await client.selectAlternate(1);
    expect(await client.upload(0x24000000, 16)).toEqual(device.memory.sram.subarray(0, 16));
  });

  it('downloads blocks into erased flash, skipping blank ones', async () => {
    const { device, client } = await openClient();
    await client.selectAlternate(0);
    await client.eraseSector(0x90260000);
    const data = new Uint8Array(6000).map((_, i) => (i * 13) & 0xff);
    data.fill(0xff, 2048, 4096);
    await client.download(0x90260000, data, undefined, { skipBlankBlocks: true });
    expect(device.writtenBlocks).toBe(2);
    expect(flashAt(device.memory, 0x90260000, data.length)).toEqual(data);
    expect(device.pollViolations).toBe(0);
  });

  it('reports and clears a device error', async () => {
    const { device, client } = await openClient();
    await client.selectAlternate(0);
    device.failNextCommand(DfuStatus.errErase);
    const error = await rejection(client.eraseSector(0x90260000));
    expect(error).toBeInstanceOf(DfuError);
    expect(error).toMatchObject({ reason: 'device-error', status: DfuStatus.errErase, state: DfuState.error });
    expect(error.message).toMatch(/erasing memory failed/);
    expect(device.state).toBe(DfuState.idle);
    await client.eraseSector(0x90260000);
    expect(device.erasedSectors).toEqual([0x90260000]);
  });

  it('turns a stalled request into a DfuError with the device status', async () => {
    const { device, client } = await openClient();
    await client.selectAlternate(0);
    const error = await rejection(client.upload(0x90800000, 16));
    expect(error).toMatchObject({ reason: 'stall', status: DfuStatus.errAddress });
    expect(device.state).toBe(DfuState.idle);
  });

  it('recovers to dfuIDLE without running a pending command', async () => {
    const { device, client } = await openClient();
    await client.selectAlternate(0);
    device.state = DfuState.error;
    device.status = DfuStatus.errUnknown;
    await client.ensureIdle();
    expect(device.state).toBe(DfuState.idle);

    await classOut(device, DfuRequest.download, 0, command(0x41, 0x90260000));
    expect(device.state).toBe(DfuState.downloadSync);
    const logged = device.log.length;
    await client.ensureIdle();
    expect(device.state).toBe(DfuState.idle);
    expect(device.erasedSectors).toEqual([]);
    expect(device.log.slice(logged).map((entry) => entry.request)).toEqual([
      DfuRequest.getState,
      DfuRequest.abort,
      DfuRequest.getState,
    ]);
  });

  it('leaves DFU mode even though the device disappears', async () => {
    const { device, client } = await openClient();
    await client.selectAlternate(0);
    await client.leave(APPS_START);
    expect(device.leftDfu).toBe(true);
    expect(device.leaveAddress).toBe(APPS_START);
    expect(client.isOpen).toBe(false);
    await client.close();
  });
});

describe('Calculator over a fake DfuSe device', () => {
  function calculator(options: FakeDfuDeviceOptions = {}) {
    const { device, sleep } = fakeDevice(options);
    return { device, calc: new Calculator(device, { sleep }) };
  }

  it('reads the model, serial and firmware details', async () => {
    const { calc } = calculator();
    expect(await calc.info()).toEqual({
      model: 'N0120',
      serial: '0042004A3438510C31363631',
      firmwareVersion: '23.2.0',
      firmwarePatch: undefined,
      externalAppsFlashStart: APPS_START,
      externalAppsFlashEnd: APPS_END,
      externalAppsRamStart: 0x24020000,
      externalAppsRamEnd: 0x24040000,
      storageAddress: 0x2400a000,
      storageSize: 0xf000,
      sramStart: 0x24000000,
    });
  });

  it('uses the N0110 memory map', async () => {
    const { calc } = calculator({ memory: createMockMemory({ model: 'N0110' }), exposeInterfaceNames: false });
    expect(await calc.info()).toMatchObject({ model: 'N0110', sramStart: 0x20000000 });
  });

  it('lists installed apps', async () => {
    const { calc } = calculator();
    const apps = await calc.listApps();
    expect(apps.map((app) => app.name)).toEqual(['Snake', 'Biology Notes']);
    expect(apps[1].numnotes?.projectId).toBe(0x1a2b3c4d);
    expect(apps[0].iconRgba?.length).toBe(55 * 56 * 4);
  });

  it('installs, verifies and reboots end to end', async () => {
    const notes = new TextEncoder().encode('notes written on the calculator');
    const memory = createMockMemory({
      apps: [{ name: 'Snake' }, { name: 'Bio v1', size: 3 * SECTOR, numnotes: { projectId: 5, store: notes } }],
    });
    const { device, calc } = calculator({ memory, flashLayout: `@Flash/0x08000000/04*016Kg,01*064Kg/${EXTERNAL_FLASH_LAYOUT.slice(7)}` });
    const image = buildMockApp({ name: 'Bio v2', size: 2 * SECTOR, numnotes: { projectId: 5 } });
    const plan = planInstall(await calc.info(), await calc.listApps(), 5, image.length);
    await install(calc, plan, image, { preserveStore: true });

    const expected = image.slice();
    expected.fill(0xff, SECTOR);
    expected.set(notes, SECTOR);
    expect(flashAt(device.memory, plan.address, image.length)).toEqual(expected);
    expect(isErased(flashAt(device.memory, plan.address + image.length, SECTOR))).toBe(true);
    expect(device.erasedSectors).toEqual([plan.address, plan.address + SECTOR, plan.address + 2 * SECTOR]);
    expect(device.massEraseRequested).toBe(false);
    expect(device.pollViolations).toBe(0);
    expect(device.leftDfu).toBe(true);
    expect(device.leaveAddress).toBe(APPS_START);
  });

  it('rejects the N0100', async () => {
    const { calc } = calculator({ bcdDevice: 0x0100 });
    const error = await rejection(calc.info());
    expect(error).toBeInstanceOf(CalculatorError);
    expect(error).toMatchObject({ code: 'unsupported-model' });
  });

  it('finds the userland header without slot info', async () => {
    const { calc } = calculator({ memory: createMockMemory({ legacyFirmware: true }) });
    const info = await calc.info();
    expect(info.externalAppsFlashStart).toBe(APPS_START);
    expect(info.firmwareVersion).toBe('23.2.0');
  });

  it('rejects a calculator whose software it can’t find', async () => {
    const memory = createMockMemory({ legacyFirmware: true });
    flashAt(memory, 0x90010008, 48).fill(0xff);
    const { calc } = calculator({ memory });
    const error = await rejection(calc.info());
    expect(error).toMatchObject({ code: 'unsupported-firmware' });
  });

  it('reads the kernel version when the slot info points to it', async () => {
    const { calc } = calculator({ memory: createMockMemory({ kernelInSlotInfo: true, firmwareVersion: '24.1.0', firmwarePatch: 'abc1234' }) });
    const info = await calc.info();
    expect(info.firmwareVersion).toBe('24.1.0');
    expect(info.firmwarePatch).toBe('abc1234');
  });
});
