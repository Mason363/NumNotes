#include "scene.h"

#include "bundle.h"
#include "image.h"
#include "text.h"

int scene_to_screen_x(const scene_view_t *v, int32_t x) {
  return v->viewport.x + (int)((((int64_t)x - v->ox) * v->zoom) >> 16);
}

int scene_to_screen_y(const scene_view_t *v, int32_t y) {
  return v->viewport.y + (int)((((int64_t)y - v->oy) * v->zoom) >> 16);
}

nn_rect_t scene_rect_to_screen(const scene_view_t *v, int32_t x, int32_t y,
                               int32_t w, int32_t h) {
  int x0 = scene_to_screen_x(v, x), y0 = scene_to_screen_y(v, y);
  int x1 = scene_to_screen_x(v, x + w), y1 = scene_to_screen_y(v, y + h);
  nn_rect_t r = {x0, y0, NN_MAX(x1 - x0, w > 0 ? 1 : 0),
                 NN_MAX(y1 - y0, h > 0 ? 1 : 0)};
  return r;
}

int32_t scene_view_w(const scene_view_t *v) {
  return (int32_t)(((int64_t)v->viewport.w << 16) / v->zoom);
}

int32_t scene_view_h(const scene_view_t *v) {
  return (int32_t)(((int64_t)v->viewport.h << 16) / v->zoom);
}

static int32_t screen_to_scene_y(const scene_view_t *v, int y) {
  return v->oy + (int32_t)((((int64_t)(y - v->viewport.y)) << 16) / v->zoom);
}

static int scale(const scene_view_t *v, int n) {
  return (int)(((int64_t)n * v->zoom + 32768) >> 16);
}

int anim_frame_at(int anim_index, uint32_t elapsed, uint32_t *next) {
  const nn_anim_t *anim = bundle_anim(anim_index);
  *next = UINT32_MAX;
  if (anim == NULL) return -1;
  const nn_frame_t *frames = bundle_frames(anim);
  uint32_t total = 0;
  for (int i = 0; i < anim->frame_count; i++) total += NN_MAX(frames[i].delay_ms, 20);
  if (total == 0 || anim->frame_count == 1) return frames[0].image;
  if (anim->loops && elapsed / total >= anim->loops) {
    return frames[anim->frame_count - 1].image;
  }
  uint32_t t = elapsed % total;
  for (int i = 0; i < anim->frame_count; i++) {
    uint32_t d = NN_MAX(frames[i].delay_ms, 20);
    if (t < d) {
      *next = d - t;
      return frames[i].image;
    }
    t -= d;
  }
  return frames[0].image;
}

static void draw_text(gfx_t *g, const scene_view_t *v, const nn_prim_text_t *t) {
  const nn_font_t *font = bundle_font(t->font);
  bool wide = font->flags & NN_FONT_WIDE;
  const uint8_t *glyphs8 = (const uint8_t *)(t + 1);
  const uint16_t *glyphs16 = (const uint16_t *)(t + 1);
  uint32_t available = (t->p.size - sizeof(*t)) / (wide ? 2 : 1);
  int count = NN_MIN(t->count, (int)available);

  int baseline = scene_to_screen_y(v, t->p.y + font->ascent);
  int32_t pen16 = t->p.x * 16; /* scene space */
  int clip_x1 = g->clip.x + g->clip.w;
  for (int i = 0; i < count; i++) {
    int glyph = wide ? glyphs16[i] : glyphs8[i];
    const nn_glyph_t *gl = font_glyph(font, glyph);
    if (gl == NULL) continue;
    int screen_pen16 = v->viewport.x * 16 +
                       (int)((((int64_t)pen16 - (int64_t)v->ox * 16) * v->zoom) >> 16);
    if (screen_pen16 / 16 > clip_x1) break;
    glyph_draw(g, font, glyph, screen_pen16, baseline, t->color, v->zoom);
    pen16 += gl->advance;
    if (glyph == font->space) pen16 += t->space_extra;
  }
  if (t->p.flags & (NN_TEXT_UNDERLINE | NN_TEXT_STRIKE)) {
    int x0 = scene_to_screen_x(v, t->p.x);
    int x1 = scene_to_screen_x(v, pen16 / 16);
    int thickness = NN_MAX(scale(v, 1), 1);
    if (t->p.flags & NN_TEXT_UNDERLINE) {
      nn_rect_t r = {x0, baseline + NN_MAX(scale(v, 2), 1), x1 - x0, thickness};
      gfx_fill(g, r, t->color);
    }
    if (t->p.flags & NN_TEXT_STRIKE) {
      nn_rect_t r = {x0, baseline - scale(v, font->ascent) * 3 / 10, x1 - x0,
                     thickness};
      gfx_fill(g, r, t->color);
    }
  }
}

