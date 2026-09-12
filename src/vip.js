import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 3650;
let stateFile = null;
const vips = new Map();

function digits(value = '') {
  return String(value).replace(/\D/g, '');
}

function normalizePhone(value = '') {
  let phone = digits(value);
  if (!phone) return '';

  // Se vier apenas DDD + número, assume Brasil.
  if (phone.length === 10 || phone.length === 11) {
    phone = `55${phone}`;
  }

  return /^\d{10,15}$/.test(phone) ? phone : '';
}

function formatPhone(value = '') {
  const phone = normalizePhone(value) || digits(value);
  if (phone.startsWith('55')) {
    const local = phone.slice(2);
    const ddd = local.slice(0, 2);
    const number = local.slice(2);
    if (number.length === 9) return `+55 ${ddd} ${number.slice(0, 5)}-${number.slice(5)}`;
    if (number.length === 8) return `+55 ${ddd} ${number.slice(0, 4)}-${number.slice(4)}`;
  }
  return phone ? `+${phone}` : 'indisponível';
}

function prefix() {
  return String(config.prefix || '!');
}

function isActive(entry) {
  return Boolean(entry && Number(entry.expiresAt || 0) > Date.now());
}

function formatDate(timestamp) {
  try {
    return new Date(timestamp).toLocaleString('pt-BR', {
      timeZone: 'America/Boa_Vista',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return 'data indisponível';
  }
}

async function save() {
  if (!stateFile) return;
  await mkdir(join(stateFile, '..'), { recursive: true }).catch(() => {});
  await writeFile(
    stateFile,
    JSON.stringify({ version: 1, vips: Object.fromEntries(vips) }, null, 2),
    'utf-8'
  );
}

function purgeExpired() {
  let changed = false;
  for (const [phone, entry] of vips) {
    if (!isActive(entry)) {
      vips.delete(phone);
      changed = true;
    }
  }
  return changed;
}

export async function initVipAccess(authDir) {
  stateFile = join(authDir, 'vip-access.json');

  try {
    const raw = await readFile(stateFile, 'utf-8');
    const saved = JSON.parse(raw);
    vips.clear();

    for (const [phone, entry] of Object.entries(saved?.vips || {})) {
      const normalized = normalizePhone(phone);
      if (!normalized) continue;
      vips.set(normalized, {
        phone: normalized,
        addedAt: Number(entry?.addedAt || Date.now()),
        expiresAt: Number(entry?.expiresAt || 0),
        note: String(entry?.note || '').slice(0, 80)
      });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[VIP] Falha ao carregar VIPs:', error?.message || error);
    }
  }

  if (purgeExpired()) await save();
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

    if (!value.endsWith('@g.us') && !value.endsWith('@lid')) {
      const direct = normalizePhone(value.split('@')[0].split(':')[0]);
      if (direct) numbers.add(direct);
    }

    if (value.endsWith('@lid')) {
      try {
        const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(value);
        const mappedPhone = normalizePhone(String(mapped || '').split('@')[0].split(':')[0]);
        if (mappedPhone) numbers.add(mappedPhone);
      } catch {
        // O WhatsApp nem sempre entrega o mapeamento LID -> número.
      }
    }
  }

  return numbers;
}

export async function isVipUser(sock, msg) {
  if (purgeExpired()) await save();
  const numbers = await senderNumbers(sock, msg);
  for (const phone of numbers) {
    if (isActive(vips.get(phone))) return true;
  }
  return false;
}

async function currentVipEntry(sock, msg) {
  const numbers = await senderNumbers(sock, msg);
  for (const phone of numbers) {
    const entry = vips.get(phone);
    if (isActive(entry)) return entry;
  }
  return null;
}

function contextTarget(msg) {
  const info =
    msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.imageMessage?.contextInfo ||
    msg?.message?.videoMessage?.contextInfo ||
    null;

  return info?.mentionedJid?.[0] || info?.participantAlt || info?.participant || '';
}

async function resolveTargetPhone(sock, msg, raw = '') {
  const first = String(raw || '').trim().split(/\s+/u)[0] || '';
  const direct = normalizePhone(first);
  if (direct) return direct;

  const target = contextTarget(msg);
  if (!target) return '';

  if (!String(target).endsWith('@lid')) {
    return normalizePhone(String(target).split('@')[0].split(':')[0]);
  }

  try {
    const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(target);
    return normalizePhone(String(mapped || '').split('@')[0].split(':')[0]);
  } catch {
    return '';
  }
}

function parseDays(raw = '', fallback = DEFAULT_DAYS) {
  const parts = String(raw || '').trim().split(/\s+/u).filter(Boolean);
  const candidate = Number(parts[1] || fallback);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > MAX_DAYS) return null;
  return candidate;
}

