/* Home, notes list, menus, search, bookmarks, contents, help and go-to. */
#include "app.h"
#include "bundle.h"
#include "keys.h"
#include "platform.h"
#include "text.h"
#include "ui.h"

#define ROW_H 44
#define SMALL_ROW_H 26
#define HINT_H 22

static nn_rect_t content_rect(bool hints) {
  nn_rect_t r = {0, NN_STATUS_H, NN_SCREEN_W,
                 NN_SCREEN_H - NN_STATUS_H - (hints ? HINT_H : 0)};
  return r;
}

static void list_move(list_t *l, int ev, int count, int row_h, int visible_h) {
  if (count <= 0) return;
  if (ev == EV_UP) l->sel = (l->sel + count - 1) % count;
  else if (ev == EV_DOWN) l->sel = (l->sel + 1) % count;
  l->scroll = ui_scroll_to(l->scroll, l->sel, row_h, visible_h, count);
  app_invalidate();
}

static void draw_list_bg(gfx_t *g, nn_rect_t r) { gfx_fill(g, r, g_theme.panel); }

static void draw_empty(gfx_t *g, nn_rect_t r, const char *title, const char *hint) {
  int y = r.y + r.h / 2 - 20;
  int w = text_width(g_theme.bold, title, -1);
  text_draw(g, g_theme.bold, title, -1, (NN_SCREEN_W - w) / 2, y, g_theme.panel_fg);
  w = text_width(g_theme.font, hint, -1);
  text_draw(g, g_theme.font, hint, -1, (NN_SCREEN_W - w) / 2,
            y + font_line_height(g_theme.bold) + 4, g_theme.dim);
}

/* --- Home --- */

static bool has_notes_section(void) {
  for (int i = 0; i < bundle_section_count(); i++) {
    if (bundle_section(i)->mode == NN_MODE_NOTES) return true;
  }
  return false;
}

static bool extra_notes_row(void) {
  return (bundle_settings()->flags & NN_SET_NOTES) && !has_notes_section();
}

/* Maps a home row to a section index; -1 is the extra Notes row. */
static int home_row_section(int row) {
  for (int i = 0; i < bundle_section_count(); i++) {
    if (bundle_section(i)->flags & NN_SEC_HIDDEN) continue;
    if (row-- == 0) return i;
  }
  return -1;
}

static int home_row_count(void) {
  int n = 0;
  for (int i = 0; i < bundle_section_count(); i++) {
    n += !(bundle_section(i)->flags & NN_SEC_HIDDEN);
  }
  return n + extra_notes_row();
}

static void count_label(char *out, int count, const char *one, const char *many) {
  int n = ui_itoa(count, out);
  out[n++] = ' ';
  const char *word = count == 1 ? one : many;
  while (*word) out[n++] = *word++;
  out[n] = 0;
}

static void section_subtitle(const nn_section_t *sec, char *out) {
  const char *custom = bundle_string(sec->subtitle);
  if (*custom) {
    int n = 0;
    while (custom[n] && n < 47) {
      out[n] = custom[n];
      n++;
    }
    out[n] = 0;
    return;
  }
  switch (sec->mode) {
    case NN_MODE_SLIDES:
      count_label(out, sec->scene_count, "slide", "slides");
      break;
    case NN_MODE_DOCUMENT: memcpy(out, "Document", 9); break;
    case NN_MODE_CANVAS: memcpy(out, "Canvas", 7); break;
    case NN_MODE_GALLERY: {
      const nn_scene_t *scene = bundle_scene(sec->first_scene);
      int cells = 0;
      const nn_item_t *items = scene ? bundle_items(scene) : NULL;
      for (int i = 0; scene && i < scene->item_count; i++) {
        cells += items[i].kind == NN_ITEM_CELL;
      }
      count_label(out, cells, "picture", "pictures");
      break;
    }
    case NN_MODE_NOTES:
      count_label(out, g_store.note_count, "note", "notes");
      break;
    default:
      out[0] = 0;
  }
}

