#ifndef NN_H
#define NN_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define NN_SCREEN_W 320
#define NN_SCREEN_H 240
#define NN_STATUS_H 20
#define NN_STORE_SIZE 65536

#define NN_MIN(a, b) ((a) < (b) ? (a) : (b))
#define NN_MAX(a, b) ((a) > (b) ? (a) : (b))
#define NN_CLAMP(v, lo, hi) ((v) < (lo) ? (lo) : (v) > (hi) ? (hi) : (v))
#define NN_ABS(a) ((a) < 0 ? -(a) : (a))
#define NN_COUNT(a) (sizeof(a) / sizeof((a)[0]))

#define NN_RGB(r, g, b) \
  ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))

typedef struct {
  int x, y, w, h;
} nn_rect_t;

static inline bool nn_rect_empty(nn_rect_t r) { return r.w <= 0 || r.h <= 0; }

static inline nn_rect_t nn_rect_intersect(nn_rect_t a, nn_rect_t b) {
  int x0 = NN_MAX(a.x, b.x), y0 = NN_MAX(a.y, b.y);
  int x1 = NN_MIN(a.x + a.w, b.x + b.w), y1 = NN_MIN(a.y + a.h, b.y + b.h);
  nn_rect_t r = {x0, y0, x1 - x0, y1 - y0};
  return r;
}

static inline nn_rect_t nn_rect_union(nn_rect_t a, nn_rect_t b) {
  if (nn_rect_empty(a)) return b;
  if (nn_rect_empty(b)) return a;
  int x0 = NN_MIN(a.x, b.x), y0 = NN_MIN(a.y, b.y);
  int x1 = NN_MAX(a.x + a.w, b.x + b.w), y1 = NN_MAX(a.y + a.h, b.y + b.h);
  nn_rect_t r = {x0, y0, x1 - x0, y1 - y0};
  return r;
}

void *memcpy(void *dst, const void *src, size_t n);
void *memmove(void *dst, const void *src, size_t n);
void *memset(void *dst, int c, size_t n);
int memcmp(const void *a, const void *b, size_t n);
size_t strlen(const char *s);

#endif
