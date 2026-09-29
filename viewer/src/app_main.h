/* Entry points used by the platform layers. */
#ifndef NN_APP_MAIN_H
#define NN_APP_MAIN_H

#include "nn.h"

/* `store` is the 64 KiB notes sector as mapped in memory (may be NULL);
 * `store_base` is the address to pass to nn_flash_* for its first byte. */
bool app_boot(const uint8_t *bundle, uint32_t size, const uint8_t *store,
              uint32_t store_base, void *heap, void *heap_end);
void app_event(int ev, uint32_t now);
/* Runs timers; returns when to call again (absolute ms, UINT32_MAX: never). */
uint32_t app_tick(uint32_t now);
void app_render(void);
/* Saves state and makes app_exited() true. */
void app_exit(void);
bool app_exited(void);

#endif
