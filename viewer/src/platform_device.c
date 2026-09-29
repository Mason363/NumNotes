/* Calculator platform: talks to the Epsilon kernel through supervisor calls.
 * The call numbers and argument layouts match the firmware's userland ABI. */
#include "app_main.h"
#include "keys.h"
#include "platform.h"

#define SVC_BACKLIGHT_BRIGHTNESS 1
#define SVC_BACKLIGHT_SET_BRIGHTNESS 2
#define SVC_BATTERY_IS_CHARGING 3
#define SVC_BATTERY_LEVEL 4
#define SVC_DISPLAY_PUSH_RECT 19
#define SVC_DISPLAY_PUSH_RECT_UNIFORM 20
#define SVC_DISPLAY_WAIT_FOR_V_BLANK 21
#define SVC_EVENTS_GET_EVENT 23
#define SVC_FLASH_ERASE_SECTOR 30
#define SVC_FLASH_WRITE_MEMORY 32
#define SVC_KEYBOARD_SCAN 34
#define SVC_POWER_SUSPEND 44
#define SVC_TIMING_MILLIS 48

#define EXTERNAL_FLASH_START 0x90000000u
#define EXTERNAL_FLASH_END 0x90800000u
#define KEY_HOME_BIT 6

/* Arguments go in r0-r3 and results come back in r0/r1, exactly like a
 * function call; the kernel reads and writes the stacked registers. */
#define SVC(num, a0, a1, a2, a3, out0, out1)                                  \
  do {                                                                        \
    register uint32_t r0 __asm__("r0") = (uint32_t)(a0);                      \
    register uint32_t r1 __asm__("r1") = (uint32_t)(a1);                      \
    register uint32_t r2 __asm__("r2") = (uint32_t)(a2);                      \
    register uint32_t r3 __asm__("r3") = (uint32_t)(a3);                      \
    __asm__ volatile("svc %[imm]"                                             \
                     : "+r"(r0), "+r"(r1), "+r"(r2), "+r"(r3)                 \
                     : [imm] "I"(num)                                         \
                     : "memory", "r12", "cc");                                \
    out0 = r0;                                                                \
    out1 = r1;                                                                \
  } while (0)

/* One function per call so the immediate is a compile-time constant. */
#define DEFINE_SVC(name, num)                                                 \
  static __attribute__((noinline)) uint64_t name(uint32_t a0, uint32_t a1,    \
                                                 uint32_t a2, uint32_t a3) {  \
    uint32_t lo, hi;                                                          \
    SVC(num, a0, a1, a2, a3, lo, hi);                                         \
    return ((uint64_t)hi << 32) | lo;                                         \
  }

DEFINE_SVC(svc_brightness, SVC_BACKLIGHT_BRIGHTNESS)
DEFINE_SVC(svc_set_brightness, SVC_BACKLIGHT_SET_BRIGHTNESS)
DEFINE_SVC(svc_charging, SVC_BATTERY_IS_CHARGING)
DEFINE_SVC(svc_battery, SVC_BATTERY_LEVEL)
DEFINE_SVC(svc_push_rect, SVC_DISPLAY_PUSH_RECT)
DEFINE_SVC(svc_push_uniform, SVC_DISPLAY_PUSH_RECT_UNIFORM)
DEFINE_SVC(svc_vblank, SVC_DISPLAY_WAIT_FOR_V_BLANK)
DEFINE_SVC(svc_get_event, SVC_EVENTS_GET_EVENT)
DEFINE_SVC(svc_erase, SVC_FLASH_ERASE_SECTOR)
DEFINE_SVC(svc_write, SVC_FLASH_WRITE_MEMORY)
DEFINE_SVC(svc_scan, SVC_KEYBOARD_SCAN)
DEFINE_SVC(svc_suspend, SVC_POWER_SUSPEND)
DEFINE_SVC(svc_millis, SVC_TIMING_MILLIS)

/* Rects are passed by value as four int16s packed into two registers. */
static uint32_t pack(int a, int b) {
  return ((uint32_t)(uint16_t)a) | ((uint32_t)(uint16_t)b << 16);
}

