import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { commandByName, visibleCommands, type CommandCategory } from './registry.js';
import { createStateStore, type StateStore, type V2State } from './state.js';
import { balance, creditOnce, economyConfig, leaderboard, shopCatalog, spendOnce, statement } from './economy.js';
import { discoverMovie, searchTitles, tmdbConfigured, type TmdbTitle } from './tmdb.js';

type Sock = any;
type Msg = any;

export interface V2Context {
  sock: Sock;
  jid: string;
  msg: Msg;
  text: string;
  prefix: string;
  isOwner: boolean;
  isVip: boolean;
  isGroupAllowed: boolean;
  grantVip?: (phone: string, days: number, operationKey: string) => Promise<void>;
}

let store: StateStore | null = null;
let authDir = 'auth';
const lastActivityWrite = new Map<string, number>();

function currentStore(): StateStore {
  if (!store) throw new Error('V2_NOT_INITIALIZED');
  return store;
}

export async function initV2Runtime(dir: string): Promise<void> {
  authDir = dir;
  if (store) return;
  store = await createStateStore(authDir);
  console.log(`[V2] Runtime modular ativo. Persistência: ${store.kind}.`);
}

function parse(text: string, prefix: string): { command: string; args: string } | null {
  if (!prefix || !text.startsWith(prefix)) return null;
  const body = text.slice(prefix.length).trim();
  if (!body) return null;
  const [head = '', ...rest] = body.split(/\s+/u);
  return { command: head.toLowerCase(), args: rest.join(' ').trim() };
}

async function send(sock: Sock, jid: string, msg: Msg, text: string): Promise<void> {
  await sock.sendMessage(jid, { text }, { quoted: msg });
}

function jidDigits(value: unknown): string {
  return String(value || '').split('@')[0]!.split(':')[0]!.replace(/\D/g, '');
}

async function resolveUserId(sock: Sock, msg: Msg): Promise<{ id: string; phone: string | null }> {
  const candidates = [msg?.key?.participantPn, msg?.key?.participantAlt, msg?.key?.participant, msg?.key?.remoteJid].filter(Boolean);
  for (const raw of candidates) {
    const value = String(raw);
    if (value.endsWith('@g.us')) continue;
    if (!value.endsWith('@lid')) {
      const digits = jidDigits(value);
      if (digits.length >= 10) return { id: `pn:${digits}`, phone: digits };
    }
    if (value.endsWith('@lid')) {
      try {
        const mapped = await sock.signalRepository?.lidMapping?.getPNForLID?.(value);
        const digits = jidDigits(mapped);
        if (digits.length >= 10) return { id: `pn:${digits}`, phone: digits };
      } catch {}
      return { id: `lid:${value.split('@')[0]}`, phone: null };
    }
  }
  const fallback = String(msg?.key?.id || randomUUID());
  return { id: `msg:${fallback}`, phone: null };
}

function operationKey(msg: Msg, suffix: string): string {
  return `${String(msg?.key?.remoteJid || 'unknown')}:${String(msg?.key?.id || randomUUID())}:${suffix}`;
}

function localDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Boa_Vista', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function ensureUser(userId: string): Promise<void> {
  await currentStore().mutate((state) => {
    state.users[userId] ??= { createdAt: Date.now(), notifications: true, deletedAt: null };
    state.wallets[userId] ??= { credits: 0, gems: 0 };
  });
}

function displayUser(userId: string): string {
  if (userId.startsWith('pn:')) {
    const d = userId.slice(3);
    return d.length > 4 ? `••••${d.slice(-4)}` : 'usuário';
  }
  return userId.startsWith('lid:') ? `LID ••••${userId.slice(-4)}` : 'usuário';
}

async function groupAdmin(sock: Sock, jid: string, msg: Msg): Promise<boolean> {
  if (!jid.endsWith('@g.us')) return false;
  try {
    const metadata = await sock.groupMetadata(jid);
    const ids = [msg?.key?.participantPn, msg?.key?.participantAlt, msg?.key?.participant].filter(Boolean).map(String);
    const participant = metadata.participants?.find((entry: any) => {
      const values = [entry?.phoneNumber, entry?.id, entry?.lid].filter(Boolean).map(String);
      return values.some((value: string) => ids.includes(value) || ids.some((id: string) => jidDigits(id) && jidDigits(id) === jidDigits(value)));
    });
    return Boolean(participant?.admin);
  } catch {
    return false;
  }
}

