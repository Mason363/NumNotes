/* A bump allocator over the RAM the firmware gives the app. Everything is
 * allocated once at boot; nothing is ever freed. */
#ifndef NN_MEM_H
#define NN_MEM_H

#include "nn.h"

void nn_mem_init(void *start, void *end);
void *nn_alloc(size_t size);
size_t nn_mem_available(void);

#endif
