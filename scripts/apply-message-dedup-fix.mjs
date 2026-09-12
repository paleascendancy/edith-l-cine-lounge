import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/index.js', import.meta.url);
let source = await readFile(path, 'utf-8');

const before = `  const participant =\n    msg?.key?.participant ||\n    msg?.key?.participantAlt ||\n    '';\n\n  const dedupKey = \`${'${jid}'}:${'${participant}'}:${'${id}'}\`;`;
const after = `  // O mesmo evento pode chegar com participant/participantAlt diferentes.\n  // O ID da mensagem já é único dentro do chat e evita respostas duplicadas.\n  const dedupKey = \`${'${jid}'}:${'${id}'}\`;`;

if (source.includes(before)) {
  source = source.replace(before, after);
  await writeFile(path, source, 'utf-8');
  console.log('[DEDUP] Respostas duplicadas corrigidas.');
} else if (source.includes("const dedupKey = `${jid}:${id}`;")) {
  console.log('[DEDUP] Correção já aplicada.');
} else {
  console.error('[DEDUP] Bloco de deduplicação não encontrado.');
  process.exit(1);
}
