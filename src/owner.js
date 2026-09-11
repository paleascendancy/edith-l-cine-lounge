import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

const PRIMARY_OWNER_NUMBER = '559591722192';
const OWNER_DEDUP_MS = 5000;
const DEFAULT_PREFIXES = ['!'];
const MAX_PREFIXES = 8;
const MAX_PREFIX_LENGTH = 4;

let ownerFile = null;
const authorizedGroups = new Set();
const recentOwnerCommands = new Map();
const commandPrefixes = new Set(DEFAULT_PREFIXES);

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

function parsePrefixList(value = '') {
  const parsed = String(value)
    .split(/[\s,]+/u)
    .map((item) => normalizePrefix(item))
    .filter(Boolean);

  return [...new Set(parsed)];
}

function syncPrimaryPrefix() {
  const [primary = '!'] = commandPrefixes;
  config.prefix = primary;
}

function prefixSummary() {
  return [...commandPrefixes]
    .map((prefix, index) => `${index === 0 ? '⭐' : '•'} *${prefix}*`)
    .join('\n');
}

async function saveOwnerControl() {
  if (!ownerFile) return;

  await mkdir(join(ownerFile, '..'), { recursive: true }).catch(() => {});
  await writeFile(
    ownerFile,
    JSON.stringify(
      {
        version: 2,
        authorizedGroups: [...authorizedGroups],
        prefixes: [...commandPrefixes]
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

    authorizedGroups.clear();
    for (const jid of saved?.authorizedGroups || []) {
      if (typeof jid === 'string' && jid.endsWith('@g.us')) {
        authorizedGroups.add(jid);
      }
    }

    const savedPrefixes = Array.isArray(saved?.prefixes)
      ? saved.prefixes.map((item) => normalizePrefix(item)).filter(Boolean)
      : [];

    commandPrefixes.clear();
    for (const prefix of [...new Set(savedPrefixes)].slice(0, MAX_PREFIXES)) {
      commandPrefixes.add(prefix);
    }

    if (!commandPrefixes.size) {
      commandPrefixes.add('!');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('Falha ao carregar controles do dono:', error?.message || error);
    }

    if (!commandPrefixes.size) {
      commandPrefixes.add('!');
    }
  }

  syncPrimaryPrefix();
}

export function isGroupAllowed(jid = '') {
  return !String(jid).endsWith('@g.us') || authorizedGroups.has(String(jid));
}

export function getCommandPrefix(text = '') {
  const value = String(text);
  const prefixes = [...commandPrefixes].sort((a, b) => b.length - a.length);
  return prefixes.find((prefix) => value.startsWith(prefix)) || '';
}

export function getCommandPrefixes() {
  return [...commandPrefixes];
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

  return numbers.has(PRIMARY_OWNER_NUMBER) ||
    Boolean(botNumber && numbers.has(botNumber));
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
    `*PREFIXOS*\n` +
    `.prefixo — ver prefixos ativos\n` +
    `.prefixo add . / ? — adicionar um ou vários\n` +
    `.prefixo remover ? — remover\n` +
    `.prefixo definir ! . / — substituir todos\n\n` +
    `*BOT*\n` +
    `.donos — mostra os números donos\n` +
    `.botnumero — mostra o número da Edith\n` +
    `.dono — abre este painel\n\n` +
    `*PREFIXOS ATIVOS*\n${prefixSummary()}\n\n` +
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

async function handlePrefixCommand(sock, jid, msg, command, args = '') {
  let action = '';
  let input = args;

  if (command === 'addprefix') {
    action = 'add';
  } else if (command === 'remprefix') {
    action = 'remover';
  } else if (command === 'setprefix') {
    action = 'definir';
  } else {
    const parts = String(args).trim().split(/\s+/u).filter(Boolean);
    action = String(parts.shift() || '').toLowerCase();
    input = parts.join(' ');
  }

  if (!action) {
    await send(
      sock,
      jid,
      `⌨️ *PREFIXOS DA EDITH*\n\n${prefixSummary()}\n\n` +
        `⭐ = prefixo principal\n\n` +
        `Use:\n` +
        `• *.prefixo add . / ?*\n` +
        `• *.prefixo remover ?*\n` +
        `• *.prefixo definir ! . /*`,
      msg
    );
    return;
  }

  const aliases = {
    adicionar: 'add',
    add: 'add',
    remover: 'remove',
    remove: 'remove',
    del: 'remove',
    apagar: 'remove',
    definir: 'set',
    set: 'set',
    trocar: 'set',
    mudar: 'set'
  };

  const normalizedAction = aliases[action];
  const values = parsePrefixList(input);

  if (!normalizedAction || !values.length) {
    await send(
      sock,
      jid,
      '⚠️ Prefixo inválido. Use somente símbolos, com até 4 caracteres. Ex.: *!*, *.*, */*, *?* ou *!!*.',
      msg
    );
    return;
  }

  if (normalizedAction === 'add') {
    const merged = [...new Set([...commandPrefixes, ...values])];

    if (merged.length > MAX_PREFIXES) {
      await send(sock, jid, `⚠️ A Edith aceita no máximo *${MAX_PREFIXES} prefixos* ao mesmo tempo.`, msg);
      return;
    }

    commandPrefixes.clear();
    merged.forEach((prefix) => commandPrefixes.add(prefix));
  }

  if (normalizedAction === 'remove') {
    const remaining = [...commandPrefixes].filter((prefix) => !values.includes(prefix));

    if (!remaining.length) {
      await send(sock, jid, '⚠️ Não posso remover todos os prefixos. Defina pelo menos um.', msg);
      return;
    }

    commandPrefixes.clear();
    remaining.forEach((prefix) => commandPrefixes.add(prefix));
  }

  if (normalizedAction === 'set') {
    if (values.length > MAX_PREFIXES) {
      await send(sock, jid, `⚠️ A Edith aceita no máximo *${MAX_PREFIXES} prefixos* ao mesmo tempo.`, msg);
      return;
    }

    commandPrefixes.clear();
    values.forEach((prefix) => commandPrefixes.add(prefix));
  }

  syncPrimaryPrefix();
  await saveOwnerControl();

  await send(
    sock,
    jid,
    `✅ *PREFIXOS ATUALIZADOS*\n\n${prefixSummary()}\n\n` +
      `Agora os comandos aceitam qualquer um desses prefixos.`,
    msg
  );
}

export async function handleOwnerCommand(sock, jid, msg, text = '') {
  const raw = String(text).trim();
  if (!raw.startsWith('.')) return false;

  const [head] = raw.split(/\s+/u);
  const command = head.slice(1).toLowerCase();
  const args = raw.slice(head.length).trim();
  const ownerCommands = new Set([
    'dono',
    'autorizar',
    'desautorizar',
    'statusgrupo',
    'grupos',
    'donos',
    'botnumero',
    'prefixo',
    'prefixos',
    'addprefix',
    'remprefix',
    'setprefix'
  ]);

  if (!ownerCommands.has(command)) return false;

  if (isDuplicateOwnerCommand(jid, msg, raw)) {
    return true;
  }

  if (!(await isBotOwner(sock, msg))) {
    // Comandos de dono são silenciosos para quem não é dono.
    return true;
  }

  if (command === 'dono') {
    await send(sock, jid, ownerMenu(sock), msg);
    return true;
  }

  if (['prefixo', 'prefixos', 'addprefix', 'remprefix', 'setprefix'].includes(command)) {
    await handlePrefixCommand(sock, jid, msg, command, args);
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
