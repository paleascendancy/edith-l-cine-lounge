import type { LedgerEntry, StateStore, V2State } from './state.js';

export const economyConfig = {
  dailyCredits: Number(process.env.ECONOMY_DAILY_CREDITS || 25),
  vip7DaysCredits: Number(process.env.ECONOMY_VIP_7D_CREDITS || 1200),
  vip30DaysCredits: Number(process.env.ECONOMY_VIP_30D_CREDITS || 4000),
  ledgerLimit: 3000
} as const;

export const shopCatalog = [
  { id: 'titulo_cinefilo', label: 'Título Cinéfilo', credits: 250 },
  { id: 'emblema_tempest', label: 'Emblema Tempest', credits: 400 },
  { id: 'tema_nox_azul', label: 'Tema NOX Azul', credits: 600 }
] as const;

function wallet(state: V2State, userId: string): { credits: number; gems: number } {
  state.wallets[userId] ??= { credits: 0, gems: 0 };
  return state.wallets[userId]!;
}

function addLedger(state: V2State, entry: LedgerEntry): void {
  state.ledger.push(entry);
  if (state.ledger.length > economyConfig.ledgerLimit) {
    state.ledger.splice(0, state.ledger.length - economyConfig.ledgerLimit);
  }
  state.processedOps[entry.operationKey] = entry.createdAt;
}

export async function creditOnce(store: StateStore, input: { userId: string; amount: number; operationKey: string; kind: string; groupId?: string | null; meta?: Record<string, unknown> }): Promise<{ applied: boolean; balance: number }> {
  return store.mutate((state) => {
    const account = wallet(state, input.userId);
    if (state.processedOps[input.operationKey]) return { applied: false, balance: account.credits };
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error('INVALID_CREDIT');
    account.credits += input.amount;
    addLedger(state, {
      id: crypto.randomUUID(), operationKey: input.operationKey, userId: input.userId,
      delta: input.amount, kind: input.kind, groupId: input.groupId ?? null,
      createdAt: Date.now(), meta: input.meta ?? {}
    });
    return { applied: true, balance: account.credits };
  });
}

export async function spendOnce(store: StateStore, input: { userId: string; amount: number; operationKey: string; kind: string; groupId?: string | null; meta?: Record<string, unknown> }): Promise<{ applied: boolean; balance: number; reason?: 'INSUFFICIENT' }> {
  return store.mutate((state) => {
    const account = wallet(state, input.userId);
    if (state.processedOps[input.operationKey]) return { applied: false, balance: account.credits };
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error('INVALID_SPEND');
    if (account.credits < input.amount) return { applied: false, balance: account.credits, reason: 'INSUFFICIENT' };
    account.credits -= input.amount;
    addLedger(state, {
      id: crypto.randomUUID(), operationKey: input.operationKey, userId: input.userId,
      delta: -input.amount, kind: input.kind, groupId: input.groupId ?? null,
      createdAt: Date.now(), meta: input.meta ?? {}
    });
    return { applied: true, balance: account.credits };
  });
}

export async function balance(store: StateStore, userId: string): Promise<number> {
  return store.read((state) => state.wallets[userId]?.credits ?? 0);
}

export async function statement(store: StateStore, userId: string, limit = 10): Promise<LedgerEntry[]> {
  return store.read((state) => state.ledger.filter((entry) => entry.userId === userId).slice(-limit).reverse());
}

export async function leaderboard(store: StateStore, limit = 10): Promise<Array<{ userId: string; credits: number }>> {
  return store.read((state) => Object.entries(state.wallets)
    .map(([userId, value]) => ({ userId, credits: value.credits }))
    .sort((a, b) => b.credits - a.credits)
    .slice(0, limit));
}
