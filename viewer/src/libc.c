/* The few libc functions the viewer (and the compiler) needs. Built for the
 * calculator and wasm, where there is no C library. */
#include "nn.h"

/* Stop GCC from turning these loops back into calls to themselves. */
/* The compiler may emit calls to these after link-time optimization has
 * decided they were unused, so keep them visible. */
#if defined(__GNUC__) && !defined(__clang__)
#define NO_LOOP_PATTERNS                                                   \
  __attribute__((optimize("no-tree-loop-distribute-patterns"), used,      \
                 externally_visible))
#else
#define NO_LOOP_PATTERNS __attribute__((used))
#endif

NO_LOOP_PATTERNS void *memcpy(void *dst, const void *src, size_t n) {
  uint8_t *d = dst;
  const uint8_t *s = src;
  if ((((uintptr_t)d | (uintptr_t)s | n) & 3) == 0) {
    uint32_t *dw = (uint32_t *)d;
    const uint32_t *sw = (const uint32_t *)s;
    for (size_t i = 0; i < n / 4; i++) dw[i] = sw[i];
    return dst;
  }
  while (n--) *d++ = *s++;
  return dst;
}

NO_LOOP_PATTERNS void *memmove(void *dst, const void *src, size_t n) {
  uint8_t *d = dst;
  const uint8_t *s = src;
  if (d == s || n == 0) return dst;
  if (d < s || d >= s + n) return memcpy(dst, src, n);
  d += n;
  s += n;
  while (n--) *--d = *--s;
  return dst;
}

NO_LOOP_PATTERNS void *memset(void *dst, int c, size_t n) {
  uint8_t *d = dst;
  if ((((uintptr_t)d | n) & 3) == 0) {
    uint32_t v = (uint8_t)c;
    v |= v << 8;
    v |= v << 16;
    uint32_t *dw = (uint32_t *)d;
    for (size_t i = 0; i < n / 4; i++) dw[i] = v;
    return dst;
  }
  while (n--) *d++ = (uint8_t)c;
  return dst;
}

NO_LOOP_PATTERNS int memcmp(const void *a, const void *b, size_t n) {
  const uint8_t *x = a, *y = b;
  for (size_t i = 0; i < n; i++) {
    if (x[i] != y[i]) return x[i] - y[i];
  }
  return 0;
}

NO_LOOP_PATTERNS size_t strlen(const char *s) {
  const char *p = s;
  while (*p) p++;
  return (size_t)(p - s);
}
