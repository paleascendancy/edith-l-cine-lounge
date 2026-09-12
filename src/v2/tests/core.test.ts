import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStateStore } from '../state.js';
import { creditOnce, spendOnce } from '../economy.js';
import { commandByName, visibleCommands } from '../registry.js';

test('economy reward is idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rimuru-v2-test-'));
  try {
    const store = new JsonStateStore(dir); await store.init();
    const first = await creditOnce(store, { userId: 'pn:5511999999999', amount: 25, operationKey: 'msg:1:daily', kind: 'daily' });
    const second = await creditOnce(store, { userId: 'pn:5511999999999', amount: 25, operationKey: 'msg:1:daily', kind: 'daily' });
    assert.equal(first.applied, true);
    assert.equal(second.applied, false);
    assert.equal(second.balance, 25);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('concurrent spending never makes balance negative', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rimuru-v2-test-'));
  try {
    const store = new JsonStateStore(dir); await store.init();
    await creditOnce(store, { userId: 'pn:1', amount: 100, operationKey: 'seed', kind: 'seed' });
    const results = await Promise.all([
      spendOnce(store, { userId: 'pn:1', amount: 80, operationKey: 'buy-a', kind: 'purchase' }),
      spendOnce(store, { userId: 'pn:1', amount: 80, operationKey: 'buy-b', kind: 'purchase' })
    ]);
    assert.equal(results.filter((result) => result.applied).length, 1);
    const final = await store.read((state) => state.wallets['pn:1']?.credits ?? -1);
    assert.equal(final, 20);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('registry aliases and permissions are centralized', () => {
  assert.equal(commandByName('ajuda')?.name, 'menu');
  assert.equal(commandByName('RPG'.toLowerCase())?.name, 'rpg');
  const common = visibleCommands({ isOwner: false, isAdmin: false, isVip: false, isGroup: true });
  assert.equal(common.some((command) => command.name === 'adddono'), false);
  assert.equal(common.some((command) => command.name === 'saldo'), true);
});
