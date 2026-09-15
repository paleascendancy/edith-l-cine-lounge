import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
let source = await readFile(indexPath, 'utf-8');

if (source.includes('[PAIRING] Código já solicitado; aguardando pareamento.')) {
  console.log('[PAIRING] Correção de código único já aplicada.');
  process.exit(0);
}

const oldBlock = `      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('Conexão encerrada.', shouldReconnect ? 'Reconectando...' : 'Sessão desconectada.');
      if (shouldReconnect) startEdith();`;

const newBlock = `      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const waitingForPairing = !state.creds.registered && pairingCodeRequested;

      if (waitingForPairing) {
        console.log('[PAIRING] Código já solicitado; aguardando pareamento.');
        return;
      }

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('Conexão encerrada.', shouldReconnect ? 'Reconectando...' : 'Sessão desconectada.');
      if (shouldReconnect) {
        setTimeout(() => startEdith(), 2500);
      }`;

if (!source.includes(oldBlock)) {
  throw new Error('Bloco de reconexão do WhatsApp não encontrado para aplicar correção de pareamento.');
}

source = source.replace(oldBlock, newBlock);
await writeFile(indexPath, source, 'utf-8');
console.log('[PAIRING] Código único por tentativa aplicado.');
