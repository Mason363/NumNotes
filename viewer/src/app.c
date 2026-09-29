#include "app.h"

#include "app_main.h"
#include "bundle.h"
#include "image.h"
#include "keys.h"
#include "mem.h"
#include "platform.h"
#include "text.h"
#include "ui.h"

#define STACK_MAX 10
#define BAND_PIXELS (NN_SCREEN_W * 24)
#define HISTORY_MAX 8
#define TOAST_MS 1600
#define TOAST_Y 212

static screen_t s_stack[STACK_MAX];
static int s_depth;
static nn_rect_t s_dirty;
static uint16_t *s_band;
static bool s_exit;
static bool s_broken;
static uint32_t s_now;
static char s_toast[48];
static uint32_t s_toast_until;
static nn_place_t s_history[HISTORY_MAX];
static int s_history_len;
static bool s_shift, s_alpha, s_lock;

static const nn_rect_t k_screen = {0, 0, NN_SCREEN_W, NN_SCREEN_H};

static bool is_overlay(int kind) {
  return kind == SCR_MENU || kind == SCR_GOTO || kind == SCR_SYMBOLS;
}

uint32_t app_now(void) { return s_now; }
int app_depth(void) { return s_depth; }
screen_t *app_screen(int depth) { return &s_stack[depth]; }
screen_t *app_top(void) { return s_depth ? &s_stack[s_depth - 1] : NULL; }

screen_t *app_find(int kind) {
  for (int i = s_depth - 1; i >= 0; i--) {
    if (s_stack[i].kind == kind) return &s_stack[i];
  }
  return NULL;
}

void app_invalidate(void) { s_dirty = k_screen; }

void app_invalidate_rect(nn_rect_t r) {
  s_dirty = nn_rect_union(s_dirty, nn_rect_intersect(r, k_screen));
}

screen_t *app_push(int kind) {
  if (s_depth == STACK_MAX) s_depth--;
  screen_t *s = &s_stack[s_depth++];
  memset(s, 0, sizeof(*s));
  s->kind = kind;
  app_invalidate();
  return s;
}

void app_pop(void) {
  if (s_depth > 1) s_depth--;
  app_invalidate();
}

void app_pop_to(int depth) {
  if (depth >= 1 && depth < s_depth) s_depth = depth;
  app_invalidate();
}

void app_toast(const char *text) {
  if (s_toast_until) app_invalidate_rect(ui_pill_rect(s_toast, TOAST_Y));
  int n = 0;
  while (text[n] && n < (int)sizeof(s_toast) - 1) {
    s_toast[n] = text[n];
    n++;
  }
  s_toast[n] = 0;
  s_toast_until = s_now + TOAST_MS;
  app_invalidate_rect(ui_pill_rect(s_toast, TOAST_Y));
}

void app_remember(nn_place_t place) {
  if (s_history_len == HISTORY_MAX) {
    memmove(s_history, s_history + 1, sizeof(nn_place_t) * (HISTORY_MAX - 1));
    s_history_len--;
  }
  s_history[s_history_len++] = place;
}

bool app_go_back(void) {
  if (s_history_len == 0) return false;
  open_place(s_history[--s_history_len], false);
  return true;
}

static void save_place(void) {
  screen_t *view = app_find(SCR_VIEW);
  if (view) {
    g_store.last = view_place(&view->u.view);
    g_store.has_last = true;
    g_store.place_dirty = true;
  }
}

void app_exit(void) {
  if (!s_broken) {
    if (bundle_settings()->start == NN_START_RESUME) save_place();
    store_save();
  }
  s_exit = true;
}

bool app_exited(void) { return s_exit; }

int app_band_rows(void) { return BAND_PIXELS / NN_SCREEN_W; }

static void load_seed_notes(void) {
  if (g_store.from_flash) return;
  int count = bundle_seed_note_count();
  for (int i = 0; i < count; i++) store_note_add(bundle_seed_note(i));
  g_store.notes_dirty = false;
}

static void open_start(void) {
  const nn_settings_t *s = bundle_settings();
  app_push(SCR_HOME);
  if (s->start == NN_START_RESUME && g_store.has_last &&
      bundle_section(g_store.last.section)) {
    open_place(g_store.last, false);
    return;
  }
  int visible = 0, first = -1;
  for (int i = 0; i < bundle_section_count(); i++) {
    if (bundle_section(i)->flags & NN_SEC_HIDDEN) continue;
    if (first < 0) first = i;
    visible++;
  }
  if (first >= 0 && (s->start != NN_START_HOME || visible == 1)) {
    open_section(first);
  }
}

bool app_boot(const uint8_t *bundle, uint32_t size, const uint8_t *store,
              uint32_t store_base, void *heap, void *heap_end) {
  s_depth = 0;
  s_exit = false;
  s_history_len = 0;
  s_toast_until = 0;
  nn_mem_init(heap, heap_end);
  s_band = nn_alloc(BAND_PIXELS * sizeof(uint16_t));
  app_invalidate();
  if (s_band == NULL || !bundle_open(bundle, size)) {
    s_broken = true;
    return false;
  }
  ui_init();
  store_init(store, store_base, bundle_settings()->project_id);
  load_seed_notes();
  size_t reserve = 4096;
  size_t avail = nn_mem_available();
  image_init(avail > reserve ? avail - reserve : 0);
  open_start();
  return true;
}

