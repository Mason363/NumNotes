/* Everything the viewer needs from the outside world. Implemented by
 * platform_device.c (calculator), platform_wasm.c (browser preview) and
 * test/platform_host.c (native tests). */
#ifndef NN_PLATFORM_H
#define NN_PLATFORM_H

#include "nn.h"

void nn_display_push(int x, int y, int w, int h, const uint16_t *pixels);
void nn_display_fill(int x, int y, int w, int h, uint16_t color);
void nn_display_wait_vblank(void);

uint32_t nn_millis(void);

/* Battery charge from 0 (empty) to 3 (full). */
int nn_battery_level(void);
bool nn_battery_charging(void);

int nn_brightness(void);
void nn_set_brightness(int level);

/* Flash access for the notes store. `address` is a real (mapped) address
 * inside the store sector. Returns false if the firmware refused. */
bool nn_flash_erase_sector(uint32_t address);
bool nn_flash_write(uint32_t address, const void *data, uint32_t length);

void nn_suspend(void);

#endif
