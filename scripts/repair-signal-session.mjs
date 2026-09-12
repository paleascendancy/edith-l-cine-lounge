import { cp, mkdir, readdir, rm, stat, access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const authDir = process.env.AUTH_DIR || '/app/auth';
const marker = join(authDir, '.signal-repair-v1');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(authDir))) {
  console.log('[SIGNAL REPAIR] Auth dir not found; skipping.');
  process.exit(0);
}

if (await exists(marker)) {
  console.log('[SIGNAL REPAIR] Already applied; skipping.');
  process.exit(0);
}

const backupRoot = join(authDir, 'backups');
const backupDir = join(backupRoot, `signal-repair-${Date.now()}`);
await mkdir(backupDir, { recursive: true });

const entries = await readdir(authDir, { withFileTypes: true });
const targets = entries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) =>
    name.startsWith('session-') ||
    name.startsWith('sender-key-')
  );

for (const name of targets) {
  const src = join(authDir, name);
  const dst = join(backupDir, name);
  await cp(src, dst, { force: true });
}

for (const name of targets) {
  await rm(join(authDir, name), { force: true });
}

await writeFile(
  marker,
  JSON.stringify(
    {
      repairedAt: new Date().toISOString(),
      removed: targets,
      preservedCreds: await exists(join(authDir, 'creds.json'))
    },
    null,
    2
  ),
  'utf-8'
);

console.log(`[SIGNAL REPAIR] Cleared ${targets.length} Signal session files; creds.json preserved.`);
console.log(`[SIGNAL REPAIR] Backup: ${backupDir}`);
