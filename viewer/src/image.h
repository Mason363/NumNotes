/* Tiled image decoding with a small LRU cache of decoded tiles. */
#ifndef NN_IMAGE_H
#define NN_IMAGE_H

#include "gfx.h"

/* Pixels with this value in decoded palette tiles are transparent. The
 * website never emits it as a real color. */
#define NN_TRANSPARENT_KEY 0x0020

/* Allocates the tile cache from the arena, using up to `budget` bytes. */
bool image_init(size_t budget);

/* Draws the whole image stretched onto dst (screen coordinates, may extend
 * past the screen), clipped to the band. */
void image_draw(gfx_t *g, int image, nn_rect_t dst);

/* Forgets decoded tiles (e.g. after the store sector was rewritten). */
void image_flush(void);

#endif
