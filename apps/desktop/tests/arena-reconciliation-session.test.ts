/** Real session + Hosted adapters + role bridge, using synthetic Native-shaped IPC; no production credentials. */
import { describe, expect, it, vi } from 'vitest';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { DesktopArenaSession, createInitialArenaDraft, type ArenaDraft } from '../src/features/arena/session';
import { ARENA_HOSTED_RECOVERY_KEYS } from '../src/features/arena/hosted-recovery';
const generationId = `arena_${'e'.repeat(64)}`, requestId = 'role-request-123', now = '2026-10-10T10:00:00.000Z';
const card = { name: '甲', content: 'original', signature: 'original-signature' };
const report = { headline: '报告', reporterInfo: { name: '记者', publication: '刊物' }, mode: 'daily', article: { body: '报告原文', analysis: '分析' }, officialReport: { winner: '甲', conclusion: '结论' } };
const initial = createInitialArenaDraft();
function fixture(product: 'battle' | 'arena' = 'battle', delivery: 'stream' | 'non-stream' = 'stream', values = new Map<string, string>()) {
  let held = false, holdNative = false, holdRoleNative = false, generationActive = false, releaseNative: (() => void) | undefined, releaseRoleNative: (() => void) | undefined, release: (() => void) | undefined, failure: string | undefined, terminalFailure = false, invalid = false, saveFailure = false;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, raw: string) => { values.set(key, raw); }, removeItem: (key: string) => { values.delete(key); } };
  const records = new Map<string, LocalCardRecordV1>();
  const repository = { get: async (id: string) => records.get(id) ?? null, putIfAbsent: vi.fn(async (value: LocalCardRecordV1) => {
    if (saveFailure) throw new Error('disk-full'); if (records.has(value.id)) return { alreadyPresent: true }; records.set(value.id, value); return { written: true };
  }) } as unknown as CardRepository;
  const session = new DesktopArenaSession({ product, storage, repository, requestId: () => requestId, now: () => now,
    hostedTestPorts: { createChannel: () => ({ onmessage: () => undefined }), wait: async () => undefined, maxReconnectAttempts: 0 } }); session.setScope('account-A:epoch-1');
  const draft: ArenaDraft = { ...initial, generationMode: delivery, battleMode: 'daily', combatants: [{ type: 'general-character', isValid: true, isPreset: false, filename: '甲.json', data: structuredClone(card) }] };
  const requests: Record<string, any>[] = []; let writes = { writeArenaHistory: false, writeCurrentState: false };
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'arena_hosted_detach') { release?.(); return; }
    const request = args!.request as Record<string, any>; requests.push(request);
    if (request.operation === 'lookup-request') return { status: 200, recoveryCredentialState: 'stored', body: { generationId, generationRequestId: requestId, status: 'completed' } };
    const channel = args!.onEvent as { onmessage(value: unknown): void }; let sequence = 0;
    const send = (value: Record<string, unknown>) => channel.onmessage({ requestId, sequence: sequence++, ...value });
    const json = (value: unknown, status = 200) => {
      send({ kind: 'json-response', status, generationId, generationRequestId: requestId, recoveryCredentialState: 'stored' });
      const raw = JSON.stringify(value);
      for (let i = 0; i < raw.length; i += 16000) send({ kind: 'json-fragment', text: raw.slice(i, i + 16000), final: i + 16000 >= raw.length });
      send({ kind: 'json-end' });
    };
    if (request.operation === 'reconcile') {
      if (generationActive) throw { code: 'subscription-in-progress', message: 'synthetic Native guard still held', dispatchState: 'not-dispatched', intentOwnership: 'current-owned' };
      if (held) await new Promise<void>(done => { release = done; });
      if (failure) { json({ version: 'arena-reconciliation-v1', generationId, code: failure, error: failure }, 409); return; }
      const data = { ...request.combatants[0].data,
        ...(writes.writeArenaHistory ? { arena_history: { entries: [{ id: 1, impact: '经历', metadata: { generation_id: generationId } }] } } : {}),
        ...(writes.writeCurrentState ? { current_state: { summary: '状态', generation_id: generationId } } : {}), signature: 'fresh-server-signature' };
      json({ version: 'arena-reconciliation-v1', generationId, success: true,
        updatedCombatants: [{ combatantIndex: invalid ? 1 : 0, data, isNative: true }], warnings: [] });
      if (holdRoleNative) await new Promise<void>(done => { releaseRoleNative = done; }); if (terminalFailure) throw { code: 'scope-changed', dispatchState: 'possibly-dispatched', intentOwnership: 'current-owned' }; return;
    }
    if (request.operation === 'create-stream' || request.operation === 'create-json') writes = { writeArenaHistory: request.body.writeArenaHistory, writeCurrentState: request.body.writeCurrentState };
    generationActive = true;
    if (request.operation === 'create-json') { json({ version: 'arena-companion-v1', body: { report, updatedCombatants: [], generationId }, metadata: { reportFormat: 'markdown', outputContract: 'structured-report', mode: 'daily' } }); if (holdNative) await new Promise<void>(done => { releaseNative = done; }); generationActive = false; return; }
    send({ kind: 'response', status: 200, generationId, generationRequestId: requestId, metadataState: 'missing', recoveryCredentialState: 'stored' });
    const markdown = delivery === 'stream' ? '报告原文' : JSON.stringify(report);
    send({ kind: 'sse-fragment', final: true, text: `id: 1-0\nevent: markdown\ndata: ${JSON.stringify({ chunk: markdown })}\n\n` });
    send({ kind: 'sse-fragment', final: true, text: 'id: 2-0\nevent: done\ndata: {"status":"completed","ok":true}\n\n' }); send({ kind: 'stream-end' }); if (holdNative) await new Promise<void>(done => { releaseNative = done; }); generationActive = false;
  });
  const run = async (input = draft, account = false, preset = false) => { session.updateDraft(input); await session.generateHosted({ invoke }, input,
    { mode: 'hosted', generationMode: delivery, modelId: 'default', ...(preset ? { presetConfig: { providerId: 'openai', modelId: 'gpt-4o' } } : { systemConfig: {} }) },
    account ? { kind: 'account', expectedUserId: 123 } : { kind: 'anonymous' }); };
  return { session, draft, invoke, run, requests, values, records, holdNative: () => { holdNative = true; }, releaseNative: () => releaseNative?.(), holdRoleNative: () => { holdRoleNative = true; }, releaseRoleNative: () => releaseRoleNative?.(), hold: () => { held = true; }, release: () => release?.(), fail: (code?: string) => { failure = code; }, invalid: () => { invalid = true; }, failAfterRoleEnd: () => { terminalFailure = true; }, failSave: (value: boolean) => { saveFailure = value; } };
}
const matrix = (['battle', 'arena'] as const).flatMap(product => (['stream', 'non-stream'] as const).flatMap(delivery => [false, true].flatMap(account => [false, true].flatMap(preset => [false, true].flatMap(history => [false, true].map(state => ({ product, delivery, account, preset, history, state })))))));
describe('new Hosted roles freeze original policy and preserve independent report completion', () => {
  it.each(matrix)('$product/$delivery account=$account preset=$preset history=$history state=$state', async test => {
    const f = fixture(test.product, test.delivery); const input = { ...f.draft, settings: { ...f.draft.settings, writeArenaHistory: test.history, writeCurrentState: test.state } };
    await f.run(input, test.account, test.preset);
    expect(f.session.getSnapshot().phase).toBe('completed'); expect(f.session.getSnapshot().markdown).toBe('报告原文');
    const create = f.requests[0]!; expect(create).toMatchObject({ reconciliationVersion: 'arena-reconciliation-v1', body: { writeArenaHistory: test.history, writeCurrentState: test.state } });
    expect(JSON.parse(f.values.get(ARENA_HOSTED_RECOVERY_KEYS[test.product])!)).toMatchObject({ version: 3, writeArenaHistory: test.history, writeCurrentState: test.state });
    const roles = f.requests.filter(request => request.operation === 'reconcile'); expect(roles).toHaveLength(test.history || test.state ? 1 : 0);
    if (roles.length) {
      expect(roles[0]).toMatchObject({ actor: create.actor, requestId, generationId }); expect(roles[0]).not.toHaveProperty('presetConfig'); expect(roles[0]).not.toHaveProperty('systemConfig'); expect(roles[0]).not.toHaveProperty('url');
      expect(f.session.getSnapshot().roleUpdates.status).toBe('completed');
      expect(f.session.getSnapshot().draft.combatants[0]!.data).toHaveProperty('signature', 'fresh-server-signature');
      expect(f.records.size).toBe(0); expect(await f.session.save('characters')).toBe(true);
      expect([...f.records.values()][0]!.provenance).toEqual({ kind: 'official-signed', signature: 'fresh-server-signature', execution: 'hosted' });
    } else expect(f.session.getSnapshot().draft.combatants[0]!.data).toEqual(card);
    expect(input.combatants[0]!.data).toEqual(card); expect(f.requests.filter(request => request.operation.startsWith('create'))).toHaveLength(1); f.session.dispose();
  });
  it.each(['ARENA_RECONCILIATION_MANIFEST_UNAVAILABLE', 'ARENA_RECONCILIATION_FINALIZATION_PENDING', 'ARENA_RECONCILIATION_RESPONSE_TOO_LARGE'])('keeps report/card after %s and retries only existing generation', async code => {
    const f = fixture(); f.fail(code); await f.run(); expect(f.session.getSnapshot()).toMatchObject({ phase: 'completed', roleUpdates: { status: 'unavailable' } });
    expect(f.session.getSnapshot().draft.combatants[0]!.data).toEqual(card); expect(f.session.getSnapshot().rawText).toBe('报告原文');
    f.fail(); await f.session.retryHostedRoleUpdates({ invoke: f.invoke }); expect(f.session.getSnapshot().roleUpdates.status).toBe('completed');
    expect(f.requests.filter(request => request.operation === 'reconcile')).toHaveLength(2); expect(f.requests.filter(request => request.operation.startsWith('create'))).toHaveLength(1); f.session.dispose();
  });
  it.each(['cancel', 'detach', 'scope', 'dispose'] as const)('drops late role updates on %s without changing completed report or issuing stop/create', async action => {
    const f = fixture(); f.hold(); const running = f.run(); await vi.waitFor(() => expect(f.session.getSnapshot().roleUpdates.status).toBe('updating'));
    await f.session.retryHostedRoleUpdates({ invoke: f.invoke }); expect(f.requests.filter(request => request.operation === 'reconcile')).toHaveLength(1);
    if (action === 'scope') f.session.setScope('account-B:epoch-2'); else f.session[action](); f.release(); await running;
    expect(f.session.getSnapshot().phase).toBe('completed'); expect(f.session.getSnapshot().rawText).toBe('报告原文'); expect(f.session.getSnapshot().draft.combatants[0]!.data).toEqual(card);
    expect(f.requests.some(request => request.operation === 'stop')).toBe(false); expect(f.requests.filter(request => request.operation.startsWith('create'))).toHaveLength(1); f.session.dispose();
  });
  it.each(['stream', 'non-stream'] as const)('waits for actual %s Native invocation settlement after terminal IPC before automatic reconciliation', async delivery => {
    const f = fixture('battle', delivery); f.holdNative(); const running = f.run();
    await vi.waitFor(() => expect(f.session.getSnapshot().phase).toBe('completed'));
    expect(f.session.isBusy()).toBe(true); expect(f.requests.filter(request => request.operation === 'reconcile')).toHaveLength(0);
    await f.session.retryHostedRoleUpdates({ invoke: f.invoke }); expect(f.requests).toHaveLength(1);
    f.releaseNative(); await running; expect(f.session.getSnapshot().roleUpdates.status).toBe('completed'); expect(f.requests).toHaveLength(2); f.session.dispose();
  });
  it('does not unlock role retries when terminal JSON IPC arrived but its Native invocation still owns the guard', async () => {
    const f = fixture(); f.holdRoleNative(); const running = f.run();
    await vi.waitFor(() => expect(f.requests.filter(request => request.operation === 'reconcile')).toHaveLength(1));
    expect(f.session.getSnapshot().roleUpdates.status).toBe('updating'); await f.session.retryHostedRoleUpdates({ invoke: f.invoke }); expect(f.requests).toHaveLength(2);
    f.releaseRoleNative(); await running; expect(f.session.getSnapshot().roleUpdates.status).toBe('completed'); f.session.dispose();
  });
  it('keeps the report and original card when Native rejects after a complete role envelope', async () => {
    const f = fixture(); f.failAfterRoleEnd(); await f.run();
    expect(f.session.getSnapshot()).toMatchObject({ phase: 'completed', roleUpdates: { status: 'unavailable' }, rawText: '报告原文' });
    expect(f.session.getSnapshot().draft.combatants[0]!.data).toEqual(card); expect(await f.session.save('characters')).toBe(false);
    expect(f.requests.filter(request => request.operation.startsWith('create'))).toHaveLength(1); f.session.dispose();
  });
  it('cancel while waiting for the previous Native guard preserves the completed report and never launches reconciliation', async () => {
    const f = fixture(); f.holdNative(); const running = f.run(); await vi.waitFor(() => expect(f.session.getSnapshot().phase).toBe('completed'));
    f.session.cancel(); await running; expect(f.session.getSnapshot().phase).toBe('completed'); expect(f.requests).toHaveLength(1); f.releaseNative(); f.session.dispose();
  });
  it('discards a role reply after roster reorder/edit instead of applying by a changed index', async () => {
    const f = fixture(); f.hold(); const running = f.run(); await vi.waitFor(() => expect(f.session.getSnapshot().roleUpdates.status).toBe('updating'));
    // Deliberately simulate an external store mutation; ordinary UI edits are already disabled during this flight.
    f.session.getSnapshot().draft.combatants[0]!.data.name = '后来角色'; f.release(); await running;
    expect(f.session.getSnapshot().phase).toBe('completed'); expect(f.session.getSnapshot().roleUpdates.message).toContain('上下文已变化');
    expect(f.session.getSnapshot().draft.combatants[0]!.data.name).toBe('后来角色'); expect(await f.session.save('characters')).toBe(false); f.session.dispose();
  });
  it('rejects invalid response indices atomically and preserves originals', async () => {
    const f = fixture(); f.invalid(); await f.run(); expect(f.session.getSnapshot().roleUpdates.status).toBe('unavailable'); expect(f.session.getSnapshot().draft.combatants[0]!.data).toEqual(card); expect(f.session.getSnapshot().phase).toBe('completed'); f.session.dispose();
  });
  it('restored editable drafts cannot regain official signature trust; recovery never auto-syncs', async () => {
    const first = fixture(); await first.run(); first.session.dispose();
    const restored = fixture('battle', 'stream', first.values); restored.session.restoreDraft();
    expect(restored.session.getSnapshot().draft.combatants[0]!.isValid).toBe(false); expect(restored.session.getSnapshot().roleUpdates.status).toBe('restored'); expect(await restored.session.save('characters')).toBe(false);
    await restored.session.restoreHosted({ invoke: restored.invoke }, requestId); expect(restored.requests.map(request => request.operation)).toEqual(['lookup-request', 'resume']);
    expect(restored.session.canRetryHostedRoleUpdates()).toBe(true); restored.session.dispose();
  });
  it('legacy pointers cannot be upgraded by current selected write preferences', async () => {
    for (const version of [1, 2]) {
      const f = fixture(); await f.run({ ...f.draft, settings: { ...f.draft.settings, writeArenaHistory: false, writeCurrentState: false } }); f.session.dispose();
      const raw = JSON.parse(f.values.get(ARENA_HOSTED_RECOVERY_KEYS.battle)!); delete raw.reconciliationVersion; delete raw.writeArenaHistory; delete raw.writeCurrentState; raw.version = version; if (version === 1) delete raw.delivery;
      f.values.set(ARENA_HOSTED_RECOVERY_KEYS.battle, JSON.stringify(raw)); const next = fixture('battle', 'stream', f.values); next.session.restoreDraft(); next.session.updateDraft(next.draft);
      await next.session.restoreHosted({ invoke: next.invoke }, requestId); await next.session.retryHostedRoleUpdates({ invoke: next.invoke });
      expect(next.requests.map(request => request.operation)).toEqual(['lookup-request', 'resume']); expect(next.session.canRetryHostedRoleUpdates()).toBe(false); next.session.dispose();
    }
  });
  it('local save failure does not regenerate or lose the fresh signed candidate', async () => {
    const f = fixture(); await f.run(); f.failSave(true); expect(await f.session.save('characters')).toBe(false); expect(f.session.getSnapshot().phase).toBe('completed');
    f.failSave(false); expect(await f.session.save('characters')).toBe(true); expect(f.records.size).toBe(1); expect(f.requests).toHaveLength(2); f.session.dispose();
  });
});
