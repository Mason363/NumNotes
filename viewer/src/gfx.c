#include "gfx.h"

nn_rect_t gfx_push_clip(gfx_t *g, nn_rect_t r) {
  nn_rect_t previous = g->clip;
  g->clip = nn_rect_intersect(g->clip, r);
  return previous;
}

void gfx_set_clip(gfx_t *g, nn_rect_t r) { g->clip = r; }

void gfx_fill(gfx_t *g, nn_rect_t r, uint16_t color) {
  r = nn_rect_intersect(r, g->clip);
  if (nn_rect_empty(r)) return;
  for (int y = r.y; y < r.y + r.h; y++) {
    uint16_t *p = gfx_ptr(g, r.x, y);
    for (int i = 0; i < r.w; i++) p[i] = color;
  }
}

void gfx_fill_alpha(gfx_t *g, nn_rect_t r, uint16_t color, int alpha255) {
  if (alpha255 >= 255) {
    gfx_fill(g, r, color);
    return;
  }
  unsigned a = (unsigned)(alpha255 * 32 + 127) / 255;
  if (a == 0) return;
  r = nn_rect_intersect(r, g->clip);
  if (nn_rect_empty(r)) return;
  for (int y = r.y; y < r.y + r.h; y++) {
    uint16_t *p = gfx_ptr(g, r.x, y);
    for (int i = 0; i < r.w; i++) p[i] = blend565(p[i], color, a);
  }
}

static inline void plot(gfx_t *g, int x, int y, uint16_t color, float coverage) {
  if (coverage <= 0.0f) return;
  uint16_t *p = gfx_ptr(g, x, y);
  if (coverage >= 1.0f) {
    *p = color;
  } else {
    *p = blend565(*p, color, (unsigned)(coverage * 32.0f + 0.5f));
  }
}

static float fast_sqrt(float x) {
#if defined(__arm__)
  float r;
  __asm__("vsqrt.f32 %0, %1" : "=t"(r) : "t"(x));
  return r;
#else
  return __builtin_sqrtf(x);
#endif
}

/* Coverage of pixel (x, y) by a rounded rect's corner zone, 1 elsewhere. */
static float corner_coverage(nn_rect_t r, int radius, int x, int y) {
  float cx, cy;
  if (x < r.x + radius) cx = r.x + radius;
  else if (x >= r.x + r.w - radius) cx = r.x + r.w - radius;
  else return 1.0f;
  if (y < r.y + radius) cy = r.y + radius;
  else if (y >= r.y + r.h - radius) cy = r.y + r.h - radius;
  else return 1.0f;
  float dx = x + 0.5f - cx, dy = y + 0.5f - cy;
  float d = fast_sqrt(dx * dx + dy * dy);
  return NN_CLAMP(radius - d + 0.5f, 0.0f, 1.0f);
}

void gfx_round_rect(gfx_t *g, nn_rect_t r, int radius, uint16_t color,
                    int alpha255) {
  radius = NN_MIN(radius, NN_MIN(r.w, r.h) / 2);
  if (radius <= 0) {
    gfx_fill_alpha(g, r, color, alpha255);
    return;
  }
  nn_rect_t c = nn_rect_intersect(r, g->clip);
  if (nn_rect_empty(c)) return;
  float alpha = alpha255 / 255.0f;
  for (int y = c.y; y < c.y + c.h; y++) {
    bool corner_row = y < r.y + radius || y >= r.y + r.h - radius;
    for (int x = c.x; x < c.x + c.w; x++) {
      float cov = corner_row ? corner_coverage(r, radius, x, y) : 1.0f;
      plot(g, x, y, color, cov * alpha);
    }
  }
}

void gfx_border(gfx_t *g, nn_rect_t r, int radius, int width, uint16_t color) {
  if (width <= 0) return;
  radius = NN_MIN(radius, NN_MIN(r.w, r.h) / 2);
  nn_rect_t inner = {r.x + width, r.y + width, r.w - 2 * width,
                     r.h - 2 * width};
  int inner_radius = NN_MAX(radius - width, 0);
  nn_rect_t c = nn_rect_intersect(r, g->clip);
  if (nn_rect_empty(c)) return;
  for (int y = c.y; y < c.y + c.h; y++) {
    for (int x = c.x; x < c.x + c.w; x++) {
      float outer = radius ? corner_coverage(r, radius, x, y) : 1.0f;
      float in = 0.0f;
      if (x >= inner.x && x < inner.x + inner.w && y >= inner.y &&
          y < inner.y + inner.h) {
        in = inner_radius ? corner_coverage(inner, inner_radius, x, y) : 1.0f;
      }
      plot(g, x, y, color, outer - in);
    }
  }
}

