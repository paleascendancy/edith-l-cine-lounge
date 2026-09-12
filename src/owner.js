import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

const PRIMARY_OWNER_NUMBER = '559591722192';
const OWNER_DEDUP_MS = 5000;
const DEFAULT_PREFIX = '!';
const OWNER_STATE_VERSION = 4;
const MAX_PREFIX_LENGTH = 4;

let ownerFile = null;
const authorizedGroups = new Set();
const recentOwnerCommands = new Map();

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

function normalizePrefix(value = '') {
  const prefix = String(value).trim();

  if (!prefix || prefix.length > MAX_PREFIX_LENGTH || /\s/u.test(prefix)) {
    return null;
  }

  if (/[\p{L}\p{N}]/u.test(prefix)) {
    return null;
  }

  return prefix;
}

function currentPrefix() {
  return String(config.prefix || DEFAULT_PREFIX);
}

function command(name) {
  return `${currentPrefix()}${name}`;
}

function isDuplicateOwnerCommand(jid, msg, raw) {
  const sender =
    msg?.key?.participantAlt ||
    msg?.key?.participant ||
    (msg?.key?.fromMe ? 'fromMe' : '') ||
    jid;

  const key = `${jid}:${sender}:${String(raw).trim().toLowerCase()}`;
  const now = Date.now();
  const previous = recentOwnerCommands.get(key);

  if (previous && now - previous < OWNER_DEDUP_MS) {
    return true;
  }

  recentOwnerCommands.set(key, now);

  if (recentOwnerCommands.size > 100) {
    for (const [entry, timestamp] of recentOwnerCommands) {
      if (now - timestamp >= OWNER_DEDUP_MS) {
        recentOwnerCommands.delete(entry);
      }
    }
  }

  return false;
}

async function saveOwnerControl() {
  if (!ownerFile) return;

  await mkdir(join(ownerFile, '..'), { recursive: true }).catch(() => {});
  await writeFile(
    ownerFile,
    JSON.stringify(
      {
        version: OWNER_STATE_VERSION,
        authorizedGroups: [...authorizedGroups],
        prefix: currentPrefix()
      },
      null,
      2
    ),
    'utf-8'
  );
}

export async function initOwnerControl(authDir) {
  ownerFile = join(authDir, 'owner-control.json');
  config.prefix = DEFAULT_PREFIX;

  try {
    const raw = await readFile(ownerFile, 'utf-8');
    const saved = JSON.parse(raw);

    authorizedGroups.clear();
    for (const jid of saved?.authorizedGroups || []) {
      if (typeof jid === 'string' && jid.endsWith('@g.us')) {
        authorizedGroups.add(jid);
      }
    }

    // Migração V4: qualquer estado anterior é resetado uma única vez para "!".
    // Depois disso, se o dono trocar o prefixo, a escolha passa a persistir normalmente.
    if (Number(saved?.version) >= OWNER_STATE_VERSION) {
      const savedPrefix = normalizePrefix(saved?.prefix);
      if (savedPrefix) config.prefix = savedPrefix;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('Falha ao carregar controles do dono:', error?.message || error);
    }
  }

  await saveOwnerControl();
}

export function isGroupAllowed(jid = '') {
  return !String(jid).endsWith('@g.us') || authorizedGroups.has(String(jid));
}

export function getCommandPrefix(text = '') {
  const prefix = currentPrefix();
  return String(text).startsWith(prefix) ? prefix : '';
}

export function getCommandPrefixes() {
  return [currentPrefix()];
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
        // Se o WhatsApp não fornecer o mapeamento LID, tenta os outros IDs.
      }
    }
  }

  return numbers;
}

export async function isBotOwner(sock, msg) {
  if (msg?.key?.fromMe) return true;

  const numbers = await senderNumbers(sock, msg);
  const botNumber = jidDigits(sock?.user?.id);

  return numbers.has(PRIMARY_OWNER_NUMBER) ||
    Boolean(botNumber && numbers.has(botNumber));
}

async function send(sock, jid, text, msg) {
  await sock.sendMessage(jid, { text }, { quoted: msg });
}