void home_draw(gfx_t *g, screen_t *s) {
  list_t *l = &s->u.list;
  bool hints = bundle_settings()->flags & NN_SET_HINTS;
  nn_rect_t area = content_rect(hints);
  draw_list_bg(g, content_rect(false));
  int count = home_row_count();
  if (count == 0) {
    draw_empty(g, area, "Nothing here yet", "Add content on the website");
  }
  nn_rect_t saved = gfx_push_clip(g, area);
  for (int row = 0; row < count; row++) {
    nn_rect_t r = {0, area.y + row * ROW_H - l->scroll, NN_SCREEN_W, ROW_H};
    if (r.y + r.h < g->clip.y || r.y > g->clip.y + g->clip.h) continue;
    char subtitle[48];
    ui_row_t data = {0};
    int section = home_row_section(row);
    if (section >= 0) {
      const nn_section_t *sec = bundle_section(section);
      section_subtitle(sec, subtitle);
      data.title = bundle_string(sec->title);
      data.icon = sec->icon;
      data.icon_color = sec->icon_color;
    } else {
      count_label(subtitle, g_store.note_count, "note", "notes");
      data.title = "Notes";
      data.icon = NN_ICON_NOTES;
      data.icon_color = NN_RGB(0xF5, 0xA6, 0x23);
    }
    data.subtitle = subtitle;
    ui_row(g, r, &data, row == l->sel);
    if (row + 1 < count && row != l->sel && row + 1 != l->sel) {
      gfx_hline(g, 50, r.y + r.h - 1, NN_SCREEN_W - 58, g_theme.line);
    }
  }
  ui_scrollbar(g, area, l->scroll, count * ROW_H, area.h);
  gfx_set_clip(g, saved);
  if (hints) {
    nn_rect_t bar = {0, NN_SCREEN_H - HINT_H, NN_SCREEN_W, HINT_H};
    gfx_fill(g, bar, g_theme.panel);
    gfx_hline(g, 0, bar.y, NN_SCREEN_W, g_theme.line);
    static const char *const k_hints[] = {"OK", "Open", "\xE2\x8A\x9E", "Menu",
                                          "a", "Search"};
    bool search = bundle_settings()->flags & NN_SET_SEARCH;
    ui_hints(g, bar.y + 3, k_hints, search ? 3 : 2);
  }
  ui_status_bar(g, bundle_string(bundle_settings()->app_name), NULL);
}

bool home_event(screen_t *s, int ev) {
  list_t *l = &s->u.list;
  int count = home_row_count();
  nn_rect_t area = content_rect(bundle_settings()->flags & NN_SET_HINTS);
  switch (ev) {
    case EV_UP:
    case EV_DOWN:
      list_move(l, ev, count, ROW_H, area.h);
      return true;
    case EV_OK:
    case EV_EXE:
    case EV_RIGHT: {
      if (count == 0) return true;
      int section = home_row_section(l->sel);
      if (section >= 0) open_section(section);
      else app_push(SCR_NOTES);
      return true;
    }
    default:
      return false;
  }
}

/* --- Notes list --- */

static void note_title(const char *note, char *title, char *subtitle) {
  int n = 0;
  const char *p = note;
  while (*p == '\n') p++;
  while (*p && *p != '\n' && n < 47) title[n++] = *p++;
  title[n] = 0;
  if (n == 0) memcpy(title, "Untitled", 9);
  while (*p && *p != '\n') p++;
  while (*p == '\n') p++;
  n = 0;
  while (*p && n < 47) {
    char c = *p++;
    subtitle[n++] = c == '\n' ? ' ' : c;
  }
  /* Don't cut a UTF-8 sequence in half. */
  while (n > 0 && ((unsigned char)subtitle[n - 1] & 0xC0) == 0x80) n--;
  if (n > 0 && ((unsigned char)subtitle[n - 1] & 0xC0) == 0xC0) n--;
  subtitle[n] = 0;
}

void notes_draw(gfx_t *g, screen_t *s) {
  list_t *l = &s->u.list;
  nn_rect_t area = content_rect(false);
  draw_list_bg(g, area);
  int count = g_store.note_count + 1;
  nn_rect_t saved = gfx_push_clip(g, area);
  for (int row = 0; row < count; row++) {
    nn_rect_t r = {0, area.y + row * ROW_H - l->scroll, NN_SCREEN_W, ROW_H};
    if (r.y + r.h < g->clip.y || r.y > g->clip.y + g->clip.h) continue;
    ui_row_t data = {0};
    char title[48], subtitle[48];
    if (row == 0) {
      data.title = "New note";
      data.subtitle = g_store.writable ? "Type with alpha" : "Can't save on this calculator";
      data.icon = NN_ICON_NOTES;
      data.icon_color = g_theme.accent;
    } else {
      note_title(store_note(row - 1), title, subtitle);
      data.title = title;
      data.subtitle = subtitle;
      data.icon = -1;
      data.indent = 4;
    }
    ui_row(g, r, &data, row == l->sel);
    gfx_hline(g, 8, r.y + r.h - 1, NN_SCREEN_W - 16, g_theme.line);
  }
  ui_scrollbar(g, area, l->scroll, count * ROW_H, area.h);
  gfx_set_clip(g, saved);
  const char *title = "Notes";
  for (int i = 0; i < bundle_section_count(); i++) {
    if (bundle_section(i)->mode == NN_MODE_NOTES) {
      title = bundle_string(bundle_section(i)->title);
      break;
    }
  }
  char right[16];
  ui_itoa(g_store.note_count, right);
  ui_status_bar(g, title, right);
}

