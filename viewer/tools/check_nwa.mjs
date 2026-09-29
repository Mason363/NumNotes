// Sanity checks for build/viewer.nwa: the website patches and links this file
// in the browser, so its shape must match what web/src/nwa expects.
import { readFileSync } from 'node:fs';
import { parseElf, SHF_ALLOC, SHN_UNDEF, SHT_NOBITS } from '../../web/src/nwa/elf.ts';
import { linkNwa } from '../../web/src/nwa/link.ts';

const path = process.argv[2];
const elf = parseElf(readFileSync(path));
const fail = (msg) => {
  console.error(`check_nwa: ${msg}`);
  process.exit(1);
};

const alloc = elf.sections.filter((s) => s.flags & SHF_ALLOC);
const rodata = alloc.filter((s) => s.name.startsWith('.rodata.'));
for (const name of ['.rodata.eadk_app_name', '.rodata.eadk_app_icon', '.rodata.eadk_api_level', '.rodata.nn_content', '.rodata.nn_store']) {
  if (!rodata.some((s) => s.name === name)) fail(`missing ${name}`);
}
for (const name of ['main', 'nn_start']) {
  if (!elf.symbols.some((s) => s.name === name && s.bind === 1 && s.shndx !== SHN_UNDEF)) fail(`${name} must be a global symbol`);
}
const unexpected = alloc.filter((s) => !/^\.(text|rodata|data|bss)(\.|$)/.test(s.name));
if (unexpected.length) fail(`unexpected sections: ${unexpected.map((s) => s.name).join(', ')}`);
const data = alloc.filter((s) => s.name.startsWith('.data') && s.size > 0);
if (data.length) fail(`initialized globals are not allowed (${data.map((s) => s.name).join(', ')})`);

const undefinedSymbols = elf.symbols.filter((s) => s.index > 0 && s.shndx === SHN_UNDEF && s.name).map((s) => s.name);
const types = new Map();
for (const list of elf.relocations.values()) for (const r of list) types.set(r.type, (types.get(r.type) ?? 0) + 1);

const result = linkNwa(elf, { flashStart: 0x90250000, ramStart: 0x24000000, ramEnd: 0x24030000 });
const size = (name) => alloc.filter((s) => s.name.startsWith(name)).reduce((n, s) => n + s.size, 0);
console.log(
  `viewer.nwa: text ${size('.text')} B, rodata ${size('.rodata') - 65536} B, bss ${alloc
    .filter((s) => s.type === SHT_NOBITS)
    .reduce((n, s) => n + s.size, 0)} B, app ${result.appSize} B`,
);
console.log(`  relocations: ${[...types].map(([t, n]) => `type ${t} x${n}`).join(', ')}`);
console.log(`  linker-provided symbols: ${undefinedSymbols.join(', ') || 'none'}`);
