/*
 * DCT tile decoder: baseline Huffman decoding with the Annex K tables,
 * libjpeg's "islow" integer IDCT, triangle-filter chroma upsampling within
 * the tile and a 4x4 ordered dither into RGB565.
 *
 * All arithmetic is 32-bit integer. Coefficients and IDCT intermediates are
 * clamped to ranges valid data never reaches, which keeps every product and
 * sum inside int32 even for corrupt input.
 */
#include "dct.h"

#include <stddef.h>

#if defined(__ARM_FEATURE_SAT)
#include <arm_acle.h>
#endif

#define TILE NN_DCT_TILE_SIZE
#define CHROMA_TILE (TILE / 2)

/* Codes up to this many bits long are decoded with one table lookup. */
#define LOOKAHEAD 9

#define EOB 0x00
#define ZRL 0xF0

/* Per-pixel and per-symbol helpers, inlined even at -Os. */
#if defined(__GNUC__)
#define HOT static inline __attribute__((always_inline))
#else
#define HOT static inline
#endif

/*
 * Saturating clamps, single SSAT/USAT instructions on ARMv7-M. Dequantized
 * coefficients are limited to 13 bits and IDCT intermediates to 15 bits;
 * valid data never gets there.
 */
HOT int32_t clamp_coef(int32_t v) {
#if defined(__ARM_FEATURE_SAT)
  return __ssat(v, 13);
#else
  return v < -4096 ? -4096 : v > 4095 ? 4095 : v;
#endif
}

HOT int32_t clamp_ws(int32_t v) {
#if defined(__ARM_FEATURE_SAT)
  return __ssat(v, 15);
#else
  return v < -16384 ? -16384 : v > 16383 ? 16383 : v;
#endif
}

HOT int32_t clamp255(int32_t v) {
#if defined(__ARM_FEATURE_SAT)
  return (int32_t)__usat(v, 8);
#else
  return v < 0 ? 0 : v > 255 ? 255 : v;
#endif
}

/* ------------------------------------------------------------------------ */
/* Standard tables (ITU-T T.81 Annex K) */

/* Row-major index of the k-th coefficient in zigzag order. */
static const uint8_t zigzag[64] = {
    0,  1,  8,  16, 9,  2,  3,  10, 17, 24, 32, 25, 18, 11, 4,  5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6,  7,  14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
};

/* Row-major. */
static const uint8_t luma_quant[64] = {
    16, 11, 10, 16, 24,  40,  51,  61,  12, 12, 14, 19, 26,  58,  60,  55,
    14, 13, 16, 24, 40,  57,  69,  56,  14, 17, 22, 29, 51,  87,  80,  62,
    18, 22, 37, 56, 68,  109, 103, 77,  24, 35, 55, 64, 81,  104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
};

static const uint8_t chroma_quant[64] = {
    17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99,
    24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
};

static const uint8_t dc_vals[12] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11};

static const uint8_t ac_luma_vals[162] = {
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51,
    0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1,
    0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18,
    0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
    0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57,
    0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92,
    0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
    0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
    0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2,
    0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
};

static const uint8_t ac_chroma_vals[162] = {
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07,
    0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09,
    0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25,
    0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38,
    0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56,
    0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74,
    0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
    0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba,
    0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6,
    0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2,
    0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
};

typedef struct {
  uint8_t bits[16]; /* number of codes of each length 1..16 */
  const uint8_t *vals;
} huff_spec_t;

enum { DC_LUMA, DC_CHROMA, AC_LUMA, AC_CHROMA, HUFF_TABLES };

static const huff_spec_t huff_specs[HUFF_TABLES] = {
    {{0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0}, dc_vals},
    {{0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0}, dc_vals},
    {{0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d}, ac_luma_vals},
    {{0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77}, ac_chroma_vals},
};

/* 4x4 Bayer thresholds as 16.16 fractions: (2b + 1) / 32. */
#define D(b) (((b) * 2 + 1) << 11)
static const uint16_t dither[4][4] = {
    {D(0), D(8), D(2), D(10)},
    {D(12), D(4), D(14), D(6)},
    {D(3), D(11), D(1), D(9)},
    {D(15), D(7), D(13), D(5)},
};
#undef D

/* ------------------------------------------------------------------------ */
/* Derived tables, built on first use */

