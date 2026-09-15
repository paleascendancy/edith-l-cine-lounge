import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
let source = await readFile(indexPath, 'utf-8');

const oldDelay = '    }, 2000);';
if (source.includes(oldDelay)) source = source.replace(oldDelay, '    }, 350);');

const blockedPairingClose = `      const statusCode = lastDisconnect?.error?.output?.statusCode;
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

const restartAwareClose = `      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      const pairingPending = !state.creds.registered && Boolean(pairingNumber);

      if (pairingPending && shouldReconnect) {
        pairingCodeRequested = false;
        console.log('[PAIRING] Conexão reiniciada durante o pareamento; nova tentativa controlada em 5s.');
        setTimeout(() => startEdith(), 5000);
        return;
      }

      console.log('Conexão encerrada.', shouldReconnect ? 'Reconectando...' : 'Sessão desconectada.');
      if (shouldReconnect) {
        setTimeout(() => startEdith(), 2500);
      }`;

if (source.includes(blockedPairingClose)) {
  source = source.replace(blockedPairingClose, restartAwareClose);
} else if (!source.includes('[PAIRING] Conexão reiniciada durante o pareamento; nova tentativa controlada em 5s.')) {
  throw new Error('Não encontrei o bloco de reconexão esperado.');
}

await writeFile(indexPath, source, 'utf-8');
console.log('[PAIRING] Reinício controlado do pareamento aplicado.');
