/* Section views (slides, documents, canvases, galleries) and the full-screen
 * picture inspector. */
#include "app.h"
#include "bundle.h"
#include "image.h"
#include "keys.h"
#include "text.h"
#include "ui.h"

#define TRANSITION_MS 220
#define MOVE_MS 380
#define MINIMAP_MS 1400
#define PAN_STEP 44
#define ZOOM_STEP_UP 81920  /* x1.25 */
#define ZOOM_STEP_DOWN 52429 /* x0.8 */

static const nn_section_t *section_of(const view_t *v) {
  return bundle_section(v->section);
}

static const nn_scene_t *scene_of(const view_t *v) {
  return bundle_scene(v->sv.scene);
}

static nn_rect_t viewport_for(const nn_section_t *sec) {
  bool bar = sec->flags & NN_SEC_STATUS_BAR;
  nn_rect_t r = {0, bar ? NN_STATUS_H : 0, NN_SCREEN_W,
                 NN_SCREEN_H - (bar ? NN_STATUS_H : 0)};
  return r;
}

static int32_t ratio16(int a, int b) {
  return b > 0 ? (int32_t)(((int64_t)a << 16) / b) : ZOOM_ONE;
}

static int32_t fit_zoom_for(const nn_section_t *sec, const nn_scene_t *scene,
                            nn_rect_t vp) {
  if (scene == NULL || scene->width <= 0 || scene->height <= 0) return ZOOM_ONE;
  int32_t zx = ratio16(vp.w, scene->width), zy = ratio16(vp.h, scene->height);
  switch (sec->mode) {
    case NN_MODE_DOCUMENT:
    case NN_MODE_GALLERY:
      return zx;
    default:
      return NN_MIN(zx, zy);
  }
}

static int32_t zoom_min(const view_t *v) {
  int32_t z = v->fit_zoom;
  const nn_section_t *sec = section_of(v);
  if (sec->mode == NN_MODE_CANVAS && sec->zoom_min) {
    z = NN_MIN(z, (int32_t)sec->zoom_min << 8);
  }
  return z;
}

static int32_t zoom_max(const view_t *v) {
  const nn_section_t *sec = section_of(v);
  int32_t z = sec->zoom_max ? (int32_t)sec->zoom_max << 8 : 4 * ZOOM_ONE;
  return NN_MAX(z, v->fit_zoom);
}

static bool zoomed_in(const view_t *v) {
  return v->sv.zoom > v->fit_zoom + v->fit_zoom / 50;
}

static void clamp_axis(int32_t *o, int32_t size, int32_t view, bool center) {
  if (size <= view) *o = center ? (size - view) / 2 : 0;
  else *o = NN_CLAMP(*o, 0, size - view);
}

static void clamp_view(view_t *v) {
  const nn_scene_t *scene = scene_of(v);
  if (scene == NULL) return;
  v->sv.zoom = NN_CLAMP(v->sv.zoom, zoom_min(v), zoom_max(v));
  bool center = scene->flags & NN_SCENE_CENTER;
  clamp_axis(&v->sv.ox, scene->width, scene_view_w(&v->sv), true);
  clamp_axis(&v->sv.oy, scene->height, scene_view_h(&v->sv), center);
}

/* Zooms so that scene point (ax, ay) stays at viewport offset (px, py). */
static void zoom_about(view_t *v, int32_t zoom, int32_t ax, int32_t ay, int px,
                       int py) {
  v->sv.zoom = NN_CLAMP(zoom, zoom_min(v), zoom_max(v));
  v->sv.ox = ax - (int32_t)(((int64_t)px << 16) / v->sv.zoom);
  v->sv.oy = ay - (int32_t)(((int64_t)py << 16) / v->sv.zoom);
  clamp_view(v);
}

static void zoom_center(view_t *v, int32_t zoom) {
  int px = v->sv.viewport.w / 2, py = v->sv.viewport.h / 2;
  int32_t ax = v->sv.ox + (int32_t)(((int64_t)px << 16) / v->sv.zoom);
  int32_t ay = v->sv.oy + (int32_t)(((int64_t)py << 16) / v->sv.zoom);
  if (section_of(v)->mode == NN_MODE_DOCUMENT) {
    /* Documents zoom around the top line so reading position is kept. */
    py = 0;
    ay = v->sv.oy;
  }
  zoom_about(v, zoom, ax, ay, px, py);
}

static void zoom_pill(const view_t *v) {
  char text[16];
  int n = ui_itoa((int)(((int64_t)v->sv.zoom * 100 + 32768) >> 16), text);
  text[n++] = '%';
  text[n] = 0;
  app_toast(text);
}

static bool focusable(const view_t *v, const nn_item_t *item) {
  switch (section_of(v)->mode) {
    case NN_MODE_SLIDES: return item->kind == NN_ITEM_LINK;
    case NN_MODE_GALLERY: return item->kind == NN_ITEM_CELL;
    case NN_MODE_CANVAS: return item->kind == NN_ITEM_STOP;
    default: return false;
  }
}

