// Shrinking pictures must trade quality for space, step by step.
import { describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY, encodeImage, packedSize, shrinkQuality } from './images.ts';

/** A noisy, photo-like test picture. */
function photo(w: number, h: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = 128 + 90 * Math.sin(x / 9) + 30 * rand();
      data[i + 1] = 128 + 90 * Math.cos(y / 7) + 30 * rand();
      data[i + 2] = 128 + 60 * Math.sin((x + y) / 13) + 30 * rand();
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h, colorSpace: 'srgb' } as ImageData;
}

describe('shrinking pictures', () => {
  it('lowers quality limits step by step', () => {
    const q = { ...DEFAULT_QUALITY, level: 90, zoomDetail: 4 as const };
    expect(shrinkQuality(q, 0)).toEqual(q);
    const steps = [1, 2, 3].map((s) => shrinkQuality(q, s));
    expect(steps.map((s) => s.level)).toEqual([...steps.map((s) => s.level)].sort((a, b) => b - a));
    expect(steps[2].zoomDetail).toBe(1);
    expect(steps[2].level).toBeLessThan(q.level);
  });

  it('makes photos smaller at every step', () => {
    const img = photo(320, 224);
    const sizes = [0, 1, 2, 3].map((s) => packedSize(encodeImage([img], shrinkQuality(DEFAULT_QUALITY, s), false, s)));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThan(sizes[i - 1]);
  });
});
