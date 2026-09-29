/*
 * Native cross-check of the viewer's LZ4 and DCT decoders against vectors
 * written by the TypeScript encoders (see run_codec_test.sh), plus fuzzing
 * with truncated and corrupted input. Meant to be built with ASan/UBSan.
 *
 *   codec_test DIR          check DIR/cases.txt and fuzz the decoders
 *   codec_test DIR --bench  measure decoding speed
 *
 * cases.txt lines:
 *   lz4 NAME SIZE                 NAME.raw, NAME.lz4
 *   dct NAME MODE QUALITY W H     NAME.tile (encoded), NAME.ref (TS decoder
 *                                 output, u16 LE), NAME.src (32x32 RGB888
 *                                 source, of which W x H px are in the image)
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "dct.h"
#include "lz4.h"

#define TILE_PIXELS (NN_DCT_TILE_SIZE * NN_DCT_TILE_SIZE)
#define MAX_CASES 4096
#define FULL_PREFIX_LIMIT 4096 /* check every prefix of blocks up to this size */
#define CORRUPTIONS 200        /* corrupted copies per vector */
#define RANDOM_INPUTS 3000     /* random garbage inputs per decoder */
/* The decoders should agree bit for bit; allow a little slack. */
#define MAX_CHANNEL_DIFF 2
#define MAX_PSNR_DELTA 0.1

typedef struct {
  uint8_t *data;
  long size;
} blob_t;

typedef struct {
  int is_dct;
  char name[96];
  long size;          /* lz4: decompressed size */
  int mode, quality;  /* dct */
  int width, height;  /* dct: part of the tile inside the image */
} test_case_t;

static int failures;

#define CHECK(cond, ...)                   \
  do {                                     \
    if (!(cond)) {                         \
      failures++;                          \
      fprintf(stderr, "FAIL: " __VA_ARGS__); \
      fputc('\n', stderr);                 \
    }                                      \
  } while (0)

static uint32_t rng_state = 0x9E3779B9u;

static uint32_t rng(void) {
  rng_state ^= rng_state << 13;
  rng_state ^= rng_state >> 17;
  rng_state ^= rng_state << 5;
  return rng_state;
}

static void *xmalloc(size_t n) {
  void *p = malloc(n ? n : 1);
  if (!p) {
    fprintf(stderr, "out of memory\n");
    exit(2);
  }
  return p;
}

/* Heap copy of exactly `n` bytes, so ASan catches any read past the end. */
static uint8_t *copy_exact(const uint8_t *src, long n) {
  uint8_t *p = xmalloc((size_t)n);
  if (n > 0) memcpy(p, src, (size_t)n);
  return p;
}

static blob_t load(const char *dir, const char *name, const char *ext) {
  char path[512];
  blob_t b;
  FILE *f;
  snprintf(path, sizeof path, "%s/%s%s", dir, name, ext);
  f = fopen(path, "rb");
  if (!f) {
    perror(path);
    exit(2);
  }
  fseek(f, 0, SEEK_END);
  b.size = ftell(f);
  fseek(f, 0, SEEK_SET);
  b.data = xmalloc((size_t)b.size);
  if (b.size > 0 && fread(b.data, 1, (size_t)b.size, f) != (size_t)b.size) {
    perror(path);
    exit(2);
  }
  fclose(f);
  return b;
}

static int load_cases(const char *dir, test_case_t *cases) {
  char path[512], kind[8];
  int n = 0;
  FILE *f;
  snprintf(path, sizeof path, "%s/cases.txt", dir);
  f = fopen(path, "r");
  if (!f) {
    perror(path);
    exit(2);
  }
  while (n < MAX_CASES && fscanf(f, "%7s %95s", kind, cases[n].name) == 2) {
    test_case_t *c = &cases[n];
    c->is_dct = strcmp(kind, "dct") == 0;
    if (c->is_dct) {
      if (fscanf(f, "%d %d %d %d", &c->mode, &c->quality, &c->width, &c->height) != 4) break;
    } else if (fscanf(f, "%ld", &c->size) != 1) {
      break;
    }
    n++;
  }
  fclose(f);
  return n;
}

