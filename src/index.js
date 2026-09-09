import makeWASocket, {
  DisconnectReason,
  areJidsSameUser,
  downloadContentFromMessage,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { config } from './config.js';
import { menuText, adminMenuText } from './commands/menu.js';
import {
  movieInfo,
  seriesInfo,
  synopsis,
  rating,
  cast,
  trailer,
  watchProviders,
  nowPlaying,
  upcoming,
  topMovies,
  topSeries,
  recommend,
  tmdbErrorMessage
} from './services/tmdb.js';

const logger = pino({ level: 'silent' });
const execFileAsync = promisify(execFile);
const authDir = process.env.AUTH_DIR || 'auth';
const groupSettingsFile = join(authDir, 'group-settings.json');
const pairingNumber = (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, '');
let pairingCodeRequested = false;

const pendingQuiz = new Map();
const ratings = new Map();
const groupSettings = new Map();
const processedMessages = new Map();
const floodTracker = new Map();
const MESSAGE_DEDUP_TTL_MS = 2 * 60 * 1000;
const FLOOD_LIMIT = 10;
const FLOOD_WINDOW_MS = 6 * 1000;

function isDuplicateMessage(msg) {
  const id = msg?.key?.id;
  const jid = msg?.key?.remoteJid;

  if (!id || !jid) return false;

  const participant =
    msg?.key?.participant ||
    msg?.key?.participantAlt ||
    '';

  const dedupKey = `${jid}:${participant}:${id}`;
  const now = Date.now();
  const seenAt = processedMessages.get(dedupKey);

  if (seenAt && now - seenAt < MESSAGE_DEDUP_TTL_MS) {
    return true;
  }

  processedMessages.set(dedupKey, now);

  if (processedMessages.size > 1000) {
    for (const [key, timestamp] of processedMessages) {
      if (now - timestamp >= MESSAGE_DEDUP_TTL_MS) {
        processedMessages.delete(key);
      }
    }
  }

  return false;
}

async function loadGroupSettings() {
  try {
    await mkdir(authDir, { recursive: true });
    const raw = await readFile(groupSettingsFile, 'utf-8');
    const saved = JSON.parse(raw);

    for (const [groupJid, settings] of Object.entries(saved)) {
      groupSettings.set(groupJid, {
        antiLink: Boolean(settings?.antiLink),
        antiFlood: Boolean(settings?.antiFlood),
        welcome: Boolean(settings?.welcome),
        autoApproveBrazil: Boolean(settings?.autoApproveBrazil),
        warnings:
          settings?.warnings && typeof settings.warnings === 'object'
            ? settings.warnings
            : {},
        adminLogs: Array.isArray(settings?.adminLogs)
          ? settings.adminLogs.slice(-100)
          : [],
        activity:
          settings?.activity && typeof settings.activity === 'object'
            ? settings.activity
            : {}
      });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('Falha ao carregar configurações dos grupos:', error?.message || error);
    }
  }
}

async function saveGroupSettings() {
  await mkdir(authDir, { recursive: true });
  const saved = Object.fromEntries(groupSettings.entries());
  await writeFile(groupSettingsFile, JSON.stringify(saved, null, 2), 'utf-8');
}

function getSettings(jid) {
  let settings = groupSettings.get(jid);

  if (!settings) {
    settings = {
      antiLink: false,
      antiFlood: false,
      welcome: false,
      autoApproveBrazil: false,
      warnings: {},
      adminLogs: [],
      activity: {}
    };
    groupSettings.set(jid, settings);
  }

  settings.antiLink = Boolean(settings.antiLink);
  settings.antiFlood = Boolean(settings.antiFlood);
  settings.welcome = Boolean(settings.welcome);
  settings.autoApproveBrazil = Boolean(settings.autoApproveBrazil);

  if (!settings.warnings || typeof settings.warnings !== 'object') {
    settings.warnings = {};
  }

  if (!Array.isArray(settings.adminLogs)) {
    settings.adminLogs = [];
  }

  if (!settings.activity || typeof settings.activity !== 'object') {
    settings.activity = {};
  }

  return settings;
}

function brazilPhoneJid(request = {}) {
  const candidates = [
    request.phoneNumber,
    request.jid,
    request.id,
    request.participant
  ].filter(Boolean);

  for (const candidate of candidates) {
    const value = String(candidate);
    if (value.endsWith('@lid')) continue;

    const digits = value.split('@')[0].split(':')[0].replace(/\D/g, '');

    // Brasil: +55 + DDD (2 dígitos) + número (8 ou 9 dígitos)
    if (/^55\d{10,11}$/.test(digits)) {
      return value.includes('@') ? value : `${digits}@s.whatsapp.net`;
    }
  }

  return null;
}

async function processBrazilJoinRequests(sock, jid) {
  const settings = getSettings(jid);
  if (!settings.autoApproveBrazil) {
    return { approved: 0, pending: 0 };
  }

  const requests = await sock.groupRequestParticipantsList(jid);
  const brazilJids = [...new Set(
    (requests || [])
      .map((request) => brazilPhoneJid(request))
      .filter(Boolean)
  )];

  if (!brazilJids.length) {
    return { approved: 0, pending: (requests || []).length };
  }

  const result = await sock.groupRequestParticipantsUpdate(
    jid,
    brazilJids,
    'approve'
  );

  const approved = Array.isArray(result) ? result.length : brazilJids.length;

  for (const requestJid of brazilJids) {
    addAdminLog(
      jid,
      'AUTO_APROVAR_BR',
      null,
      { id: requestJid },
      'solicitação aprovada automaticamente'
    );
  }

  await saveGroupSettings();

  return {
    approved,
    pending: Math.max(0, (requests || []).length - approved)
  };
}

async function setAutoApproveBrazil(sock, jid, msg, args = '') {
  try {
    const info = await requireGroupAdmin(sock, jid, msg);
    if (!info) return;

    const option = args.trim().toLowerCase();

    if (!['on', 'off', 'status'].includes(option)) {
      await send(
        sock,
        jid,
        'Use *!autoaceitar on*, *!autoaceitar off* ou *!autoaceitar status*.',
        msg
      );
      return;
    }

    const settings = getSettings(jid);

    if (option === 'status') {
      await send(
        sock,
        jid,
        `🇧🇷 Auto-aceitar BR: *${settings.autoApproveBrazil ? 'ATIVADO' : 'DESATIVADO'}*.\nApenas números brasileiros identificáveis (+55) são aprovados.`,
        msg
      );
      return;
    }

    const botInfo = findBotParticipant(info.metadata, sock);
    if (option === 'on' && !botInfo?.admin) {
      await send(
        sock,
        jid,
        '🛡️ A Edith l precisa ser administradora para aprovar solicitações.',
        msg
      );
      return;
    }

    settings.autoApproveBrazil = option === 'on';
    await saveGroupSettings();

    if (!settings.autoApproveBrazil) {
      await send(sock, jid, '🇧🇷 Auto-aceitar BR *DESATIVADO*.', msg);
      return;
    }

    let approvedNow = 0;

    try {
      const result = await processBrazilJoinRequests(sock, jid);
      approvedNow = result.approved;
    } catch (error) {
      console.error('Falha ao processar solicitações ao ativar:', error?.message || error);
    }

    await send(
      sock,
      jid,
      `🇧🇷 Auto-aceitar BR *ATIVADO*.\nSomente números +55 serão aprovados automaticamente.${approvedNow ? `\nAprovados agora: *${approvedNow}*` : ''}`,
      msg
    );
  } catch (error) {
    console.error('Falha no !autoaceitar:', error?.message || error);
    await send(sock, jid, '❌ Não consegui alterar o auto-aceitar.', msg);
  }
}

async function pollBrazilJoinRequests(sock) {
  for (const [groupJid, settings] of groupSettings.entries()) {
    if (!settings?.autoApproveBrazil) continue;

    try {
      await processBrazilJoinRequests(sock, groupJid);
    } catch (error) {
      console.error(
        `Falha ao verificar solicitações de ${groupJid}:`,
        error?.message || error
      );
    }
  }
}

let activitySaveTimer = null;

function scheduleActivitySave() {
  if (activitySaveTimer) return;

  activitySaveTimer = setTimeout(async () => {
    activitySaveTimer = null;
    try {
      await saveGroupSettings();
    } catch (error) {
      console.error('Falha ao salvar atividade:', error?.message || error);
    }
  }, 5000);
}

function trackActivity(jid, msg) {
  if (!jid?.endsWith('@g.us')) return;
  if (msg.key.fromMe) return;

  const sender = msg.key.participant || msg.key.participantAlt;
  if (!sender) return;

  const settings = getSettings(jid);
  const current = settings.activity[sender] || { messages: 0, lastActive: 0 };

  current.messages = Number(current.messages || 0) + 1;
  current.lastActive = Date.now();
  settings.activity[sender] = current;

  scheduleActivitySave();
}

function activityForParticipant(settings, participant) {
  const ids = [participant?.id, participant?.phoneNumber, participant?.lid].filter(Boolean);
  let messages = 0;
  let lastActive = 0;

  for (const [storedJid, stats] of Object.entries(settings.activity || {})) {
    const matches = ids.some((jid) => {
      try {
        return areJidsSameUser(storedJid, jid);
      } catch {
        return storedJid === jid;
      }
    });

    if (!matches) continue;

    messages += Number(stats?.messages || 0);
    lastActive = Math.max(lastActive, Number(stats?.lastActive || 0));
  }

  return { messages, lastActive };
}

async function showActivity(sock, jid, msg) {
  if (!jid.endsWith('@g.us')) {
    await send(sock, jid, '🚫 O comando *!atividade* funciona em grupos.', msg);
    return;
  }

  try {
    const metadata = await sock.groupMetadata(jid);
    const target = getTargetParticipant(metadata, msg, true);

    if (!target) {
      await send(sock, jid, '❌ Não consegui identificar esse membro.', msg);
      return;
    }

    const stats = activityForParticipant(getSettings(jid), target);
    const last = stats.lastActive ? formatLogDate(stats.lastActive) : 'sem registro';

    await sock.sendMessage(
      jid,
      {
        text:
          `📊 *ATIVIDADE*\n\n` +
          `Membro: ${mentionLabel(target.id)}\n` +
          `Mensagens: *${stats.messages}*\n` +
          `Última atividade: *${last}*`,
        mentions: [target.id]
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no !atividade:', error?.message || error);
    await send(sock, jid, '❌ Não consegui consultar a atividade.', msg);
  }
}

async function showRanking(sock, jid, msg) {
  if (!jid.endsWith('@g.us')) {
    await send(sock, jid, '🚫 O comando *!ranking* funciona em grupos.', msg);
    return;
  }

  try {
    const metadata = await sock.groupMetadata(jid);
    const settings = getSettings(jid);

    const ranking = metadata.participants
      .map((participant) => ({
        participant,
        ...activityForParticipant(settings, participant)
      }))
      .filter((item) => item.messages > 0)
      .sort((a, b) => b.messages - a.messages)
      .slice(0, 10);

    if (!ranking.length) {
      await send(sock, jid, '📊 Ainda não há atividade suficiente para montar o ranking.', msg);
      return;
    }

    await sock.sendMessage(
      jid,
      {
        text:
          `🏆 *RANKING DE ATIVIDADE*\n\n` +
          ranking
            .map(
              (item, index) =>
                `${index + 1}. ${mentionLabel(item.participant.id)} — *${item.messages}*`
            )
            .join('\n'),
        mentions: ranking.map((item) => item.participant.id)
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no !ranking:', error?.message || error);
    await send(sock, jid, '❌ Não consegui montar o ranking.', msg);
  }
}

async function showMembers(sock, jid, msg) {
  if (!jid.endsWith('@g.us')) {
    await send(sock, jid, '🚫 O comando *!membros* funciona em grupos.', msg);
    return;
  }

  try {
    const metadata = await sock.groupMetadata(jid);
    const total = metadata.participants.length;
    const admins = metadata.participants.filter((participant) => participant.admin).length;
    const members = total - admins;

    await send(
      sock,
      jid,
      `👥 *MEMBROS*\n\nTotal: *${total}*\nAdmins: *${admins}*\nMembros: *${members}*`,
      msg
    );
  } catch (error) {
    console.error('Falha no !membros:', error?.message || error);
    await send(sock, jid, '❌ Não consegui consultar os membros.', msg);
  }
}

async function showConfig(sock, jid, msg) {
  if (!jid.endsWith('@g.us')) {
    await send(sock, jid, '🚫 O comando *!config* funciona em grupos.', msg);
    return;
  }

  const settings = getSettings(jid);

  await send(
    sock,
    jid,
    `⚙️ *CONFIGURAÇÃO DO GRUPO*\n\n` +
      `Anti-link: *${settings.antiLink ? 'ON' : 'OFF'}*\n` +
      `Anti-flood: *${settings.antiFlood ? 'ON' : 'OFF'}*\n` +
      `Boas-vindas: *${settings.welcome ? 'ON' : 'OFF'}*\n` +
      `Auto-aceitar BR: *${settings.autoApproveBrazil ? 'ON' : 'OFF'}*`,
    msg
  );
}

async function sendGroupLink(sock, jid, msg) {
  try {
    const info = await requireGroupAdmin(sock, jid, msg);
    if (!info) return;

    const botInfo = findBotParticipant(info.metadata, sock);
    if (!botInfo?.admin) {
      await send(sock, jid, '🛡️ A Edith l precisa ser administradora para obter o link.', msg);
      return;
    }

    const code = await sock.groupInviteCode(jid);
    await send(sock, jid, `🔗 https://chat.whatsapp.com/${code}`, msg);
  } catch (error) {
    console.error('Falha no !linkgrupo:', error?.message || error);
    await send(sock, jid, '❌ Não consegui obter o link do grupo.', msg);
  }
}

async function setGroupDescription(sock, jid, msg, args = '') {
  try {
    const info = await requireGroupAdmin(sock, jid, msg);
    if (!info) return;

    const description = args.trim();

    if (!description) {
      await send(sock, jid, 'Exemplo: *!setdesc Nova descrição do grupo*', msg);
      return;
    }

    if (description.length > 512) {
      await send(sock, jid, '❌ A descrição ficou muito longa. Use até 512 caracteres.', msg);
      return;
    }

    const botInfo = findBotParticipant(info.metadata, sock);
    if (!botInfo?.admin) {
      await send(sock, jid, '🛡️ A Edith l precisa ser administradora para alterar a descrição.', msg);
      return;
    }

    await sock.groupUpdateDescription(jid, description);
    addAdminLog(jid, 'ALTERAR_DESCRICAO', info.senderInfo, null, description.slice(0, 80));
    await saveGroupSettings();

    await send(sock, jid, '✅ Descrição do grupo atualizada.', msg);
  } catch (error) {
    console.error('Falha no !setdesc:', error?.message || error);
    await send(sock, jid, '❌ Não consegui alterar a descrição do grupo.', msg);
  }
}

function extractLinks(text = '') {
  const matches = text.match(
    /(?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9-]+\.)+(?:com|com\.br|net|org|io|gg|me|app|br)(?:\/[^\s]*)?/gi
  );

  return matches || [];
}

function normalizeLink(link = '') {
  const cleaned = link
    .trim()
    .replace(/[),.!?;:]+$/g, '');

  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }

  return `https://${cleaned.replace(/^www\./i, '')}`;
}

function isAllowedMemberLink(link = '') {
  try {
    const url = new URL(normalizeLink(link));
    const host = url.hostname.toLowerCase().replace(/^www\./, '');

    return (
      host === 'instagram.com' ||
      host.endsWith('.instagram.com') ||
      host === 'tiktok.com' ||
      host.endsWith('.tiktok.com')
    );
  } catch {
    return false;
  }
}

function hasBlockedLinkForMember(text = '') {
  const links = extractLinks(text);
  if (links.length === 0) return false;

  return links.some((link) => !isAllowedMemberLink(link));
}

async function getGroupMemberInfo(sock, jid, msg) {
  const metadata = await sock.groupMetadata(jid);
  const sender = msg.key.participant || msg.key.remoteJid;
  const senderAlt = msg.key.participantAlt;
  const senderInfo = metadata.participants.find((participant) =>
    participantMatches(participant, sender, senderAlt)
  );

  return { metadata, sender, senderAlt, senderInfo };
}

async function handleAntiLink(sock, jid, text, msg) {
  if (!jid.endsWith('@g.us')) return false;
  if (!getSettings(jid).antiLink) return false;
  if (msg.key.fromMe) return false;

  const links = extractLinks(text);
  if (links.length === 0) return false;

  try {
    const { senderInfo } = await getGroupMemberInfo(sock, jid, msg);

    if (senderInfo?.admin) {
      return false;
    }

    if (!hasBlockedLinkForMember(text)) {
      return false;
    }

    await sock.sendMessage(jid, { delete: msg.key });
    await send(
      sock,
      jid,
      '🔗 Link bloqueado. Membros podem enviar apenas links do *Instagram* e *TikTok*. Administradores podem enviar qualquer link.',
      msg
    );
    return true;
  } catch (error) {
    console.error('Falha no anti-link:', error?.message || error);
    return false;
  }
}

async function setAntiLink(sock, jid, msg, args = '') {
  if (!jid.endsWith('@g.us')) {
    await send(sock, jid, '🚫 O comando *!antilink* só funciona em grupos.', msg);
    return;
  }

  try {
    const { senderInfo } = await getGroupMemberInfo(sock, jid, msg);

    if (!senderInfo?.admin) {
      await send(sock, jid, '⛔ Apenas administradores podem alterar o anti-link.', msg);
      return;
    }

    const option = args.trim().toLowerCase();

    if (!['on', 'off', 'status'].includes(option)) {
      await send(
        sock,
        jid,
        'Use *!antilink on*, *!antilink off* ou *!antilink status*.',
        msg
      );
      return;
    }

    if (option === 'status') {
      const enabled = getSettings(jid).antiLink;
      await send(
        sock,
        jid,
        `🔗 Anti-link está *${enabled ? 'ATIVADO' : 'DESATIVADO'}*.`,
        msg
      );
      return;
    }

    const enabled = option === 'on';
    const settings = getSettings(jid);
    settings.antiLink = enabled;

    await saveGroupSettings();

    await send(
      sock,
      jid,
      `🔗 Anti-link *${enabled ? 'ATIVADO' : 'DESATIVADO'}*.${enabled ? '\nMembros: apenas Instagram e TikTok.\nAdministradores: qualquer link.' : ''}`,
      msg
    );
  } catch (error) {
    console.error('Falha ao configurar anti-link:', error?.message || error);
    await send(sock, jid, '❌ Não consegui alterar o anti-link agora.', msg);
  }
}

const quizzes = [
  {
    question: 'Qual filme venceu o Oscar de Melhor Filme em 2020?',
    options: ['A) 1917', 'B) Parasita', 'C) Coringa', 'D) Era Uma Vez em... Hollywood'],
    answer: 'B',
    explanation: 'Parasita venceu o Oscar de Melhor Filme na cerimônia de 2020.'
  },
  {
    question: 'Quem dirigiu Interestelar?',
    options: ['A) Christopher Nolan', 'B) Denis Villeneuve', 'C) James Cameron', 'D) Steven Spielberg'],
    answer: 'A',
    explanation: 'Interestelar foi dirigido por Christopher Nolan.'
  },
  {
    question: 'Em qual universo se passa a série The Mandalorian?',
    options: ['A) Star Trek', 'B) Marvel', 'C) Star Wars', 'D) Duna'],
    answer: 'C',
    explanation: 'The Mandalorian faz parte do universo de Star Wars.'
  },
  {
    question: 'Qual destes é um filme de animação do Studio Ghibli?',
    options: ['A) Your Name', 'B) A Viagem de Chihiro', 'C) Akira', 'D) Paprika'],
    answer: 'B',
    explanation: 'A Viagem de Chihiro é uma produção do Studio Ghibli.'
  }
];

const rulesText = `📜 *REGRAS • CINE LOUNGE CLUB*\n\n1. Respeite todos os membros.\n2. Discussões sobre filmes e séries são bem-vindas, ataques pessoais não.\n3. Avise antes de spoilers e evite revelar pontos importantes sem aviso.\n4. Nada de spam, flood ou divulgação sem autorização.\n5. Mantenha o conteúdo relacionado ao propósito do grupo.\n6. Siga as orientações da administração.\n\n🎬 Bom filme e boa conversa!`;

const groupText = `🎬 *CINE LOUNGE CLUB*\n\nComunidade para conversar sobre filmes e séries, trocar recomendações, comentar lançamentos, teorias, curiosidades e descobrir novos títulos.\n\nUse *!menu* para ver os comandos disponíveis.`;

function getText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ''
  ).trim();
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function parseCommand(text) {
  const body = text.slice(config.prefix.length).trim();
  const firstSpace = body.indexOf(' ');

  if (firstSpace === -1) {
    return { command: body.toLowerCase(), args: '' };
  }

  return {
    command: body.slice(0, firstSpace).toLowerCase(),
    args: body.slice(firstSpace + 1).trim()
  };
}

async function send(sock, jid, text, msg) {
  await sock.sendMessage(jid, { text }, { quoted: msg });
}

function getContextInfo(message) {
  return (
    message?.extendedTextMessage?.contextInfo ||
    message?.imageMessage?.contextInfo ||
    message?.videoMessage?.contextInfo ||
    message?.documentMessage?.contextInfo ||
    null
  );
}

function participantMatches(participant, ...jids) {
  const participantJids = [
    participant?.id,
    participant?.phoneNumber,
    participant?.lid
  ].filter(Boolean);

  return jids
    .filter(Boolean)
    .some((jid) =>
      participantJids.some((participantJid) =>
        areJidsSameUser(participantJid, jid)
      )
    );
}

function participantKey(participant) {
  return participant?.phoneNumber || participant?.id || participant?.lid || '';
}

function mentionLabel(jid = '') {
  const user = String(jid).split('@')[0].split(':')[0];
  return user ? `@${user}` : '@membro';
}

function findBotParticipant(metadata, sock) {
  const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean);
  return metadata.participants.find((participant) =>
    participantMatches(participant, ...botIds)
  );
}

