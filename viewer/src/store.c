#include "store.h"

#include "mem.h"
#include "platform.h"

store_t g_store;

static const uint8_t *s_sector;
static uint32_t s_write_base;
static uint32_t s_project_id;
static uint32_t s_free; /* offset of the first unwritten byte in the log */

typedef struct {
  uint32_t magic;
  uint16_t type;
  uint16_t reserved;
  uint32_t length; /* payload bytes, multiple of 4 */
  uint32_t crc;    /* crc32 of the payload */
} record_t;

typedef struct {
  uint32_t project_id;
  uint16_t note_count;
  uint16_t bookmark_count;
  uint32_t notes_len; /* bytes of note text that follow the bookmarks */
} notes_head_t;

typedef struct {
  uint32_t project_id;
  nn_place_t place;
} place_rec_t;

uint32_t store_crc32(const void *data, uint32_t length, uint32_t crc) {
  static const uint32_t table[16] = {
      0x00000000, 0x1DB71064, 0x3B6E20C8, 0x26D930AC, 0x76DC4190, 0x6B6B51F4,
      0x4DB26158, 0x5005713C, 0xEDB88320, 0xF00F9344, 0xD6D6A3E8, 0xCB61B38C,
      0x9B64C2B0, 0x86D3D2D4, 0xA00AE278, 0xBDBDF21C};
  const uint8_t *p = data;
  crc = ~crc;
  for (uint32_t i = 0; i < length; i++) {
    crc ^= p[i];
    crc = (crc >> 4) ^ table[crc & 15];
    crc = (crc >> 4) ^ table[crc & 15];
  }
  return ~crc;
}

static uint32_t pad4(uint32_t n) { return (n + 3) & ~3u; }

static void load_notes(const uint8_t *payload, uint32_t length) {
  if (length < sizeof(notes_head_t)) return;
  const notes_head_t *head = (const notes_head_t *)payload;
  if (head->project_id != s_project_id || head->note_count > STORE_MAX_NOTES ||
      head->bookmark_count > STORE_MAX_BOOKMARKS ||
      head->notes_len > STORE_NOTES_CAP) {
    return;
  }
  uint32_t bookmarks_len = head->bookmark_count * sizeof(nn_place_t);
  if (sizeof(*head) + bookmarks_len + head->notes_len > length) return;
  memcpy(g_store.bookmarks, payload + sizeof(*head), bookmarks_len);
  g_store.bookmark_count = head->bookmark_count;
  memset(g_store.notes, 0, STORE_NOTES_CAP);
  memcpy(g_store.notes, payload + sizeof(*head) + bookmarks_len, head->notes_len);
  /* Trust only complete strings. */
  uint32_t len = head->notes_len;
  while (len > 0 && g_store.notes[len - 1] != 0) len--;
  int count = 0;
  for (uint32_t i = 0; i < len; i++) {
    if (g_store.notes[i] == 0) count++;
  }
  memset(g_store.notes + len, 0, STORE_NOTES_CAP - len);
  g_store.notes_len = len;
  g_store.note_count = NN_MIN(count, STORE_MAX_NOTES);
  g_store.from_flash = true;
}

static void scan_log(void) {
  uint32_t offset = 0;
  while (offset + sizeof(record_t) <= NN_STORE_SIZE) {
    const record_t *rec = (const record_t *)(s_sector + offset);
    if (rec->magic != STORE_MAGIC) break;
    if (rec->length > NN_STORE_SIZE - offset - sizeof(record_t) ||
        (rec->length & 3)) {
      break;
    }
    const uint8_t *payload = (const uint8_t *)(rec + 1);
    if (store_crc32(payload, rec->length, 0) == rec->crc) {
      if (rec->type == STORE_REC_NOTES) {
        load_notes(payload, rec->length);
      } else if (rec->type == STORE_REC_PLACE && rec->length >= sizeof(place_rec_t)) {
        const place_rec_t *p = (const place_rec_t *)payload;
        if (p->project_id == s_project_id) {
          g_store.last = p->place;
          g_store.has_last = true;
        }
      }
    }
    offset += sizeof(record_t) + rec->length;
  }
  s_free = offset;
  /* Anything but erased flash after the log means we must erase first. */
  if (offset + 4 <= NN_STORE_SIZE &&
      *(const uint32_t *)(s_sector + offset) != 0xFFFFFFFFu) {
    s_free = NN_STORE_SIZE;
  }
}

bool store_init(const uint8_t *sector, uint32_t write_base, uint32_t project_id) {
  memset(&g_store, 0, sizeof(g_store));
  g_store.notes = nn_alloc(STORE_NOTES_CAP);
  if (g_store.notes == NULL) return false;
  s_sector = sector;
  s_write_base = write_base;
  s_project_id = project_id;
  g_store.writable = sector != NULL;
  if (sector != NULL) scan_log();
  return true;
}

static bool write_chunk(uint32_t *at, const void *data, uint32_t length) {
  if (length == 0) return true;
  if (!nn_flash_write(s_write_base + *at, data, length)) return false;
  *at += length;
  return true;
}

