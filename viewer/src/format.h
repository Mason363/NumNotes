/*
 * NumNotes bundle format (version 1).
 *
 * The website packs everything a NumNotes app shows into one read-only blob,
 * the "bundle", which is linked into the app as the `nn_content` symbol and
 * read in place from flash. web/src/pack/format.ts mirrors this file; keep
 * them in sync.
 *
 * Conventions:
 *  - Little-endian. Every struct is 4-byte aligned and padded to a multiple
 *    of 4 bytes. Offsets are u32 byte offsets from the start of the bundle.
 *  - Strings are offsets to NUL-terminated UTF-8. Offset 0 means "none".
 *  - Colors are RGB565.
 *  - Scene coordinates are pixels at zoom 1. Zoom factors are 8.8 fixed point
 *    (256 == 100%).
 */
#ifndef NN_FORMAT_H
#define NN_FORMAT_H

#include <stdint.h>

#define NN_BUNDLE_MAGIC 0x31424E4Eu /* "NNB1" */
#define NN_BUNDLE_VERSION 1

typedef struct {
  uint32_t magic;
  uint16_t version;
  uint16_t flags;
  uint32_t size;          /* total bundle size in bytes */
  uint32_t settings;      /* nn_settings_t */
  uint32_t sections;      /* nn_section_t[section_count] */
  uint32_t fonts;         /* nn_font_t[font_count] */
  uint32_t images;        /* nn_image_t[image_count] */
  uint32_t anims;         /* nn_anim_t[anim_count] */
  uint32_t scenes;        /* nn_scene_t[scene_count] */
  uint32_t notes;         /* nn_notes_t, 0 if none */
  uint32_t search;        /* nn_search_entry_t[search_count] */
  uint16_t section_count;
  uint16_t font_count;
  uint16_t image_count;
  uint16_t anim_count;
  uint16_t scene_count;
  uint16_t search_count;
  uint32_t reserved[2];
} nn_header_t; /* 64 bytes */

/* nn_settings_t.start */
enum { NN_START_HOME = 0, NN_START_FIRST_SECTION = 1, NN_START_RESUME = 2 };

/* nn_settings_t.flags */
enum {
  NN_SET_NOTES = 1 << 0,        /* on-calc notes are available */
  NN_SET_BATTERY = 1 << 1,      /* show battery in the status bar */
  NN_SET_HINTS = 1 << 2,        /* show key hints on the home screen */
  NN_SET_SEARCH = 1 << 3,       /* search is available */
  NN_SET_BOOKMARKS = 1 << 4,    /* bookmarks are available */
  NN_SET_DARK_UI = 1 << 5,      /* menus and home screen use dark chrome */
};

typedef struct {
  uint32_t app_name;     /* string */
  uint32_t project_id;   /* random id; ties the flash store to this project */
  uint16_t bg;           /* default page background */
  uint16_t fg;           /* default text */
  uint16_t accent;       /* status bar / selection */
  uint16_t accent_fg;    /* text drawn on accent */
  uint16_t dim;          /* secondary text */
  uint16_t panel;        /* menu background */
  uint16_t line;         /* separators */
  uint16_t highlight;    /* search hit highlight */
  uint16_t ui_font;      /* font index for UI text and notes */
  uint16_t ui_font_bold; /* font index for UI titles */
  uint16_t title_font;   /* font index for the home screen title */
  uint8_t start;         /* NN_START_* */
  uint8_t flags;         /* NN_SET_* */
  uint32_t reserved[2];
} nn_settings_t; /* 40 bytes */

/* nn_section_t.mode */
enum {
  NN_MODE_SLIDES = 0,
  NN_MODE_DOCUMENT = 1,
  NN_MODE_CANVAS = 2,
  NN_MODE_GALLERY = 3,
  NN_MODE_NOTES = 4,
};

/* nn_section_t.flags */
enum {
  NN_SEC_LOOP = 1 << 0,        /* slides wrap around */
  NN_SEC_AUTOPLAY = 1 << 1,    /* slides advance by themselves */
  NN_SEC_TRANSITION = 1 << 2,  /* animate slide changes */
  NN_SEC_PAGE_NUMBERS = 1 << 3,/* flash the page number on change */
  NN_SEC_STATUS_BAR = 1 << 4,  /* keep the status bar visible */
  NN_SEC_MINIMAP = 1 << 5,     /* canvas shows a minimap while moving */
  NN_SEC_HIDDEN = 1 << 6,      /* not listed on the home screen */
  NN_SEC_CAPTIONS = 1 << 7,    /* gallery shows captions in the viewer */
};

