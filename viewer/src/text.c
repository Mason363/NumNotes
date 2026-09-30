#include "text.h"

#include "bundle.h"

unsigned utf8_next(const char **s) {
  const uint8_t *p = (const uint8_t *)*s;
  unsigned c = p[0];
  if (c == 0) return 0;
  int len = utf8_len(*s);
  unsigned cp;
  if (len == 1) {
    cp = c < 0x80 ? c : 0xFFFD;
  } else {
    cp = c & (0xFF >> (len + 1));
    for (int i = 1; i < len; i++) cp = (cp << 6) | (p[i] & 0x3F);
  }
  *s += len;
  return cp;
}

int utf8_len(const char *s) {
  const uint8_t *p = (const uint8_t *)s;
  int len = p[0] < 0x80 ? 1 : p[0] < 0xC2 ? 0 : p[0] < 0xE0 ? 2 : p[0] < 0xF0 ? 3
          : p[0] < 0xF5 ? 4 : 0;
  if (len == 0) return 1;
  for (int i = 1; i < len; i++) {
    if ((p[i] & 0xC0) != 0x80) return 1;
  }
  return len;
}

int utf8_encode(unsigned cp, char *out) {
  if (cp < 0x80) {
    out[0] = (char)cp;
    return 1;
  }
  if (cp < 0x800) {
    out[0] = (char)(0xC0 | (cp >> 6));
    out[1] = (char)(0x80 | (cp & 0x3F));
    return 2;
  }
  if (cp < 0x10000) {
    out[0] = (char)(0xE0 | (cp >> 12));
    out[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
    out[2] = (char)(0x80 | (cp & 0x3F));
    return 3;
  }
  out[0] = (char)(0xF0 | (cp >> 18));
  out[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
  out[2] = (char)(0x80 | ((cp >> 6) & 0x3F));
  out[3] = (char)(0x80 | (cp & 0x3F));
  return 4;
}

static const nn_glyph_t *glyph_table(const nn_font_t *font) {
  return bundle_at(font->glyphs, font->glyph_count * sizeof(nn_glyph_t));
}

int font_glyph_index(const nn_font_t *font, unsigned codepoint) {
  const nn_glyph_t *glyphs = glyph_table(font);
  if (glyphs == NULL) return -1;
  int lo = 0, hi = font->glyph_count - 1;
  while (lo <= hi) {
    int mid = (lo + hi) >> 1;
    if (glyphs[mid].codepoint == codepoint) return mid;
    if (glyphs[mid].codepoint < codepoint) lo = mid + 1;
    else hi = mid - 1;
  }
  return font->fallback < font->glyph_count ? font->fallback : -1;
}

const nn_glyph_t *font_glyph(const nn_font_t *font, int index) {
  const nn_glyph_t *glyphs = glyph_table(font);
  if (glyphs == NULL || index < 0 || index >= font->glyph_count) return NULL;
  return glyphs + index;
}

int font_line_height(int font) { return bundle_font(font)->line_height; }
int font_ascent(int font) { return bundle_font(font)->ascent; }

void glyph_draw(gfx_t *g, const nn_font_t *font, int glyph, int pen_x16,
                int baseline, uint16_t color, int32_t zoom) {
  const nn_glyph_t *gl = font_glyph(font, glyph);
  if (gl == NULL || gl->w == 0 || gl->h == 0) return;
  uint32_t stride = ((uint32_t)gl->w * font->bpp + 7) / 8;
  const uint8_t *bits = bundle_at(font->bitmaps + gl->bitmap, stride * gl->h);
  if (bits == NULL) return;
  nn_rect_t dst;
  if (zoom == 65536) {
    dst.x = (pen_x16 + 8) / 16 + gl->bx;
    dst.y = baseline - gl->by;
    dst.w = gl->w;
    dst.h = gl->h;
  } else {
    /* pen_x16 and baseline are already in screen space; scale the offsets.
     * Edges are rounded once, from sixteenths, so spacing stays even. */
    int x0 = (pen_x16 + (int)(((int64_t)gl->bx * zoom) >> 12) + 8) >> 4;
    int y0 = baseline - (int)(((int64_t)gl->by * zoom + 32768) >> 16);
    int x1 = (pen_x16 + (int)(((int64_t)(gl->bx + gl->w) * zoom) >> 12) + 8) >> 4;
    int y1 = y0 + (int)(((int64_t)gl->h * zoom + 32768) >> 16);
    dst.x = x0;
    dst.y = y0;
    dst.w = NN_MAX(x1 - x0, 1);
    dst.h = NN_MAX(y1 - y0, 1);
  }
  gfx_mask(g, dst, bits, gl->w, gl->h, font->bpp, color);
}

int text_width(int font_index, const char *s, int bytes) {
  const nn_font_t *font = bundle_font(font_index);
  const char *end = bytes < 0 ? NULL : s + bytes;
  int w16 = 0;
  while (*s && (end == NULL || s < end)) {
    unsigned cp = utf8_next(&s);
    const nn_glyph_t *gl = font_glyph(font, font_glyph_index(font, cp));
    if (gl) w16 += gl->advance;
  }
  return (w16 + 15) / 16;
}

int text_draw(gfx_t *g, int font_index, const char *s, int bytes, int x, int y,
              uint16_t color) {
  const nn_font_t *font = bundle_font(font_index);
  const char *end = bytes < 0 ? NULL : s + bytes;
  int pen16 = x * 16;
  int baseline = y + font->ascent;
  bool visible = y < g->clip.y + g->clip.h && y + font->line_height > g->clip.y;
  while (*s && (end == NULL || s < end)) {
    unsigned cp = utf8_next(&s);
    int index = font_glyph_index(font, cp);
    const nn_glyph_t *gl = font_glyph(font, index);
    if (gl == NULL) continue;
    if (visible && cp != ' ') {
      glyph_draw(g, font, index, pen16, baseline, color, 65536);
    }
    pen16 += gl->advance;
  }
  return (pen16 + 15) / 16;
}

void text_draw_fit(gfx_t *g, int font, const char *s, int x, int y, int max_w,
                   uint16_t color) {
  if (text_width(font, s, -1) <= max_w) {
    text_draw(g, font, s, -1, x, y, color);
    return;
  }
  const char *ellipsis = "\xE2\x80\xA6"; /* … */
  int budget = max_w - text_width(font, ellipsis, -1);
  const char *p = s;
  while (*p) {
    int len = utf8_len(p);
    if (text_width(font, s, (int)(p - s) + len) > budget) break;
    p += len;
  }
  int end = text_draw(g, font, s, (int)(p - s), x, y, color);
  text_draw(g, font, ellipsis, -1, end, y, color);
}

int text_wrap(int font_index, const char *s, int max_w, int *next) {
  const nn_font_t *font = bundle_font(font_index);
  const char *p = s;
  int w16 = 0, limit16 = max_w * 16;
  int last_break = -1;
  while (*p && *p != '\n') {
    const char *before = p;
    unsigned cp = utf8_next(&p);
    const nn_glyph_t *gl = font_glyph(font, font_glyph_index(font, cp));
    int adv = gl ? gl->advance : 0;
    if (w16 + adv > limit16 && before > s) {
      if (cp == ' ') {
        *next = (int)(p - s);
        return (int)(before - s);
      }
      if (last_break > 0) {
        *next = last_break + 1;
        return last_break;
      }
      *next = (int)(before - s);
      return (int)(before - s);
    }
    if (cp == ' ') last_break = (int)(before - s);
    w16 += adv;
  }
  *next = (int)(p - s) + (*p == '\n' ? 1 : 0);
  return (int)(p - s);
}