function permissionDenied(prefix: string): string {
  return `⛔ Você não tem permissão para esse comando. Use *${prefix}menu* para ver apenas o que está disponível para você.`;
}

function menuText(prefix: string, input: { isOwner: boolean; isAdmin: boolean; isVip: boolean; isGroup: boolean }, category?: string): string {
  const visible = visibleCommands(input);
  const normalizedCategory = String(category || '').toLowerCase() as CommandCategory;
  const categories = [...new Set(visible.map((entry) => entry.category))];
  const selected = categories.includes(normalizedCategory) ? normalizedCategory : null;
  if (!selected) {
    const panels = visible.filter((entry) => entry.category === 'painel').map((entry) => `• *${prefix}${entry.name}*`).join('\n');
    return `🤖 *RIMURU-BOT*\n\n${panels}\n\n📚 *Categorias*\n${categories.filter((item) => item !== 'painel').map((item) => `• *${prefix}menu ${item}*`).join('\n')}\n\nO menu é filtrado pelo seu acesso e contexto.`;
  }
  const lines = visible.filter((entry) => entry.category === selected).map((entry) => `• *${prefix}${entry.name}${entry.args ? ` ${entry.args}` : ''}*${entry.aliases.length ? ` — aliases: ${entry.aliases.map((a) => prefix + a).join(', ')}` : ''}`);
  return `📂 *${selected.toUpperCase()}*\n\n${lines.join('\n') || 'Nenhum comando disponível.'}`;
}

function requireGroup(ctx: V2Context): boolean {
  return ctx.jid.endsWith('@g.us');
}

async function resolveTitle(query: string, preferred?: 'movie' | 'tv'): Promise<{ resolved?: TmdbTitle; options?: TmdbTitle[] }> {
  const direct = /^tmdb:(movie|tv):(\d+)$/i.exec(query.trim());
  if (direct) return { resolved: { id: Number(direct[2]), mediaType: direct[1]!.toLowerCase() as 'movie' | 'tv', title: `TMDB #${direct[2]}`, year: '—', overview: '' } };
  if (!tmdbConfigured()) return {};
  const results = await searchTitles(query, preferred);
  if (results.length === 1) return { resolved: results[0] };
  const exact = results.find((item) => item.title.localeCompare(query, 'pt-BR', { sensitivity: 'base' }) === 0);
  if (exact) return { resolved: exact };
  return { options: results.slice(0, 5) };
}

