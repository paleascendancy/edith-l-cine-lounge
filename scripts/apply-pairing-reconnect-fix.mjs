import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
let source = await readFile(indexPath, 'utf-8');
let changed = false;

const robustClose = `      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const pairingPending = !state.creds.registered && Boolean(pairingNumber);
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('[PAIRING DEBUG] conexão fechada', {
        statusCode: statusCode ?? 'unknown',
        registered: Boolean(state.creds.registered),
        pairingPending
      });

      if (pairingPending) {
        // Um código pertence ao socket que o gerou. Se esse socket morreu antes
        // do cadastro terminar, descarte o código e abra uma nova sessão de forma
        // controlada, inclusive quando o pré-login vier como loggedOut/401.
        pairingCodeRequested = false;
        console.log('[PAIRING] Socket de pré-autenticação encerrou; recriando sessão em 6s.');
        setTimeout(() => startEdith(), 6000);
        return;
      }

      console.log('Conexão encerrada.', shouldReconnect ? 'Reconectando...' : 'Sessão desconectada.');
      if (shouldReconnect) {
        setTimeout(() => startEdith(), 3000);
      }`;

const baseClose = `      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('Conexão encerrada.', shouldReconnect ? 'Reconectando...' : 'Sessão desconectada.');
      if (shouldReconnect) startEdith();`;

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

if (!source.includes(robustClose)) {
  for (const candidate of [stableClose, baseClose, blockedClose, retryClose]) {
    if (source.includes(candidate)) {
      source = source.replace(candidate, robustClose);
      changed = true;
      break;
    }
  }
}

if (changed) {
  await writeFile(indexPath, source, 'utf-8');
  console.log('[PAIRING] Recuperação de socket pré-auth aplicada.');
} else if (source.includes(robustClose)) {
  console.log('[PAIRING] Recuperação de socket pré-auth já aplicada.');
} else {
  console.log('[PAIRING] Bloco de conexão não reconhecido; inicialização mantida sem alteração.');
}