bool notes_event(screen_t *s, int ev) {
  list_t *l = &s->u.list;
  int count = g_store.note_count + 1;
  l->sel = NN_MIN(l->sel, count - 1);
  switch (ev) {
    case EV_UP:
    case EV_DOWN:
      list_move(l, ev, count, ROW_H, content_rect(false).h);
      return true;
    case EV_OK:
    case EV_EXE:
    case EV_RIGHT:
      if (l->sel == 0) notes_new();
      else editor_open(l->sel - 1);
      return true;
    case EV_BACKSPACE:
      if (l->sel > 0) {
        menu_t *m = menu_open("Delete this note?");
        m->arg = l->sel - 1;
        menu_add(m, "Delete", ACT_CONFIRM_DELETE, NULL);
        menu_add(m, "Keep", ACT_CLOSE, NULL);
      }
      return true;
    case EV_TOOLBOX: {
      menu_t *m = menu_open("Notes");
      menu_add(m, "New note", ACT_NEW_NOTE, NULL);
      if (l->sel > 0) {
        m->arg = l->sel - 1;
        menu_add(m, "Delete note", ACT_DELETE_NOTE, NULL);
      }
      menu_add(m, "Help", ACT_HELP, NULL);
      menu_add(m, "Home", ACT_HOME, NULL);
      return true;
    }
    default: {
      /* Typing on the list starts a new note with that text. */
      unsigned cp = key_codepoint(ev);
      if (cp && cp != ' ' && key_digit(ev) < 0) {
        notes_new();
        screen_t *top = app_top();
        if (top->kind == SCR_EDITOR) {
          char buf[4];
          editor_insert(top, buf, utf8_encode(cp, buf));
        }
        return true;
      }
      return false;
    }
  }
}

/* --- Menu --- */

menu_t *menu_open(const char *title) {
  screen_t *s = app_push(SCR_MENU);
  s->u.menu.title = title;
  return &s->u.menu;
}

void menu_add(menu_t *m, const char *label, int action, const char *right) {
  if (m->count == MENU_MAX) return;
  menu_item_t item = {label, action, right};
  m->items[m->count++] = item;
}

static nn_rect_t menu_rect(const menu_t *m, int *visible) {
  *visible = NN_MIN(m->count, 7);
  int title_h = m->title ? font_line_height(g_theme.bold) + 10 : 0;
  int h = title_h + *visible * SMALL_ROW_H + 10;
  nn_rect_t r = {(NN_SCREEN_W - 236) / 2, (NN_SCREEN_H - h) / 2, 236, h};
  return r;
}

void menu_draw(gfx_t *g, screen_t *s) {
  menu_t *m = &s->u.menu;
  ui_shade(g);
  int visible;
  nn_rect_t r = menu_rect(m, &visible);
  nn_rect_t content = ui_panel(g, r, m->title);
  nn_rect_t saved = gfx_push_clip(g, content);
  for (int i = 0; i < m->count; i++) {
    nn_rect_t row = {content.x + 1, content.y + i * SMALL_ROW_H - m->scroll,
                     content.w - 2, SMALL_ROW_H};
    if (i == m->sel) gfx_fill(g, row, g_theme.selection);
    int ty = row.y + (SMALL_ROW_H - font_line_height(g_theme.font)) / 2;
    text_draw_fit(g, i == m->sel ? g_theme.bold : g_theme.font, m->items[i].label,
                  row.x + 10, ty, row.w - 20, g_theme.panel_fg);
    if (m->items[i].right) {
      int w = text_width(g_theme.font, m->items[i].right, -1);
      text_draw(g, g_theme.font, m->items[i].right, -1, row.x + row.w - 10 - w,
                ty, g_theme.dim);
    }
  }
  ui_scrollbar(g, content, m->scroll, m->count * SMALL_ROW_H, visible * SMALL_ROW_H);
  gfx_set_clip(g, saved);
}

bool menu_event(screen_t *s, int ev) {
  menu_t *m = &s->u.menu;
  int visible;
  menu_rect(m, &visible);
  switch (ev) {
    case EV_UP:
    case EV_DOWN: {
      list_t l = {m->sel, m->scroll};
      list_move(&l, ev, m->count, SMALL_ROW_H, visible * SMALL_ROW_H);
      m->sel = l.sel;
      m->scroll = l.scroll;
      return true;
    }
    case EV_OK:
    case EV_EXE:
      if (m->count) app_menu_action(s, m->items[m->sel].action);
      return true;
    case EV_BACK:
    case EV_TOOLBOX:
      app_pop();
      return true;
    default: {
      int digit = key_digit(ev);
      if (digit >= 1 && digit <= m->count) {
        app_menu_action(s, m->items[digit - 1].action);
      }
      return true;
    }
  }
}

