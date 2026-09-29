#include "ui.h"

#include "app.h"
#include "bundle.h"
#include "platform.h"
#include "text.h"

theme_t g_theme;

#define ROW_PAD 8

static uint16_t mix(uint16_t a, uint16_t b, unsigned alpha32) {
  return blend565(a, b, alpha32);
}

static int luma(uint16_t c) {
  int r = (c >> 11) << 3, g = ((c >> 5) & 63) << 2, b = (c & 31) << 3;
  return (r * 3 + g * 6 + b) / 10;
}

void ui_init(void) {
  const nn_settings_t *s = bundle_settings();
  g_theme.bg = s->bg;
  g_theme.fg = s->fg;
  g_theme.accent = s->accent;
  g_theme.accent_fg = s->accent_fg;
  g_theme.dim = s->dim;
  g_theme.panel = s->panel;
  g_theme.line = s->line;
  g_theme.highlight = s->highlight;
  g_theme.panel_fg = luma(s->panel) > 140 ? NN_RGB(0x20, 0x20, 0x24)
                                          : NN_RGB(0xF2, 0xF2, 0xF4);
  g_theme.selection = mix(s->panel, s->accent, 7);
  g_theme.selection_fg = g_theme.panel_fg;
  g_theme.shade = 0x0000;
  g_theme.font = s->ui_font;
  g_theme.bold = s->ui_font_bold;
  g_theme.title = s->title_font;
}

int ui_itoa(int value, char *out) {
  char tmp[12];
  int n = 0, len = 0;
  bool negative = value < 0;
  unsigned v = negative ? (unsigned)(-value) : (unsigned)value;
  do {
    tmp[n++] = (char)('0' + v % 10);
    v /= 10;
  } while (v);
  if (negative) out[len++] = '-';
  while (n) out[len++] = tmp[--n];
  out[len] = 0;
  return len;
}

void ui_battery(gfx_t *g, int x, int y, uint16_t color) {
  nn_rect_t body = {x, y, 18, 10};
  gfx_border(g, body, 2, 1, color);
  nn_rect_t tip = {x + 18, y + 3, 2, 4};
  gfx_fill(g, tip, color);
  int level = NN_CLAMP(nn_battery_level(), 0, 3);
  int w = level == 0 ? 2 : level * 14 / 3;
  nn_rect_t fill = {x + 2, y + 2, w, 6};
  uint16_t fill_color = level == 0 ? NN_RGB(0xFF, 0x50, 0x40) : color;
  gfx_fill(g, fill, fill_color);
  if (nn_battery_charging()) {
    gfx_triangle(g, x + 10.5f, y + 1.0f, x + 6.0f, y + 5.5f, x + 9.5f, y + 5.5f,
                 g_theme.accent);
    gfx_triangle(g, x + 8.5f, y + 9.0f, x + 13.0f, y + 4.5f, x + 9.5f, y + 4.5f,
                 g_theme.accent);
  }
}

void ui_status_bar(gfx_t *g, const char *title, const char *right) {
  nn_rect_t bar = {0, 0, NN_SCREEN_W, NN_STATUS_H};
  if (nn_rect_empty(nn_rect_intersect(bar, g->clip))) return;
  gfx_fill(g, bar, g_theme.accent);
  int ty = (NN_STATUS_H - font_line_height(g_theme.bold)) / 2;
  int right_x = NN_SCREEN_W - 6;
  if (bundle_settings()->flags & NN_SET_BATTERY) {
    right_x -= 20;
    ui_battery(g, right_x, 5, g_theme.accent_fg);
    right_x -= 8;
  }
  int mod = app_modifier();
  if (mod != NN_MOD_NONE) {
    const char *label = mod == NN_MOD_SHIFT ? "\xE2\x87\xA7"
                      : (mod == NN_MOD_UPPER || mod == NN_MOD_UPPER_LOCK) ? "A"
                                                                           : "a";
    int w = text_width(g_theme.bold, label, -1) + 8;
    right_x -= w;
    nn_rect_t chip = {right_x, 3, w, NN_STATUS_H - 6};
    bool locked = mod == NN_MOD_ALPHA_LOCK || mod == NN_MOD_UPPER_LOCK;
    if (locked) gfx_fill(g, chip, g_theme.accent_fg);
    else gfx_border(g, chip, 0, 1, g_theme.accent_fg);
    text_draw(g, g_theme.bold, label, -1, right_x + 4, ty,
              locked ? g_theme.accent : g_theme.accent_fg);
    right_x -= 6;
  }
  if (right && *right) {
    int w = text_width(g_theme.font, right, -1);
    right_x -= w;
    text_draw(g, g_theme.font, right, -1, right_x, ty, g_theme.accent_fg);
    right_x -= 8;
  }
  text_draw_fit(g, g_theme.bold, title, 8, ty, right_x - 8, g_theme.accent_fg);
}

