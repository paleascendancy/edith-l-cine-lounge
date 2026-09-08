import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from './config.js';
import { menuText } from './commands/menu.js';

const logger = pino({ level: 'silent' });
const authDir = process.env.AUTH_DIR || 'auth';
const pairingNumber = (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, '');
let pairingCodeRequested = false;

function getText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ''
  ).trim();
}

async function startEdith() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: !pairingNumber
  });

  if (!state.creds.registered && pairingNumber && !pairingCodeRequested) {
    pairingCodeRequested = true;
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairingNumber);
        console.log(`PAIRING_CODE=${code}`);
      } catch (error) {
        pairingCodeRequested = false;
        console.error('Falha ao gerar código de pareamento:', error?.message || error);
      }
    }, 2000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      pairingCodeRequested = false;
      console.log(`${config.botName} conectada ao WhatsApp.`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('Conexão encerrada.', shouldReconnect ? 'Reconectando...' : 'Sessão desconectada.');
      if (shouldReconnect) startEdith();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;

      const jid = msg.key.remoteJid;
      const text = getText(msg.message);
      if (!text.startsWith(config.prefix)) continue;

      const [rawCommand] = text.slice(config.prefix.length).trim().split(/\s+/);
      const command = rawCommand?.toLowerCase();
      if (!command) continue;

      switch (command) {
        case 'menu':
        case 'ajuda':
          await sock.sendMessage(jid, { text: menuText() }, { quoted: msg });
          break;

        case 'ping':
          await sock.sendMessage(jid, { text: '🏓 Pong! Edith l está funcionando.' }, { quoted: msg });
          break;

        default:
          await sock.sendMessage(jid, {
            text: `Comando *${config.prefix}${command}* ainda não foi ativado. Use *${config.prefix}menu*.`
          }, { quoted: msg });
      }
    }
  });
}

startEdith().catch((error) => {
  console.error('Falha ao iniciar Edith l:', error);
  process.exit(1);
});