async function send(sock, jid, msg, text) {
  await sock.sendMessage(jid, { text }, { quoted: msg });
}

function planText(entry = null) {
  const p = prefix();
  const status = entry
    ? `\n\n✅ *Seu VIP está ATIVO*\nExpira em: *${formatDate(entry.expiresAt)}*`
    : '';

  return (
    `╭━━━〔 💎 EDITH VIP 〕━━━╮\n` +
    `┃ Plano de acesso premium\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `*Benefícios atuais*\n` +
    `• Acesso aos comandos da Edith direto no PV\n` +
    `• Não precisa depender de um grupo para usar recursos pessoais\n` +
    `• Status VIP persistente enquanto o plano estiver ativo\n` +
    `• Acesso a futuros comandos exclusivos para VIP\n\n` +
    `Pagamento e ativação são confirmados pelo dono da Edith.\n` +
    `Use *${p}vipstatus* para consultar seu acesso.${status}`
  );
}

export function isVipInfoCommand(text = '') {
  const p = prefix();
  const head = String(text || '').trim().split(/\s+/u)[0].toLowerCase();
  return [ `${p}vip`, `${p}vipstatus`, `${p}planovip` ].includes(head);
}

export async function handleVipCommand(sock, jid, msg, text = '', { isOwner = false } = {}) {
  const p = prefix();
  const raw = String(text || '').trim();
  if (!raw.startsWith(p)) return false;

  const [head] = raw.split(/\s+/u);
  const command = head.slice(p.length).toLowerCase();
  const args = raw.slice(head.length).trim();

  const publicCommands = new Set(['vip', 'vipstatus', 'planovip']);
  const ownerCommands = new Set(['addvip', 'remvip', 'renovarvip', 'vips']);
  if (!publicCommands.has(command) && !ownerCommands.has(command)) return false;

  if (publicCommands.has(command)) {
    const entry = await currentVipEntry(sock, msg);
    if (command === 'vipstatus') {
      await send(
        sock,
        jid,
        msg,
        entry
          ? `💎 VIP: *ATIVO*\nExpira em: *${formatDate(entry.expiresAt)}*`
          : `💎 VIP: *INATIVO*\nUse *${p}vip* para ver o plano.`
      );
      return true;
    }

    await send(sock, jid, msg, planText(entry));
    return true;
  }

  if (!isOwner) {
    await send(sock, jid, msg, `⛔ *COMANDO NÃO EXECUTADO*\n\nMotivo: *${command}* é exclusivo do dono da Edith.`);
    return true;
  }

  if (command === 'vips') {
    if (purgeExpired()) await save();
    const entries = [...vips.values()].sort((a, b) => a.expiresAt - b.expiresAt);
    if (!entries.length) {
      await send(sock, jid, msg, '💎 Nenhum VIP ativo no momento.');
      return true;
    }

    const lines = entries.slice(0, 50).map((entry, index) =>
      `${index + 1}. *${formatPhone(entry.phone)}* — até ${formatDate(entry.expiresAt)}`
    );
    await send(sock, jid, msg, `💎 *VIPS ATIVOS*\n\n${lines.join('\n')}`);
    return true;
  }

  const phone = await resolveTargetPhone(sock, msg, args);
  if (!phone) {
    await send(
      sock,
      jid,
      msg,
      `⚠️ Informe o número ou mencione/responda a pessoa.\nEx.: *${p}${command} 5595999999999 30*`
    );
    return true;
  }

  if (command === 'remvip') {
    const existed = vips.delete(phone);
    await save();
    await send(
      sock,
      jid,
      msg,
      existed
        ? `✅ VIP removido de *${formatPhone(phone)}*.`
        : `ℹ️ *${formatPhone(phone)}* não possui VIP ativo.`
    );
    return true;
  }

  const days = parseDays(args);
  if (!days) {
    await send(sock, jid, msg, `⚠️ Quantidade de dias inválida. Use de 1 a ${MAX_DAYS}.`);
    return true;
  }

  const existing = vips.get(phone);
  const base = command === 'renovarvip' && isActive(existing)
    ? existing.expiresAt
    : Date.now();
  const expiresAt = base + days * 24 * 60 * 60 * 1000;

  vips.set(phone, {
    phone,
    addedAt: existing?.addedAt || Date.now(),
    expiresAt,
    note: existing?.note || ''
  });
  await save();

  await send(
    sock,
    jid,
    msg,
    `✅ *VIP ${command === 'renovarvip' ? 'RENOVADO' : 'ATIVADO'}*\n\n` +
      `Número: *${formatPhone(phone)}*\n` +
      `Período: *${days} dias*\n` +
      `Expira em: *${formatDate(expiresAt)}*`
  );
  return true;
}