typedef struct {
  uint16_t look[1 << LOOKAHEAD]; /* (length << 8) | symbol; 0 if the code is longer */
  int32_t maxcode[17];           /* largest code of each length, -1 if none */
  int32_t valoffset[17];         /* vals index of a code = code + valoffset[length] */
  const uint8_t *vals;
} huff_table_t;

static huff_table_t huff_tables[HUFF_TABLES];
static int huff_ready;

/* Luma and chroma quantization tables in zigzag order, for quant_quality. */
static uint16_t quant[2][64];
static int quant_quality;

static void build_huff_table(huff_table_t *t, const huff_spec_t *spec) {
  int32_t code = 0;
  int k = 0, length, i, j;

  for (i = 0; i < (1 << LOOKAHEAD); i++) t->look[i] = 0;
  for (length = 1; length <= 16; length++) {
    int count = spec->bits[length - 1];
    t->valoffset[length] = k - code;
    for (i = 0; i < count; i++, k++, code++) {
      if (length <= LOOKAHEAD) {
        int shift = LOOKAHEAD - length;
        uint16_t entry = (uint16_t)(length << 8 | spec->vals[k]);
        for (j = code << shift; j < (code + 1) << shift; j++) t->look[j] = entry;
      }
    }
    t->maxcode[length] = count > 0 ? code - 1 : -1;
    code <<= 1;
  }
  t->vals = spec->vals;
}

static void scale_quant(uint16_t *table, const uint8_t *base, int quality) {
  int scale = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  int k;
  for (k = 0; k < 64; k++) {
    int v = (base[zigzag[k]] * scale + 50) / 100;
    table[k] = (uint16_t)(v < 1 ? 1 : v > 255 ? 255 : v);
  }
}

static void prepare_tables(int quality) {
  int i;
  if (!huff_ready) {
    for (i = 0; i < HUFF_TABLES; i++) build_huff_table(&huff_tables[i], &huff_specs[i]);
    huff_ready = 1;
  }
  if (quality != quant_quality) {
    scale_quant(quant[0], luma_quant, quality);
    scale_quant(quant[1], chroma_quant, quality);
    quant_quality = quality;
  }
}

/* ------------------------------------------------------------------------ */
/* Bit reader: MSB first, yields 1 bits past the end of the data */

typedef struct {
  const uint8_t *p, *end;
  uint32_t acc;  /* unconsumed bits, left-aligned */
  int bits;      /* number of valid bits in acc */
  uint32_t pad;  /* filler bytes supplied past the end */
} bit_reader_t;

/* Tops the accumulator up to at least 25 bits. */
HOT void br_fill(bit_reader_t *br) {
  while (br->bits <= 24) {
    uint32_t byte = 0xFF;
    if (br->p < br->end) byte = *br->p++;
    else br->pad++;
    br->acc |= byte << (24 - br->bits);
    br->bits += 8;
  }
}

HOT void br_skip(bit_reader_t *br, int n) {
  br->acc <<= n;
  br->bits -= n;
}

/* Whether any filler bits were consumed, i.e. the data was too short. */
HOT int br_overrun(const bit_reader_t *br) {
  return br->pad * 8 > (uint32_t)br->bits;
}

/* Returns the next Huffman symbol, or -1 for an invalid code. */
HOT int decode_symbol(bit_reader_t *br, const huff_table_t *t) {
  int entry, length;

  br_fill(br);
  entry = t->look[br->acc >> (32 - LOOKAHEAD)];
  if (entry) {
    br_skip(br, entry >> 8);
    return entry & 0xFF;
  }
  for (length = LOOKAHEAD + 1; length <= 16; length++) {
    int32_t code = (int32_t)(br->acc >> (32 - length));
    if (code <= t->maxcode[length]) {
      br_skip(br, length);
      return t->vals[code + t->valoffset[length]];
    }
  }
  return -1;
}

/* Reads `size` (1..11) extra bits and sign-extends them (JPEG HUFF_EXTEND). */
HOT int receive_extend(bit_reader_t *br, int size) {
  int v;
  if (br->bits < size) br_fill(br);
  v = (int)(br->acc >> (32 - size));
  br_skip(br, size);
  return v < (1 << (size - 1)) ? v - ((1 << size) - 1) : v;
}

/* ------------------------------------------------------------------------ */
/* IDCT (libjpeg jidctint.c, "islow") */

