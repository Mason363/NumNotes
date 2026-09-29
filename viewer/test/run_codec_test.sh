#!/bin/sh
# Cross-checks the viewer's C decoders (viewer/src/lz4.c, dct.c) against the
# TypeScript encoders and reference decoder (web/src/pack): encodes test
# vectors with node, decodes them with the C code under ASan/UBSan, fuzzes the
# decoders with truncated and corrupted input, measures decoding speed and
# checks that both files build cleanly for the calculator and for wasm.
#
# Usage: viewer/test/run_codec_test.sh
# Environment: NODE (default node), CC (default clang),
#              ARM_GCC (arm-none-eabi-gcc; skipped if missing)
set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
src=$root/viewer/src
pack=$root/web/src/pack
NODE=${NODE:-node}
CC=${CC:-clang}
ARM_GCC=${ARM_GCC:-$HOME/.local/share/arm-gnu-toolchain-14.3.rel1-darwin-arm64-arm-none-eabi/bin/arm-none-eabi-gcc}

work=$(mktemp -d "${TMPDIR:-/tmp}/nn-codec.XXXXXX")
trap 'rm -rf "$work"' EXIT INT TERM

echo "== Generating test vectors with the TypeScript codecs"
cat > "$work/gen.mts" <<'EOF'
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [packDir, outDir] = process.argv.slice(2);
const { lz4Compress } = await import(pathToFileURL(join(packDir, 'lz4.ts')).href);
const { encodeDctTile, decodeDctTile } = await import(pathToFileURL(join(packDir, 'dct.ts')).href);
mkdirSync(outDir, { recursive: true });

let seed = 1;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const fill = (n, f) => Uint8Array.from({ length: n }, (_, i) => f(i));
const cases = [];

// --- LZ4 ---------------------------------------------------------------
function addLz4(name, data) {
  writeFileSync(join(outDir, `${name}.raw`), data);
  writeFileSync(join(outDir, `${name}.lz4`), lz4Compress(data));
  cases.push(`lz4 ${name} ${data.length}`);
}

for (const n of [0, 1, 4, 5, 12, 13, 14, 16, 17, 20, 64, 255, 270, 1000, 4096]) {
  addLz4(`zeros_${n}`, new Uint8Array(n));
  addLz4(`random_${n}`, fill(n, () => random() * 256));
  addLz4(`period3_${n}`, fill(n, (i) => i % 3));
}
addLz4('runs', fill(20000, (i) => (i / 700) & 0xff));
const words = ['tile', 'scene', 'glyph', 'note', 'the ', 'image ', 'NumWorks', ', ', '. '];
addLz4('text', new TextEncoder().encode(Array.from({ length: 3000 }, () => words[(random() * words.length) | 0]).join(' ')));
const block = fill(70000, () => random() * 256);
const far = new Uint8Array(140000);
far.set(block);
far.set(block, 70000); // repeats only beyond the 64 KiB window
addLz4('far', far);
addLz4('rgb565', fill(8192, (i) => {
  const p = i >> 1, x = p & 63, y = p >> 6;
  const v = ((x >> 1) << 11) | ((y + (x >> 3)) << 5) | ((x ^ y) & 31);
  return i & 1 ? v >> 8 : v & 0xff;
}));
addLz4('palette4', fill(2048, (i) => ((i % 32 < 12 ? 3 : 1) << 4) | ((i >> 5) % 7 < 3 ? 2 : 1)));

// --- DCT ---------------------------------------------------------------
const TILE = 32;
const W = 80, H = 50; // partial tiles at the right and bottom edges

function makeImage(kind) {
  const img = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r, g, b;
      if (kind === 'gradient') {
        r = x * 3; g = y * 5; b = 255 - x * 2 - y;
      } else if (kind === 'photo') {
        r = 130 + 90 * Math.sin(x / 9) * Math.cos(y / 13) + 8 * random();
        g = 120 + 70 * Math.sin((x + 2 * y) / 17) + 8 * random();
        b = 90 + 60 * Math.cos(x / 5 - y / 11) + 8 * random();
      } else if (kind === 'noise') {
        r = random() * 256; g = random() * 256; b = random() * 256;
      } else {
        const bar = ((x >> 3) + (y >> 4)) & 1;
        const text = y % 12 < 7 && x % 5 < 3 && (x + y) % 3 !== 0;
        r = text ? 0 : bar ? 230 : 250; g = text ? 0 : bar ? 40 : 250; b = text ? 0 : bar ? 60 : 250;
      }
      const i = (y * W + x) * 4;
      img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = 255;
    }
  }
  return img;
}

