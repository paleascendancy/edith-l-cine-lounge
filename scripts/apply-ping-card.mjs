import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
let source = await readFile(indexPath, 'utf-8');

if (!source.includes("from './ping-card.js'")) {
  const anchor = "import { menuText, adminMenuText } from './commands/menu.js';";
  source = source.replace(anchor, `${anchor}\nimport { sendPingCard } from './ping-card.js';`);
}

const replacement = `        case 'ping': {\n          const rawTimestamp = Number(msg.messageTimestamp || 0);\n          const sentAtMs = rawTimestamp > 0 ? rawTimestamp * 1000 : Date.now();\n          const latency = Math.max(0, Date.now() - sentAtMs);\n          await sendPingCard(sock, jid, msg, latency);\n          break;\n        }\n\n`;

const start = source.indexOf("        case 'ping': {");
const end = source.indexOf("        case 's':", start);

if (start === -1 || end === -1 || end <= start) {
  throw new Error('Não encontrei os limites do comando ping para atualizar.');
}

source = `${source.slice(0, start)}${replacement}${source.slice(end)}`;

await writeFile(indexPath, source, 'utf-8');
console.log('[PING CARD] Rimuru ping card aplicado.');
