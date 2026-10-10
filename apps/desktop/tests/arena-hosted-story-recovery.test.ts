import { describe, expect, it, vi } from 'vitest';
import { DesktopArenaHostedAnyRecoveryPointerSchema, type DesktopArenaHostedAnyRecoveryPointer } from '@mahoshojo/contracts/desktop-arena-hosted-json';
import { DesktopArenaHostedStoryRecoveryPointerSchema } from '@mahoshojo/contracts/desktop-arena-story-transport';
import { ARENA_HOSTED_RECOVERY_KEYS, DesktopArenaHostedRecovery } from '../src/features/arena/hosted-recovery';
import { resumeArenaHosted } from '../src/features/arena/hosted';
const common = { product: 'battle' as const, requestId: 'recovery-story-request', bodyHash: 'a'.repeat(64), actor: { kind: 'anonymous' as const },
  format: 'markdown' as const, battleMode: 'daily' as const, state: 'prepared' as const, updatedAt: '2026-10-10T18:00:00.000Z' };
const story = (product: 'battle' | 'arena' = 'battle') => DesktopArenaHostedStoryRecoveryPointerSchema.parse({ ...common,
  version: 4, purpose: 'story', product, delivery: 'stream', protocolVersion: 'arena-hosted-sse-v1', storyProtocolVersion: 'arena-story-v1',
  inputDigest: `sha256:${'b'.repeat(64)}`, sessionId: 'original-session', operationId: 'original-operation', generationId: `arena_${'c'.repeat(64)}`, cursor: '80-0',
});
const legacy = (version: 1 | 2 | 3) => DesktopArenaHostedAnyRecoveryPointerSchema.parse({ ...common, requestId: `single-request-${version}`, version,
  protocolVersion: 'arena-hosted-sse-v1', ...(version !== 1 ? { delivery: 'stream' } : {}),
  ...(version === 3 ? { reconciliationVersion: 'arena-reconciliation-v1', writeArenaHistory: true, writeCurrentState: true } : {}),
});
function storage(product: 'battle' | 'arena' = 'battle', raw?: string) {
  const values = new Map<string, string>(); if (raw !== undefined) values.set(ARENA_HOSTED_RECOVERY_KEYS[product], raw);
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }), removeItem: vi.fn((key: string) => { values.delete(key); }) };
}
describe('story public-pointer ownership stays separate under the same two keys', () => {
  it.each([1, 2, 3] as const)('v%s retains its original single-report read/restore/update/replace/discard behavior', version => {
    const original = legacy(version), raw = JSON.stringify(original), store = storage('battle', raw);
    const owner = new DesktopArenaHostedRecovery(store, 'battle');
    expect(owner.getSnapshot()).toMatchObject({ pointer: original, storyPointer: null, pendingRestore: true });
    expect(store.setItem).not.toHaveBeenCalled(); expect(owner.acceptRestore(original.requestId)).toEqual(original);
    expect(owner.update(original.requestId, { state: 'unknown', cursor: '1-0' })).toBe(true);
    const next = { ...original, requestId: 'new-single-request' }; expect(owner.prepare(next, original.requestId)).toBe(true);
    expect(owner.rollbackPrepared(next.requestId)).toBe(true); expect(owner.getSnapshot().pointer?.version).toBe(version);
    expect(owner.discard()).toBe(true); expect(store.values.size).toBe(0);
  });
  it.each(['battle', 'arena'] as const)('%s v4 is recognized and preserved without ordinary restore or discard authority', product => {
    const original = story(product), raw = ` ${JSON.stringify(original)} `, store = storage(product, raw);
    const owner = new DesktopArenaHostedRecovery(store, product);
    expect(owner.getSnapshot()).toMatchObject({ pointer: null, storyPointer: original, pendingRestore: false, blocked: false, saved: true });
    expect(owner.getSnapshot().error).toContain('连续故事');
    expect(owner.acceptRestore(original.requestId)).toBeNull(); expect(owner.update(original.requestId, { state: 'failed' })).toBe(false);
    expect(owner.prepare({ ...legacy(3), product }, original.requestId, owner.captureReplacement())).toBe(false);
    expect(owner.rollbackPrepared(original.requestId)).toBe(false); expect(owner.discard()).toBe(false);
    expect(store.getItem(ARENA_HOSTED_RECOVERY_KEYS[product])).toBe(raw); expect(store.setItem).not.toHaveBeenCalled(); expect(store.removeItem).not.toHaveBeenCalled();
    expect(store.values.size).toBe(1); expect(Object.keys(ARENA_HOSTED_RECOVERY_KEYS)).toEqual(['battle', 'arena']);
  });
  it.each([{ funding: { mode: 'system' } }, { pendingRevision: 3 }, { writeOptions: {} }, { format: 'web' }, { inputDigest: 'bad' }])('preserves a malformed but clearly story-owned record %#', patch => {
    const raw = JSON.stringify({ ...story(), ...patch }), store = storage('battle', raw), owner = new DesktopArenaHostedRecovery(store, 'battle');
    expect(owner.getSnapshot().blocked).toBe(true); expect(owner.getSnapshot().pointer).toBeNull();
    expect(owner.discard()).toBe(false); expect(owner.prepare(legacy(1), common.requestId, owner.captureReplacement())).toBe(false);
    expect(store.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(raw);
  });
  it.each(['story', 'legacy', 'unknown'] as const)('retains an oversized %s original without parsing or granting destructive repair', kind => {
    const raw = (kind === 'story' ? JSON.stringify(story()) : kind === 'legacy' ? JSON.stringify(legacy(3)) : '{unreadable') + ' '.repeat(16_385);
    const store = storage('battle', raw), next = legacy(3);
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const owner = new DesktopArenaHostedRecovery(store, 'battle');
      expect(parse).not.toHaveBeenCalled();
      expect(owner.getSnapshot()).toMatchObject({ pointer: null, storyPointer: null, pendingRestore: false, blocked: true, saved: false });
      expect(owner.getSnapshot().error).toContain('超过读取上限');
      expect(owner.acceptRestore(common.requestId)).toBeNull();
      expect(owner.discard()).toBe(false); expect(owner.prepare(next)).toBe(false);
      expect(owner.prepare(next, common.requestId, owner.captureReplacement())).toBe(false);
      expect(owner.update(common.requestId, { state: 'failed' })).toBe(false); expect(owner.rollbackPrepared(common.requestId)).toBe(false);
      expect(store.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(raw);
      expect(store.setItem).not.toHaveBeenCalled(); expect(store.removeItem).not.toHaveBeenCalled();
    } finally { parse.mockRestore(); }
  });
  it('a resident legacy reader cannot replace or remove a later oversized story original', () => {
    const original = legacy(1), store = storage('battle', JSON.stringify(original));
    const owner = new DesktopArenaHostedRecovery(store, 'battle');
    const raw = JSON.stringify(story()) + ' '.repeat(16_385); store.values.set(ARENA_HOSTED_RECOVERY_KEYS.battle, raw);
    expect(owner.acceptRestore(original.requestId)).toBeNull(); expect(owner.discard()).toBe(false);
    expect(owner.prepare(legacy(3), original.requestId, owner.captureReplacement())).toBe(false);
    expect(store.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(raw);
    const reopened = new DesktopArenaHostedRecovery(store, 'battle');
    expect(reopened.discard()).toBe(false); expect(reopened.prepare(legacy(3), original.requestId, reopened.captureReplacement())).toBe(false);
    expect(store.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(raw); expect(store.removeItem).not.toHaveBeenCalled();
  });
  it('a stale single-report owner cannot discard, replace, roll back or update a newly written v4', () => {
    const original = legacy(3), store = storage('battle', JSON.stringify(original)), owner = new DesktopArenaHostedRecovery(store, 'battle');
    const next = { ...legacy(3), requestId: 'single-in-flight-123' }; expect(owner.prepare(next, original.requestId)).toBe(true);
    const raw = JSON.stringify(story()); store.values.set(ARENA_HOSTED_RECOVERY_KEYS.battle, raw);
    expect(owner.acceptRestore(next.requestId)).toBeNull();
    expect(owner.update(next.requestId, { state: 'failed' })).toBe(false); expect(owner.rollbackPrepared(next.requestId)).toBe(false);
    expect(owner.discard()).toBe(false); expect(owner.prepare({ ...next, requestId: 'third-single-request' }, next.requestId, owner.captureReplacement())).toBe(false);
    expect(store.getItem(ARENA_HOSTED_RECOVERY_KEYS.battle)).toBe(raw); expect(store.removeItem).not.toHaveBeenCalled();
  });
  it('neither the legacy schema nor direct legacy resume can claim v4', () => {
    const original = story(), invoke = vi.fn(), owner = new DesktopArenaHostedRecovery(storage('battle', JSON.stringify(original)), 'battle');
    expect(DesktopArenaHostedAnyRecoveryPointerSchema.safeParse(original).success).toBe(false);
    expect(() => resumeArenaHosted({ invoke }, original as unknown as DesktopArenaHostedAnyRecoveryPointer,
      { product: 'battle', scopeKey: 'anonymous', actor: common.actor, recovery: owner }, new AbortController().signal)).toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
