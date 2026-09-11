import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PRIMARY_OWNER_NUMBER = '559591722192';

let ownerFile = null;
const authorizedGroups = new Set();

function jidDigits(value = '') {
  return String(value)
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');
}

function formatNumber(digits = '') {
  const clean = jidDigits(digits);

  if (clean.startsWith('55')) {
    const local = clean.slice(2);
    const ddd = local.slice(0, 2);
    const number = local.slice(2);

    if (number.length === 9) {
      return `+55 ${ddd} ${number.slice(0, 5)}-${number.slice(5)}`;
    }

    if (number.length === 8) {
      return `+55 ${ddd} ${number.slice(0, 4)}-${number.slice(4)}`;
    }
  }

  return clean ? `+${clean}` : 'indisponível';
}

async function saveOwnerControl() {
  if (!ownerFile) return;

  await mkdir(join(ownerFile, '..'), { recursive: true }).catch(() => {});
  await writeFile(
    ownerFile,
    JSON.stringify(
      {
        version: 1,
        authorizedGroups: [...authorizedGroups]
      },
      null,
      2
    ),
    'utf-8'
  );
}

export async function initOwnerControl(authDir) {
  ownerFile = join(authDir, 'owner-control.json');

  try {
    const raw = await readFile(ownerFile, 'utf-8');
    const saved = JSON.parse(raw);

    for (const jid of saved?.authorizedGroups || []) {
      if (typeof jid === 'string' && jid.endsWith('@g.us')) {
        authorizedGroups.add(jid);
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('Falha ao carregar controles do dono:', error?.message || error);
    }
  }
}

export function isGroupAllowed(jid = '') {
  return !String(jid).endsWith('@g.us') || authorizedGroups.has(String(jid));
}

async function senderNumbers(sock, msg) {
  const candidates = [
    msg?.key?.participantAlt,
    msg?.key?.participant,
    msg?.key?.remoteJid
  ].filter(Boolean);

  const numbers = new Set();

  for (const candidate of candidates) {
    const value = String(candidate);
    const direct = jidDigits(value);

    if (direct && !value.endsWith('@lid')) {
      numbers.add(direct);
    }

    if (value.endsWith('@lid')) {
      try {
        const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(value);
        const mappedDigits = jidDigits(mapped);
        if (mappedDigits) numbers.add(mappedDigits);
      } catch {
        // Se o WhatsApp não fornecer o mapeamento LID, tenta os outros IDs da mensagem.
      }
    }
  }

  return numbers;
}

export async function isBotOwner(sock, msg) {
  if (msg?.key?.fromMe) return true;

  const numbers = await senderNumbers(sock, msg);
  const botNumber = jidDigits(sock?.user?.id);

  if (botNumber) numbers.add(botNumber);

  return numbers.has(PRIMARY_OWNER_NUMBER) ||
    [...numbers].some((number) => botNumber && number === botNumber);
}

async function send(sock, jid, text, msg) {
  await sock.sendMessage(jid, { text }, { quoted: msg });
}

function ownerMenu(sock) {
  const botNumber = formatNumber(sock?.user?.id);

  return (
    `╭━━━〔 👑 DONO • EDITH l 〕━━━╮\n` +
    `┃ Controle exclusivo do bot\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `*DONOS*\n` +
    `• ${formatNumber(PRIMARY_OWNER_NUMBER)}\n` +
    `• Bot: ${botNumber}\n\n` +
    `*GRUPOS*\n` +
    `.autorizar — libera o grupo atual\n` +
    `.desautorizar — bloqueia o grupo atual\n` +
    `.statusgrupo — mostra se o grupo está liberado\n` +
    `.grupos — lista os grupos liberados\n\n` +
    `*BOT*\n` +
    `.donos — mostra os números donos\n` +
    `.botnumero — mostra o número da Edith\n` +
    `.dono — abre este painel\n\n` +
    `Grupos não autorizados são ignorados pela Edith.`
  );
}

async function listAuthorizedGroups(sock) {
  const groups = [...authorizedGroups];

  if (!groups.length) {
    return '🔒 Nenhum grupo está autorizado no momento.';
  }

  const lines = [];

  for (let index = 0; index < groups.length; index += 1) {
    const groupJid = groups[index];
    let name = groupJid;

    try {
      const metadata = await sock.groupMetadata(groupJid);
      name = metadata?.subject || groupJid;
    } catch {
      // Mantém o JID quando o grupo não estiver acessível.
    }

    lines.push(`${index + 1}. *${name}*`);
  }

  return `✅ *GRUPOS AUTORIZADOS*\n\n${lines.join('\n')}`;
}

export async function handleOwnerCommand(sock, jid, msg, text = '') {
  const raw = String(text).trim();
  if (!raw.startsWith('.')) return false;

  const [head] = raw.split(/\s+/);
  const command = head.slice(1).toLowerCase();
  const ownerCommands = new Set([
    'dono',
    'autorizar',
    'desautorizar',
    'statusgrupo',
    'grupos',
    'donos',
    'botnumero'
  ]);

  if (!ownerCommands.has(command)) return false;

  if (!(await isBotOwner(sock, msg))) {
    // Comandos de dono são silenciosos para quem não é dono.
    return true;
  }

  if (command === 'dono') {
    await send(sock, jid, ownerMenu(sock), msg);
    return true;
  }

  if (command === 'donos') {
    await send(
      sock,
      jid,
      `👑 *NÚMEROS DONOS*\n\n• ${formatNumber(PRIMARY_OWNER_NUMBER)}\n• Bot: ${formatNumber(sock?.user?.id)}`,
      msg
    );
    return true;
  }

  if (command === 'botnumero') {
    await send(sock, jid, `🤖 Número da Edith: *${formatNumber(sock?.user?.id)}*`, msg);
    return true;
  }

  if (command === 'grupos') {
    await send(sock, jid, await listAuthorizedGroups(sock), msg);
    return true;
  }

  if (!String(jid).endsWith('@g.us')) {
    await send(sock, jid, '⚠️ Esse comando precisa ser usado dentro do grupo.', msg);
    return true;
  }

  if (command === 'autorizar') {
    authorizedGroups.add(jid);
    await saveOwnerControl();

    let name = 'este grupo';
    try {
      name = (await sock.groupMetadata(jid))?.subject || name;
    } catch {}

    await send(
      sock,
      jid,
      `✅ *GRUPO AUTORIZADO*\nA Edith l agora funcionará em *${name}*.`,
      msg
    );
    return true;
  }

  if (command === 'desautorizar') {
    authorizedGroups.delete(jid);
    await saveOwnerControl();
    await send(
      sock,
      jid,
      '🔒 *GRUPO DESAUTORIZADO*\nA Edith l ficará em silêncio neste grupo até um dono usar *.autorizar*.',
      msg
    );
    return true;
  }

  if (command === 'statusgrupo') {
    await send(
      sock,
      jid,
      `🔐 Grupo: *${authorizedGroups.has(jid) ? 'AUTORIZADO' : 'NÃO AUTORIZADO'}*`,
      msg
    );
    return true;
  }

  return true;
}
