import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

const PRIMARY_OWNER_NUMBER = '559591722192';
const OWNER_DEDUP_MS = 5000;
const DEFAULT_PREFIX = '!';
const OWNER_STATE_VERSION = 5;
const MAX_PREFIX_LENGTH = 4;

let ownerFile = null;
const authorizedGroups = new Set();
const ownerNumbers = new Set([PRIMARY_OWNER_NUMBER]);
const recentOwnerCommands = new Map();

function jidDigits(value = '') {
  return String(value)
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '');
}

function normalizeOwnerNumber(value = '') {
  let clean = jidDigits(value);
  if (!clean) return '';

  if (clean.length === 10 || clean.length === 11) {
    clean = `55${clean}`;
  }

  return /^\d{10,15}$/.test(clean) ? clean : '';
}

function formatNumber(digits = '') {
  const clean = normalizeOwnerNumber(digits) || jidDigits(digits);

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
    msg?.key?.participantPn ||
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
        prefix: currentPrefix(),
        ownerNumbers: [...ownerNumbers]
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
  ownerNumbers.clear();
  ownerNumbers.add(PRIMARY_OWNER_NUMBER);

  try {
    const raw = await readFile(ownerFile, 'utf-8');
    const saved = JSON.parse(raw);

    authorizedGroups.clear();
    for (const jid of saved?.authorizedGroups || []) {
      if (typeof jid === 'string' && jid.endsWith('@g.us')) {
        authorizedGroups.add(jid);
      }
    }

    for (const value of saved?.ownerNumbers || []) {
      const number = normalizeOwnerNumber(value);
      if (number) ownerNumbers.add(number);
    }

    if (Number(saved?.version) >= 4) {
      const savedPrefix = normalizePrefix(saved?.prefix);
      if (savedPrefix) config.prefix = savedPrefix;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('Falha ao carregar controles do dono:', error?.message || error);
    }
  }

  ownerNumbers.add(PRIMARY_OWNER_NUMBER);
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

function participantIds(participant = {}) {
  return [participant?.phoneNumber, participant?.id, participant?.lid].filter(Boolean);
}

function candidateMatchesParticipant(participant, candidate) {
  const candidateString = String(candidate || '');
  const candidateDigits = jidDigits(candidateString);

  return participantIds(participant).some((id) => {
    const idString = String(id);
    if (idString === candidateString) return true;

    const idDigits = jidDigits(idString);
    return Boolean(
      candidateDigits &&
      idDigits &&
      !candidateString.endsWith('@lid') &&
      !idString.endsWith('@lid') &&
      candidateDigits === idDigits
    );
  });
}

async function enrichFromGroupMetadata(sock, msg, numbers) {
  const groupJid = String(msg?.key?.remoteJid || '');
  if (!groupJid.endsWith('@g.us')) return;

  const candidates = [
    msg?.key?.participantPn,
    msg?.key?.participantAlt,
    msg?.key?.participant
  ].filter(Boolean);

  if (!candidates.length) return;

  try {
    const metadata = await sock.groupMetadata(groupJid);
    const participant = metadata?.participants?.find((entry) =>
      candidates.some((candidate) => candidateMatchesParticipant(entry, candidate))
    );

    if (!participant) return;

    for (const id of participantIds(participant)) {
      if (String(id).endsWith('@lid')) continue;
      const number = normalizeOwnerNumber(id);
      if (number) numbers.add(number);
    }
  } catch {
    // A identificação principal ainda pode funcionar sem metadata.
  }
}

async function senderNumbers(sock, msg) {
  const candidates = [
    msg?.key?.participantPn,
    msg?.key?.participantAlt,
    msg?.key?.participant,
    msg?.key?.remoteJid
  ].filter(Boolean);

  const numbers = new Set();

  for (const candidate of candidates) {
    const value = String(candidate);

    if (!value.endsWith('@lid') && !value.endsWith('@g.us')) {
      const direct = normalizeOwnerNumber(value);
      if (direct) numbers.add(direct);
    }

    if (value.endsWith('@lid')) {
      try {
        const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(value);
        const mappedDigits = normalizeOwnerNumber(mapped);
        if (mappedDigits) numbers.add(mappedDigits);
      } catch {
        // Tenta metadata do grupo abaixo.
      }
    }
  }

  await enrichFromGroupMetadata(sock, msg, numbers);
  return numbers;
}

export async function isBotOwner(sock, msg) {
  if (msg?.key?.fromMe) return true;

  const numbers = await senderNumbers(sock, msg);
  const botNumber = normalizeOwnerNumber(sock?.user?.id);

  if (botNumber && numbers.has(botNumber)) return true;

  for (const number of numbers) {
    if (ownerNumbers.has(number)) return true;
  }

  return false;
}

async function send(sock, jid, text, msg) {
  await sock.sendMessage(jid, { text }, { quoted: msg });
}

function configuredOwnerNumbers(sock) {
  const numbers = new Set(ownerNumbers);
  const botNumber = normalizeOwnerNumber(sock?.user?.id);
  if (botNumber) numbers.add(botNumber);
  return [...numbers];
}

function ownerMenu(sock) {
  const prefix = currentPrefix();

  return (
    `╭━━━〔 👑 DONO • EDITH l 〕━━━╮\n` +
    `┃ Controle exclusivo dos donos\n` +
    `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `┏━〔 DONOS 〕━┓\n` +
    `┃ ${command('donos')} — listar donos\n` +
    `┃ ${command('adddono')} número — adicionar dono\n` +
    `┃ ${command('remdono')} número — remover dono\n` +
    `┃ ${command('botnumero')} — número da Edith\n` +
    `┗━━━━━━━━━━━━━━━━━━━━┛\n\n` +
    `┏━〔 MEU CARGO NO GRUPO 〕━┓\n` +
    `┃ ${command('seradm')} — tornar você ADM\n` +
    `┃ ${command('sermembro')} — voltar a membro\n` +
    `┗━━━━━━━━━━━━━━━━━━━━━━┛\n\n` +
    `┏━〔 ACESSO DE GRUPOS 〕━┓\n` +
    `┃ ${command('autorizar')}\n` +
    `┃ ${command('desautorizar')}\n` +
    `┃ ${command('statusgrupo')}\n` +
    `┃ ${command('grupos')}\n` +
    `┗━━━━━━━━━━━━━━━━━━━━━━┛\n\n` +
    `┏━〔 VIP 〕━┓\n` +
    `┃ ${command('addvip')} número dias\n` +
    `┃ ${command('renovarvip')} número dias\n` +
    `┃ ${command('remvip')} número\n` +
    `┃ ${command('vips')} — listar VIPs\n` +
    `┗━━━━━━━━━━━━━━━━━━━━┛\n\n` +
    `┏━〔 CONFIGURAÇÃO 〕━┓\n` +
    `┃ ${command('prefixo')} — ver/trocar prefixo global\n` +
    `┗━━━━━━━━━━━━━━━━━━━━┛\n\n` +
    `Prefixo atual: *${prefix}*`
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

function contextTarget(msg) {
  const context =
    msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.imageMessage?.contextInfo ||
    msg?.message?.videoMessage?.contextInfo ||
    null;

  return context?.mentionedJid?.[0] || context?.participantAlt || context?.participant || '';
}

async function resolveOwnerTargetNumber(sock, msg, args = '') {
  const first = String(args || '').trim().split(/\s+/u)[0] || '';
  const direct = normalizeOwnerNumber(first);
  if (direct) return direct;

  const target = contextTarget(msg);
  if (!target) return '';

  if (!String(target).endsWith('@lid')) {
    return normalizeOwnerNumber(target);
  }

  try {
    const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(target);
    const number = normalizeOwnerNumber(mapped);
    if (number) return number;
  } catch {}

  const groupJid = String(msg?.key?.remoteJid || '');
  if (!groupJid.endsWith('@g.us')) return '';

  try {
    const metadata = await sock.groupMetadata(groupJid);
    const participant = metadata?.participants?.find((entry) =>
      candidateMatchesParticipant(entry, target)
    );
    for (const id of participantIds(participant || {})) {
      if (String(id).endsWith('@lid')) continue;
      const number = normalizeOwnerNumber(id);
      if (number) return number;
    }
  } catch {}

  return '';
}

async function changeOwnerSelfRole(sock, jid, msg, action) {
  if (!String(jid).endsWith('@g.us')) {
    await send(sock, jid, '⚠️ Esse comando precisa ser usado dentro do grupo.', msg);
    return;
  }

  try {
    const metadata = await sock.groupMetadata(jid);
    const botCandidates = [sock?.user?.id, sock?.user?.lid].filter(Boolean);
    const botInfo = metadata?.participants?.find((participant) =>
      botCandidates.some((candidate) => candidateMatchesParticipant(participant, candidate))
    );

    if (!botInfo?.admin) {
      await send(
        sock,
        jid,
        '🛡️ *COMANDO NÃO EXECUTADO*\n\nMotivo: a Edith precisa ser administradora do grupo para alterar seu cargo.',
        msg
      );
      return;
    }

    const senderCandidates = [
      msg?.key?.participantPn,
      msg?.key?.participantAlt,
      msg?.key?.participant
    ].filter(Boolean);

    const senderInfo = metadata?.participants?.find((participant) =>
      senderCandidates.some((candidate) => candidateMatchesParticipant(participant, candidate))
    );

    if (!senderInfo) {
      await send(
        sock,
        jid,
        '❌ *COMANDO NÃO EXECUTADO*\n\nMotivo: não consegui identificar seu perfil dentro deste grupo.',
        msg
      );
      return;
    }

    if (action === 'promote' && senderInfo.admin) {
      await send(sock, jid, 'ℹ️ Você já é administrador deste grupo.', msg);
      return;
    }

    if (action === 'demote' && !senderInfo.admin) {
      await send(sock, jid, 'ℹ️ Você já está como membro comum neste grupo.', msg);
      return;
    }

    const target = senderInfo.id || senderInfo.phoneNumber || senderInfo.lid;
    await sock.groupParticipantsUpdate(jid, [target], action);

    await send(
      sock,
      jid,
      action === 'promote'
        ? '👑 *CARGO ATUALIZADO*\nVocê agora é administrador do grupo.'
        : '👤 *CARGO ATUALIZADO*\nVocê agora é membro comum do grupo.',
      msg
    );
  } catch (error) {
    console.error(`[DONO] Falha ao ${action}:`, error?.message || error);
    await send(
      sock,
      jid,
      '❌ *COMANDO NÃO EXECUTADO*\n\nMotivo: o WhatsApp não permitiu alterar seu cargo agora. Verifique se a Edith continua administradora.',
      msg
    );
  }
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
    'adddono',
    'remdono',
    'botnumero',
    'seradm',
    'sermembro',
    'prefixo'
  ]);

  if (!ownerCommands.has(commandName)) return false;

  if (isDuplicateOwnerCommand(jid, msg, raw)) {
    return true;
  }

  if (!(await isBotOwner(sock, msg))) {
    await send(
      sock,
      jid,
      `⛔ *COMANDO NÃO EXECUTADO*\n\nMotivo: *${commandName}* é um comando exclusivo dos donos da Edith.`,
      msg
    );
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
    const lines = configuredOwnerNumbers(sock)
      .map((number, index) => `${index + 1}. ${formatNumber(number)}`)
      .join('\n');

    await send(sock, jid, `👑 *NÚMEROS DONOS*\n\n${lines}`, msg);
    return true;
  }

  if (commandName === 'adddono' || commandName === 'remdono') {
    const number = await resolveOwnerTargetNumber(sock, msg, args);

    if (!number) {
      await send(
        sock,
        jid,
        `⚠️ Informe o número, mencione ou responda a pessoa.\nEx.: *${command(commandName)} 5595999999999*`,
        msg
      );
      return true;
    }

    if (commandName === 'adddono') {
      ownerNumbers.add(number);
      await saveOwnerControl();
      await send(sock, jid, `✅ *DONO ADICIONADO*\n${formatNumber(number)} agora é reconhecido como dono da Edith.`, msg);
      return true;
    }

    if (number === PRIMARY_OWNER_NUMBER) {
      await send(sock, jid, '🛡️ O dono principal não pode ser removido.', msg);
      return true;
    }

    const removed = ownerNumbers.delete(number);
    await saveOwnerControl();
    await send(
      sock,
      jid,
      removed
        ? `✅ *DONO REMOVIDO*\n${formatNumber(number)} não é mais dono da Edith.`
        : `ℹ️ ${formatNumber(number)} não estava cadastrado como dono.`,
      msg
    );
    return true;
  }

  if (commandName === 'botnumero') {
    await send(sock, jid, `🤖 Número da Edith: *${formatNumber(sock?.user?.id)}*`, msg);
    return true;
  }

  if (commandName === 'seradm') {
    await changeOwnerSelfRole(sock, jid, msg, 'promote');
    return true;
  }

  if (commandName === 'sermembro') {
    await changeOwnerSelfRole(sock, jid, msg, 'demote');
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
      `🔒 *GRUPO DESAUTORIZADO*\nA Edith l ficará em silêncio para membros comuns neste grupo. Donos continuam com acesso total.`,
      msg
    );
    return true;
  }

  if (commandName === 'statusgrupo') {
    await send(
      sock,
      jid,
      `🔐 Grupo: *${authorizedGroups.has(jid) ? 'AUTORIZADO' : 'NÃO AUTORIZADO'}*\n👑 Donos: *ACESSO LIBERADO SEMPRE*`,
      msg
    );
    return true;
  }

  return true;
}
