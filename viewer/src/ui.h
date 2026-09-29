/* Shared look and feel: theme, status bar, lists, panels, icons, pills. */
#ifndef NN_UI_H
#define NN_UI_H

#include "format.h"
#include "gfx.h"

typedef struct {
  uint16_t bg, fg, accent, accent_fg, dim, panel, line, highlight;
  uint16_t panel_fg, selection, selection_fg, shade;
  int font, bold, title;
} theme_t;

extern theme_t g_theme;

void ui_init(void);

/* Status bar across the top of the screen. `right` may be NULL. */
void ui_status_bar(gfx_t *g, const char *title, const char *right);

/* A list row; `selected` rows are highlighted. `icon` < 0 draws no icon. */
typedef struct {
  const char *title;
  const char *subtitle; /* may be NULL */
  const char *right;    /* may be NULL */
  int icon;             /* NN_ICON_* or -1 */
  uint16_t icon_color;
  int indent;
} ui_row_t;

void ui_row(gfx_t *g, nn_rect_t r, const ui_row_t *row, bool selected);

/* Keeps `selected` visible in a list of `count` rows of `row_h` pixels shown
 * in `visible_h` pixels; returns the new scroll offset in pixels. */
int ui_scroll_to(int scroll, int selected, int row_h, int visible_h, int count);

/* Thin scroll indicator on the right edge of `r`. */
void ui_scrollbar(gfx_t *g, nn_rect_t r, int offset, int content, int visible);

/* Darkens everything drawn so far (behind a menu). */
void ui_shade(gfx_t *g);

/* Rounded panel with a title strip; returns the content rect. */
nn_rect_t ui_panel(gfx_t *g, nn_rect_t r, const char *title);

/* A translucent pill with a short message, centered at `cy`. */
void ui_pill(gfx_t *g, const char *text, int cy);
nn_rect_t ui_pill_rect(const char *text, int cy);

/* Key hint strip: pairs of (key label, action). */
void ui_hints(gfx_t *g, int y, const char *const *pairs, int count);

void ui_icon(gfx_t *g, int icon, nn_rect_t r, uint16_t color);
void ui_battery(gfx_t *g, int x, int y, uint16_t color);

/* Formats small integers without printf. */
int ui_itoa(int value, char *out);

#endif
