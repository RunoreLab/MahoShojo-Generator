import { withFixtureStreamReceipt } from './helpers/stream-receipt-fixture';
import { buildMagicTeaPartyHistory } from '@mahoshojo/ai-core/magic-tea-party';
import { describe, expect, it, vi } from 'vitest';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import type { TeaReadResponse, TeaWriteRequest, TeaWriteResponse, TeaSessionDocument, TeaMessageDocument } from '@mahoshojo/contracts/desktop-magic-tea-party';
import { DesktopTeaSession } from '../src/features/magic-tea-party/session';
import { teaSessionView } from '../src/features/magic-tea-party/direct';
import { createIpcTeaNativePort } from '../src/platform/magic-tea-party-native';
import type { ResolvedDesktopAiTarget } from '../src/features/ai-config/desktop-ai-config';
import { startMagicTeaPartyJourneyProbe } from './helpers/magic-tea-party-journey-probe';
import { prepareDesktopTeaImport } from '../src/features/magic-tea-party/transfer';

const target: ResolvedDesktopAiTarget = { location: 'client', providerTarget: { kind: 'custom', profileId: 'tea-loopback' }, profile: null, mode: 'direct-local', modelId: 'synthetic', availableModelIds: [], generationOverrides: undefined, unavailableReason: null };
const baseSession = (): TeaSessionDocument => ({ id: 's', title: '茶会', createdAt: 1, updatedAt: 1, roles: [], settings: { providerId: 'openai', modelId: 'm' }, draft: '' });
const harness = (session = baseSession()) => {
  let record: { session: TeaSessionDocument; instance: string; revision: number } | null = { session, instance: 'a'.repeat(32), revision: 1 };
  let messages: TeaMessageDocument[] = []; let drop: string | null = null; let fail: string | null = null;
  let output = '{"type":"narration","text":"星光😀"}\n';
  let count = 0; let sequence = 0; const receipts = new Map<string, TeaWriteResponse['result']>();
  const invoke = vi.fn(withFixtureStreamReceipt(async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (command === 'read_magic_tea_party') {
      const request = (args?.request as { request: Record<string, unknown> }).request;
      if (request.action === 'list') return { version: 1, result: { action: 'list', catalogRevision: 1, rows: [], nextCursor: null } };
      if (request.action === 'session') return { version: 1, result: { action: 'session', catalogRevision: 1, record: request.sessionId === record?.session.id ? record : null } };
      if (request.action === 'messages') return { version: 1, result: { action: 'messages', catalogRevision: 1, sessionId: record!.session.id, instance: record!.instance, revision: record!.revision,
        rows: messages.map((message, index) => ({ ordinal: index + 1, message })), nextCursor: null } };
      if (request.action === 'receipt') {
        const write = request.write as TeaWriteRequest; const operationId = 'operationId' in write.request ? write.request.operationId : '';
        return { version: 1, result: { action: 'receipt', receipt: receipts.has(operationId) ? { operationId, digest: '0'.repeat(64), result: receipts.get(operationId) } : null } };
      }
      throw new Error('unexpected read');
    }
    if (command === 'mutate_magic_tea_party') {
      const write = (args?.request as TeaWriteRequest).request;
      if (fail === write.action) { fail = null; throw { code: 'tea-io', message: 'Local tea storage did not complete; retain the input or unsaved result', writeEvidence: 'not-written' }; }
      if (write.action === 'fork') {
        const result = { action: 'fork' as const, operationId: write.operationId, sessionId: write.targetSessionId, instance: 'b'.repeat(32), revision: 1 as const };
        const anchor = messages.findIndex(message => message.id === write.anchorMessageId);
        messages = messages.slice(0, anchor + 1).map((message, index) => ({ ...message, sessionId: write.targetSessionId, ...(index === anchor ? { content: write.editedContent } : {}) }));
        record = { session: { ...record!.session, id: write.targetSessionId }, instance: result.instance, revision: 1 };
        receipts.set(write.operationId, result);
        if (drop === 'fork') { drop = null; throw new Error('synthetic reply loss after commit'); }
        return { version: 1, result };
      }
      if (write.action === 'merge' || write.action === 'import' || write.action === 'set-pin' || write.action === 'delete-selected') throw new Error('organization is covered by the real Native journey, not this single-record fixture');
      const sessionId = write.action === 'create' ? write.session.id : write.sessionId;
      const instance = write.action === 'create' ? 'b'.repeat(32) : write.instance;
      const revision = write.action === 'create' ? 1 : write.expectedRevision + (write.action === 'delete' ? 0 : 1);
      const result = { action: write.action, sessionId, instance, revision,
        ...('operationId' in write ? { operationId: write.operationId, assistantMessageId: write.assistantMessage.id } : {}) } as TeaWriteResponse['result'];
      if (write.action === 'delete') { record = null; messages = []; }
      else { if (write.action === 'create') messages = []; record = { session: write.session, instance, revision }; }
      if (write.action === 'begin-generation') { if (write.userMessage) messages.push(write.userMessage); messages.push(write.assistantMessage); }
      if (write.action === 'finish-generation') messages = messages.map(message => message.id === write.assistantMessage.id ? write.assistantMessage : message);
      if ('operationId' in write) receipts.set(write.operationId, result);
      if (drop === write.action) { drop = null; throw new Error('synthetic reply loss after commit'); }
      return { version: 1, result };
    }
    if (command === 'stream_target_ai' || command === 'stream_direct_ai') {
      count += 1; const request = args?.request as { requestId: string; contractVersion: 1; mode: 'direct-local' };
      const channel = args?.onEvent as { onmessage: (_event: AiStreamEvent) => void };
      const identity = { requestId: request.requestId, contractVersion: request.contractVersion, mode: request.mode };
      channel.onmessage({ ...identity, sequence: 0, type: 'started' });
      channel.onmessage({ ...identity, sequence: 1, type: 'text-delta', delta: output });
      channel.onmessage({ ...identity, sequence: 2, type: 'result', result: { ...identity, status: 'completed', output: { text: output }, finishReason: 'stop' } });
      return;
    }
    if (command === 'cancel_direct_ai') return;
    throw new Error('unexpected command');
  }));
  const owner = new DesktopTeaSession(createIpcTeaNativePort(invoke), () => `id-${++sequence}`, () => 10);
  return { owner, invoke, get record() { return record; }, get messages() { return messages; }, count: () => count, output: (text: string) => { output = text; }, drop: (action: string) => { drop = action; }, fail: (action: string) => { fail = action; }, options: { invoke, profileId: 'tea-loopback', createChannel: () => ({}) } };
};