async function handleEconomy(ctx: V2Context, command: string, args: string, userId: string): Promise<boolean> {
  const s = currentStore();
  if (command === 'diario') {
    if (ctx.jid.endsWith('@g.us') && !ctx.isGroupAllowed) return true;
    const day = localDay();
    const already = await s.read((state) => state.dailyClaims[userId] === day);
    if (already) { await send(ctx.sock, ctx.jid, ctx.msg, `🗓️ Seu check-in de hoje já foi resgatado. Volte amanhã.`); return true; }
    const result = await creditOnce(s, { userId, amount: economyConfig.dailyCredits, operationKey: operationKey(ctx.msg, `daily:${day}`), kind: 'daily_checkin', groupId: ctx.jid.endsWith('@g.us') ? ctx.jid : null });
    if (result.applied) await s.mutate((state) => { state.dailyClaims[userId] = day; });
    await send(ctx.sock, ctx.jid, ctx.msg, `🎁 Check-in diário: *+${result.applied ? economyConfig.dailyCredits : 0} créditos*\nSaldo: *${result.balance}*\n\nRegras: 1 resgate por dia, global por usuário.`); return true;
  }
  if (command === 'saldo') {
    await send(ctx.sock, ctx.jid, ctx.msg, `💳 *SALDO*\nCréditos: *${await balance(s, userId)}*\nGemas: *0* (segunda moeda ainda não ativada).`); return true;
  }
  if (command === 'extrato') {
    const rows = await statement(s, userId, 10);
    await send(ctx.sock, ctx.jid, ctx.msg, rows.length ? `🧾 *ÚLTIMAS MOVIMENTAÇÕES*\n\n${rows.map((row) => `${row.delta > 0 ? '+' : ''}${row.delta} — ${row.kind}`).join('\n')}` : '🧾 Seu extrato ainda está vazio.'); return true;
  }
  if (command === 'desafios') {
    await send(ctx.sock, ctx.jid, ctx.msg, `🎯 *DESAFIOS*\n• Check-in diário: *${economyConfig.dailyCredits} créditos*\n• Quiz e sessões coletivas: integração de recompensa em fase seguinte.\n\nNão há recompensa por quantidade de mensagens.`); return true;
  }
  if (command === 'conquistas') {
    const rows = await statement(s, userId, 100);
    const claims = rows.filter((row) => row.kind === 'daily_checkin').length;
    const achievements = [claims >= 1 ? '✅ Primeiro check-in' : '⬜ Primeiro check-in', claims >= 7 ? '✅ 7 check-ins' : '⬜ 7 check-ins'];
    await send(ctx.sock, ctx.jid, ctx.msg, `🏅 *CONQUISTAS*\n${achievements.join('\n')}`); return true;
  }
  if (command === 'loja') {
    await send(ctx.sock, ctx.jid, ctx.msg, `🛍️ *LOJA*\n${shopCatalog.map((item) => `• *${item.id}* — ${item.credits} créditos`).join('\n')}\n• *vip_7d* — ${economyConfig.vip7DaysCredits} créditos\n• *vip_30d* — ${economyConfig.vip30DaysCredits} créditos\n\nUse *${ctx.prefix}comprar item*. Para VIP: *${ctx.prefix}resgatarvip 7|30*.`); return true;
  }
  if (command === 'comprar') {
    const item = shopCatalog.find((entry) => entry.id === args.trim().toLowerCase());
    if (!item) { await send(ctx.sock, ctx.jid, ctx.msg, `⚠️ Item inválido. Veja *${ctx.prefix}loja*.`); return true; }
    const owned = await s.read((state) => state.inventory[userId]?.includes(item.id) ?? false);
    if (owned) { await send(ctx.sock, ctx.jid, ctx.msg, 'ℹ️ Você já possui esse item.'); return true; }
    const result = await spendOnce(s, { userId, amount: item.credits, operationKey: operationKey(ctx.msg, `buy:${item.id}`), kind: 'shop_purchase', groupId: ctx.jid.endsWith('@g.us') ? ctx.jid : null, meta: { item: item.id } });
    if (result.reason === 'INSUFFICIENT') { await send(ctx.sock, ctx.jid, ctx.msg, `💳 Saldo insuficiente. Você tem *${result.balance}* créditos.`); return true; }
    if (result.applied) await s.mutate((state) => { (state.inventory[userId] ??= []).push(item.id); });
    await send(ctx.sock, ctx.jid, ctx.msg, `✅ *${item.label}* adquirido. Saldo: *${result.balance}*.`); return true;
  }
  if (command === 'resgatarvip') {
    const days = Number(args.trim());
    const price = days === 7 ? economyConfig.vip7DaysCredits : days === 30 ? economyConfig.vip30DaysCredits : 0;
    if (!price) { await send(ctx.sock, ctx.jid, ctx.msg, `Use *${ctx.prefix}resgatarvip 7* ou *${ctx.prefix}resgatarvip 30*.`); return true; }
    const identity = await resolveUserId(ctx.sock, ctx.msg);
    if (!identity.phone) { await send(ctx.sock, ctx.jid, ctx.msg, '⚠️ Não consegui resolver seu número com segurança. O resgate não foi debitado.'); return true; }
    if (!ctx.grantVip) { await send(ctx.sock, ctx.jid, ctx.msg, '⚙️ Resgate VIP está temporariamente bloqueado: adaptador de concessão não configurado. Nenhum crédito foi debitado.'); return true; }
    const op = operationKey(ctx.msg, `vip:${days}`);
    const result = await spendOnce(s, { userId, amount: price, operationKey: op, kind: 'vip_redemption', groupId: ctx.jid.endsWith('@g.us') ? ctx.jid : null, meta: { days } });
    if (result.reason === 'INSUFFICIENT') { await send(ctx.sock, ctx.jid, ctx.msg, `💳 Saldo insuficiente. Necessário: *${price}*. Seu saldo: *${result.balance}*.`); return true; }
    try {
      if (result.applied) await ctx.grantVip(identity.phone, days, op);
      await send(ctx.sock, ctx.jid, ctx.msg, `💎 VIP de *${days} dias* resgatado. Saldo: *${result.balance}*.`);
    } catch (error) {
      if (result.applied) await creditOnce(s, { userId, amount: price, operationKey: `${op}:compensation`, kind: 'vip_redemption_compensation', groupId: ctx.jid.endsWith('@g.us') ? ctx.jid : null });
      console.error('[V2] Falha ao conceder VIP:', error);
      await send(ctx.sock, ctx.jid, ctx.msg, '⚠️ A concessão do VIP falhou e os créditos foram devolvidos.');
    }
    return true;
  }
  if (command === 'rankingeconomia') {
    const rows = await leaderboard(s, 10);
    await send(ctx.sock, ctx.jid, ctx.msg, rows.length ? `🏆 *RANKING DE CRÉDITOS*\n\n${rows.map((row, index) => `${index + 1}. ${displayUser(row.userId)} — *${row.credits}*`).join('\n')}` : 'Ainda não há saldos no ranking.'); return true;
  }
  return false;
}

