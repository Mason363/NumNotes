// Runs the real calculator viewer (compiled to WebAssembly) in the page.

export const SCREEN_W = 320;
export const SCREEN_H = 240;
export const STORE_SIZE = 65536;

interface ViewerExports {
  memory: WebAssembly.Memory;
  nn_alloc(size: number): number;
  nn_boot(bundle: number, size: number, store: number): number;
  nn_event(ev: number, now: number): void;
  nn_tick(now: number): number;
  nn_exited(): number;
  nn_goto(section: number, page: number): void;
}

let modulePromise: Promise<WebAssembly.Module> | null = null;

function loadModule(): Promise<WebAssembly.Module> {
  modulePromise ??= (async () => {
    const url = `${import.meta.env.BASE_URL}viewer/viewer.wasm`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Couldn't load the preview (${response.status})`);
    return WebAssembly.compile(await response.arrayBuffer());
  })();
  return modulePromise;
}

export interface RuntimeCallbacks {
  onStoreChange?: (store: Uint8Array) => void;
  onExit?: () => void;
  onFrame?: () => void;
}

export class ViewerRuntime {
  private ctx: CanvasRenderingContext2D;
  private exports: ViewerExports | null = null;
  private storePtr = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epoch = performance.now();
  private image: ImageData;
  private callbacks: RuntimeCallbacks;
  private storeTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  battery = 3;
  exited = false;

  constructor(canvas: HTMLCanvasElement, callbacks: RuntimeCallbacks = {}) {
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    this.ctx = canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(SCREEN_W, SCREEN_H);
    this.callbacks = callbacks;
  }

  private now(): number {
    return Math.floor(performance.now() - this.epoch) >>> 0;
  }

  /** Starts the app from scratch with a new bundle (and saved notes). */
  async load(bundle: Uint8Array, store?: Uint8Array): Promise<boolean> {
    const generation = ++this.generation;
    const module = await loadModule();
    if (generation !== this.generation) return false;
    this.stop();
    let exports!: ViewerExports;
    const imports = {
      env: {
        push_rect: (x: number, y: number, w: number, h: number, ptr: number) => this.pushRect(exports, x, y, w, h, ptr),
        fill_rect: (x: number, y: number, w: number, h: number, color: number) => this.fillRect(x, y, w, h, color),
        millis: () => this.now(),
        battery: () => this.battery,
        store_changed: () => this.storeChanged(),
      },
    };
    const instance = await WebAssembly.instantiate(module, imports);
    if (generation !== this.generation) return false;
    exports = instance.exports as unknown as ViewerExports;
    this.exports = exports;
    this.exited = false;

    const bundlePtr = exports.nn_alloc(bundle.length);
    new Uint8Array(exports.memory.buffer, bundlePtr, bundle.length).set(bundle);
    this.storePtr = exports.nn_alloc(STORE_SIZE);
    const storeView = new Uint8Array(exports.memory.buffer, this.storePtr, STORE_SIZE);
    if (store && store.length === STORE_SIZE) storeView.set(store);
    else storeView.fill(0xff);
    const ok = exports.nn_boot(bundlePtr, bundle.length, this.storePtr) !== 0;
    this.schedule(exports.nn_tick(this.now()));
    return ok;
  }

  /** Sends an Epsilon event code (see viewer/src/keys.h). */
  send(ev: number) {
    const e = this.exports;
    if (!e || this.exited) return;
    e.nn_event(ev, this.now());
    this.afterCall(e);
  }

  /** Jumps to a section/page (e.g. the one being edited). */
  goto(section: number, page: number) {
    const e = this.exports;
    if (!e || this.exited || section < 0) return;
    e.nn_goto(section, Math.max(0, page));
    this.afterCall(e);
  }

  private afterCall(e: ViewerExports) {
    if (e.nn_exited()) {
      this.exited = true;
      this.stop();
      this.callbacks.onExit?.();
      return;
    }
    this.schedule(e.nn_tick(this.now()));
  }

  private schedule(wake: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (wake === 0xffffffff || this.exited) return;
    const delay = Math.max(0, Math.min(wake - this.now(), 60000));
    this.timer = setTimeout(() => {
      this.timer = null;
      const e = this.exports;
      if (!e) return;
      this.afterCall(e);
    }, delay);
  }

  private pushRect(e: ViewerExports, x: number, y: number, w: number, h: number, ptr: number) {
    const src = new Uint16Array(e.memory.buffer, ptr, w * h);
    const dst = this.image.data;
    for (let row = 0; row < h; row++) {
      const sy = y + row;
      if (sy < 0 || sy >= SCREEN_H) continue;
      for (let col = 0; col < w; col++) {
        const sx = x + col;
        if (sx < 0 || sx >= SCREEN_W) continue;
        const c = src[row * w + col];
        const i = (sy * SCREEN_W + sx) * 4;
        const r = c >> 11, g = (c >> 5) & 63, b = c & 31;
        dst[i] = (r << 3) | (r >> 2);
        dst[i + 1] = (g << 2) | (g >> 4);
        dst[i + 2] = (b << 3) | (b >> 2);
        dst[i + 3] = 255;
      }
    }
    this.ctx.putImageData(this.image, 0, 0, x, y, w, h);
    this.callbacks.onFrame?.();
  }