static uint32_t notes_payload_len(void) {
  return sizeof(notes_head_t) + g_store.bookmark_count * sizeof(nn_place_t) +
         pad4(g_store.notes_len);
}

static bool write_notes(uint32_t *at) {
  notes_head_t head = {s_project_id, (uint16_t)g_store.note_count,
                       (uint16_t)g_store.bookmark_count, g_store.notes_len};
  uint32_t bookmarks_len = g_store.bookmark_count * sizeof(nn_place_t);
  uint32_t notes_len = pad4(g_store.notes_len); /* pool is zero past the end */
  record_t rec = {STORE_MAGIC, STORE_REC_NOTES, 0, notes_payload_len(), 0};
  rec.crc = store_crc32(&head, sizeof(head), 0);
  rec.crc = store_crc32(g_store.bookmarks, bookmarks_len, rec.crc);
  rec.crc = store_crc32(g_store.notes, notes_len, rec.crc);
  return write_chunk(at, &rec, sizeof(rec)) &&
         write_chunk(at, &head, sizeof(head)) &&
         write_chunk(at, g_store.bookmarks, bookmarks_len) &&
         write_chunk(at, g_store.notes, notes_len);
}

static bool write_place(uint32_t *at) {
  place_rec_t p = {s_project_id, g_store.last};
  record_t rec = {STORE_MAGIC, STORE_REC_PLACE, 0, sizeof(p), 0};
  rec.crc = store_crc32(&p, sizeof(p), 0);
  return write_chunk(at, &rec, sizeof(rec)) && write_chunk(at, &p, sizeof(p));
}

bool store_save(void) {
  bool notes = g_store.notes_dirty;
  bool place = g_store.place_dirty && g_store.has_last;
  if (!notes && !place) return true;
  if (!g_store.writable) return false;

  uint32_t needed = 0;
  if (notes) needed += sizeof(record_t) + notes_payload_len();
  if (place) needed += sizeof(record_t) + sizeof(place_rec_t);

  uint32_t at = s_free;
  if (s_free + needed > NN_STORE_SIZE) {
    /* Log full: start over with the complete current state. */
    if (!nn_flash_erase_sector(s_write_base)) {
      g_store.writable = false;
      return false;
    }
    at = 0;
    notes = g_store.from_flash || g_store.notes_dirty;
    place = g_store.has_last;
  }
  bool ok = (!notes || write_notes(&at)) && (!place || write_place(&at));
  s_free = at;
  if (!ok) {
    g_store.writable = false;
    s_free = NN_STORE_SIZE;
    return false;
  }
  if (notes) g_store.from_flash = true;
  g_store.notes_dirty = false;
  g_store.place_dirty = false;
  return true;
}

static int note_offset(int index) {
  int offset = 0;
  for (int i = 0; i < index; i++) {
    offset += (int)strlen(g_store.notes + offset) + 1;
  }
  return offset;
}

const char *store_note(int index) {
  if (index < 0 || index >= g_store.note_count) return "";
  return g_store.notes + note_offset(index);
}

int store_note_length(int index) { return (int)strlen(store_note(index)); }

uint32_t store_notes_free(void) {
  return STORE_NOTES_CAP - 4 - g_store.notes_len;
}

int store_note_add(const char *text) {
  uint32_t len = (uint32_t)strlen(text);
  if (g_store.note_count >= STORE_MAX_NOTES || len + 1 > store_notes_free()) {
    return -1;
  }
  memcpy(g_store.notes + g_store.notes_len, text, len + 1);
  g_store.notes_len += len + 1;
  g_store.notes_dirty = true;
  return g_store.note_count++;
}

void store_note_delete(int index) {
  if (index < 0 || index >= g_store.note_count) return;
  int offset = note_offset(index);
  int len = (int)strlen(g_store.notes + offset) + 1;
  memmove(g_store.notes + offset, g_store.notes + offset + len,
          g_store.notes_len - offset - len);
  g_store.notes_len -= len;
  memset(g_store.notes + g_store.notes_len, 0, len);
  g_store.note_count--;
  g_store.notes_dirty = true;
}

bool store_note_insert(int index, int offset, const char *text, int len) {
  if (index < 0 || index >= g_store.note_count || len <= 0) return false;
  if ((uint32_t)len > store_notes_free()) return false;
  int at = note_offset(index) + offset;
  memmove(g_store.notes + at + len, g_store.notes + at, g_store.notes_len - at);
  memcpy(g_store.notes + at, text, len);
  g_store.notes_len += len;
  g_store.notes_dirty = true;
  return true;
}

void store_note_erase(int index, int offset, int len) {
  if (index < 0 || index >= g_store.note_count || len <= 0) return;
  int at = note_offset(index) + offset;
  memmove(g_store.notes + at, g_store.notes + at + len,
          g_store.notes_len - at - len);
  g_store.notes_len -= len;
  memset(g_store.notes + g_store.notes_len, 0, len);
  g_store.notes_dirty = true;
}
