import { areJidsSameUser } from '@whiskeysockets/baileys';
import { essentialGroup, recordGroupActivity, scheduleEssentialSave, essentialUserKey } from './essential-state.js';

const spamTracker = new Map();
const TRUTHS = [
  'Qual foi a última coisa que você pesquisou no celular?',
  'Qual filme ou série todo mundo ama e você não gosta?',
  'Qual hábito seu você gostaria de mudar?',
  'Qual foi a situação mais engraçada que já aconteceu com você?',
  'Qual talento você gostaria de aprender instantaneamente?',
  'Qual foi a melhor recomendação que alguém já te deu?'
];
const CHALLENGES = [
  'Mande um áudio de 5 segundos imitando um personagem.',
  'Escolha um filme para o grupo avaliar de 0 a 10.',
  'Descreva seu filme favorito usando apenas 3 emojis.',
  'Envie uma recomendação que quase ninguém do grupo conhece.',
  'Troque sua foto do grupo por 10 minutos por algo relacionado a cinema.',
  'Faça uma pergunta de quiz para o grupo.'
];

function jidDigits(value = '') {
  return String(value).split('@')[0].split(':')[0].replace(/\D/g, '');
}

function participantMatches(participant, ...ids) {
  const values = [participant?.id, participant?.phoneNumber, participant?.lid].filter(Boolean);
  return ids.filter(Boolean).some((id) => values.some((value) => {
    try { if (areJidsSameUser(value, id)) return true; } catch {}
    const a = jidDigits(value); const b = jidDigits(id);
    return a && b && a === b;
  }));
}

function participantKey(participant) {
  const phone = [participant?.phoneNumber, participant?.id].map(jidDigits).find((value) => value.length >= 10);
  if (phone) return `pn:${phone}`;
  return `jid:${participant?.lid || participant?.id || participant?.phoneNumber || 'unknown'}`;
}

function senderIds(msg) {
  return [msg?.key?.participantPn, msg?.key?.participantAlt, msg?.key?.participant, msg?.key?.remoteJid].filter(Boolean);
}

async function groupInfo(sock, jid, msg) {
  if (!jid.endsWith('@g.us')) return null;
  const metadata = await sock.groupMetadata(jid);
  const sender = metadata.participants.find((participant) => participantMatches(participant, ...senderIds(msg))) || null;
  const bot = metadata.participants.find((participant) => participantMatches(participant, sock.user?.id, sock.user?.lid)) || null;
  return { metadata, sender, bot };
}

async function requireAdmin(ctx) {
  const { sock, jid, msg, isOwner } = ctx;
  if (!jid.endsWith('@g.us')) {
    await sock.sendMessage(jid, { text: '🚫 Esse comando só funciona em grupos.' }, { quoted: msg });
    return null;
  }
  try {
    const info = await groupInfo(sock, jid, msg);
    if (!info?.sender?.admin && !isOwner) {
      await sock.sendMessage(jid, { text: '⛔ Apenas administradores ou o dono da Rimuru podem usar esse comando.' }, { quoted: msg });
      return null;
    }
    return info;
  } catch {
    await sock.sendMessage(jid, { text: '❌ Não consegui consultar as permissões do grupo.' }, { quoted: msg });
    return null;
  }
}

async function send(sock, jid, msg, text, mentions = []) {
  await sock.sendMessage(jid, { text, mentions }, { quoted: msg });
}

function mention(jid = '') {
  const value = jidDigits(jid) || String(jid).split('@')[0];
  return value ? `@${value}` : '@membro';
}

function weekCount(entry, days = 7) {
  const cutoff = Date.now() - days * 86400000;
  let total = 0;
  for (const [day, count] of Object.entries(entry?.days || {})) {
    if (Date.parse(`${day}T23:59:59Z`) >= cutoff) total += Number(count || 0);
  }
  return total;
}

