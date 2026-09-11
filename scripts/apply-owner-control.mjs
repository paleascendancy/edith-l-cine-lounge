import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/index.js', import.meta.url);
let src = await readFile(path, 'utf-8');

if (src.includes('OWNER_GROUP_ACCESS_V1')) {
  console.log('[DONO] Owner/group access patch already applied.');
  process.exit(0);
}

const original = src;

src = src.replace(
  "import { initNoxRpg, isNoxCommand, handleNoxCommand } from './rpg/nox.js';",
  "import { initNoxRpg, isNoxCommand, handleNoxCommand } from './rpg/nox.js';\nimport { initOwnerControl, isGroupAllowed, handleOwnerCommand } from './owner.js';\nconst OWNER_GROUP_ACCESS_V1 = true;"
);

src = src.replace(
  "    loadStickerMarks(),\n    initNoxRpg(authDir)",
  "    loadStickerMarks(),\n    initOwnerControl(authDir),\n    initNoxRpg(authDir)"
);

src = src.replace(
  "async function processBrazilJoinRequests(sock, jid) {\n  const settings = getSettings(jid);",
  "async function processBrazilJoinRequests(sock, jid) {\n  if (!isGroupAllowed(jid)) {\n    return { approved: 0, pending: 0, total: 0 };\n  }\n\n  const settings = getSettings(jid);"
);

src = src.replace(
  "  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {\n    if (action !== 'add') return;",
  "  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {\n    if (!isGroupAllowed(id)) return;\n    if (action !== 'add') return;"
);

const oldMessageBlock = `      const jid = msg.key.remoteJid;
      if (!jid) continue;

      trackActivity(jid, msg);

      if (await handleAntiFlood(sock, jid, msg)) continue;

      const text = getText(msg.message);
      if (!text) continue;`;

const newMessageBlock = `      const jid = msg.key.remoteJid;
      if (!jid) continue;

      const text = getText(msg.message);

      if (text && await handleOwnerCommand(sock, jid, msg, text)) {
        continue;
      }

      if (jid.endsWith('@g.us') && !isGroupAllowed(jid)) {
        continue;
      }

      trackActivity(jid, msg);

      if (await handleAntiFlood(sock, jid, msg)) continue;

      if (!text) continue;`;

if (!src.includes(oldMessageBlock)) {
  console.error('[DONO] Could not locate message gate block.');
  process.exit(1);
}

src = src.replace(oldMessageBlock, newMessageBlock);

if (src === original || !src.includes('OWNER_GROUP_ACCESS_V1')) {
  console.error('[DONO] Owner/group access patch could not be applied.');
  process.exit(1);
}

await writeFile(path, src, 'utf-8');
console.log('[DONO] Owner/group access patch applied.');
