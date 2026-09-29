#include "image.h"

#include "bundle.h"
#include "dct.h"
#include "lz4.h"
#include "mem.h"

#define MAX_TILE_SHIFT 5
#define TILE_PIXELS (1 << (2 * MAX_TILE_SHIFT))
#define ERROR_COLOR NN_RGB(0xE0, 0xE0, 0xE0)

typedef struct {
  uint32_t tile;
  uint32_t stamp;
  uint16_t image;
  uint8_t level;
  uint8_t valid;
} slot_t;

static slot_t *s_slots;
static uint16_t *s_pixels;
static int s_slot_count;
static uint32_t s_clock;
static uint8_t *s_scratch; /* palette indices before mapping */
static int s_last_hit; /* slot index + 1, 0 when unknown */

bool image_init(size_t budget) {
  size_t per_slot = sizeof(slot_t) + TILE_PIXELS * sizeof(uint16_t);
  size_t scratch = TILE_PIXELS;
  if (budget < scratch + 4 * per_slot) return false;
  s_slot_count = (int)((budget - scratch) / per_slot);
  if (s_slot_count > 96) s_slot_count = 96;
  s_slots = nn_alloc(s_slot_count * sizeof(slot_t));
  s_pixels = nn_alloc((size_t)s_slot_count * TILE_PIXELS * sizeof(uint16_t));
  s_scratch = nn_alloc(scratch);
  return s_slots && s_pixels && s_scratch;
}

void image_flush(void) {
  for (int i = 0; i < s_slot_count; i++) s_slots[i].valid = 0;
  s_last_hit = 0;
}

static void fill_error(uint16_t *out, int pixels) {
  for (int i = 0; i < pixels; i++) out[i] = ERROR_COLOR;
}

static bool decode_palette(const nn_image_t *img, const nn_level_t *lvl,
                           const uint8_t *data, uint32_t len, int side,
                           uint16_t *out) {
  const uint16_t *palette = bundle_at(img->palette, 2);
  if (palette == NULL) return false;
  unsigned count = palette[0];
  if (count == 0 || !bundle_at(img->palette, 2 + 2 * count)) return false;
  const uint16_t *colors = palette + 1;
  int bpp = lvl->bpp;
  if (bpp != 1 && bpp != 2 && bpp != 4 && bpp != 8) return false;
  int pixels = side * side;
  int bytes = (pixels * bpp + 7) / 8;
  if (nn_lz4_decompress(data, (int)len, s_scratch, bytes) != bytes) return false;
  bool transparent = img->flags & NN_IMGF_TRANSPARENT;
  int per_byte = 8 / bpp;
  unsigned mask = (1u << bpp) - 1;
  for (int i = 0; i < pixels; i++) {
    int shift = 8 - bpp * (i % per_byte + 1);
    unsigned index = (s_scratch[i / per_byte] >> shift) & mask;
    if (transparent && index == 0) out[i] = NN_TRANSPARENT_KEY;
    else out[i] = index < count ? colors[index] : ERROR_COLOR;
  }
  return true;
}

static bool decode_tile(const nn_image_t *img, const nn_level_t *lvl,
                        uint32_t tile, uint16_t *out) {
  int side = 1 << img->tile_shift;
  uint32_t tiles = (uint32_t)lvl->tiles_x * lvl->tiles_y;
  const uint32_t *table = bundle_at(lvl->tiles, (tiles + 1) * 4);
  if (table == NULL || tile >= tiles || table[tile + 1] < table[tile]) {
    return false;
  }
  uint32_t len = table[tile + 1] - table[tile];
  const uint8_t *data = bundle_at(table[tile], len);
  if (data == NULL) return false;
  switch (img->format) {
    case NN_IMG_PALETTE:
      return decode_palette(img, lvl, data, len, side, out);
    case NN_IMG_RGB565: {
      int bytes = side * side * 2;
      return nn_lz4_decompress(data, (int)len, (uint8_t *)out, bytes) == bytes;
    }
    case NN_IMG_DCT: {
      if (side != 32) return false;
      int mode = (img->flags & NN_IMGF_GRAY) ? NN_DCT_GRAY
                 : (img->flags & NN_IMGF_444) ? NN_DCT_444
                                              : NN_DCT_420;
      return nn_dct_decode_tile(data, len, mode, lvl->quality, out) == 0;
    }
    default:
      return false;
  }
}