typedef struct {
  uint32_t title;        /* string */
  uint32_t subtitle;     /* string shown under the title on the home screen */
  uint8_t mode;          /* NN_MODE_* */
  uint8_t icon;          /* NN_ICON_* shown on the home screen */
  uint16_t flags;        /* NN_SEC_* */
  uint16_t first_scene;  /* index into the scene table */
  uint16_t scene_count;  /* slides: one per page; other modes: 1 */
  uint16_t icon_color;   /* home screen icon background */
  uint16_t bg;           /* color around scenes */
  uint16_t autoplay_ds;  /* autoplay delay in tenths of a second */
  uint16_t zoom_min;     /* 8.8 */
  uint16_t zoom_max;     /* 8.8 */
  uint16_t zoom_start;   /* 8.8, 0 = fit */
  uint32_t reserved;
} nn_section_t; /* 32 bytes */

/* nn_scene_t.flags */
enum {
  NN_SCENE_CENTER = 1 << 0, /* center the scene when smaller than the view */
  NN_SCENE_SORTED = 1 << 1, /* primitives are sorted by y (documents); other
                               scenes keep paint order and are scanned */
};

typedef struct {
  int32_t width;
  int32_t height;
  uint16_t bg;
  uint16_t flags;
  uint32_t prims;        /* u32[prim_count]: offsets of primitives in paint order */
  uint32_t prim_count;
  int32_t max_prim_h;    /* tallest primitive (sorted scenes cull with it) */
  uint32_t items;        /* nn_item_t[item_count] */
  uint16_t item_count;
  uint16_t reserved;
} nn_scene_t; /* 32 bytes */

/* nn_prim_t.type */
enum {
  NN_PRIM_RECT = 1,
  NN_PRIM_IMAGE = 2,
  NN_PRIM_TEXT = 3,
  NN_PRIM_LINE = 4,
  NN_PRIM_ELLIPSE = 5,
  NN_PRIM_ANIM = 6,
};

/* Every primitive starts with this header. `w`/`h` is its bounding box. */
typedef struct {
  uint8_t type;
  uint8_t flags;
  uint16_t size;         /* whole primitive, bytes */
  int32_t x;
  int32_t y;
  uint16_t w;
  uint16_t h;
} nn_prim_t; /* 16 bytes */

typedef struct {
  nn_prim_t p;
  uint16_t color;
  uint8_t alpha;         /* 255 = opaque */
  uint8_t radius;        /* rounded corners */
  uint16_t border_color;
  uint8_t border_width;  /* 0 = no border */
  uint8_t reserved;
} nn_prim_rect_t; /* 24 bytes */

typedef struct {
  nn_prim_t p;
  uint16_t image;        /* image index */
  uint16_t reserved;
} nn_prim_image_t; /* 20 bytes */

typedef struct {
  nn_prim_t p;
  uint16_t anim;         /* anim index */
  uint16_t reserved;
} nn_prim_anim_t; /* 20 bytes */

/* Text primitives hold one line of glyphs in a single style. The pen starts at
 * (p.x, p.y + font.ascent) and advances by each glyph's advance. Glyphs are
 * u8 indices, or u16 when the font has NN_FONT_WIDE. */
enum {
  NN_TEXT_UNDERLINE = 1 << 0,
  NN_TEXT_STRIKE = 1 << 1,
};

typedef struct {
  nn_prim_t p;
  uint16_t font;
  uint16_t color;
  uint16_t count;
  int16_t space_extra;   /* 1/16 px added after each space (justify) */
} nn_prim_text_t; /* 24 bytes + glyphs */

typedef struct {
  nn_prim_t p;
  int32_t x0, y0, x1, y1;
  uint16_t color;
  uint8_t width;
  uint8_t arrows;        /* bit0: arrow at start, bit1: arrow at end */
} nn_prim_line_t; /* 36 bytes */

typedef struct {
  nn_prim_t p;
  uint16_t fill;
  uint16_t stroke;
  uint8_t stroke_width;
  uint8_t filled;
  uint16_t reserved;
} nn_prim_ellipse_t; /* 24 bytes */

/* nn_item_t.kind: things the user can land on inside a scene. */
enum {
  NN_ITEM_IMAGE = 1,     /* ref = image; OK opens it full screen */
  NN_ITEM_ANIM = 2,      /* ref = anim */
  NN_ITEM_STOP = 3,      /* canvas focus stop */
  NN_ITEM_HEADING = 4,   /* table of contents entry; text = title, flags = level */
  NN_ITEM_CELL = 5,      /* gallery cell; ref = image, text = caption */
  NN_ITEM_LINK = 6,      /* ref = section index to jump to */
};