void open_context_menu(void) {
  screen_t *top = app_top();
  const nn_settings_t *settings = bundle_settings();
  bool search = settings->flags & NN_SET_SEARCH;
  bool bookmarks = settings->flags & NN_SET_BOOKMARKS;
  bool notes = (settings->flags & NN_SET_NOTES) || has_notes_section();
  if (top->kind == SCR_VIEW) {
    view_t *v = &top->u.view;
    const nn_section_t *sec = bundle_section(v->section);
    menu_t *m = menu_open(view_title(v));
    if (sec->mode == NN_MODE_SLIDES && sec->scene_count > 1) {
      menu_add(m, v->playing ? "Pause slideshow" : "Play slideshow", ACT_PLAY, "EXE");
    }
    if (sec->mode == NN_MODE_CANVAS) menu_add(m, "Overview", ACT_OVERVIEW, "0");
    menu_add(m, "Contents", ACT_TOC, NULL);
    if (sec->mode == NN_MODE_SLIDES || sec->mode == NN_MODE_DOCUMENT) {
      menu_add(m, "Go to page\xE2\x80\xA6", ACT_GOTO, "0-9");
    }
    menu_add(m, "Open picture", ACT_OPEN_IMAGE, "OK");
    if (bookmarks) {
      menu_add(m, "Bookmark this spot", ACT_ADD_BOOKMARK, NULL);
      menu_add(m, "Bookmarks", ACT_BOOKMARKS, "var");
    }
    if (search) menu_add(m, "Search", ACT_SEARCH, NULL);
    if (notes) menu_add(m, "Notes", ACT_NOTES, NULL);
    menu_add(m, "Home", ACT_HOME, NULL);
    menu_add(m, "Help", ACT_HELP, NULL);
    return;
  }
  if (top->kind == SCR_INSPECT) return;
  menu_t *m = menu_open(bundle_string(settings->app_name));
  if (search) menu_add(m, "Search", ACT_SEARCH, NULL);
  if (bookmarks) menu_add(m, "Bookmarks", ACT_BOOKMARKS, "var");
  if (notes) menu_add(m, "New note", ACT_NEW_NOTE, NULL);
  menu_add(m, "Brighter", ACT_BRIGHTER, NULL);
  menu_add(m, "Dimmer", ACT_DIMMER, NULL);
  menu_add(m, "Help", ACT_HELP, NULL);
  menu_add(m, "Exit", ACT_EXIT, "home");
}

/* --- Search --- */

#define MAX_RESULTS 40
#define MAX_QUERY 32

typedef struct {
  uint8_t is_note;
  uint16_t index;
  uint16_t offset; /* byte offset of the match */
} result_t;

static result_t s_results[MAX_RESULTS];

static unsigned fold(unsigned cp) {
  static const char k_latin1[] =
      "aaaaaaaceeeeiiiidnooooo\0ouuuuyts"
      "aaaaaaaceeeeiiiidnooooo\0ouuuuyty";
  if (cp >= 'A' && cp <= 'Z') return cp + 32;
  if (cp >= 0xC0 && cp <= 0xFF && k_latin1[cp - 0xC0]) {
    return (unsigned char)k_latin1[cp - 0xC0];
  }
  if (cp >= 0x391 && cp <= 0x3A9) return cp + 32; /* Greek capitals */
  return cp;
}

/* Byte offset of the first case/accent-insensitive match, or -1. */
static int find_folded(const char *text, const unsigned *q, int qn) {
  const char *start = text;
  while (*start) {
    const char *p = start;
    int i = 0;
    while (i < qn && *p) {
      if (fold(utf8_next(&p)) != q[i]) break;
      i++;
    }
    if (i == qn) return (int)(start - text);
    start += utf8_len(start);
  }
  return -1;
}

static void run_search(search_t *st) {
  unsigned q[MAX_QUERY];
  int qn = 0;
  const char *p = st->query;
  while (*p && qn < MAX_QUERY) q[qn++] = fold(utf8_next(&p));
  st->result_count = 0;
  st->sel = 0;
  st->scroll = 0;
  if (qn == 0) return;
  for (int i = 0; i < g_store.note_count && st->result_count < MAX_RESULTS; i++) {
    int at = find_folded(store_note(i), q, qn);
    if (at >= 0) {
      result_t r = {1, (uint16_t)i, (uint16_t)NN_MIN(at, 65535)};
      s_results[st->result_count++] = r;
    }
  }
  for (int i = 0; i < bundle_search_count() && st->result_count < MAX_RESULTS; i++) {
    int at = find_folded(bundle_string(bundle_search(i)->text), q, qn);
    if (at >= 0) {
      result_t r = {0, (uint16_t)i, (uint16_t)NN_MIN(at, 65535)};
      s_results[st->result_count++] = r;
    }
  }
}

void search_open(unsigned first) {
  screen_t *s = app_push(SCR_SEARCH);
  search_t *st = &s->u.search;
  if (first) {
    st->len = utf8_encode(first, st->query);
    st->query[st->len] = 0;
  }
  run_search(st);
}

static const char *result_text(const result_t *r) {
  return r->is_note ? store_note(r->index) : bundle_string(bundle_search(r->index)->text);
}