/* ------------------------------------------------------------------------ */
/* LZ4 */

static void fuzz_lz4(const test_case_t *c, const blob_t *comp) {
  uint8_t *out = xmalloc((size_t)c->size);
  long len;
  int i;

  /* A strict prefix must never decode to the full output. */
  for (len = 0; len < comp->size; len++) {
    uint8_t *src;
    int n;
    if (comp->size > FULL_PREFIX_LIMIT && (rng() % (uint32_t)(comp->size / 256 + 1)) != 0) continue;
    src = copy_exact(comp->data, len);
    n = nn_lz4_decompress(src, (int)len, out, (int)c->size);
    CHECK(n >= -1 && n < c->size, "lz4 %s: %ld-byte prefix decoded to %d bytes", c->name, len, n);
    free(src);
  }

  for (i = 0; i < CORRUPTIONS && comp->size > 0; i++) {
    uint8_t *src = copy_exact(comp->data, comp->size);
    int flips = 1 + (int)(rng() % 4), j, n;
    for (j = 0; j < flips; j++) {
      long at = (long)(rng() % (uint32_t)comp->size);
      if (rng() & 1) src[at] ^= (uint8_t)(1u << (rng() % 8));
      else src[at] = (uint8_t)rng();
    }
    n = nn_lz4_decompress(src, (int)comp->size, out, (int)c->size);
    CHECK(n >= -1 && n <= c->size, "lz4 %s: corrupted block returned %d", c->name, n);
    free(src);
  }
  free(out);
}

static void check_lz4(const char *dir, const test_case_t *c) {
  blob_t raw = load(dir, c->name, ".raw");
  blob_t comp = load(dir, c->name, ".lz4");
  uint8_t *src = copy_exact(comp.data, comp.size);
  uint8_t *out = xmalloc((size_t)c->size);
  int n;

  CHECK(raw.size == c->size, "lz4 %s: raw file has %ld bytes, expected %ld", c->name, raw.size, c->size);
  n = nn_lz4_decompress(src, (int)comp.size, out, (int)c->size);
  CHECK(n == c->size && memcmp(out, raw.data, (size_t)c->size) == 0,
        "lz4 %s: decoded %d bytes, expected %ld identical bytes", c->name, n, c->size);
  if (c->size > 0) {
    n = nn_lz4_decompress(src, (int)comp.size, out, (int)c->size - 1);
    CHECK(n == -1, "lz4 %s: accepted a buffer one byte too small (%d)", c->name, n);
  }
  fuzz_lz4(c, &comp);

  free(src);
  free(out);
  free(raw.data);
  free(comp.data);
}

static void fuzz_lz4_random(void) {
  int i;
  for (i = 0; i < RANDOM_INPUTS; i++) {
    int len = (int)(rng() % 300), cap = (int)(rng() % 1000), j, n;
    uint8_t *src = xmalloc((size_t)len);
    uint8_t *out = xmalloc((size_t)cap);
    for (j = 0; j < len; j++) src[j] = (uint8_t)rng();
    /* Bias towards plausible tokens so decoding gets past the first sequence. */
    if (len > 0 && (i & 1)) src[0] = (uint8_t)(rng() & 0x3F);
    n = nn_lz4_decompress(src, len, out, cap);
    CHECK(n >= -1 && n <= cap, "lz4: random input returned %d (cap %d)", n, cap);
    free(src);
    free(out);
  }
  CHECK(nn_lz4_decompress(NULL, 1, (uint8_t *)&failures, 4) == -1, "lz4: accepted NULL src");
}

/* ------------------------------------------------------------------------ */
/* DCT */

#define MAX_KINDS 8

typedef struct {
  int tiles, exact;
  long bytes;
  double sse[MAX_KINDS];  /* squared error of the C output, per image kind */
  long samples[MAX_KINDS];
} dct_stats_t;

