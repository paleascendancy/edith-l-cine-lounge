import { readFile, writeFile } from 'node:fs/promises';

const ownerPath = new URL('../src/owner.js', import.meta.url);
let source = await readFile(ownerPath, 'utf-8');
const original = source;

if (!source.includes("'grupostatus'")) {
  source = source.replace(
    "    'statusgrupo',\n    'grupos',",
    "    'statusgrupo',\n    'grupostatus',\n    'grupos',"
  );
}

source = source.replace(
  "    `┃ ${command('statusgrupo')}\\n` +",
  "    `┃ ${command('grupostatus')} — status do grupo\\n` +"
);

source = source.replace(
  "  if (commandName === 'statusgrupo') {",
  "  if (commandName === 'statusgrupo' || commandName === 'grupostatus') {"
);

if (source !== original) {
  await writeFile(ownerPath, source, 'utf-8');
  console.log('[GRUPO] Alias !grupostatus e silêncio de acesso aplicados.');
} else {
  console.log('[GRUPO] Configuração de status do grupo já aplicada.');
}