static void result_origin(const result_t *r, char *out) {
  if (r->is_note) {
    memcpy(out, "Note", 5);
    return;
  }
  const nn_search_entry_t *e = bundle_search(r->index);
  const nn_section_t *sec = bundle_section(e->section);
  const char *title = sec ? bundle_string(sec->title) : "";
  int n = 0;
  while (title[n] && n < 30) {
    out[n] = title[n];
    n++;
  }
  if (sec && sec->mode == NN_MODE_SLIDES) {
    memcpy(out + n, " \xC2\xB7 p.", 6);
    n += 6;
    n += ui_itoa(e->scene - sec->first_scene + 1, out + n);
  }
  out[n] = 0;
}

static void draw_snippet(gfx_t *g, const char *text, int match, int match_len,
                         int x, int y, int max_w) {
  /* Start a few characters before the match so it has context. */
  const char *start = text + match;
  for (int back = 0; back < 14 && start > text; back++) {
    start--;
    while (start > text && ((unsigned char)*start & 0xC0) == 0x80) start--;
  }
  const char *line_start = start;
  for (const char *p = text + match; p > start; p--) {
    if (p[-1] == '\n') {
      line_start = p;
      break;
    }
  }
  start = line_start;
  int font = g_theme.font;
  int pre = text_width(font, start, (int)(text + match - start));
  int hit = text_width(font, text + match, match_len);
  nn_rect_t mark = {x + pre - 1, y, hit + 2, font_line_height(font)};
  gfx_fill_alpha(g, mark, g_theme.highlight, 150);
  /* Draw up to the end of the line. */
  int len = 0;
  while (start[len] && start[len] != '\n') len++;
  char line[96];
  len = NN_MIN(len, 95);
  while (len > 0 && ((unsigned char)start[len] & 0xC0) == 0x80) len--;
  memcpy(line, start, len);
  line[len] = 0;
  text_draw_fit(g, font, line, x, y, max_w, g_theme.panel_fg);
}

static int match_bytes(const char *text, int at, const char *query) {
  int n = 0;
  const char *q = query, *p = text + at;
  while (*q && *p) {
    utf8_next(&q);
    p += utf8_len(p);
  }
  n = (int)(p - (text + at));
  return n;
}

void search_draw(gfx_t *g, screen_t *s) {
  search_t *st = &s->u.search;
  nn_rect_t area = content_rect(false);
  draw_list_bg(g, area);
  /* Query field. */
  nn_rect_t field = {8, NN_STATUS_H + 6, NN_SCREEN_W - 16, 26};
  gfx_fill(g, field, g_theme.bg);
  gfx_border(g, field, 0, 1, g_theme.accent);
  int ty = field.y + (field.h - font_line_height(g_theme.font)) / 2;
  int end = text_draw(g, g_theme.font, st->query, -1, field.x + 10, ty, g_theme.fg);
  if (((app_now() / 500) & 1) == 0) {
    nn_rect_t caret = {end + 1, ty, 2, font_line_height(g_theme.font)};
    gfx_fill(g, caret, g_theme.accent);
  }
  nn_rect_t list = {0, field.y + field.h + 6, NN_SCREEN_W,
                    NN_SCREEN_H - (field.y + field.h + 6)};
  if (st->len == 0) {
    draw_empty(g, list, "Search everything", "Press alpha, then type letters");
  } else if (st->result_count == 0) {
    draw_empty(g, list, "No matches", "Try fewer letters");
  }
  nn_rect_t saved = gfx_push_clip(g, list);
  int row_h = 40;
  for (int i = 0; i < st->result_count; i++) {
    nn_rect_t r = {0, list.y + i * row_h - st->scroll, NN_SCREEN_W, row_h};
    if (r.y + r.h < g->clip.y || r.y > g->clip.y + g->clip.h) continue;
    if (i == st->sel) {
      gfx_fill(g, r, g_theme.selection);
      nn_rect_t bar = {0, r.y, 3, r.h};
      gfx_fill(g, bar, g_theme.accent);
    }
    char origin[48];
    result_origin(&s_results[i], origin);
    text_draw_fit(g, g_theme.font, origin, 12, r.y + 3, NN_SCREEN_W - 24, g_theme.dim);
    const char *text = result_text(&s_results[i]);
    int at = s_results[i].offset;
    draw_snippet(g, text, at, match_bytes(text, at, st->query), 12,
                 r.y + 4 + font_line_height(g_theme.font), NN_SCREEN_W - 24);
    gfx_hline(g, 8, r.y + r.h - 1, NN_SCREEN_W - 16, g_theme.line);
  }
  ui_scrollbar(g, list, st->scroll, st->result_count * row_h, list.h);
  gfx_set_clip(g, saved);
  char right[16];
  right[0] = 0;
  if (st->len) ui_itoa(st->result_count, right);
  ui_status_bar(g, "Search", right);
}