static void draw_prim(gfx_t *g, const scene_view_t *v, const nn_prim_t *p,
                      uint32_t now) {
  nn_rect_t box = scene_rect_to_screen(v, p->x, p->y, p->w, p->h);
  if (nn_rect_empty(nn_rect_intersect(box, g->clip)) && p->type != NN_PRIM_LINE) {
    return;
  }
  switch (p->type) {
    case NN_PRIM_RECT: {
      const nn_prim_rect_t *r = (const nn_prim_rect_t *)p;
      if (p->size < sizeof(*r)) return;
      int radius = scale(v, r->radius);
      if (r->alpha) gfx_round_rect(g, box, radius, r->color, r->alpha);
      if (r->border_width) {
        gfx_border(g, box, radius, NN_MAX(scale(v, r->border_width), 1),
                   r->border_color);
      }
      break;
    }
    case NN_PRIM_IMAGE: {
      const nn_prim_image_t *im = (const nn_prim_image_t *)p;
      if (p->size < sizeof(*im)) return;
      image_draw(g, im->image, box);
      break;
    }
    case NN_PRIM_ANIM: {
      const nn_prim_anim_t *an = (const nn_prim_anim_t *)p;
      if (p->size < sizeof(*an)) return;
      uint32_t next;
      int frame = anim_frame_at(an->anim, now - v->epoch, &next);
      if (frame >= 0) image_draw(g, frame, box);
      break;
    }
    case NN_PRIM_TEXT: {
      const nn_prim_text_t *t = (const nn_prim_text_t *)p;
      if (p->size < sizeof(*t)) return;
      draw_text(g, v, t);
      break;
    }
    case NN_PRIM_LINE: {
      const nn_prim_line_t *l = (const nn_prim_line_t *)p;
      if (p->size < sizeof(*l)) return;
      int pad = scale(v, l->width + 12);
      nn_rect_t reach = {box.x - pad, box.y - pad, box.w + 2 * pad, box.h + 2 * pad};
      if (nn_rect_empty(nn_rect_intersect(reach, g->clip))) return;
      int x0 = scene_to_screen_x(v, 0) * 16 + (int)(((int64_t)l->x0 * v->zoom) >> 12);
      int y0 = scene_to_screen_y(v, 0) * 16 + (int)(((int64_t)l->y0 * v->zoom) >> 12);
      int x1 = scene_to_screen_x(v, 0) * 16 + (int)(((int64_t)l->x1 * v->zoom) >> 12);
      int y1 = scene_to_screen_y(v, 0) * 16 + (int)(((int64_t)l->y1 * v->zoom) >> 12);
      gfx_line(g, x0, y0, x1, y1, NN_MAX(scale(v, l->width * 16), 8), l->color,
               l->arrows);
      break;
    }
    case NN_PRIM_ELLIPSE: {
      const nn_prim_ellipse_t *e = (const nn_prim_ellipse_t *)p;
      if (p->size < sizeof(*e)) return;
      gfx_ellipse(g, box, e->filled, e->fill,
                  e->stroke_width ? NN_MAX(scale(v, e->stroke_width), 1) : 0,
                  e->stroke);
      break;
    }
    default:
      break;
  }
}

/* First primitive that may reach down to scene row y. Unsorted scenes are
 * scanned from the start. */
static uint32_t first_prim_below(const nn_scene_t *scene, int32_t y) {
  if (!(scene->flags & NN_SCENE_SORTED)) return 0;
  uint32_t lo = 0, hi = scene->prim_count;
  int32_t target = y - scene->max_prim_h;
  while (lo < hi) {
    uint32_t mid = (lo + hi) / 2;
    const nn_prim_t *p = bundle_prim(scene, mid);
    if (p != NULL && p->y < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

void scene_draw(gfx_t *g, const scene_view_t *v, uint32_t now) {
  const nn_scene_t *scene = bundle_scene(v->scene);
  nn_rect_t clip = nn_rect_intersect(g->clip, v->viewport);
  if (scene == NULL || nn_rect_empty(clip)) return;
  nn_rect_t saved = gfx_push_clip(g, v->viewport);
  gfx_fill(g, scene_rect_to_screen(v, 0, 0, scene->width, scene->height),
           scene->bg);

  int32_t top = screen_to_scene_y(v, clip.y) - 1;
  int32_t bottom = screen_to_scene_y(v, clip.y + clip.h) + 1;
  bool sorted = scene->flags & NN_SCENE_SORTED;
  for (uint32_t i = first_prim_below(scene, top); i < scene->prim_count; i++) {
    const nn_prim_t *p = bundle_prim(scene, i);
    if (p == NULL) continue;
    if (p->y > bottom) {
      if (sorted) break;
      continue;
    }
    if (p->y + p->h < top) continue;
    draw_prim(g, v, p, now);
  }
  gfx_set_clip(g, saved);
}

uint32_t scene_next_frame(const scene_view_t *v, uint32_t now, nn_rect_t *dirty) {
  const nn_scene_t *scene = bundle_scene(v->scene);
  nn_rect_t none = {0, 0, 0, 0};
  *dirty = none;
  if (scene == NULL || bundle_header()->anim_count == 0) return UINT32_MAX;
  int32_t top = v->oy, bottom = v->oy + scene_view_h(v);
  uint32_t best = UINT32_MAX;
  for (uint32_t i = first_prim_below(scene, top); i < scene->prim_count; i++) {
    const nn_prim_t *p = bundle_prim(scene, i);
    if (p == NULL) continue;
    if (p->y > bottom) {
      if (scene->flags & NN_SCENE_SORTED) break;
      continue;
    }
    if (p->type != NN_PRIM_ANIM || p->y + p->h < top) continue;
    nn_rect_t box = nn_rect_intersect(
        scene_rect_to_screen(v, p->x, p->y, p->w, p->h), v->viewport);
    if (nn_rect_empty(box)) continue;
    uint32_t next;
    anim_frame_at(((const nn_prim_anim_t *)p)->anim, now - v->epoch, &next);
    if (next == UINT32_MAX) continue;
    uint32_t at = now + next;
    if (at < best) {
      best = at;
      *dirty = box;
    } else if (at == best) {
      *dirty = nn_rect_union(*dirty, box);
    }
  }
  return best;
}