static void draw_screen(gfx_t *g, screen_t *s) {
  switch (s->kind) {
    case SCR_HOME: home_draw(g, s); break;
    case SCR_VIEW: view_draw(g, s); break;
    case SCR_INSPECT: inspect_draw(g, s); break;
    case SCR_NOTES: notes_draw(g, s); break;
    case SCR_EDITOR: editor_draw(g, s); break;
    case SCR_MENU: menu_draw(g, s); break;
    case SCR_SEARCH: search_draw(g, s); break;
    case SCR_BOOKMARKS: bookmarks_draw(g, s); break;
    case SCR_TOC: toc_draw(g, s); break;
    case SCR_HELP: help_draw(g, s); break;
    case SCR_GOTO: goto_draw(g, s); break;
    case SCR_SYMBOLS: symbols_draw(g, s); break;
  }
}

static int base_screen(void) {
  int base = s_depth - 1;
  while (base > 0 && is_overlay(s_stack[base].kind)) base--;
  return base;
}

static void draw_broken(gfx_t *g) {
  gfx_fill(g, g->clip, NN_RGB(0x2A, 0x2A, 0x30));
  nn_rect_t sign = {130, 70, 60, 60};
  gfx_round_rect(g, sign, 30, NN_RGB(0xFF, 0x7A, 0x45), 255);
  nn_rect_t bar = {156, 82, 8, 26};
  gfx_round_rect(g, bar, 3, 0xFFFF, 255);
  nn_rect_t dot = {156, 113, 8, 8};
  gfx_round_rect(g, dot, 4, 0xFFFF, 255);
}

static void draw_all(gfx_t *g) {
  if (s_broken) {
    draw_broken(g);
    return;
  }
  for (int i = base_screen(); i < s_depth; i++) draw_screen(g, &s_stack[i]);
  if (s_toast_until) ui_pill(g, s_toast, TOAST_Y);
}

void app_render(void) {
  nn_rect_t area = nn_rect_intersect(s_dirty, k_screen);
  nn_rect_t none = {0, 0, 0, 0};
  s_dirty = none;
  if (nn_rect_empty(area)) return;
  int rows = NN_MAX(BAND_PIXELS / area.w, 1);
  for (int y = area.y; y < area.y + area.h; y += rows) {
    gfx_t g;
    g.px = s_band;
    g.area.x = area.x;
    g.area.y = y;
    g.area.w = area.w;
    g.area.h = NN_MIN(rows, area.y + area.h - y);
    g.clip = g.area;
    draw_all(&g);
    nn_display_push(g.area.x, g.area.y, g.area.w, g.area.h, s_band);
  }
}

static bool dispatch(screen_t *s, int ev) {
  switch (s->kind) {
    case SCR_HOME: return home_event(s, ev);
    case SCR_VIEW: return view_event(s, ev);
    case SCR_INSPECT: return inspect_event(s, ev);
    case SCR_NOTES: return notes_event(s, ev);
    case SCR_EDITOR: return editor_event(s, ev);
    case SCR_MENU: return menu_event(s, ev);
    case SCR_SEARCH: return search_event(s, ev);
    case SCR_BOOKMARKS: return bookmarks_event(s, ev);
    case SCR_TOC: return toc_event(s, ev);
    case SCR_HELP: return help_event(s, ev);
    case SCR_GOTO: return goto_event(s, ev);
    case SCR_SYMBOLS: return symbols_event(s, ev);
  }
  return false;
}

int app_modifier(void) {
  if (s_lock) return s_shift ? NN_MOD_UPPER_LOCK : NN_MOD_ALPHA_LOCK;
  if (s_alpha) return s_shift ? NN_MOD_UPPER : NN_MOD_ALPHA;
  return s_shift ? NN_MOD_SHIFT : NN_MOD_NONE;
}

/* Mirrors the firmware's shift/alpha handling closely enough to show an
 * indicator; the firmware itself composes the events we receive. */
static void track_modifiers(int ev) {
  int before = app_modifier();
  switch (ev) {
    case EV_SHIFT:
      s_shift = !s_shift;
      break;
    case EV_ALPHA:
      if (s_lock) s_lock = s_alpha = false;
      else if (s_alpha) s_lock = true;
      else s_alpha = true;
      break;
    case EV_ALPHA_LOCK:
      s_lock = !s_lock;
      s_alpha = s_lock;
      s_shift = false;
      break;
    default:
      s_shift = false;
      if (!s_lock) s_alpha = false;
      break;
  }
  if (app_modifier() != before) {
    nn_rect_t bar = {0, 0, NN_SCREEN_W, NN_STATUS_H};
    app_invalidate_rect(bar);
  }
}

static bool is_letter(unsigned cp) {
  return (cp >= 'a' && cp <= 'z') || (cp >= 'A' && cp <= 'Z');
}