void ui_row(gfx_t *g, nn_rect_t r, const ui_row_t *row, bool selected) {
  if (nn_rect_empty(nn_rect_intersect(r, g->clip))) return;
  uint16_t fg = g_theme.panel_fg;
  if (selected) {
    gfx_fill(g, r, g_theme.selection);
    nn_rect_t bar = {r.x, r.y, 3, r.h};
    gfx_fill(g, bar, g_theme.accent);
  }
  int x = r.x + ROW_PAD + row->indent;
  if (row->icon >= 0) {
    int size = NN_MIN(r.h - 10, 26);
    nn_rect_t box = {x, r.y + (r.h - size) / 2, size, size};
    gfx_round_rect(g, box, 3, row->icon_color, 255);
    nn_rect_t glyph = {box.x + 4, box.y + 4, size - 8, size - 8};
    ui_icon(g, row->icon, glyph, 0xFFFF);
    x += size + ROW_PAD;
  }
  int right_edge = r.x + r.w - ROW_PAD;
  if (row->right) {
    int w = text_width(g_theme.font, row->right, -1);
    right_edge -= w;
    text_draw(g, g_theme.font, row->right, -1, right_edge,
              r.y + (r.h - font_line_height(g_theme.font)) / 2, g_theme.dim);
    right_edge -= ROW_PAD;
  }
  int title_h = font_line_height(g_theme.bold);
  if (row->subtitle && *row->subtitle) {
    int sub_h = font_line_height(g_theme.font);
    int top = r.y + (r.h - title_h - sub_h) / 2;
    text_draw_fit(g, g_theme.bold, row->title, x, top, right_edge - x, fg);
    text_draw_fit(g, g_theme.font, row->subtitle, x, top + title_h,
                  right_edge - x, g_theme.dim);
  } else {
    text_draw_fit(g, g_theme.bold, row->title, x, r.y + (r.h - title_h) / 2,
                  right_edge - x, fg);
  }
}

int ui_scroll_to(int scroll, int selected, int row_h, int visible_h, int count) {
  int top = selected * row_h, bottom = top + row_h;
  if (top < scroll) scroll = top;
  if (bottom > scroll + visible_h) scroll = bottom - visible_h;
  int max = NN_MAX(count * row_h - visible_h, 0);
  return NN_CLAMP(scroll, 0, max);
}

void ui_scrollbar(gfx_t *g, nn_rect_t r, int offset, int content, int visible) {
  if (content <= visible || content <= 0) return;
  int h = NN_MAX(r.h * visible / content, 12);
  int y = r.y + (int)((int64_t)(r.h - h) * offset / NN_MAX(content - visible, 1));
  nn_rect_t thumb = {r.x + r.w - 4, y, 3, h};
  gfx_fill_alpha(g, thumb, g_theme.dim, 160);
}

void ui_shade(gfx_t *g) { gfx_fill_alpha(g, g->clip, g_theme.shade, 110); }

nn_rect_t ui_panel(gfx_t *g, nn_rect_t r, const char *title) {
  gfx_fill(g, r, g_theme.panel);
  gfx_border(g, r, 0, 1, g_theme.line);
  int top = r.y;
  if (title) {
    int h = font_line_height(g_theme.bold) + 10;
    nn_rect_t bar = {r.x, r.y, r.w, h};
    gfx_fill(g, bar, g_theme.accent);
    text_draw_fit(g, g_theme.bold, title, r.x + 10, r.y + 5, r.w - 20,
                  g_theme.accent_fg);
    top += h;
  }
  nn_rect_t content = {r.x, top + 2, r.w, r.y + r.h - top - 6};
  return content;
}

