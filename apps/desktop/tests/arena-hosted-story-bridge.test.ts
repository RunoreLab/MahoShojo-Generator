import { describe, expect, it, vi } from 'vitest';
import { DesktopArenaHostedStoryReconcileRequestSchema, type DesktopArenaHostedStoryReconcileRequest } from '@mahoshojo/contracts/desktop-arena-story-transport';
import { reconcileArenaHostedStory } from '../src/platform/arena-hosted-story-bridge';
import type { ArenaHostedChannel } from '../src/platform/arena-hosted-bridge';
const generationId = `arena_${'a'.repeat(64)}`;
const request = DesktopArenaHostedStoryReconcileRequestSchema.parse({ operation: 'reconcile-story', product: 'arena', requestId: 'story-role-request',
  actor: { kind: 'account', expectedUserId: 7 }, pendingRevision: 3, inputDigest: `sha256:${'a'.repeat(64)}`, generationId });
const good = { version: 'arena-reconciliation-v1', generationId, success: true,
  updatedCombatants: [{ combatantIndex: 0, data: { name: '\ud800', signature: 'original' }, isNative: true }], warnings: [] };
function fixture(body: unknown = good, status = 200, lateFailure = false) {
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'arena_hosted_detach') return;
    expect(command).toBe('arena_hosted_stream'); expect(args!.request).toEqual(request);
    expect(args!.request).not.toHaveProperty('combatants'); expect(args!.request).not.toHaveProperty('expectedCombatantCount');
    const channel = args!.onEvent as ArenaHostedChannel;
    [
      { kind: 'json-response', status, generationId, generationRequestId: request.requestId, recoveryCredentialState: 'stored' },
      { kind: 'json-fragment', text: JSON.stringify(body), final: true }, { kind: 'json-end' },
    ].forEach((event, sequence) => channel.onmessage({ requestId: request.requestId, sequence, ...event }));
    if (lateFailure) throw { code: 'scope-changed', dispatchState: 'unknown', intentOwnership: 'current-owned', message: 'private-canary' };
  });
  return { invoke, run: () => reconcileArenaHostedStory(invoke, request, { expectedCombatantCount: 1, createChannel: () => ({ onmessage: () => undefined }) }) };
}
describe('story reconciliation uses sealed role originals through the existing Native command', () => {
  it('reuses the full JSON receiver and preserves raw role values', async () => {
    const h = fixture(); expect(await h.run()).toEqual(good); expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it('checks a local expected count without transmitting it', async () => {
    await expect(fixture({ ...good, updatedCombatants: [{ ...good.updatedCombatants[0], combatantIndex: 1 }] }).run()).rejects.toMatchObject({ code: 'protocol' });
  });
  it('does not trust a complete Channel envelope before the Native invocation settles', async () => {
    const h = fixture(good, 200, true); await expect(h.run()).rejects.toMatchObject({ code: 'scope-changed' }); expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it('returns a checked HTTP failure for the later owner to choose an explicit old-role outcome', async () => {
    const failure = { version: 'arena-reconciliation-v1', generationId, code: 'ARENA_RECONCILIATION_MANIFEST_UNAVAILABLE', error: '原清单不可用' };
    const h = fixture(failure, 409); expect(await h.run()).toEqual(failure); expect(h.invoke).toHaveBeenCalledTimes(1);
  });
  it.each([{ combatants: [] }, { body: {} }, { pendingRevision: 0 }, { modelCompleted: true }, { funding: { mode: 'system' } }])('rejects excess authority or invalid exact scope %#', patch => {
    const invoke = vi.fn(); expect(() => reconcileArenaHostedStory(invoke, { ...request, ...patch } as DesktopArenaHostedStoryReconcileRequest)).toThrow(); expect(invoke).not.toHaveBeenCalled();
  });
});