static int first_focus(const view_t *v) {
  const nn_scene_t *scene = scene_of(v);
  if (scene == NULL) return -1;
  const nn_item_t *items = bundle_items(scene);
  for (int i = 0; i < scene->item_count; i++) {
    if (focusable(v, &items[i])) return i;
  }
  return -1;
}

static int focus_count(const view_t *v) {
  const nn_scene_t *scene = scene_of(v);
  if (scene == NULL) return 0;
  const nn_item_t *items = bundle_items(scene);
  int n = 0;
  for (int i = 0; i < scene->item_count; i++) n += focusable(v, &items[i]);
  return n;
}

static void apply_page(view_t *v, int page) {
  const nn_section_t *sec = section_of(v);
  v->page = page;
  v->sv.scene = sec->first_scene + page;
  v->sv.epoch = app_now();
  v->sv.viewport = viewport_for(sec);
  v->fit_zoom = fit_zoom_for(sec, scene_of(v), v->sv.viewport);
  int32_t start = v->fit_zoom;
  if (sec->mode == NN_MODE_CANVAS && sec->zoom_start) {
    start = (int32_t)sec->zoom_start << 8;
  }
  v->sv.zoom = start;
  v->sv.ox = 0;
  v->sv.oy = 0;
  clamp_view(v);
  v->focus = first_focus(v);
  v->anim_due = 0;
}

void view_open(screen_t *s, int section) {
  view_t *v = &s->u.view;
  memset(v, 0, sizeof(*v));
  v->section = section;
  v->last_ev = -1;
  apply_page(v, 0);
  const nn_section_t *sec = section_of(v);
  if (sec->flags & NN_SEC_AUTOPLAY) {
    v->playing = true;
    v->next_auto = app_now() + NN_MAX(sec->autoplay_ds, 5) * 100u;
  }
}

nn_place_t view_place(const view_t *v) {
  nn_place_t p = {(uint16_t)v->section, (uint16_t)v->page, v->sv.ox, v->sv.oy,
                  v->sv.zoom};
  return p;
}

void view_restore(view_t *v, nn_place_t place) {
  int pages = section_of(v)->scene_count;
  apply_page(v, NN_CLAMP((int)place.page, 0, pages - 1));
  if (place.zoom > 0) v->sv.zoom = place.zoom;
  v->sv.ox = place.ox;
  v->sv.oy = place.oy;
  clamp_view(v);
}

int view_page_count(const view_t *v) {
  const nn_section_t *sec = section_of(v);
  if (sec->mode == NN_MODE_SLIDES) return sec->scene_count;
  const nn_scene_t *scene = scene_of(v);
  int32_t vh = scene_view_h(&v->sv);
  if (scene == NULL || vh <= 0) return 1;
  return NN_MAX(1, (int)((scene->height + vh - 1) / vh));
}

static int current_page(const view_t *v) {
  if (section_of(v)->mode == NN_MODE_SLIDES) return v->page;
  int32_t vh = scene_view_h(&v->sv);
  return vh > 0 ? (int)((v->sv.oy + vh / 3) / vh) : 0;
}

static void set_page(view_t *v, int page, int dir) {
  const nn_section_t *sec = section_of(v);
  int count = sec->scene_count;
  if (page < 0 || page >= count) {
    if (!(sec->flags & NN_SEC_LOOP) || count < 2) {
      if (v->playing && page >= count) v->playing = false;
      return;
    }
    page = (page + count) % count;
  }
  if (page == v->page) return;
  if ((sec->flags & NN_SEC_TRANSITION) && dir) {
    v->transition = true;
    v->from_page = v->page;
    v->dir = dir;
    v->trans_start = app_now();
  }
  apply_page(v, page);
  if (v->playing) v->next_auto = app_now() + NN_MAX(sec->autoplay_ds, 5) * 100u;
  if (sec->flags & NN_SEC_PAGE_NUMBERS) {
    char text[16];
    int n = ui_itoa(page + 1, text);
    text[n++] = ' ';
    text[n++] = '/';
    text[n++] = ' ';
    ui_itoa(count, text + n);
    app_toast(text);
  }
  app_invalidate();
}

void view_goto_page(view_t *v, int page) {
  const nn_section_t *sec = section_of(v);
  if (sec->mode == NN_MODE_SLIDES) {
    set_page(v, NN_CLAMP(page, 0, sec->scene_count - 1), 0);
    return;
  }
  v->sv.oy = page * scene_view_h(&v->sv);
  clamp_view(v);
  app_invalidate();
}

void view_toggle_play(view_t *v) {
  const nn_section_t *sec = section_of(v);
  if (sec->mode != NN_MODE_SLIDES || sec->scene_count < 2) return;
  v->playing = !v->playing;
  v->next_auto = app_now() + NN_MAX(sec->autoplay_ds ? sec->autoplay_ds : 50, 5) * 100u;
  app_toast(v->playing ? "\xE2\x96\xB6 Playing" : "Paused");
}