static void open_result(const result_t *r) {
  if (r->is_note) {
    app_pop_to(1);
    app_push(SCR_NOTES);
    editor_open(r->index);
    screen_t *top = app_top();
    if (top->kind == SCR_EDITOR) top->u.editor.cursor = r->offset;
    return;
  }
  const nn_search_entry_t *e = bundle_search(r->index);
  const nn_section_t *sec = bundle_section(e->section);
  if (sec == NULL) return;
  nn_place_t place = {e->section, (uint16_t)(e->scene - sec->first_scene), 0,
                      e->y - 24, 0};
  if (sec->mode == NN_MODE_CANVAS) {
    place.zoom = ZOOM_ONE;
    place.ox = e->x + e->w / 2 - NN_SCREEN_W / 2;
    place.oy = e->y + e->h / 2 - NN_SCREEN_H / 2;
  }
  if (sec->mode == NN_MODE_SLIDES) place.oy = 0;
  open_place(place, true);
  screen_t *top = app_top();
  if (top->kind == SCR_VIEW) view_flash(&top->u.view, e->x, e->y, e->w, e->h);
}

bool search_event(screen_t *s, int ev) {
  search_t *st = &s->u.search;
  int row_h = 40, list_h = NN_SCREEN_H - (NN_STATUS_H + 38);
  switch (ev) {
    case EV_UP:
    case EV_DOWN: {
      list_t l = {st->sel, st->scroll};
      list_move(&l, ev, st->result_count, row_h, list_h);
      st->sel = l.sel;
      st->scroll = l.scroll;
      return true;
    }
    case EV_OK:
    case EV_EXE:
      if (st->result_count) open_result(&s_results[st->sel]);
      return true;
    case EV_BACKSPACE:
      if (st->len == 0) {
        app_pop();
        return true;
      }
      do {
        st->len--;
      } while (st->len > 0 && ((unsigned char)st->query[st->len] & 0xC0) == 0x80);
      st->query[st->len] = 0;
      run_search(st);
      app_invalidate();
      return true;
    case EV_CLEAR:
      st->len = 0;
      st->query[0] = 0;
      run_search(st);
      app_invalidate();
      return true;
    case EV_BACK:
      app_pop();
      return true;
    default: {
      unsigned cp = key_codepoint(ev);
      if (ev == EV_SPACE) cp = ' ';
      if (cp == 0) return true;
      char buf[4];
      int n = utf8_encode(cp, buf);
      if (st->len + n >= (int)sizeof(st->query)) return true;
      memcpy(st->query + st->len, buf, n);
      st->len += n;
      st->query[st->len] = 0;
      run_search(st);
      app_invalidate();
      return true;
    }
  }
}

/* --- Bookmarks --- */

static bool bookmarks_can_add(void) {
  return app_depth() >= 2 && app_screen(app_depth() - 2)->kind == SCR_VIEW;
}

static void place_label(nn_place_t p, char *out) {
  const nn_section_t *sec = bundle_section(p.section);
  int n = 0;
  if (sec == NULL) {
    out[0] = 0;
    return;
  }
  if (sec->mode == NN_MODE_SLIDES) {
    memcpy(out, "Slide ", 6);
    n = 6 + ui_itoa(p.page + 1, out + 6);
  } else if (sec->mode == NN_MODE_CANVAS) {
    memcpy(out, "Zoom ", 5);
    n = 5 + ui_itoa((int)(((int64_t)p.zoom * 100) >> 16), out + 5);
    out[n++] = '%';
  } else {
    const nn_scene_t *scene = bundle_scene(sec->first_scene);
    int pct = scene && scene->height > 0 ? (int)((int64_t)NN_MAX(p.oy, 0) * 100 / scene->height) : 0;
    n = ui_itoa(NN_CLAMP(pct, 0, 100), out);
    memcpy(out + n, "% down", 6);
    n += 6;
  }
  out[n] = 0;
}

void bookmarks_draw(gfx_t *g, screen_t *s) {
  list_t *l = &s->u.list;
  nn_rect_t area = content_rect(false);
  draw_list_bg(g, area);
  bool add = bookmarks_can_add();
  int count = g_store.bookmark_count + add;
  if (count == 0) {
    draw_empty(g, area, "No bookmarks", "Open a page and press var to add one");
  }
  nn_rect_t saved = gfx_push_clip(g, area);
  for (int row = 0; row < count; row++) {
    nn_rect_t r = {0, area.y + row * ROW_H - l->scroll, NN_SCREEN_W, ROW_H};
    if (r.y + r.h < g->clip.y || r.y > g->clip.y + g->clip.h) continue;
    ui_row_t data = {0};
    char subtitle[32];
    if (add && row == 0) {
      data.title = "Bookmark this spot";
      data.subtitle = "Come back here any time";
      data.icon = NN_ICON_STAR;
      data.icon_color = g_theme.accent;
    } else {
      nn_place_t p = g_store.bookmarks[row - add];
      const nn_section_t *sec = bundle_section(p.section);
      data.title = sec ? bundle_string(sec->title) : "?";
      place_label(p, subtitle);
      data.subtitle = subtitle;
      data.icon = sec ? sec->icon : NN_ICON_STAR;
      data.icon_color = sec ? sec->icon_color : g_theme.accent;
    }
    ui_row(g, r, &data, row == l->sel);
  }
  gfx_set_clip(g, saved);
  ui_status_bar(g, "Bookmarks", NULL);
}