static const char *const mode_names[3] = {"4:2:0", "4:4:4", "gray"};
static const int stat_qualities[] = {10, 50, 85, 100};
#define STAT_QUALITIES (int)(sizeof stat_qualities / sizeof stat_qualities[0])
static dct_stats_t dct_stats[3][STAT_QUALITIES];

/* Image kinds, taken from the vector names ("photo_444_q85_0_32" -> "photo"). */
static char kind_names[MAX_KINDS][16];
static int kind_count;

static int kind_index(const char *name) {
  char kind[16];
  size_t n = strcspn(name, "_");
  int i;
  if (n >= sizeof kind) n = sizeof kind - 1;
  memcpy(kind, name, n);
  kind[n] = 0;
  for (i = 0; i < kind_count; i++) {
    if (strcmp(kind_names[i], kind) == 0) return i;
  }
  if (kind_count == MAX_KINDS) return MAX_KINDS - 1;
  memcpy(kind_names[kind_count], kind, n + 1);
  return kind_count++;
}

/* Squared error of RGB565 pixels (expanded to 8 bits) against RGB888 source. */
static double tile_sse(const uint16_t *px, const uint8_t *rgb, int width, int height) {
  double sum = 0;
  int x, y;
  for (y = 0; y < height; y++) {
    for (x = 0; x < width; x++) {
      uint16_t p = px[y * NN_DCT_TILE_SIZE + x];
      const uint8_t *s = rgb + 3 * (y * NN_DCT_TILE_SIZE + x);
      int r5 = p >> 11, g6 = (p >> 5) & 63, b5 = p & 31;
      int dr = ((r5 << 3) | (r5 >> 2)) - s[0];
      int dg = ((g6 << 2) | (g6 >> 4)) - s[1];
      int db = ((b5 << 3) | (b5 >> 2)) - s[2];
      sum += dr * dr + dg * dg + db * db;
    }
  }
  return sum;
}

static double psnr(double sse, long samples) {
  return sse == 0 ? 99.0 : 10.0 * log10(255.0 * 255.0 * (double)samples / sse);
}

static int channel_diff(uint16_t a, uint16_t b) {
  int dr = abs((a >> 11) - (b >> 11));
  int dg = abs(((a >> 5) & 63) - ((b >> 5) & 63));
  int db = abs((a & 31) - (b & 31));
  int d = dr > dg ? dr : dg;
  return d > db ? d : db;
}

static void fuzz_dct(const test_case_t *c, const blob_t *tile) {
  uint16_t *out = xmalloc(TILE_PIXELS * sizeof *out);
  long len;
  int i, rc;

  /* Every strict prefix is missing coded bits and must be rejected. */
  for (len = 0; len < tile->size; len++) {
    uint8_t *src = copy_exact(tile->data, len);
    rc = nn_dct_decode_tile(src, (uint32_t)len, c->mode, c->quality, out);
    CHECK(rc == NN_DCT_ETRUNC || rc == NN_DCT_ECORRUPT, "dct %s: %ld-byte prefix returned %d",
          c->name, len, rc);
    free(src);
  }

  for (i = 0; i < CORRUPTIONS && tile->size > 0; i++) {
    uint8_t *src = copy_exact(tile->data, tile->size);
    int flips = 1 + (int)(rng() % 4), j;
    for (j = 0; j < flips; j++) {
      long at = (long)(rng() % (uint32_t)tile->size);
      if (rng() & 1) src[at] ^= (uint8_t)(1u << (rng() % 8));
      else src[at] = (uint8_t)rng();
    }
    rc = nn_dct_decode_tile(src, (uint32_t)tile->size, c->mode, c->quality, out);
    CHECK(rc <= 0, "dct %s: corrupted tile returned %d", c->name, rc);
    free(src);
  }

  /* Wrong mode or quality for the data. */
  for (i = 0; i < 3; i++) {
    rc = nn_dct_decode_tile(tile->data, (uint32_t)tile->size, i, 1 + (int)(rng() % 100), out);
    CHECK(rc <= 0, "dct %s: decoding as mode %d returned %d", c->name, i, rc);
  }
  free(out);
}