static void start_move(view_t *v, int32_t ox, int32_t oy, int32_t zoom) {
  v->move_from[0] = v->sv.ox;
  v->move_from[1] = v->sv.oy;
  v->move_from[2] = v->sv.zoom;
  /* Resolve the destination with the view's own clamping rules. */
  scene_view_t saved = v->sv;
  v->sv.zoom = zoom;
  v->sv.ox = ox;
  v->sv.oy = oy;
  clamp_view(v);
  v->move_to[0] = v->sv.ox;
  v->move_to[1] = v->sv.oy;
  v->move_to[2] = v->sv.zoom;
  v->sv = saved;
  v->moving = true;
  v->move_start = app_now();
  v->minimap_until = app_now() + MOVE_MS + MINIMAP_MS;
}

void view_show_rect(view_t *v, int32_t x, int32_t y, int32_t w, int32_t h) {
  int32_t vw = scene_view_w(&v->sv), vh = scene_view_h(&v->sv);
  int32_t margin = 8;
  if (y - margin < v->sv.oy) v->sv.oy = y - margin;
  else if (y + h + margin > v->sv.oy + vh) v->sv.oy = y + h + margin - vh;
  if (x - margin < v->sv.ox) v->sv.ox = x - margin;
  else if (x + w + margin > v->sv.ox + vw) v->sv.ox = x + w + margin - vw;
  clamp_view(v);
  app_invalidate();
}

void view_jump_to(view_t *v, int32_t y) {
  v->sv.oy = y;
  clamp_view(v);
  app_invalidate();
}

void view_overview(view_t *v) {
  const nn_scene_t *scene = scene_of(v);
  if (scene == NULL) return;
  int32_t z = v->fit_zoom;
  start_move(v, (scene->width - (int32_t)(((int64_t)v->sv.viewport.w << 16) / z)) / 2,
             (scene->height - (int32_t)(((int64_t)v->sv.viewport.h << 16) / z)) / 2, z);
  app_invalidate();
}

static void fly_to_item(view_t *v, const nn_item_t *it) {
  nn_rect_t vp = v->sv.viewport;
  int32_t zx = ratio16(vp.w * 92 / 100, NN_MAX(it->w, 1));
  int32_t zy = ratio16(vp.h * 92 / 100, NN_MAX(it->h, 1));
  int32_t z = NN_CLAMP(NN_MIN(zx, zy), zoom_min(v), zoom_max(v));
  int32_t vw = (int32_t)(((int64_t)vp.w << 16) / z);
  int32_t vh = (int32_t)(((int64_t)vp.h << 16) / z);
  start_move(v, it->x + it->w / 2 - vw / 2, it->y + it->h / 2 - vh / 2, z);
  app_invalidate();
}

static void step_stop(view_t *v, int delta) {
  const nn_scene_t *scene = scene_of(v);
  if (scene == NULL) return;
  const nn_item_t *items = bundle_items(scene);
  int n = scene->item_count;
  int i = v->focus;
  for (int tries = 0; tries < n; tries++) {
    i = (i + delta + n) % n;
    if (i < 0) i = 0;
    if (focusable(v, &items[i])) {
      v->focus = i;
      fly_to_item(v, &items[i]);
      return;
    }
  }
}

/* Moves focus to the nearest focusable item in direction (dx, dy). */
static bool move_focus(view_t *v, int dx, int dy) {
  const nn_scene_t *scene = scene_of(v);
  if (scene == NULL || v->focus < 0) return false;
  const nn_item_t *items = bundle_items(scene);
  const nn_item_t *cur = &items[v->focus];
  int32_t cx = cur->x + cur->w / 2, cy = cur->y + cur->h / 2;
  int best = -1;
  int64_t best_score = INT64_MAX;
  for (int i = 0; i < scene->item_count; i++) {
    if (i == v->focus || !focusable(v, &items[i])) continue;
    int32_t ix = items[i].x + items[i].w / 2, iy = items[i].y + items[i].h / 2;
    int32_t along = (ix - cx) * dx + (iy - cy) * dy;
    int32_t across = (ix - cx) * dy + (iy - cy) * dx;
    if (along <= 0) continue;
    int64_t score = (int64_t)along + 3 * (int64_t)NN_ABS(across);
    if (score < best_score) {
      best_score = score;
      best = i;
    }
  }
  if (best < 0) return false;
  v->focus = best;
  const nn_item_t *it = &items[best];
  view_show_rect(v, it->x, it->y, it->w, it->h);
  app_invalidate();
  return true;
}

static int accel(view_t *v, int ev) {
  uint32_t now = app_now();
  if (ev == v->last_ev && now - v->last_ev_time < 260) {
    v->repeat = NN_MIN(v->repeat + 1, 12);
  } else {
    v->repeat = 0;
  }
  v->last_ev = ev;
  v->last_ev_time = now;
  return 256 + v->repeat * 48;
}

static void pan(view_t *v, int dx, int dy, int ev) {
  int step = PAN_STEP * accel(v, ev) / 256;
  v->sv.ox += (int32_t)(((int64_t)dx * step << 16) / v->sv.zoom);
  v->sv.oy += (int32_t)(((int64_t)dy * step << 16) / v->sv.zoom);
  clamp_view(v);
  if (section_of(v)->flags & NN_SEC_MINIMAP) {
    v->minimap_until = app_now() + MINIMAP_MS;
  }
  app_invalidate();
}

