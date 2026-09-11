import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/index.js', import.meta.url);
let src = await readFile(path, 'utf-8');

if (src.includes('DIRECT_SOURCE_COMMANDS_V1')) {
  console.log('[DIRECT] Direct-source commands patch already applied.');
  process.exit(0);
}

const original = src;

const nagatoroImport = "import { isNagatoroCommand, handleNagatoroCommand } from './services/nagatoro.js';";
if (!src.includes(nagatoroImport)) {
  console.error('[DIRECT] Could not locate Nagatoro import.');
  process.exit(1);
}

src = src.replace(
  nagatoroImport,
  `${nagatoroImport}\nimport { isDirectSourceCommand, handleDirectSourceCommand } from './services/direct-sources.js';\nconst DIRECT_SOURCE_COMMANDS_V1 = true;`
);

const gate = `      registerCommandUsage(command);\n\n      if (isNagatoroCommand(command)) {`;
const patchedGate = `      registerCommandUsage(command);\n\n      if (isDirectSourceCommand(command)) {\n        await handleDirectSourceCommand(sock, jid, msg, command, args);\n        continue;\n      }\n\n      if (isNagatoroCommand(command)) {`;

if (!src.includes(gate)) {
  console.error('[DIRECT] Could not locate command dispatch gate.');
  process.exit(1);
}

src = src.replace(gate, patchedGate);

if (src === original || !src.includes('DIRECT_SOURCE_COMMANDS_V1')) {
  console.error('[DIRECT] Direct-source commands patch could not be applied.');
  process.exit(1);
}

await writeFile(path, src, 'utf-8');
console.log('[DIRECT] Direct-source commands applied.');
