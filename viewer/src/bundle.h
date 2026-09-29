/* Read-only access to the content bundle built by the website. */
#ifndef NN_BUNDLE_H
#define NN_BUNDLE_H

#include "format.h"
#include "nn.h"

/* Validates the bundle; returns false if it's missing or corrupt. */
bool bundle_open(const uint8_t *data, uint32_t size);

const nn_header_t *bundle_header(void);
const nn_settings_t *bundle_settings(void);

/* NULL-safe: returns "" for offset 0 or an out-of-range offset. */
const char *bundle_string(uint32_t offset);
/* Pointer to `offset`, or NULL if [offset, offset+size) is out of range. */
const void *bundle_at(uint32_t offset, uint32_t size);

int bundle_section_count(void);
const nn_section_t *bundle_section(int index);
const nn_scene_t *bundle_scene(int index);
const nn_font_t *bundle_font(int index);
const nn_image_t *bundle_image(int index);
const nn_level_t *bundle_level(const nn_image_t *image, int level);
const nn_anim_t *bundle_anim(int index);
const nn_frame_t *bundle_frames(const nn_anim_t *anim);
const nn_item_t *bundle_items(const nn_scene_t *scene);
const nn_prim_t *bundle_prim(const nn_scene_t *scene, uint32_t index);
int bundle_search_count(void);
const nn_search_entry_t *bundle_search(int index);
int bundle_seed_note_count(void);
const char *bundle_seed_note(int index);

#endif