static void scroll_by(view_t *v, int32_t screen_px) {
  v->sv.oy += (int32_t)(((int64_t)screen_px << 16) / v->sv.zoom);
  clamp_view(v);
  app_invalidate();
}

static bool is_browsable(const nn_item_t *it) {
  return it->kind == NN_ITEM_IMAGE || it->kind == NN_ITEM_ANIM ||
         it->kind == NN_ITEM_CELL;
}

bool view_open_nearest_image(view_t *v) {
  const nn_scene_t *scene = scene_of(v);
  if (scene == NULL) return false;
  const nn_item_t *items = bundle_items(scene);
  if (v->focus >= 0 && is_browsable(&items[v->focus])) {
    inspect_open(v->section, v->sv.scene, v->focus);
    return true;
  }
  int32_t cx = v->sv.ox + scene_view_w(&v->sv) / 2;
  int32_t cy = v->sv.oy + scene_view_h(&v->sv) / 2;
  int best = -1;
  int64_t best_d = INT64_MAX;
  for (int i = 0; i < scene->item_count; i++) {
    const nn_item_t *it = &items[i];
    if (!is_browsable(it)) continue;
    nn_rect_t on_screen = nn_rect_intersect(
        scene_rect_to_screen(&v->sv, it->x, it->y, it->w, it->h), v->sv.viewport);
    if (nn_rect_empty(on_screen)) continue;
    int64_t dx = it->x + it->w / 2 - cx, dy = it->y + it->h / 2 - cy;
    int64_t d = dx * dx + dy * dy;
    if (d < best_d) {
      best_d = d;
      best = i;
    }
  }
  if (best < 0) return false;
  inspect_open(v->section, v->sv.scene, best);
  return true;
}

const char *view_title(const view_t *v) {
  return bundle_string(section_of(v)->title);
}

void open_section(int section) {
  const nn_section_t *sec = bundle_section(section);
  if (sec == NULL) return;
  app_pop_to(1);
  if (sec->mode == NN_MODE_NOTES) {
    app_push(SCR_NOTES);
    return;
  }
  view_open(app_push(SCR_VIEW), section);
}

void open_place(nn_place_t place, bool remember) {
  if (remember) {
    screen_t *view = app_find(SCR_VIEW);
    if (view) app_remember(view_place(&view->u.view));
  }
  open_section(place.section);
  screen_t *top = app_top();
  if (top->kind == SCR_VIEW) view_restore(&top->u.view, place);
}

void view_flash(view_t *v, int32_t x, int32_t y, int32_t w, int32_t h) {
  nn_rect_t r = {x - 2, y - 1, w + 4, h + 2};
  v->flash = r;
  v->flash_until = app_now() + 1800;
  app_invalidate();
}

static void follow_link(view_t *v, const nn_item_t *it) {
  if (!bundle_section(it->ref)) return;
  app_remember(view_place(v));
  open_section(it->ref);
}

static bool handle_zoom(view_t *v, int ev) {
  if (ev != EV_PLUS && ev != EV_MINUS) return false;
  int32_t z = (int32_t)(((int64_t)v->sv.zoom *
                         (ev == EV_PLUS ? ZOOM_STEP_UP : ZOOM_STEP_DOWN)) >> 16);
  /* Snap to 100% and to fit when passing them. */
  int32_t old = v->sv.zoom;
  if ((old < ZOOM_ONE && z > ZOOM_ONE) || (old > ZOOM_ONE && z < ZOOM_ONE)) z = ZOOM_ONE;
  if ((old < v->fit_zoom && z > v->fit_zoom) || (old > v->fit_zoom && z < v->fit_zoom)) {
    z = v->fit_zoom;
  }
  zoom_center(v, z);
  if (section_of(v)->flags & NN_SEC_MINIMAP) v->minimap_until = app_now() + MINIMAP_MS;
  zoom_pill(v);
  app_invalidate();
  return true;
}

static void start_goto(int digit) {
  screen_t *s = app_push(SCR_GOTO);
  s->u.go.digits[0] = (char)('0' + digit);
  s->u.go.len = 1;
}

static bool slides_event(view_t *v, int ev) {
  const nn_scene_t *scene = scene_of(v);
  bool zoomed = zoomed_in(v);
  bool tall = scene && scene_view_h(&v->sv) < scene->height;
  switch (ev) {
    case EV_LEFT:
      if (zoomed) pan(v, -1, 0, ev);
      else set_page(v, v->page - 1, -1);
      return true;
    case EV_RIGHT:
      if (zoomed) pan(v, 1, 0, ev);
      else set_page(v, v->page + 1, 1);
      return true;
    case EV_UP:
    case EV_DOWN: {
      int d = ev == EV_UP ? -1 : 1;
      if (v->focus >= 0 && move_focus(v, 0, d)) return true;
      if (zoomed || tall) pan(v, 0, d, ev);
      else if (v->focus < 0) set_page(v, v->page + d, d);
      return true;
    }
    case EV_OK: {
      const nn_item_t *items = scene ? bundle_items(scene) : NULL;
      if (v->focus >= 0 && items[v->focus].kind == NN_ITEM_LINK) {
        follow_link(v, &items[v->focus]);
      } else if (!view_open_nearest_image(v) && !zoomed) {
        set_page(v, v->page + 1, 1);
      }
      return true;
    }
    case EV_EXE:
      view_toggle_play(v);
      return true;
    default: {
      int digit = key_digit(ev);
      if (digit >= 0) {
        start_goto(digit);
        return true;
      }
      return handle_zoom(v, ev);
    }
  }
}