typedef struct {
  uint8_t kind;
  uint8_t flags;
  uint16_t ref;
  int32_t x, y;
  uint16_t w, h;
  uint32_t text;         /* string */
} nn_item_t; /* 20 bytes */

/* Fonts are pre-rasterized by the website with only the glyphs in use. */
enum {
  NN_FONT_WIDE = 1 << 0, /* text primitives use u16 glyph indices */
};

typedef struct {
  uint16_t line_height;
  uint8_t ascent;
  uint8_t descent;
  uint8_t bpp;           /* 1, 2 or 4 bits of coverage per pixel */
  uint8_t flags;         /* NN_FONT_* */
  uint16_t glyph_count;
  uint32_t glyphs;       /* nn_glyph_t[glyph_count], sorted by codepoint */
  uint32_t bitmaps;      /* base for nn_glyph_t.bitmap */
  uint16_t fallback;     /* glyph used for missing characters */
  uint16_t space;        /* glyph index of U+0020 */
} nn_font_t; /* 20 bytes */

typedef struct {
  uint32_t codepoint;
  uint16_t advance;      /* 12.4 fixed point */
  int8_t bx;             /* bitmap left, relative to the pen */
  int8_t by;             /* bitmap top, relative to the baseline (up is +) */
  uint8_t w, h;
  uint16_t reserved;
  uint32_t bitmap;       /* offset from nn_font_t.bitmaps; rows are byte aligned */
} nn_glyph_t; /* 16 bytes */

/* nn_image_t.format */
enum {
  NN_IMG_PALETTE = 1,    /* indexed, LZ4 per tile */
  NN_IMG_RGB565 = 2,     /* RGB565, LZ4 per tile */
  NN_IMG_DCT = 3,        /* lossy DCT, see dct.c */
};

enum {
  NN_IMGF_TRANSPARENT = 1 << 0, /* palette index 0 is transparent */
  NN_IMGF_GRAY = 1 << 1,        /* DCT: luma only */
  NN_IMGF_SMOOTH = 1 << 2,      /* prefer bilinear sampling when scaling */
  NN_IMGF_444 = 1 << 3,         /* DCT: full-resolution chroma (default 4:2:0) */
};

typedef struct {
  uint16_t width;        /* level 0 size == size in the scene at zoom 1 */
  uint16_t height;
  uint8_t format;        /* NN_IMG_* */
  uint8_t level_count;
  uint8_t tile_shift;    /* tiles are (1 << tile_shift) px square */
  uint8_t flags;         /* NN_IMGF_* */
  uint32_t palette;      /* u16 count, u16 colors[count]; 0 if none */
  uint32_t levels;       /* nn_level_t[level_count], increasing resolution */
} nn_image_t; /* 16 bytes */

typedef struct {
  uint16_t width;
  uint16_t height;
  uint16_t tiles_x;
  uint16_t tiles_y;
  uint8_t bpp;           /* palette: 1, 2, 4 or 8 */
  uint8_t quality;       /* DCT: quality used to build quant tables (1..100) */
  uint16_t reserved;
  uint32_t tiles;        /* u32[tiles_x * tiles_y + 1] offsets, row-major */
} nn_level_t; /* 16 bytes */

typedef struct {
  uint16_t width;
  uint16_t height;
  uint16_t frame_count;
  uint16_t loops;        /* 0 = forever */
  uint32_t frames;       /* nn_frame_t[frame_count] */
} nn_anim_t; /* 12 bytes */

typedef struct {
  uint16_t image;
  uint16_t delay_ms;
} nn_frame_t; /* 4 bytes */

/* Starter notes, editable on the calculator. */
typedef struct {
  uint16_t count;
  uint16_t reserved;
  uint32_t note[];       /* strings */
} nn_notes_t;

typedef struct {
  uint16_t section;
  uint16_t scene;        /* absolute scene index */
  int32_t x, y;
  uint16_t w, h;
  uint32_t text;         /* the text as shown; matching ignores case/accents */
} nn_search_entry_t; /* 20 bytes */

/* Home screen icons (nn_section_t.icon). */
enum {
  NN_ICON_SLIDES = 0,
  NN_ICON_DOCUMENT,
  NN_ICON_CANVAS,
  NN_ICON_GALLERY,
  NN_ICON_NOTES,
  NN_ICON_CALENDAR,
  NN_ICON_STAR,
  NN_ICON_BOOK,
  NN_ICON_FLASK,
  NN_ICON_CHART,
  NN_ICON_HEART,
  NN_ICON_MUSIC,
  NN_ICON_COUNT
};

#endif
