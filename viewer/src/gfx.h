/* Drawing into a band: a small off-screen buffer covering part of the screen.
 * The screen is rendered band by band, so every function clips to the band.
 * All coordinates are screen pixels. */
#ifndef NN_GFX_H
#define NN_GFX_H

#include "nn.h"

typedef struct {
  uint16_t *px;   /* area.w * area.h pixels */
  nn_rect_t area; /* screen rect held by px */
  nn_rect_t clip; /* drawing is limited to this rect (always inside area) */
} gfx_t;

static inline uint16_t *gfx_ptr(const gfx_t *g, int x, int y) {
  return g->px + (y - g->area.y) * g->area.w + (x - g->area.x);
}

/* Blends fg over bg with alpha in 0..32. */
static inline uint16_t blend565(uint16_t bg, uint16_t fg, unsigned alpha) {
  uint32_t b = (bg | ((uint32_t)bg << 16)) & 0x07E0F81Fu;
  uint32_t f = (fg | ((uint32_t)fg << 16)) & 0x07E0F81Fu;
  uint32_t r = ((((f - b) * alpha) >> 5) + b) & 0x07E0F81Fu;
  return (uint16_t)(r | (r >> 16));
}

/* Restricts the clip; returns the previous clip for gfx_set_clip. */
nn_rect_t gfx_push_clip(gfx_t *g, nn_rect_t r);
void gfx_set_clip(gfx_t *g, nn_rect_t r);

void gfx_fill(gfx_t *g, nn_rect_t r, uint16_t color);
void gfx_fill_alpha(gfx_t *g, nn_rect_t r, uint16_t color, int alpha255);
void gfx_round_rect(gfx_t *g, nn_rect_t r, int radius, uint16_t color,
                    int alpha255);
void gfx_border(gfx_t *g, nn_rect_t r, int radius, int width, uint16_t color);
void gfx_hline(gfx_t *g, int x, int y, int w, uint16_t color);
void gfx_vline(gfx_t *g, int x, int y, int h, uint16_t color);

/* Anti-aliased thick line in 1/16 px coordinates. `arrows`: bit0 start,
 * bit1 end. */
void gfx_line(gfx_t *g, int x0, int y0, int x1, int y1, int width16,
              uint16_t color, int arrows);
void gfx_ellipse(gfx_t *g, nn_rect_t box, bool filled, uint16_t fill,
                 int stroke_width, uint16_t stroke);
void gfx_triangle(gfx_t *g, float x0, float y0, float x1, float y1, float x2,
                  float y2, uint16_t color);

/* Draws a coverage mask (1/2/4 bpp, rows byte aligned) stretched to `dst`. */
void gfx_mask(gfx_t *g, nn_rect_t dst, const uint8_t *mask, int mw, int mh,
              int bpp, uint16_t color);

#endif