static bool document_event(view_t *v, int ev) {
  bool zoomed = v->sv.zoom > ZOOM_ONE + 655 && zoomed_in(v);
  int page = v->sv.viewport.h - 28;
  switch (ev) {
    case EV_UP:
    case EV_DOWN:
      scroll_by(v, (ev == EV_UP ? -PAN_STEP : PAN_STEP) * accel(v, ev) / 256);
      return true;
    case EV_LEFT:
      if (zoomed) pan(v, -1, 0, ev);
      else scroll_by(v, -page);
      return true;
    case EV_RIGHT:
      if (zoomed) pan(v, 1, 0, ev);
      else scroll_by(v, page);
      return true;
    case EV_SHIFT_UP:
      v->sv.oy = 0;
      clamp_view(v);
      app_invalidate();
      return true;
    case EV_SHIFT_DOWN:
      v->sv.oy = INT32_MAX / 2;
      clamp_view(v);
      app_invalidate();
      return true;
    case EV_OK:
    case EV_EXE:
      if (!view_open_nearest_image(v)) app_toast("No picture here");
      return true;
    default: {
      int digit = key_digit(ev);
      if (digit >= 0) {
        start_goto(digit);
        return true;
      }
      return handle_zoom(v, ev);
    }
  }
}

static bool canvas_event(view_t *v, int ev) {
  switch (ev) {
    case EV_LEFT: pan(v, -1, 0, ev); return true;
    case EV_RIGHT: pan(v, 1, 0, ev); return true;
    case EV_UP: pan(v, 0, -1, ev); return true;
    case EV_DOWN: pan(v, 0, 1, ev); return true;
    case EV_OK:
    case EV_EXE:
    case EV_RPAREN:
      if (focus_count(v) > 0) step_stop(v, 1);
      else if (!view_open_nearest_image(v)) app_toast("No picture here");
      return true;
    case EV_LPAREN:
      if (focus_count(v) > 0) step_stop(v, -1);
      return true;
    case EV_ZERO:
      view_overview(v);
      return true;
    default: {
      int digit = key_digit(ev);
      if (digit > 0) {
        int target = digit, seen = 0;
        const nn_scene_t *scene = scene_of(v);
        const nn_item_t *items = bundle_items(scene);
        for (int i = 0; scene && i < scene->item_count; i++) {
          if (focusable(v, &items[i]) && ++seen == target) {
            v->focus = i;
            fly_to_item(v, &items[i]);
            return true;
          }
        }
        return true;
      }
      return handle_zoom(v, ev);
    }
  }
}

static bool gallery_event(view_t *v, int ev) {
  switch (ev) {
    case EV_LEFT: move_focus(v, -1, 0); return true;
    case EV_RIGHT: move_focus(v, 1, 0); return true;
    case EV_UP:
      if (!move_focus(v, 0, -1)) scroll_by(v, -PAN_STEP);
      return true;
    case EV_DOWN:
      if (!move_focus(v, 0, 1)) scroll_by(v, PAN_STEP);
      return true;
    case EV_OK:
    case EV_EXE:
      view_open_nearest_image(v);
      return true;
    default:
      return false;
  }
}

static void finish_motion(view_t *v) {
  if (v->transition) {
    v->transition = false;
    app_invalidate();
  }
  if (v->moving) {
    v->moving = false;
    v->sv.ox = v->move_to[0];
    v->sv.oy = v->move_to[1];
    v->sv.zoom = v->move_to[2];
    app_invalidate();
  }
}

bool view_event(screen_t *s, int ev) {
  view_t *v = &s->u.view;
  finish_motion(v);
  switch (section_of(v)->mode) {
    case NN_MODE_SLIDES: return slides_event(v, ev);
    case NN_MODE_DOCUMENT: return document_event(v, ev);
    case NN_MODE_CANVAS: return canvas_event(v, ev);
    case NN_MODE_GALLERY: return gallery_event(v, ev);
    default: return false;
  }
}

static int ease(uint32_t elapsed, uint32_t duration) {
  /* Smoothstep in 0..256. */
  if (elapsed >= duration) return 256;
  int t = (int)(elapsed * 256 / duration);
  return t * t * (768 - 2 * t) / 65536;
}

