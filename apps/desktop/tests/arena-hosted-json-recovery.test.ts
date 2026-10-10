import { describe, expect, it, vi } from 'vitest';
import { ARENA_COMPANION_PROTOCOL_VERSION } from '@mahoshojo/contracts/arena-companion';
import { DesktopArenaHostedRecoveryPointerV2Schema, type DesktopArenaHostedRecoveryPointerV2 } from '@mahoshojo/contracts/desktop-arena-hosted-json';
import { DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION } from '@mahoshojo/contracts/desktop-arena-hosted';
import { ARENA_HOSTED_RECOVERY_KEYS, DesktopArenaHostedRecovery } from '../src/features/arena/hosted-recovery';
const pointer = (delivery: 'stream' | 'non-stream', product: 'battle' | 'arena' = 'battle'): DesktopArenaHostedRecoveryPointerV2 => DesktopArenaHostedRecoveryPointerV2Schema.parse({
  version: 2, delivery, protocolVersion: delivery === 'stream' ? DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION : ARENA_COMPANION_PROTOCOL_VERSION,
  product, requestId: `request-${product}-${delivery}`, bodyHash: 'a'.repeat(64), actor: { kind: 'anonymous' },
  format: 'markdown', battleMode: 'classic', state: 'prepared', updatedAt: '2026-10-10T07:00:00.000Z',
});
function storage(raw?: string) {
  const values = new Map<string, string>(); if (raw) values.set(ARENA_HOSTED_RECOVERY_KEYS.battle, raw);
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: (key: string) => { values.delete(key); } };
}
describe('non-stream Arena recovery uses the same two guarded owners', () => {
  it('reads legacy v1 without migrating it and keeps structured delivery in v2 across reopen', () => {
    const v2 = pointer('stream'); const { delivery: _delivery, ...shape } = v2;
    const raw = JSON.stringify({ ...shape, version: 1 }); const store = storage(raw);
    const old = new DesktopArenaHostedRecovery(store, 'battle');
    expect(old.getSnapshot().pointer?.version).toBe(1); expect(store.setItem).not.toHaveBeenCalled();
    const next = pointer('non-stream'); expect(old.prepare(next, v2.requestId)).toBe(true);
    const restored = new DesktopArenaHostedRecovery(store, 'battle');
    expect(restored.getSnapshot().pointer).toEqual(next); expect(restored.getSnapshot().pendingRestore).toBe(true);
    expect(restored.acceptRestore(next.requestId)).toEqual(next);
    expect(store.values.size).toBe(1); expect(store.values.has(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(true);
  });
  it('isolates products and protects a corrupted or unsupported delivery original', () => {
    for (const bad of [{ ...pointer('non-stream'), protocolVersion: DESKTOP_ARENA_HOSTED_PROTOCOL_VERSION }, { ...pointer('non-stream'), delivery: 'guess-json' }]) {
      const raw = JSON.stringify(bad); const store = storage(raw); const battle = new DesktopArenaHostedRecovery(store, 'battle');
      expect(battle.getSnapshot().blocked).toBe(true); expect(battle.prepare(pointer('non-stream'))).toBe(false);
      const arena = new DesktopArenaHostedRecovery(store, 'arena'); expect(arena.prepare(pointer('non-stream', 'arena'))).toBe(true);
      expect(store.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(raw); expect(store.values.size).toBe(2);
    }
  });
  it('keeps the native ownership rollback and disk CAS across delivery versions', () => {
    const previous = pointer('stream'), raw = JSON.stringify(previous), store = storage(raw);
    const recovery = new DesktopArenaHostedRecovery(store, 'battle'), next = pointer('non-stream');
    expect(recovery.prepare(next, previous.requestId)).toBe(true); expect(recovery.rollbackPrepared(next.requestId)).toBe(true);
    expect(store.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(raw);
    expect(recovery.prepare(next, previous.requestId)).toBe(true);
    const external = JSON.stringify({ ...pointer('stream'), requestId: 'external-new-request' });
    store.values.set(ARENA_HOSTED_RECOVERY_KEYS.battle, external);
    expect(recovery.rollbackPrepared(next.requestId)).toBe(false);
    expect(recovery.update(next.requestId, { state: 'failed' })).toBe(false);
    expect(store.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(external);
  });
});
