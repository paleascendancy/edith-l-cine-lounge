import { mkdir, readdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const authDir = process.env.AUTH_DIR || 'auth';
const marker = join(authDir, '.wa-auth-reset-v1');
const backupsDir = join(authDir, 'backups');

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

if (await exists(marker)) {
  console.log('[WA RESET] Reset já executado anteriormente; pulando.');
  process.exit(0);
}

await mkdir(authDir, { recursive: true });
await mkdir(backupsDir, { recursive: true });
const stamp = Date.now();
const backupDir = join(backupsDir, `wa-auth-reset-${stamp}`);
await mkdir(backupDir, { recursive: true });

const entries = await readdir(authDir, { withFileTypes: true });
const isWhatsAppAuthFile = (name) =>
  name === 'creds.json' ||
  name.startsWith('session-') ||
  name.startsWith('sender-key-') ||
  name.startsWith('pre-key-') ||
  name.startsWith('app-state-sync-key-') ||
  name.startsWith('app-state-sync-version-') ||
  name.startsWith('lid-mapping-') ||
  name.startsWith('device-list-');

let removed = 0;
for (const entry of entries) {
  if (!entry.isFile() || !isWhatsAppAuthFile(entry.name)) continue;
  const source = join(authDir, entry.name);
  const target = join(backupDir, entry.name);
  try {
    await copyFile(source, target);
  } catch {}
  await rm(source, { force: true });
  removed += 1;
}

await writeFile(marker, JSON.stringify({ at: new Date().toISOString(), removed, backupDir }, null, 2), 'utf-8');
console.log(`[WA RESET] Auth do WhatsApp resetada: ${removed} arquivos removidos após backup.`);
console.log(`[WA RESET] Backup: ${backupDir}`);
console.log('[WA RESET] Dados do bot (VIP, grupos, RPG, streaming) foram preservados.');
