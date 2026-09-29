#include "bundle.h"

static const uint8_t *s_data;
static uint32_t s_size;
static const nn_header_t *s_header;

_Static_assert(sizeof(nn_header_t) == 64, "header layout");
_Static_assert(sizeof(nn_settings_t) == 40, "settings layout");
_Static_assert(sizeof(nn_section_t) == 32, "section layout");
_Static_assert(sizeof(nn_scene_t) == 32, "scene layout");
_Static_assert(sizeof(nn_prim_t) == 16, "prim layout");
_Static_assert(sizeof(nn_prim_rect_t) == 24, "rect layout");
_Static_assert(sizeof(nn_prim_text_t) == 24, "text layout");
_Static_assert(sizeof(nn_prim_line_t) == 36, "line layout");
_Static_assert(sizeof(nn_item_t) == 20, "item layout");
_Static_assert(sizeof(nn_font_t) == 20, "font layout");
_Static_assert(sizeof(nn_glyph_t) == 16, "glyph layout");
_Static_assert(sizeof(nn_image_t) == 16, "image layout");
_Static_assert(sizeof(nn_level_t) == 16, "level layout");
_Static_assert(sizeof(nn_anim_t) == 12, "anim layout");
_Static_assert(sizeof(nn_search_entry_t) == 20, "search layout");

const void *bundle_at(uint32_t offset, uint32_t size) {
  if (offset == 0 || offset > s_size || size > s_size - offset) return NULL;
  return s_data + offset;
}

static bool table_ok(uint32_t offset, uint32_t count, uint32_t item_size) {
  return count == 0 || bundle_at(offset, count * item_size) != NULL;
}

bool bundle_open(const uint8_t *data, uint32_t size) {
  s_data = data;
  s_size = size;
  s_header = NULL;
  if (data == NULL || size < sizeof(nn_header_t) || ((uintptr_t)data & 3)) {
    return false;
  }
  const nn_header_t *h = (const nn_header_t *)data;
  if (h->magic != NN_BUNDLE_MAGIC || h->version != NN_BUNDLE_VERSION ||
      h->size > size) {
    return false;
  }
  s_size = h->size;
  if (!bundle_at(h->settings, sizeof(nn_settings_t)) ||
      !table_ok(h->sections, h->section_count, sizeof(nn_section_t)) ||
      !table_ok(h->fonts, h->font_count, sizeof(nn_font_t)) ||
      !table_ok(h->images, h->image_count, sizeof(nn_image_t)) ||
      !table_ok(h->anims, h->anim_count, sizeof(nn_anim_t)) ||
      !table_ok(h->scenes, h->scene_count, sizeof(nn_scene_t)) ||
      !table_ok(h->search, h->search_count, sizeof(nn_search_entry_t)) ||
      h->font_count == 0) {
    return false;
  }
  s_header = h;
  return true;
}

const nn_header_t *bundle_header(void) { return s_header; }

const nn_settings_t *bundle_settings(void) {
  return (const nn_settings_t *)(s_data + s_header->settings);
}

const char *bundle_string(uint32_t offset) {
  const char *s = bundle_at(offset, 1);
  if (s == NULL) return "";
  /* Make sure the string terminates inside the bundle. */
  for (uint32_t i = offset; i < s_size; i++) {
    if (s_data[i] == 0) return s;
  }
  return "";
}

int bundle_section_count(void) { return s_header->section_count; }

const nn_section_t *bundle_section(int index) {
  if (index < 0 || index >= s_header->section_count) return NULL;
  return (const nn_section_t *)(s_data + s_header->sections) + index;
}

const nn_scene_t *bundle_scene(int index) {
  if (index < 0 || index >= s_header->scene_count) return NULL;
  const nn_scene_t *scene = (const nn_scene_t *)(s_data + s_header->scenes) + index;
  if (!table_ok(scene->prims, scene->prim_count, 4) ||
      !table_ok(scene->items, scene->item_count, sizeof(nn_item_t))) {
    return NULL;
  }
  return scene;
}

const nn_font_t *bundle_font(int index) {
  if (index < 0 || index >= s_header->font_count) index = 0;
  return (const nn_font_t *)(s_data + s_header->fonts) + index;
}

const nn_image_t *bundle_image(int index) {
  if (index < 0 || index >= s_header->image_count) return NULL;
  const nn_image_t *image = (const nn_image_t *)(s_data + s_header->images) + index;
  if (image->level_count == 0 ||
      !table_ok(image->levels, image->level_count, sizeof(nn_level_t))) {
    return NULL;
  }
  return image;
}

const nn_level_t *bundle_level(const nn_image_t *image, int level) {
  level = NN_CLAMP(level, 0, image->level_count - 1);
  return (const nn_level_t *)(s_data + image->levels) + level;
}

const nn_anim_t *bundle_anim(int index) {
  if (index < 0 || index >= s_header->anim_count) return NULL;
  const nn_anim_t *anim = (const nn_anim_t *)(s_data + s_header->anims) + index;
  if (anim->frame_count == 0 ||
      !table_ok(anim->frames, anim->frame_count, sizeof(nn_frame_t))) {
    return NULL;
  }
  return anim;
}

const nn_frame_t *bundle_frames(const nn_anim_t *anim) {
  return (const nn_frame_t *)(s_data + anim->frames);
}

const nn_item_t *bundle_items(const nn_scene_t *scene) {
  return (const nn_item_t *)(s_data + scene->items);
}

const nn_prim_t *bundle_prim(const nn_scene_t *scene, uint32_t index) {
  if (index >= scene->prim_count) return NULL;
  uint32_t offset = ((const uint32_t *)(s_data + scene->prims))[index];
  const nn_prim_t *prim = bundle_at(offset, sizeof(nn_prim_t));
  if (prim == NULL || prim->size < sizeof(nn_prim_t) ||
      !bundle_at(offset, prim->size)) {
    return NULL;
  }
  return prim;
}

int bundle_search_count(void) { return s_header->search_count; }

const nn_search_entry_t *bundle_search(int index) {
  return (const nn_search_entry_t *)(s_data + s_header->search) + index;
}

int bundle_seed_note_count(void) {
  const nn_notes_t *notes = bundle_at(s_header->notes, sizeof(nn_notes_t));
  if (notes == NULL || !bundle_at(s_header->notes, 4 + 4u * notes->count)) {
    return 0;
  }
  return notes->count;
}

const char *bundle_seed_note(int index) {
  const nn_notes_t *notes = (const nn_notes_t *)(s_data + s_header->notes);
  return bundle_string(notes->note[index]);
}
