import { describe, expect, it, vi } from 'vitest';
import { reconcileArenaHosted } from '../src/platform/arena-reconciliation-bridge';
const generationId = `arena_${'a'.repeat(64)}`;
const scope = { product: 'battle' as const, requestId: 'role-bridge-123', actor: { kind: 'anonymous' as const } };
const payload = { generationId, combatants: [{ type: 'general-character', data: { name: '甲' } }] };
const good = { version: 'arena-reconciliation-v1', generationId, success: true, updatedCombatants: [{ combatantIndex: 0, data: { name: '甲', signature: 'synthetic' }, isNative: true }], warnings: [] };
function fixture(events: Record<string, unknown>[], response: unknown = good) {
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'arena_hosted_detach') return;
    expect(args!.request).toEqual({ ...scope, operation: 'reconcile', ...payload });
    const channel = args!.onEvent as { onmessage(event: unknown): void };
    events.forEach((event, sequence) => channel.onmessage({ requestId: scope.requestId, sequence, ...event, ...(event.kind === 'json-fragment' && !('text' in event) ? { text: JSON.stringify(response) } : {}) }));
  });
  return { invoke, run: () => reconcileArenaHosted(invoke, scope, payload, { createChannel: () => ({ onmessage: () => undefined }) }) };
}
const handshake = { kind: 'json-response', status: 200, generationId, generationRequestId: scope.requestId, recoveryCredentialState: 'stored' };
const fragment = { kind: 'json-fragment', final: true }, end = { kind: 'json-end' };
describe('narrow Native role response assembly', () => {
  it('accepts a complete checked reply only after end, including lone surrogate values', async () => {
    const reply = { ...good, updatedCombatants: [{ ...good.updatedCombatants[0]!, data: { name: '\ud800', signature: 'synthetic' } }] };
    expect(await fixture([handshake, fragment, end], reply).run()).toEqual(reply);
  });
  it.each([
    [fragment, end], [handshake, end], [handshake, fragment],
    [handshake, { ...fragment, final: false }, end], [handshake, fragment, fragment, end],
    [handshake, { ...fragment, sequence: 4 }, end], [handshake, { ...fragment, requestId: 'other-request' }, end],
    [{ ...handshake, generationId: `arena_${'b'.repeat(64)}` }, fragment, end],
    [{ ...handshake, status: 409 }, fragment, end],
  ])('rejects missing, duplicate, late or mismatched delivery %# atomically', async (...events) => {
    await expect(fixture(events).run()).rejects.toBeInstanceOf(Error);
  });
  it.each([
    { ...good, version: 'wrong' }, { ...good, generationId: `arena_${'b'.repeat(64)}` },
    { ...good, updatedCombatants: [...good.updatedCombatants, ...good.updatedCombatants] },
    { ...good, updatedCombatants: [{ ...good.updatedCombatants[0], combatantIndex: 1 }] },
    { ...good, updatedCombatants: [{ ...good.updatedCombatants[0], combatantIndex: -1 }] },
    { ...good, updatedCombatants: [{ ...good.updatedCombatants[0], combatantIndex: 0.5 }] },
    { ...good, updatedCombatants: [{ ...good.updatedCombatants[0], data: { name: '甲' } }] },
  ])('rejects inconsistent authoritative payload %#', async response => { await expect(fixture([handshake, fragment, end], response).run()).rejects.toBeInstanceOf(Error); });
  it('retains explicit failure code without retrying generation', async () => {
    const failure = { version: 'arena-reconciliation-v1', generationId, code: 'ARENA_RECONCILIATION_MANIFEST_UNAVAILABLE', error: '不可用' };
    const f = fixture([{ ...handshake, status: 409 }, fragment, end], failure); expect(await f.run()).toEqual(failure); expect(f.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(['reconciliation-capability-unavailable', 'reconciliation-output-too-large'])('preserves the bounded Native failure %s without leaking raw text', async code => {
    const invoke = vi.fn(async () => { throw { code, message: 'secret-canary', dispatchState: 'not-dispatched', intentOwnership: 'current-owned' }; });
    try { await reconcileArenaHosted(invoke, scope, payload, { createChannel: () => ({ onmessage: () => undefined }) }); throw new Error('expected rejection'); }
    catch (cause) { expect(cause).toMatchObject({ code, dispatchState: 'not-dispatched' }); expect((cause as Error).message).toContain('原卡'); expect((cause as Error).message).not.toContain('secret-canary'); }
  });
  it.each(['scope-changed', 'detached', 'transport'])('rejects Native %s after a complete JSON envelope instead of trusting stale signatures', async code => {
    let fail!: (_cause: unknown) => void;
    const invocation = new Promise<void>((_resolve, reject) => { fail = reject; });
    const invoke = vi.fn((_command: string, args?: Record<string, unknown>) => {
      const channel = args!.onEvent as { onmessage(event: unknown): void };
      [handshake, { ...fragment, text: JSON.stringify(good) }, end].forEach((event, sequence) => channel.onmessage({ requestId: scope.requestId, sequence, ...event }));
      return invocation;
    });
    const running = reconcileArenaHosted(invoke, scope, payload, { createChannel: () => ({ onmessage: () => undefined }) });
    fail({ code, message: 'private-canary', dispatchState: 'possibly-dispatched', intentOwnership: 'current-owned' });
    await expect(running).rejects.toBeInstanceOf(Error);
  });
  it('an already cancelled role operation never invokes Native', async () => {
    const controller = new AbortController(); controller.abort(); const invoke = vi.fn();
    await expect(reconcileArenaHosted(invoke, scope, payload, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(invoke).not.toHaveBeenCalled();
  });
});