function toGray(img) {
  const out = new Uint8ClampedArray(img.length);
  for (let i = 0; i < img.length; i += 4) {
    const v = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}

/** The tile's source pixels as 32x32 RGB888, edge replicated like the encoder. */
function tileSource(img, x0, y0) {
  const out = new Uint8Array(TILE * TILE * 3);
  for (let ty = 0; ty < TILE; ty++) {
    for (let tx = 0; tx < TILE; tx++) {
      const i = (Math.min(y0 + ty, H - 1) * W + Math.min(x0 + tx, W - 1)) * 4;
      out.set(img.subarray(i, i + 3), (ty * TILE + tx) * 3);
    }
  }
  return out;
}

const modeIds = { '420': 0, '444': 1, gray: 2 };
for (const kind of ['gradient', 'photo', 'noise', 'edges']) {
  const color = makeImage(kind);
  for (const mode of ['420', '444', 'gray']) {
    const img = mode === 'gray' ? toGray(color) : color;
    for (const quality of [10, 50, 85, 100]) {
      for (let y0 = 0; y0 < H; y0 += TILE) {
        for (let x0 = 0; x0 < W; x0 += TILE) {
          const name = `${kind}_${mode}_q${quality}_${x0}_${y0}`;
          const tile = encodeDctTile(img, W, x0, y0, W, H, mode, quality);
          const pixels = decodeDctTile(tile, mode, quality);
          const ref = new DataView(new ArrayBuffer(pixels.length * 2));
          pixels.forEach((p, i) => ref.setUint16(2 * i, p, true));
          writeFileSync(join(outDir, `${name}.tile`), tile);
          writeFileSync(join(outDir, `${name}.ref`), new Uint8Array(ref.buffer));
          writeFileSync(join(outDir, `${name}.src`), tileSource(img, x0, y0));
          cases.push(`dct ${name} ${modeIds[mode]} ${quality} ${Math.min(TILE, W - x0)} ${Math.min(TILE, H - y0)}`);
        }
      }
    }
  }
}

writeFileSync(join(outDir, 'cases.txt'), cases.join('\n') + '\n');
console.log(`  ${cases.length} vectors`);
EOF
"$NODE" --experimental-strip-types "$work/gen.mts" "$pack" "$work/vectors"

echo "== Checking the C decoders (ASan + UBSan)"
"$CC" -std=c99 -O2 -g -fsanitize=address,undefined -fno-sanitize-recover=undefined \
  -Wall -Wextra -I"$src" "$here/codec_test.c" "$src/lz4.c" "$src/dct.c" -lm -o "$work/codec_test"
"$work/codec_test" "$work/vectors"

echo "== Decoding speed (-O2, no sanitizers)"
"$CC" -std=c99 -O2 -I"$src" "$here/codec_test.c" "$src/lz4.c" "$src/dct.c" -lm -o "$work/codec_bench"
"$work/codec_bench" "$work/vectors" --bench

echo "== Cross-compiling"
if [ -x "$ARM_GCC" ]; then
  for f in lz4 dct; do
    "$ARM_GCC" -mthumb -mcpu=cortex-m7 -mfloat-abi=hard -mfpu=fpv5-sp-d16 -Os -ffreestanding \
      -Wall -Wextra -Werror -c "$src/$f.c" -o "$work/$f.arm.o"
  done
  echo "  cortex-m7: ok"
else
  echo "  cortex-m7: skipped (arm-none-eabi-gcc not found; set ARM_GCC)"
fi
if echo 'int x;' | "$CC" --target=wasm32 -x c -c - -o "$work/probe.o" 2>/dev/null; then
  for f in lz4 dct; do
    "$CC" --target=wasm32 -O2 -ffreestanding -nostdlib -Wall -Wextra -Werror \
      -c "$src/$f.c" -o "$work/$f.wasm.o"
  done
  echo "  wasm32: ok"
else
  echo "  wasm32: skipped ($CC has no wasm32 target)"
fi

echo "All codec tests passed."