uint32_t view_tick(screen_t *s, uint32_t now) {
  view_t *v = &s->u.view;
  uint32_t wake = UINT32_MAX;
  const nn_section_t *sec = section_of(v);
  if (v->transition) {
    if (now - v->trans_start >= TRANSITION_MS) v->transition = false;
    else wake = now + 16;
    app_invalidate_rect(v->sv.viewport);
  }
  if (v->moving) {
    int t = ease(now - v->move_start, MOVE_MS);
    v->sv.ox = v->move_from[0] + (int32_t)(((int64_t)(v->move_to[0] - v->move_from[0]) * t) >> 8);
    v->sv.oy = v->move_from[1] + (int32_t)(((int64_t)(v->move_to[1] - v->move_from[1]) * t) >> 8);
    v->sv.zoom = v->move_from[2] + (int32_t)(((int64_t)(v->move_to[2] - v->move_from[2]) * t) >> 8);
    if (t >= 256) v->moving = false;
    else wake = now + 16;
    app_invalidate();
  }
  if (v->playing) {
    if (now >= v->next_auto) {
      set_page(v, v->page + 1, 1);
      if (v->playing) v->next_auto = now + NN_MAX(sec->autoplay_ds, 5) * 100u;
    }
    if (v->playing) wake = NN_MIN(wake, v->next_auto);
  }
  if (v->flash_until) {
    if (now >= v->flash_until) {
      v->flash_until = 0;
      app_invalidate();
    } else {
      wake = NN_MIN(wake, v->flash_until);
    }
  }
  if (v->minimap_until) {
    if (now >= v->minimap_until) {
      v->minimap_until = 0;
      app_invalidate();
    } else {
      wake = NN_MIN(wake, v->minimap_until);
    }
  }
  if (!v->transition && !v->moving) {
    if (v->anim_due && now >= v->anim_due) app_invalidate_rect(v->anim_dirty);
    v->anim_due = scene_next_frame(&v->sv, now, &v->anim_dirty);
    if (v->anim_due == UINT32_MAX) v->anim_due = 0;
    else wake = NN_MIN(wake, v->anim_due);
  }
  return wake;
}

static void draw_minimap(gfx_t *g, const view_t *v) {
  const nn_scene_t *scene = scene_of(v);
  if (scene == NULL || scene->width <= 0 || scene->height <= 0) return;
  int max_w = 72, max_h = 54;
  int w = max_w, h = (int)((int64_t)scene->height * max_w / scene->width);
  if (h > max_h) {
    h = max_h;
    w = (int)((int64_t)scene->width * max_h / scene->height);
  }
  nn_rect_t vp = v->sv.viewport;
  nn_rect_t map = {vp.x + vp.w - w - 8, vp.y + vp.h - h - 8, w, h};
  nn_rect_t frame = {map.x - 3, map.y - 3, map.w + 6, map.h + 6};
  gfx_fill_alpha(g, frame, NN_RGB(0x20, 0x20, 0x20), 180);
  gfx_border(g, map, 0, 1, NN_RGB(0x90, 0x90, 0x98));
  int rx = map.x + (int)((int64_t)v->sv.ox * w / scene->width);
  int ry = map.y + (int)((int64_t)v->sv.oy * h / scene->height);
  int rw = (int)((int64_t)scene_view_w(&v->sv) * w / scene->width);
  int rh = (int)((int64_t)scene_view_h(&v->sv) * h / scene->height);
  nn_rect_t view = {rx, ry, NN_MAX(rw, 3), NN_MAX(rh, 3)};
  view = nn_rect_intersect(view, map);
  gfx_fill_alpha(g, view, g_theme.accent, 90);
  gfx_border(g, view, 0, 1, g_theme.accent);
}

static void status_text(const view_t *v, char *out) {
  const nn_section_t *sec = section_of(v);
  int n = 0;
  switch (sec->mode) {
    case NN_MODE_SLIDES:
    case NN_MODE_DOCUMENT:
      n = ui_itoa(current_page(v) + 1, out);
      out[n++] = '/';
      ui_itoa(view_page_count(v), out + n);
      break;
    case NN_MODE_CANVAS:
      n = ui_itoa((int)(((int64_t)v->sv.zoom * 100 + 32768) >> 16), out);
      out[n++] = '%';
      out[n] = 0;
      break;
    case NN_MODE_GALLERY: {
      int index = 0, total = 0;
      const nn_scene_t *scene = scene_of(v);
      const nn_item_t *items = scene ? bundle_items(scene) : NULL;
      for (int i = 0; scene && i < scene->item_count; i++) {
        if (items[i].kind != NN_ITEM_CELL) continue;
        total++;
        if (i == v->focus) index = total;
      }
      n = ui_itoa(index, out);
      out[n++] = '/';
      ui_itoa(total, out + n);
      break;
    }
    default:
      out[0] = 0;
  }
}