nn_rect_t ui_pill_rect(const char *text, int cy) {
  int w = text_width(g_theme.bold, text, -1) + 24;
  int h = font_line_height(g_theme.bold) + 10;
  nn_rect_t r = {(NN_SCREEN_W - w) / 2, cy - h / 2, w, h};
  return r;
}

void ui_pill(gfx_t *g, const char *text, int cy) {
  nn_rect_t r = ui_pill_rect(text, cy);
  gfx_fill_alpha(g, r, NN_RGB(0x20, 0x20, 0x20), 225);
  text_draw(g, g_theme.bold, text, -1, r.x + 12, r.y + 5, 0xFFFF);
}

void ui_hints(gfx_t *g, int y, const char *const *pairs, int count) {
  int total = 0;
  for (int i = 0; i < count; i++) {
    total += text_width(g_theme.bold, pairs[2 * i], -1) + 8 +
             text_width(g_theme.font, pairs[2 * i + 1], -1) + 14;
  }
  int x = (NN_SCREEN_W - total + 14) / 2;
  int h = font_line_height(g_theme.font);
  for (int i = 0; i < count; i++) {
    int kw = text_width(g_theme.bold, pairs[2 * i], -1) + 8;
    nn_rect_t chip = {x, y, kw, h + 2};
    gfx_fill(g, chip, g_theme.line);
    text_draw(g, g_theme.bold, pairs[2 * i], -1, x + 4, y + 1, g_theme.panel_fg);
    x += kw + 4;
    x = text_draw(g, g_theme.font, pairs[2 * i + 1], -1, x, y + 1, g_theme.dim);
    x += 10;
  }
}

/* Icons are drawn on a 16x16 design grid mapped onto r. */
typedef struct {
  gfx_t *g;
  nn_rect_t r;
  uint16_t color;
} pen_t;

static float px(const pen_t *p, float u) { return p->r.x + u * p->r.w / 16.0f; }
static float py(const pen_t *p, float v) { return p->r.y + v * p->r.h / 16.0f; }

static void line(const pen_t *p, float u0, float v0, float u1, float v1, float w) {
  gfx_line(p->g, (int)(px(p, u0) * 16), (int)(py(p, v0) * 16),
           (int)(px(p, u1) * 16), (int)(py(p, v1) * 16),
           (int)(w * p->r.w * 16), p->color, 0);
}

static void box(const pen_t *p, float u0, float v0, float u1, float v1, bool fill) {
  nn_rect_t b = {(int)(px(p, u0) + 0.5f), (int)(py(p, v0) + 0.5f),
                 (int)(px(p, u1) - px(p, u0) + 0.5f),
                 (int)(py(p, v1) - py(p, v0) + 0.5f)};
  int stroke = NN_MAX(p->r.w / 10, 1);
  if (fill) gfx_round_rect(p->g, b, stroke, p->color, 255);
  else gfx_border(p->g, b, stroke + 1, stroke, p->color);
}

static void tri(const pen_t *p, float u0, float v0, float u1, float v1, float u2,
                float v2) {
  gfx_triangle(p->g, px(p, u0), py(p, v0), px(p, u1), py(p, v1), px(p, u2),
               py(p, v2), p->color);
}

static void disc(const pen_t *p, float cu, float cv, float ru, float rv) {
  nn_rect_t b = {(int)px(p, cu - ru), (int)py(p, cv - rv),
                 (int)(px(p, cu + ru) - px(p, cu - ru) + 0.5f),
                 (int)(py(p, cv + rv) - py(p, cv - rv) + 0.5f)};
  gfx_ellipse(p->g, b, true, p->color, 0, 0);
}