function ownerMenu(sock) {
  const botNumber = formatNumber(sock?.user?.id);
  const prefix = currentPrefix();

  return (
    `╭━━━〔 👑 DONO • EDITH l 〕━━━╮\n` +
    `┃ Controle exclusivo do bot\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `*DONOS*\n` +
    `• ${formatNumber(PRIMARY_OWNER_NUMBER)}\n` +
    `• Bot: ${botNumber}\n\n` +
    `*GRUPOS*\n` +
    `${command('autorizar')} — libera o grupo atual\n` +
    `${command('desautorizar')} — bloqueia o grupo atual\n` +
    `${command('statusgrupo')} — mostra se o grupo está liberado\n` +
    `${command('grupos')} — lista os grupos liberados\n\n` +
    `*PREFIXO GLOBAL*\n` +
    `${command('prefixo')} — ver o prefixo atual\n` +
    `${command('prefixo')} . — trocar todos os comandos para .\n` +
    `${command('prefixo')} / — trocar todos os comandos para /\n\n` +
    `*BOT*\n` +
    `${command('donos')} — mostra os números donos\n` +
    `${command('botnumero')} — mostra o número da Edith\n` +
    `${command('dono')} — abre este painel\n\n` +
    `Prefixo atual: *${prefix}*\n` +
    `Todos os comandos usam o mesmo prefixo.`
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

async function handlePrefixCommand(sock, jid, msg, args = '') {
  const input = String(args).trim();

  if (!input) {
    await send(
      sock,
      jid,
      `⌨️ *PREFIXO DA EDITH*\n\nAtual: *${currentPrefix()}*\n\n` +
        `Para trocar todos os comandos de uma vez:\n` +
        `*${command('prefixo')} .*\n` +
        `*${command('prefixo')} /*\n` +
        `*${command('prefixo')} ?*`,
      msg
    );
    return;
  }

  const nextPrefix = normalizePrefix(input);

  if (!nextPrefix) {
    await send(
      sock,
      jid,
      '⚠️ Prefixo inválido. Use somente símbolos, sem espaços, com até 4 caracteres. Ex.: *!*, *.*, */*, *?* ou *!!*.',
      msg
    );
    return;
  }

  const oldPrefix = currentPrefix();
  config.prefix = nextPrefix;
  await saveOwnerControl();

  await send(
    sock,
    jid,
    `✅ *PREFIXO ALTERADO*\n\n*${oldPrefix}* → *${nextPrefix}*\n\n` +
      `Todos os comandos agora usam *${nextPrefix}*.\n` +
      `Ex.: *${nextPrefix}menu*, *${nextPrefix}adm*, *${nextPrefix}dono* e *${nextPrefix}autorizar*.*`,
    msg
  );
}

export async function handleOwnerCommand(sock, jid, msg, text = '') {
  const raw = String(text).trim();
  const prefix = getCommandPrefix(raw);
  if (!prefix) return false;

  const [head] = raw.split(/\s+/u);
  const commandName = head.slice(prefix.length).toLowerCase();
  const args = raw.slice(head.length).trim();
  const ownerCommands = new Set([
    'dono',
    'autorizar',
    'desautorizar',
    'statusgrupo',
    'grupos',
    'donos',
    'botnumero',
    'prefixo'
  ]);

  if (!ownerCommands.has(commandName)) return false;

  if (isDuplicateOwnerCommand(jid, msg, raw)) {
    return true;
  }

  if (!(await isBotOwner(sock, msg))) {
    return true;
  }

  if (commandName === 'dono') {
    await send(sock, jid, ownerMenu(sock), msg);
    return true;
  }

  if (commandName === 'prefixo') {
    await handlePrefixCommand(sock, jid, msg, args);
    return true;
  }

  if (commandName === 'donos') {
    await send(
      sock,
      jid,
      `👑 *NÚMEROS DONOS*\n\n• ${formatNumber(PRIMARY_OWNER_NUMBER)}\n• Bot: ${formatNumber(sock?.user?.id)}`,
      msg
    );
    return true;
  }

  if (commandName === 'botnumero') {
    await send(sock, jid, `🤖 Número da Edith: *${formatNumber(sock?.user?.id)}*`, msg);
    return true;
  }

  if (commandName === 'grupos') {
    await send(sock, jid, await listAuthorizedGroups(sock), msg);
    return true;
  }

  if (!String(jid).endsWith('@g.us')) {
    await send(sock, jid, '⚠️ Esse comando precisa ser usado dentro do grupo.', msg);
    return true;
  }

  if (commandName === 'autorizar') {
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

  if (commandName === 'desautorizar') {
    authorizedGroups.delete(jid);
    await saveOwnerControl();
    await send(
      sock,
      jid,
      `🔒 *GRUPO DESAUTORIZADO*\nA Edith l ficará em silêncio neste grupo até um dono usar *${command('autorizar')}*.`,
      msg
    );
    return true;
  }

  if (commandName === 'statusgrupo') {
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