/* Returns decoded pixels for a tile, decoding into the oldest slot on miss. */
static const uint16_t *tile_pixels(int image, int level, const nn_image_t *img,
                                   const nn_level_t *lvl, uint32_t tile) {
  s_clock++;
  if (s_last_hit > 0) {
    slot_t *s = &s_slots[s_last_hit - 1];
    if (s->valid && s->tile == tile && s->image == image && s->level == level) {
      s->stamp = s_clock;
      return s_pixels + (size_t)(s_last_hit - 1) * TILE_PIXELS;
    }
  }
  int victim = -1;
  for (int i = 0; i < s_slot_count; i++) {
    slot_t *s = &s_slots[i];
    if (!s->valid) {
      if (victim < 0 || s_slots[victim].valid) victim = i;
      continue;
    }
    if (s->tile == tile && s->image == image && s->level == level) {
      s->stamp = s_clock;
      s_last_hit = i + 1;
      return s_pixels + (size_t)i * TILE_PIXELS;
    }
    if (victim < 0 ||
        (s_slots[victim].valid && s->stamp < s_slots[victim].stamp)) {
      victim = i;
    }
  }
  uint16_t *out = s_pixels + (size_t)victim * TILE_PIXELS;
  if (!decode_tile(img, lvl, tile, out)) {
    fill_error(out, 1 << (2 * img->tile_shift));
  }
  slot_t *s = &s_slots[victim];
  s->tile = tile;
  s->image = (uint16_t)image;
  s->level = (uint8_t)level;
  s->valid = 1;
  s->stamp = s_clock;
  s_last_hit = victim + 1;
  return out;
}

static int pick_level(const nn_image_t *img, int dst_w) {
  for (int i = 0; i < img->level_count; i++) {
    if (bundle_level(img, i)->width >= dst_w) return i;
  }
  return img->level_count - 1;
}

void image_draw(gfx_t *g, int image, nn_rect_t dst) {
  const nn_image_t *img = bundle_image(image);
  nn_rect_t c = nn_rect_intersect(dst, g->clip);
  if (nn_rect_empty(c)) return;
  if (img == NULL || img->tile_shift < 3 || img->tile_shift > MAX_TILE_SHIFT) {
    gfx_fill(g, c, ERROR_COLOR);
    return;
  }
  int level = pick_level(img, dst.w);
  const nn_level_t *lvl = bundle_level(img, level);
  if (lvl->width == 0 || lvl->height == 0) return;
  int shift = img->tile_shift, side = 1 << shift;
  bool transparent = img->flags & NN_IMGF_TRANSPARENT;

  /* 16.16 source position per destination pixel. */
  uint32_t sx_step = (uint32_t)(((uint64_t)lvl->width << 16) / (uint32_t)dst.w);
  uint32_t sy_step = (uint32_t)(((uint64_t)lvl->height << 16) / (uint32_t)dst.h);
  uint32_t sx_start = (uint32_t)(c.x - dst.x) * sx_step + sx_step / 2;
  uint32_t sy = (uint32_t)(c.y - dst.y) * sy_step + sy_step / 2;

  for (int y = c.y; y < c.y + c.h; y++, sy += sy_step) {
    uint32_t src_y = NN_MIN(sy >> 16, (uint32_t)lvl->height - 1);
    uint32_t tile_row = src_y >> shift;
    const uint16_t *row_base = NULL;
    uint32_t cached_col = UINT32_MAX;
    uint16_t *p = gfx_ptr(g, c.x, y);
    uint32_t sx = sx_start;
    for (int i = 0; i < c.w; i++, sx += sx_step) {
      uint32_t src_x = NN_MIN(sx >> 16, (uint32_t)lvl->width - 1);
      uint32_t col = src_x >> shift;
      if (col != cached_col) {
        const uint16_t *tile = tile_pixels(image, level, img, lvl,
                                           tile_row * lvl->tiles_x + col);
        row_base = tile + (src_y & (side - 1)) * side;
        cached_col = col;
      }
      uint16_t px = row_base[src_x & (side - 1)];
      if (!transparent || px != NN_TRANSPARENT_KEY) p[i] = px;
    }
  }
}