function getTargetParticipant(metadata, msg, allowSelf = false) {
  const contextInfo = getContextInfo(msg.message);
  const explicitTarget =
    contextInfo?.mentionedJid?.[0] ||
    contextInfo?.participant ||
    contextInfo?.participantAlt;

  if (explicitTarget) {
    return metadata.participants.find((participant) =>
      participantMatches(participant, explicitTarget)
    ) || null;
  }

  if (!allowSelf) return null;

  const sender = msg.key.participant || msg.key.remoteJid;
  const senderAlt = msg.key.participantAlt;

  return metadata.participants.find((participant) =>
    participantMatches(participant, sender, senderAlt)
  ) || null;
}

async function requireGroupAdmin(sock, jid, msg) {
  if (!jid.endsWith('@g.us')) {
    await send(sock, jid, '🚫 Esse comando só funciona em grupos.', msg);
    return null;
  }

  const info = await getGroupMemberInfo(sock, jid, msg);

  if (!info.senderInfo?.admin) {
    await send(sock, jid, '⛔ Apenas administradores podem usar esse comando.', msg);
    return null;
  }

  return info;
}

function addAdminLog(jid, action, actor, target = null, detail = '') {
  const settings = getSettings(jid);
  settings.adminLogs.push({
    action,
    actor: participantKey(actor),
    target: target ? participantKey(target) : '',
    detail,
    at: Date.now()
  });

  if (settings.adminLogs.length > 100) {
    settings.adminLogs = settings.adminLogs.slice(-100);
  }
}

