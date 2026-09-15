import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../src/index.js', import.meta.url);
let source = await readFile(indexPath, 'utf-8');

const oldDelayBlock = `    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairingNumber);
        console.log(\`PAIRING_CODE=\${code}\`);
      } catch (error) {
        pairingCodeRequested = false;
        console.error('Falha ao gerar código de pareamento:', error?.message || error);
      }
    }, 2000);`;

const newDelayBlock = `    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairingNumber);
        console.log(\`PAIRING_CODE=\${code}\`);
      } catch (error) {
        pairingCodeRequested = false;
        console.error('Falha ao gerar código de pareamento:', error?.message || error);
      }
    }, 350);`;

if (source.includes(oldDelayBlock)) {
  source = source.replace(oldDelayBlock, newDelayBlock);
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

if (source.includes(oldBlock)) {
  source = source.replace(oldBlock, newBlock);
}

await writeFile(indexPath, source, 'utf-8');
console.log('[PAIRING] Código único + solicitação antecipada (350ms) aplicados.');
