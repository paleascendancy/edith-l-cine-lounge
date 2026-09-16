import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
let source = await readFile(indexPath, 'utf-8');
let changed = false;

const stableClose = `      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const waitingForPairing = !state.creds.registered && pairingCodeRequested;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (waitingForPairing && shouldReconnect) {
        // O código já foi emitido. O transporte pode reconectar, mas não devemos
        // chamar requestPairingCode novamente, pois isso invalida o código anterior.
        console.log('[PAIRING] Preservando código atual durante reconexão.');
      }

      console.log('Conexão encerrada.', shouldReconnect ? 'Reconectando...' : 'Sessão desconectada.');
      if (shouldReconnect) {
        setTimeout(() => startEdith(), waitingForPairing ? 2500 : 3000);
      }`;

const baseClose = `      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('Conexão encerrada.', shouldReconnect ? 'Reconectando...' : 'Sessão desconectada.');
      if (shouldReconnect) startEdith();`;

const blockedClose = `      const statusCode = lastDisconnect?.error?.output?.statusCode;
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

const retryClose = `      const statusCode = lastDisconnect?.error?.output?.statusCode;
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

if (!source.includes(stableClose)) {
  for (const candidate of [baseClose, blockedClose, retryClose]) {
    if (source.includes(candidate)) {
      source = source.replace(candidate, stableClose);
      changed = true;
      break;
    }
  }
}

if (changed) {
  await writeFile(indexPath, source, 'utf-8');
  console.log('[PAIRING] Pareamento estável aplicado: um código é preservado entre reconexões.');
} else if (source.includes(stableClose)) {
  console.log('[PAIRING] Pareamento estável já aplicado.');
} else {
  console.log('[PAIRING] Bloco de conexão não reconhecido; inicialização mantida sem alteração.');
}