static void check_dct(const char *dir, const test_case_t *c) {
  blob_t tile = load(dir, c->name, ".tile");
  blob_t ref = load(dir, c->name, ".ref");
  blob_t src = load(dir, c->name, ".src");
  uint8_t *data = copy_exact(tile.data, tile.size);
  uint16_t *out = xmalloc(TILE_PIXELS * sizeof *out);
  uint16_t expected[TILE_PIXELS];
  int rc, i, max_diff = 0, q;

  CHECK(ref.size == TILE_PIXELS * 2 && src.size == TILE_PIXELS * 3, "dct %s: bad reference files",
        c->name);
  if (ref.size != TILE_PIXELS * 2 || src.size != TILE_PIXELS * 3) exit(1);
  for (i = 0; i < TILE_PIXELS; i++) expected[i] = (uint16_t)(ref.data[2 * i] | ref.data[2 * i + 1] << 8);

  rc = nn_dct_decode_tile(data, (uint32_t)tile.size, c->mode, c->quality, out);
  CHECK(rc == NN_DCT_OK, "dct %s: decoder returned %d", c->name, rc);
  if (rc == NN_DCT_OK) {
    long samples = 3L * c->width * c->height;
    double sse_c = tile_sse(out, src.data, c->width, c->height);
    double psnr_c = psnr(sse_c, samples);
    double psnr_ts = psnr(tile_sse(expected, src.data, c->width, c->height), samples);
    for (i = 0; i < TILE_PIXELS; i++) {
      int d = channel_diff(out[i], expected[i]);
      if (d > max_diff) max_diff = d;
    }
    CHECK(max_diff <= MAX_CHANNEL_DIFF && fabs(psnr_c - psnr_ts) <= MAX_PSNR_DELTA,
          "dct %s: C and TS decoders differ (max %d levels, PSNR %.2f vs %.2f dB)", c->name,
          max_diff, psnr_c, psnr_ts);
    for (q = 0; q < STAT_QUALITIES; q++) {
      if (stat_qualities[q] == c->quality && c->mode >= 0 && c->mode < 3) {
        dct_stats_t *s = &dct_stats[c->mode][q];
        s->tiles++;
        s->exact += max_diff == 0;
        s->bytes += tile.size;
        s->sse[kind_index(c->name)] += sse_c;
        s->samples[kind_index(c->name)] += samples;
      }
    }
  }
  fuzz_dct(c, &tile);

  free(data);
  free(out);
  free(tile.data);
  free(ref.data);
  free(src.data);
}

static void fuzz_dct_random(void) {
  uint16_t *out = xmalloc(TILE_PIXELS * sizeof *out);
  uint8_t byte = 0;
  int i;
  for (i = 0; i < RANDOM_INPUTS; i++) {
    int len = (int)(rng() % 600), j, rc;
    uint8_t *src = xmalloc((size_t)len);
    /* Mostly-zero data decodes as long runs of valid short codes. */
    for (j = 0; j < len; j++) src[j] = (i & 1) ? (uint8_t)rng() : (uint8_t)(rng() % 7 ? 0 : rng());
    rc = nn_dct_decode_tile(src, (uint32_t)len, (int)(rng() % 3), 1 + (int)(rng() % 100), out);
    CHECK(rc <= 0, "dct: random input returned %d", rc);
    free(src);
  }
  CHECK(nn_dct_decode_tile(NULL, 0, NN_DCT_420, 50, out) == NN_DCT_EINVAL, "dct: accepted NULL data");
  CHECK(nn_dct_decode_tile(&byte, 1, NN_DCT_420, 50, NULL) == NN_DCT_EINVAL, "dct: accepted NULL out");
  CHECK(nn_dct_decode_tile(&byte, 1, 7, 50, out) == NN_DCT_EINVAL, "dct: accepted mode 7");
  CHECK(nn_dct_decode_tile(&byte, 0, NN_DCT_GRAY, 50, out) < 0, "dct: accepted empty data");
  free(out);
}

