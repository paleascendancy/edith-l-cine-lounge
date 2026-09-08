import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from './config.js';
import { menuText } from './commands/menu.js';

const logger = pino({ level: 'silent' });

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
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
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
      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      const text = getText(msg.message);
      if (!text.startsWith(config.prefix)) continue;

      const [rawCommand] = text.slice(config.prefix.length).trim().split(/\s+/);
      const command = rawCommand?.toLowerCase();

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
