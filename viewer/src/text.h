/* Fonts, UTF-8 and UI text. Fonts come pre-rasterized in the bundle. */
#ifndef NN_TEXT_H
#define NN_TEXT_H

#include "format.h"
#include "gfx.h"

/* Decodes one UTF-8 codepoint and advances *s. Invalid bytes decode as
 * U+FFFD. Returns 0 at the end of the string. */
unsigned utf8_next(const char **s);
/* Encodes cp into out (up to 4 bytes); returns the byte count. */
int utf8_encode(unsigned cp, char *out);
/* Byte length of the codepoint starting at s[0] (1 for invalid bytes). */
int utf8_len(const char *s);

/* Glyph index for a codepoint, or the font's fallback glyph. */
int font_glyph_index(const nn_font_t *font, unsigned codepoint);
const nn_glyph_t *font_glyph(const nn_font_t *font, int index);

/* Width in pixels of the first `bytes` bytes of s (-1: whole string). */
int text_width(int font, const char *s, int bytes);

/* Draws a string with its top-left at (x, y); returns the end x. */
int text_draw(gfx_t *g, int font, const char *s, int bytes, int x, int y,
              uint16_t color);
/* Draws a string clipped to max_w, adding an ellipsis if it doesn't fit. */
void text_draw_fit(gfx_t *g, int font, const char *s, int x, int y, int max_w,
                   uint16_t color);

/* Draws one glyph with the pen at (pen_x16 / 16, baseline) scaled by
 * zoom (16.16). */
void glyph_draw(gfx_t *g, const nn_font_t *font, int glyph, int pen_x16,
                int baseline, uint16_t color, int32_t zoom);

/* Finds how many bytes of s fit in max_w, breaking at spaces when possible.
 * Stops at '\n'. Returns the byte count of the line (excluding the break). */
int text_wrap(int font, const char *s, int max_w, int *next);

int font_line_height(int font);
int font_ascent(int font);

#endif