void app_event(int ev, uint32_t now) {
  s_now = now;
  if (ev == EV_NONE || ev >= EV_SPECIAL) return;
  track_modifiers(ev);
  if (ev == EV_SHIFT || ev == EV_ALPHA || ev == EV_ALPHA_LOCK) return;
  if (s_broken) {
    app_exit();
    return;
  }
  if (ev == EV_HOME) {
    app_exit();
    return;
  }
  if (ev == EV_ONOFF) {
    store_save();
    nn_suspend();
    app_invalidate();
    return;
  }
  screen_t *top = app_top();
  if (dispatch(top, ev)) return;

  const nn_settings_t *settings = bundle_settings();
  unsigned cp = key_codepoint(ev);
  if (is_letter(cp) && (settings->flags & NN_SET_SEARCH)) {
    search_open(cp);
    return;
  }
  switch (ev) {
    case EV_BACK:
    case EV_BACKSPACE:
      if (s_depth > 1) app_pop();
      else if (ev == EV_BACK) app_exit();
      break;
    case EV_TOOLBOX:
      open_context_menu();
      break;
    case EV_VAR:
      if (settings->flags & NN_SET_BOOKMARKS) app_push(SCR_BOOKMARKS);
      break;
    case EV_ANS:
      if (!app_go_back()) app_toast("Nothing to go back to");
      break;
    default:
      break;
  }
}

static uint32_t tick_screen(screen_t *s, uint32_t now) {
  switch (s->kind) {
    case SCR_VIEW: return view_tick(s, now);
    case SCR_INSPECT: return inspect_tick(s, now);
    case SCR_EDITOR:
    case SCR_SEARCH: return editor_tick(s, now);
    default: return UINT32_MAX;
  }
}

uint32_t app_tick(uint32_t now) {
  s_now = now;
  if (s_broken) return UINT32_MAX;
  uint32_t wake = UINT32_MAX;
  for (int i = base_screen(); i < s_depth; i++) {
    wake = NN_MIN(wake, tick_screen(&s_stack[i], now));
  }
  if (s_toast_until) {
    if (now >= s_toast_until) {
      s_toast_until = 0;
      app_invalidate_rect(ui_pill_rect(s_toast, TOAST_Y));
    } else {
      wake = NN_MIN(wake, s_toast_until);
    }
  }
  return wake;
}

void app_bookmark(view_t *v) {
  if (g_store.bookmark_count >= STORE_MAX_BOOKMARKS) {
    app_toast("Bookmarks are full");
    return;
  }
  g_store.bookmarks[g_store.bookmark_count++] = view_place(v);
  g_store.notes_dirty = true;
  store_save();
  app_toast("Bookmarked");
}

void app_menu_action(screen_t *menu, int action) {
  int arg = menu->u.menu.arg;
  app_pop();
  screen_t *below = app_top();
  view_t *view = below && below->kind == SCR_VIEW ? &below->u.view : NULL;
  switch (action) {
    case ACT_CLOSE: break;
    case ACT_HOME: app_pop_to(1); break;
    case ACT_SEARCH: search_open(0); break;
    case ACT_BOOKMARKS: app_push(SCR_BOOKMARKS); break;
    case ACT_ADD_BOOKMARK:
      if (view) app_bookmark(view);
      break;
    case ACT_TOC: app_push(SCR_TOC); break;
    case ACT_GOTO: app_push(SCR_GOTO); break;
    case ACT_NOTES: app_push(SCR_NOTES); break;
    case ACT_NEW_NOTE: notes_new(); break;
    case ACT_PLAY: if (view) view_toggle_play(view); break;
    case ACT_OVERVIEW: if (view) view_overview(view); break;
    case ACT_OPEN_IMAGE:
      if (view && !view_open_nearest_image(view)) app_toast("No picture here");
      break;
    case ACT_BRIGHTER:
    case ACT_DIMMER: {
      int level = nn_brightness() + (action == ACT_BRIGHTER ? 16 : -16);
      nn_set_brightness(NN_CLAMP(level, 16, 240));
      break;
    }
    case ACT_HELP: app_push(SCR_HELP); break;
    case ACT_EXIT: app_exit(); break;
    case ACT_DELETE_NOTE: {
      menu_t *m = menu_open("Delete this note?");
      m->arg = arg;
      menu_add(m, "Delete", ACT_CONFIRM_DELETE, NULL);
      menu_add(m, "Keep", ACT_CLOSE, NULL);
      break;
    }
    case ACT_CONFIRM_DELETE:
      if (below && below->kind == SCR_EDITOR) app_pop();
      store_note_delete(arg);
      store_save();
      app_toast("Note deleted");
      break;
    case ACT_SYMBOLS: app_push(SCR_SYMBOLS); break;
    case ACT_DELETE_BOOKMARK:
      if (arg >= 0 && arg < g_store.bookmark_count) {
        memmove(&g_store.bookmarks[arg], &g_store.bookmarks[arg + 1],
                sizeof(nn_place_t) * (g_store.bookmark_count - arg - 1));
        g_store.bookmark_count--;
        g_store.notes_dirty = true;
        store_save();
      }
      break;
  }
  app_invalidate();
}
