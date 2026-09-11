import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/index.js', import.meta.url);
let src = await readFile(path, 'utf-8');

if (src.includes('WHATSAPP_STABILITY_V1')) {
  console.log('[STABILITY] WhatsApp stability patch already applied.');
  process.exit(0);
}

const original = src;

const socketConfig = `  const sock = makeWASocket({\n    auth: state,\n    logger\n  });`;
const patchedSocketConfig = `  const WHATSAPP_STABILITY_V1 = true;\n  const sock = makeWASocket({\n    auth: state,\n    logger,\n    shouldSyncHistoryMessage: () => false\n  });`;

if (!src.includes(socketConfig)) {
  console.error('[STABILITY] Could not locate socket configuration.');
  process.exit(1);
}

src = src.replace(socketConfig, patchedSocketConfig);

if (src === original || !src.includes('WHATSAPP_STABILITY_V1')) {
  console.error('[STABILITY] WhatsApp stability patch could not be applied.');
  process.exit(1);
}

await writeFile(path, src, 'utf-8');
console.log('[STABILITY] WhatsApp stability patch applied.');
