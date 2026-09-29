// Deciding where a NumNotes app goes in the chain of installed apps, and
// writing it there.
//
// Installed apps are position-dependent (each is linked for its address), so
// installing must never move another app. Apps are chained: each one starts
// at the 64 KiB boundary following the previous one, and the chain ends at
// the first address without an app header.

import type { CalculatorInfo, CalculatorLike, FlashWritePhase, InstalledApp } from './calculator';
import { APP_ALIGNMENT, NOTES_STORE_SIZE, roundUpToAppAlignment } from './firmware';
import { formatAddress } from './layout';

export interface InstallPlan {
  /** Where the image must be linked for and written to. */
  address: number;
  /** The previous version of this project, when it is being replaced. */
  replaces?: InstalledApp;
  /** Apps left untouched. */
  keeps: InstalledApp[];
  /**
   * Apps that disappear and need the user's consent: the previous version of
   * this project (also in `replaces`) and every app after it. Empty unless
   * the new version outgrew a slot that isn't at the end of the chain.
   */
  removes: InstalledApp[];
  /** Free bytes left at the end of the external apps area after installing. */
  freeBytesAfter: number;
  projectId: number;
  /**
   * The exact length the image passed to install() must have. It is the
   * requested app size, except when replacing an app in place inside a larger
   * slot: then it is that slot's size, so the apps after it stay reachable.
   * Link the image with this size (padding before the notes store).
   */
  imageSize: number;
  /** Whether the new app ends the chain. */
  lastInChain: boolean;
}

export type InstallErrorCode = 'insufficient-space' | 'invalid-size' | 'invalid-image' | 'stale-plan';

export class InstallError extends Error {
  readonly code: InstallErrorCode;

  constructor(code: InstallErrorCode, message: string) {
    super(message);
    this.name = 'InstallError';
    this.code = code;
  }
}

export class InsufficientSpaceError extends InstallError {
  /** Bytes the app needs (rounded up to 64 KiB). */
  readonly requiredBytes: number;
  /** Bytes available at the install address. */
  readonly availableBytes: number;
  readonly missingBytes: number;

  constructor(requiredBytes: number, availableBytes: number) {
    const missingBytes = requiredBytes - availableBytes;
    super(
      'insufficient-space',
      `Not enough room on the calculator: the app needs ${formatKiB(requiredBytes)} but only ` +
        `${formatKiB(availableBytes)} is free (${formatKiB(missingBytes)} missing).`,
    );
    this.name = 'InsufficientSpaceError';
    this.requiredBytes = requiredBytes;
    this.availableBytes = availableBytes;
    this.missingBytes = missingBytes;
  }
}

/**
 * Chooses where to install an app of `appSize` bytes for `projectId`:
 * - a previous version at the end of the chain is replaced where it is;
 * - a previous version elsewhere is replaced in place if the new one fits its
 *   slot, otherwise it and every app after it must be removed (`removes`);
 * - otherwise the app is appended after the last one.
 * Throws InsufficientSpaceError if it doesn't fit before the end of the area.
 */
export function planInstall(
  info: CalculatorInfo,
  apps: InstalledApp[],
  projectId: number,
  appSize: number,
): InstallPlan {
  if (!Number.isInteger(appSize) || appSize <= 0) {
    throw new InstallError('invalid-size', `Invalid app size: ${appSize}`);
  }
  const areaEnd = info.externalAppsFlashEnd;
  const slotSize = roundUpToAppAlignment(appSize);
  const lastApp = apps.at(-1);
  const chainEnd = lastApp ? lastApp.address + lastApp.size : info.externalAppsFlashStart;
  const index = apps.findIndex((app) => app.numnotes?.projectId === projectId);
  const previous = index >= 0 ? apps[index] : undefined;

  if (previous && index < apps.length - 1 && slotSize <= previous.size) {
    return {
      address: previous.address,
      replaces: previous,
      keeps: apps.filter((app) => app !== previous),
      removes: [],
      freeBytesAfter: areaEnd - chainEnd,
      projectId,
      imageSize: slotSize === previous.size ? appSize : previous.size,
      lastInChain: false,
    };
  }

  const address = previous ? previous.address : chainEnd;
  if (address + slotSize > areaEnd) {
    throw new InsufficientSpaceError(slotSize, Math.max(0, areaEnd - address));
  }
  return {
    address,
    replaces: previous,
    keeps: previous ? apps.slice(0, index) : [...apps],
    removes: previous && index < apps.length - 1 ? apps.slice(index) : [],
    freeBytesAfter: areaEnd - (address + slotSize),
    projectId,
    imageSize: appSize,
    lastInChain: true,
  };
}