void gfx_hline(gfx_t *g, int x, int y, int w, uint16_t color) {
  nn_rect_t r = {x, y, w, 1};
  gfx_fill(g, r, color);
}

void gfx_vline(gfx_t *g, int x, int y, int h, uint16_t color) {
  nn_rect_t r = {x, y, 1, h};
  gfx_fill(g, r, color);
}

static nn_rect_t clip_box(gfx_t *g, float x0, float y0, float x1, float y1) {
  nn_rect_t r = {(int)(x0 - 1), (int)(y0 - 1), (int)(x1 - x0) + 3,
                 (int)(y1 - y0) + 3};
  return nn_rect_intersect(r, g->clip);
}

void gfx_triangle(gfx_t *g, float x0, float y0, float x1, float y1, float x2,
                  float y2, uint16_t color) {
  float area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (area == 0.0f) return;
  if (area < 0.0f) {
    float tx = x1, ty = y1;
    x1 = x2; y1 = y2; x2 = tx; y2 = ty;
  }
  nn_rect_t c = clip_box(g, NN_MIN(x0, NN_MIN(x1, x2)), NN_MIN(y0, NN_MIN(y1, y2)),
                         NN_MAX(x0, NN_MAX(x1, x2)), NN_MAX(y0, NN_MAX(y1, y2)));
  if (nn_rect_empty(c)) return;
  /* Signed distance to each edge, normalized so coverage fades over 1 px. */
  float ex[3] = {x1 - x0, x2 - x1, x0 - x2};
  float ey[3] = {y1 - y0, y2 - y1, y0 - y2};
  float ox[3] = {x0, x1, x2}, oy[3] = {y0, y1, y2};
  float inv[3];
  for (int i = 0; i < 3; i++) {
    float len = fast_sqrt(ex[i] * ex[i] + ey[i] * ey[i]);
    inv[i] = len > 0.0f ? 1.0f / len : 0.0f;
  }
  for (int y = c.y; y < c.y + c.h; y++) {
    for (int x = c.x; x < c.x + c.w; x++) {
      float px = x + 0.5f, py = y + 0.5f, cov = 1.0f;
      for (int i = 0; i < 3; i++) {
        float d = (ex[i] * (py - oy[i]) - ey[i] * (px - ox[i])) * inv[i];
        cov = NN_MIN(cov, NN_CLAMP(d + 0.5f, 0.0f, 1.0f));
      }
      plot(g, x, y, color, cov);
    }
  }
}

static void arrow_head(gfx_t *g, float tx, float ty, float dx, float dy,
                       float width, uint16_t color) {
  float len = fast_sqrt(dx * dx + dy * dy);
  if (len == 0.0f) return;
  dx /= len;
  dy /= len;
  float size = 4.0f + width * 2.5f;
  float bx = tx - dx * size, by = ty - dy * size;
  float nx = -dy * size * 0.55f, ny = dx * size * 0.55f;
  gfx_triangle(g, tx, ty, bx + nx, by + ny, bx - nx, by - ny, color);
}

void gfx_line(gfx_t *g, int x0, int y0, int x1, int y1, int width16,
              uint16_t color, int arrows) {
  float ax = x0 / 16.0f, ay = y0 / 16.0f, bx = x1 / 16.0f, by = y1 / 16.0f;
  float half = NN_MAX(width16, 8) / 32.0f;
  float dx = bx - ax, dy = by - ay;
  float len2 = dx * dx + dy * dy;
  /* Shorten the shaft so it doesn't poke through arrow heads. */
  float head = 4.0f + half * 5.0f, len = fast_sqrt(len2);
  float sax = ax, say = ay, sbx = bx, sby = by;
  if (len > head * 2.0f) {
    if (arrows & 1) { sax += dx / len * head * 0.7f; say += dy / len * head * 0.7f; }
    if (arrows & 2) { sbx -= dx / len * head * 0.7f; sby -= dy / len * head * 0.7f; }
  }
  nn_rect_t c = clip_box(g, NN_MIN(ax, bx) - half, NN_MIN(ay, by) - half,
                         NN_MAX(ax, bx) + half, NN_MAX(ay, by) + half);
  float sdx = sbx - sax, sdy = sby - say, slen2 = sdx * sdx + sdy * sdy;
  for (int y = c.y; y < c.y + c.h && !nn_rect_empty(c); y++) {
    for (int x = c.x; x < c.x + c.w; x++) {
      float px = x + 0.5f - sax, py = y + 0.5f - say;
      float t = slen2 > 0.0f ? (px * sdx + py * sdy) / slen2 : 0.0f;
      t = NN_CLAMP(t, 0.0f, 1.0f);
      float qx = px - t * sdx, qy = py - t * sdy;
      float d = fast_sqrt(qx * qx + qy * qy);
      plot(g, x, y, color, NN_CLAMP(half - d + 0.5f, 0.0f, 1.0f));
    }
  }
  if (arrows & 1) arrow_head(g, ax, ay, -dx, -dy, half * 2.0f, color);
  if (arrows & 2) arrow_head(g, bx, by, dx, dy, half * 2.0f, color);
}

