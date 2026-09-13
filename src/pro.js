import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 3650;
let stateFile = null;
const pros = new Map();

function digits(value = '') {
  return String(value).replace(/\D/g, '');
}

export function normalizeProPhone(value = '') {
  let phone = digits(value);
  if (!phone) return '';
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  return /^\d{10,15}$/.test(phone) ? phone : '';
}

export function formatProPhone(value = '') {
  const phone = normalizeProPhone(value) || digits(value);
  if (phone.startsWith('55')) {
    const local = phone.slice(2);
    const ddd = local.slice(0, 2);
    const number = local.slice(2);
    if (number.length === 9) return `+55 ${ddd} ${number.slice(0, 5)}-${number.slice(5)}`;
    if (number.length === 8) return `+55 ${ddd} ${number.slice(0, 4)}-${number.slice(4)}`;
  }
  return phone ? `+${phone}` : 'indisponível';
}

function isActive(entry) {
  return Boolean(entry && Number(entry.expiresAt || 0) > Date.now());
}

async function save() {
  if (!stateFile) return;
  await mkdir(join(stateFile, '..'), { recursive: true }).catch(() => {});
  await writeFile(stateFile, JSON.stringify({ version: 1, pros: Object.fromEntries(pros) }, null, 2), 'utf8');
}

function purgeExpired() {
  let changed = false;
  for (const [phone, entry] of pros) {
    if (!isActive(entry)) {
      pros.delete(phone);
      changed = true;
    }
  }
  return changed;
}

export async function initProAccess(authDir) {
  stateFile = join(authDir, 'pro-access.json');
  try {
    const raw = await readFile(stateFile, 'utf8');
    const saved = JSON.parse(raw);
    pros.clear();
    for (const [phone, entry] of Object.entries(saved?.pros || {})) {
      const normalized = normalizeProPhone(phone);
      if (!normalized) continue;
      pros.set(normalized, {
        phone: normalized,
        addedAt: Number(entry?.addedAt || Date.now()),
        expiresAt: Number(entry?.expiresAt || 0),
        note: String(entry?.note || '').slice(0, 80)
      });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('[PRO] Falha ao carregar acessos:', error?.message || error);
  }
  if (purgeExpired()) await save();
}

export async function senderPhoneCandidates(sock, msg) {
  const candidates = [
    msg?.key?.participantPn,
    msg?.key?.participantAlt,
    msg?.key?.participant,
    msg?.key?.remoteJid
  ].filter(Boolean);
  const numbers = new Set();
  for (const raw of candidates) {
    const value = String(raw);
    if (value.endsWith('@g.us')) continue;
    if (!value.endsWith('@lid')) {
      const phone = normalizeProPhone(value.split('@')[0].split(':')[0]);
      if (phone) numbers.add(phone);
      continue;
    }
    try {
      const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(value);
      const phone = normalizeProPhone(String(mapped || '').split('@')[0].split(':')[0]);
      if (phone) numbers.add(phone);
    } catch {}
  }
  return [...numbers];
}

export async function senderPrimaryPhone(sock, msg) {
  return (await senderPhoneCandidates(sock, msg))[0] || '';
}

export async function isProUser(sock, msg) {
  if (purgeExpired()) await save();
  const phones = await senderPhoneCandidates(sock, msg);
  return phones.some((phone) => isActive(pros.get(phone)));
}

export async function getProEntryForMessage(sock, msg) {
  if (purgeExpired()) await save();
  const phones = await senderPhoneCandidates(sock, msg);
  for (const phone of phones) {
    const entry = pros.get(phone);
    if (isActive(entry)) return entry;
  }
  return null;
}

export async function grantPro(phoneValue, days = DEFAULT_DAYS, { renew = false, note = '' } = {}) {
  const phone = normalizeProPhone(phoneValue);
  const duration = Number(days);
  if (!phone) throw new Error('PRO_PHONE_INVALID');
  if (!Number.isInteger(duration) || duration < 1 || duration > MAX_DAYS) throw new Error('PRO_DAYS_INVALID');
  const existing = pros.get(phone);
  const base = renew && isActive(existing) ? existing.expiresAt : Date.now();
  const entry = {
    phone,
    addedAt: existing?.addedAt || Date.now(),
    expiresAt: base + duration * 86400000,
    note: String(note || existing?.note || '').slice(0, 80)
  };
  pros.set(phone, entry);
  await save();
  return entry;
}

export async function removePro(phoneValue) {
  const phone = normalizeProPhone(phoneValue);
  if (!phone) return false;
  const existed = pros.delete(phone);
  await save();
  return existed;
}

export async function listPros() {
  if (purgeExpired()) await save();
  return [...pros.values()].sort((a, b) => a.expiresAt - b.expiresAt);
}