async function handleCinemaCommunity(ctx: V2Context, command: string, args: string, userId: string): Promise<boolean> {
  const s = currentStore();
  if (command === 'seguirserie' || command === 'seguirlancamento') {
    if (!args) { await send(ctx.sock, ctx.jid, ctx.msg, `Use *${ctx.prefix}${command} nome*.`); return true; }
    const preferred = command === 'seguirserie' ? 'tv' : undefined;
    const result = await resolveTitle(args, preferred);
    if (!result.resolved && result.options?.length) {
      await send(ctx.sock, ctx.jid, ctx.msg, `🔎 Encontrei mais de uma opção. Escolha pelo ID:\n${result.options.map((item) => `• ${item.title} (${item.year}) — *tmdb:${item.mediaType}:${item.id}*`).join('\n')}\n\nRepita o comando usando o identificador.`); return true;
    }
    const item = result.resolved;
    if (!item) { await send(ctx.sock, ctx.jid, ctx.msg, tmdbConfigured() ? '🔎 Não encontrei esse título.' : '⚙️ TMDB não está configurado para resolver títulos com segurança.'); return true; }
    await s.mutate((state) => {
      const list = state.follows[userId] ??= [];
      const id = `tmdb:${item.mediaType}:${item.id}`;
      if (!list.some((entry) => entry.id === id)) list.push({ id, kind: command === 'seguirserie' ? 'tv' : 'release', provider: 'tmdb', providerId: String(item.id), title: item.title, createdAt: Date.now() });
    });
    await send(ctx.sock, ctx.jid, ctx.msg, `✅ Agora você acompanha *${item.title}* (${item.year}).`); return true;
  }
  if (command === 'seguindo' || command === 'agenda') {
    const follows = await s.read((state) => state.follows[userId] ?? []);
    await send(ctx.sock, ctx.jid, ctx.msg, follows.length ? `📌 *ACOMPANHANDO*\n${follows.map((item) => `• ${item.title} — *${item.id}*`).join('\n')}\n\nAlertas respeitam configuração e notificações do usuário.` : '📌 Você ainda não acompanha nenhum título.'); return true;
  }
  if (command === 'pararseguir') {
    const id = args.trim();
    if (!id) { await send(ctx.sock, ctx.jid, ctx.msg, `Use *${ctx.prefix}pararseguir identificador*.`); return true; }
    let removed = false;
    await s.mutate((state) => { const list = state.follows[userId] ?? []; const index = list.findIndex((entry) => entry.id === id); if (index >= 0) { list.splice(index, 1); removed = true; } });
    await send(ctx.sock, ctx.jid, ctx.msg, removed ? '✅ Acompanhamento removido.' : 'ℹ️ Identificador não encontrado.'); return true;
  }
  if (command === 'roleta') {
    if (!requireGroup(ctx)) { await send(ctx.sock, ctx.jid, ctx.msg, '🎬 A roleta coletiva funciona dentro de grupos autorizados.'); return true; }
    try {
      const item = await discoverMovie(args);
      await send(ctx.sock, ctx.jid, ctx.msg, item ? `🎲 *ROLETA DE FILMES*\n\n🎬 *${item.title}* (${item.year})\n${item.overview ? `\n${item.overview.slice(0, 380)}` : ''}\n\nSem apostas ou cobrança pelo sorteio.` : 'Não encontrei um filme para esse filtro.');
    } catch { await send(ctx.sock, ctx.jid, ctx.msg, '⚙️ Não consegui consultar a TMDB agora.'); }
    return true;
  }
  if (command === 'sugerirfilme') {
    if (!args) { await send(ctx.sock, ctx.jid, ctx.msg, `Use *${ctx.prefix}sugerirfilme nome*.`); return true; }
    const suggestion = { id: randomBytes(3).toString('hex').toUpperCase(), title: args.slice(0, 100), suggestedBy: userId, votes: [userId], createdAt: Date.now() };
    await s.mutate((state) => { (state.groupSuggestions[ctx.jid] ??= []).push(suggestion); });
    await send(ctx.sock, ctx.jid, ctx.msg, `🎬 Sugestão registrada: *${suggestion.title}*\nID: *${suggestion.id}*\nUse *${ctx.prefix}votarfilme ${suggestion.id}*.`); return true;
  }
  if (command === 'votarfilme') {
    const id = args.trim().toUpperCase();
    let result: { title: string; votes: number } | null = null;
    await s.mutate((state) => { const item = (state.groupSuggestions[ctx.jid] ?? []).find((entry) => entry.id === id); if (item) { if (!item.votes.includes(userId)) item.votes.push(userId); result = { title: item.title, votes: item.votes.length }; } });
    await send(ctx.sock, ctx.jid, ctx.msg, result ? `🗳️ Voto registrado em *${result.title}*. Total: *${result.votes}*.` : '⚠️ Sugestão não encontrada.'); return true;
  }
  if (command === 'sessao') {
    const [action = '', ...rest] = args.split(/\s+/u); const value = rest.join(' ').trim();
    if (action === 'criar') {
      if (!value) { await send(ctx.sock, ctx.jid, ctx.msg, `Use *${ctx.prefix}sessao criar Nome do filme*.`); return true; }
      const session = { id: randomBytes(3).toString('hex').toUpperCase(), title: value.slice(0, 100), createdBy: userId, members: [userId], createdAt: Date.now(), status: 'open' as const };
      await s.mutate((state) => { state.sessions[ctx.jid] = session; });
      await send(ctx.sock, ctx.jid, ctx.msg, `🍿 Sessão criada para *${session.title}*. ID: *${session.id}*\nUse *${ctx.prefix}sessao entrar*.`); return true;
    }
    if (action === 'entrar' || action === 'sair') {
      let text = 'Nenhuma sessão aberta.';
      await s.mutate((state) => { const session = state.sessions[ctx.jid]; if (!session || session.status !== 'open') return; if (action === 'entrar' && !session.members.includes(userId)) session.members.push(userId); if (action === 'sair') session.members = session.members.filter((id) => id !== userId); text = `🍿 *${session.title}* — ${session.members.length} participante(s).`; });
      await send(ctx.sock, ctx.jid, ctx.msg, text); return true;
    }
    if (action === 'status' || !action) {
      const session = await s.read((state) => state.sessions[ctx.jid]);
      await send(ctx.sock, ctx.jid, ctx.msg, session ? `🍿 *SESSÃO*\nFilme: *${session.title}*\nParticipantes: *${session.members.length}*\nStatus: *${session.status}*` : 'Nenhuma sessão aberta.'); return true;
    }
    await send(ctx.sock, ctx.jid, ctx.msg, `Use *${ctx.prefix}sessao criar*, *entrar*, *sair* ou *status*.`); return true;
  }
  if (command === 'assistido') {
    if (!args) { await send(ctx.sock, ctx.jid, ctx.msg, `Use *${ctx.prefix}assistido nome*.`); return true; }
    await s.mutate((state) => { const list = state.watchlists[userId] ??= []; const title = args.slice(0, 100); const existing = list.find((item) => item.title.toLowerCase() === title.toLowerCase()); if (existing) existing.watchedAt = Date.now(); else list.push({ id: randomUUID(), title, watchedAt: Date.now(), createdAt: Date.now() }); });
    await send(ctx.sock, ctx.jid, ctx.msg, `✅ *${args.slice(0, 100)}* marcado como assistido.`); return true;
  }
  if (command === 'minhalista') {
    const list = await s.read((state) => state.watchlists[userId] ?? []);
    await send(ctx.sock, ctx.jid, ctx.msg, list.length ? `🎞️ *MINHA LISTA*\n${list.slice(-20).map((item) => `• ${item.watchedAt ? '✅' : '⬜'} ${item.title}`).join('\n')}` : 'Sua lista está vazia.'); return true;
  }
  return false;
}

