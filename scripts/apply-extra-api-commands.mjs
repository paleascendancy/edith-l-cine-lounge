import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/index.js', import.meta.url);
let src = await readFile(path, 'utf-8');

if (src.includes('EXTRA_API_COMMANDS_V1')) {
  console.log('[APIS] Extra commands patch already applied.');
  process.exit(0);
}

const original = src;

const noxImport = "import { initNoxRpg, isNoxCommand, handleNoxCommand } from './rpg/nox.js';";
if (!src.includes(noxImport)) {
  console.error('[APIS] Could not locate NOX import.');
  process.exit(1);
}

src = src.replace(
  noxImport,
  `${noxImport}\nimport { isNagatoroCommand, handleNagatoroCommand } from './services/nagatoro.js';\nconst EXTRA_API_COMMANDS_V1 = true;`
);

const commandGate = `      registerCommandUsage(command);\n\n      if (isNoxCommand(command)) {`;
const patchedGate = `      registerCommandUsage(command);\n\n      if (isNagatoroCommand(command)) {\n        await handleNagatoroCommand(sock, jid, msg, command, args);\n        continue;\n      }\n\n      if (isNoxCommand(command)) {`;

if (!src.includes(commandGate)) {
  console.error('[APIS] Could not locate command dispatch gate.');
  process.exit(1);
}

src = src.replace(commandGate, patchedGate);

if (src === original || !src.includes('EXTRA_API_COMMANDS_V1')) {
  console.error('[APIS] Extra commands patch could not be applied.');
  process.exit(1);
}

await writeFile(path, src, 'utf-8');
console.log('[APIS] Extra research and AI commands applied.');
