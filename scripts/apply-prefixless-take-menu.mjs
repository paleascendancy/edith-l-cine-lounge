import { readFile, writeFile } from 'node:fs/promises';

const menuPath = new URL('../src/v2/main-menu.ts', import.meta.url);
let src = await readFile(menuPath, 'utf8');

const oldLine = "  return `┃ ◈ ${prefix}${displayName(command)}${args}${aliases}`;";
const newBlock = "  if (command.name === 'take') return `┃ ◈ take  ·  sem prefixo`;\n  return `┃ ◈ ${prefix}${displayName(command)}${args}${aliases}`;";

if (src.includes(oldLine)) {
  src = src.replace(oldLine, newBlock);
} else if (!src.includes("command.name === 'take'")) {
  throw new Error('[TAKE MENU] formatCommand anchor not found');
}

await writeFile(menuPath, src, 'utf8');
console.log('[TAKE MENU] take exibido sem prefixo no menu.');