async function handlePrivacy(ctx: V2Context, command: string, args: string, userId: string): Promise<boolean> {
  const s = currentStore();
  if (command === 'privacidade') {
    await send(ctx.sock, ctx.jid, ctx.msg, `🔐 *PRIVACIDADE*\nO Rimuru-Bot armazena apenas IDs técnicos, configurações, saldos, listas, progresso e métricas mínimas. Não é necessário guardar o texto completo das mensagens para atividade.\n\nUse *${ctx.prefix}meusdados*, *${ctx.prefix}apagardados* e *${ctx.prefix}notificacoes on|off*.`); return true;
  }
  if (command === 'meusdados') {
    const data = await s.read((state) => ({ wallet: state.wallets[userId] ?? { credits: 0, gems: 0 }, follows: state.follows[userId]?.length ?? 0, list: state.watchlists[userId]?.length ?? 0, inventory: state.inventory[userId]?.length ?? 0, notifications: state.users[userId]?.notifications ?? true }));
    await send(ctx.sock, ctx.jid, ctx.msg, `📦 *MEUS DADOS*\nCréditos: *${data.wallet.credits}*\nAcompanhamentos: *${data.follows}*\nItens de lista: *${data.list}*\nCosméticos: *${data.inventory}*\nNotificações: *${data.notifications ? 'ON' : 'OFF'}*\n\nNenhum histórico privado de grupos é exibido aqui.`); return true;
  }
  if (command === 'notificacoes') {
    const value = args.trim().toLowerCase(); if (!['on', 'off'].includes(value)) { await send(ctx.sock, ctx.jid, ctx.msg, `Use *${ctx.prefix}notificacoes on* ou *off*.`); return true; }
    await s.mutate((state) => { state.users[userId] ??= { createdAt: Date.now(), notifications: true, deletedAt: null }; state.users[userId]!.notifications = value === 'on'; });
    await send(ctx.sock, ctx.jid, ctx.msg, `🔔 Notificações pessoais: *${value.toUpperCase()}*.`); return true;
  }
  if (command === 'apagardados') {
    if (args.trim().toLowerCase() !== 'confirmar') { await send(ctx.sock, ctx.jid, ctx.msg, `⚠️ Isso remove listas, acompanhamentos, cosméticos e perfil econômico. Para confirmar: *${ctx.prefix}apagardados confirmar*.`); return true; }
    const anon = `deleted:${createHash('sha256').update(userId).digest('hex').slice(0, 12)}`;
    await s.mutate((state) => {
      delete state.users[userId]; delete state.wallets[userId]; delete state.dailyClaims[userId]; delete state.inventory[userId]; delete state.follows[userId]; delete state.watchlists[userId];
      for (const entry of state.ledger) if (entry.userId === userId) entry.userId = anon;
      for (const group of Object.values(state.activity)) delete group[userId];
      for (const list of Object.values(state.groupSuggestions)) for (const item of list) { item.votes = item.votes.filter((id) => id !== userId); if (item.suggestedBy === userId) item.suggestedBy = anon; }
    });
    await send(ctx.sock, ctx.jid, ctx.msg, '✅ Seus dados pessoais do V2 foram removidos. Registros financeiros mínimos foram anonimizados para manter integridade de auditoria.'); return true;
  }
  return false;
}

