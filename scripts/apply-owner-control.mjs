import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/index.js', import.meta.url);
let src = await readFile(path, 'utf-8');

if (src.includes('OWNER_GROUP_ACCESS_V5')) {
  console.log('[DONO] Owner/group/single-prefix V5 patch already applied.');
  process.exit(0);
}

const original = src;

function replaceRequired(label, before, after) {
  if (!src.includes(before)) {
    console.error(`[DONO] Could not locate ${label}.`);
    process.exit(1);
  }

  src = src.replace(before, after);
}

replaceRequired(
  'owner import',
  "import { initNoxRpg, isNoxCommand, handleNoxCommand } from './rpg/nox.js';",
  "import { initNoxRpg, isNoxCommand, handleNoxCommand } from './rpg/nox.js';\nimport { initOwnerControl, isGroupAllowed, handleOwnerCommand, getCommandPrefix, isBotOwner } from './owner.js';\nconst OWNER_GROUP_ACCESS_V5 = true;"
);

replaceRequired(
  'owner initialization',
  "    loadStickerMarks(),\n    initNoxRpg(authDir)",
  "    loadStickerMarks(),\n    initOwnerControl(authDir),\n    initNoxRpg(authDir)"
);

replaceRequired(
  'auto-accept group gate',
  "async function processBrazilJoinRequests(sock, jid) {\n  const settings = getSettings(jid);",
  "async function processBrazilJoinRequests(sock, jid) {\n  if (!isGroupAllowed(jid)) {\n    return { approved: 0, pending: 0, total: 0 };\n  }\n\n  const settings = getSettings(jid);"
);

replaceRequired(
  'welcome group gate',
  "  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {\n    if (action !== 'add') return;",
  "  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {\n    if (!isGroupAllowed(id)) return;\n    if (action !== 'add') return;"
);

const oldParseCommand = `function parseCommand(text) {
  const body = text.slice(config.prefix.length).trim();
  const firstSpace = body.indexOf(' ');

  if (firstSpace === -1) {
    return { command: body.toLowerCase(), args: '' };
  }

  return {
    command: body.slice(0, firstSpace).toLowerCase(),
    args: body.slice(firstSpace + 1).trim()
  };
}`;

const newParseCommand = `function parseCommand(text) {
  const prefix = getCommandPrefix(text);
  if (!prefix) return { command: '', args: '', prefix: '' };

  const body = text.slice(prefix.length).trim();
  const firstSpace = body.indexOf(' ');

  if (firstSpace === -1) {
    return { command: body.toLowerCase(), args: '', prefix };
  }

  return {
    command: body.slice(0, firstSpace).toLowerCase(),
    args: body.slice(firstSpace + 1).trim(),
    prefix
  };
}`;

replaceRequired('command parser', oldParseCommand, newParseCommand);

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

      if (!jid.endsWith('@g.us') && text) {
        const privatePrefix = getCommandPrefix(text);
        if (
          privatePrefix &&
          text.trim().toLowerCase() === \`${'${privatePrefix}'}adm\` &&
          await isBotOwner(sock, msg)
        ) {
          await send(sock, jid, adminMenuText(), msg);
          continue;
        }
      }

      if (jid.endsWith('@g.us') && !isGroupAllowed(jid)) {
        continue;
      }

      trackActivity(jid, msg);

      if (await handleAntiFlood(sock, jid, msg)) continue;

      if (!text) continue;`;

replaceRequired('message gate block', oldMessageBlock, newMessageBlock);

const oldTakeBlock = `      if (text.trim().toLowerCase() === 'take') {
        registerCommandUsage('take');
        await handleTake(sock, jid, msg);
        continue;
      }

`;

replaceRequired('prefixless take handler', oldTakeBlock, '');

replaceRequired(
  'command prefix gate',
  "      if (!text.startsWith(config.prefix)) continue;",
  "      if (!getCommandPrefix(text)) continue;"
);

replaceRequired(
  'take switch command',
  "        case 's':\n          await sendSticker(sock, jid, msg, args);\n          break;",
  "        case 'take':\n          await handleTake(sock, jid, msg);\n          break;\n\n        case 's':\n          await sendSticker(sock, jid, msg, args);\n          break;"
);

if (src === original || !src.includes('OWNER_GROUP_ACCESS_V5')) {
  console.error('[DONO] Owner/group/single-prefix V5 patch could not be applied.');
  process.exit(1);
}

await writeFile(path, src, 'utf-8');
console.log('[DONO] Owner/group access V5 applied with ! default and owner private adm.');
