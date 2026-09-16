import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
let source = await readFile(indexPath, 'utf-8');
let changed = false;

// Pairing code should be requested quickly after the socket is created.
if (source.includes('    }, 2000);')) {
  source = source.replace('    }, 2000);', '    }, 350);');
  changed = true;
}

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
  changed = true;
}

// This patch runs after several other runtime patches. Never crash the service
// just because another patch already changed the same reconnect block.
if (changed) {
  await writeFile(indexPath, source, 'utf-8');
  console.log('[PAIRING] Patch de pareamento aplicado com segurança.');
} else {
  console.log('[PAIRING] Nenhuma alteração necessária; inicialização continuará normalmente.');
}