async function handleModeration(ctx: V2Context, command: string, args: string, userId: string, isAdmin: boolean): Promise<boolean> {
  if (!requireGroup(ctx)) return false;
  if (!(ctx.isOwner || isAdmin)) { await send(ctx.sock, ctx.jid, ctx.msg, permissionDenied(ctx.prefix)); return true; }
  const s = currentStore();
  if (command === 'inativos') {
    const days = Math.max(1, Math.min(365, Number(args.trim()) || 30));
    const cutoff = Date.now() - days * 86400000;
    const metadata = await ctx.sock.groupMetadata(ctx.jid);
    const activity = await s.read((state) => state.activity[ctx.jid] ?? {});
    const rows: string[] = [];
    for (const participant of metadata.participants ?? []) {
      if (participant.admin) continue;
      const raw = participant.phoneNumber || participant.id || participant.lid;
      const key = raw ? (String(raw).endsWith('@lid') ? `lid:${String(raw).split('@')[0]}` : `pn:${jidDigits(raw)}`) : '';
      if (!key) continue;
      const item = activity[key];
      if (!item) rows.push(`• ${displayUser(key)} — dados insuficientes`);
      else if (item.lastSeenAt < cutoff) rows.push(`• ${displayUser(key)} — última atividade observada há ${Math.floor((Date.now() - item.lastSeenAt) / 86400000)}d`);
    }
    await send(ctx.sock, ctx.jid, ctx.msg, `🕒 *INATIVIDADE OBSERVADA*\nJanela: *${days} dias*\n\n${rows.slice(0, 40).join('\n') || 'Nenhum candidato.'}\n\nSilêncio não prova abandono; o relatório considera apenas o que o bot observou.`); return true;
  }
  if (command === 'isentar') {
    const target = ctx.msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || ctx.msg?.message?.extendedTextMessage?.contextInfo?.participant;
    if (!target) { await send(ctx.sock, ctx.jid, ctx.msg, `Responda ou mencione o membro com *${ctx.prefix}isentar*.`); return true; }
    const key = String(target).endsWith('@lid') ? `lid:${String(target).split('@')[0]}` : `pn:${jidDigits(target)}`;
    await s.mutate((state) => { const list = state.exemptions[ctx.jid] ??= []; if (!list.includes(key)) list.push(key); });
    await send(ctx.sock, ctx.jid, ctx.msg, '✅ Membro isentado de limpezas por inatividade.'); return true;
  }
  if (command === 'limpargrupo') {
    const [action = '', value = ''] = args.trim().split(/\s+/u);
    if (action === 'cancelar') { await s.mutate((state) => { delete state.cleanupDrafts[ctx.jid]; }); await send(ctx.sock, ctx.jid, ctx.msg, '✅ Limpeza cancelada.'); return true; }
    if (action === 'simular') {
      const days = Math.max(7, Math.min(365, Number(value) || 30)); const cutoff = Date.now() - days * 86400000;
      const metadata = await ctx.sock.groupMetadata(ctx.jid); const snapshot = await s.read((state) => ({ activity: state.activity[ctx.jid] ?? {}, exemptions: state.exemptions[ctx.jid] ?? [] }));
      const candidates: string[] = [];
      for (const participant of metadata.participants ?? []) {
        if (participant.admin) continue;
        const raw = participant.phoneNumber || participant.id || participant.lid; if (!raw) continue;
        const key = String(raw).endsWith('@lid') ? `lid:${String(raw).split('@')[0]}` : `pn:${jidDigits(raw)}`;
        if (snapshot.exemptions.includes(key)) continue;
        const activity = snapshot.activity[key]; if (!activity || activity.lastSeenAt >= cutoff) continue;
        candidates.push(String(participant.id || participant.lid || participant.phoneNumber));
      }
      const token = randomBytes(3).toString('hex').toUpperCase();
      await s.mutate((state) => { state.cleanupDrafts[ctx.jid] = { token, actorId: userId, days, candidateIds: candidates, expiresAt: Date.now() + 10 * 60_000 }; });
      await send(ctx.sock, ctx.jid, ctx.msg, `🧹 *SIMULAÇÃO DE LIMPEZA*\nJanela: *${days} dias*\nCandidatos: *${candidates.length}*\nToken: *${token}* (10 min)\n\nNenhuma remoção foi feita. Confirme com *${ctx.prefix}limpargrupo confirmar ${token}*.`); return true;
    }
    if (action === 'confirmar') {
      const token = value.toUpperCase(); const draft = await s.read((state) => state.cleanupDrafts[ctx.jid]);
      if (!draft || draft.token !== token || draft.actorId !== userId || draft.expiresAt < Date.now()) { await send(ctx.sock, ctx.jid, ctx.msg, '⚠️ Token inválido, expirado ou criado por outro administrador.'); return true; }
      const metadata = await ctx.sock.groupMetadata(ctx.jid); const activity = await s.read((state) => state.activity[ctx.jid] ?? {}); const cutoff = Date.now() - draft.days * 86400000;
      const valid: string[] = [];
      for (const candidate of draft.candidateIds) {
        const participant = metadata.participants?.find((entry: any) => [entry.id, entry.lid, entry.phoneNumber].filter(Boolean).map(String).includes(candidate));
        if (!participant || participant.admin) continue;
        const raw = participant.phoneNumber || participant.id || participant.lid; const key = String(raw).endsWith('@lid') ? `lid:${String(raw).split('@')[0]}` : `pn:${jidDigits(raw)}`;
        const item = activity[key]; if (item && item.lastSeenAt < cutoff) valid.push(candidate);
      }
      let removed = 0; const failures: string[] = [];
      for (let i = 0; i < valid.length; i += 5) {
        const batch = valid.slice(i, i + 5);
        try { await ctx.sock.groupParticipantsUpdate(ctx.jid, batch, 'remove'); removed += batch.length; } catch { failures.push(...batch); }
      }
      await s.mutate((state) => { delete state.cleanupDrafts[ctx.jid]; });
      await send(ctx.sock, ctx.jid, ctx.msg, `🧹 Limpeza concluída. Removidos: *${removed}*. Falhas: *${failures.length}*. A lista foi revalidada antes da execução.`); return true;
    }
    await send(ctx.sock, ctx.jid, ctx.msg, `Use *${ctx.prefix}limpargrupo simular 30*, *confirmar TOKEN* ou *cancelar*.`); return true;
  }
  if (command === 'enqueteadm') {
    const parts = args.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) { await send(ctx.sock, ctx.jid, ctx.msg, `Use *${ctx.prefix}enqueteadm pergunta | opção 1 | opção 2*.`); return true; }
    await ctx.sock.sendMessage(ctx.jid, { poll: { name: parts[0]!.slice(0, 120), values: parts.slice(1, 12).map((part) => part.slice(0, 80)), selectableCount: 1 } }, { quoted: ctx.msg });
    return true;
  }
  return false;
}

