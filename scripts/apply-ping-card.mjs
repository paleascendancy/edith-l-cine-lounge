import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
let source = await readFile(indexPath, 'utf-8');

if (!source.includes("from './ping-card.js'")) {
  const anchor = "import { menuText, adminMenuText } from './commands/menu.js';";
  source = source.replace(anchor, `${anchor}\nimport { sendPingCard } from './ping-card.js';`);
}

const replacement = `        case 'ping': {\n          const rawTimestamp = Number(msg.messageTimestamp || 0);\n          const sentAtMs = rawTimestamp > 0 ? rawTimestamp * 1000 : Date.now();\n          const latency = Math.max(0, Date.now() - sentAtMs);\n          await sendPingCard(sock, jid, msg, latency);\n          break;\n        }`;

const pingBlock = /        case 'ping': \{[\s\S]*?\n        \}\n\n        case 's':/u;
if (!pingBlock.test(source)) {
  throw new Error('Não encontrei o bloco do comando ping para atualizar.');
}
source = source.replace(pingBlock, `${replacement}\n\n        case 's':`);

await writeFile(indexPath, source, 'utf-8');
console.log('[PING CARD] Rimuru ping card aplicado.');