  private fillRect(x: number, y: number, w: number, h: number, c: number) {
    const r = c >> 11, g = (c >> 5) & 63, b = c & 31;
    this.ctx.fillStyle = `rgb(${(r << 3) | (r >> 2)},${(g << 2) | (g >> 4)},${(b << 3) | (b >> 2)})`;
    this.ctx.fillRect(x, y, w, h);
  }

  private storeChanged() {
    if (this.storeTimer) return;
    this.storeTimer = setTimeout(() => {
      this.storeTimer = null;
      const e = this.exports;
      if (e) this.callbacks.onStoreChange?.(new Uint8Array(e.memory.buffer, this.storePtr, STORE_SIZE).slice());
    }, 200);
  }

  /** Current screen as a PNG data URL. */
  snapshot(): string {
    return (this.ctx.canvas as HTMLCanvasElement).toDataURL('image/png');
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  destroy() {
    this.generation++;
    this.stop();
    this.exports = null;
  }
}

// Keyboard -> Epsilon events for the preview.
const EV = {
  left: 0, up: 1, down: 2, right: 3, ok: 4, back: 5, home: 6, toolbox: 16, var: 15, backspace: 17,
  plus: 45, minus: 46, exe: 52, ans: 51, lparen: 33, rparen: 34, dot: 49, comma: 22, power: 23,
  multiply: 39, divide: 40, shiftLeft: 54, shiftUp: 55, shiftDown: 56, shiftRight: 57,
  cut: 68, copy: 69, paste: 70, clear: 71, lbracket: 72, rbracket: 73, lbrace: 74, rbrace: 75,
  underscore: 76, equal: 81, lower: 82, greater: 83, colon: 122, semicolon: 123, dquote: 124,
  percent: 125, space: 154, question: 156, exclamation: 157,
};
export { EV as EVENTS };

const DIGITS = [48, 42, 43, 44, 36, 37, 38, 30, 31, 32];
const ALPHA_KEYS = 'abcdefghijklmnopq_rstuv_wxyz'; // '_' marks missing keys

function letterEvent(ch: string): number | undefined {
  const lower = ch.toLowerCase();
  const i = ALPHA_KEYS.indexOf(lower);
  if (i < 0 || lower === '_') return undefined;
  return (ch === lower ? 108 : 162) + 18 + i;
}

export function eventForKey(e: KeyboardEvent): number | undefined {
  const mod = e.metaKey || e.ctrlKey;
  if (mod) {
    if (e.key === 'c') return EV.copy;
    if (e.key === 'x') return EV.cut;
    if (e.key === 'v') return EV.paste;
    return undefined;
  }
  switch (e.key) {
    case 'ArrowLeft': return e.shiftKey ? EV.shiftLeft : EV.left;
    case 'ArrowRight': return e.shiftKey ? EV.shiftRight : EV.right;
    case 'ArrowUp': return e.shiftKey ? EV.shiftUp : EV.up;
    case 'ArrowDown': return e.shiftKey ? EV.shiftDown : EV.down;
    case 'Enter': return e.shiftKey ? EV.exe : EV.ok;
    case 'Escape': return EV.back;
    case 'Backspace': return e.shiftKey ? EV.clear : EV.backspace;
    case 'Home': return EV.home;
    case 'Tab': return EV.toolbox;
    case ' ': return EV.space;
    case '+': return EV.plus;
    case '-': return EV.minus;
    case '*': return EV.multiply;
    case '/': return EV.divide;
    case '(': return EV.lparen;
    case ')': return EV.rparen;
    case '.': return EV.dot;
    case ',': return EV.comma;
    case '^': return EV.power;
    case '=': return EV.equal;
    case '<': return EV.lower;
    case '>': return EV.greater;
    case ':': return EV.colon;
    case ';': return EV.semicolon;
    case '"': return EV.dquote;
    case '%': return EV.percent;
    case '?': return EV.question;
    case '!': return EV.exclamation;
    case '[': return EV.lbracket;
    case ']': return EV.rbracket;
    case '{': return EV.lbrace;
    case '}': return EV.rbrace;
    case '_': return EV.underscore;
  }
  if (/^[0-9]$/.test(e.key)) return DIGITS[Number(e.key)];
  if (/^[a-zA-Z]$/.test(e.key)) return letterEvent(e.key);
  return undefined;
}