export async function observeV2Message(input: { sock: Sock; jid: string; msg: Msg; isGroupAllowed: boolean }): Promise<void> {
  if (!store || !input.jid.endsWith('@g.us') || !input.isGroupAllowed || input.msg?.key?.fromMe) return;
  const identity = await resolveUserId(input.sock, input.msg); const key = `${input.jid}:${identity.id}`; const now = Date.now();
  if (now - (lastActivityWrite.get(key) || 0) < 60_000) return;
  lastActivityWrite.set(key, now);
  await store.mutate((state) => { const group = state.activity[input.jid] ??= {}; const entry = group[identity.id] ??= { firstSeenAt: now, lastSeenAt: now, messagesObserved: 0 }; entry.lastSeenAt = now; entry.messagesObserved += 1; });
}

export async function handleV2Command(ctx: V2Context): Promise<boolean> {
  if (!store) await initV2Runtime(authDir);
  const parsed = parse(ctx.text, ctx.prefix); if (!parsed) return false;
  const def = commandByName(parsed.command); if (!def) return false;
  const isGroup = ctx.jid.endsWith('@g.us');
  if (isGroup && !ctx.isGroupAllowed) return true;
  const isAdmin = ctx.isOwner || await groupAdmin(ctx.sock, ctx.jid, ctx.msg);
  const identity = await resolveUserId(ctx.sock, ctx.msg); const userId = identity.id;
  await ensureUser(userId);

  if (parsed.command === 'menu' || parsed.command === 'ajuda') {
    await send(ctx.sock, ctx.jid, ctx.msg, menuText(ctx.prefix, { isOwner: ctx.isOwner, isAdmin, isVip: ctx.isVip, isGroup }, parsed.args)); return true;
  }

  if (!isGroup && !ctx.isOwner && !ctx.isVip && !['privacidade', 'meusdados', 'apagardados', 'notificacoes'].includes(def.name)) {
    await send(ctx.sock, ctx.jid, ctx.msg, `💎 *ACESSO VIP NECESSÁRIO*\nOs comandos do Rimuru-bot no PV são exclusivos para donos e VIPs ativos.\nUse *${ctx.prefix}vip* para ver o plano.`); return true;
  }
  if (def.permission === 'owner' && !ctx.isOwner) { await send(ctx.sock, ctx.jid, ctx.msg, permissionDenied(ctx.prefix)); return true; }
  if (def.permission === 'admin' && !(ctx.isOwner || isAdmin)) { await send(ctx.sock, ctx.jid, ctx.msg, permissionDenied(ctx.prefix)); return true; }
  if (def.permission === 'group' && !isGroup) { await send(ctx.sock, ctx.jid, ctx.msg, '⚠️ Esse comando precisa ser usado em um grupo.'); return true; }

  if (await handlePrivacy(ctx, def.name, parsed.args, userId)) return true;
  if (await handleEconomy(ctx, def.name, parsed.args, userId)) return true;
  if (await handleCinemaCommunity(ctx, def.name, parsed.args, userId)) return true;
  if (await handleModeration(ctx, def.name, parsed.args, userId, isAdmin)) return true;
  return false;
}
