/* Notes, bookmarks and the last position, persisted in the app's own 64 KiB
 * flash sector as an append-only log. The website can read the same sector
 * over USB (web/src/pack/store.ts parses this format). */
#ifndef NN_STORE_H
#define NN_STORE_H

#include "nn.h"

#define STORE_MAGIC 0x31534E4Eu /* "NNS1" */
#define STORE_NOTES_CAP 16384
#define STORE_MAX_NOTES 64
#define STORE_MAX_BOOKMARKS 24

enum { STORE_REC_NOTES = 1, STORE_REC_PLACE = 2 };

typedef struct {
  uint16_t section;
  uint16_t page;
  int32_t ox, oy;
  int32_t zoom;
} nn_place_t; /* 16 bytes */

typedef struct {
  /* Notes are NUL-terminated UTF-8 strings stored back to back. */
  char *notes;
  uint32_t notes_len;
  int note_count;
  nn_place_t bookmarks[STORE_MAX_BOOKMARKS];
  int bookmark_count;
  nn_place_t last;
  bool has_last;
  bool notes_dirty;
  bool place_dirty;
  bool writable;       /* false once the firmware refused a flash write */
  bool from_flash;     /* notes came from the store rather than the bundle */
} store_t;

extern store_t g_store;

/* Loads the store from `sector` (NN_STORE_SIZE bytes). `write_base` is the
 * address flash writes should target (the same as sector on the calculator). */
bool store_init(const uint8_t *sector, uint32_t write_base, uint32_t project_id);

/* Persists whatever changed. Returns false if nothing could be written. */
bool store_save(void);

/* Note editing helpers. Offsets are byte offsets inside a note. */
const char *store_note(int index);
int store_note_length(int index);
int store_note_add(const char *text); /* returns index or -1 */
void store_note_delete(int index);
bool store_note_insert(int index, int offset, const char *text, int len);
void store_note_erase(int index, int offset, int len);
uint32_t store_notes_free(void);

uint32_t store_crc32(const void *data, uint32_t length, uint32_t crc);

#endif