#define CONST_BITS 13
#define PASS1_BITS 2
#define PASS1_SHIFT (CONST_BITS - PASS1_BITS)
#define PASS2_SHIFT (CONST_BITS + PASS1_BITS + 3)
/* Rounding plus the +128 level shift, folded into the DC term of pass 2. */
#define PASS2_BIAS ((1 << (PASS2_SHIFT - 1)) + (128 << PASS2_SHIFT))

#define FIX_0_298631336 2446
#define FIX_0_390180644 3196
#define FIX_0_541196100 4433
#define FIX_0_765366865 6270
#define FIX_0_899976223 7373
#define FIX_1_175875602 9633
#define FIX_1_501321110 12299
#define FIX_1_847759065 15137
#define FIX_1_961570560 16069
#define FIX_2_053119869 16819
#define FIX_2_562915447 20995
#define FIX_3_072711026 25172

/* IDCT of a dequantized row-major block into 8-bit samples at out[stride * row]. */
static void inverse_dct(const int16_t *coef, uint8_t *out, int stride) {
  int32_t ws[64];
  int32_t tmp0, tmp1, tmp2, tmp3, tmp10, tmp11, tmp12, tmp13, z1, z2, z3, z4, z5;
  int c, r;

  /* Pass 1: columns, results scaled up by 2^PASS1_BITS. */
  for (c = 0; c < 8; c++) {
    const int16_t *in = coef + c;
    int32_t *w = ws + c;
    if ((in[8] | in[16] | in[24] | in[32] | in[40] | in[48] | in[56]) == 0) {
      int32_t dc = in[0] * (1 << PASS1_BITS);
      for (r = 0; r < 64; r += 8) w[r] = dc;
      continue;
    }

    z2 = in[16];
    z3 = in[48];
    z1 = (z2 + z3) * FIX_0_541196100;
    tmp2 = z1 - z3 * FIX_1_847759065;
    tmp3 = z1 + z2 * FIX_0_765366865;
    z2 = in[0];
    z3 = in[32];
    tmp0 = (z2 + z3) * (1 << CONST_BITS) + (1 << (PASS1_SHIFT - 1));
    tmp1 = (z2 - z3) * (1 << CONST_BITS) + (1 << (PASS1_SHIFT - 1));
    tmp10 = tmp0 + tmp3;
    tmp13 = tmp0 - tmp3;
    tmp11 = tmp1 + tmp2;
    tmp12 = tmp1 - tmp2;

    tmp0 = in[56];
    tmp1 = in[40];
    tmp2 = in[24];
    tmp3 = in[8];
    z1 = tmp0 + tmp3;
    z2 = tmp1 + tmp2;
    z3 = tmp0 + tmp2;
    z4 = tmp1 + tmp3;
    z5 = (z3 + z4) * FIX_1_175875602;
    tmp0 *= FIX_0_298631336;
    tmp1 *= FIX_2_053119869;
    tmp2 *= FIX_3_072711026;
    tmp3 *= FIX_1_501321110;
    z1 *= -FIX_0_899976223;
    z2 *= -FIX_2_562915447;
    z3 = z3 * -FIX_1_961570560 + z5;
    z4 = z4 * -FIX_0_390180644 + z5;
    tmp0 += z1 + z3;
    tmp1 += z2 + z4;
    tmp2 += z2 + z3;
    tmp3 += z1 + z4;

    w[0] = clamp_ws((tmp10 + tmp3) >> PASS1_SHIFT);
    w[56] = clamp_ws((tmp10 - tmp3) >> PASS1_SHIFT);
    w[8] = clamp_ws((tmp11 + tmp2) >> PASS1_SHIFT);
    w[48] = clamp_ws((tmp11 - tmp2) >> PASS1_SHIFT);
    w[16] = clamp_ws((tmp12 + tmp1) >> PASS1_SHIFT);
    w[40] = clamp_ws((tmp12 - tmp1) >> PASS1_SHIFT);
    w[24] = clamp_ws((tmp13 + tmp0) >> PASS1_SHIFT);
    w[32] = clamp_ws((tmp13 - tmp0) >> PASS1_SHIFT);
  }

  /* Pass 2: rows, descaled to samples. */
  for (r = 0; r < 8; r++, out += stride) {
    const int32_t *w = ws + r * 8;
    if ((w[1] | w[2] | w[3] | w[4] | w[5] | w[6] | w[7]) == 0) {
      uint8_t v = (uint8_t)clamp255((w[0] * (1 << CONST_BITS) + PASS2_BIAS) >> PASS2_SHIFT);
      for (c = 0; c < 8; c++) out[c] = v;
      continue;
    }

    z2 = w[2];
    z3 = w[6];
    z1 = (z2 + z3) * FIX_0_541196100;
    tmp2 = z1 - z3 * FIX_1_847759065;
    tmp3 = z1 + z2 * FIX_0_765366865;
    z2 = w[0];
    z3 = w[4];
    tmp0 = (z2 + z3) * (1 << CONST_BITS) + PASS2_BIAS;
    tmp1 = (z2 - z3) * (1 << CONST_BITS) + PASS2_BIAS;
    tmp10 = tmp0 + tmp3;
    tmp13 = tmp0 - tmp3;
    tmp11 = tmp1 + tmp2;
    tmp12 = tmp1 - tmp2;

    tmp0 = w[7];
    tmp1 = w[5];
    tmp2 = w[3];
    tmp3 = w[1];
    z1 = tmp0 + tmp3;
    z2 = tmp1 + tmp2;
    z3 = tmp0 + tmp2;
    z4 = tmp1 + tmp3;
    z5 = (z3 + z4) * FIX_1_175875602;
    tmp0 *= FIX_0_298631336;
    tmp1 *= FIX_2_053119869;
    tmp2 *= FIX_3_072711026;
    tmp3 *= FIX_1_501321110;
    z1 *= -FIX_0_899976223;
    z2 *= -FIX_2_562915447;
    z3 = z3 * -FIX_1_961570560 + z5;
    z4 = z4 * -FIX_0_390180644 + z5;
    tmp0 += z1 + z3;
    tmp1 += z2 + z4;
    tmp2 += z2 + z3;
    tmp3 += z1 + z4;

    out[0] = (uint8_t)clamp255((tmp10 + tmp3) >> PASS2_SHIFT);
    out[7] = (uint8_t)clamp255((tmp10 - tmp3) >> PASS2_SHIFT);
    out[1] = (uint8_t)clamp255((tmp11 + tmp2) >> PASS2_SHIFT);
    out[6] = (uint8_t)clamp255((tmp11 - tmp2) >> PASS2_SHIFT);
    out[2] = (uint8_t)clamp255((tmp12 + tmp1) >> PASS2_SHIFT);
    out[5] = (uint8_t)clamp255((tmp12 - tmp1) >> PASS2_SHIFT);
    out[3] = (uint8_t)clamp255((tmp13 + tmp0) >> PASS2_SHIFT);
    out[4] = (uint8_t)clamp255((tmp13 - tmp0) >> PASS2_SHIFT);
  }
}

