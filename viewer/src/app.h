/* The viewer is a stack of screens. Each screen draws itself, reacts to key
 * events and asks to be woken up for animations. */
#ifndef NN_APP_H
#define NN_APP_H

#include "gfx.h"
#include "scene.h"
#include "store.h"

enum {
  SCR_HOME,
  SCR_VIEW,
  SCR_INSPECT,
  SCR_NOTES,
  SCR_EDITOR,
  SCR_MENU,
  SCR_SEARCH,
  SCR_BOOKMARKS,
  SCR_TOC,
  SCR_HELP,
  SCR_GOTO,
  SCR_SYMBOLS,
};

typedef struct {
  int section;
  int page;
  scene_view_t sv;
  int32_t fit_zoom;
  int focus;               /* scene item index, or -1 */
  bool playing;
  uint32_t next_auto;
  bool transition;
  int from_page;
  int dir;
  uint32_t trans_start;
  bool moving;
  uint32_t move_start;
  int32_t move_from[3];    /* ox, oy, zoom */
  int32_t move_to[3];
  uint32_t minimap_until;
  int repeat;
  int last_ev;
  uint32_t last_ev_time;
  uint32_t anim_due;
  nn_rect_t anim_dirty;
  nn_rect_t flash;         /* scene rect highlighted after a jump */
  uint32_t flash_until;
} view_t;

typedef struct {
  int scene;               /* scene the browsable items come from */
  int section;
  int item;                /* index in the scene's item table */
  int image;               /* image shown, or -1 when showing an animation */
  int anim;
  int w, h;
  int32_t zoom;            /* 16.16, 1.0 = fit to screen */
  int32_t cx, cy;          /* image point at the center of the screen */
  uint32_t epoch;
  uint32_t anim_due;
  bool caption;
} inspect_t;

#define MENU_MAX 16
typedef struct {
  const char *label;
  int action;
  const char *right;
} menu_item_t;

typedef struct {
  const char *title;
  menu_item_t items[MENU_MAX];
  int count;
  int sel;
  int scroll;
  int arg;                 /* action argument (e.g. note index) */
} menu_t;

typedef struct {
  int sel;
  int scroll;
} list_t;

typedef struct {
  char query[64];
  int len;
  int sel;
  int scroll;
  int result_count;
} search_t;

typedef struct {
  char digits[6];
  int len;
} goto_t;

typedef struct {
  int note;
  int cursor;              /* byte offset */
  int anchor;              /* selection start, or -1 */
  int top_line;
  int want_x;              /* column to keep when moving up/down, or -1 */
  uint32_t blink_epoch;
  uint32_t last_edit;
} editor_t;

typedef struct {
  int sel;
} symbols_t;

typedef struct {
  int kind;
  union {
    list_t list;
    view_t view;
    inspect_t inspect;
    menu_t menu;
    search_t search;
    goto_t go;
    editor_t editor;
    symbols_t symbols;
  } u;
} screen_t;

/* Menu actions. */
enum {
  ACT_CLOSE,
  ACT_HOME,
  ACT_SEARCH,
  ACT_BOOKMARKS,
  ACT_ADD_BOOKMARK,
  ACT_TOC,
  ACT_GOTO,
  ACT_NOTES,
  ACT_NEW_NOTE,
  ACT_PLAY,
  ACT_OVERVIEW,
  ACT_OPEN_IMAGE,
  ACT_BRIGHTER,
  ACT_DIMMER,
  ACT_HELP,
  ACT_EXIT,
  ACT_DELETE_NOTE,
  ACT_CONFIRM_DELETE,
  ACT_SYMBOLS,
  ACT_DELETE_BOOKMARK,
};

/* Shift/alpha state as last seen from the keyboard (for the indicator). */
enum { NN_MOD_NONE = 0, NN_MOD_SHIFT, NN_MOD_ALPHA, NN_MOD_ALPHA_LOCK,
       NN_MOD_UPPER, NN_MOD_UPPER_LOCK };

/* --- app.c --- */
int app_modifier(void);
screen_t *app_push(int kind);
void app_pop(void);
void app_pop_to(int depth);
int app_depth(void);
screen_t *app_screen(int depth); /* 0 = bottom */
screen_t *app_top(void);
/* The nearest screen below the top of the given kind, or NULL. */
screen_t *app_find(int kind);
void app_invalidate(void);
void app_invalidate_rect(nn_rect_t r);
void app_toast(const char *text);
void app_exit(void);
uint32_t app_now(void);
int app_band_rows(void);
void app_remember(nn_place_t place);
bool app_go_back(void);
void app_menu_action(screen_t *menu, int action);
void app_bookmark(view_t *v);

/* --- views.c --- */
void view_open(screen_t *s, int section);
void view_restore(view_t *v, nn_place_t place);
nn_place_t view_place(const view_t *v);
void view_draw(gfx_t *g, screen_t *s);
bool view_event(screen_t *s, int ev);
uint32_t view_tick(screen_t *s, uint32_t now);
void view_show_rect(view_t *v, int32_t x, int32_t y, int32_t w, int32_t h);
bool view_open_nearest_image(view_t *v);
void view_toggle_play(view_t *v);
void view_overview(view_t *v);
void view_jump_to(view_t *v, int32_t y);
int view_page_count(const view_t *v);
void view_goto_page(view_t *v, int page);
const char *view_title(const view_t *v);
void open_place(nn_place_t place, bool remember);
void view_flash(view_t *v, int32_t x, int32_t y, int32_t w, int32_t h);
void open_section(int section);

void inspect_open(int section, int scene, int item);
void inspect_draw(gfx_t *g, screen_t *s);
bool inspect_event(screen_t *s, int ev);
uint32_t inspect_tick(screen_t *s, uint32_t now);

/* --- screens.c --- */
void home_draw(gfx_t *g, screen_t *s);
bool home_event(screen_t *s, int ev);
void notes_draw(gfx_t *g, screen_t *s);
bool notes_event(screen_t *s, int ev);
void menu_draw(gfx_t *g, screen_t *s);
bool menu_event(screen_t *s, int ev);
menu_t *menu_open(const char *title);
void menu_add(menu_t *m, const char *label, int action, const char *right);
void search_open(unsigned first_codepoint);
void search_draw(gfx_t *g, screen_t *s);
bool search_event(screen_t *s, int ev);
void bookmarks_draw(gfx_t *g, screen_t *s);
bool bookmarks_event(screen_t *s, int ev);
void toc_draw(gfx_t *g, screen_t *s);
bool toc_event(screen_t *s, int ev);
void help_draw(gfx_t *g, screen_t *s);
bool help_event(screen_t *s, int ev);
void goto_draw(gfx_t *g, screen_t *s);
bool goto_event(screen_t *s, int ev);
void open_context_menu(void);

/* --- editor.c --- */
void editor_open(int note);
void editor_draw(gfx_t *g, screen_t *s);
bool editor_event(screen_t *s, int ev);
uint32_t editor_tick(screen_t *s, uint32_t now);
void editor_insert(screen_t *s, const char *text, int len);
void symbols_draw(gfx_t *g, screen_t *s);
bool symbols_event(screen_t *s, int ev);
void notes_new(void);

#endif
