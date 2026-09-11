import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/index.js', import.meta.url);
let src = await readFile(path, 'utf-8');

const oldBlock = `        default:\n          await send(\n            sock,\n            jid,\n            \`Comando *\${config.prefix}\${command}* ainda não foi ativado. Use *\${config.prefix}menu*.\`,\n            msg\n          );`;

const newBlock = `        default:\n          // Comandos inexistentes são ignorados silenciosamente.\n          break;`;

if (src.includes(oldBlock)) {
  src = src.replace(oldBlock, newBlock);
  await writeFile(path, src, 'utf-8');
  console.log('[COMMANDS] Unknown commands are now silent.');
} else if (src.includes('Comandos inexistentes são ignorados silenciosamente.')) {
  console.log('[COMMANDS] Silent unknown-command behavior already applied.');
} else {
  console.warn('[COMMANDS] Unknown-command response block was not found; no change applied.');
}