/* ------------------------------------------------------------------------ */
/* Block decoding */

typedef struct {
  bit_reader_t br;
  int32_t pred[3];  /* DC predictor per component (quantized) */
  int16_t coef[64]; /* all zero between blocks */
} tile_decoder_t;

/*
 * Decodes the next block of `component` (0 = Y, 1 = Cb, 2 = Cr) into 8x8
 * samples at `out` with row pitch `stride`.
 */
static int decode_block(tile_decoder_t *d, int component, uint8_t *out, int stride) {
  bit_reader_t *br = &d->br;
  int cls = component == 0 ? 0 : 1;
  const huff_table_t *ac = &huff_tables[AC_LUMA + cls];
  const uint16_t *q = quant[cls];
  int16_t *coef = d->coef;
  int last = 0; /* zigzag index of the last nonzero coefficient */
  int k, s, r;

  s = decode_symbol(br, &huff_tables[DC_LUMA + cls]);
  if (s < 0) return NN_DCT_ECORRUPT;
  if (s > 0) d->pred[component] += receive_extend(br, s);
  coef[0] = (int16_t)clamp_coef(d->pred[component] * q[0]);

  for (k = 1; k < 64; k++) {
    int rs = decode_symbol(br, ac);
    if (rs < 0) return NN_DCT_ECORRUPT;
    s = rs & 15;
    if (s == 0) {
      if (rs != ZRL) break; /* EOB */
      k += 15;
      continue;
    }
    k += rs >> 4;
    if (k > 63) return NN_DCT_ECORRUPT;
    coef[zigzag[k]] = (int16_t)clamp_coef(receive_extend(br, s) * q[k]);
    last = k;
  }
  if (br_overrun(br)) return NN_DCT_ETRUNC;

  if (last > 0) {
    inverse_dct(coef, out, stride);
  } else {
    /* Same result as the full IDCT for a DC-only block. */
    uint8_t v = (uint8_t)clamp255(((coef[0] + 4) >> 3) + 128);
    for (r = 0; r < 8; r++, out += stride) {
      for (k = 0; k < 8; k++) out[k] = v;
    }
  }
  for (k = 0; k <= last; k++) coef[zigzag[k]] = 0;
  return NN_DCT_OK;
}

