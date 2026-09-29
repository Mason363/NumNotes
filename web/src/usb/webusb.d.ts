// The subset of the WebUSB API (https://wicg.github.io/webusb/) used by this
// folder. TypeScript's DOM library doesn't ship these types.

export {};

declare global {
  type USBRequestType = 'standard' | 'class' | 'vendor';
  type USBRecipient = 'device' | 'interface' | 'endpoint' | 'other';
  type USBTransferStatus = 'ok' | 'stall' | 'babble';

  interface USBControlTransferParameters {
    requestType: USBRequestType;
    recipient: USBRecipient;
    request: number;
    value: number;
    index: number;
  }

  interface USBInTransferResult {
    readonly data?: DataView | null;
    readonly status: USBTransferStatus;
  }

  interface USBOutTransferResult {
    readonly bytesWritten: number;
    readonly status: USBTransferStatus;
  }

  interface USBAlternateInterface {
    readonly alternateSetting: number;
    readonly interfaceClass: number;
    readonly interfaceSubclass: number;
    readonly interfaceProtocol: number;
    readonly interfaceName?: string | null;
  }

  interface USBInterface {
    readonly interfaceNumber: number;
    readonly alternate: USBAlternateInterface;
    readonly alternates: readonly USBAlternateInterface[];
    readonly claimed: boolean;
  }

  interface USBConfiguration {
    readonly configurationValue: number;
    readonly configurationName?: string | null;
    readonly interfaces: readonly USBInterface[];
  }

  interface USBDevice {
    readonly vendorId: number;
    readonly productId: number;
    readonly productName?: string | null;
    readonly manufacturerName?: string | null;
    readonly serialNumber?: string | null;
    readonly deviceVersionMajor: number;
    readonly deviceVersionMinor: number;
    readonly deviceVersionSubminor: number;
    readonly opened: boolean;
    readonly configuration?: USBConfiguration | null;
    readonly configurations: readonly USBConfiguration[];
    open(): Promise<void>;
    close(): Promise<void>;
    selectConfiguration(configurationValue: number): Promise<void>;
    claimInterface(interfaceNumber: number): Promise<void>;
    releaseInterface(interfaceNumber: number): Promise<void>;
    selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>;
    controlTransferIn(setup: USBControlTransferParameters, length: number): Promise<USBInTransferResult>;
    controlTransferOut(setup: USBControlTransferParameters, data?: ArrayBuffer | ArrayBufferView): Promise<USBOutTransferResult>;
  }

  interface USBDeviceFilter {
    vendorId?: number;
    productId?: number;
    classCode?: number;
    subclassCode?: number;
    protocolCode?: number;
    serialNumber?: string;
  }

  interface USBDeviceRequestOptions {
    filters: USBDeviceFilter[];
    exclusionFilters?: USBDeviceFilter[];
  }

  interface USBConnectionEvent extends Event {
    readonly device: USBDevice;
  }

  interface USB extends EventTarget {
    getDevices(): Promise<USBDevice[]>;
    requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
    addEventListener(
      type: 'connect' | 'disconnect',
      listener: (this: USB, event: USBConnectionEvent) => unknown,
      options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener(
      type: 'connect' | 'disconnect',
      listener: (this: USB, event: USBConnectionEvent) => unknown,
      options?: boolean | EventListenerOptions,
    ): void;
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ): void;
  }

  interface Navigator {
    /** Undefined outside Chromium browsers and outside secure contexts. */
    readonly usb?: USB;
  }
}
