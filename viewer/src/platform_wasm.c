/* Browser preview platform: the same viewer compiled to WebAssembly. The page
 * feeds it keys and time and receives pixels (web/src/preview/). */
#include "app.h"
#include "app_main.h"
#include "platform.h"

#define IMPORT(name) __attribute__((import_module("env"), import_name(name)))
#define EXPORT(name) __attribute__((export_name(name)))

IMPORT("push_rect") void js_push_rect(int x, int y, int w, int h, const uint16_t *px);
IMPORT("fill_rect") void js_fill_rect(int x, int y, int w, int h, int color);
IMPORT("millis") uint32_t js_millis(void);
IMPORT("battery") int js_battery(void);
IMPORT("store_changed") void js_store_changed(void);

/* Same RAM budget as a real calculator, so previews behave the same. */
#define HEAP_SIZE (192 * 1024)
#define PAGE 65536

extern unsigned char __heap_base;
static uintptr_t s_brk = (uintptr_t)&__heap_base;
static int s_brightness = 192;

static void *grow_to(uintptr_t end) {
  uintptr_t have = __builtin_wasm_memory_size(0) * PAGE;
  if (end > have) {
    uintptr_t pages = (end - have + PAGE - 1) / PAGE;
    if (__builtin_wasm_memory_grow(0, pages) == (uintptr_t)-1) return NULL;
  }
  return (void *)end;
}

EXPORT("nn_alloc") void *wasm_alloc(uint32_t size) {
  uintptr_t p = (s_brk + 15) & ~(uintptr_t)15;
  if (!grow_to(p + size)) return NULL;
  s_brk = p + size;
  return (void *)p;
}

EXPORT("nn_boot") int wasm_boot(const uint8_t *bundle, uint32_t size, uint8_t *store) {
  uint8_t *heap = wasm_alloc(HEAP_SIZE);
  if (heap == NULL) return 0;
  bool ok = app_boot(bundle, size, store, (uint32_t)(uintptr_t)store, heap,
                     heap + HEAP_SIZE);
  app_render();
  return ok;
}

EXPORT("nn_event") void wasm_event(int ev, uint32_t now) {
  app_event(ev, now);
  app_render();
}

EXPORT("nn_tick") uint32_t wasm_tick(uint32_t now) {
  uint32_t wake = app_tick(now);
  app_render();
  return wake;
}

EXPORT("nn_exited") int wasm_exited(void) { return app_exited(); }

/* Lets the editor show the section/page being edited. */
EXPORT("nn_goto") void wasm_goto(int section, int page) {
  nn_place_t place = {(uint16_t)section, (uint16_t)page, 0, 0, 0};
  open_place(place, false);
  app_render();
}

void nn_display_push(int x, int y, int w, int h, const uint16_t *pixels) {
  js_push_rect(x, y, w, h, pixels);
}

void nn_display_fill(int x, int y, int w, int h, uint16_t color) {
  js_fill_rect(x, y, w, h, color);
}

void nn_display_wait_vblank(void) {}

uint32_t nn_millis(void) { return js_millis(); }

int nn_battery_level(void) { return js_battery(); }

bool nn_battery_charging(void) { return false; }

int nn_brightness(void) { return s_brightness; }

void nn_set_brightness(int level) { s_brightness = level; }

/* Emulates NOR flash: erase sets bits, writes can only clear them. */
bool nn_flash_erase_sector(uint32_t address) {
  memset((void *)(uintptr_t)address, 0xFF, NN_STORE_SIZE);
  js_store_changed();
  return true;
}

bool nn_flash_write(uint32_t address, const void *data, uint32_t length) {
  uint8_t *dst = (uint8_t *)(uintptr_t)address;
  const uint8_t *src = data;
  for (uint32_t i = 0; i < length; i++) dst[i] &= src[i];
  js_store_changed();
  return true;
}

void nn_suspend(void) {}