static void print_dct_stats(void) {
  int m, q, k;
  printf("  mode   q    bytes/tile  bit-exact  RGB565 PSNR (dB):");
  for (k = 0; k < kind_count; k++) printf(" %9s", kind_names[k]);
  printf("\n");
  for (m = 0; m < 3; m++) {
    for (q = 0; q < STAT_QUALITIES; q++) {
      const dct_stats_t *s = &dct_stats[m][q];
      if (!s->tiles) continue;
      printf("  %-5s  %-3d  %10.1f  %4d/%-4d                  ", mode_names[m], stat_qualities[q],
             (double)s->bytes / s->tiles, s->exact, s->tiles);
      for (k = 0; k < kind_count; k++) printf(" %9.2f", psnr(s->sse[k], s->samples[k]));
      printf("\n");
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Benchmark */

static double seconds(void) { return (double)clock() / CLOCKS_PER_SEC; }

static void bench(const char *dir, const test_case_t *cases, int count) {
  static blob_t blobs[MAX_CASES];
  uint16_t out[TILE_PIXELS];
  uint8_t *out8 = NULL;
  long max_raw = 0, bytes = 0;
  double start, elapsed;
  int mode, i;

  for (i = 0; i < count; i++) {
    blobs[i] = load(dir, cases[i].name, cases[i].is_dct ? ".tile" : ".lz4");
    if (!cases[i].is_dct && cases[i].size > max_raw) max_raw = cases[i].size;
  }

  printf("  DCT decode speed (host CPU, all test tiles):\n");
  for (mode = 0; mode < 3; mode++) {
    long decoded = 0;
    start = seconds();
    do {
      for (i = 0; i < count; i++) {
        if (!cases[i].is_dct || cases[i].mode != mode) continue;
        nn_dct_decode_tile(blobs[i].data, (uint32_t)blobs[i].size, mode, cases[i].quality, out);
        decoded++;
      }
      elapsed = seconds() - start;
    } while (elapsed < 1.0);
    printf("    %-5s  %9.0f tiles/s  %6.2f us/tile\n", mode_names[mode], decoded / elapsed,
           1e6 * elapsed / decoded);
  }

  out8 = xmalloc((size_t)max_raw);
  start = seconds();
  do {
    for (i = 0; i < count; i++) {
      if (cases[i].is_dct) continue;
      nn_lz4_decompress(blobs[i].data, (int)blobs[i].size, out8, (int)cases[i].size);
      bytes += cases[i].size;
    }
    elapsed = seconds() - start;
  } while (elapsed < 0.5);
  printf("  LZ4 decode speed: %.0f MB/s of output\n", bytes / elapsed / 1e6);

  free(out8);
  for (i = 0; i < count; i++) free(blobs[i].data);
}

int main(int argc, char **argv) {
  static test_case_t cases[MAX_CASES];
  int count, i, lz4_cases = 0, dct_cases = 0;

  if (argc < 2) {
    fprintf(stderr, "usage: %s DIR [--bench]\n", argv[0]);
    return 2;
  }
  count = load_cases(argv[1], cases);
  if (argc > 2 && strcmp(argv[2], "--bench") == 0) {
    bench(argv[1], cases, count);
    return 0;
  }

  for (i = 0; i < count; i++) {
    if (cases[i].is_dct) {
      check_dct(argv[1], &cases[i]);
      dct_cases++;
    } else {
      check_lz4(argv[1], &cases[i]);
      lz4_cases++;
    }
  }
  fuzz_lz4_random();
  fuzz_dct_random();

  printf("  LZ4: %d vectors decoded byte-exactly, every prefix and %d corruptions each fuzzed\n",
         lz4_cases, CORRUPTIONS);
  printf("  DCT: %d tiles compared with the TS reference decoder, every prefix and %d corruptions each fuzzed\n",
         dct_cases, CORRUPTIONS);
  print_dct_stats();
  if (failures) {
    printf("  %d check(s) FAILED\n", failures);
    return 1;
  }
  if (lz4_cases == 0 || dct_cases == 0) {
    printf("  no test vectors found\n");
    return 1;
  }
  return 0;
}
