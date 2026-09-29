// Links build/viewer.nwa with both GNU ld and web/src/nwa/link.ts and checks
// the images are byte-identical. Usage: node test/link_compare.mjs <ARM_PREFIX>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseElf } from '../../web/src/nwa/elf.ts';
import { linkNwa } from '../../web/src/nwa/link.ts';

const prefix = process.argv[2];
const dir = mkdtempSync(join(tmpdir(), 'nnlink-'));
const cases = [
  { flash: 0x90250000, ram: 0x24000000, ramEnd: 0x24030000 },
  { flash: 0x90400000, ram: 0x20000000, ramEnd: 0x20020000 },
];
for (const c of cases) {
  const script = `
MEMORY { FLASH (rx) : ORIGIN = ${c.flash}, LENGTH = 4M
         RAM (rwx) : ORIGIN = ${c.ram}, LENGTH = ${c.ramEnd - c.ram} }
ENTRY(nn_start);
SECTIONS {
  .eadk_app_info ORIGIN(FLASH) : {
    LONG(0xDEC0BEBA); KEEP(*(.rodata.eadk_api_level))
    LONG(ADDR(.rodata.eadk_app_name) - ORIGIN(FLASH)); LONG(SIZEOF(.rodata.eadk_app_icon));
    LONG(ADDR(.rodata.eadk_app_icon) - ORIGIN(FLASH)); LONG(nn_start - ORIGIN(FLASH));
    LONG(_eadk_app_end - ORIGIN(FLASH)); LONG(0xDEC0BEBA);
  } >FLASH
  .rodata.eadk_app_name : { KEEP(*(.rodata.eadk_app_name)) } >FLASH
  .rodata.eadk_app_icon : { KEEP(*(.rodata.eadk_app_icon)) } >FLASH
  .text : { . = ALIGN(4); *(.text) *(.text.*) } >FLASH
  .rodata : { *(.rodata) *(EXCLUDE_FILE(none) .rodata.[!n]*) *(.rodata.nn_content) } >FLASH
  .nn_store ALIGN(65536) : { *(.rodata.nn_store) _eadk_app_end = .; } >FLASH
  .data : { . = ALIGN(4); _data_section_start_flash = LOADADDR(.data); _data_section_start_ram = .;
            *(.data) *(.data.*) _data_section_end_ram = .; } >RAM AT >FLASH
  .bss : { . = ALIGN(4); _bss_section_start_ram = .; *(.bss) *(.bss.*) _bss_section_end_ram = .; } >RAM
  .heap : { _heap_start = .; . = (ORIGIN(RAM) + LENGTH(RAM)); _heap_end = .; } >RAM
}`;
  writeFileSync(join(dir, 'app.ld'), script);
  execFileSync(`${prefix}ld`, ['-T', join(dir, 'app.ld'), 'build/viewer.nwa', '-o', join(dir, 'app.elf')]);
  execFileSync(`${prefix}objcopy`, ['-O', 'binary', '--only-section=.eadk_app_info', '--only-section=.rodata*', '--only-section=.text', '--only-section=.nn_store', join(dir, 'app.elf'), join(dir, 'app.bin')]);
  const gnu = readFileSync(join(dir, 'app.bin'));
  const ours = linkNwa(parseElf(readFileSync('build/viewer.nwa')), { flashStart: c.flash, ramStart: c.ram, ramEnd: c.ramEnd }).image;
  if (gnu.length !== ours.length) throw new Error(`size differs: GNU ${gnu.length}, ours ${ours.length}`);
  for (let i = 0; i < gnu.length; i++) {
    if (gnu[i] !== ours[i]) throw new Error(`byte ${i.toString(16)} differs: GNU ${gnu[i]}, ours ${ours[i]}`);
  }
  console.log(`link at 0x${c.flash.toString(16)}: identical (${ours.length} bytes)`);
}
