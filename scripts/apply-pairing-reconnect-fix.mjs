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
        console.log('[PAIRING] Código emitido; aguardando pareamento sem regenerar a sessão.');
        return;
      }

      console.log('Conexão encerrada.', shouldReconnect ? 'Reconectando...' : 'Sessão desconectada.');
      if (shouldReconnect) {
        setTimeout(() => startEdith(), 3000);
      }`;

const currentBaseClose = `      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('Conexão encerrada.', shouldReconnect ? 'Reconectando...' : 'Sessão desconectada.');
      if (shouldReconnect) startEdith();`;

const legacyRobustClose = `      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const pairingPending = !state.creds.registered && Boolean(pairingNumber);
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('[PAIRING DEBUG] conexão fechada', {
        statusCode: statusCode ?? 'unknown',
        registered: Boolean(state.creds.registered),
        pairingPending
      });

      if (pairingPending) {
        pairingCodeRequested = false;
        console.log('[PAIRING] Socket de pré-autenticação encerrou; recriando sessão em 6s.');
        setTimeout(() => startEdith(), 6000);
        return;
      }

      console.log('Conexão encerrada.', shouldReconnect ? 'Reconectando...' : 'Sessão desconectada.');
      if (shouldReconnect) {
        setTimeout(() => startEdith(), 3000);
      }`;

if (!source.includes(robustClose)) {
  for (const candidate of [legacyRobustClose, currentBaseClose]) {
    if (source.includes(candidate)) {
      source = source.replace(candidate, robustClose);
      changed = true;
      break;
    }
  }
}

if (changed) {
  await writeFile(indexPath, source, 'utf-8');
  console.log('[PAIRING] Correção anti-loop de pareamento aplicada.');
} else if (source.includes(robustClose)) {
  console.log('[PAIRING] Correção anti-loop de pareamento já aplicada.');
} else {
  console.log('[PAIRING] Bloco de conexão não reconhecido; inicialização mantida sem alteração.');
}
