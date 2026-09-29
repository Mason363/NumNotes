/* The on-calculator note editor and its symbol picker. */
#include "app.h"
#include "bundle.h"
#include "keys.h"
#include "text.h"
#include "ui.h"

#define MARGIN 10
#define MAX_LINES 1024
#define BLINK_MS 500
#define AUTOSAVE_MS 4000
#define CLIP_CAP 512

static uint16_t s_line_start[MAX_LINES];
static uint16_t s_line_len[MAX_LINES];
static int s_line_count;
static bool s_layout_valid;
static char s_clip[CLIP_CAP];
static int s_clip_len;
static bool s_warned_readonly;

static const char *const k_symbols[] = {
    "\xE2\x86\x92", "\xE2\x86\x90", "\xE2\x86\x91", "\xE2\x86\x93", /* arrows */
    "\xE2\x89\xA4", "\xE2\x89\xA5", "\xE2\x89\xA0", "\xE2\x89\x88", /* ≤ ≥ ≠ ≈ */
    "\xC2\xB1", "\xC3\x97", "\xC3\xB7", "\xC2\xB0",                 /* ± × ÷ ° */
    "\xC2\xB5", "\xCF\x80", "\xE2\x88\x9A", "\xE2\x88\x9E",         /* µ π √ ∞ */
    "\xCE\x94", "\xCE\xB8", "\xCE\xB1", "\xCE\xB2",                 /* Δ θ α β */
    "\xCE\xBB", "\xCF\x83", "\xCE\xA3", "\xE2\x88\xAB",             /* λ σ Σ ∫ */
    "\xE2\x88\x82", "\xE2\x88\x88", "\xE2\x80\xA2", "\xC2\xBD",     /* ∂ ∈ • ½ */
    "\xC2\xB2", "\xC2\xB3", "\xE2\x82\xAC", "\xE2\x9C\x93",         /* ² ³ € ✓ */
};
#define SYMBOL_COLS 8

static nn_rect_t text_area(void) {
  nn_rect_t r = {0, NN_STATUS_H, NN_SCREEN_W, NN_SCREEN_H - NN_STATUS_H};
  return r;
}

static int line_h(void) { return font_line_height(g_theme.font) + 2; }
static int visible_lines(void) { return (text_area().h - 8) / line_h(); }

static void layout(const editor_t *e) {
  if (s_layout_valid) return;
  s_layout_valid = true;
  const char *text = store_note(e->note);
  int width = NN_SCREEN_W - 2 * MARGIN - 4;
  int pos = 0;
  s_line_count = 0;
  while (s_line_count < MAX_LINES) {
    int next;
    int len = text_wrap(g_theme.font, text + pos, width, &next);
    s_line_start[s_line_count] = (uint16_t)pos;
    s_line_len[s_line_count] = (uint16_t)len;
    s_line_count++;
    if (text[pos + len] == 0 || next == 0) break;
    pos += next;
  }
}

