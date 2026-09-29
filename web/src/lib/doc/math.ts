// LaTeX to SVG with MathJax (loaded on first use), and to bitmaps for the
// calculator.

type MathJaxLike = {
  tex2svgPromise?: (tex: string, opts?: object) => Promise<HTMLElement>;
  tex2svg?: (tex: string, opts?: object) => HTMLElement;
  startup?: { promise: Promise<void> };
};

let loading: Promise<MathJaxLike | null> | null = null;

function loadMathJax(): Promise<MathJaxLike | null> {
  loading ??= new Promise((resolve) => {
    const w = window as unknown as { MathJax?: MathJaxLike & Record<string, unknown> };
    w.MathJax = { startup: { typeset: false }, svg: { fontCache: 'none' } } as never;
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@4/tex-svg.js';
    script.async = true;
    script.onload = async () => {
      try {
        await w.MathJax?.startup?.promise;
        resolve(w.MathJax ?? null);
      } catch {
        resolve(null);
      }
    };
    script.onerror = () => resolve(null);
    document.head.append(script);
  });
  return loading;
}

const svgCache = new Map<string, Promise<string | null>>();

export function mathSvg(latex: string): Promise<string | null> {
  if (!latex.trim()) return Promise.resolve(null);
  let p = svgCache.get(latex);
  if (!p) {
    p = loadMathJax().then(async (mj) => {
      if (!mj) return null;
      try {
        const node = mj.tex2svgPromise ? await mj.tex2svgPromise(latex, { display: true }) : mj.tex2svg!(latex, { display: true });
        const svg = node.querySelector('svg');
        return svg ? svg.outerHTML : null;
      } catch {
        return null;
      }
    });
    svgCache.set(latex, p);
  }
  return p;
}

/** Rasterizes a formula at roughly `px` pixels per em, in `color`. */
export async function mathBitmap(latex: string, px: number, color: string): Promise<ImageBitmap | null> {
  const svg = await mathSvg(latex);
  if (!svg) return null;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const el = doc.documentElement;
  const ex = (v: string | null) => (v ? parseFloat(v) : 0);
  // MathJax sizes its SVG in ex units; one ex is about half an em.
  const width = Math.max(1, Math.ceil(ex(el.getAttribute('width')) * px * 0.5));
  const height = Math.max(1, Math.ceil(ex(el.getAttribute('height')) * px * 0.5));
  el.setAttribute('width', String(width));
  el.setAttribute('height', String(height));
  el.setAttribute('color', color);
  el.setAttribute('style', `color:${color}`);
  const markup = new XMLSerializer().serializeToString(el).replaceAll('currentColor', color);
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  await img.decode();
  const bitmap = await createImageBitmap(img, { resizeWidth: width, resizeHeight: height });
  URL.revokeObjectURL(img.src);
  return bitmap;
}
