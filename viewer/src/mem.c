#include "mem.h"

static uint8_t *s_cursor;
static uint8_t *s_end;

void nn_mem_init(void *start, void *end) {
  s_cursor = (uint8_t *)(((uintptr_t)start + 7) & ~(uintptr_t)7);
  s_end = (uint8_t *)end;
}

void *nn_alloc(size_t size) {
  size = (size + 7) & ~(size_t)7;
  if (size > nn_mem_available()) return NULL;
  void *p = s_cursor;
  s_cursor += size;
  memset(p, 0, size);
  return p;
}

size_t nn_mem_available(void) {
  return s_cursor < s_end ? (size_t)(s_end - s_cursor) : 0;
}