void ui_icon(gfx_t *g, int icon, nn_rect_t r, uint16_t color) {
  pen_t p = {g, r, color};
  float w = 1.6f / 16.0f;
  switch (icon) {
    case NN_ICON_SLIDES:
      box(&p, 1, 2.5f, 15, 11.5f, false);
      line(&p, 8, 11.5f, 8, 14.5f, w);
      line(&p, 5, 14.5f, 11, 14.5f, w);
      tri(&p, 6.5f, 5, 6.5f, 9, 10, 7);
      break;
    case NN_ICON_DOCUMENT:
      box(&p, 3, 1, 13, 15, false);
      line(&p, 5.5f, 5, 10.5f, 5, w);
      line(&p, 5.5f, 8, 10.5f, 8, w);
      line(&p, 5.5f, 11, 9, 11, w);
      break;
    case NN_ICON_CANVAS:
      line(&p, 8, 2.5f, 8, 13.5f, w);
      line(&p, 2.5f, 8, 13.5f, 8, w);
      tri(&p, 8, 0.5f, 5.5f, 3.5f, 10.5f, 3.5f);
      tri(&p, 8, 15.5f, 5.5f, 12.5f, 10.5f, 12.5f);
      tri(&p, 0.5f, 8, 3.5f, 5.5f, 3.5f, 10.5f);
      tri(&p, 15.5f, 8, 12.5f, 5.5f, 12.5f, 10.5f);
      break;
    case NN_ICON_GALLERY:
      box(&p, 1.5f, 1.5f, 7, 7, true);
      box(&p, 9, 1.5f, 14.5f, 7, true);
      box(&p, 1.5f, 9, 7, 14.5f, true);
      box(&p, 9, 9, 14.5f, 14.5f, true);
      break;
    case NN_ICON_NOTES:
      line(&p, 4, 12, 12.5f, 3.5f, 3.0f / 16.0f);
      tri(&p, 2, 14, 2.9f, 10.9f, 5.1f, 13.1f);
      line(&p, 8, 14.5f, 14, 14.5f, w);
      break;
    case NN_ICON_CALENDAR:
      box(&p, 1.5f, 3, 14.5f, 14.5f, false);
      box(&p, 1.5f, 3, 14.5f, 6.5f, true);
      line(&p, 5, 1, 5, 4, w);
      line(&p, 11, 1, 11, 4, w);
      for (int i = 0; i < 3; i++) {
        for (int j = 0; j < 2; j++) disc(&p, 4.5f + i * 3.5f, 9 + j * 3, 0.9f, 0.9f);
      }
      break;
    case NN_ICON_STAR:
      tri(&p, 8, 0.8f, 5.2f, 9.5f, 10.8f, 9.5f);
      tri(&p, 0.8f, 6, 15.2f, 6, 8, 11.2f);
      tri(&p, 8, 9.8f, 3.2f, 15, 5.4f, 8);
      tri(&p, 8, 9.8f, 12.8f, 15, 10.6f, 8);
      break;
    case NN_ICON_BOOK:
      tri(&p, 1, 3, 7.5f, 4.5f, 1, 13);
      tri(&p, 7.5f, 4.5f, 7.5f, 14.5f, 1, 13);
      tri(&p, 15, 3, 8.5f, 4.5f, 15, 13);
      tri(&p, 8.5f, 4.5f, 8.5f, 14.5f, 15, 13);
      break;
    case NN_ICON_FLASK:
      box(&p, 6, 1, 10, 2.8f, true);
      line(&p, 6.8f, 2.5f, 6.8f, 6.5f, w);
      line(&p, 9.2f, 2.5f, 9.2f, 6.5f, w);
      tri(&p, 6.8f, 6, 9.2f, 6, 14.5f, 14.8f);
      tri(&p, 6.8f, 6, 14.5f, 14.8f, 1.5f, 14.8f);
      break;
    case NN_ICON_CHART:
      box(&p, 1.5f, 8, 4.8f, 14.5f, true);
      box(&p, 6.4f, 3, 9.6f, 14.5f, true);
      box(&p, 11.2f, 6, 14.5f, 14.5f, true);
      break;
    case NN_ICON_HEART:
      disc(&p, 5, 5.5f, 3.6f, 3.6f);
      disc(&p, 11, 5.5f, 3.6f, 3.6f);
      tri(&p, 1.6f, 7, 14.4f, 7, 8, 14.8f);
      break;
    case NN_ICON_MUSIC:
      disc(&p, 5, 12.5f, 3, 2.4f);
      line(&p, 7.6f, 12.5f, 7.6f, 2, w * 1.2f);
      line(&p, 7.6f, 2.2f, 13, 4.5f, 2.6f / 16.0f);
      break;
    default:
      disc(&p, 8, 8, 5, 5);
      break;
  }
}
