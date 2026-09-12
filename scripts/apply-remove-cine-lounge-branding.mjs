import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const roots = [
  new URL('../src', import.meta.url).pathname,
  new URL('../dist', import.meta.url).pathname
];

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile() && /\.(?:js|mjs|ts)$/i.test(entry.name)) files.push(full);
  }
  return files;
}

let changed = 0;
for (const root of roots) {
  for (const file of await walk(root)) {
    let source = await readFile(file, 'utf8');
    const before = source;

    source = source
      .replaceAll(' • CINE LOUNGE CLUB', '')
      .replaceAll('CINE LOUNGE CLUB • PERFIL', 'PERFIL')
      .replaceAll('CINE LOUNGE CLUB', 'RIMURU-BOT')
      .replaceAll('Cine Lounge Club', 'Rimuru-Bot')
      .replaceAll('cine lounge club', 'Rimuru-Bot');

    if (source !== before) {
      await writeFile(file, source, 'utf8');
      changed += 1;
    }
  }
}

console.log(`[BRANDING] CINE LOUNGE CLUB removido das respostas do bot em ${changed} arquivo(s).`);