function formatLogDate(timestamp) {
  try {
    return new Date(timestamp).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return 'data indisponível';
  }
}

async function showWarnings(sock, jid, msg) {
  if (!jid.endsWith('@g.us')) {
    await send(sock, jid, '🚫 O comando *!advs* funciona em grupos.', msg);
    return;
  }

  try {
    const metadata = await sock.groupMetadata(jid);
    const target = getTargetParticipant(metadata, msg, true);

    if (!target) {
      await send(sock, jid, '❌ Não consegui identificar esse membro.', msg);
      return;
    }

    const settings = getSettings(jid);
    const warnings = settings.warnings[participantKey(target)] || [];

    const lines = warnings.length
      ? warnings
          .slice(-10)
          .reverse()
          .map((warning, index) =>
            `${index + 1}. ${warning.reason || 'Sem motivo'} — ${formatLogDate(warning.at)}`
          )
          .join('\n')
      : 'Nenhuma advertência registrada.';

    await sock.sendMessage(
      jid,
      {
        text: `⚠️ *ADVERTÊNCIAS*\n\nMembro: ${mentionLabel(target.id)}\nTotal: *${warnings.length}*\n\n${lines}`,
        mentions: [target.id]
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no !advs:', error?.message || error);
    await send(sock, jid, '❌ Não consegui consultar as advertências.', msg);
  }
}

async function clearWarnings(sock, jid, msg) {
  try {
    const info = await requireGroupAdmin(sock, jid, msg);
    if (!info) return;

    const target = getTargetParticipant(info.metadata, msg);

    if (!target) {
      await send(
        sock,
        jid,
        '⚠️ Use *!limparadv @membro* ou responda a mensagem da pessoa com *!limparadv*.',
        msg
      );
      return;
    }

    const settings = getSettings(jid);
    const key = participantKey(target);
    const total = Array.isArray(settings.warnings[key])
      ? settings.warnings[key].length
      : 0;

    delete settings.warnings[key];
    addAdminLog(jid, 'LIMPAR_ADVERTENCIAS', info.senderInfo, target, `${total} removida(s)`);
    await saveGroupSettings();

    await sock.sendMessage(
      jid,
      {
        text: `🧹 Advertências de ${mentionLabel(target.id)} foram limpas.\nRemovidas: *${total}*`,
        mentions: [target.id]
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no !limparadv:', error?.message || error);
    await send(sock, jid, '❌ Não consegui limpar as advertências.', msg);
  }
}

async function showAdminLogs(sock, jid, msg) {
  try {
    const info = await requireGroupAdmin(sock, jid, msg);
    if (!info) return;

    const logs = getSettings(jid).adminLogs.slice(-10).reverse();

    if (!logs.length) {
      await send(sock, jid, '📋 Ainda não há ações administrativas registradas.', msg);
      return;
    }

    const mentions = [];
    const lines = logs.map((log, index) => {
      if (log.actor) mentions.push(log.actor);
      if (log.target) mentions.push(log.target);

      const actor = log.actor ? mentionLabel(log.actor) : 'desconhecido';
      const target = log.target ? ` → ${mentionLabel(log.target)}` : '';
      const detail = log.detail ? ` • ${log.detail}` : '';

      return `${index + 1}. *${log.action}* — ${actor}${target}${detail}\n   ${formatLogDate(log.at)}`;
    });

    await sock.sendMessage(
      jid,
      {
        text: `📋 *LOGS ADMINISTRATIVOS*\n\n${lines.join('\n\n')}`,
        mentions: [...new Set(mentions)]
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no !logs:', error?.message || error);
    await send(sock, jid, '❌ Não consegui abrir os logs administrativos.', msg);
  }
}

function cleanWarningReason(args = '') {
  const cleaned = args.replace(/@\d+/g, '').trim();
  return cleaned || 'Sem motivo informado';
}

async function warnMember(sock, jid, msg, args = '') {
  try {
    const info = await requireGroupAdmin(sock, jid, msg);
    if (!info) return;

    const target = getTargetParticipant(info.metadata, msg);

    if (!target) {
      await send(
        sock,
        jid,
        '⚠️ Use *!adv @membro motivo* ou responda a mensagem da pessoa com *!adv motivo*.',
        msg
      );
      return;
    }

    const settings = getSettings(jid);
    const key = participantKey(target);
    const warnings = Array.isArray(settings.warnings[key])
      ? settings.warnings[key]
      : [];

    const reason = cleanWarningReason(args);
    warnings.push({
      reason,
      at: Date.now(),
      by: participantKey(info.senderInfo)
    });

    settings.warnings[key] = warnings;
    addAdminLog(jid, 'ADVERTENCIA', info.senderInfo, target, reason);
    await saveGroupSettings();

    await sock.sendMessage(
      jid,
      {
        text: `⚠️ ${mentionLabel(target.id)} recebeu uma advertência.\nMotivo: *${reason}*\nTotal: *${warnings.length}*`,
        mentions: [target.id]
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no !adv:', error?.message || error);
    await send(sock, jid, '❌ Não consegui registrar a advertência.', msg);
  }
}

async function removeWarning(sock, jid, msg) {
  try {
    const info = await requireGroupAdmin(sock, jid, msg);
    if (!info) return;

    const target = getTargetParticipant(info.metadata, msg);

    if (!target) {
      await send(
        sock,
        jid,
        '⚠️ Use *!remadv @membro* ou responda a mensagem da pessoa com *!remadv*.',
        msg
      );
      return;
    }

    const settings = getSettings(jid);
    const key = participantKey(target);
    const warnings = Array.isArray(settings.warnings[key])
      ? settings.warnings[key]
      : [];

    if (!warnings.length) {
      await sock.sendMessage(
        jid,
        {
          text: `${mentionLabel(target.id)} não possui advertências.`,
          mentions: [target.id]
        },
        { quoted: msg }
      );
      return;
    }

    warnings.pop();

    if (warnings.length) {
      settings.warnings[key] = warnings;
    } else {
      delete settings.warnings[key];
    }

    addAdminLog(jid, 'REMOVER_ADVERTENCIA', info.senderInfo, target);
    await saveGroupSettings();

    await sock.sendMessage(
      jid,
      {
        text: `✅ Uma advertência de ${mentionLabel(target.id)} foi removida.\nTotal restante: *${warnings.length}*`,
        mentions: [target.id]
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no !remadv:', error?.message || error);
    await send(sock, jid, '❌ Não consegui remover a advertência.', msg);
  }
}

async function changeAdminRole(sock, jid, msg, action) {
  try {
    const info = await requireGroupAdmin(sock, jid, msg);
    if (!info) return;

    const target = getTargetParticipant(info.metadata, msg);

    if (!target) {
      const command = action === 'promote' ? '!promover' : '!rebaixar';
      await send(
        sock,
        jid,
        `👤 Use *${command} @membro* ou responda a mensagem da pessoa com *${command}*.`,
        msg
      );
      return;
    }

    const botInfo = findBotParticipant(info.metadata, sock);

    if (!botInfo?.admin) {
      await send(sock, jid, '🛡️ A Edith l precisa ser administradora para fazer isso.', msg);
      return;
    }

    if (action === 'promote' && target.admin) {
      await send(sock, jid, 'ℹ️ Esse membro já é administrador.', msg);
      return;
    }

    if (action === 'demote' && !target.admin) {
      await send(sock, jid, 'ℹ️ Esse membro já não é administrador.', msg);
      return;
    }

    if (action === 'demote' && participantMatches(target, sock.user?.id, sock.user?.lid)) {
      await send(sock, jid, '🛡️ A Edith l não vai rebaixar a si mesma.', msg);
      return;
    }

    await sock.groupParticipantsUpdate(jid, [target.id], action);

    addAdminLog(
      jid,
      action === 'promote' ? 'PROMOVER' : 'REBAIXAR',
      info.senderInfo,
      target
    );
    await saveGroupSettings();

    await sock.sendMessage(
      jid,
      {
        text:
          action === 'promote'
            ? `🛡️ ${mentionLabel(target.id)} foi promovido(a) a administrador.`
            : `👤 ${mentionLabel(target.id)} foi rebaixado(a) para membro.`,
        mentions: [target.id]
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha ao alterar cargo no grupo:', error?.message || error);
    await send(sock, jid, '❌ Não consegui alterar o cargo desse membro.', msg);
  }
}

async function listAdmins(sock, jid, msg) {
  if (!jid.endsWith('@g.us')) {
    await send(sock, jid, '🚫 O comando *!admins* só funciona em grupos.', msg);
    return;
  }

  try {
    const metadata = await sock.groupMetadata(jid);
    const admins = metadata.participants.filter((participant) => participant.admin);

    if (!admins.length) {
      await send(sock, jid, 'Não encontrei administradores no grupo.', msg);
      return;
    }

    await sock.sendMessage(
      jid,
      {
        text: `🛡️ *Administradores — ${metadata.subject}*\n\n${admins
          .map((admin, index) => `${index + 1}. ${mentionLabel(admin.id)}`)
          .join('\n')}`,
        mentions: admins.map((admin) => admin.id)
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no !admins:', error?.message || error);
    await send(sock, jid, '❌ Não consegui listar os administradores.', msg);
  }
}

async function setGroupChatState(sock, jid, msg, open) {
  try {
    const info = await requireGroupAdmin(sock, jid, msg);
    if (!info) return;

    const botInfo = findBotParticipant(info.metadata, sock);

    if (!botInfo?.admin) {
      await send(sock, jid, '🛡️ A Edith l precisa ser administradora para abrir ou fechar o grupo.', msg);
      return;
    }

    await sock.groupSettingUpdate(
      jid,
      open ? 'not_announcement' : 'announcement'
    );

    await send(
      sock,
      jid,
      open
        ? '🔓 Grupo *ABERTO*. Todos os membros podem enviar mensagens.'
        : '🔒 Grupo *FECHADO*. Apenas administradores podem enviar mensagens.',
      msg
    );
  } catch (error) {
    console.error('Falha ao abrir/fechar grupo:', error?.message || error);
    await send(sock, jid, '❌ Não consegui alterar quem pode enviar mensagens.', msg);
  }
}

async function setAntiFlood(sock, jid, msg, args = '') {
  try {
    const info = await requireGroupAdmin(sock, jid, msg);
    if (!info) return;

    const option = args.trim().toLowerCase();

    if (!['on', 'off', 'status'].includes(option)) {
      await send(sock, jid, 'Use *!antflood on*, *!antflood off* ou *!antflood status*.', msg);
      return;
    }

    const settings = getSettings(jid);

    if (option === 'status') {
      await send(
        sock,
        jid,
        `🚫 Anti-flood está *${settings.antiFlood ? 'ATIVADO' : 'DESATIVADO'}*.\nLimite: *10 mensagens em 6 segundos*.`,
        msg
      );
      return;
    }

    settings.antiFlood = option === 'on';
    floodTracker.clear();
    await saveGroupSettings();

    await send(
      sock,
      jid,
      `🚫 Anti-flood *${settings.antiFlood ? 'ATIVADO' : 'DESATIVADO'}*.${settings.antiFlood ? '\n10 mensagens em até 6 segundos removem o membro automaticamente. Administradores são ignorados.' : ''}`,
      msg
    );
  } catch (error) {
    console.error('Falha ao configurar anti-flood:', error?.message || error);
    await send(sock, jid, '❌ Não consegui alterar o anti-flood.', msg);
  }
}

async function handleAntiFlood(sock, jid, msg) {
  if (!jid?.endsWith('@g.us')) return false;
  if (!getSettings(jid).antiFlood) return false;
  if (msg.key.fromMe) return false;

  const sender = msg.key.participant || msg.key.participantAlt;
  if (!sender) return false;

  const key = `${jid}:${sender}`;
  const now = Date.now();
  const history = (floodTracker.get(key) || [])
    .filter((timestamp) => now - timestamp <= FLOOD_WINDOW_MS);

  history.push(now);
  floodTracker.set(key, history);

  if (history.length < FLOOD_LIMIT) {
    return false;
  }

  floodTracker.delete(key);

  try {
    const info = await getGroupMemberInfo(sock, jid, msg);

    if (!info.senderInfo || info.senderInfo.admin) {
      return false;
    }

    const botInfo = findBotParticipant(info.metadata, sock);

    if (!botInfo?.admin) {
      await send(
        sock,
        jid,
        '🛡️ Anti-flood detectou excesso de mensagens, mas a Edith l precisa ser administradora para remover o membro.',
        msg
      );
      return false;
    }

    await sock.groupParticipantsUpdate(jid, [info.senderInfo.id], 'remove');

    await sock.sendMessage(
      jid,
      {
        text: `🚫 ${mentionLabel(info.senderInfo.id)} foi removido(a) por flood.\nLimite: *10 mensagens em 6 segundos*.`,
        mentions: [info.senderInfo.id]
      },
      { quoted: msg }
    );

    return true;
  } catch (error) {
    console.error('Falha no anti-flood:', error?.message || error);
    return false;
  }
}

async function setWelcome(sock, jid, msg, args = '') {
  try {
    const info = await requireGroupAdmin(sock, jid, msg);
    if (!info) return;

    const option = args.trim().toLowerCase();

    if (!['on', 'off', 'status'].includes(option)) {
      await send(
        sock,
        jid,
        'Use *!boasvindas on*, *!boasvindas off* ou *!boasvindas status*.',
        msg
      );
      return;
    }

    const settings = getSettings(jid);

    if (option === 'status') {
      await send(
        sock,
        jid,
        `👋 Boas-vindas automáticas estão *${settings.welcome ? 'ATIVADAS' : 'DESATIVADAS'}*.`,
        msg
      );
      return;
    }

    settings.welcome = option === 'on';
    await saveGroupSettings();

    await send(
      sock,
      jid,
      `👋 Boas-vindas automáticas *${settings.welcome ? 'ATIVADAS' : 'DESATIVADAS'}*.`,
      msg
    );
  } catch (error) {
    console.error('Falha ao configurar boas-vindas:', error?.message || error);
    await send(sock, jid, '❌ Não consegui alterar as boas-vindas.', msg);
  }
}

async function showProfile(sock, jid, msg) {
  if (!jid.endsWith('@g.us')) {
    await send(sock, jid, '🚫 O comando *!perfil* funciona em grupos.', msg);
    return;
  }

  try {
    const metadata = await sock.groupMetadata(jid);
    const target = getTargetParticipant(metadata, msg, true);

    if (!target) {
      await send(sock, jid, '❌ Não consegui identificar esse membro.', msg);
      return;
    }

    const settings = getSettings(jid);
    const warnings = settings.warnings[participantKey(target)] || [];
    const role = target.admin ? 'Administrador' : 'Membro';

    await sock.sendMessage(
      jid,
      {
        text:
          `👤 *PERFIL*\n\n` +
          `Membro: ${mentionLabel(target.id)}\n` +
          `Cargo: *${role}*\n` +
          `Advertências: *${warnings.length}*\n` +
          `Grupo: *${metadata.subject}*` +
          (warnings.length
            ? `\n\n⚠️ *Últimos motivos*\n${warnings
                .slice(-3)
                .reverse()
                .map((warning, index) => `${index + 1}. ${warning.reason || 'Sem motivo'}`)
                .join('\n')}`
            : ''),
        mentions: [target.id]
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no !perfil:', error?.message || error);
    await send(sock, jid, '❌ Não consegui abrir esse perfil.', msg);
  }
}

function formatUptime(totalSeconds) {
  const seconds = Math.floor(totalSeconds);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  return [
    days ? `${days}d` : '',
    hours ? `${hours}h` : '',
    minutes ? `${minutes}m` : '',
    `${remainingSeconds}s`
  ].filter(Boolean).join(' ');
}

async function sendStatus(sock, jid, msg) {
  const rawTimestamp = Number(msg.messageTimestamp || 0);
  const sentAtMs = rawTimestamp > 0 ? rawTimestamp * 1000 : Date.now();
  const latency = Math.max(0, Date.now() - sentAtMs);
  const ramMb = process.memoryUsage().rss / 1024 / 1024;

  let groupLines = '';

  if (jid.endsWith('@g.us')) {
    const settings = getSettings(jid);
    groupLines =
      `\n\n🛡️ Anti-link: *${settings.antiLink ? 'ON' : 'OFF'}*` +
      `\n🚫 Anti-flood: *${settings.antiFlood ? 'ON' : 'OFF'}*` +
      `\n👋 Boas-vindas: *${settings.welcome ? 'ON' : 'OFF'}*`;
  }

  await send(
    sock,
    jid,
    `🤖 *EDITH l • STATUS*\n\n🟢 Online\n⚡ Ping: *${latency} ms*\n⏱️ Uptime: *${formatUptime(process.uptime())}*\n💾 Memória: *${ramMb.toFixed(1)} MB*\n⚙️ Node: *${process.version}*${groupLines}`,
    msg
  );
}

async function banMember(sock, jid, msg) {
  if (!jid.endsWith('@g.us')) {
    await send(sock, jid, '🚫 O comando *!ban* só funciona em grupos.', msg);
    return;
  }

  try {
    const metadata = await sock.groupMetadata(jid);

    const sender = msg.key.participant || msg.key.remoteJid;
    const senderAlt = msg.key.participantAlt;
    const senderInfo = metadata.participants.find((participant) =>
      participantMatches(participant, sender, senderAlt)
    );

    if (!senderInfo?.admin) {
      await send(sock, jid, '⛔ Apenas administradores do grupo podem usar *!ban*.', msg);
      return;
    }

    const contextInfo = getContextInfo(msg.message);
    const target =
      contextInfo?.participant ||
      contextInfo?.participantAlt ||
      contextInfo?.mentionedJid?.[0];

    if (!target) {
      await send(
        sock,
        jid,
        '👤 Responda à mensagem da pessoa com *!ban* ou use *!ban @membro*.',
        msg
      );
      return;
    }

    if (
      areJidsSameUser(target, sender) ||
      (senderAlt && areJidsSameUser(target, senderAlt))
    ) {
      await send(sock, jid, '⚠️ Você não pode usar *!ban* em si mesmo.', msg);
      return;
    }

    const targetInfo = metadata.participants.find((participant) =>
      participantMatches(participant, target)
    );

    if (!targetInfo) {
      await send(sock, jid, '🔎 Não encontrei esse membro no grupo.', msg);
      return;
    }

    const botIds = [
      sock.user?.id,
      sock.user?.lid
    ].filter(Boolean);

    const botInfo = metadata.participants.find((participant) =>
      participantMatches(participant, ...botIds)
    );

    if (!botInfo?.admin) {
      console.log('[BAN DEBUG] Não encontrei Edith como admin.', {
        botIds,
        addressingMode: metadata.addressingMode,
        participants: metadata.participants.map((participant) => ({
          id: participant.id,
          phoneNumber: participant.phoneNumber,
          lid: participant.lid,
          admin: participant.admin
        }))
      });

      await send(
        sock,
        jid,
        '🛡️ Não consegui reconhecer a Edith l como administradora. Vou precisar atualizar a identificação do bot neste grupo.',
        msg
      );
      return;
    }

    await sock.groupParticipantsUpdate(jid, [targetInfo.id], 'remove');

    addAdminLog(jid, 'BAN', senderInfo, targetInfo);
    await saveGroupSettings();

    await sock.sendMessage(
      jid,
      {
        text: '🚫 Membro removido do grupo.',
        mentions: [targetInfo.id]
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no comando !ban:', error?.message || error);
    await send(sock, jid, '❌ Não consegui remover esse membro. Verifique as permissões de administrador da Edith l.', msg);
  }
}

function getImageMessage(message) {
  if (!message) return null;

  if (message.imageMessage) return message.imageMessage;
  if (message.ephemeralMessage?.message) return getImageMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return getImageMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return getImageMessage(message.viewOnceMessageV2.message);

  const contextInfo =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.documentMessage?.contextInfo ||
    message.stickerMessage?.contextInfo;

  if (contextInfo?.quotedMessage) {
    return getImageMessage(contextInfo.quotedMessage);
  }

  return null;
}

function getVideoMessage(message) {
  if (!message) return null;

  if (message.videoMessage) return message.videoMessage;
  if (message.ephemeralMessage?.message) return getVideoMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return getVideoMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return getVideoMessage(message.viewOnceMessageV2.message);

  const contextInfo =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.documentMessage?.contextInfo ||
    message.stickerMessage?.contextInfo;

  if (contextInfo?.quotedMessage) {
    return getVideoMessage(contextInfo.quotedMessage);
  }

  return null;
}

function getStickerMessage(message) {
  if (!message) return null;

  if (message.stickerMessage) return message.stickerMessage;
  if (message.ephemeralMessage?.message) return getStickerMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return getStickerMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return getStickerMessage(message.viewOnceMessageV2.message);

  const contextInfo =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.documentMessage?.contextInfo ||
    message.stickerMessage?.contextInfo;

  if (contextInfo?.quotedMessage) {
    return getStickerMessage(contextInfo.quotedMessage);
  }

  return null;
}

async function downloadMessageBuffer(mediaMessage, mediaType) {
  const stream = await downloadContentFromMessage(mediaMessage, mediaType);
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function imageToStickerBuffer(imageMessage, mode = 'normal') {
  const imageBuffer = await downloadMessageBuffer(imageMessage, 'image');
  const isSquareMode = mode === 'str';

  return sharp(imageBuffer)
    .rotate()
    .resize(
      512,
      512,
      isSquareMode
        ? {
            fit: 'cover',
            position: 'centre'
          }
        : {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          }
    )
    .webp({ quality: 86 })
    .toBuffer();
}

async function videoToStickerBuffer(videoMessage, mode = 'normal') {
  if (!ffmpegPath) {
    throw new Error('FFmpeg não está disponível.');
  }

  const videoBuffer = await downloadMessageBuffer(videoMessage, 'video');
  const tempDir = await mkdtemp(join(tmpdir(), 'edith-sticker-'));
  const inputPath = join(tempDir, 'input.mp4');
  const outputPath = join(tempDir, 'output.webp');

  try {
    await writeFile(inputPath, videoBuffer);

    const videoFilter =
      mode === 'str'
        ? 'fps=12,scale=512:512:force_original_aspect_ratio=increase,crop=512:512,format=rgba'
        : 'fps=12,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba';

    await execFileAsync(
      ffmpegPath,
      [
        '-y',
        '-i', inputPath,
        '-t', '6',
        '-vf', videoFilter,
        '-an',
        '-c:v', 'libwebp',
        '-lossless', '0',
        '-compression_level', '6',
        '-q:v', '58',
        '-loop', '0',
        '-preset', 'picture',
        outputPath
      ],
      { maxBuffer: 10 * 1024 * 1024 }
    );

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function videoToMp3Buffer(videoMessage) {
  if (!ffmpegPath) {
    throw new Error('FFmpeg não está disponível.');
  }

  const videoBuffer = await downloadMessageBuffer(videoMessage, 'video');
  const tempDir = await mkdtemp(join(tmpdir(), 'edith-mp3-'));
  const inputPath = join(tempDir, 'input.mp4');
  const outputPath = join(tempDir, 'audio.mp3');

  try {
    await writeFile(inputPath, videoBuffer);

    await execFileAsync(
      ffmpegPath,
      [
        '-y',
        '-i', inputPath,
        '-vn',
        '-codec:a', 'libmp3lame',
        '-b:a', '192k',
        outputPath
      ],
      { maxBuffer: 10 * 1024 * 1024 }
    );

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function sendToMp3(sock, jid, msg) {
  const videoMessage = getVideoMessage(msg.message);

  if (!videoMessage) {
    await send(
      sock,
      jid,
      '🎵 Responda a um vídeo com *!tomp3* para extrair o áudio.',
      msg
    );
    return;
  }

  try {
    const audio = await videoToMp3Buffer(videoMessage);

    await sock.sendMessage(
      jid,
      {
        audio,
        mimetype: 'audio/mpeg',
        ptt: false,
        fileName: 'edith-audio.mp3'
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no !tomp3:', error?.message || error);
    await send(sock, jid, '❌ Não consegui extrair o áudio desse vídeo.', msg);
  }
}

async function stickerToImageBuffer(stickerMessage) {
  const stickerBuffer = await downloadMessageBuffer(stickerMessage, 'sticker');

  return sharp(stickerBuffer, { page: 0, pages: 1 })
    .png()
    .toBuffer();
}

async function sendSticker(sock, jid, msg, args = '') {
  const imageMessage = getImageMessage(msg.message);
  const videoMessage = getVideoMessage(msg.message);

  if (!imageMessage && !videoMessage) {
    await send(
      sock,
      jid,
      '🎞️ Envie ou responda uma *imagem* ou *vídeo* com *!s*.\n\nUse *!s -str* para preencher o formato quadrado.',
      msg
    );
    return;
  }

  try {
    const mode = args.toLowerCase().includes('-str') ? 'str' : 'normal';
    const sticker = imageMessage
      ? await imageToStickerBuffer(imageMessage, mode)
      : await videoToStickerBuffer(videoMessage, mode);

    await sock.sendMessage(jid, { sticker }, { quoted: msg });
  } catch (error) {
    console.error('Falha ao criar figurinha:', error?.message || error);
    await send(sock, jid, '❌ Não consegui transformar esse conteúdo em figurinha.', msg);
  }
}

async function sendToImage(sock, jid, msg) {
  const stickerMessage = getStickerMessage(msg.message);

  if (!stickerMessage) {
    await send(
      sock,
      jid,
      '🖼️ Responda a uma figurinha com *!toimg* para transformar em foto.',
      msg
    );
    return;
  }

  try {
    const image = await stickerToImageBuffer(stickerMessage);

    await sock.sendMessage(
      jid,
      {
        image,
        mimetype: 'image/png',
        caption: '🖼️ Figurinha convertida em foto.'
      },
      { quoted: msg }
    );
  } catch (error) {
    console.error('Falha no comando !toimg:', error?.message || error);
    await send(sock, jid, '❌ Não consegui transformar essa figurinha em foto.', msg);
  }
}

async function handleQuizAnswer(sock, jid, text, msg) {
  const quiz = pendingQuiz.get(jid);
  if (!quiz) return false;

  const answer = text.trim().toUpperCase();
  if (!['A', 'B', 'C', 'D'].includes(answer)) return false;

  pendingQuiz.delete(jid);

  if (answer === quiz.answer) {
    await send(sock, jid, `✅ *Acertou!*\n${quiz.explanation}`, msg);
  } else {
    await send(sock, jid, `❌ Não foi dessa vez. A resposta correta era *${quiz.answer}*.\n${quiz.explanation}`, msg);
  }

  return true;
}

async function runTmdbCommand(sock, jid, msg, action) {
  try {
    const result = await action();
    if (!result) {
      await send(sock, jid, '🔎 Não encontrei esse título. Confira o nome e tente novamente.', msg);
      return;
    }
    await send(sock, jid, result, msg);
  } catch (error) {
    await send(sock, jid, tmdbErrorMessage(error), msg);
  }
}

async function startEdith() {
  await loadGroupSettings();
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: state,
    logger
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

  let joinRequestTimer = null;

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      pairingCodeRequested = false;
      console.log(`${config.botName} conectada ao WhatsApp.`);

      if (joinRequestTimer) clearInterval(joinRequestTimer);

      pollBrazilJoinRequests(sock).catch((error) => {
        console.error('Falha na verificação inicial de solicitações:', error?.message || error);
      });

      joinRequestTimer = setInterval(() => {
        pollBrazilJoinRequests(sock).catch((error) => {
          console.error('Falha ao verificar solicitações:', error?.message || error);
        });
      }, 15000);
    }

    if (connection === 'close') {
      if (joinRequestTimer) {
        clearInterval(joinRequestTimer);
        joinRequestTimer = null;
      }
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('Conexão encerrada.', shouldReconnect ? 'Reconectando...' : 'Sessão desconectada.');
      if (shouldReconnect) startEdith();
    }
  });

  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    if (action !== 'add') return;
    if (!getSettings(id).welcome) return;

    try {
      const metadata = await sock.groupMetadata(id);
      const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean);

      const participantIds = (participants || [])
        .map((participant) => {
          if (typeof participant === 'string') return participant;
          return participant?.phoneNumber || participant?.id || participant?.lid;
        })
        .filter(Boolean)
        .filter((participantJid) =>
          !botIds.some((botJid) => areJidsSameUser(participantJid, botJid))
        );

      if (!participantIds.length) return;

      await sock.sendMessage(id, {
        text:
          `👋 *Bem-vindo(a) ao ${metadata.subject}!*\n\n` +
          `${participantIds.map((participantJid) => mentionLabel(participantJid)).join(', ')}\n` +
          `🎬 Leia *!regras* e use *!menu* para conhecer a Edith l.\n` +
          `👥 Agora somos *${metadata.participants.length} membros*.`,
        mentions: participantIds
      });
    } catch (error) {
      console.error('Falha nas boas-vindas:', error?.message || error);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message) continue;
      if (isDuplicateMessage(msg)) continue;

      const jid = msg.key.remoteJid;
      if (!jid) continue;

      trackActivity(jid, msg);

      if (await handleAntiFlood(sock, jid, msg)) continue;

      const text = getText(msg.message);
      if (!text) continue;

      if (await handleAntiLink(sock, jid, text, msg)) continue;
      if (await handleQuizAnswer(sock, jid, text, msg)) continue;
      if (!text.startsWith(config.prefix)) continue;

      const { command, args } = parseCommand(text);
      if (!command) continue;

      switch (command) {
        case 'menu':
        case 'ajuda':
          await send(sock, jid, menuText(), msg);
          break;

        case 'menuadm':
        case 'adm': {
          const info = await requireGroupAdmin(sock, jid, msg);
          if (!info) break;
          await send(sock, jid, adminMenuText(), msg);
          break;
        }

        case 'ping': {
          const rawTimestamp = Number(msg.messageTimestamp || 0);
          const sentAtMs = rawTimestamp > 0 ? rawTimestamp * 1000 : Date.now();
          const latency = Math.max(0, Date.now() - sentAtMs);

          await send(
            sock,
            jid,
            `🏓 *Pong!*\n⚡ Velocidade: *${latency} ms*\n🤖 Edith l está online.`,
            msg
          );
          break;
        }

        case 's':
          await sendSticker(sock, jid, msg, args);
          break;

        case 'toimg':
          await sendToImage(sock, jid, msg);
          break;

        case 'tomp3':
          await sendToMp3(sock, jid, msg);
          break;

        case 'perfil':
          await showProfile(sock, jid, msg);
          break;

        case 'status':
          await sendStatus(sock, jid, msg);
          break;

        case 'config':
          await showConfig(sock, jid, msg);
          break;

        case 'atividade':
          await showActivity(sock, jid, msg);
          break;

        case 'ranking':
          await showRanking(sock, jid, msg);
          break;

        case 'membros':
          await showMembers(sock, jid, msg);
          break;

        case 'linkgrupo':
          await sendGroupLink(sock, jid, msg);
          break;

        case 'setdesc':
          await setGroupDescription(sock, jid, msg, args);
          break;

        case 'ban':
          await banMember(sock, jid, msg);
          break;

        case 'adv':
          await warnMember(sock, jid, msg, args);
          break;

        case 'remadv':
        case 'desadv':
          await removeWarning(sock, jid, msg);
          break;

        case 'advs':
          await showWarnings(sock, jid, msg);
          break;

        case 'limparadv':
          await clearWarnings(sock, jid, msg);
          break;

        case 'logs':
          await showAdminLogs(sock, jid, msg);
          break;

        case 'promover':
          await changeAdminRole(sock, jid, msg, 'promote');
          break;

        case 'rebaixar':
          await changeAdminRole(sock, jid, msg, 'demote');
          break;

        case 'admins':
          await listAdmins(sock, jid, msg);
          break;

        case 'fechar':
          await setGroupChatState(sock, jid, msg, false);
          break;

        case 'abrir':
          await setGroupChatState(sock, jid, msg, true);
          break;

        case 'antflood':
          await setAntiFlood(sock, jid, msg, args);
          break;

        case 'boasvindas':
          await setWelcome(sock, jid, msg, args);
          break;

        case 'autoaceitar':
          await setAutoApproveBrazil(sock, jid, msg, args);
          break;

        case 'antilink':
          await setAntiLink(sock, jid, msg, args);
          break;

        case 'regras':
          await send(sock, jid, rulesText, msg);
          break;

        case 'grupo':
          await send(sock, jid, groupText, msg);
          break;

        case 'filme':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}filme Interestelar*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => movieInfo(args));
          break;

        case 'serie':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}serie Dark*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => seriesInfo(args));
          break;

        case 'sinopse':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}sinopse Clube da Luta*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => synopsis(args));
          break;

        case 'nota':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}nota Parasita*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => rating(args));
          break;

        case 'elenco':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}elenco Batman*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => cast(args));
          break;

        case 'trailer':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}trailer Oppenheimer*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => trailer(args));
          break;

        case 'ondeassistir':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}ondeassistir Duna*`, msg);
            break;
          }
          await runTmdbCommand(sock, jid, msg, () => watchProviders(args));
          break;

        case 'emcartaz':
          await runTmdbCommand(sock, jid, msg, nowPlaying);
          break;

        case 'lancamentos':
          await runTmdbCommand(sock, jid, msg, upcoming);
          break;

        case 'topfilmes':
          await runTmdbCommand(sock, jid, msg, topMovies);
          break;

        case 'topseries':
          await runTmdbCommand(sock, jid, msg, topSeries);
          break;

        case 'recomendar':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}recomendar ficção científica*`, msg);
            break;
          }
          try {
            const result = await recommend(args);
            if (result?.error === 'GENRE') {
              await send(sock, jid, '🎭 Gênero não reconhecido. Exemplos: ação, aventura, comédia, drama, fantasia, terror, romance, suspense, animação, documentário ou ficção científica.', msg);
              break;
            }
            await send(sock, jid, result?.text || 'Não encontrei recomendações agora.', msg);
          } catch (error) {
            await send(sock, jid, tmdbErrorMessage(error), msg);
          }
          break;

        case 'quiz': {
          const quiz = randomItem(quizzes);
          pendingQuiz.set(jid, quiz);
          await send(
            sock,
            jid,
            `🎲 *QUIZ CINE LOUNGE*\n\n${quiz.question}\n\n${quiz.options.join('\n')}\n\nResponda somente com *A*, *B*, *C* ou *D*.`,
            msg
          );
          break;
        }

        case 'duelo': {
          const [left, right] = args.split('|').map((item) => item?.trim()).filter(Boolean);
          if (!left || !right) {
            await send(sock, jid, `Exemplo: *${config.prefix}duelo Interestelar | Matrix*`, msg);
            break;
          }

          await send(
            sock,
            jid,
            `⚔️ *DUELO DE FILMES*\n\n🎬 A: *${left}*\n🎬 B: *${right}*\n\nQual vence? Responda com *A* ou *B* e diga o motivo.`,
            msg
          );
          break;
        }

        case 'avaliar': {
          const match = args.match(/^(.*)\s+(10(?:\.0)?|[0-9](?:\.\d)?)$/);
          if (!match) {
            await send(sock, jid, `Exemplo: *${config.prefix}avaliar Interestelar 9.5*`, msg);
            break;
          }

          const title = match[1].trim();
          const score = Number(match[2]);
          if (!title || score < 0 || score > 10) {
            await send(sock, jid, 'A nota precisa estar entre *0 e 10*.', msg);
            break;
          }

          const key = `${jid}:${title.toLowerCase()}`;
          ratings.set(key, { title, score, updatedAt: Date.now() });
          await send(sock, jid, `⭐ Avaliação registrada: *${title}* — *${score}/10*`, msg);
          break;
        }

        case 'bug':
          if (!args) {
            await send(sock, jid, `Exemplo: *${config.prefix}bug o comando quiz não respondeu*`, msg);
            break;
          }
          console.log(`[BUG] jid=${jid} relato=${args}`);
          await send(sock, jid, '🐞 Relato recebido. Obrigado por avisar!', msg);
          break;

        default:
          await send(
            sock,
            jid,
            `Comando *${config.prefix}${command}* ainda não foi ativado. Use *${config.prefix}menu*.`,
            msg
          );
      }
    }
  });
}

startEdith().catch((error) => {
  console.error('Falha ao iniciar Edith l:', error);
  process.exit(1);
});
