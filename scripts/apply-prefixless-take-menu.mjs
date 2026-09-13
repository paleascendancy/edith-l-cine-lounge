import { readFile, writeFile } from 'node:fs/promises';

const menuPath = new URL('../src/v2/main-menu.ts', import.meta.url);
let src = await readFile(menuPath, 'utf8');

if (src.includes("command.name === 'take'")) {
  console.log('[TAKE MENU] take já está exibido sem prefixo no menu.');
  process.exit(0);
}

const legacyLine = "  return `┃ ◈ ${prefix}${displayName(command)}${args}${aliases}`;";
const compactLine = "  return `┃ ◈ ${prefix}${displayName(command)}${args}${description ? ` — ${description}` : ''}`;";
const takeLine = "  if (command.name === 'take') return '┃ ◈ take — sem prefixo';\n";

if (src.includes(legacyLine)) {
  src = src.replace(legacyLine, `${takeLine}${legacyLine}`);
} else if (src.includes(compactLine)) {
  src = src.replace(compactLine, `${takeLine}${compactLine}`);
} else {
  throw new Error('[TAKE MENU] formatCommand anchor not found');
}

await writeFile(menuPath, src, 'utf8');
console.log('[TAKE MENU] take exibido sem prefixo no menu.');