/* ------------------------------------------------------------------------ */
/* Color conversion */

/* JFIF YCbCr -> RGB in 16.16 fixed point (same constants as libjpeg). */
#define FIX_R_CR 91881  /* 1.402 */
#define FIX_G_CB 22554  /* 0.344136 */
#define FIX_G_CR 46802  /* 0.714136 */
#define FIX_B_CB 116130 /* 1.772 */
#define ONE_HALF (1 << 15)
/* 8-bit to 5/6-bit scale factors: 31/255 and 63/255 in 16.16. */
#define SCALE_5 7967
#define SCALE_6 16191

HOT uint16_t ycc_to_565(int32_t y, int32_t cb, int32_t cr, int32_t d) {
  int32_t r, g, b;
  cb -= 128;
  cr -= 128;
  r = clamp255(y + ((FIX_R_CR * cr + ONE_HALF) >> 16));
  g = clamp255(y + ((-FIX_G_CB * cb - FIX_G_CR * cr + ONE_HALF) >> 16));
  b = clamp255(y + ((FIX_B_CB * cb + ONE_HALF) >> 16));
  return (uint16_t)(((r * SCALE_5 + d) >> 16) << 11 | ((g * SCALE_6 + d) >> 16) << 5 |
                    ((b * SCALE_5 + d) >> 16));
}

HOT uint16_t gray_to_565(int32_t y, int32_t d) {
  int32_t c5 = (y * SCALE_5 + d) >> 16;
  return (uint16_t)(c5 << 11 | ((y * SCALE_6 + d) >> 16) << 5 | c5);
}

/* Converts n pixels of Y, Cb and Cr samples to RGB565 using dither row `d`. */
static void convert_row(const uint8_t *y, const uint8_t *cb, const uint8_t *cr, const uint16_t *d,
                        uint16_t *out, int n) {
  int x;
  for (x = 0; x < n; x++) out[x] = ycc_to_565(y[x], cb[x], cr[x], d[x & 3]);
}

/* Converts 8x8 blocks of Y, Cb and Cr to pixels at (x0, y0) of the tile. */
static void convert_color_block(const uint8_t *y, const uint8_t *cb, const uint8_t *cr,
                                uint16_t *out, int x0, int y0) {
  int r;
  for (r = 0; r < 8; r++) {
    convert_row(y + r * 8, cb + r * 8, cr + r * 8, dither[(y0 + r) & 3],
                out + (y0 + r) * TILE + x0, 8);
  }
}

/* Converts an 8x8 block of Y to gray pixels at (x0, y0) of the tile. */
static void convert_gray_block(const uint8_t *y, uint16_t *out, int x0, int y0) {
  int r, c;
  for (r = 0; r < 8; r++) {
    const uint16_t *d = dither[(y0 + r) & 3];
    uint16_t *o = out + (y0 + r) * TILE + x0;
    for (c = 0; c < 8; c++, y++) o[c] = gray_to_565(*y, d[c & 3]);
  }
}

/*
 * Upsamples one row of chroma to the tile width with libjpeg's "fancy"
 * triangle filter: each output sample is 3/4 of the nearest input and 1/4 of
 * the next nearest on each axis, edges replicated. `nearest` and `next` are
 * the two chroma rows closest to the output row.
 */
