import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/index.js', import.meta.url);
let src = await readFile(path, 'utf8');

if (!src.includes("from '../dist/v2/runtime.js'")) {
  const anchor = "import { config } from './config.js';";
  if (!src.includes(anchor)) throw new Error('[V2] Import anchor not found');
  src = src.replace(anchor, `${anchor}\nimport { initV2Runtime, observeV2Message, handleV2Command } from '../dist/v2/runtime.js';\nimport { grantVipDaysV2 } from './vip.js';`);
}

if (!src.includes('await initV2Runtime(authDir);')) {
  const anchor = '  const { state, saveCreds } = await useMultiFileAuthState(authDir);';
  if (!src.includes(anchor)) throw new Error('[V2] Startup anchor not found');
  src = src.replace(anchor, `  await initV2Runtime(authDir);\n${anchor}`);
}

if (!src.includes('observeV2Message({ sock, jid, msg')) {
  const anchor = `      const jid = msg.key.remoteJid;\n      if (!jid) continue;`;
  if (!src.includes(anchor)) throw new Error('[V2] Message jid anchor not found');
  src = src.replace(anchor, `${anchor}\n\n      await observeV2Message({\n        sock,\n        jid,\n        msg,\n        isGroupAllowed: !jid.endsWith('@g.us') || isGroupAllowed(jid)\n      }).catch((error) => console.error('[V2] Falha ao observar atividade:', error?.message || error));`);
}

if (!src.includes('await handleV2Command({')) {
  const anchor = `      if (text && await handleVipCommand(sock, jid, msg, text, { isOwner: messageOwner })) {\n        continue;\n      }`;
  if (!src.includes(anchor)) throw new Error('[V2] VIP anchor not found');
  src = src.replace(anchor, `${anchor}\n\n      if (text && await handleV2Command({\n        sock,\n        jid,\n        msg,\n        text,\n        prefix: config.prefix,\n        isOwner: messageOwner,\n        isVip: messageVip,\n        isGroupAllowed: !jid.endsWith('@g.us') || isGroupAllowed(jid),\n        grantVip: async (phone, days, operationKey) => {\n          await grantVipDaysV2(phone, days, operationKey);\n        }\n      })) {\n        continue;\n      }`);
}

await writeFile(path, src, 'utf8');
console.log('[V2] Runtime modular integrado ao roteador legado.');
