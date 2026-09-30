/* Shared look and feel: theme, status bar, lists, panels, icons, pills. */
#ifndef NN_UI_H
#define NN_UI_H

#include "format.h"
#include "gfx.h"

typedef struct {
  uint16_t bg, fg, accent, accent_fg, dim, panel, line, highlight;
  uint16_t panel_fg, selection, selection_fg, shade;
  uint16_t wall, cell; /* list background and list cells */
  int font, bold, title;
} theme_t;

/* Lists are tables of bordered cells inset from the screen edges, like the
 * calculator's own Settings app. */
#define UI_CELL_INSET 10
#define UI_LIST_TOP 8

extern theme_t g_theme;

void ui_init(void);

/* Title bar across the top of the screen: the title centered in capitals,
 * `info` (may be NULL) on the left, battery on the right. */
void ui_status_bar(gfx_t *g, const char *title, const char *info);

/* A list cell spanning `r` minus the side insets; `selected` cells are
 * highlighted. `icon` < 0 draws no icon. */
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
