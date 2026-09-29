/*
 * LZ4 block decompression, bounds-checked on both input and output.
 *
 * A block is a series of sequences: a token byte (literal count in the high
 * nibble, match length - 4 in the low one), optional length extension bytes,
 * the literals, a 16-bit little-endian match offset and optional match length
 * extension bytes. The final sequence stops after its literals.
 */
#include "lz4.h"

#include <stddef.h>

#if defined(__has_include)
#if __has_include(<string.h>)
#include <string.h>
#define NN_HAVE_STRING_H 1
#endif
#endif
#ifndef NN_HAVE_STRING_H
void *memcpy(void *dst, const void *src, size_t n);
#endif

#define MIN_MATCH 4
#define SHORT_COPY 16

/*
 * Adds the extension bytes that follow a length nibble of 15 to *len.
 * Fails if the input ends first or the total exceeds `limit`.
 */
static int read_length(const uint8_t **pp, const uint8_t *end, uint32_t *len,
                       uint32_t limit) {
  const uint8_t *p = *pp;
  uint32_t n = *len;
  uint8_t b;
  do {
    if (p >= end) return -1;
    b = *p++;
    n += b;
    if (n > limit) return -1;
  } while (b == 255);
  *pp = p;
  *len = n;
  return 0;
}

static void copy_bytes(uint8_t *dst, const uint8_t *src, uint32_t n) {
  if (n > SHORT_COPY) {
    memcpy(dst, src, n);
    return;
  }
  while (n--) *dst++ = *src++;
}

/* Copies a match that may overlap its own output (offset < length). */
static void copy_match(uint8_t *op, const uint8_t *match, uint32_t len) {
  if ((uint32_t)(op - match) >= len) {
    copy_bytes(op, match, len);
    return;
  }
  while (len--) *op++ = *match++;
}

int nn_lz4_decompress(const uint8_t *src, int src_len, uint8_t *dst, int dst_cap) {
  const uint8_t *ip, *iend;
  uint8_t *op, *oend;

  if (src == NULL || dst == NULL || src_len <= 0 || dst_cap < 0) return -1;
  ip = src;
  iend = src + src_len;
  op = dst;
  oend = dst + dst_cap;

  for (;;) {
    uint32_t token, lit, offset, mlen;

    if (ip >= iend) return -1;
    token = *ip++;

    lit = token >> 4;
    if (lit == 15 && read_length(&ip, iend, &lit, (uint32_t)dst_cap) < 0) return -1;
    if (lit > (uint32_t)(iend - ip) || lit > (uint32_t)(oend - op)) return -1;
    copy_bytes(op, ip, lit);
    ip += lit;
    op += lit;
    if (ip == iend) break; /* the last sequence has no match */

    if (iend - ip < 2) return -1;
    offset = ip[0] | (uint32_t)ip[1] << 8;
    ip += 2;
    if (offset == 0 || offset > (uint32_t)(op - dst)) return -1;

    mlen = token & 15;
    if (mlen == 15 && read_length(&ip, iend, &mlen, (uint32_t)dst_cap) < 0) return -1;
    mlen += MIN_MATCH;
    if (mlen > (uint32_t)(oend - op)) return -1;
    copy_match(op, op - offset, mlen);
    op += mlen;
  }
  return (int)(op - dst);
}