void view_draw(gfx_t *g, screen_t *s) {
  view_t *v = &s->u.view;
  const nn_section_t *sec = section_of(v);
  nn_rect_t vp = v->sv.viewport;
  gfx_fill(g, vp, sec->bg);
  uint32_t now = app_now();
  if (v->transition) {
    int t = ease(now - v->trans_start, TRANSITION_MS);
    int offset = (int)((int64_t)(256 - t) * vp.w / 256) * v->dir;
    scene_view_t incoming = v->sv;
    incoming.viewport.x += offset;
    scene_view_t outgoing = v->sv;
    outgoing.scene = sec->first_scene + v->from_page;
    const nn_scene_t *old = bundle_scene(outgoing.scene);
    outgoing.zoom = fit_zoom_for(sec, old, vp);
    outgoing.ox = old ? (old->width - (int32_t)(((int64_t)vp.w << 16) / outgoing.zoom)) / 2 : 0;
    outgoing.oy = old ? (old->height - (int32_t)(((int64_t)vp.h << 16) / outgoing.zoom)) / 2 : 0;
    outgoing.viewport.x += offset - v->dir * vp.w;
    nn_rect_t saved = gfx_push_clip(g, vp);
    scene_draw(g, &outgoing, now);
    scene_draw(g, &incoming, now);
    gfx_set_clip(g, saved);
  } else {
    scene_draw(g, &v->sv, now);
  }

  const nn_scene_t *scene = scene_of(v);
  if (v->flash_until && !v->transition) {
    nn_rect_t r = scene_rect_to_screen(&v->sv, v->flash.x, v->flash.y, v->flash.w,
                                       v->flash.h);
    nn_rect_t saved = gfx_push_clip(g, vp);
    gfx_fill_alpha(g, r, g_theme.highlight, 110);
    gfx_set_clip(g, saved);
  }
  if (!v->transition && !v->moving && v->focus >= 0 && scene &&
      sec->mode != NN_MODE_CANVAS) {
    const nn_item_t *it = &bundle_items(scene)[v->focus];
    nn_rect_t r = scene_rect_to_screen(&v->sv, it->x, it->y, it->w, it->h);
    nn_rect_t ring = {r.x - 3, r.y - 3, r.w + 6, r.h + 6};
    nn_rect_t saved = gfx_push_clip(g, vp);
    gfx_border(g, ring, 0, 3, g_theme.accent);
    gfx_set_clip(g, saved);
  }
  if (v->minimap_until && (sec->flags & NN_SEC_MINIMAP)) draw_minimap(g, v);
  if (sec->flags & NN_SEC_STATUS_BAR) {
    char right[24];
    status_text(v, right);
    if (v->playing) {
      int n = (int)strlen(right);
      right[n++] = ' ';
      memcpy(right + n, "\xE2\x96\xB6", 4);
    }
    ui_status_bar(g, bundle_string(sec->title), right);
  }
}

/* --- Inspector --- */

static const nn_scene_t *inspect_scene(const inspect_t *in) {
  return bundle_scene(in->scene);
}

static void inspect_load(inspect_t *in) {
  const nn_scene_t *scene = inspect_scene(in);
  const nn_item_t *it = &bundle_items(scene)[in->item];
  in->anim = -1;
  in->image = -1;
  in->w = in->h = 1;
  if (it->kind == NN_ITEM_ANIM) {
    const nn_anim_t *anim = bundle_anim(it->ref);
    if (anim) {
      in->anim = it->ref;
      in->w = anim->width;
      in->h = anim->height;
    }
  } else {
    const nn_image_t *img = bundle_image(it->ref);
    if (img) {
      in->image = it->ref;
      in->w = img->width;
      in->h = img->height;
    }
  }
  in->zoom = ZOOM_ONE;
  in->cx = in->w / 2;
  in->cy = in->h / 2;
  in->epoch = app_now();
  in->anim_due = 0;
  app_invalidate();
}

void inspect_open(int section, int scene, int item) {
  const nn_scene_t *sc = bundle_scene(scene);
  if (sc == NULL || item < 0 || item >= sc->item_count) return;
  screen_t *s = app_push(SCR_INSPECT);
  inspect_t *in = &s->u.inspect;
  in->section = section;
  in->scene = scene;
  in->item = item;
  const nn_section_t *sec = bundle_section(section);
  in->caption = sec == NULL || (sec->flags & NN_SEC_CAPTIONS) ||
                sec->mode != NN_MODE_GALLERY;
  inspect_load(in);
}

static int32_t inspect_scale(const inspect_t *in) {
  int32_t fit = NN_MIN(ratio16(NN_SCREEN_W, in->w), ratio16(NN_SCREEN_H, in->h));
  return (int32_t)(((int64_t)fit * in->zoom) >> 16);
}

static void inspect_clamp(inspect_t *in) {
  int32_t s = inspect_scale(in);
  int32_t half_w = (int32_t)(((int64_t)(NN_SCREEN_W / 2) << 16) / s);
  int32_t half_h = (int32_t)(((int64_t)(NN_SCREEN_H / 2) << 16) / s);
  if (in->w <= 2 * half_w) in->cx = in->w / 2;
  else in->cx = NN_CLAMP(in->cx, half_w, in->w - half_w);
  if (in->h <= 2 * half_h) in->cy = in->h / 2;
  else in->cy = NN_CLAMP(in->cy, half_h, in->h - half_h);
}

static int browse_step(const inspect_t *in, int delta) {
  const nn_scene_t *scene = inspect_scene(in);
  const nn_item_t *items = bundle_items(scene);
  for (int i = in->item + delta; i >= 0 && i < scene->item_count; i += delta) {
    if (is_browsable(&items[i])) return i;
  }
  return -1;
}