export type InstallStage = 'preserving-notes' | 'erasing' | 'writing' | 'verifying' | 'rebooting';

export interface InstallOptions {
  /**
   * When replacing a NumNotes app of the same project, carry its notes store
   * (the last 64 KiB) over into the new image so on-calculator notes survive.
   */
  preserveStore?: boolean;
  /** Restart the calculator afterwards. Defaults to true. */
  reboot?: boolean;
  /** `fraction` is the progress of the whole install (0..1); `stage` the current step. */
  onProgress?: (stage: InstallStage, fraction: number) => void;
}

const STAGE_BY_PHASE: Record<FlashWritePhase, InstallStage> = {
  erase: 'erasing',
  write: 'writing',
  verify: 'verifying',
};

/**
 * Writes `image` (linked for `plan.address`, `plan.imageSize` bytes, ending
 * with its 64 KiB notes store) according to `plan`, verifies it, and reboots.
 */
export async function install(
  calc: CalculatorLike,
  plan: InstallPlan,
  image: Uint8Array,
  options: InstallOptions = {},
): Promise<void> {
  const { onProgress } = options;
  const reboot = options.reboot ?? true;
  if (image.length !== plan.imageSize) {
    throw new InstallError('invalid-image', `The image is ${image.length} bytes but the plan expects ${plan.imageSize}`);
  }

  const info = await calc.info();
  const slotSize = roundUpToAppAlignment(image.length);
  if (plan.address < info.externalAppsFlashStart || plan.address + slotSize > info.externalAppsFlashEnd) {
    throw new InstallError('stale-plan', `The plan’s address ${formatAddress(plan.address)} is outside the external apps area`);
  }
  if (!plan.lastInChain && slotSize !== plan.replaces?.size) {
    throw new InstallError('stale-plan', 'The image doesn’t fill the slot of the app it replaces');
  }

  const preserveStore = options.preserveStore === true && plan.replaces?.numnotes?.projectId === plan.projectId;
  const writeStart = preserveStore ? 0.05 : 0;
  const writeEnd = reboot ? 0.97 : 1;

  let payload = new Uint8Array(slotSize).fill(0xff);
  payload.set(image);

  if (preserveStore && plan.replaces) {
    if (image.length < NOTES_STORE_SIZE || image.length % NOTES_STORE_SIZE !== 0) {
      throw new InstallError('invalid-image', 'The image must be a multiple of 64 KiB and end with its notes store');
    }
    onProgress?.('preserving-notes', 0);
    const store = await calc.readNotesStore(plan.replaces);
    payload.set(store, image.length - NOTES_STORE_SIZE);
  }

  if (plan.lastInChain && plan.address + slotSize + APP_ALIGNMENT <= info.externalAppsFlashEnd) {
    // An erased sector right after the last app ends the chain; otherwise
    // stale apps left further in flash would still be found.
    const terminated = new Uint8Array(slotSize + APP_ALIGNMENT).fill(0xff);
    terminated.set(payload);
    payload = terminated;
  }

  await calc.writeFlash(plan.address, payload, (fraction, phase) => {
    onProgress?.(STAGE_BY_PHASE[phase], writeStart + (writeEnd - writeStart) * fraction);
  });

  if (reboot) {
    onProgress?.('rebooting', writeEnd);
    await calc.reboot();
    onProgress?.('rebooting', 1);
  }
}

function formatKiB(bytes: number): string {
  return `${Math.ceil(bytes / 1024)} KiB`;
}
