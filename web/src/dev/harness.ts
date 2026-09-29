// Dev-only page: builds a template and runs it in the wasm preview.
import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import { buildBundle } from '../pack/build.ts';
import { TEMPLATES } from '../lib/state/templates.ts';
import { assets } from '../lib/state/assets.ts';
import { ViewerRuntime, eventForKey } from '../preview/runtime.ts';

const select = document.getElementById('template') as HTMLSelectElement;
const status = document.getElementById('status')!;
const log = document.getElementById('log')!;
const canvas = document.getElementById('screen') as HTMLCanvasElement;
for (const t of TEMPLATES) select.add(new Option(t.title, t.id));
select.add(new Option('Pictures test', 'pictures'));
select.value = new URLSearchParams(location.search).get('t') ?? 'schedule';

const runtime = new ViewerRuntime(canvas, { onExit: () => (status.textContent = 'exited') });
(window as unknown as { runtime: ViewerRuntime }).runtime = runtime;
canvas.addEventListener('keydown', (e) => {
  const ev = eventForKey(e);
  if (ev !== undefined) {
    e.preventDefault();
    runtime.send(ev);
  }
});

async function testPictures() {
  // A photo-like picture, a flat chart, and a transparent sticker.
  const make = (w: number, h: number, draw: (c: OffscreenCanvasRenderingContext2D) => void) => {
    const c = new OffscreenCanvas(w, h);
    draw(c.getContext('2d')!);
    return c.transferToImageBitmap();
  };
  const photo = make(1600, 1200, (c) => {
    const g = c.createLinearGradient(0, 0, 1600, 1200);
    g.addColorStop(0, '#1e3c72');
    g.addColorStop(0.5, '#f0a060');
    g.addColorStop(1, '#2a5298');
    c.fillStyle = g;
    c.fillRect(0, 0, 1600, 1200);
    for (let i = 0; i < 400; i++) {
      c.fillStyle = `hsla(${(i * 37) % 360},70%,60%,0.35)`;
      c.beginPath();
      c.arc((i * 97) % 1600, (i * 53) % 1200, 20 + (i % 60), 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#fff';
    c.font = 'bold 120px Inter';
    c.fillText('Zoom me', 420, 640);
  });
  const chart = make(900, 500, (c) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, 900, 500);
    const lines = [[410, '#8b5cf6'], [434, '#6366f1'], [486, '#06b6d4'], [656, '#ef4444']] as const;
    for (const [nm, color] of lines) {
      const x = ((nm - 380) / 370) * 900;
      c.fillStyle = color;
      c.fillRect(x - 3, 40, 6, 380);
      c.fillStyle = '#fff';
      c.font = '28px Inter';
      c.fillText(String(nm), x - 26, 470);
    }
  });
  const a1 = await assets.addBitmap('photo.png', photo, false);
  const a2 = await assets.addBitmap('hydrogen.png', chart, false);
  const project = TEMPLATES.find((t) => t.id === 'album')!.create();
  const gallery = project.sections[0] as import('../model/types.ts').GallerySection;
  const ref = (asset: string, caption: string) => ({ id: asset + caption, asset, caption, adjust: { brightness: 0, contrast: 0, saturation: 0, sharpen: 0, grayscale: false, invert: false, rotate: 0 as const, flipX: false, flipY: false }, quality: { mode: 'auto' as const, level: 80, colors: 256, dither: true, zoomDetail: 2 as const } });
  gallery.images = [ref(a1.id, 'A photo'), ref(a2.id, 'Hydrogen emission lines'), ref(a1.id, 'Again'), ref(a2.id, 'Lines again')];
  return project;
}

async function build() {
  const project = select.value === 'pictures' ? await testPictures() : TEMPLATES.find((t) => t.id === select.value)!.create();
  const t0 = performance.now();
  const result = await buildBundle(project, assets, { onProgress: (f, l) => (status.textContent = `${Math.round(f * 100)}% ${l}`) });
  const ok = await runtime.load(result.bundle);
  status.textContent = `built ${result.bundle.length} bytes in ${Math.round(performance.now() - t0)} ms, boot ${ok}`;
  log.textContent = JSON.stringify({ stats: result.stats, warnings: result.warnings }, null, 1);
  canvas.focus();
}
document.getElementById('build')!.onclick = build;
(window as unknown as { build: () => Promise<void> }).build = build;
build();
