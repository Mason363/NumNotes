# Builds the NumNotes viewer twice from the same sources:
#   make device  -> build/viewer.nwa  (relocatable ELF for the calculator)
#   make wasm    -> build/viewer.wasm (browser preview)
#   make install-web copies both into ../web/public/viewer/

ARM_PREFIX ?= $(shell command -v arm-none-eabi-gcc >/dev/null 2>&1 && echo arm-none-eabi- || \
  echo $(HOME)/.local/share/arm-gnu-toolchain-14.3.rel1-darwin-arm64-arm-none-eabi/bin/arm-none-eabi-)
CLANG ?= $(shell command -v /opt/homebrew/opt/llvm/bin/clang >/dev/null 2>&1 && \
  echo /opt/homebrew/opt/llvm/bin/clang || echo clang)
BUILD := build

COMMON_SRC := app.c bundle.c dct.c editor.c gfx.c image.c keys.c libc.c lz4.c \
  mem.c scene.c screens.c store.c text.c ui.c views.c
SRC := $(addprefix src/,$(COMMON_SRC))
HDR := $(wildcard src/*.h)

WARNINGS := -Wall -Wextra -Wshadow -Wdouble-promotion -Wno-unused-parameter

DEVICE_CFLAGS := -mthumb -mcpu=cortex-m7 -mfloat-abi=hard -mfpu=fpv5-sp-d16 \
  -std=c11 -Os -ffreestanding -fno-common -fno-builtin-printf \
  -fno-tree-loop-distribute-patterns -fno-unwind-tables \
  -fno-asynchronous-unwind-tables -fno-exceptions -fno-stack-protector \
  -flto -fno-fat-lto-objects -fwhole-program $(WARNINGS)
# One .text section keeps intra-app calls resolved, so the only relocations
# left for the installer are absolute data references.
DEVICE_LDFLAGS := -nostdlib -nostartfiles -Wl,--relocatable \
  -flinker-output=nolto-rel

WASM_CFLAGS := --target=wasm32 -std=c11 -O2 -ffreestanding -nostdlib \
  -fno-builtin-printf -mbulk-memory $(WARNINGS)
WASM_LDFLAGS := -Wl,--no-entry -Wl,--stack-first -Wl,-z,stack-size=131072 \
  -Wl,--initial-memory=1048576 -Wl,--max-memory=67108864 -Wl,--strip-all

.PHONY: all device wasm install-web clean test

all: device wasm

device: $(BUILD)/viewer.nwa
wasm: $(BUILD)/viewer.wasm

$(BUILD):
	mkdir -p $@

$(BUILD)/icon.nwi: tools/make_icon.mjs | $(BUILD)
	node tools/make_icon.mjs $@

$(BUILD)/app_sections.o: src/app_sections.S $(BUILD)/icon.nwi | $(BUILD)
	$(ARM_PREFIX)gcc -mthumb -mcpu=cortex-m7 -I$(BUILD) -c $< -o $@

DEVICE_OBJ := $(patsubst src/%.c,$(BUILD)/device/%.o,$(SRC) src/platform_device.c)

$(BUILD)/device/%.o: src/%.c $(HDR) Makefile
	@mkdir -p $(dir $@)
	$(ARM_PREFIX)gcc $(DEVICE_CFLAGS) -c $< -o $@

$(BUILD)/viewer.nwa: $(DEVICE_OBJ) $(BUILD)/app_sections.o
	$(ARM_PREFIX)gcc $(DEVICE_CFLAGS) $(DEVICE_LDFLAGS) $^ -lgcc -o $@
	$(ARM_PREFIX)objcopy --strip-debug --remove-section=.comment \
	  --remove-section='.ARM.exidx*' --remove-section='.ARM.extab*' \
	  --set-section-flags='.rodata.str*=alloc,load,readonly,data,contents' $@
	node tools/check_nwa.mjs $@

$(BUILD)/viewer.wasm: $(SRC) src/platform_wasm.c $(HDR) | $(BUILD)
	$(CLANG) $(WASM_CFLAGS) $(WASM_LDFLAGS) $(SRC) src/platform_wasm.c -o $@

# Codec cross-checks (C vs TypeScript) and a byte-for-byte comparison of the
# website's linker against GNU ld.
test: device
	ARM_GCC=$(ARM_PREFIX)gcc sh test/run_codec_test.sh
	node test/link_compare.mjs $(ARM_PREFIX)

install-web: device wasm
	mkdir -p ../web/public/viewer
	cp $(BUILD)/viewer.nwa $(BUILD)/viewer.wasm ../web/public/viewer/

clean:
	rm -rf $(BUILD)