describe('text Tea owner save and generation identity', () => {
  it.each(['provider', 'stopped', 'failed'] as const)('publishes accepted reasoning live and persists the %s terminal without replay', async completion => {
    const h = harness(); await h.owner.select('s'); await h.owner.updateSettings({ outputFormat: 'markdown' });
    let release!: () => void;
    const invoke = vi.fn(withFixtureStreamReceipt(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'cancel_direct_ai') return;
      const request = args?.request as { requestId: string; contractVersion: 1; mode: 'direct-local' };
      const channel = args?.onEvent as { onmessage: (_event: AiStreamEvent) => void };
      const identity = { requestId: request.requestId, contractVersion: request.contractVersion, mode: request.mode };
      channel.onmessage({ ...identity, sequence: 0, type: 'started' });
      channel.onmessage({ ...identity, sequence: 1, type: 'reasoning-delta', delta: '已接受思考😀' });
      channel.onmessage({ ...identity, sequence: 2, type: 'text-delta', delta: '已接受正文' });
      await new Promise<void>(resolve => { release = resolve; });
      if (completion === 'failed') throw new Error('synthetic stream interruption');
      channel.onmessage({ ...identity, sequence: 3, type: 'reasoning-delta', delta: '后续思考' });
      channel.onmessage({ ...identity, sequence: 4, type: 'result', result: { ...identity, status: 'completed', output: { text: '已接受正文', reasoning: '已接受思考😀后续思考' }, finishReason: 'stop' } });
    }));
    const running = h.owner.start(target, { ...h.options, invoke }, () => true, { kind: 'continue' });
    await vi.waitFor(() => expect(h.owner.getSnapshot().messages.at(-1)?.meta?.aiReasoning).toEqual({ status: 'thinking', source: 'provider', text: '已接受思考😀' }));
    expect(h.messages.at(-1)?.meta?.aiReasoning).toBeUndefined();
    if (completion === 'stopped') h.owner.stop();
    release(); await running;
    const reasoning = { status: completion === 'provider' ? 'done' : 'error', source: 'provider', text: completion === 'provider' ? '已接受思考😀后续思考' : '已接受思考😀' };
    expect(h.messages.at(-1)).toMatchObject({ content: '已接受正文', meta: { completion, aiReasoning: reasoning } });
    expect(h.messages.at(-1)?.meta).not.toHaveProperty('reasoningText');
    await h.owner.select('s'); expect(h.owner.getSnapshot().messages.at(-1)?.meta?.aiReasoning).toEqual(reasoning);
    expect(JSON.parse(await h.owner.export('json')).messages.at(-1).meta.aiReasoning).toEqual(reasoning);
    expect(invoke.mock.calls.filter(([command]) => command === 'stream_direct_ai')).toHaveLength(1);
  });

  it('does not publish late reasoning into a replacement owner', async () => {
    const h = harness(); await h.owner.select('s'); let release!: () => void;
    const invoke = vi.fn(withFixtureStreamReceipt(async (command: string, args?: Record<string, unknown>) => {
      if (command === 'cancel_direct_ai') return;
      const request = args?.request as { requestId: string; contractVersion: 1; mode: 'direct-local' };
      const channel = args?.onEvent as { onmessage: (_event: AiStreamEvent) => void };
      const identity = { requestId: request.requestId, contractVersion: request.contractVersion, mode: request.mode };
      channel.onmessage({ ...identity, sequence: 0, type: 'started' });
      await new Promise<void>(resolve => { release = resolve; });
      channel.onmessage({ ...identity, sequence: 1, type: 'reasoning-delta', delta: '旧会话迟到思考' });
      channel.onmessage({ ...identity, sequence: 2, type: 'result', result: { ...identity, status: 'completed', output: { text: '旧正文', reasoning: '旧会话迟到思考' }, finishReason: 'stop' } });
    }));
    const running = h.owner.start(target, { ...h.options, invoke }, () => true, { kind: 'continue' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    h.owner.dispose(); h.owner.activate(); await h.owner.create(); const replacement = h.owner.getSnapshot();
    release(); await running;
    expect(h.owner.getSnapshot()).toBe(replacement); expect(h.messages).toEqual([]);
  });

  it.each(['markdown', 'jsonl'] as const)('generates separate choices then sends the frozen selection and continues while preserving the %s draft', async outputFormat => {
    const h = harness(); await h.owner.select('s'); await h.owner.updateSettings({ outputFormat }); h.owner.setInput('未发送草稿😀');
    const choices = [{ id: 'c1', text: '端起茶杯' }, { id: 'c2', text: '推开窗户' }]; const raw = JSON.stringify({ type: 'choices', items: choices });
    h.output(raw); await h.owner.start(target, h.options, () => true, { kind: 'choices' });
    expect(h.messages).toHaveLength(1); expect(h.messages[0]).toMatchObject({ status: 'done', choices, meta: { kind: 'choices', outputFormat: 'jsonl', choicesValid: true, rawOutput: raw } });
    expect(h.record?.session).toMatchObject({ lastChoices: choices, draft: '未发送草稿😀', settings: { outputFormat } });
    expect(h.owner.getSnapshot().input).toBe('未发送草稿😀');
    const begin = h.invoke.mock.calls.find(([command, args]) => command === 'mutate_magic_tea_party' && (args?.request as TeaWriteRequest).request.action === 'begin-generation')![1]!.request as TeaWriteRequest;
    if (begin.request.action !== 'begin-generation') throw new Error('bad fixture');
    expect(begin.request.userMessage).toBeNull(); expect(Object.keys(begin.request.assistantMessage)).toHaveLength(6);
    h.output('剧情');
    await Promise.all([h.owner.start(target, h.options, () => true, { kind: 'selected-choice', text: choices[0]!.text }),
      h.owner.start(target, h.options, () => true, { kind: 'selected-choice', text: choices[1]!.text })]);
    expect(h.messages.filter(message => message.role === 'user').map(message => message.content)).toEqual(['端起茶杯']);
    expect(h.count()).toBe(2); expect(h.owner.getSnapshot().input).toBe('未发送草稿😀');
    expect(h.messages.at(-1)?.status).toBe('done');
    await h.owner.start(target, h.options, () => true, { kind: 'continue' });
    expect(h.count()).toBe(3); expect(h.messages.filter(message => message.role === 'user')).toHaveLength(1);
    expect(h.record?.session).toMatchObject({ draft: '未发送草稿😀', settings: { outputFormat } });
  });
  it.each(['', 'malformed output', '{"type":"choices","items":[]}', '{"type":"notice","level":"error","message":"不能继续"}\n{"type":"choices","items":[{"id":"c1","text":"不可执行"}]}'])('keeps the last valid choices and raw output for invalid manual output %j', async raw => {
    const h = harness(); await h.owner.select('s'); const lastChoices = [{ id: 'old', text: '上次有效选项' }];
    await h.owner.update({ lastChoices }); h.output(raw);
    await h.owner.start(target, h.options, () => true, { kind: 'choices' });
    expect(h.count()).toBe(1); expect(h.record?.session.lastChoices).toEqual(lastChoices);
    expect(h.messages.at(-1)).toMatchObject({ status: 'error', choices: [], meta: { kind: 'choices', choicesValid: false, rawOutput: raw } });
  });
  it('atomically keeps choices and raw finish immutable while a finish receipt is unknown', async () => {
    const h = harness(); await h.owner.select('s'); h.owner.setInput('保留草稿');
    const choices = [{ id: 'c1', text: '喝茶' }]; const raw = JSON.stringify({ type: 'choices', items: choices }); h.output(raw); h.drop('finish-generation');
    const running = h.owner.start(target, h.options, () => true, { kind: 'choices' });
    await vi.waitFor(() => expect(h.owner.getSnapshot().pending).toBe('unknown'));
    expect(h.record?.session.lastChoices).toEqual(choices); const stored = JSON.stringify(h.messages);
    expect(h.owner.unsavedText()).toBe(raw); await h.owner.start(target, h.options, () => true, { kind: 'selected-choice', text: '不可重发' });
    h.owner.stop(); await h.owner.resolvePending(); await running;
    expect(JSON.stringify(h.messages)).toBe(stored); expect(h.count()).toBe(1); expect(h.owner.getSnapshot().input).toBe('保留草稿');
  });
  it('retains choices and exact finish body after a known storage failure, without another generation', async () => {
    const h = harness(); await h.owner.select('s'); const old = [{ id: 'old', text: '旧有效' }]; await h.owner.update({ lastChoices: old });
    const raw = '{"type":"choices","items":[{"id":"new","text":"新有效"}]}'; h.output(raw); h.fail('finish-generation');
    const running = h.owner.start(target, h.options, () => true, { kind: 'choices' });
    await vi.waitFor(() => expect(h.owner.getSnapshot().pending).toBe('save'));
    expect(h.record?.session.lastChoices).toEqual(old); expect(h.owner.unsavedText()).toBe(raw);
    const finishBodies = () => h.invoke.mock.calls.filter(([command, args]) => command === 'mutate_magic_tea_party' && (args?.request as TeaWriteRequest).request.action === 'finish-generation').map(([, args]) => JSON.stringify(args?.request));
    const original = finishBodies()[0]; await h.owner.retryPending(); await running;
    expect(finishBodies()).toEqual([original, original]); expect(h.count()).toBe(1); expect(h.record?.session.lastChoices).toEqual([{ id: 'new', text: '新有效' }]);
  });
  it('does not promote an accepted choices prefix after the stream budget rejects a later delta', async () => {
    const h = harness(); await h.owner.select('s'); const old = [{ id: 'old', text: '保留旧选项' }]; await h.owner.update({ lastChoices: old });
    const raw = '{"type":"choices","items":[{"id":"prefix","text":"前缀选项"}]}';
    const original = h.invoke.getMockImplementation()!; let calls = 0;
    h.invoke.mockImplementation(withFixtureStreamReceipt(async (command: string, args?: Record<string, unknown>) => {
      if (command !== 'stream_direct_ai') return original(command, args);
      calls += 1; const request = args?.request as { requestId: string; contractVersion: 1; mode: 'direct-local' };
      const channel = args?.onEvent as { onmessage: (_event: AiStreamEvent) => void }; const identity = { requestId: request.requestId, contractVersion: 1 as const, mode: request.mode };
      channel.onmessage({ ...identity, sequence: 0, type: 'started' }); channel.onmessage({ ...identity, sequence: 1, type: 'text-delta', delta: raw });
      channel.onmessage({ ...identity, sequence: 2, type: 'text-delta', delta: 'x'.repeat(1_000_001) });
    }));
    await h.owner.start(target, h.options, () => true, { kind: 'choices' });
    expect(calls).toBe(1); expect(h.record?.session.lastChoices).toEqual(old);
    expect(h.messages.at(-1)).toMatchObject({ status: 'error', choices: [], meta: { completion: 'failed', choicesValid: false, rawOutput: raw } });
  });
  it('retains an over-budget terminal candidate for export and never retries its model automatically', async () => {
    const h = harness(); await h.owner.select('s');
    expect(await h.owner.update({ title: 'x'.repeat(8 * 1024 * 1024 - 400) })).toBe(true);
    const raw = JSON.stringify({ type: 'choices', items: [{ id: 'large', text: 'y'.repeat(1000) }] }); h.output(raw);
    const running = h.owner.start(target, h.options, () => true, { kind: 'choices' });
    await vi.waitFor(() => expect(h.owner.getSnapshot().pending).toBe('save'));
    expect(h.count()).toBe(1); expect(h.owner.unsavedText()).toBe(raw); expect(h.record?.session.lastChoices).toBeUndefined();
    await h.owner.retryPending(); expect(h.count()).toBe(1);
    await h.owner.abandonPending(); await running;
    expect(h.count()).toBe(1); expect(h.messages.at(-1)).toMatchObject({ status: 'error', meta: { completion: 'discarded' } });
  });
  it('freezes the selected text and original draft before history preparation, and stop cancels preparation', async () => {
    for (const stopped of [false, true]) {
      const h = harness(); await h.owner.select('s'); h.owner.setInput('原草稿'); const original = h.invoke.getMockImplementation()!;
      let release!: () => void; let first = true;
      h.invoke.mockImplementation(async (command, args) => {
        if (command === 'read_magic_tea_party' && (args?.request as TeaReadResponse & { request: { action: string } }).request.action === 'messages' && first) {
          first = false; await new Promise<void>(resolve => { release = resolve; });
        }
        return original(command, args);
      });
      const intent = { kind: 'selected-choice' as const, text: '原点选' }; const running = h.owner.start(target, h.options, () => true, intent);
      await vi.waitFor(() => expect(release).toBeTypeOf('function')); intent.text = '不得换发'; h.owner.setInput('不得覆盖草稿');
      if (stopped) h.owner.stop(); release(); await running;
      expect(h.count()).toBe(stopped ? 0 : 1); expect(h.owner.getSnapshot().input).toBe('原草稿');
      expect(h.messages.filter(message => message.role === 'user').map(message => message.content)).toEqual(stopped ? [] : ['原点选']);
    }
  });
  it('commits begin before exactly one stream and saves the actual shared parser projection', async () => {
    const h = harness(); await h.owner.select('s'); h.owner.setInput('你好');
    await h.owner.start(target, h.options, () => true);
    expect(h.count()).toBe(1); expect(h.owner.getSnapshot().pending).toBe('none');
    expect(h.messages).toHaveLength(2); expect(h.messages[1]).toMatchObject({ status: 'done', content: '星光😀\n', meta: { completion: 'provider' } });
    const calls = h.invoke.mock.calls.map(([command, args]) => command === 'mutate_magic_tea_party' ? (args?.request as TeaWriteRequest).request.action : command);
    expect(calls.indexOf('begin-generation')).toBeLessThan(calls.indexOf('stream_direct_ai'));
    expect(h.owner.isBusy()).toBe(false);
  });
  it('freezes the selected speaker in begin and keeps old identity when the role or user name changes', async () => {
    const h = harness(); await h.owner.select('s');
    const role = { id: 'role', name: '原角色', source: 'local' as const, card: { name: '原角色' } };
    await h.owner.update({ roles: [role], playerRoleId: role.id }); h.owner.setInput('原台词');
    await h.owner.start(target, h.options, () => true);
    await h.owner.update({ roles: [{ ...role, name: '新角色' }], settings: { providerId: 'openai', modelId: 'm', userDisplayName: '新称呼' } });
    expect(h.messages[0]).toMatchObject({ speakerId: 'role', meta: { speakerName: '原角色' } });
    const archive = JSON.parse(await h.owner.export('json'));
    expect(archive.messages[0]).toMatchObject({ speakerId: 'role', meta: { speakerName: '原角色' } });
  });
  it('normalizes player identity in the role update transaction and keeps historical speakers when selecting again', async () => {
    const h = harness(); await h.owner.select('s');
    const first = { id: 'first', name: '原角色', source: 'local' as const, card: { name: '原角色' } };
    const second = { id: 'second', name: '新角色', source: 'local' as const, card: { name: '新角色' } };
    await h.owner.update({ roles: [first, second], playerRoleId: first.id });
    await h.owner.start(target, h.options, () => true, { kind: 'reply', text: '过去的台词' });
    const historical = structuredClone(h.messages);
    h.owner.setInput('保留草稿'); h.owner.stageName('  自定称呼  ');
    const writes = () => h.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party');
    const before = writes().length; const revision = h.record!.revision;
    expect(await h.owner.update({ roles: [second] })).toBe(true);
    expect(writes()).toHaveLength(before + 1);
    expect(writes().at(-1)?.[1]?.request).toMatchObject({ request: { action: 'update', expectedRevision: revision,
      session: { roles: [second], playerRoleId: null, draft: '保留草稿', settings: { userDisplayName: '  自定称呼  ' } } } });
    expect(h.owner.getSnapshot().record?.session.playerRoleId).toBeNull();
    expect(h.messages).toEqual(historical);
    await h.owner.start(target, h.options, () => true, { kind: 'selected-choice', text: '旅人选项' });
    const fallback = h.messages.find(message => message.content === '旅人选项');
    expect(fallback).not.toHaveProperty('speakerId'); expect(fallback?.meta?.speakerName).toBe('自定称呼');
    expect(h.owner.getSnapshot().input).toBe('保留草稿');
    expect(await h.owner.update({ playerRoleId: second.id })).toBe(true);
    await h.owner.start(target, h.options, () => true, { kind: 'reply', text: '新角色台词' });
    expect(h.messages.find(message => message.content === '新角色台词')).toMatchObject({ speakerId: second.id, meta: { speakerName: second.name } });
    expect(await h.owner.update({ roles: [] })).toBe(true);
    expect(h.record?.session).toMatchObject({ roles: [], playerRoleId: null });
    expect(h.messages.slice(0, historical.length)).toEqual(historical);
    expect(JSON.parse(await h.owner.export('json')).messages.slice(0, historical.length)).toEqual(historical);
  });
  it.each([['  自定旅人  ', '自定旅人'], ['  ', '旅人']] as const)('recovers an orphan player only in a new write and sends with %j', async (userDisplayName, speakerName) => {
    const h = harness({ ...baseSession(), playerRoleId: 'deleted', settings: { ...baseSession().settings, userDisplayName } });
    await h.owner.select('s');
    expect(h.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(0);
    expect(h.record?.session.playerRoleId).toBe('deleted');
    await h.owner.start(target, h.options, () => true, { kind: 'reply', text: '恢复后的台词' });
    const user = h.messages.find(message => message.role === 'user');
    expect(user).not.toHaveProperty('speakerId'); expect(user?.meta?.speakerName).toBe(speakerName);
    const begin = h.invoke.mock.calls.find(([command, args]) => command === 'mutate_magic_tea_party' && (args?.request as TeaWriteRequest).request.action === 'begin-generation')![1]!.request as TeaWriteRequest;
    expect(begin).toMatchObject({ request: { action: 'begin-generation', expectedRevision: 1,
      session: { playerRoleId: null }, userMessage: { meta: { speakerName } } } });
    expect(h.record?.session.playerRoleId).toBeNull();
    const stream = h.invoke.mock.calls.find(([command]) => command === 'stream_direct_ai')![1]!.request as { messages: Array<{ content: string }> };
    expect(stream.messages[0]!.content).toContain(`玩家身份：${speakerName}`);
    expect(stream.messages[0]!.content).not.toContain('玩家正在扮演角色');
  });
  it.each([false, true])('keeps player and role changes atomic across a failed update (unknown=%s)', async unknown => {
    const role = { id: 'player', name: '原玩家', source: 'local' as const, card: { name: '原玩家' } };
    const h = harness({ ...baseSession(), roles: [role], playerRoleId: role.id }); await h.owner.select('s');
    h.owner.setInput('未提交草稿'); h.owner.stageName('新称呼');
    if (unknown) h.drop('update'); else h.fail('update');
    expect(await h.owner.update({ roles: [] })).toBe(false);
    expect(h.owner.getSnapshot()).toMatchObject({ record: { session: { roles: [role], playerRoleId: role.id } },
      input: '未提交草稿', nameDraft: '新称呼', pending: unknown ? 'unknown' : 'save' });
    expect(h.record?.session).toMatchObject(unknown ? { roles: [], playerRoleId: null, draft: '未提交草稿' } : { roles: [role], playerRoleId: role.id, draft: '' });
    const updates = () => h.invoke.mock.calls.filter(([command, args]) => command === 'mutate_magic_tea_party' && (args?.request as TeaWriteRequest).request.action === 'update').map(([, args]) => args?.request);
    const original = structuredClone(updates()[0]);
    expect(original).toMatchObject({ request: { session: { roles: [], playerRoleId: null, draft: '未提交草稿' } } });
    await h.owner.start(target, h.options, () => true, { kind: 'reply', text: '保存未决不得发送' }); expect(h.count()).toBe(0);
    if (unknown) await h.owner.resolvePending(); else await h.owner.retryPending();
    expect(updates()).toEqual(unknown ? [original] : [original, original]);
    expect(h.owner.getSnapshot()).toMatchObject({ record: { session: { roles: [], playerRoleId: null } }, input: '未提交草稿', nameDraft: null, pending: 'none' });
  });
  it('freezes the player identity through deferred history preparation and rejects concurrent role replacement', async () => {
    const role = { id: 'player', name: '  原玩家  ', source: 'local' as const, card: { name: '原玩家' } };
    const h = harness({ ...baseSession(), roles: [role], playerRoleId: role.id }); await h.owner.select('s');
    const original = h.invoke.getMockImplementation()!; let release!: () => void; let first = true;
    h.invoke.mockImplementation(async (command, args) => {
      if (command === 'read_magic_tea_party' && (args?.request as { request: { action: string } }).request.action === 'messages' && first) {
        first = false; await new Promise<void>(resolve => { release = resolve; });
      }
      return original(command, args);
    });
    const running = h.owner.start(target, h.options, () => true, { kind: 'reply', text: '原玩家在途台词' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(await h.owner.update({ roles: [], playerRoleId: null })).toBe(false);
    h.owner.stageName('不得替换');
    release(); await running;
    expect(h.messages[0]).toMatchObject({ speakerId: role.id, meta: { speakerName: '原玩家' } });
    expect(h.record?.session).toMatchObject({ roles: [role], playerRoleId: role.id });
    const historical = structuredClone(h.messages);
    expect(await h.owner.update({ roles: [] })).toBe(true);
    expect(h.record?.session.playerRoleId).toBeNull(); expect(h.messages).toEqual(historical);
  });
  it('preflights rejected imports before saving any dirty current draft', async () => {
    const h = harness(); await h.owner.select('s'); h.owner.setInput('仍未保存'); h.owner.stageTitle('仍未改名');
    const before = h.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
    await h.owner.importText(JSON.stringify({ schema: 'magic-tea-party.archive.v1', sessions: [
      { schema: 'magic-tea-party.session.v1', session: baseSession(), roles: [], messages: [] },
      { schema: 'magic-tea-party.session.v1', session: { ...baseSession(), id: 'other' }, roles: [], messages: [], tachieAssets: [{ id: 'media' }] },
    ] }), 'json', () => true);
    expect(h.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(before);
    expect(h.owner.getSnapshot()).toMatchObject({ input: '仍未保存', titleDraft: '仍未改名' });
    expect(h.record?.session.title).toBe('茶会');
  });
  it('does not turn a replacement owner into an unsaved result when an old finish reply arrives', async () => {
    const h = harness(); await h.owner.select('s'); h.owner.setInput('旧输入');
    const original = h.invoke.getMockImplementation()!; let release!: () => void;
    h.invoke.mockImplementation(async (command, args) => {
      const result = await original(command, args);
      if (command === 'mutate_magic_tea_party' && (args?.request as TeaWriteRequest).request.action === 'finish-generation') {
        await new Promise<void>(resolve => { release = resolve; });
      }
      return result;
    });
    const running = h.owner.start(target, h.options, () => true);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    h.owner.dispose(); h.owner.activate(); await h.owner.create(); const snapshot = h.owner.getSnapshot();
    release(); await running;
    expect(h.owner.getSnapshot()).toBe(snapshot); expect(snapshot.pending).toBe('none');
  });
  it('saves composer input in the same metadata transaction instead of resetting it on reload', async () => {
    const h = harness(); await h.owner.select('s'); h.owner.setInput('尚未发送😀');
    await h.owner.update({ title: '重命名' });
    expect(h.record?.session).toMatchObject({ title: '重命名', draft: '尚未发送😀' });
    expect(h.owner.getSnapshot().input).toBe('尚未发送😀'); expect(h.owner.isBusy()).toBe(false);
  });
  it('releases preparation when the raw user message fails begin admission after a legal prompt clip', async () => {
    const h = harness(); await h.owner.select('s');
    const text = 'x'.repeat(32 * 1024 * 1024); h.owner.setInput(text);
    await h.owner.start(target, h.options, () => true);
    expect(h.count()).toBe(0); expect(h.owner.getSnapshot()).toMatchObject({ busy: false, generating: false, pending: 'none', input: text });
    expect(h.messages).toEqual([]);
    h.owner.setInput('可修正后继续'); await h.owner.start(target, h.options, () => true); expect(h.count()).toBe(1);
  });
  it('does not release or clear a replacement generation when a retired begin reply arrives', async () => {
    const h = harness(); await h.owner.select('s'); h.owner.setInput('旧输入');
    const original = h.invoke.getMockImplementation()!;
    let first = true; let releaseBegin!: () => void; let releaseStream!: () => void;
    h.invoke.mockImplementation(async (command, args) => {
      if (command === 'mutate_magic_tea_party' && (args?.request as TeaWriteRequest).request.action === 'begin-generation' && first) {
        first = false; const result = await original(command, args);
        await new Promise<void>(resolve => { releaseBegin = resolve; }); return result;
      }
      if (command === 'stream_direct_ai') await new Promise<void>(resolve => { releaseStream = resolve; });
      return original(command, args);
    });
    const oldRunning = h.owner.start(target, h.options, () => true);
    await vi.waitFor(() => expect(releaseBegin).toBeTypeOf('function'));
    h.owner.dispose(); h.owner.activate(); await h.owner.create(); h.owner.setInput('新输入');
    const running = h.owner.start(target, h.options, () => true);
    await vi.waitFor(() => expect(releaseStream).toBeTypeOf('function'));
    const snapshot = h.owner.getSnapshot();
    releaseBegin(); await oldRunning;
    expect(h.owner.getSnapshot()).toBe(snapshot); expect(snapshot).toMatchObject({ busy: true, generating: true });
    releaseStream(); await running;
    expect(h.count()).toBe(1); expect(h.owner.getSnapshot()).toMatchObject({ busy: false, generating: false });
  });
  it('holds the original owner during unknown begin and continues once only after its receipt is checked', async () => {
    const h = harness(); await h.owner.select('s'); h.owner.setInput('原输入'); h.drop('begin-generation');
    const running = h.owner.start(target, h.options, () => true);
    await vi.waitFor(() => expect(h.owner.getSnapshot().pending).toBe('unknown'));
    expect(h.count()).toBe(0); await h.owner.create(); expect(h.record?.session.id).toBe('s');
    await h.owner.resolvePending(); await running;
    expect(h.count()).toBe(1); await h.owner.resolvePending(); expect(h.count()).toBe(1);
  });
  it('resolves a lost finish reply without a second model call or replacing the terminal body on stop', async () => {
    const h = harness(); await h.owner.select('s'); h.owner.setInput('原输入'); h.drop('finish-generation');
    const running = h.owner.start(target, h.options, () => true);
    await vi.waitFor(() => expect(h.owner.getSnapshot().pending).toBe('unknown'));
    expect(h.count()).toBe(1); const stored = JSON.stringify(h.messages);
    h.owner.stop(); await h.owner.resolvePending(); await running;
    expect(JSON.stringify(h.messages)).toBe(stored); expect(h.count()).toBe(1); expect(h.owner.isBusy()).toBe(false);
  });
  it('keeps input after failed begin, allows explicit stop and same-body storage retry without model dispatch', async () => {
    const h = harness(); await h.owner.select('s'); h.owner.setInput('仍在这里'); h.fail('begin-generation');
    const running = h.owner.start(target, h.options, () => true);
    await vi.waitFor(() => expect(h.owner.getSnapshot().pending).toBe('save'));
    expect(h.owner.getSnapshot().input).toBe('仍在这里'); expect(h.count()).toBe(0);
    h.owner.stop(); await h.owner.retryPending(); await running;
    expect(h.count()).toBe(0); expect(h.messages.at(-1)).toMatchObject({ status: 'error', meta: { completion: 'stopped' } });
  });
  it('preserves raw output-plan extensions while the real choice toggle changes the effective choices switch', async () => {
    const h = harness(); await h.owner.select('s');
    await h.owner.update({ settings: { providerId: 'openai', modelId: 'm', outputPlan: { choices: 'off', summary: 'on', updates: 'on', ...{ future: { inert: 'preserved' } } } } });
    await h.owner.updateSettings({ enableChoices: true });
    expect(h.record?.session.settings.outputPlan).toEqual({ choices: 'auto', summary: 'on', updates: 'on', future: { inert: 'preserved' } });
  });
  it('does not dispatch from a begin receipt after its credential intent changed', async () => {
    const h = harness(); await h.owner.select('s'); h.owner.setInput('原输入'); h.drop('begin-generation');
    let current = true; const running = h.owner.start(target, h.options, () => current);
    await vi.waitFor(() => expect(h.owner.getSnapshot().pending).toBe('unknown'));
    current = false; await h.owner.resolvePending(); await running;
    expect(h.count()).toBe(0); expect(h.messages.at(-1)?.meta).toMatchObject({ completion: 'stopped' });
    const writes = h.invoke.mock.calls.length; h.owner.dispose(); await h.owner.retryPending(); expect(h.invoke.mock.calls).toHaveLength(writes);
  });
  it('rejects a deletion confirmation after metadata revision or instance changed', async () => {
    const h = harness(); await h.owner.select('s');
    const confirmation = h.owner.getSnapshot(); const original = confirmation.record!;
    await h.owner.update({ title: '确认后更新' });
    await h.owner.delete(confirmation.incarnation, 's', original.instance, original.revision);
    expect(h.record?.session.title).toBe('确认后更新');
    await h.owner.delete(h.owner.getSnapshot().incarnation, 's', 'b'.repeat(32), h.record!.revision);
    expect(h.record).not.toBeNull();
    expect(h.invoke.mock.calls.filter(([command, args]) => command === 'mutate_magic_tea_party' && (args?.request as TeaWriteRequest).request.action === 'delete')).toEqual([]);
  });
  it('cannot reuse an old deletion confirmation or late read to affect a replacement owner', async () => {
    const h = harness(); await h.owner.select('s'); const old = h.owner.getSnapshot().incarnation;
    await h.owner.select('s'); await h.owner.delete(old, 's', h.record!.instance, h.record!.revision); expect(h.record).not.toBeNull();
    const read = h.invoke.getMockImplementation()!; let release!: () => void;
    h.invoke.mockImplementation(async (command, args) => { if (command === 'read_magic_tea_party') await new Promise<void>(resolve => { release = resolve; }); return read(command, args); });
    const loading = h.owner.refreshDirectory(); h.owner.dispose(); release(); await loading;
    expect(h.count()).toBe(0);
  });
});

describe('real Native TeaStore and Direct loopback journey', () => {
  it.skipIf(!process.env.MAHO_TEA_JOURNEY_BINARY).each(['markdown', 'jsonl'] as const)('persists the choices → selection → continue slice, restores SQLite and roundtrips JSON / JSONL for %s', async outputFormat => {
    const probe = await startMagicTeaPartyJourneyProbe(); let sequence = 0;
    const owner = new DesktopTeaSession(createIpcTeaNativePort(probe.invoke), () => `choices-${++sequence}`, () => 400);
    const choices = [{ id: 'c1', text: '端起茶杯😀' }, { id: 'c2', text: '看看门外' }];
    const raw = JSON.stringify({ type: 'choices', items: choices });
    try {
      await owner.create(); const id = owner.getSnapshot().record!.session.id;
      await owner.updateSettings({ outputFormat }); owner.setInput('未发送草稿');
      await probe.control('checkpoint', { action: 'model', chunks: [raw], deferred: false });
      await probe.control('drop-next-write-reply', { action: 'finish-generation' });
      const generating = owner.start(target, probe.aiOptions, () => true, { kind: 'choices' });
      await vi.waitFor(() => expect(owner.getSnapshot().pending).toBe('unknown'), { timeout: 5000 });
      expect(owner.unsavedText()).toBe(raw); owner.stop(); await owner.resolvePending(); await generating;
      expect(owner.getSnapshot().record?.session).toMatchObject({ lastChoices: choices, draft: '未发送草稿', settings: { outputFormat } });
      expect(owner.getSnapshot().messages).toHaveLength(1);
      expect(owner.getSnapshot().messages[0]).toMatchObject({ choices, meta: { kind: 'choices', choicesValid: true, rawOutput: raw, outputFormat: 'jsonl' } });
      await probe.control('checkpoint', { action: 'model', chunks: [outputFormat === 'markdown' ? '接着讲故事' : '{"type":"narration","text":"接着讲故事"}'], deferred: false });
      await Promise.all([owner.start(target, probe.aiOptions, () => true, { kind: 'selected-choice', text: choices[0]!.text }),
        owner.start(target, probe.aiOptions, () => true, { kind: 'selected-choice', text: choices[1]!.text })]);
      await owner.start(target, probe.aiOptions, () => true, { kind: 'continue' });
      expect(owner.getSnapshot().messages.filter(message => message.role === 'user').map(message => message.content)).toEqual([choices[0]!.text]);
      expect(owner.getSnapshot().input).toBe('未发送草稿');
      const observed = await probe.control('requestCount') as { count: number; requests: Array<{ messages: Array<{ content: string }> }> };
      expect(observed.count).toBe(3); expect(observed.requests[0]!.messages[0]!.content).toContain('【阶段规则：选项】');
      expect(observed.requests[0]!.messages[0]!.content).not.toContain('未发送草稿');
      const json = await owner.export('json'); const jsonl = await owner.export('jsonl');
      const jsonPlan = prepareDesktopTeaImport(json, 'json', () => `json-${++sequence}`, 600);
      const jsonlPlan = prepareDesktopTeaImport(jsonl, 'jsonl', () => `jsonl-${++sequence}`, 600);
      for (const plan of [jsonPlan, jsonlPlan]) {
        expect(plan.write.request.action).toBe('import');
        if (plan.write.request.action !== 'import') throw new Error('bad fixture');
        expect(plan.write.request.entries[0]!.messages[0]).toMatchObject({ choices, status: 'done', meta: { choicesValid: true, rawOutput: raw, kind: 'choices', outputFormat: 'jsonl' } });
      }
      const backup = await probe.control('checkpoint', { action: 'backup' }) as { backupId: string };
      await owner.delete(owner.getSnapshot().incarnation, id, owner.getSnapshot().record!.instance, owner.getSnapshot().record!.revision);
      await probe.control('checkpoint', { action: 'prepare-restore', backupId: backup.backupId }); await probe.control('reopen'); await owner.select(id);
      expect(owner.getSnapshot().record?.session).toMatchObject({ lastChoices: choices, draft: '未发送草稿', settings: { outputFormat } });
      expect(owner.getSnapshot().messages[0]).toMatchObject({ choices, meta: { rawOutput: raw, choicesValid: true } });
      await owner.importText(jsonl, 'jsonl', () => true);
      expect(await probe.control('requestCount')).toMatchObject({ count: 3 });
    } finally { owner.dispose(); await probe.close(); }
  }, 30000);
  it.skipIf(!process.env.MAHO_TEA_JOURNEY_BINARY)('keeps stopped complete choices inert after late bytes, restart, backup and JSONL roundtrip', async () => {
    const probe = await startMagicTeaPartyJourneyProbe(); let sequence = 0;
    const owner = new DesktopTeaSession(createIpcTeaNativePort(probe.invoke), () => `stopped-choices-${++sequence}`, () => 500);
    const raw = '{"type":"choices","items":[{"id":"partial","text":"前缀里看似完整的选项"}]}\n';
    const old = [{ id: 'old', text: '旧有效选项' }];
    try {
      await owner.create(); const id = owner.getSnapshot().record!.session.id; await owner.update({ lastChoices: old });
      owner.setInput('保留草稿'); await probe.control('checkpoint', { action: 'model', chunks: [raw, '不得迟到追加'], deferred: true });
      const running = owner.start(target, probe.aiOptions, () => true, { kind: 'choices' });
      await vi.waitFor(() => expect(owner.getSnapshot().rawUnsaved).toBe(raw), { timeout: 5000 }); owner.stop(); await running;
      const snapshot = JSON.stringify(owner.getSnapshot().messages); await probe.control('checkpoint', { action: 'release' });
      expect(JSON.stringify(owner.getSnapshot().messages)).toBe(snapshot); expect(owner.getSnapshot().record?.session.lastChoices).toEqual(old);
      const backup = await probe.control('checkpoint', { action: 'backup' }) as { backupId: string };
      await probe.control('checkpoint', { action: 'prepare-restore', backupId: backup.backupId }); await probe.control('reopen'); await owner.select(id);
      expect(owner.getSnapshot().messages[0]).toMatchObject({ status: 'error', choices: [], meta: { kind: 'choices', completion: 'stopped', choicesValid: false, rawOutput: raw } });
      const plan = prepareDesktopTeaImport(await owner.export('jsonl'), 'jsonl', () => `import-${++sequence}`, 700);
      if (plan.write.request.action !== 'import') throw new Error('bad fixture');
      expect(plan.write.request.entries[0]!.messages[0]).toMatchObject({ status: 'error', choices: [], meta: { completion: 'stopped', choicesValid: false, rawOutput: raw } });
      expect(await probe.control('requestCount')).toMatchObject({ count: 1 });
    } finally { owner.dispose(); await probe.close(); }
  }, 20000);
  it.skipIf(!process.env.MAHO_TEA_JOURNEY_BINARY)('runs the actual TS owner through Native SQLite, stream_direct_ai, unknown receipts and reopen', async () => {
    const probe = await startMagicTeaPartyJourneyProbe(); let sequence = 0;
    const owner = new DesktopTeaSession(createIpcTeaNativePort(probe.invoke), () => `journey-${++sequence}`, () => 100);
    try {
      await owner.create(); const sessionId = owner.getSnapshot().record!.session.id;
      await owner.update({ title: '真实往返', roles: [{ id: 'role', name: '星见', source: 'local', card: { templateId: '通用角色', name: '星见', content: '合成角色' } }] });
      owner.setInput('合成输入'); await probe.control('drop-next-write-reply', { action: 'finish-generation' });
      const running = owner.start(target, probe.aiOptions, () => true);
      await vi.waitFor(() => expect(owner.getSnapshot().pending).toBe('unknown'), { timeout: 5000 });
      await owner.resolvePending(); await running;
      expect(await probe.control('requestCount')).toMatchObject({ count: 1 });
      const exported = await owner.export('json'); expect(JSON.parse(exported).session.title).toBe('真实往返');
      await probe.control('reopen'); await owner.select(sessionId);
      expect(owner.getSnapshot().messages.some(message => message.role === 'assistant' && message.status === 'done')).toBe(true);
      await owner.importText(exported, 'json', () => true);
      const directory = await createIpcTeaNativePort(probe.invoke).read({ version: 1, request: { action: 'list', cursor: null, expectedCatalogRevision: null, limit: 50 } });
      expect((directory as Extract<TeaReadResponse, { version: 1 }>).result.action).toBe('list');
      if (directory.result.action === 'list') expect(directory.result.rows).toHaveLength(2);
      expect(await probe.control('requestCount')).toMatchObject({ count: 1 });
    } finally { owner.dispose(); await probe.close(); }
  }, 20000);
  it.skipIf(!process.env.MAHO_TEA_JOURNEY_BINARY)('cancels real Direct loopback, freezes the accepted prefix and ignores released late chunks', async () => {
    const probe = await startMagicTeaPartyJourneyProbe(); let sequence = 0;
    const owner = new DesktopTeaSession(createIpcTeaNativePort(probe.invoke), () => `stop-${++sequence}`, () => 200);
    try {
      await owner.create(); owner.setInput('停止测试');
      await probe.control('checkpoint', { action: 'model', deferred: true, chunks: ['已接收前缀😀', '不得迟到追加'] });
      const running = owner.start(target, probe.aiOptions, () => true);
      await vi.waitFor(() => expect(owner.getSnapshot().rawUnsaved).toBe('已接收前缀😀'), { timeout: 5000 });
      owner.stop(); await running;
      const saved = JSON.stringify(owner.getSnapshot().messages);
      expect(owner.getSnapshot().messages.at(-1)?.meta).toMatchObject({ completion: 'stopped', rawOutput: '已接收前缀😀' });
      await vi.waitFor(async () => expect(await probe.control('requestCount')).toMatchObject({ count: 1, disconnected: 1 }), { timeout: 5000 });
      await probe.control('checkpoint', { action: 'release' });
      expect(JSON.stringify(owner.getSnapshot().messages)).toBe(saved);
      await owner.create(); expect(owner.getSnapshot().messages).toEqual([]);
      expect(await probe.control('requestCount')).toMatchObject({ count: 1 });
    } finally { owner.dispose(); await probe.close(); }
  }, 20000);
  it.skipIf(!process.env.MAHO_TEA_JOURNEY_BINARY)('backs up the real Tea tables, deletes and restores without replaying a model', async () => {
    const probe = await startMagicTeaPartyJourneyProbe(); let sequence = 0;
    const owner = new DesktopTeaSession(createIpcTeaNativePort(probe.invoke), () => `backup-${++sequence}`, () => 300);
    try {
      await owner.create(); const id = owner.getSnapshot().record!.session.id;
      owner.setInput('可恢复草稿'); await owner.saveDraft();
      const backup = await probe.control('checkpoint', { action: 'backup' }) as { backupId: string };
      expect(typeof backup.backupId).toBe('string');
      await owner.delete(owner.getSnapshot().incarnation, id, owner.getSnapshot().record!.instance, owner.getSnapshot().record!.revision); expect(owner.getSnapshot().record).toBeNull();
      await probe.control('checkpoint', { action: 'prepare-restore', backupId: backup.backupId });
      await probe.control('reopen'); await owner.select(id);
      expect(owner.getSnapshot().input).toBe('可恢复草稿');
      expect(await probe.control('requestCount')).toMatchObject({ count: 0 });
    } finally { owner.dispose(); await probe.close(); }
  }, 20000);

});


describe('manual summary through the existing Tea owner', () => {
  const prepare = async () => {
    const h = harness(); h.messages.push({ id: 'history', sessionId: 's', role: 'user', content: '种下月光花', createdAt: 1 });
    await h.owner.select('s');
    await h.owner.update({ summary: '旧摘要', summarySections: { old: '旧分节' }, summaryMeta: { updatedAt: 1, tokenCount: 999, extension: { preserved: true } } } as never);
    return h;
  };
  const prompts = (h: ReturnType<typeof harness>) => h.invoke.mock.calls.filter(([command]) => command === 'stream_direct_ai' || command === 'stream_target_ai')
    .map(([, args]) => (args?.request as { messages: Array<{ content: string }> }).messages[0]!.content);
  it('saves one non-empty summary atomically, keeps drafts, and uses the saved summary for chat/continue/choices', async () => {
    const h = await prepare(); h.owner.setInput('尚未发送的草稿'); h.owner.stageSummary('先保存的手改摘要');
    const raw = '  新摘要：月光花已经种下😀  '; h.output(raw);
    await Promise.all([h.owner.start(target, h.options, () => true, { kind: 'summary' }), h.owner.start(target, h.options, () => true, { kind: 'summary' })]);
    expect(h.count()).toBe(1); expect(prompts(h)[0]).not.toContain('尚未发送的草稿');
    expect(h.record?.session).toMatchObject({ summary: raw.trim(), draft: '尚未发送的草稿', summaryMeta: { extension: { preserved: true }, coverage: { version: 1, selectedMessageIds: ['history'], sourceMessageCount: 1 } } });
    expect(h.record?.session.summarySections).toBeUndefined(); expect(h.record?.session.summaryMeta).not.toHaveProperty('tokenCount'); expect(h.owner.getSnapshot().summaryDraft).toBeNull();
    expect(h.messages.at(-1)).toMatchObject({ meta: { kind: 'summary', rawOutput: raw } }); expect(buildMagicTeaPartyHistory(h.messages).map(item => item.id)).toEqual(['history']);
    const begin = h.invoke.mock.calls.find(([command, args]) => command === 'mutate_magic_tea_party' && (args?.request as TeaWriteRequest).request.action === 'begin-generation')![1]!.request as TeaWriteRequest;
    if (begin.request.action !== 'begin-generation') throw new Error('bad fixture');
    expect(Object.keys(begin.request.assistantMessage)).toHaveLength(6); expect(begin.request.userMessage).toBeNull(); expect(begin.request.session.summary).toBe('先保存的手改摘要');
    h.output('{"type":"choices","items":[{"id":"choice","text":"浇水"}]}');
    for (const intent of [{ kind: 'continue' }, { kind: 'choices' }, { kind: 'reply', text: '浇水' }] as const) await h.owner.start(target, h.options, () => true, intent);
    for (const prompt of prompts(h).slice(1)) expect(prompt).toContain('【会话摘要】\n' + raw.trim());
    await h.owner.clearSummary(); await h.owner.start(target, h.options, () => true, { kind: 'continue' });
    expect(prompts(h).at(-1)).not.toContain(raw.trim());
  });
  it.each(['', ' \n '])('keeps all old summary fields after empty provider result %j', async raw => {
    const h = await prepare(); const old = { summary: h.record!.session.summary, summaryMeta: h.record!.session.summaryMeta, summarySections: h.record!.session.summarySections };
    h.output(raw); await h.owner.start(target, h.options, () => true, { kind: 'summary' });
    expect(h.record?.session).toMatchObject(old); expect(h.messages.at(-1)).toMatchObject({ status: 'error', meta: { kind: 'summary', rawOutput: raw } });
  });
  it.each(['begin-generation', 'finish-generation'])('resolves an unknown %s receipt without sending the summary twice', async action => {
    const h = await prepare(); h.output('已完成摘要'); h.drop(action);
    const running = h.owner.start(target, h.options, () => true, { kind: 'summary' });
    await vi.waitFor(() => expect(h.owner.getSnapshot().pending).toBe('unknown'));
    expect(h.count()).toBe(action === 'begin-generation' ? 0 : 1);
    await h.owner.start(target, h.options, () => true, { kind: 'summary' });
    await h.owner.retryPending(); await h.owner.resolvePending(); await running;
    expect(h.count()).toBe(1); expect(h.record?.session.summary).toBe('已完成摘要');
  });
  it('retries the exact known failed finish without changing the saved old summary or calling the model again', async () => {
    const h = await prepare(); h.output('保留待保存摘要'); h.fail('finish-generation');
    const running = h.owner.start(target, h.options, () => true, { kind: 'summary' });
    await vi.waitFor(() => expect(h.owner.getSnapshot().pending).toBe('save'));
    expect(h.record?.session.summary).toBe('旧摘要'); expect(h.owner.unsavedText()).toBe('保留待保存摘要');
    const bodies = () => h.invoke.mock.calls.filter(([command, args]) => command === 'mutate_magic_tea_party' && (args?.request as TeaWriteRequest).request.action === 'finish-generation').map(([, args]) => JSON.stringify(args?.request));
    const original = bodies()[0]; await h.owner.retryPending(); await running;
    expect(bodies()).toEqual([original, original]); expect(h.count()).toBe(1);
  });
  it('keeps local summary edits behind save/leave fencing, including failed update and original-write retry', async () => {
    const h = await prepare(); h.owner.stageSummary('  完整手工摘要  '); h.fail('update');
    await h.owner.select('other');
    expect(h.owner.getSnapshot()).toMatchObject({ summaryDraft: '  完整手工摘要  ', pending: 'save' }); expect(h.record?.session.summary).toBe('旧摘要'); expect(h.owner.isBusy()).toBe(true);
    await h.owner.retryPending(); expect(h.record?.session.summary).toBe('  完整手工摘要  '); expect(h.owner.getSnapshot().summaryDraft).toBeNull();
  });
  it('exports the full staged summary and composer when document admission fails before any Native write or dispatch', async () => {
    const h = await prepare(); const before = h.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party').length;
    h.owner.setInput('原输入仍保留'); const summary = '界'.repeat(3 * 1024 * 1024); h.owner.stageSummary(summary);
    expect(await h.owner.saveDraft()).toBe(false);
    await h.owner.start(target, h.options, () => true, { kind: 'summary' });
    expect(h.count()).toBe(0); expect(h.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party')).toHaveLength(before);
    expect(h.record?.session.summary).toBe('旧摘要');
    expect(JSON.parse(h.owner.unsavedText())).toMatchObject({ summary, draft: '原输入仍保留' });
  });
  it.each(['stop', 'credential', 'dispose'] as const)('does not dispatch or overwrite staged edits after preparation %s', async reason => {
    const h = await prepare(); h.owner.stageSummary('仍待保存手改'); const original = h.invoke.getMockImplementation()!;
    let release!: () => void; let first = true; let credential = true;
    h.invoke.mockImplementation(async (command, args) => {
      if (command === 'read_magic_tea_party' && (args?.request as { request: { action: string } }).request.action === 'messages' && first) {
        first = false; await new Promise<void>(resolve => { release = resolve; });
      }
      return original(command, args);
    });
    const running = h.owner.start(target, h.options, () => credential, { kind: 'summary' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (reason === 'stop') h.owner.stop(); else if (reason === 'credential') credential = false; else h.owner.dispose();
    release(); await running; expect(h.count()).toBe(0); expect(h.record?.session.summary).toBe('旧摘要');
    if (reason !== 'dispose') expect(h.owner.getSnapshot().summaryDraft).toBe('仍待保存手改');
  });
  it('keeps the original owner fenced when an old summary finish reply arrives after reactivation', async () => {
    const h = await prepare(); h.output('旧owner摘要'); const original = h.invoke.getMockImplementation()!; let release!: () => void;
    h.invoke.mockImplementation(async (command, args) => { const value = await original(command, args);
      if (command === 'mutate_magic_tea_party' && (args?.request as TeaWriteRequest).request.action === 'finish-generation') await new Promise<void>(resolve => { release = resolve; });
      return value; });
    const running = h.owner.start(target, h.options, () => true, { kind: 'summary' }); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    h.owner.dispose(); h.owner.activate(); await h.owner.select('s'); h.owner.stageSummary('新owner草稿'); const current = h.owner.getSnapshot();
    release(); await running; expect(h.owner.getSnapshot()).toEqual(current); expect(h.count()).toBe(1);
  });
});

describe('real Native manual summary journey', () => {
  const open = async () => {
    const probe = await startMagicTeaPartyJourneyProbe(); let sequence = 0;
    const owner = new DesktopTeaSession(createIpcTeaNativePort(probe.invoke), () => `summary-native-${++sequence}`, () => 800);
    await owner.importText(JSON.stringify({ schema: 'magic-tea-party.session.v1',
      session: { ...baseSession(), summary: '原有效摘要', summarySections: { retained: '原分节' }, summaryMeta: { updatedAt: 1, future: { keep: true } }, future: { untouched: true } },
      roles: [], messages: [{ id: 'source', sessionId: 's', role: 'user', status: 'done', content: '月光花开了。', createdAt: 1 }], tachieAssets: [] }), 'json', () => true);
    const id = owner.getSnapshot().directory[0]!.id; await owner.select(id);
    return { probe, owner, id };
  };
  const observed = async (probe: Awaited<ReturnType<typeof startMagicTeaPartyJourneyProbe>>) =>
    await probe.control('requestCount') as { count: number; requests: Array<{ messages: Array<{ content: string }> }> };
  it.skipIf(!process.env.MAHO_TEA_JOURNEY_BINARY)('saves edited summary across SQLite reopen, generates once and uses it in the next chat, choices and clear/continue', async () => {
    const { probe, owner, id } = await open();
    try {
      owner.stageSummary('  手改后摘要😀  '); expect(owner.isBusy()).toBe(true); await owner.saveDraft();
      await probe.control('reopen'); await owner.select(id); expect(owner.getSnapshot().record?.session.summary).toBe('  手改后摘要😀  ');
      owner.setInput('原输入草稿'); const raw = '  模型生成摘要：月光花绽放😀  ';
      await probe.control('checkpoint', { action: 'model', chunks: [raw], deferred: false });
      await Promise.all([owner.start(target, probe.aiOptions, () => true, { kind: 'summary' }), owner.start(target, probe.aiOptions, () => true, { kind: 'summary' })]);
      expect(owner.getSnapshot().record?.session).toMatchObject({ summary: raw.trim(), draft: '原输入草稿', future: { untouched: true }, summaryMeta: { future: { keep: true }, coverage: { sourceMessageCount: 1, omittedMessageCount: 0 } } });
      expect(owner.getSnapshot().record?.session.summarySections).toBeUndefined();
      await probe.control('reopen'); await owner.select(id);
      await probe.control('checkpoint', { action: 'model', chunks: ['{"type":"choices","items":[{"id":"water","text":"浇花"}]}'], deferred: false });
      await owner.start(target, probe.aiOptions, () => true, { kind: 'choices' });
      await owner.start(target, probe.aiOptions, () => true, { kind: 'reply', text: '现在浇水' });
      const withSummary = await observed(probe); expect(withSummary.count).toBe(3);
      expect(withSummary.requests[0]!.messages[0]!.content).not.toContain('原输入草稿');
      for (const request of withSummary.requests.slice(1)) expect(request.messages[0]!.content).toContain('【会话摘要】\n' + raw.trim());
      await owner.clearSummary(); await probe.control('reopen'); await owner.select(id);
      await owner.start(target, probe.aiOptions, () => true, { kind: 'continue' });
      expect((await observed(probe)).requests.at(-1)!.messages[0]!.content).not.toContain(raw.trim());
      expect(await probe.control('requestCount')).toMatchObject({ count: 4 });
    } finally { owner.dispose(); await probe.close(); }
  }, 30000);
  it.skipIf(!process.env.MAHO_TEA_JOURNEY_BINARY)('keeps stopped raw summary inert after late chunks and SQLite restart', async () => {
    const { probe, owner, id } = await open(); const raw = '已接受摘要前缀😀';
    try {
      await probe.control('checkpoint', { action: 'model', chunks: [raw, '不准迟到覆盖'], deferred: true });
      const running = owner.start(target, probe.aiOptions, () => true, { kind: 'summary' });
      await vi.waitFor(() => expect(owner.getSnapshot().rawUnsaved).toBe(raw), { timeout: 5000 }); owner.stop(); await running;
      const saved = JSON.stringify(owner.getSnapshot().messages); await probe.control('checkpoint', { action: 'release' });
      expect(JSON.stringify(owner.getSnapshot().messages)).toBe(saved);
      await probe.control('reopen'); await owner.select(id);
      expect(owner.getSnapshot().record?.session).toMatchObject({ summary: '原有效摘要', summarySections: { retained: '原分节' } });
      expect(owner.getSnapshot().messages.at(-1)).toMatchObject({ status: 'error', meta: { kind: 'summary', completion: 'stopped', rawOutput: raw } });
      expect(buildMagicTeaPartyHistory(owner.getSnapshot().messages).map(message => message.content)).toEqual(['月光花开了。']);
      expect(await probe.control('requestCount')).toMatchObject({ count: 1 });
    } finally { owner.dispose(); await probe.close(); }
  }, 20000);
  it.skipIf(!process.env.MAHO_TEA_JOURNEY_BINARY)('stores an empty-output failure without replacing any old summary fields', async () => {
    const { probe, owner, id } = await open(); const old = owner.getSnapshot().record!.session;
    try {
      await probe.control('checkpoint', { action: 'model', chunks: [' \n '], deferred: false });
      await owner.start(target, probe.aiOptions, () => true, { kind: 'summary' }); await probe.control('reopen'); await owner.select(id);
      for (const key of ['summary', 'summaryMeta', 'summarySections'] as const) expect(owner.getSnapshot().record!.session[key]).toEqual(old[key]);
      expect(owner.getSnapshot().messages.at(-1)).toMatchObject({ status: 'error', content: '', meta: { kind: 'summary', rawOutput: ' \n ' } });
      expect(await probe.control('requestCount')).toMatchObject({ count: 1 });
    } finally { owner.dispose(); await probe.close(); }
  }, 20000);
  it.skipIf(!process.env.MAHO_TEA_JOURNEY_BINARY)('resolves original finish once and preserves summary, raw and coverage through JSON, JSONL and backup restore', async () => {
    const { probe, owner, id } = await open(); const raw = '  可归档完整摘要😀  ';
    try {
      await probe.control('checkpoint', { action: 'model', chunks: [raw], deferred: false }); await probe.control('drop-next-write-reply', { action: 'finish-generation' });
      const running = owner.start(target, probe.aiOptions, () => true, { kind: 'summary' });
      await vi.waitFor(() => expect(owner.getSnapshot().pending).toBe('unknown'), { timeout: 5000 });
      await owner.retryPending(); await owner.start(target, probe.aiOptions, () => true, { kind: 'summary' });
      await owner.resolvePending(); await running; expect(await probe.control('requestCount')).toMatchObject({ count: 1 });
      const json = await owner.export('json'); const jsonl = await owner.export('jsonl'); let serial = 0;
      const jsonPlan = prepareDesktopTeaImport(json, 'json', () => `json-summary-${++serial}`, 900);
      const jsonlPlan = prepareDesktopTeaImport(jsonl, 'jsonl', () => `jsonl-summary-${++serial}`, 900);
      if (jsonPlan.write.request.action !== 'import' || jsonlPlan.write.request.action !== 'import') throw new Error('bad fixture');
      const entry = jsonPlan.write.request.entries[0]!;
      expect(entry.session.summary).toBe(raw.trim()); expect(entry.session.summaryMeta).toMatchObject({ coverage: { selectedMessageIds: [entry.messages[0]!.id] } });
      for (const plan of [jsonPlan, jsonlPlan]) {
        if (plan.write.request.action !== 'import') throw new Error('bad fixture');
        const messages = plan.write.request.entries[0]!.messages;
        expect(messages.at(-1)).toMatchObject({ status: 'done', meta: { kind: 'summary', rawOutput: raw } });
        expect(buildMagicTeaPartyHistory(messages).map(message => message.content)).toEqual(['月光花开了。']);
      }
      expect(jsonlPlan.write.request.entries[0]!.session.summary).toBeUndefined();
      const backup = await probe.control('checkpoint', { action: 'backup' }) as { backupId: string };
      await owner.delete(owner.getSnapshot().incarnation, id, owner.getSnapshot().record!.instance, owner.getSnapshot().record!.revision);
      await probe.control('checkpoint', { action: 'prepare-restore', backupId: backup.backupId }); await probe.control('reopen'); await owner.select(id);
      expect(owner.getSnapshot().record?.session.summary).toBe(raw.trim()); expect(owner.getSnapshot().messages.at(-1)?.meta?.rawOutput).toBe(raw);
      await owner.importText(jsonl, 'jsonl', () => true); expect(await probe.control('requestCount')).toMatchObject({ count: 1 });
    } finally { owner.dispose(); await probe.close(); }
  }, 30000);
  it.skipIf(!process.env.MAHO_TEA_JOURNEY_BINARY)('reopens an unresolved begin as interrupted, keeps old summary and never resends a model', async () => {
    const { probe, owner, id } = await open(); let replacement: DesktopTeaSession | undefined;
    try {
      await probe.control('drop-next-write-reply', { action: 'begin-generation' });
      const running = owner.start(target, probe.aiOptions, () => true, { kind: 'summary' });
      await vi.waitFor(() => expect(owner.getSnapshot().pending).toBe('unknown'), { timeout: 5000 });
      owner.dispose(); await running; await probe.control('reopen');
      replacement = new DesktopTeaSession(createIpcTeaNativePort(probe.invoke)); await replacement.select(id);
      expect(replacement.getSnapshot().record?.session.summary).toBe('原有效摘要');
      expect(replacement.getSnapshot().messages.at(-1)).toMatchObject({ content: '', status: 'error', error: { code: 'tea-interrupted' } });
      expect(await probe.control('requestCount')).toMatchObject({ count: 0 });
    } finally { owner.dispose(); replacement?.dispose(); await probe.close(); }
  }, 20000);
  it.skipIf(!process.env.MAHO_TEA_JOURNEY_BINARY)('invalidates a live summary credential snapshot without promoting its prefix', async () => {
    const { probe, owner, id } = await open(); let current = true; const prefix = '原凭据接受的前缀';
    try {
      await probe.control('checkpoint', { action: 'model', chunks: [prefix, '凭据已变化不得追加'], deferred: true });
      const running = owner.start(target, probe.aiOptions, () => current, { kind: 'summary' });
      await vi.waitFor(() => expect(owner.getSnapshot().rawUnsaved).toBe(prefix), { timeout: 5000 }); current = false;
      await probe.control('checkpoint', { action: 'release' }); await running; await probe.control('reopen'); await owner.select(id);
      expect(owner.getSnapshot().record?.session.summary).toBe('原有效摘要');
      expect(owner.getSnapshot().messages.at(-1)).toMatchObject({ status: 'error', meta: { kind: 'summary', completion: 'stopped', rawOutput: prefix } });
      expect(await probe.control('requestCount')).toMatchObject({ count: 1 });
    } finally { owner.dispose(); await probe.close(); }
  }, 20000);
});

const automaticHarness = async (enabled = true) => {
  const h = harness();
  h.messages.push(...Array.from({ length: 8 }, (_, index): TeaMessageDocument => ({
    id: `history-${index}`, sessionId: 's', role: index % 2 ? 'assistant' : 'user', content: `原始消息${index}`, createdAt: index, status: 'done',
  })));
  await h.owner.select('s');
  await h.owner.updateSettings({ autoSummaryEnabled: enabled, outputFormat: 'markdown', maxContextMessages: 2, summaryMinGapMessages: 8 });
  h.output('正常剧情与摘要');
  return h;
};

describe('explicit Desktop automatic summary after the original committed turn', () => {
  it('does not dispatch on load, a toggle, or legacy combined-output permission', async () => {
    const h = await automaticHarness(false);
    await h.owner.updateSettings({ enableSummary: true, outputPlan: { choices: 'auto', summary: 'on', updates: 'off' } });
    expect(h.count()).toBe(0);
    await h.owner.start(target, h.options, () => true, { kind: 'continue' });
    expect(h.count()).toBe(1); expect(h.record?.session.summary).toBeUndefined();
    await h.owner.updateSettings({ autoSummaryEnabled: true }); await h.owner.select('s');
    expect(h.count()).toBe(1);
  });
  it.each(['reply', 'selected-choice', 'continue'] as const)('appends at most one summary after %s and preserves every source message and draft', async kind => {
    const h = await automaticHarness(); const originals = JSON.stringify(h.messages);
    h.owner.setInput('保留输入框草稿');
    const intent = kind === 'continue' ? { kind } : { kind, text: '本次剧情输入' };
    await Promise.all([h.owner.start(target, h.options, () => true, intent), h.owner.start(target, h.options, () => true, intent)]);
    expect(h.count()).toBe(2);
    expect(JSON.stringify(h.messages.slice(0, 8))).toBe(originals);
    expect(h.messages.at(-1)).toMatchObject({ status: 'done', meta: { kind: 'summary', rawOutput: '正常剧情与摘要' } });
    expect(h.record?.session.summary).toBe('正常剧情与摘要');
    const through = h.messages.at(-2)!.id;
    expect(h.record?.session.autoSummaryState).toEqual({ lastAttemptedThroughMessageId: through });
    expect(h.record?.session.summaryMeta).toMatchObject({ toMessageId: through, coverage: { sourceMessageCount: kind === 'continue' ? 9 : 10 } });
    expect(teaSessionView(h.record!.session).summaryMeta?.coverage?.selectedMessageIds).not.toContain(h.messages.at(-1)!.id);
    expect(h.owner.getSnapshot().input).toBe(kind === 'reply' ? '' : '保留输入框草稿');
    await h.owner.start(target, h.options, () => true, { kind: 'continue' });
    expect(h.count()).toBe(3); // One new source message is below the attempt/summary gap.
  });
  it.each(['summary', 'choices'] as const)('does not cascade after manual %s', async kind => {
    const h = await automaticHarness();
    await h.owner.start(target, h.options, () => true, { kind });
    expect(h.count()).toBe(1); expect(h.record?.session.autoSummaryState).toBeUndefined();
  });
  it.each(['unknown', 'not-written'] as const)('never schedules from a recovered %s original finish', async failure => {
    const h = await automaticHarness(); if (failure === 'unknown') h.drop('finish-generation'); else h.fail('finish-generation');
    const running = h.owner.start(target, h.options, () => true, { kind: 'continue' });
    await vi.waitFor(() => expect(h.owner.getSnapshot().pending).toBe(failure === 'unknown' ? 'unknown' : 'save'));
    if (failure === 'unknown') await h.owner.resolvePending(); else await h.owner.retryPending();
    await running; expect(h.count()).toBe(1); expect(h.record?.session.autoSummaryState).toBeUndefined();
  });
  it.each(['unknown', 'not-written'] as const)('revokes an automatic begin after %s saving and cannot charge on receipt/retry', async failure => {
    const h = await automaticHarness(); const original = h.invoke.getMockImplementation()!; let failed = false;
    h.invoke.mockImplementation(async (command, args) => {
      const write = command === 'mutate_magic_tea_party' ? (args?.request as TeaWriteRequest).request : null;
      if (!failed && write?.action === 'begin-generation' && write.session.autoSummaryState) {
        failed = true; if (failure === 'unknown') h.drop('begin-generation'); else h.fail('begin-generation');
      }
      return original(command, args);
    });
    const running = h.owner.start(target, h.options, () => true, { kind: 'continue' });
    await vi.waitFor(() => expect(h.owner.getSnapshot().pending).toBe(failure === 'unknown' ? 'unknown' : 'save'));
    expect(h.owner.getSnapshot().error).toContain('剧情已保存'); expect(h.count()).toBe(1);
    if (failure === 'unknown') await h.owner.resolvePending(); else await h.owner.retryPending();
    await running;
    expect(h.count()).toBe(1); expect(h.record?.session.summary).toBeUndefined();
    expect(h.messages.at(-1)).toMatchObject({ status: 'error', meta: { kind: 'summary', completion: 'stopped' } });
  });
  it('keeps the attempt after an empty automatic result and does not immediately retry', async () => {
    const h = await automaticHarness(); await h.owner.update({ summary: '保留旧摘要', summaryMeta: { updatedAt: 1, coverage: { version: 1, sourceMessageCount: 1, selectedMessageIds: ['history-0'], clippedMessageIds: [], omittedMessageCount: 0 } } });
    const before = JSON.stringify(h.record?.session.summaryMeta); const original = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation(async (command, args) => {
      if (command === 'stream_direct_ai' && h.count() === 1) h.output('   ');
      return original(command, args);
    });
    await h.owner.start(target, h.options, () => true, { kind: 'continue' });
    expect(h.count()).toBe(2); expect(h.record?.session.summary).toBe('保留旧摘要');
    expect(JSON.stringify(h.record?.session.summaryMeta)).toBe(before);
    expect(teaSessionView(h.record!.session).autoSummaryState?.lastAttemptedThroughMessageId).toBe(h.messages.at(-2)!.id);
    h.output('下一轮'); await h.owner.start(target, h.options, () => true, { kind: 'continue' });
    expect(h.count()).toBe(3);
  });
  it('treats a stop during original committed-result reload as loss of automatic dispatch authority', async () => {
    const h = await automaticHarness(); const original = h.invoke.getMockImplementation()!; let stopped = false;
    h.invoke.mockImplementation(async (command, args) => {
      if (!stopped && command === 'read_magic_tea_party' && (args?.request as { request: { action: string } }).request.action === 'session' && h.count() === 1) {
        stopped = true; h.owner.stop();
      }
      return original(command, args);
    });
    await h.owner.start(target, h.options, () => true, { kind: 'continue' });
    expect(h.count()).toBe(1); expect(h.messages.at(-1)?.status).toBe('done');
    expect(h.record?.session.autoSummaryState).toBeUndefined();
  });
});

it.each(['编辑后的手工摘要', ''])( 'retains a new manual summary draft %j while stopping an automatic request', async draft => {
  const h = await automaticHarness(); await h.owner.update({ summary: '原摘要', summaryMeta: { updatedAt: 1, extension: '保留扩展' } } as Parameters<typeof h.owner.update>[0]);
  const original = h.invoke.getMockImplementation()!; let release!: () => void;
  h.invoke.mockImplementation(async (command, args) => {
    if (command === 'stream_direct_ai' && h.count() === 1) {
      await new Promise<void>(resolve => { release = resolve; });
    }
    return original(command, args);
  });
  const running = h.owner.start(target, h.options, () => true, { kind: 'continue' });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  h.owner.stageSummary(draft); expect(h.owner.getSnapshot().summaryDraft).toBe(draft);
  release(); await running;
  expect(h.owner.getSnapshot().summaryDraft).toBe(draft); expect(h.record?.session.summary).toBe('原摘要');
  await h.owner.saveDraft();
  expect(h.record?.session.summary).toBe(draft || undefined);
  expect(h.record?.session.summaryMeta).toMatchObject({ extension: '保留扩展' });
});

it('separates a manual summary draft export from an automatic raw prefix during an unknown finish', async () => {
  const h = await automaticHarness(); await h.owner.update({ summary: '原摘要' });
  const original = h.invoke.getMockImplementation()!; let release!: () => void;
  h.invoke.mockImplementation(withFixtureStreamReceipt(async (command: string, args?: Record<string, unknown>) => {
    if (command === 'stream_direct_ai' && h.count() === 1) {
      const request = args?.request as { requestId: string; contractVersion: 1; mode: 'direct-local' };
      const channel = args?.onEvent as { onmessage: (_event: AiStreamEvent) => void };
      const identity = { requestId: request.requestId, contractVersion: request.contractVersion, mode: request.mode };
      channel.onmessage({ ...identity, sequence: 0, type: 'started' });
      channel.onmessage({ ...identity, sequence: 1, type: 'text-delta', delta: '自动模型前缀' });
      await new Promise<void>(resolve => { release = resolve; }); return;
    }
    return original(command, args);
  }));
  const running = h.owner.start(target, h.options, () => true, { kind: 'continue' });
  await vi.waitFor(() => expect(h.owner.getSnapshot().rawUnsaved).toBe('自动模型前缀'));
  h.drop('finish-generation'); h.owner.stageSummary('用户手工稿');
  // Let the synthetic invoke settle after Stop, as the real bridge does on cancellation.
  release();
  await vi.waitFor(() => expect(h.owner.getSnapshot().pending).toBe('unknown'));
  expect(h.owner.unsavedText()).toBe('自动模型前缀');
  expect(JSON.parse(h.owner.unsavedSummaryText())).toMatchObject({ summary: '用户手工稿' });
  await h.owner.resolvePending(); await running;
  expect(h.record?.session.summary).toBe('原摘要'); expect(h.owner.getSnapshot().summaryDraft).toBe('用户手工稿');
});

it.each(['credential', 'dispose'] as const)('does not let late automatic output survive a %s change', async change => {
  const h = await automaticHarness(); await h.owner.update({ summary: '原摘要' });
  const original = h.invoke.getMockImplementation()!; let release!: () => void; let current = true;
  h.invoke.mockImplementation(async (command, args) => {
    if (command === 'stream_direct_ai' && h.count() === 1) await new Promise<void>(resolve => { release = resolve; });
    return original(command, args);
  });
  const running = h.owner.start(target, h.options, () => current, { kind: 'continue' });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  if (change === 'credential') current = false; else h.owner.dispose();
  release(); await running;
  expect(h.record?.session.summary).toBe('原摘要');
  expect(h.record?.session.autoSummaryState).toBeDefined();
});

it.each(['unknown', 'not-written'] as const)('restores the existing primary begin after %s saving without granting a new automatic request', async failure => {
  const h = await automaticHarness(); if (failure === 'unknown') h.drop('begin-generation'); else h.fail('begin-generation');
  const running = h.owner.start(target, h.options, () => true, { kind: 'continue' });
  await vi.waitFor(() => expect(h.owner.getSnapshot().pending).toBe(failure === 'unknown' ? 'unknown' : 'save'));
  expect(h.count()).toBe(0);
  if (failure === 'unknown') await h.owner.resolvePending(); else await h.owner.retryPending();
  await running;
  expect(h.count()).toBe(1); expect(h.messages.at(-1)?.status).toBe('done');
  expect(h.record?.session.summary).toBeUndefined(); expect(h.record?.session.autoSummaryState).toBeUndefined();
});

it('honors a manual edit received synchronously before an automatic terminal write freezes', async () => {
  const h = await automaticHarness(); await h.owner.update({ summary: '旧摘要' });
  let changed = false;
  h.owner.subscribe(() => {
    const state = h.owner.getSnapshot();
    if (!changed && state.isAutoSummarizing && !state.generating && !state.busy && state.rawUnsaved) {
      changed = true; h.owner.stageSummary('终态前的手工稿');
    }
  });
  await h.owner.start(target, h.options, () => true, { kind: 'continue' });
  expect(changed).toBe(true); expect(h.record?.session.summary).toBe('旧摘要');
  expect(h.owner.getSnapshot().summaryDraft).toBe('终态前的手工稿');
  expect(h.messages.at(-1)).toMatchObject({ status: 'error', meta: { kind: 'summary', completion: 'stopped' } });
});


describe('user-message fork editor owner', () => {
  const ready = async () => {
    const h = harness(); await h.owner.select('s'); h.owner.setInput('原消息');
    await h.owner.start(target, h.options, () => true);
    h.invoke.mockClear();
    return h;
  };
  const writes = (h: ReturnType<typeof harness>) => h.invoke.mock.calls.filter(([command]) => command === 'mutate_magic_tea_party');
  it('cancels and rejects whitespace without writes; only user messages are editable', async () => {
    const h = await ready(); h.owner.startMessageEdit(h.messages[1]!.id); expect(h.owner.getSnapshot().editingMessageId).toBeNull();
    h.owner.startMessageEdit(h.messages[0]!.id); h.owner.setMessageEditDraft('  ');
    expect(await h.owner.forkMessageEdit()).toBe(false); h.owner.cancelMessageEdit();
    expect(h.owner.getSnapshot().editingMessageId).toBeNull(); expect(writes(h)).toHaveLength(0);
  });
  it.each(['input', 'title', 'name', 'summary'] as const)('protects unsaved %s before starting an edit without implicit saves', async field => {
    const h = await ready();
    if (field === 'input') h.owner.setInput('未保存');
    if (field === 'title') h.owner.stageTitle('未保存');
    if (field === 'name') h.owner.stageName('未保存');
    if (field === 'summary') h.owner.stageSummary('未保存');
    const before = h.owner.getSnapshot(); h.owner.startMessageEdit(h.messages[0]!.id);
    expect(h.owner.getSnapshot()).toMatchObject({ input: before.input, titleDraft: before.titleDraft, nameDraft: before.nameDraft, summaryDraft: before.summaryDraft, editingMessageId: null });
    expect(writes(h)).toHaveLength(0);
  });
  it('double confirmation creates one branch and opens it without calling the model or updating source', async () => {
    const h = await ready(); const original = structuredClone(h.record); const source = h.owner.getSnapshot().record!;
    h.owner.startMessageEdit(h.messages[0]!.id); h.owner.setMessageEditDraft('改写😀');
    await Promise.all([h.owner.forkMessageEdit(), h.owner.forkMessageEdit()]);
    expect(writes(h)).toHaveLength(1); expect((writes(h)[0]![1]!.request as TeaWriteRequest).request).toMatchObject({ action: 'fork', sessionId: 's', expectedRevision: original!.revision, editedContent: '改写😀' });
    expect(source).toEqual(original); expect(h.owner.getSnapshot().record?.session.id).not.toBe('s');
    expect(h.owner.getSnapshot().messages).toHaveLength(1); expect(h.owner.getSnapshot().editingMessageId).toBeNull(); expect(h.count()).toBe(1);
  });
  it('keeps the failed edit on abandon and queries the original receipt for an unknown save', async () => {
    const h = await ready(); h.owner.startMessageEdit(h.messages[0]!.id); h.owner.setMessageEditDraft('保留编辑');
    h.fail('fork'); await h.owner.forkMessageEdit(); expect(h.owner.getSnapshot().pending).toBe('save');
    await h.owner.abandonPending(); expect(h.owner.getSnapshot()).toMatchObject({ editingDraft: '保留编辑', record: { session: { id: 's' } }, pending: 'none' });
    h.drop('fork'); await h.owner.forkMessageEdit(); expect(h.owner.getSnapshot().pending).toBe('unknown');
    await h.owner.retryPending(); expect(writes(h)).toHaveLength(2);
    await h.owner.abandonPending(); expect(h.owner.getSnapshot().pending).toBe('unknown');
    await h.owner.resolvePending(); expect(writes(h)).toHaveLength(2); expect(h.count()).toBe(1);
    expect(h.owner.getSnapshot()).toMatchObject({ pending: 'none', editingMessageId: null });
    expect(h.invoke.mock.calls.some(([command, args]) => command === 'read_magic_tea_party' && (args?.request as { request: { action: string } }).request.action === 'receipt')).toBe(true);
  });
  it('retries the same frozen fork only after the original receipt proves no commit', async () => {
    const h = await ready(); const originalInvoke = h.invoke.getMockImplementation()!; let lose = true;
    h.invoke.mockImplementation(async (...args) => {
      if (args[0] === 'mutate_magic_tea_party' && lose) { lose = false; throw new Error('transport lost before write'); }
      return originalInvoke(...args);
    });
    h.owner.startMessageEdit(h.messages[0]!.id); h.owner.setMessageEditDraft('冻结编辑'); await h.owner.forkMessageEdit();
    expect(h.owner.getSnapshot().pending).toBe('unknown'); await h.owner.retryPending(); expect(writes(h)).toHaveLength(1);
    await h.owner.resolvePending(); expect(h.owner.getSnapshot().pending).toBe('save');
    h.owner.setMessageEditDraft('不能修改待保存请求'); h.owner.cancelMessageEdit();
    expect(h.owner.getSnapshot().editingDraft).toBe('冻结编辑');
    await h.owner.retryPending(); expect(writes(h)).toHaveLength(2); expect(writes(h)[0]![1]).toEqual(writes(h)[1]![1]);
    expect(h.owner.getSnapshot().pending).toBe('none'); expect(h.count()).toBe(1);
  });
  it('exports the exact edit and source when validation rejects it before any write', async () => {
    const h = await ready(); const anchor = h.messages[0]!.id; const edit = '保留无效标量\ud800原件';
    h.owner.startMessageEdit(anchor); h.owner.setMessageEditDraft(edit);
    expect(await h.owner.forkMessageEdit()).toBe(false); expect(writes(h)).toHaveLength(0);
    expect(h.owner.getSnapshot()).toMatchObject({ pending: 'none', editingDraft: edit, editingMessageId: anchor });
    expect(JSON.parse(h.owner.unsavedText())).toMatchObject({ sessionId: 's', instance: h.record!.instance,
      expectedRevision: h.record!.revision, anchorMessageId: anchor, editedContent: edit });
  });
  it('fences a late fork reply from a disposed and reactivated owner', async () => {
    const h = await ready(); const originalInvoke = h.invoke.getMockImplementation()!; let release!: () => void;
    h.invoke.mockImplementation(async (...args) => { const response = await originalInvoke(...args); if (args[0] === 'mutate_magic_tea_party') await new Promise<void>(resolve => { release = resolve; }); return response; });
    h.owner.startMessageEdit(h.messages[0]!.id); h.owner.setMessageEditDraft('旧编辑'); const saving = h.owner.forkMessageEdit();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    h.owner.dispose(); h.owner.activate(); const replacement = h.owner.getSnapshot(); release(); await saving;
    expect(h.owner.getSnapshot()).toBe(replacement); expect(h.count()).toBe(1);
  });
});
