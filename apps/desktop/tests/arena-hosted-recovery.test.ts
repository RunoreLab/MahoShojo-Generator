import { describe, expect, it } from 'vitest';
import { DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION, DesktopArenaHostedRecoveryPointerSchema, type DesktopArenaHostedRecoveryPointer } from '@mahoshojo/contracts/desktop-arena-hosted';
import { ARENA_HOSTED_RECOVERY_KEYS, DesktopArenaHostedRecovery } from '../src/features/arena/hosted-recovery';

const requestId = 'arena-request-0001';
const pointer = (overrides: Partial<DesktopArenaHostedRecoveryPointer> = {}): DesktopArenaHostedRecoveryPointer => ({
  version: 1, protocolVersion: DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION, product: 'battle', requestId,
  bodyHash: 'a'.repeat(64), actor: { kind: 'anonymous' }, format: 'markdown', battleMode: 'classic',
  state: 'prepared', updatedAt: '2026-10-10T04:00:00.000Z', ...overrides,
});
class Storage {
  values = new Map<string, string>(); failWrite = false; failRemove = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrite) throw new Error('disk'); this.values.set(key, value); }
  removeItem(key: string) { if (this.failRemove) throw new Error('disk'); this.values.delete(key); }
}

describe('Arena Hosted public recovery pointer owner', () => {
  it('isolates products from each other and from the potentially oversized result draft', () => {
    const storage = new Storage(); storage.values.set('mahoshojo.desktop.arena.battle.draft.v1', 'x'.repeat(4 * 1024 * 1024 + 1));
    const battle = new DesktopArenaHostedRecovery(storage, 'battle'); const arena = new DesktopArenaHostedRecovery(storage, 'arena');
    expect(battle.prepare(pointer())).toBe(true);
    expect(arena.prepare(pointer({ product: 'arena', requestId: 'arena-request-0002' }))).toBe(true);
    const restored = new DesktopArenaHostedRecovery(storage, 'battle'); expect(restored.getSnapshot().pendingRestore).toBe(true);
    expect(restored.acceptRestore('wrong-request')).toBeNull(); expect(restored.acceptRestore(requestId)?.requestId).toBe(requestId);
    expect(restored.discard()).toBe(true); expect(storage.getItem(ARENA_HOSTED_RECOVERY_KEYS.arena)).not.toBeNull();
    expect(storage.getItem('mahoshojo.desktop.arena.battle.draft.v1')?.length).toBe(4 * 1024 * 1024 + 1);
  });

  it.each(['{', JSON.stringify({ ...pointer(), version: 2 }), JSON.stringify({ ...pointer(), product: 'arena' }), JSON.stringify({ ...pointer(), token: 'canary' }), ' '.repeat(16385)])('preserves an invalid original and refuses replacement until explicit successful discard', (raw) => {
    const storage = new Storage(); storage.values.set(ARENA_HOSTED_RECOVERY_KEYS.battle, raw);
    const owner = new DesktopArenaHostedRecovery(storage, 'battle'); expect(owner.getSnapshot().blocked).toBe(true);
    expect(owner.prepare(pointer())).toBe(false); expect(storage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(raw);
    storage.failRemove = true; expect(owner.discard()).toBe(false); expect(owner.getSnapshot().blocked).toBe(true);
    storage.failRemove = false; expect(owner.discard()).toBe(true); expect(owner.prepare(pointer())).toBe(true);
  });

  it('requires exact replacement consent even when C0 says cancelled, and never resets an existing request to create', () => {
    const storage = new Storage(); const owner = new DesktopArenaHostedRecovery(storage, 'battle');
    expect(owner.prepare(pointer())).toBe(true); owner.update(requestId, { state: 'cancelled' });
    expect(owner.prepare(pointer())).toBe(false); expect(owner.getSnapshot().pointer?.state).toBe('cancelled');
    const next = pointer({ requestId: 'arena-request-0002' });
    expect(owner.prepare(next)).toBe(false); expect(owner.prepare(next, 'different-request')).toBe(false);
    expect(owner.prepare(next, requestId)).toBe(true);
    expect(owner.update(requestId, { state: 'completed' })).toBe(false);
    expect(owner.getSnapshot().pointer?.requestId).toBe(next.requestId);
  });

  it('distinguishes pre-dispatch write failure from a live pointer update failure without losing identity', () => {
    const storage = new Storage(); const owner = new DesktopArenaHostedRecovery(storage, 'battle');
    storage.failWrite = true; expect(owner.prepare(pointer())).toBe(false); expect(owner.getSnapshot().pointer).toBeNull();
    storage.failWrite = false; expect(owner.prepare(pointer())).toBe(true);
    const original = storage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle); storage.failWrite = true;
    expect(owner.update(requestId, { state: 'unknown', generationId: `arena_${'b'.repeat(64)}`, cursor: '2-1' })).toBe(false);
    expect(owner.getSnapshot().pointer?.cursor).toBe('2-1'); expect(owner.getSnapshot().saved).toBe(false);
    expect(storage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(original);
    storage.failWrite = false; expect(owner.update(requestId, { state: 'resuming' })).toBe(true);
    expect(JSON.parse(storage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)!).cursor).toBe('2-1');
  });

  it('rejects malformed updates without overwriting a valid cursor or publishing input values in errors', () => {
    const storage = new Storage(); const owner = new DesktopArenaHostedRecovery(storage, 'battle'); owner.prepare(pointer());
    expect(owner.update(requestId, { cursor: 'canary-invalid' })).toBe(false);
    expect(owner.getSnapshot().pointer?.cursor).toBeUndefined(); expect(owner.getSnapshot().error).not.toContain('canary');
    expect(owner.prepare(pointer({ product: 'arena', requestId: 'arena-request-0002' }), requestId)).toBe(false);
    expect(owner.getSnapshot().pointer?.requestId).toBe(requestId);
  });
});

