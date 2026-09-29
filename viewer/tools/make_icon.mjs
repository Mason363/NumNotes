// Writes the default app icon (55x56, LZ4-compressed RGB565) used as the
// placeholder in viewer.nwa. Every app built on the website replaces it.
import { writeFileSync } from 'node:fs';
import { lz4Compress } from '../../web/src/pack/lz4.ts';

const W = 55;
const H = 56;
const SS = 4; // supersampling

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

function shade(x, y) {
  // Warm gradient tile.
  const t = y / H;
  let color = [255 - 20 * t, 183 - 40 * t, 52 + 10 * t];
  // White page with a folded corner.
  if (inRoundRect(x, y, 15, 10, 40, 46, 3) && !(x > 33 && y < 10 + (x - 33))) {
    color = [255, 255, 255];
    for (const ly of [22, 29, 36]) {
      if (y >= ly && y < ly + 2.6 && x >= 20 && x <= (ly === 36 ? 30 : 35)) color = [255, 160, 40];
    }
  }
  return color;
}

const pixels = new Uint8Array(W * H * 2);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = shade(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        for (let i = 0; i < 3; i++) acc[i] += c[i];
      }
    }
    const [r, g, b] = acc.map((v) => Math.round(v / (SS * SS)));
    const rgb565 = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
    pixels[2 * (y * W + x)] = rgb565 & 0xff;
    pixels[2 * (y * W + x) + 1] = rgb565 >> 8;
  }
}

writeFileSync(process.argv[2], lz4Compress(pixels));
