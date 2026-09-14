import { readFile, writeFile } from 'node:fs/promises';

const target = new URL('../src/index.js', import.meta.url);
const source = await readFile(target, 'utf8');

const before = `      host === 'instagram.com' ||
      host.endsWith('.instagram.com') ||
      host === 'tiktok.com' ||
      host.endsWith('.tiktok.com')`;

const after = `      host === 'instagram.com' ||
      host.endsWith('.instagram.com') ||
      host === 'tiktok.com' ||
      host.endsWith('.tiktok.com') ||
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtu.be'`;

if (source.includes(after)) {
  console.log('Anti-link do YouTube já está aplicado.');
  process.exit(0);
}

if (!source.includes(before)) {
  throw new Error(
    'Não foi possível localizar com segurança a regra de Instagram/TikTok no src/index.js.'
  );
}

const patched = source.replace(before, after);
await writeFile(target, patched, 'utf8');

console.log('Anti-link atualizado: Instagram, TikTok e YouTube.');
