import { randomUUID } from 'node:crypto';
import type { StateStore } from './state.js';
import { creditOnce } from './economy.js';

interface QuizQuestion {
  id: string;
  prompt: string;
  options: [string, string, string, string];
  correct: 0 | 1 | 2 | 3;
  source: string;
}

interface QuizSession {
  id: string;
  questionId: string;
  startedAt: number;
  expiresAt: number;
  answers: Record<string, string>;
  closedAt: number | null;
}

declare module './state.js' {
  interface V2State {
    quizSessions?: Record<string, QuizSession>;
    quizScores?: Record<string, Record<string, number>>;
  }
}

const QUIZ_DURATION_MS = 60_000;
const QUIZ_REWARD = Number(process.env.ECONOMY_QUIZ_CORRECT_CREDITS || 10);
const QUIZ_REWARD_DAILY_CAP = Number(process.env.ECONOMY_QUIZ_DAILY_REWARD_CAP || 5);
const TZ = String(process.env.BOT_TIMEZONE || 'America/Boa_Vista');

const BANK: QuizQuestion[] = [
  { id: 'cinema-001', prompt: 'Quem dirigiu o filme Interestelar (2014)?', options: ['Denis Villeneuve', 'Christopher Nolan', 'Ridley Scott', 'James Cameron'], correct: 1, source: 'Créditos oficiais do filme / TMDB' },
  { id: 'cinema-002', prompt: 'Qual destes títulos pertence à franquia Matrix?', options: ['Reloaded', 'Resurgence', 'Legacy', 'Origins'], correct: 0, source: 'Filmografia oficial / TMDB' },
  { id: 'cinema-003', prompt: 'Em qual década o primeiro filme Toy Story foi lançado?', options: ['1980', '1990', '2000', '2010'], correct: 1, source: 'Data de lançamento oficial / TMDB' },
  { id: 'cinema-004', prompt: 'Qual destes é um filme dirigido por Bong Joon-ho?', options: ['Parasita', 'Whiplash', 'Duna', 'Oppenheimer'], correct: 0, source: 'Créditos oficiais / TMDB' },
  { id: 'cinema-005', prompt: 'Qual destes títulos é uma série de TV?', options: ['Dark', 'A Origem', 'Gladiador', 'Mad Max: Estrada da Fúria'], correct: 0, source: 'Catálogo de TV / TMDB' }
];