static void browse_position(const inspect_t *in, int *index, int *count) {
  const nn_scene_t *scene = inspect_scene(in);
  const nn_item_t *items = bundle_items(scene);
  *index = *count = 0;
  for (int i = 0; i < scene->item_count; i++) {
    if (!is_browsable(&items[i])) continue;
    if (i == in->item) *index = *count;
    (*count)++;
  }
}

/* A "more pictures this way" arrow with its tip at x. */
static void chevron(gfx_t *g, int x, int dir) {
  uint16_t color = NN_RGB(0xE8, 0xE8, 0xEC);
  int back = x - dir * 6, cy = NN_SCREEN_H / 2;
  gfx_line(g, back * 16, (cy - 10) * 16, x * 16, cy * 16, 40, color, 0);
  gfx_line(g, x * 16, cy * 16, back * 16, (cy + 10) * 16, 40, color, 0);
}

void inspect_draw(gfx_t *g, screen_t *s) {
  inspect_t *in = &s->u.inspect;
  nn_rect_t full = {0, 0, NN_SCREEN_W, NN_SCREEN_H};
  gfx_fill(g, full, 0x0000);
  int32_t sc = inspect_scale(in);
  int w = (int)(((int64_t)in->w * sc + 32768) >> 16);
  int h = (int)(((int64_t)in->h * sc + 32768) >> 16);
  int x = NN_SCREEN_W / 2 - (int)(((int64_t)in->cx * sc) >> 16);
  int y = NN_SCREEN_H / 2 - (int)(((int64_t)in->cy * sc) >> 16);
  nn_rect_t dst = {x, y, NN_MAX(w, 1), NN_MAX(h, 1)};
  int image = in->image;
  if (in->anim >= 0) {
    uint32_t next;
    image = anim_frame_at(in->anim, app_now() - in->epoch, &next);
  }
  if (image >= 0) image_draw(g, image, dst);

  int index, count;
  browse_position(in, &index, &count);
  if (count > 1 && in->zoom == ZOOM_ONE) {
    if (browse_step(in, -1) >= 0) chevron(g, 8, -1);
    if (browse_step(in, 1) >= 0) chevron(g, NN_SCREEN_W - 8, 1);
  }
  const nn_item_t *it = &bundle_items(inspect_scene(in))[in->item];
  const char *caption = bundle_string(it->text);
  if (in->caption && *caption) {
    int lh = font_line_height(g_theme.font);
    const char *p = caption;
    int lines = 0, next;
    while (*p && lines < 3) {
      text_wrap(g_theme.font, p, NN_SCREEN_W - 24, &next);
      p += next;
      lines++;
    }
    int band_h = lines * lh + 12;
    nn_rect_t band = {0, NN_SCREEN_H - band_h, NN_SCREEN_W, band_h};
    gfx_fill_alpha(g, band, 0x0000, 170);
    p = caption;
    for (int i = 0; i < lines; i++) {
      int len = text_wrap(g_theme.font, p, NN_SCREEN_W - 24, &next);
      text_draw(g, g_theme.font, p, len, 12, band.y + 6 + i * lh, 0xFFFF);
      p += next;
    }
  }
}

bool inspect_event(screen_t *s, int ev) {
  inspect_t *in = &s->u.inspect;
  bool zoomed = in->zoom > ZOOM_ONE;
  int32_t sc = inspect_scale(in);
  int32_t step = (int32_t)(((int64_t)PAN_STEP << 16) / sc);
  switch (ev) {
    case EV_LEFT:
    case EV_RIGHT: {
      int d = ev == EV_LEFT ? -1 : 1;
      if (zoomed) {
        in->cx += d * step;
      } else {
        int next = browse_step(in, d);
        if (next >= 0) {
          in->item = next;
          inspect_load(in);
        }
        return true;
      }
      break;
    }
    case EV_UP:
      if (!zoomed) return true;
      in->cy -= step;
      break;
    case EV_DOWN:
      if (!zoomed) return true;
      in->cy += step;
      break;
    case EV_PLUS:
      in->zoom = NN_MIN((int32_t)(((int64_t)in->zoom * 3) / 2), 12 * ZOOM_ONE);
      break;
    case EV_MINUS:
      in->zoom = NN_MAX((int32_t)(((int64_t)in->zoom * 2) / 3), ZOOM_ONE);
      break;
    case EV_OK:
      in->zoom = zoomed ? ZOOM_ONE : 5 * ZOOM_ONE / 2;
      break;
    case EV_ZERO:
      in->zoom = ZOOM_ONE;
      break;
    case EV_EXE:
      in->caption = !in->caption;
      break;
    case EV_BACK:
      app_pop();
      return true;
    default:
      return false;
  }
  inspect_clamp(in);
  app_invalidate();
  return true;
}

uint32_t inspect_tick(screen_t *s, uint32_t now) {
  inspect_t *in = &s->u.inspect;
  if (in->anim < 0) return UINT32_MAX;
  if (in->anim_due && now >= in->anim_due) app_invalidate();
  uint32_t next;
  anim_frame_at(in->anim, now - in->epoch, &next);
  in->anim_due = next == UINT32_MAX ? 0 : now + next;
  return in->anim_due ? in->anim_due : UINT32_MAX;
}