bool bookmarks_event(screen_t *s, int ev) {
  list_t *l = &s->u.list;
  bool add = bookmarks_can_add();
  int count = g_store.bookmark_count + add;
  switch (ev) {
    case EV_UP:
    case EV_DOWN:
      list_move(l, ev, count, ROW_H, content_rect(false).h);
      return true;
    case EV_OK:
    case EV_EXE:
      if (count == 0) return true;
      if (add && l->sel == 0) {
        app_pop();
        screen_t *below = app_top();
        if (below->kind == SCR_VIEW) app_bookmark(&below->u.view);
      } else {
        open_place(g_store.bookmarks[l->sel - add], true);
      }
      return true;
    case EV_BACKSPACE:
      if (l->sel >= add && count > add) {
        menu_t *m = menu_open("Remove bookmark?");
        m->arg = l->sel - add;
        menu_add(m, "Remove", ACT_DELETE_BOOKMARK, NULL);
        menu_add(m, "Keep", ACT_CLOSE, NULL);
        l->sel = NN_MAX(l->sel - 1, 0);
      }
      return true;
    default:
      return false;
  }
}

/* --- Contents --- */

static view_t *toc_view(void) {
  if (app_depth() < 2) return NULL;
  screen_t *below = app_screen(app_depth() - 2);
  return below->kind == SCR_VIEW ? &below->u.view : NULL;
}

/* For slides, one entry per page; otherwise the scene's headings. */
static int toc_count(const view_t *v) {
  const nn_section_t *sec = bundle_section(v->section);
  if (sec->mode == NN_MODE_SLIDES) return sec->scene_count;
  const nn_scene_t *scene = bundle_scene(v->sv.scene);
  int n = 0;
  const nn_item_t *items = scene ? bundle_items(scene) : NULL;
  for (int i = 0; scene && i < scene->item_count; i++) {
    n += items[i].kind == NN_ITEM_HEADING;
  }
  return n;
}

static const nn_item_t *nth_heading(const nn_scene_t *scene, int n) {
  const nn_item_t *items = bundle_items(scene);
  for (int i = 0; i < scene->item_count; i++) {
    if (items[i].kind == NN_ITEM_HEADING && n-- == 0) return &items[i];
  }
  return NULL;
}

void toc_draw(gfx_t *g, screen_t *s) {
  list_t *l = &s->u.list;
  view_t *v = toc_view();
  nn_rect_t area = content_rect(false);
  draw_list_bg(g, area);
  if (v == NULL) return;
  const nn_section_t *sec = bundle_section(v->section);
  int count = toc_count(v);
  if (count == 0) draw_empty(g, area, "No headings", "");
  nn_rect_t saved = gfx_push_clip(g, area);
  int row_h = 34;
  for (int row = 0; row < count; row++) {
    nn_rect_t r = {0, area.y + row * row_h - l->scroll, NN_SCREEN_W, row_h};
    if (r.y + r.h < g->clip.y || r.y > g->clip.y + g->clip.h) continue;
    ui_row_t data = {0};
    data.icon = -1;
    char label[40];
    if (sec->mode == NN_MODE_SLIDES) {
      const nn_scene_t *scene = bundle_scene(sec->first_scene + row);
      const nn_item_t *h = scene ? nth_heading(scene, 0) : NULL;
      int n = ui_itoa(row + 1, label);
      label[n] = 0;
      data.right = label;
      data.title = h ? bundle_string(h->text) : "Untitled slide";
    } else {
      const nn_item_t *h = nth_heading(bundle_scene(v->sv.scene), row);
      data.title = h ? bundle_string(h->text) : "";
      data.indent = h ? NN_MIN(h->flags, 3) * 12 : 0;
    }
    ui_row(g, r, &data, row == l->sel);
  }
  ui_scrollbar(g, area, l->scroll, count * row_h, area.h);
  gfx_set_clip(g, saved);
  ui_status_bar(g, "Contents", view_title(v));
}

bool toc_event(screen_t *s, int ev) {
  list_t *l = &s->u.list;
  view_t *v = toc_view();
  if (v == NULL) return false;
  int count = toc_count(v);
  switch (ev) {
    case EV_UP:
    case EV_DOWN:
      list_move(l, ev, count, 34, content_rect(false).h);
      return true;
    case EV_OK:
    case EV_EXE: {
      if (count == 0) return true;
      const nn_section_t *sec = bundle_section(v->section);
      app_remember(view_place(v));
      app_pop();
      if (sec->mode == NN_MODE_SLIDES) {
        view_goto_page(v, l->sel);
      } else {
        const nn_item_t *h = nth_heading(bundle_scene(v->sv.scene), l->sel);
        if (h) {
          view_jump_to(v, h->y - 6);
          view_flash(v, h->x, h->y, h->w, h->h);
        }
      }
      app_invalidate();
      return true;
    }
    default:
      return false;
  }
}

