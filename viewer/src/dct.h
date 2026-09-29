/*
 * Decoder for NN_IMG_DCT tiles: 32x32 px, JPEG-like, each tile coded on its
 * own. The encoder and the bitstream description live in web/src/pack/dct.ts,
 * whose reference decoder matches this one bit for bit.
 */
#ifndef NN_DCT_H
#define NN_DCT_H

#include <stdint.h>

#include "format.h"

#define NN_DCT_TILE_SHIFT 5
#define NN_DCT_TILE_SIZE (1 << NN_DCT_TILE_SHIFT)

/* Chroma layouts. */
enum {
  NN_DCT_420 = 0,  /* 16x16 px MCUs: Y0 Y1 Y2 Y3 Cb Cr (the default) */
  NN_DCT_444 = 1,  /* 8x8 px MCUs: Y Cb Cr (NN_IMGF_444) */
  NN_DCT_GRAY = 2, /* 8x8 px MCUs: Y (NN_IMGF_GRAY) */
};

/* nn_dct_decode_tile results. */
enum {
  NN_DCT_OK = 0,
  NN_DCT_EINVAL = -1,   /* null pointer or unknown mode */
  NN_DCT_ECORRUPT = -2, /* invalid Huffman code or coefficient index */
  NN_DCT_ETRUNC = -3,   /* the data ends before the last block */
};

static inline int nn_dct_mode_from_flags(unsigned image_flags) {
  if (image_flags & NN_IMGF_GRAY) return NN_DCT_GRAY;
  return (image_flags & NN_IMGF_444) ? NN_DCT_444 : NN_DCT_420;
}

/*
 * Decodes the tile data[0..len) into 32x32 RGB565 pixels (row-major, 4x4
 * ordered dither). `quality` is nn_level_t.quality (clamped to 1..100).
 * Returns NN_DCT_OK or a negative NN_DCT_E* code, in which case `out` holds
 * garbage. Never reads outside `data`.
 *
 * Not reentrant: Huffman tables are built on first use and the quantization
 * tables of the last quality are cached, in static storage (about 5 KB).
 */
int nn_dct_decode_tile(const uint8_t *data, uint32_t len, int mode, int quality,
                       uint16_t *out);

#endif
