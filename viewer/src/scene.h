/* Rendering a scene (a page, document or canvas) through a pan/zoom view. */
#ifndef NN_SCENE_H
#define NN_SCENE_H

#include "format.h"
#include "gfx.h"

#define ZOOM_ONE 65536

typedef struct {
  int scene;            /* absolute scene index */
  nn_rect_t viewport;   /* where the scene appears on screen */
  int32_t ox, oy;       /* scene point shown at the viewport's top-left */
  int32_t zoom;         /* 16.16 */
  uint32_t epoch;       /* when animations started */
} scene_view_t;

/* Scene <-> screen conversions. */
int scene_to_screen_x(const scene_view_t *v, int32_t x);
int scene_to_screen_y(const scene_view_t *v, int32_t y);
nn_rect_t scene_rect_to_screen(const scene_view_t *v, int32_t x, int32_t y,
                               int32_t w, int32_t h);
/* Size of the viewport in scene units. */
int32_t scene_view_w(const scene_view_t *v);
int32_t scene_view_h(const scene_view_t *v);

void scene_draw(gfx_t *g, const scene_view_t *v, uint32_t now);

/* Animated content: next time (ms) a visible frame changes, or UINT32_MAX,
 * and the screen area that changes then. */
uint32_t scene_next_frame(const scene_view_t *v, uint32_t now, nn_rect_t *dirty);

/* Frame of an animation at `elapsed` ms; sets *next to the ms until the
 * following frame (UINT32_MAX if it stopped). */
int anim_frame_at(int anim, uint32_t elapsed, uint32_t *next);

#endif
