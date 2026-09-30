export type CalculatorErrorCode =
  /** The browser has no WebUSB (not Chrome/Edge, or not a secure context). */
  | 'unsupported-browser'
  /** The user closed the device picker without choosing a calculator. */
  | 'no-device-selected'
  /** The device couldn't be opened or claimed (often: in use by another tab or app). */
  | 'connection-failed'
  /** An N0100, or an unrecognised model. */
  | 'unsupported-model'
  /** The firmware is too old or doesn't expose the headers we need. */
  | 'unsupported-firmware'
  /** An address range outside what this operation may touch. */
  | 'out-of-range'
  /** Flash content read back after writing didn't match. */
  | 'verify-failed'
  /** The app isn't a NumNotes app. */
  | 'not-numnotes';

export class CalculatorError extends Error {
  readonly code: CalculatorErrorCode;

  constructor(code: CalculatorErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CalculatorError';
    this.code = code;
  }
}

export const FIRMWARE_TOO_OLD_MESSAGE =
  'Couldn’t find the calculator’s software. Unplug it, plug it back in and try again. If that fails, download the app file instead.';