function rankingRows(group, metadata, weekly = false, limit = 10) {
  return Object.entries(group.activity || {})
    .map(([key, entry]) => ({ key, entry, total: weekly ? weekCount(entry) : Number(entry?.messages || 0) }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((row, index) => {
      const phone = row.key.startsWith('pn:') ? row.key.slice(3) : '';
      const participant = phone ? metadata.participants.find((p) => [p.phoneNumber, p.id].some((v) => jidDigits(v) === phone)) : null;
      const label = participant ? mention(participant.id) : phone ? `@${phone}` : 'membro';
      return { text: `${index + 1}. ${label} — *${row.total}*`, jid: participant?.id || (phone ? `${phone}@s.whatsapp.net` : '') };
    });
}

function parseEventDate(raw) {
  const match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(String(raw || '').trim());
  if (!match) return 0;
  const day = Number(match[1]); const month = Number(match[2]); const year = Number(match[3]);
  const hour = Number(match[4] || 19); const minute = Number(match[5] || 0);
  const timestamp = Date.UTC(year, month - 1, day, hour + 4, minute, 0);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatEventDate(timestamp) {
  return new Date(timestamp).toLocaleString('pt-BR', { timeZone: 'America/Boa_Vista', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export async function observeEssentialMessage({ sock, jid, msg, text = '', isGroupAllowed = true }) {
  if (!jid?.endsWith('@g.us') || !isGroupAllowed || msg?.key?.fromMe) return false;
  const userKey = await essentialUserKey(sock, msg);
  recordGroupActivity(jid, userKey);
  const group = essentialGroup(jid);
  if (!group.antiSpam && !group.wordFilter && !group.automod) return false;

  let info;
  try { info = await groupInfo(sock, jid, msg); } catch { return false; }
  if (!info?.sender || info.sender.admin) return false;
  const normalized = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');

  if (group.wordFilter && normalized) {
    const hit = (group.blockedWords || []).find((word) => normalized.includes(String(word).toLowerCase()));
    if (hit) {
      try { if (info.bot?.admin) await sock.sendMessage(jid, { delete: msg.key }); } catch {}
      await send(sock, jid, msg, `🚫 ${mention(info.sender.id)}, mensagem bloqueada pelo filtro de palavras.`, [info.sender.id]);
      return true;
    }
  }

  if (group.antiSpam || group.automod) {
    const trackerKey = `${jid}:${participantKey(info.sender)}`;
    const now = Date.now();
    const history = (spamTracker.get(trackerKey) || []).filter((entry) => now - entry.at <= 12000);
    history.push({ at: now, text: normalized });
    spamTracker.set(trackerKey, history);
    const lastSix = history.filter((entry) => now - entry.at <= 6000);
    const repeats = normalized ? history.filter((entry) => entry.text === normalized).length : 0;
    const excessiveMentions = (msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || []).length >= 12;
    const suspicious = lastSix.length >= 9 || repeats >= 4 || (group.automod && excessiveMentions);
    if (suspicious) {
      try { if (info.bot?.admin) await sock.sendMessage(jid, { delete: msg.key }); } catch {}
      await send(sock, jid, msg, `🛡️ ${mention(info.sender.id)}, o AntiSpam detectou comportamento repetitivo. Diminua a frequência das mensagens.`, [info.sender.id]);
      return true;
    }
  }
  return false;
}

export async function handleEssentialParticipantUpdate({ sock, id, participants = [], action, isGroupAllowed = true }) {
  if (!id?.endsWith('@g.us') || !isGroupAllowed) return;
  const group = essentialGroup(id);
  if (action === 'remove' && group.farewell) {
    const ids = participants.map((item) => typeof item === 'string' ? item : item?.phoneNumber || item?.id || item?.lid).filter(Boolean);
    if (!ids.length) return;
    const custom = String(group.custom?.farewell || '').trim();
    const text = custom || `👋 ${ids.map(mention).join(', ')} saiu do grupo. Até a próxima!`;
    try { await sock.sendMessage(id, { text, mentions: ids }); } catch {}
  }
}

export const ESSENTIAL_GROUP_COMMANDS = new Set([
  'antispam', 'antipalavra', 'despedida', 'tagall', 'tagativos', 'relatorio', 'automod',
  'backupgrupo', 'restaurargrupo', 'personalizarbot', 'sorteio', 'enquete', 'verdade', 'desafio',
  'ranksemana', 'topativos', 'evento', 'contador'
]);

export async function handleEssentialGroup(ctx) {
  const { sock, jid, msg, command, args } = ctx;
  const group = essentialGroup(jid);

  if (['antispam', 'antipalavra', 'despedida', 'automod', 'backupgrupo', 'restaurargrupo', 'personalizarbot', 'tagall', 'tagativos', 'relatorio'].includes(command)) {
    const info = await requireAdmin(ctx);
    if (!info) return true;

    if (command === 'antispam' || command === 'despedida' || command === 'automod') {
      const option = String(args || '').trim().toLowerCase();
      if (!['on', 'off', 'status'].includes(option)) { await send(sock, jid, msg, `Use *!${command} on*, *!${command} off* ou *!${command} status*.`); return true; }
      const key = command === 'antispam' ? 'antiSpam' : command === 'despedida' ? 'farewell' : 'automod';
      if (option !== 'status') { group[key] = option === 'on'; scheduleEssentialSave(); }
      await send(sock, jid, msg, `${command === 'automod' ? '🧠' : '🛡️'} *${command.toUpperCase()}*: ${group[key] ? 'ATIVADO' : 'DESATIVADO'}.`);
      return true;
    }

    if (command === 'antipalavra') {
      const input = String(args || '').trim();
      const [action = '', ...rest] = input.split(/\s+/u);
      const value = rest.join(' ').trim().toLowerCase();
      if (['on', 'off'].includes(action.toLowerCase())) {
        group.wordFilter = action.toLowerCase() === 'on'; scheduleEssentialSave();
        await send(sock, jid, msg, `🚫 Filtro de palavras *${group.wordFilter ? 'ATIVADO' : 'DESATIVADO'}*.`); return true;
      }
      if (action.toLowerCase() === 'add' && value) {
        if (!group.blockedWords.includes(value)) group.blockedWords.push(value);
        group.wordFilter = true; scheduleEssentialSave();
        await send(sock, jid, msg, `✅ Palavra/expressão adicionada: *${value}*.`); return true;
      }
      if (['rem', 'del', 'remove'].includes(action.toLowerCase()) && value) {
        group.blockedWords = group.blockedWords.filter((word) => word !== value); scheduleEssentialSave();
        await send(sock, jid, msg, `✅ Removido do filtro: *${value}*.`); return true;
      }
      if (action.toLowerCase() === 'list') {
        await send(sock, jid, msg, `🚫 *PALAVRAS BLOQUEADAS*\n${group.blockedWords.length ? group.blockedWords.map((word) => `• ${word}`).join('\n') : 'Nenhuma.'}`); return true;
      }
      await send(sock, jid, msg, 'Use *!antipalavra on/off*, *!antipalavra add palavra*, *!antipalavra rem palavra* ou *!antipalavra list*.');
      return true;
    }

    if (command === 'tagall' || command === 'tagativos') {
      const now = Date.now();
      let members = info.metadata.participants.filter((p) => !participantMatches(p, sock.user?.id, sock.user?.lid));
      if (command === 'tagativos') {
        members = members.filter((participant) => {
          const entry = group.activity[participantKey(participant)];
          return entry && now - Number(entry.lastAt || 0) <= 7 * 86400000;
        });
      }
      if (!members.length) { await send(sock, jid, msg, 'ℹ️ Não encontrei membros para marcar.'); return true; }
      const message = String(args || '').trim() || (command === 'tagativos' ? '📣 Chamando os membros ativos:' : '📣 Atenção, pessoal:');
      await send(sock, jid, msg, `${message}\n\n${members.map((p) => mention(p.id)).join(' ')}`, members.map((p) => p.id));
      return true;
    }

    if (command === 'relatorio') {
      const weekly = String(args || '').trim().toLowerCase() === 'semanal';
      const rows = rankingRows(group, info.metadata, weekly, 10);
      const mentions = rows.map((row) => row.jid).filter(Boolean);
      const totalMessages = Object.values(group.activity || {}).reduce((sum, entry) => sum + (weekly ? weekCount(entry) : Number(entry?.messages || 0)), 0);
      const active = Object.values(group.activity || {}).filter((entry) => Date.now() - Number(entry?.lastAt || 0) <= 7 * 86400000).length;
      await send(sock, jid, msg, `📊 *RELATÓRIO ${weekly ? 'SEMANAL' : 'DO GRUPO'}*\nGrupo: *${info.metadata.subject}*\nMembros: *${info.metadata.participants.length}*\nAtivos em 7 dias: *${active}*\nMensagens observadas${weekly ? ' na semana' : ''}: *${totalMessages}*\n\n🏆 *Top atividade*\n${rows.length ? rows.map((row) => row.text).join('\n') : 'Sem dados suficientes.'}`, mentions);
      return true;
    }

    if (command === 'backupgrupo') {
      group.backups.push({ at: Date.now(), data: { antiSpam: group.antiSpam, wordFilter: group.wordFilter, blockedWords: [...group.blockedWords], farewell: group.farewell, automod: group.automod, custom: { ...group.custom } } });
      if (group.backups.length > 5) group.backups = group.backups.slice(-5);
      scheduleEssentialSave();
      await send(sock, jid, msg, '💾 Backup das configurações da Rimuru neste grupo criado com sucesso.');
      return true;
    }

    if (command === 'restaurargrupo') {
      const backup = group.backups[group.backups.length - 1];
      if (!backup) { await send(sock, jid, msg, 'ℹ️ Não existe backup para este grupo.'); return true; }
      Object.assign(group, JSON.parse(JSON.stringify(backup.data)));
      group.backups ??= [backup]; scheduleEssentialSave();
      await send(sock, jid, msg, `♻️ Configurações restauradas do backup de *${new Date(backup.at).toLocaleString('pt-BR', { timeZone: 'America/Boa_Vista' })}*.`);
      return true;
    }

    if (command === 'personalizarbot') {
      const input = String(args || '').trim();
      const [field = '', ...rest] = input.split(/\s+/u);
      const value = rest.join(' ').trim().slice(0, 500);
      if (!['nome', 'despedida', 'boasvindas'].includes(field.toLowerCase()) || !value) {
        await send(sock, jid, msg, 'Use *!personalizarbot nome Texto*, *!personalizarbot despedida Texto* ou *!personalizarbot boasvindas Texto*.'); return true;
      }
      if (field.toLowerCase() === 'nome') group.custom.name = value.slice(0, 40);
      if (field.toLowerCase() === 'despedida') group.custom.farewell = value;
      if (field.toLowerCase() === 'boasvindas') group.custom.welcome = value;
      scheduleEssentialSave();
      await send(sock, jid, msg, '🎨 Personalização salva para este grupo.');
      return true;
    }
  }

  if (command === 'sorteio') {
    if (!jid.endsWith('@g.us')) { await send(sock, jid, msg, '🎲 O sorteio funciona em grupos.'); return true; }
    const info = await groupInfo(sock, jid, msg);
    let count = Math.max(1, Math.min(10, Number(String(args || '').trim()) || 1));
    const candidates = info.metadata.participants.filter((p) => !participantMatches(p, sock.user?.id, sock.user?.lid));
    if (!candidates.length) { await send(sock, jid, msg, 'Não há participantes suficientes.'); return true; }
    count = Math.min(count, candidates.length);
    const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, count);
    await send(sock, jid, msg, `🎉 *SORTEIO*\n${shuffled.map((p, i) => `${i + 1}. ${mention(p.id)}`).join('\n')}`, shuffled.map((p) => p.id));
    return true;
  }

  if (command === 'enquete') {
    if (!jid.endsWith('@g.us')) { await send(sock, jid, msg, '📊 A enquete funciona em grupos.'); return true; }
    const parts = String(args || '').split('|').map((value) => value.trim()).filter(Boolean);
    if (parts.length < 3) { await send(sock, jid, msg, 'Use *!enquete pergunta | opção 1 | opção 2*.' ); return true; }
    await sock.sendMessage(jid, { poll: { name: parts[0].slice(0, 120), values: parts.slice(1, 12).map((v) => v.slice(0, 80)), selectableCount: 1 } }, { quoted: msg });
    return true;
  }

  if (command === 'verdade') { await send(sock, jid, msg, `🤔 *VERDADE*\n${TRUTHS[Math.floor(Math.random() * TRUTHS.length)]}`); return true; }
  if (command === 'desafio') { await send(sock, jid, msg, `🔥 *DESAFIO*\n${CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)]}`); return true; }

  if (command === 'ranksemana' || command === 'topativos') {
    if (!jid.endsWith('@g.us')) { await send(sock, jid, msg, '🏆 Esse ranking funciona em grupos.'); return true; }
    const info = await groupInfo(sock, jid, msg);
    const rows = rankingRows(group, info.metadata, true, 10);
    await send(sock, jid, msg, `🏆 *TOP ATIVOS — 7 DIAS*\n\n${rows.length ? rows.map((row) => row.text).join('\n') : 'Ainda não há atividade suficiente.'}`, rows.map((row) => row.jid).filter(Boolean));
    return true;
  }

  if (command === 'evento') {
    if (!jid.endsWith('@g.us')) { await send(sock, jid, msg, '📅 Eventos precisam ser criados em um grupo.'); return true; }
    const input = String(args || '').trim();
    const [action = '', ...rest] = input.split(/\s+/u);
    if (action.toLowerCase() === 'criar') {
      const info = await requireAdmin(ctx); if (!info) return true;
      const parts = rest.join(' ').split('|').map((v) => v.trim());
      if (parts.length < 2) { await send(sock, jid, msg, 'Use *!evento criar Nome | DD/MM/AAAA HH:MM*.'); return true; }
      const at = parseEventDate(parts[1]);
      if (!at || at <= Date.now()) { await send(sock, jid, msg, '⚠️ Informe uma data futura válida.'); return true; }
      const id = Math.random().toString(36).slice(2, 7).toUpperCase();
      group.events[id] = { id, name: parts[0].slice(0, 100), at, createdAt: Date.now() }; scheduleEssentialSave();
      await send(sock, jid, msg, `📅 Evento *${parts[0]}* criado.\nID: *${id}*\nQuando: *${formatEventDate(at)}*`); return true;
    }
    if (['remover', 'del', 'cancelar'].includes(action.toLowerCase())) {
      const info = await requireAdmin(ctx); if (!info) return true;
      const id = String(rest[0] || '').toUpperCase();
      if (!group.events[id]) { await send(sock, jid, msg, '⚠️ Evento não encontrado.'); return true; }
      delete group.events[id]; scheduleEssentialSave(); await send(sock, jid, msg, '✅ Evento removido.'); return true;
    }
    const upcoming = Object.values(group.events).filter((event) => event.at > Date.now()).sort((a, b) => a.at - b.at);
    await send(sock, jid, msg, upcoming.length ? `📅 *EVENTOS*\n\n${upcoming.map((event) => `• *${event.id}* — ${event.name}\n  ${formatEventDate(event.at)}`).join('\n\n')}` : '📅 Nenhum evento futuro cadastrado.');
    return true;
  }

  if (command === 'contador') {
    if (!jid.endsWith('@g.us')) { await send(sock, jid, msg, '⏳ O contador de evento funciona em grupos.'); return true; }
    const id = String(args || '').trim().toUpperCase();
    const events = Object.values(group.events).filter((event) => event.at > Date.now()).sort((a, b) => a.at - b.at);
    const event = (id && id !== 'EVENTO' ? group.events[id] : null) || events[0];
    if (!event) { await send(sock, jid, msg, '📅 Nenhum evento futuro encontrado. Use *!evento criar ...*.'); return true; }
    const ms = event.at - Date.now();
    const days = Math.floor(ms / 86400000); const hours = Math.floor((ms % 86400000) / 3600000); const minutes = Math.floor((ms % 3600000) / 60000);
    await send(sock, jid, msg, `⏳ *${event.name}*\nFaltam *${days}d ${hours}h ${minutes}min*.\n${formatEventDate(event.at)}`);
    return true;
  }

  return false;
}
