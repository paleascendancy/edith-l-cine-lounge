import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { senderPrimaryPhone } from '../pro.js';

let stateFile = null;
let saveTimer = null;
let state = {
  version: 1,
  users: {},
  groups: {},
  payments: {},
  referrals: {},
  coupons: {}
};

function cleanObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export async function initEssentialState(authDir) {
  stateFile = join(authDir, 'essential-suite.json');
  try {
    const raw = await readFile(stateFile, 'utf8');
    const saved = JSON.parse(raw);
    state = {
      version: 1,
      users: cleanObject(saved?.users),
      groups: cleanObject(saved?.groups),
      payments: cleanObject(saved?.payments),
      referrals: cleanObject(saved?.referrals),
      coupons: cleanObject(saved?.coupons)
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('[ESSENTIAL STATE] Falha ao carregar:', error?.message || error);
  }
}

export async function saveEssentialState() {
  if (!stateFile) return;
  await mkdir(join(stateFile, '..'), { recursive: true }).catch(() => {});
  await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

export function scheduleEssentialSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try { await saveEssentialState(); } catch (error) {
      console.error('[ESSENTIAL STATE] Falha ao salvar:', error?.message || error);
    }
  }, 700);
}

export async function essentialUserKey(sock, msg) {
  const phone = await senderPrimaryPhone(sock, msg);
  if (phone) return `pn:${phone}`;
  const raw = msg?.key?.participantAlt || msg?.key?.participant || msg?.key?.remoteJid || msg?.key?.id || 'unknown';
  return `jid:${String(raw)}`;
}

export function essentialUser(key) {
  state.users[key] ??= {
    savedLinks: [],
    follows: { anime: [], movies: [] },
    sticker: { pack: 'thzNode', publisher: 'Rimuru-Bot' },
    usage: {},
    history: [],
    credits: 0,
    trialUsed: false,
    referralCode: '',
    pendingCoupon: ''
  };
  state.users[key].savedLinks ??= [];
  state.users[key].follows ??= { anime: [], movies: [] };
  state.users[key].follows.anime ??= [];
  state.users[key].follows.movies ??= [];
  state.users[key].sticker ??= { pack: 'thzNode', publisher: 'Rimuru-Bot' };
  state.users[key].usage ??= {};
  state.users[key].history ??= [];
  return state.users[key];
}

export function essentialGroup(jid) {
  state.groups[jid] ??= {
    antiSpam: false,
    wordFilter: false,
    blockedWords: [],
    farewell: false,
    automod: false,
    custom: { name: 'Rimuru-Bot', welcome: '', farewell: '' },
    activity: {},
    events: {},
    backups: []
  };
  const group = state.groups[jid];
  group.blockedWords ??= [];
  group.custom ??= { name: 'Rimuru-Bot', welcome: '', farewell: '' };
  group.activity ??= {};
  group.events ??= {};
  group.backups ??= [];
  return group;
}

export function recordEssentialCommand(userKey, command) {
  const user = essentialUser(userKey);
  user.history.push({ command: String(command), at: Date.now() });
  if (user.history.length > 100) user.history = user.history.slice(-100);
  scheduleEssentialSave();
}

export function recordGroupActivity(jid, userKey) {
  const group = essentialGroup(jid);
  const entry = group.activity[userKey] ??= { messages: 0, firstAt: Date.now(), lastAt: Date.now(), days: {} };
  const day = new Date().toISOString().slice(0, 10);
  entry.messages = Number(entry.messages || 0) + 1;
  entry.lastAt = Date.now();
  entry.days ??= {};
  entry.days[day] = Number(entry.days[day] || 0) + 1;
  const cutoff = Date.now() - 45 * 86400000;
  for (const key of Object.keys(entry.days)) {
    if (Date.parse(`${key}T00:00:00Z`) < cutoff) delete entry.days[key];
  }
  scheduleEssentialSave();
}

export function usageAllowed(userKey, bucket, limit) {
  const user = essentialUser(userKey);
  const day = new Date().toISOString().slice(0, 10);
  const current = user.usage[bucket];
  if (!current || current.day !== day) user.usage[bucket] = { day, count: 0 };
  if (user.usage[bucket].count >= limit) return false;
  user.usage[bucket].count += 1;
  scheduleEssentialSave();
  return true;
}

export function createPayment(input) {
  const code = randomBytes(4).toString('hex').toUpperCase();
  state.payments[code] = {
    code,
    status: 'pending',
    createdAt: Date.now(),
    ...input
  };
  scheduleEssentialSave();
  return state.payments[code];
}

export function getPayment(code = '') {
  return state.payments[String(code).trim().toUpperCase()] || null;
}

export function updatePayment(code, patch) {
  const entry = getPayment(code);
  if (!entry) return null;
  Object.assign(entry, patch || {});
  scheduleEssentialSave();
  return entry;
}

export function getOrCreateReferral(userKey) {
  const user = essentialUser(userKey);
  if (!user.referralCode) {
    user.referralCode = `RIM${randomBytes(3).toString('hex').toUpperCase()}`;
    state.referrals[user.referralCode] = { owner: userKey, uses: 0, createdAt: Date.now() };
    scheduleEssentialSave();
  }
  return user.referralCode;
}

export function stateSnapshot() {
  return state;
}