it('rolls a prewritten intent back only by its exact request and preserves corrupt originals', () => {
  const values = new Map<string, string>([[ARENA_HOSTED_RECOVERY_KEYS.battle, '{broken original']]);
  const memory = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const owner = new DesktopArenaHostedRecovery(memory, 'battle');
  const next = DesktopArenaHostedRecoveryPointerSchema.parse({ version: 1, protocolVersion: 'arena-hosted-sse-v1', product: 'battle', requestId: 'next-intent-1', bodyHash: 'a'.repeat(64), actor: { kind: 'anonymous' }, format: 'markdown', battleMode: 'daily', state: 'prepared', updatedAt: '2026-10-10T05:00:00.000Z' });
  expect(owner.prepare(next)).toBe(false); expect(owner.prepare(next, 'diagnosed-original-id', owner.captureReplacement())).toBe(true);
  expect(owner.rollbackPrepared('wrong-intent')).toBe(false); expect(owner.rollbackPrepared(next.requestId)).toBe(true);
  expect(values.get(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe('{broken original'); expect(owner.getSnapshot().blocked).toBe(true);
  expect(owner.prepare(next, 'diagnosed-original-id', owner.captureReplacement())).toBe(true); owner.settlePrepared(next.requestId);
  expect(owner.rollbackPrepared(next.requestId)).toBe(false); expect(owner.getSnapshot().pointer?.requestId).toBe(next.requestId);
});


it('uses independent local and Native identities for explicit diagnosed replacement', () => {
  const storage = new Storage(), owner = new DesktopArenaHostedRecovery(storage, 'battle'); owner.prepare(pointer());
  const repair = owner.captureReplacement(), next = pointer({ requestId: 'new-intent-0002' });
  expect(owner.prepare(next, 'different-native-intent', repair)).toBe(true);
  expect(owner.rollbackPrepared(next.requestId)).toBe(true); expect(owner.getSnapshot().pointer?.requestId).toBe(requestId);
  const stale = owner.captureReplacement(); owner.update(requestId, { state: 'unknown' });
  expect(owner.prepare(next, 'different-native-intent', stale)).toBe(false);
  expect(owner.getSnapshot().pointer?.requestId).toBe(requestId);
});

it('keeps the corrupt original on failed single-write replacement and rejects externally changed originals', () => {
  const storage = new Storage(); storage.values.set(ARENA_HOSTED_RECOVERY_KEYS.battle, '{original');
  const owner = new DesktopArenaHostedRecovery(storage, 'battle'); storage.failWrite = true;
  expect(owner.prepare(pointer(), 'native-request-0002', owner.captureReplacement())).toBe(false);
  expect(storage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe('{original'); expect(owner.getSnapshot().blocked).toBe(true);
  storage.failWrite = false; const repair = owner.captureReplacement(); storage.values.set(ARENA_HOSTED_RECOVERY_KEYS.battle, '{new original');
  expect(owner.prepare(pointer(), 'native-request-0002', repair)).toBe(false);
  expect(storage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe('{new original');
});

it('preserves the prior identity in memory when a proved rollback cannot write and never rolls over a newer pointer', () => {
  const storage = new Storage(), owner = new DesktopArenaHostedRecovery(storage, 'battle'); owner.prepare(pointer()); owner.settlePrepared(requestId);
  const next = pointer({ requestId: 'new-intent-0002' }); owner.prepare(next, requestId); storage.failWrite = true;
  expect(owner.rollbackPrepared(next.requestId)).toBe(false); expect(owner.getSnapshot().pointer?.requestId).toBe(requestId);
  expect(owner.getSnapshot().saved).toBe(false); expect(JSON.parse(storage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)!).requestId).toBe(next.requestId);
  storage.failWrite = false; owner.prepare(pointer({ requestId: 'new-intent-0003' }), requestId);
  expect(owner.rollbackPrepared(next.requestId)).toBe(false); expect(owner.getSnapshot().pointer?.requestId).toBe('new-intent-0003');
});


it('does not overwrite a new disk pointer when a late prior-retained proof reaches rollback', () => {
  const storage = new Storage(), owner = new DesktopArenaHostedRecovery(storage, 'battle'); owner.prepare(pointer()); owner.settlePrepared(requestId);
  const next = pointer({ requestId: 'new-intent-0002' }); owner.prepare(next, requestId);
  const external = JSON.stringify(pointer({ requestId: 'external-intent-0003' })); storage.values.set(ARENA_HOSTED_RECOVERY_KEYS.battle, external);
  expect(owner.rollbackPrepared(next.requestId)).toBe(false); expect(storage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(external);
  expect(owner.getSnapshot().error).toContain('外部变化');
  expect(owner.prepare(pointer({ requestId: 'new-intent-0004' }), next.requestId)).toBe(false);
  expect(storage.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(external);
});
