/*
 * LZ4 block decompression (the raw block format, no frame header).
 * Used for NN_IMG_PALETTE and NN_IMG_RGB565 tiles.
 */
#ifndef NN_LZ4_H
#define NN_LZ4_H

#include <stdint.h>

/*
 * Decompresses the LZ4 block src[0..src_len) into dst[0..dst_cap).
 * Returns the number of bytes written, or -1 if the block is malformed or
 * would not fit. Never reads outside src or writes outside dst.
 */
int nn_lz4_decompress(const uint8_t *src, int src_len, uint8_t *dst, int dst_cap);

#endif