/* --- Help --- */

static const char *const k_help[] = {
    "\xE2\x97\x80\xE2\x96\xB6\xE2\x96\xB2\xE2\x96\xBC", "Move, scroll and pan",
    "OK", "Open, or view a picture full screen",
    "+  \xE2\x88\x92", "Zoom in and out",
    "EXE", "Play slides \xC2\xB7 next stop on a canvas",
    "0-9", "Go to a page",
    "\xE2\x8A\x9E", "Menu (the toolbox key)",
    "var", "Bookmarks",
    "alpha", "Then type to search",
    "ans", "Jump back to where you were",
    "\xE2\x86\xA9", "Back \xC2\xB7 home key exits",
};

void help_draw(gfx_t *g, screen_t *s) {
  list_t *l = &s->u.list;
  nn_rect_t area = content_rect(false);
  draw_list_bg(g, area);
  nn_rect_t saved = gfx_push_clip(g, area);
  int row_h = 26, count = (int)NN_COUNT(k_help) / 2;
  for (int i = 0; i < count; i++) {
    int y = area.y + 8 + i * row_h - l->scroll;
    int kw = text_width(g_theme.bold, k_help[2 * i], -1) + 12;
    nn_rect_t chip = {12, y, NN_MAX(kw, 44), row_h - 6};
    gfx_fill(g, chip, g_theme.line);
    text_draw(g, g_theme.bold, k_help[2 * i], -1,
              chip.x + (chip.w - kw) / 2 + 6, y + (chip.h - font_line_height(g_theme.bold)) / 2,
              g_theme.panel_fg);
    text_draw_fit(g, g_theme.font, k_help[2 * i + 1], chip.x + chip.w + 10,
                  y + (chip.h - font_line_height(g_theme.font)) / 2, NN_SCREEN_W - chip.w - 34,
                  g_theme.panel_fg);
  }
  ui_scrollbar(g, area, l->scroll, count * row_h + 16, area.h);
  gfx_set_clip(g, saved);
  ui_status_bar(g, "Keys", NULL);
}

bool help_event(screen_t *s, int ev) {
  list_t *l = &s->u.list;
  int content = (int)NN_COUNT(k_help) / 2 * 26 + 16;
  int max = NN_MAX(content - content_rect(false).h, 0);
  if (ev == EV_UP || ev == EV_DOWN) {
    l->scroll = NN_CLAMP(l->scroll + (ev == EV_UP ? -26 : 26), 0, max);
    app_invalidate();
    return true;
  }
  if (ev == EV_OK || ev == EV_EXE) {
    app_pop();
    return true;
  }
  return false;
}

/* --- Go to page --- */

static view_t *goto_view(void) { return toc_view(); }

void goto_draw(gfx_t *g, screen_t *s) {
  goto_t *go = &s->u.go;
  view_t *v = goto_view();
  if (v == NULL) return;
  ui_shade(g);
  nn_rect_t r = {(NN_SCREEN_W - 200) / 2, 70, 200, 96};
  nn_rect_t content = ui_panel(g, r, "Go to page");
  int w = text_width(g_theme.title, go->digits, go->len);
  int x = (NN_SCREEN_W - w) / 2;
  int y = content.y + 8;
  int end = text_draw(g, g_theme.title, go->digits, go->len, x, y, g_theme.panel_fg);
  nn_rect_t caret = {end + 2, y + 2, 2, font_line_height(g_theme.title) - 4};
  gfx_fill(g, caret, g_theme.accent);
  char of[24];
  memcpy(of, "of ", 3);
  ui_itoa(view_page_count(v), of + 3);
  int ow = text_width(g_theme.font, of, -1);
  text_draw(g, g_theme.font, of, -1, (NN_SCREEN_W - ow) / 2,
            y + font_line_height(g_theme.title) + 4, g_theme.dim);
}

bool goto_event(screen_t *s, int ev) {
  goto_t *go = &s->u.go;
  view_t *v = goto_view();
  int digit = key_digit(ev);
  if (digit >= 0) {
    if (go->len < 4) go->digits[go->len++] = (char)('0' + digit);
    app_invalidate();
    return true;
  }
  switch (ev) {
    case EV_BACKSPACE:
      if (go->len > 0) go->len--;
      else app_pop();
      app_invalidate();
      return true;
    case EV_OK:
    case EV_EXE: {
      int page = 0;
      for (int i = 0; i < go->len; i++) page = page * 10 + (go->digits[i] - '0');
      app_pop();
      if (v && page > 0) {
        app_remember(view_place(v));
        view_goto_page(v, NN_MIN(page, view_page_count(v)) - 1);
      }
      return true;
    }
    case EV_BACK:
      app_pop();
      return true;
    default:
      return true;
  }
}
