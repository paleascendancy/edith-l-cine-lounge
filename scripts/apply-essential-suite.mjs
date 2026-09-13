import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/index.js', import.meta.url);
let src = await readFile(path, 'utf8');

if (src.includes('ESSENTIAL_SUITE_V1')) {
  console.log('[ESSENTIAL] Runtime integration already applied.');
  process.exit(0);
}

function replaceRequired(label, before, after) {
  if (!src.includes(before)) {
    console.error(`[ESSENTIAL] Could not locate ${label}.`);
    process.exit(1);
  }
  src = src.replace(before, after);
}

const configImport = "import { config } from './config.js';";
replaceRequired(
  'config import',
  configImport,
  `${configImport}\nimport { initProAccess, isProUser } from './pro.js';\nimport { initEssentialSuite, isEssentialCommand, handleEssentialCommand, observeEssentialMessage, handleEssentialParticipantUpdate } from './services/essential-suite.js';\nconst ESSENTIAL_SUITE_V1 = true;`
);

if (src.includes('    initVipAccess(authDir),')) {
  src = src.replace(
    '    initVipAccess(authDir),',
    '    initVipAccess(authDir),\n    initProAccess(authDir),\n    initEssentialSuite(authDir),'
  );
} else if (src.includes('    loadStickerMarks(),')) {
  src = src.replace(
    '    loadStickerMarks(),',
    '    loadStickerMarks(),\n    initProAccess(authDir),\n    initEssentialSuite(authDir),'
  );
} else {
  console.error('[ESSENTIAL] Could not locate startup initialization.');
  process.exit(1);
}

const vipIdentity = '      const messageVip = messageOwner ? false : await isVipUser(sock, msg);';
if (src.includes(vipIdentity)) {
  src = src.replace(
    vipIdentity,
    `      const messagePro = messageOwner ? true : await isProUser(sock, msg);\n      const messageVip = messageOwner ? false : (messagePro || await isVipUser(sock, msg));`
  );
} else if (!src.includes('const messagePro =')) {
  console.error('[ESSENTIAL] Could not locate VIP identity block.');
  process.exit(1);
}

const ownerHandler = `      if (text && await handleOwnerCommand(sock, jid, msg, text)) {\n        continue;\n      }`;
if (src.includes(ownerHandler)) {
  src = src.replace(
    ownerHandler,
    `      if (await observeEssentialMessage({\n        sock,\n        jid,\n        msg,\n        text,\n        isGroupAllowed: !jid.endsWith('@g.us') || isGroupAllowed(jid)\n      })) {\n        continue;\n      }\n\n${ownerHandler}`
  );
} else if (!src.includes('await observeEssentialMessage({')) {
  console.error('[ESSENTIAL] Could not locate owner handler for observer integration.');
  process.exit(1);
}

const v2Anchor = `      if (text && await handleV2Command({`;
if (src.includes(v2Anchor)) {
  const suiteBlock = `      if (text) {\n        const essentialPrefix = getCommandPrefix(text);\n        if (essentialPrefix) {\n          const essentialParsed = parseCommand(text);\n          if (isEssentialCommand(essentialParsed.command)) {\n            const essentialHandled = await handleEssentialCommand({\n              sock,\n              jid,\n              msg,\n              command: essentialParsed.command,\n              args: essentialParsed.args,\n              prefix: essentialParsed.prefix || essentialPrefix,\n              isOwner: messageOwner,\n              isVip: messageVip,\n              isPro: messagePro,\n              isGroupAllowed: !jid.endsWith('@g.us') || isGroupAllowed(jid)\n            });\n            if (essentialHandled) {\n              continue;\n            }\n          }\n        }\n      }\n\n`;
  src = src.replace(v2Anchor, suiteBlock + v2Anchor);
} else if (!src.includes('const essentialHandled = await handleEssentialCommand')) {
  console.error('[ESSENTIAL] Could not locate V2 command anchor.');
  process.exit(1);
}

const callListener = `  sock.ev.on('call', async (calls) => {`;
if (src.includes(callListener)) {
  const participantListener = `  sock.ev.on('group-participants.update', async (update) => {\n    try {\n      await handleEssentialParticipantUpdate({\n        sock,\n        ...update,\n        isGroupAllowed: !String(update?.id || '').endsWith('@g.us') || isGroupAllowed(update.id)\n      });\n    } catch (error) {\n      console.error('[ESSENTIAL] Participant listener:', error?.message || error);\n    }\n  });\n\n`;
  src = src.replace(callListener, participantListener + callListener);
} else if (!src.includes("[ESSENTIAL] Participant listener")) {
  console.error('[ESSENTIAL] Could not locate call listener.');
  process.exit(1);
}

await writeFile(path, src, 'utf8');
console.log('[ESSENTIAL] Free/VIP/Pro suite integrated into legacy + V2 runtime.');