void gfx_ellipse(gfx_t *g, nn_rect_t box, bool filled, uint16_t fill,
                 int stroke_width, uint16_t stroke) {
  nn_rect_t c = nn_rect_intersect(box, g->clip);
  if (nn_rect_empty(c) || box.w < 2 || box.h < 2) return;
  float rx = box.w / 2.0f, ry = box.h / 2.0f;
  float cx = box.x + rx, cy = box.y + ry;
  float scale = NN_MIN(rx, ry);
  for (int y = c.y; y < c.y + c.h; y++) {
    for (int x = c.x; x < c.x + c.w; x++) {
      float nx = (x + 0.5f - cx) / rx, ny = (y + 0.5f - cy) / ry;
      /* Approximate distance to the outline in pixels. */
      float d = (fast_sqrt(nx * nx + ny * ny) - 1.0f) * scale;
      float outside = NN_CLAMP(d + 0.5f, 0.0f, 1.0f);
      if (filled) plot(g, x, y, fill, 1.0f - outside);
      if (stroke_width > 0) {
        float inner = NN_CLAMP(-d - stroke_width + 0.5f, 0.0f, 1.0f);
        plot(g, x, y, stroke, (1.0f - outside) - inner);
      }
    }
  }
}

static inline unsigned mask_value(const uint8_t *row, int x, int bpp) {
  switch (bpp) {
    case 1: return ((row[x >> 3] >> (7 - (x & 7))) & 1) ? 32 : 0;
    case 2: {
      unsigned v = (row[x >> 2] >> (6 - 2 * (x & 3))) & 3;
      return (v * 32 + 1) / 3;
    }
    default: {
      unsigned v = (row[x >> 1] >> ((x & 1) ? 0 : 4)) & 15;
      return (v * 32 + 7) / 15;
    }
  }
}

/* Shrunk masks (zoomed-out text) average the source pixels each destination
 * pixel covers, so small text turns gray instead of breaking apart. */
static void mask_shrink(gfx_t *g, nn_rect_t dst, nn_rect_t c, const uint8_t *mask,
                        int mw, int mh, int bpp, int stride, uint16_t color) {
  for (int y = c.y; y < c.y + c.h; y++) {
    int y0 = (y - dst.y) * mh / dst.h;
    int y1 = NN_MAX((y - dst.y + 1) * mh / dst.h, y0 + 1);
    uint16_t *p = gfx_ptr(g, c.x, y);
    for (int i = 0; i < c.w; i++) {
      int x = c.x + i;
      int x0 = (x - dst.x) * mw / dst.w;
      int x1 = NN_MAX((x - dst.x + 1) * mw / dst.w, x0 + 1);
      unsigned sum = 0, n = 0;
      for (int sy = y0; sy < y1 && sy < mh; sy++) {
        const uint8_t *row = mask + sy * stride;
        for (int sx = x0; sx < x1 && sx < mw; sx++, n++) {
          sum += mask_value(row, sx, bpp);
        }
      }
      unsigned a = n ? sum / n : 0;
      if (a) p[i] = a >= 32 ? color : blend565(p[i], color, a);
    }
  }
}

void gfx_mask(gfx_t *g, nn_rect_t dst, const uint8_t *mask, int mw, int mh,
              int bpp, uint16_t color) {
  nn_rect_t c = nn_rect_intersect(dst, g->clip);
  if (nn_rect_empty(c) || mw <= 0 || mh <= 0) return;
  int stride = (mw * bpp + 7) / 8;
  if (dst.w < mw || dst.h < mh) {
    mask_shrink(g, dst, c, mask, mw, mh, bpp, stride, color);
    return;
  }
  /* 16.16 steps from destination to mask coordinates. */
  uint32_t sx_step = ((uint32_t)mw << 16) / (uint32_t)dst.w;
  uint32_t sy_step = ((uint32_t)mh << 16) / (uint32_t)dst.h;
  for (int y = c.y; y < c.y + c.h; y++) {
    int my = (int)(((uint32_t)(y - dst.y) * sy_step) >> 16);
    const uint8_t *row = mask + my * stride;
    uint16_t *p = gfx_ptr(g, c.x, y);
    uint32_t sx = (uint32_t)(c.x - dst.x) * sx_step;
    for (int i = 0; i < c.w; i++, sx += sx_step) {
      unsigned a = mask_value(row, (int)(sx >> 16), bpp);
      if (a) p[i] = a >= 32 ? color : blend565(p[i], color, a);
    }
  }
}