function localDay(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '00';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function optionIndex(value: string): 0 | 1 | 2 | 3 | null {
  const normalized = value.trim().toUpperCase();
  const map: Record<string, 0 | 1 | 2 | 3> = { A: 0, B: 1, C: 2, D: 3 };
  return map[normalized] ?? null;
}

function questionById(id: string): QuizQuestion | undefined {
  return BANK.find((item) => item.id === id);
}

function maskedUser(userId: string): string {
  const digits = userId.replace(/\D/g, '');
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : 'jogador';
}

async function send(ctx: { sock: any; jid: string; msg: any }, text: string): Promise<void> {
  await ctx.sock.sendMessage(ctx.jid, { text }, { quoted: ctx.msg });
}

async function closeExpired(store: StateStore, groupId: string): Promise<QuizQuestion | null> {
  let closedQuestion: QuizQuestion | null = null;
  await store.mutate((state) => {
    const session = state.quizSessions?.[groupId];
    if (!session || session.closedAt || session.expiresAt > Date.now()) return;
    session.closedAt = Date.now();
    closedQuestion = questionById(session.questionId) ?? null;
  });
  return closedQuestion;
}

async function dailyRewardCount(store: StateStore, userId: string): Promise<number> {
  const day = localDay(Date.now());
  return store.read((state) => state.ledger.filter((entry) => entry.userId === userId && entry.kind === 'quiz_correct' && localDay(entry.createdAt) === day && entry.delta > 0).length);
}

export async function handleQuizCommand(
  store: StateStore,
  ctx: { sock: any; jid: string; msg: any; prefix: string; isGroupAllowed: boolean },
  args: string,
  userId: string
): Promise<boolean> {
  if (!ctx.jid.endsWith('@g.us')) return false;
  if (!ctx.isGroupAllowed) return true;

  const [actionRaw = '', ...rest] = args.trim().split(/\s+/u);
  const action = actionRaw.toLowerCase();
  const value = rest.join(' ').trim();

  const expired = await closeExpired(store, ctx.jid);
  if (expired && action !== 'iniciar') {
    await send(ctx, `⏱️ A rodada anterior terminou. Resposta: *${'ABCD'[expired.correct]} — ${expired.options[expired.correct]}*.\nFonte do gabarito: ${expired.source}.`);
  }

  if (action === 'iniciar') {
    const active = await store.read((state) => state.quizSessions?.[ctx.jid]);
    if (active && !active.closedAt && active.expiresAt > Date.now()) {
      await send(ctx, '🎬 Já existe um quiz ativo neste grupo.');
      return true;
    }
    const question = BANK[Math.floor(Math.random() * BANK.length)]!;
    const session: QuizSession = { id: randomUUID(), questionId: question.id, startedAt: Date.now(), expiresAt: Date.now() + QUIZ_DURATION_MS, answers: {}, closedAt: null };
    await store.mutate((state) => { (state.quizSessions ??= {})[ctx.jid] = session; });
    const options = question.options.map((option, index) => `*${'ABCD'[index]}* — ${option}`).join('\n');
    await send(ctx, `🎬 *QUIZ — 60 SEGUNDOS*\n\n${question.prompt}\n\n${options}\n\nResponda com *${ctx.prefix}quiz responder A|B|C|D*. Uma resposta por pessoa.`);
    return true;
  }

  if (action === 'responder') {
    const choice = optionIndex(value);
    if (choice === null) {
      await send(ctx, `Use *${ctx.prefix}quiz responder A*, B, C ou D.`);
      return true;
    }
    const snapshot = await store.read((state) => state.quizSessions?.[ctx.jid]);
    if (!snapshot || snapshot.closedAt || snapshot.expiresAt <= Date.now()) {
      await send(ctx, `ℹ️ Não há quiz ativo. Use *${ctx.prefix}quiz iniciar*.`);
      return true;
    }
    const question = questionById(snapshot.questionId);
    if (!question) {
      await send(ctx, '⚠️ A pergunta desta sessão não está mais disponível.');
      return true;
    }
    let duplicate = false;
    await store.mutate((state) => {
      const session = state.quizSessions?.[ctx.jid];
      if (!session || session.closedAt || session.expiresAt <= Date.now()) return;
      if (session.answers[userId]) { duplicate = true; return; }
      session.answers[userId] = 'ABCD'[choice]!;
    });
    if (duplicate) {
      await send(ctx, 'ℹ️ Você já respondeu nesta rodada.');
      return true;
    }

    const correct = choice === question.correct;
    if (!correct) {
      await send(ctx, '❌ Resposta registrada. O gabarito será revelado quando a rodada terminar.');
      return true;
    }

    await store.mutate((state) => {
      const groupScores = (state.quizScores ??= {})[ctx.jid] ??= {};
      groupScores[userId] = (groupScores[userId] || 0) + 1;
    });

    const count = await dailyRewardCount(store, userId);
    if (count >= QUIZ_REWARD_DAILY_CAP) {
      await send(ctx, `✅ Correto! Seu acerto conta no ranking. O teto diário de recompensas do quiz já foi atingido; nenhum crédito extra foi emitido.`);
      return true;
    }

    const reward = await creditOnce(store, {
      userId,
      amount: QUIZ_REWARD,
      operationKey: `quiz:${snapshot.id}:${userId}`,
      kind: 'quiz_correct',
      groupId: ctx.jid,
      meta: { questionId: question.id }
    });
    await send(ctx, `✅ Correto! *+${reward.applied ? QUIZ_REWARD : 0} créditos*. O acerto também entrou no ranking do grupo.`);
    return true;
  }

  if (action === 'ranking') {
    const scores = await store.read((state) => state.quizScores?.[ctx.jid] ?? {});
    const rows = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 10);
    await send(ctx, rows.length ? `🏆 *RANKING DO QUIZ*\n\n${rows.map(([id, score], index) => `${index + 1}. ${maskedUser(id)} — *${score}* acerto(s)`).join('\n')}` : 'Ainda não há acertos registrados neste grupo.');
    return true;
  }

  return false;
}