static void upsample_row(const uint8_t *nearest, const uint8_t *next, uint8_t *out) {
  int32_t prev, cur, following;
  int j;
  cur = 3 * nearest[0] + next[0];
  prev = cur;
  for (j = 0; j < CHROMA_TILE; j++) {
    following = j < CHROMA_TILE - 1 ? 3 * nearest[j + 1] + next[j + 1] : cur;
    out[2 * j] = (uint8_t)((3 * cur + prev + 8) >> 4);
    out[2 * j + 1] = (uint8_t)((3 * cur + following + 7) >> 4);
    prev = cur;
    cur = following;
  }
}

static void convert_420(const uint8_t *y, const uint8_t *cb, const uint8_t *cr, uint16_t *out) {
  uint8_t cb_row[TILE], cr_row[TILE];
  int row;
  for (row = 0; row < TILE; row++) {
    int nearest = row >> 1;
    int next = (row & 1) ? (nearest < CHROMA_TILE - 1 ? nearest + 1 : nearest)
                         : (nearest > 0 ? nearest - 1 : 0);
    upsample_row(cb + nearest * CHROMA_TILE, cb + next * CHROMA_TILE, cb_row);
    upsample_row(cr + nearest * CHROMA_TILE, cr + next * CHROMA_TILE, cr_row);
    convert_row(y + row * TILE, cb_row, cr_row, dither[row & 3], out + row * TILE, TILE);
  }
}

/* ------------------------------------------------------------------------ */
/* Tiles */

static int decode_gray(tile_decoder_t *d, uint16_t *out) {
  uint8_t y[64];
  int bx, by, err;
  for (by = 0; by < TILE; by += 8) {
    for (bx = 0; bx < TILE; bx += 8) {
      if ((err = decode_block(d, 0, y, 8)) != NN_DCT_OK) return err;
      convert_gray_block(y, out, bx, by);
    }
  }
  return NN_DCT_OK;
}

static int decode_444(tile_decoder_t *d, uint16_t *out) {
  uint8_t y[64], cb[64], cr[64];
  int bx, by, err;
  for (by = 0; by < TILE; by += 8) {
    for (bx = 0; bx < TILE; bx += 8) {
      if ((err = decode_block(d, 0, y, 8)) != NN_DCT_OK) return err;
      if ((err = decode_block(d, 1, cb, 8)) != NN_DCT_OK) return err;
      if ((err = decode_block(d, 2, cr, 8)) != NN_DCT_OK) return err;
      convert_color_block(y, cb, cr, out, bx, by);
    }
  }
  return NN_DCT_OK;
}

static int decode_420(tile_decoder_t *d, uint16_t *out) {
  uint8_t y[TILE * TILE];
  uint8_t cb[CHROMA_TILE * CHROMA_TILE], cr[CHROMA_TILE * CHROMA_TILE];
  int mx, my, i, err;
  for (my = 0; my < TILE; my += 16) {
    for (mx = 0; mx < TILE; mx += 16) {
      int c = (my / 2) * CHROMA_TILE + mx / 2;
      for (i = 0; i < 4; i++) {
        uint8_t *block = y + (my + (i >> 1) * 8) * TILE + mx + (i & 1) * 8;
        if ((err = decode_block(d, 0, block, TILE)) != NN_DCT_OK) return err;
      }
      if ((err = decode_block(d, 1, cb + c, CHROMA_TILE)) != NN_DCT_OK) return err;
      if ((err = decode_block(d, 2, cr + c, CHROMA_TILE)) != NN_DCT_OK) return err;
    }
  }
  convert_420(y, cb, cr, out);
  return NN_DCT_OK;
}

int nn_dct_decode_tile(const uint8_t *data, uint32_t len, int mode, int quality,
                       uint16_t *out) {
  tile_decoder_t d;
  int i;

  if (data == NULL || out == NULL) return NN_DCT_EINVAL;
  if (mode != NN_DCT_420 && mode != NN_DCT_444 && mode != NN_DCT_GRAY) return NN_DCT_EINVAL;
  prepare_tables(quality < 1 ? 1 : quality > 100 ? 100 : quality);

  d.br.p = data;
  d.br.end = data + len;
  d.br.acc = 0;
  d.br.bits = 0;
  d.br.pad = 0;
  d.pred[0] = d.pred[1] = d.pred[2] = 0;
  for (i = 0; i < 64; i++) d.coef[i] = 0;

  switch (mode) {
    case NN_DCT_GRAY: return decode_gray(&d, out);
    case NN_DCT_444: return decode_444(&d, out);
    default: return decode_420(&d, out);
  }
}