static int line_of(int offset) {
  int lo = 0, hi = s_line_count - 1;
  while (lo < hi) {
    int mid = (lo + hi + 1) / 2;
    if (s_line_start[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

static int x_of(const editor_t *e, int offset) {
  int line = line_of(offset);
  const char *text = store_note(e->note);
  return text_width(g_theme.font, text + s_line_start[line], offset - s_line_start[line]);
}

/* Offset in `line` whose x position is closest to x. */
static int offset_at_x(const editor_t *e, int line, int x) {
  const char *text = store_note(e->note);
  int start = s_line_start[line], end = start + s_line_len[line];
  int best = start;
  const char *p = text + start;
  while (p < text + end) {
    int len = utf8_len(p);
    int w = text_width(g_theme.font, text + start, (int)(p - (text + start)) + len);
    int prev = text_width(g_theme.font, text + start, (int)(p - (text + start)));
    if (x < (prev + w) / 2) break;
    p += len;
    best = (int)(p - text);
  }
  return best;
}

static void reveal_cursor(editor_t *e) {
  layout(e);
  int line = line_of(e->cursor);
  int visible = visible_lines();
  if (line < e->top_line) e->top_line = line;
  if (line >= e->top_line + visible) e->top_line = line - visible + 1;
  e->top_line = NN_CLAMP(e->top_line, 0, NN_MAX(s_line_count - visible, 0));
}

static void touched(editor_t *e) {
  e->blink_epoch = app_now();
  reveal_cursor(e);
  app_invalidate();
}

static void edited(editor_t *e) {
  s_layout_valid = false;
  e->last_edit = app_now();
  if (!g_store.writable && !s_warned_readonly) {
    s_warned_readonly = true;
    app_toast("This calculator can't save notes");
  }
  touched(e);
}

static bool has_selection(const editor_t *e) {
  return e->anchor >= 0 && e->anchor != e->cursor;
}

static void delete_selection(editor_t *e) {
  if (!has_selection(e)) return;
  int a = NN_MIN(e->anchor, e->cursor), b = NN_MAX(e->anchor, e->cursor);
  store_note_erase(e->note, a, b - a);
  e->cursor = a;
  e->anchor = -1;
  edited(e);
}

void editor_insert(screen_t *s, const char *text, int len) {
  editor_t *e = &s->u.editor;
  delete_selection(e);
  if (store_note_insert(e->note, e->cursor, text, len)) {
    e->cursor += len;
    e->want_x = -1;
    edited(e);
  } else {
    app_toast("Notes are full");
  }
}

static void move_cursor(editor_t *e, int ev, bool select) {
  layout(e);
  if (select) {
    if (e->anchor < 0) e->anchor = e->cursor;
  } else if (has_selection(e) && (ev == EV_LEFT || ev == EV_RIGHT)) {
    int a = NN_MIN(e->anchor, e->cursor), b = NN_MAX(e->anchor, e->cursor);
    e->cursor = ev == EV_LEFT ? a : b;
    e->anchor = -1;
    touched(e);
    return;
  } else {
    e->anchor = -1;
  }
  const char *text = store_note(e->note);
  int length = (int)strlen(text);
  switch (ev) {
    case EV_LEFT:
      if (e->cursor > 0) {
        e->cursor--;
        while (e->cursor > 0 && ((unsigned char)text[e->cursor] & 0xC0) == 0x80) e->cursor--;
      }
      e->want_x = -1;
      break;
    case EV_RIGHT:
      if (e->cursor < length) e->cursor += utf8_len(text + e->cursor);
      e->want_x = -1;
      break;
    case EV_UP:
    case EV_DOWN: {
      int line = line_of(e->cursor);
      if (e->want_x < 0) e->want_x = x_of(e, e->cursor);
      int target = line + (ev == EV_UP ? -1 : 1);
      if (target < 0) e->cursor = 0;
      else if (target >= s_line_count) e->cursor = length;
      else e->cursor = offset_at_x(e, target, e->want_x);
      break;
    }
  }
  touched(e);
}

static void copy_selection(editor_t *e, bool cut) {
  layout(e);
  int a, b;
  if (has_selection(e)) {
    a = NN_MIN(e->anchor, e->cursor);
    b = NN_MAX(e->anchor, e->cursor);
  } else {
    int line = line_of(e->cursor);
    a = s_line_start[line];
    b = a + s_line_len[line];
  }
  s_clip_len = NN_MIN(b - a, CLIP_CAP - 1);
  memcpy(s_clip, store_note(e->note) + a, s_clip_len);
  s_clip[s_clip_len] = 0;
  if (cut && b > a) {
    store_note_erase(e->note, a, b - a);
    e->cursor = a;
    e->anchor = -1;
    edited(e);
  }
  app_toast(cut ? "Cut" : "Copied");
}

static void close_editor(editor_t *e) {
  if (store_note_length(e->note) == 0) store_note_delete(e->note);
  store_save();
  app_pop();
}

void editor_open(int note) {
  if (note < 0 || note >= g_store.note_count) return;
  screen_t *s = app_push(SCR_EDITOR);
  editor_t *e = &s->u.editor;
  e->note = note;
  e->anchor = -1;
  e->want_x = -1;
  e->blink_epoch = app_now();
  s_layout_valid = false;
}

void notes_new(void) {
  int index = store_note_add("");
  if (index < 0) {
    app_toast("Notes are full");
    return;
  }
  editor_open(index);
}

static nn_rect_t caret_rect(editor_t *e) {
  layout(e);
  int line = line_of(e->cursor);
  nn_rect_t area = text_area();
  int y = area.y + 4 + (line - e->top_line) * line_h();
  nn_rect_t r = {MARGIN + x_of(e, e->cursor), y, 2, line_h()};
  return r;
}

void editor_draw(gfx_t *g, screen_t *s) {
  editor_t *e = &s->u.editor;
  layout(e);
  nn_rect_t area = text_area();
  gfx_fill(g, area, g_theme.bg);
  const char *text = store_note(e->note);
  int lh = line_h();
  int sel_a = has_selection(e) ? NN_MIN(e->anchor, e->cursor) : -1;
  int sel_b = has_selection(e) ? NN_MAX(e->anchor, e->cursor) : -1;
  int visible = visible_lines();
  for (int i = 0; i <= visible && e->top_line + i < s_line_count; i++) {
    int line = e->top_line + i;
    int start = s_line_start[line], len = s_line_len[line];
    int y = area.y + 4 + i * lh;
    if (y > g->clip.y + g->clip.h || y + lh < g->clip.y) continue;
    if (sel_a >= 0 && sel_a < start + len + 1 && sel_b > start) {
      int a = NN_MAX(sel_a, start), b = NN_MIN(sel_b, start + len);
      int x0 = MARGIN + text_width(g_theme.font, text + start, a - start);
      int x1 = MARGIN + text_width(g_theme.font, text + start, b - start);
      if (sel_b > start + len) x1 += 4;
      nn_rect_t r = {x0, y, NN_MAX(x1 - x0, 2), lh};
      gfx_fill(g, r, g_theme.selection);
    }
    text_draw(g, g_theme.font, text + start, len, MARGIN, y + 1, g_theme.fg);
  }
  if (s_line_count == 1 && s_line_len[0] == 0) {
    text_draw(g, g_theme.font, "Start typing\xE2\x80\xA6 (alpha for letters)", -1,
              MARGIN + 4, area.y + 5, g_theme.dim);
  }
  ui_scrollbar(g, area, e->top_line * lh, s_line_count * lh, visible * lh);
  if (((app_now() - e->blink_epoch) / BLINK_MS) % 2 == 0) {
    gfx_fill(g, caret_rect(e), g_theme.accent);
  }
  const char *status = g_store.notes_dirty ? "Editing" : (g_store.writable ? "Saved" : "Not saved");
  ui_status_bar(g, "Note", status);
}

bool editor_event(screen_t *s, int ev) {
  editor_t *e = &s->u.editor;
  switch (ev) {
    case EV_BACK:
      close_editor(e);
      return true;
    case EV_LEFT:
    case EV_RIGHT:
    case EV_UP:
    case EV_DOWN:
      move_cursor(e, ev, false);
      return true;
    case EV_SHIFT_LEFT: move_cursor(e, EV_LEFT, true); return true;
    case EV_SHIFT_RIGHT: move_cursor(e, EV_RIGHT, true); return true;
    case EV_SHIFT_UP: move_cursor(e, EV_UP, true); return true;
    case EV_SHIFT_DOWN: move_cursor(e, EV_DOWN, true); return true;
    case EV_BACKSPACE:
      if (has_selection(e)) {
        delete_selection(e);
      } else if (e->cursor > 0) {
        const char *text = store_note(e->note);
        int start = e->cursor - 1;
        while (start > 0 && ((unsigned char)text[start] & 0xC0) == 0x80) start--;
        store_note_erase(e->note, start, e->cursor - start);
        e->cursor = start;
        edited(e);
      }
      return true;
    case EV_CLEAR: {
      if (has_selection(e)) {
        delete_selection(e);
        return true;
      }
      layout(e);
      int line = line_of(e->cursor);
      int start = s_line_start[line], len = s_line_len[line];
      if (len > 0) {
        store_note_erase(e->note, start, len);
        e->cursor = start;
        edited(e);
      }
      return true;
    }
    case EV_OK:
    case EV_EXE:
      editor_insert(s, "\n", 1);
      return true;
    case EV_COPY: copy_selection(e, false); return true;
    case EV_CUT: copy_selection(e, true); return true;
    case EV_PASTE:
      if (s_clip_len) editor_insert(s, s_clip, s_clip_len);
      return true;
    case EV_TOOLBOX: {
      menu_t *m = menu_open("Note");
      m->arg = e->note;
      menu_add(m, "Insert symbol\xE2\x80\xA6", ACT_SYMBOLS, NULL);
      menu_add(m, "Delete note", ACT_DELETE_NOTE, NULL);
      menu_add(m, "Done", ACT_CLOSE, NULL);
      return true;
    }
    case EV_SPACE:
      editor_insert(s, " ", 1);
      return true;
    default: {
      const char *multi = key_text(ev);
      if (multi) {
        editor_insert(s, multi, (int)strlen(multi));
        return true;
      }
      unsigned cp = key_codepoint(ev);
      if (cp) {
        char buf[4];
        editor_insert(s, buf, utf8_encode(cp, buf));
      }
      /* Swallow everything else so stray keys don't leave the editor. */
      return ev != EV_HOME;
    }
  }
}

uint32_t editor_tick(screen_t *s, uint32_t now) {
  if (s->kind == SCR_SEARCH) {
    nn_rect_t field = {8, NN_STATUS_H + 6, NN_SCREEN_W - 16, 26};
    uint32_t next = (now / BLINK_MS + 1) * BLINK_MS;
    static uint32_t last_phase;
    if (now / BLINK_MS != last_phase) {
      last_phase = now / BLINK_MS;
      app_invalidate_rect(field);
    }
    return next;
  }
  editor_t *e = &s->u.editor;
  if (g_store.notes_dirty && g_store.writable && now - e->last_edit >= AUTOSAVE_MS) {
    store_save();
    nn_rect_t bar = {0, 0, NN_SCREEN_W, NN_STATUS_H};
    app_invalidate_rect(bar);
  }
  uint32_t phase = (now - e->blink_epoch) / BLINK_MS;
  uint32_t next = e->blink_epoch + (phase + 1) * BLINK_MS;
  app_invalidate_rect(caret_rect(e));
  uint32_t wake = next;
  if (g_store.notes_dirty && g_store.writable) {
    wake = NN_MIN(wake, e->last_edit + AUTOSAVE_MS);
  }
  return wake;
}

/* --- Symbol picker --- */

static nn_rect_t symbols_rect(void) {
  int rows = (int)(NN_COUNT(k_symbols) + SYMBOL_COLS - 1) / SYMBOL_COLS;
  int w = SYMBOL_COLS * 34 + 16;
  int h = rows * 34 + font_line_height(g_theme.bold) + 26;
  nn_rect_t r = {(NN_SCREEN_W - w) / 2, (NN_SCREEN_H - h) / 2, w, h};
  return r;
}

void symbols_draw(gfx_t *g, screen_t *s) {
  ui_shade(g);
  nn_rect_t content = ui_panel(g, symbols_rect(), "Insert symbol");
  for (int i = 0; i < (int)NN_COUNT(k_symbols); i++) {
    nn_rect_t cell = {content.x + 8 + (i % SYMBOL_COLS) * 34,
                      content.y + 2 + (i / SYMBOL_COLS) * 34, 32, 32};
    if (i == s->u.symbols.sel) gfx_fill(g, cell, g_theme.selection);
    int w = text_width(g_theme.bold, k_symbols[i], -1);
    text_draw(g, g_theme.bold, k_symbols[i], -1, cell.x + (cell.w - w) / 2,
              cell.y + (cell.h - font_line_height(g_theme.bold)) / 2, g_theme.panel_fg);
  }
}

bool symbols_event(screen_t *s, int ev) {
  int n = (int)NN_COUNT(k_symbols);
  int *sel = &s->u.symbols.sel;
  switch (ev) {
    case EV_LEFT: *sel = (*sel + n - 1) % n; break;
    case EV_RIGHT: *sel = (*sel + 1) % n; break;
    case EV_UP: *sel = (*sel - SYMBOL_COLS + n) % n; break;
    case EV_DOWN: *sel = (*sel + SYMBOL_COLS) % n; break;
    case EV_OK:
    case EV_EXE: {
      const char *symbol = k_symbols[*sel];
      app_pop();
      screen_t *editor = app_top();
      if (editor->kind == SCR_EDITOR) editor_insert(editor, symbol, (int)strlen(symbol));
      return true;
    }
    case EV_BACK:
    case EV_TOOLBOX:
      app_pop();
      return true;
    default:
      return true;
  }
  app_invalidate_rect(symbols_rect());
  return true;
}