void nn_display_push(int x, int y, int w, int h, const uint16_t *pixels) {
  svc_push_rect(pack(x, y), pack(w, h), (uint32_t)pixels, 0);
}

void nn_display_fill(int x, int y, int w, int h, uint16_t color) {
  svc_push_uniform(pack(x, y), pack(w, h), color, 0);
}

void nn_display_wait_vblank(void) { svc_vblank(0, 0, 0, 0); }

uint32_t nn_millis(void) { return (uint32_t)svc_millis(0, 0, 0, 0); }

int nn_battery_level(void) { return (int)(svc_battery(0, 0, 0, 0) & 0xFF); }

bool nn_battery_charging(void) { return svc_charging(0, 0, 0, 0) & 0xFF; }

int nn_brightness(void) { return (int)(svc_brightness(0, 0, 0, 0) & 0xFF); }

void nn_set_brightness(int level) { svc_set_brightness((uint32_t)level, 0, 0, 0); }

bool nn_flash_erase_sector(uint32_t address) {
  /* External flash: 8 x 4K sectors, one 32K sector, then 64K sectors. */
  if ((address & 0xFFFF) != 0 || address < EXTERNAL_FLASH_START + 0x10000 ||
      address >= EXTERNAL_FLASH_END) {
    return false;
  }
  uint32_t sector = 8 + ((address - EXTERNAL_FLASH_START) >> 16);
  return svc_erase(sector, 1, 0, 0) & 0xFF;
}

bool nn_flash_write(uint32_t address, const void *data, uint32_t length) {
  if (address < EXTERNAL_FLASH_START || address + length > EXTERNAL_FLASH_END) {
    return false;
  }
  return svc_write(address, (uint32_t)data, length, 1) & 0xFF;
}

void nn_suspend(void) { svc_suspend(1, 0, 0, 0); }

static bool home_pressed(void) {
  return (svc_scan(0, 0, 0, 0) >> KEY_HOME_BIT) & 1;
}

static int next_event(int32_t timeout) {
  int32_t t = timeout;
  return (int)(svc_get_event((uint32_t)&t, 0, 0, 0) & 0xFF);
}

/* Provided by the linker (both NumWorks' installer and the NumNotes site). */
extern const uint8_t nn_content[];
extern const uint8_t nn_store[];
extern char _heap_start, _heap_end;
extern char _data_section_start_flash, _data_section_start_ram;
extern char _data_section_end_ram, _bss_section_start_ram, _bss_section_end_ram;

/* Keep both entry points global through link-time optimization: NumWorks'
 * start routine calls main, the NumNotes website's calls nn_start. */
#define ENTRY_POINT __attribute__((used, externally_visible))

ENTRY_POINT int main(int argc, char *argv[]) {
  (void)argc;
  (void)argv;
  app_boot(nn_content, 0x01000000u, nn_store, (uint32_t)nn_store, &_heap_start,
           &_heap_end);
  app_render();
  while (!app_exited()) {
    uint32_t now = nn_millis();
    uint32_t wake = app_tick(now);
    app_render();
    int32_t timeout = 60000;
    if (wake != UINT32_MAX) timeout = wake > now ? (int32_t)NN_MIN(wake - now, 60000u) : 0;
    int ev = next_event(timeout);
    if (ev == EV_HOME || home_pressed()) {
      app_exit();
      break;
    }
    app_event(ev, nn_millis());
    app_render();
  }
  return 0;
}

/* Entry point when the NumNotes website links the app itself (NumWorks'
 * installer uses its own start routine, which does the same). Epsilon calls
 * it like a function; returning goes back to the home screen. */
ENTRY_POINT void nn_start(void) {
  memcpy(&_data_section_start_ram, &_data_section_start_flash,
         (size_t)(&_data_section_end_ram - &_data_section_start_ram));
  memset(&_bss_section_start_ram, 0,
         (size_t)(&_bss_section_end_ram - &_bss_section_start_ram));
  main(0, NULL);
}
