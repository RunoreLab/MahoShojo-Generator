import { describe, expect, it, vi } from 'vitest';
import { FREE_GENERATION_SCHEMAS } from '@mahoshojo/ai-core/free-generation';
import type { AiExecutionRequest, AiExecutionResult } from '@mahoshojo/contracts/ai-execution';
import type { AiStreamEvent } from '@mahoshojo/ai-core/stream-events';
import type { HostedGenerationEvent } from '@mahoshojo/contracts/desktop-cloud';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import {
  executeDesktopGeneration,
  GenerationTransportError,
  type DesktopGenerationFamily,
  type DesktopGenerationIntent,
} from '../src/features/generation/executor';
import {
  DesktopGenerationSession,
  type GenerationSessionFamily,
} from '../src/features/generation/session';
import { STREAM_DIRECT_AI_COMMAND } from '../src/platform/direct-ai-bridge';
import { HOSTED_AI_REQUEST_COMMAND, STREAM_HOSTED_AI_COMMAND } from '../src/platform/cloud-bridge';

/**
 * 通用生成核 pin 测试（D5.1-G2 切2a）：用与问卷无关的最小 fake 家族
 * 直接消费 `executeDesktopGeneration` / `DesktopGenerationSession`，
 * 钉住家族无关语义——输入校验、卡投影签名、归一化失败 → invalid-output、
 * 草稿公共件（version/output 校验、残余判定、签名剥除/归属）。
 */

interface FakeInput { prompt: string; hosted?: { extra: string } }
interface FakeDraft { prompt: string; flag?: boolean }
type FakeKind = 'fake-structured' | 'fake-stream';

const FAKE_SCHEMA = FREE_GENERATION_SCHEMAS.general;

const fakeExecutorFamily = (): DesktopGenerationFamily<FakeInput, DesktopGenerationIntent, FakeKind> => ({
  validateInput: (input) => {
    if (!input.prompt.trim()) throw new Error('请先填写内容。');
  },
  streamRouteId: 'generate-free-stream',
  jsonRouteId: 'generate-free',
  buildHostedBody: (input) => ({ prompt: input.prompt, extra: input.hosted?.extra ?? null }),
  createDirectConfig: () => ({
    systemPrompt: '系统提示',
    temperature: 0.5,
    promptBuilder: (input) => `生成：${input.prompt}`,
    schema: FAKE_SCHEMA,
    taskName: 'fake',
  }),
  buildStructuredCard: (data) => ({ card: data as Record<string, unknown>, cardKind: 'fake-structured' }),
  buildStreamCard: (markdown) => ({ card: { title: '流式卡', body: markdown }, cardKind: 'fake-stream' }),
  normalizeHostedJsonCard: (data) => {
    if (typeof data !== 'object' || data === null || typeof (data as { title?: unknown }).title !== 'string') {
      throw new Error('data 形状不符');
    }
    return { card: data as Record<string, unknown>, cardKind: 'fake-structured' };
  },
  createError: (rawText, cause) => new GenerationTransportError(rawText, cause),
  cardNoun: '数据卡',
});

const directHarness = (text: string) => {
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command !== STREAM_DIRECT_AI_COMMAND) throw new Error(`unexpected command: ${command}`);
    const request = args!.request as AiExecutionRequest;
    const channel = args!.onEvent as { onmessage: (event: AiStreamEvent) => void };
    const identity = { requestId: request.requestId, contractVersion: 1 as const, mode: request.mode };
    channel.onmessage({ type: 'started', ...identity, sequence: 0 });
    const result: AiExecutionResult = { ...identity, status: 'completed', output: { text }, finishReason: 'stop' };
    channel.onmessage({ type: 'result', ...identity, sequence: 1, result });
  });
  return { invoke, options: { invoke, profileId: 'p', createChannel: () => ({}) } };
};

const intent: DesktopGenerationIntent = { requestId: 'g-1', mode: 'direct-local' };

describe('通用生成执行器（家族无关语义）', () => {
  it('dispatch 前执行家族输入校验，不消耗任何通路', async () => {
    const native = directHarness('{}');
    await expect(
      executeDesktopGeneration(fakeExecutorFamily(), native.options, { prompt: '  ' }, intent, new AbortController().signal),
    ).rejects.toThrow('请先填写内容');
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('direct 通路把家族投影的 cardKind 如实回传', async () => {
    const native = directHarness(JSON.stringify({ name: 't', content: 'b' }));
    const outcome = await executeDesktopGeneration(
      fakeExecutorFamily(),
      native.options,
      { prompt: 'x' },
      intent,
      new AbortController().signal,
    );
    expect(outcome).toMatchObject({ status: 'completed', cardKind: 'fake-structured', card: { name: 't' } });
  });

  it('hosted-stream 用家族流式投影；hosted-json 归一化失败投影为 invalid-output 而非 uncertain', async () => {
    let send: ((event: HostedGenerationEvent) => void) | undefined;
    const streamInvoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      send = (args!.onEvent as { onmessage: (event: HostedGenerationEvent) => void }).onmessage;
      send({ event: 'markdown', data: { chunk: '正文' } });
      send({ event: 'done', data: { ok: true } });
    });
    const streamOutcome = await executeDesktopGeneration(
      fakeExecutorFamily(),
      { invoke: streamInvoke, profileId: '', createChannel: () => ({}) },
      { prompt: 'x', hosted: { extra: 'e' } },
      { requestId: 'g-2', mode: 'hosted-stream' },
      new AbortController().signal,
    );
    expect(streamOutcome).toMatchObject({ status: 'completed', cardKind: 'fake-stream', card: { title: '流式卡', body: '正文' } });
    expect(streamInvoke).toHaveBeenCalledWith(STREAM_HOSTED_AI_COMMAND, expect.objectContaining({
      request: expect.objectContaining({ routeId: 'generate-free-stream', body: { prompt: 'x', extra: 'e' } }),
    }));

    const jsonInvoke = vi.fn(async () => ({ status: 200, body: { data: { bogus: 1 }, aiMeta: null } }));
    const jsonOutcome = await executeDesktopGeneration(
      fakeExecutorFamily(),
      { invoke: jsonInvoke, profileId: '' },
      { prompt: 'x' },
      { requestId: 'g-3', mode: 'hosted-json' },
      new AbortController().signal,
    );
    expect(jsonOutcome).toMatchObject({ status: 'invalid-output', mode: 'hosted-json', message: '服务器返回的数据卡未通过校验。' });
    // 已收到的服务器响应正文必须保留（有界透传），供导出诊断（G2-r1）。
    expect((jsonOutcome as { rawText: string }).rawText).toContain('bogus');
    expect(jsonInvoke).toHaveBeenCalledTimes(1);
    expect(jsonInvoke).toHaveBeenCalledWith(HOSTED_AI_REQUEST_COMMAND, expect.anything());
  });

  it('hosted 请求体按路由预算在派发前拦截：超限不发起 native 调用', async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: { data: { title: 'x' }, aiMeta: null } }));
    // scenario 路由预算 256 KiB：300KB prompt + JSON 包装必然超限。
    const family = { ...fakeExecutorFamily(), jsonRouteId: 'generate-scenario' as const };
    const outcome = await executeDesktopGeneration(
      family,
      { invoke, profileId: '' },
      { prompt: 'x'.repeat(300 * 1024) },
      { requestId: 'g-4', mode: 'hosted-json' },
      new AbortController().signal,
    );
    expect(outcome).toMatchObject({ status: 'failed', mode: 'hosted-json', code: 'invalid-request' });
    expect((outcome as { message: string }).message).toContain('上限');
    expect(invoke).not.toHaveBeenCalled();

    // 对照：free 路由 1 MiB 配额放行同体量请求（附件预算场景，G2-r1 分路由）。
    const freeInvoke = vi.fn(async () => ({ status: 200, body: { data: { title: 'ok' }, aiMeta: null } }));
    const okOutcome = await executeDesktopGeneration(
      fakeExecutorFamily(),
      { invoke: freeInvoke, profileId: '' },
      { prompt: 'x'.repeat(300 * 1024) },
      { requestId: 'g-5', mode: 'hosted-json' },
      new AbortController().signal,
    );
    expect(okOutcome.status).toBe('completed');
    expect(freeInvoke).toHaveBeenCalledTimes(1);
  });

  it('路由预算精确边界：序列化恰在上限放行、+1 字节即拦截（256 KiB / 1 MiB）', async () => {
    // fake 家族 hosted 请求体固定为 {prompt, extra:null}，JSON 包装开销 26 字节。
    const overhead = JSON.stringify({ prompt: '', extra: null }).length;
    const run = (
      invoke: ReturnType<typeof vi.fn>,
      prompt: string,
      jsonRouteId: 'generate-scenario' | 'generate-free',
    ) => executeDesktopGeneration(
      { ...fakeExecutorFamily(), jsonRouteId },
      { invoke, profileId: '' },
      { prompt },
      { requestId: 'b', mode: 'hosted-json' },
      new AbortController().signal,
    );
    const okInvoke = () => vi.fn(async () => ({ status: 200, body: { data: { title: 'x' }, aiMeta: null } }));

    // 默认路由（generate-scenario）256 KiB：恰在上限放行，+1 B 不发起调用。
    const limit256 = 256 * 1024;
    const atLimit = 'x'.repeat(limit256 - overhead);
    const atInvoke = okInvoke();
    await expect(run(atInvoke, atLimit, 'generate-scenario')).resolves.toMatchObject({ status: 'completed' });
    expect(atInvoke).toHaveBeenCalledTimes(1);
    const overInvoke = okInvoke();
    await expect(run(overInvoke, `${atLimit}x`, 'generate-scenario')).resolves.toMatchObject({ status: 'failed', code: 'invalid-request' });
    expect(overInvoke).not.toHaveBeenCalled();

    // 放宽路由（generate-free）1 MiB：同一套边界语义。
    const limit1m = 1024 * 1024;
    const atFree = 'x'.repeat(limit1m - overhead);
    const freeAtInvoke = okInvoke();
    await expect(run(freeAtInvoke, atFree, 'generate-free')).resolves.toMatchObject({ status: 'completed' });
    expect(freeAtInvoke).toHaveBeenCalledTimes(1);
    const freeOverInvoke = okInvoke();
    await expect(run(freeOverInvoke, `${atFree}x`, 'generate-free')).resolves.toMatchObject({ status: 'failed', code: 'invalid-request' });
    expect(freeOverInvoke).not.toHaveBeenCalled();
  });

  it('路由预算计的是线上 UTF-8 字节：多字节字符与 JSON 转义如实计费', async () => {
    const overhead = JSON.stringify({ prompt: '', extra: null }).length;
    const run = (invoke: ReturnType<typeof vi.fn>, prompt: string) =>
      executeDesktopGeneration(
        { ...fakeExecutorFamily(), jsonRouteId: 'generate-scenario' },
        { invoke, profileId: '' },
        { prompt },
        { requestId: 'b', mode: 'hosted-json' },
        new AbortController().signal,
      );
    const okInvoke = () => vi.fn(async () => ({ status: 200, body: { data: { title: 'x' }, aiMeta: null } }));
    const limit = 256 * 1024;

    // CJK 3 B/码点：串长 100_026 低于上限、UTF-8 字节 300_026 超限 → 拦截。
    const cjkInvoke = okInvoke();
    await expect(run(cjkInvoke, '界'.repeat(100_000))).resolves.toMatchObject({ status: 'failed', code: 'invalid-request' });
    expect(cjkInvoke).not.toHaveBeenCalled();

    // emoji 4 B/码点（UTF-16 占 2 码元）：串长 140_026 界内、字节超限 → 拦截。
    const emojiInvoke = okInvoke();
    await expect(run(emojiInvoke, '😀'.repeat(70_000))).resolves.toMatchObject({ status: 'failed', code: 'invalid-request' });
    expect(emojiInvoke).not.toHaveBeenCalled();

    // JSON 转义计入线上体积：引号原文 1 B/字符，序列化为 \" 2 B/字符——
    // 原文恰好界内的输入经转义后超限 → 拦截；转义后仍界内 → 放行。
    const quoteOver = okInvoke();
    await expect(run(quoteOver, '"'.repeat(140_000))).resolves.toMatchObject({ status: 'failed', code: 'invalid-request' });
    expect(quoteOver).not.toHaveBeenCalled();
    const quoteAt = okInvoke();
    await expect(run(quoteAt, '"'.repeat((limit - overhead) / 2))).resolves.toMatchObject({ status: 'completed' });
    expect(quoteAt).toHaveBeenCalledTimes(1);
  });
});

const DRAFT_KEY = 'test.fake.draft.v1';

const fakeSessionFamily = (overrides?: Partial<GenerationSessionFamily<FakeDraft, FakeInput, DesktopGenerationIntent, FakeKind>>): GenerationSessionFamily<FakeDraft, FakeInput, DesktopGenerationIntent, FakeKind> => ({
  draftKey: DRAFT_KEY,
  defaultCardKind: 'fake-structured',
  parseDraftFields: (value) => {
    if (typeof value.prompt !== 'string') throw new Error('草稿损坏');
    const draft: FakeDraft = { prompt: value.prompt };
    if (value.flag === true) draft.flag = true;
    return draft;
  },
  normalizeStoredCardKind: (value) => (value === 'fake-stream' ? 'fake-stream' : 'fake-structured'),
  isResidueDraft: (draft) => draft.prompt.trim() === '' && (draft.output === undefined || (draft.output.phase === 'idle' && draft.output.card === null)),
  validateCard: (kind, value) => {
    if (typeof value !== 'object' || value === null) throw new Error('卡损坏');
    const card = value as Record<string, unknown>;
    if (kind === 'fake-stream' && typeof card.body !== 'string') throw new Error('流式卡损坏');
    if (kind === 'fake-structured' && typeof card.title !== 'string') throw new Error('结构化卡损坏');
    return { ...card };
  },
  cardTypeOf: (kind) => (kind === 'fake-stream' ? 'scenario' : 'character'),
  titleOf: (kind, card) => String(card.title ?? '未命名'),
  signatureFrom: (kind, card) => (kind === 'fake-structured' && typeof card.signature === 'string' ? card.signature : undefined),
  stripSignature: (card) => { delete card.signature; },
  executeGeneration: async () => ({ status: 'failed', mode: 'direct-local', rawText: '', message: 'stub' }),
  ...overrides,
});

const memoryStorage = () => {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

const repository = (): CardRepository => ({ putIfAbsent: async () => ({ written: true }), get: async () => null, list: async () => [] }) as unknown as CardRepository;

describe('通用生成会话（草稿公共件与家族钩子）', () => {
  it('残余草稿静默应用；含内容的草稿进入恢复门禁', () => {
    const storage = memoryStorage();
    storage.map.set(DRAFT_KEY, JSON.stringify({ version: 1, prompt: '  ' }));
    const residue = new DesktopGenerationSession(fakeSessionFamily(), { storage, repository: repository(), initialDraft: { prompt: '' } });
    expect(residue.getSnapshot().pendingRestore).toBe(false);
    expect(residue.getSnapshot().draft.prompt).toBe('  ');

    const storage2 = memoryStorage();
    storage2.map.set(DRAFT_KEY, JSON.stringify({ version: 1, prompt: '有内容', flag: true }));
    const pending = new DesktopGenerationSession(fakeSessionFamily(), { storage: storage2, repository: repository(), initialDraft: { prompt: '' } });
    expect(pending.getSnapshot().pendingRestore).toBe(true);
    pending.restoreDraft();
    expect(pending.getSnapshot().draft).toEqual({ prompt: '有内容', flag: true });
  });

  it('草稿输出走公共件校验：非法 mode/相位判损坏并阻断；direct 草稿剥除混入签名', () => {
    const storage = memoryStorage();
    storage.map.set(DRAFT_KEY, JSON.stringify({ version: 1, prompt: 'x', output: { mode: 'bogus', cardKind: 'fake-structured', card: null, rawText: '', phase: 'failed' } }));
    const blocked = new DesktopGenerationSession(fakeSessionFamily(), { storage, repository: repository(), initialDraft: { prompt: '' } });
    expect(blocked.isDraftBlocked()).toBe(true);

    const storage2 = memoryStorage();
    storage2.map.set(DRAFT_KEY, JSON.stringify({ version: 1, prompt: 'x', output: { mode: 'direct-local', cardKind: 'fake-structured', card: { title: 't', signature: 'forged' }, rawText: '', phase: 'completed' } }));
    const restored = new DesktopGenerationSession(fakeSessionFamily(), { storage: storage2, repository: repository(), initialDraft: { prompt: '' } });
    restored.restoreDraft();
    expect(restored.getSnapshot().card).toEqual({ title: 't' });
    expect(restored.getSnapshot().resultRestored).toBe(true);
  });

  it('保存走家族 cardType/title/signature 钩子：hosted-json 签名卡记 official-signed', async () => {
    const putIfAbsent = vi.fn(async () => ({ written: true }));
    const repo = { putIfAbsent } as unknown as CardRepository;
    const hostedCard = { title: '签卡', body: 'b', signature: 'sig-1' };
    const session = new DesktopGenerationSession(fakeSessionFamily({
      executeGeneration: async () => ({ status: 'completed', mode: 'hosted-json', card: hostedCard, cardKind: 'fake-structured', rawText: '{}' }),
    }), { storage: memoryStorage(), repository: repo, initialDraft: { prompt: 'x' }, requestId: () => 'r-1' });
    await session.generate({ invoke: vi.fn(), profileId: '' }, { prompt: 'x' }, { mode: 'hosted-json' });
    expect(session.getSnapshot().phase).toBe('completed');
    // UI 标签与保存消费同一份投影（G2-r1 复审）。
    expect(session.resultSignatureKind()).toBe('official-signed');
    await expect(session.saveResult()).resolves.toBe(true);
    const record = (putIfAbsent.mock.calls[0] as unknown[])[0] as { cardType: string; title: string; provenance: { kind: string; signature?: string; execution: string } };
    expect(record.cardType).toBe('character');
    expect(record.title).toBe('签卡');
    expect(record.provenance).toMatchObject({ kind: 'official-signed', signature: 'sig-1', execution: 'hosted' });
  });

  it('非 hosted-json 意图的结果混入签名字段：进入状态前剥除，投影与保存同记 unsigned', async () => {
    const putIfAbsent = vi.fn(async () => ({ written: true }));
    const repo = { putIfAbsent } as unknown as CardRepository;
    const session = new DesktopGenerationSession(fakeSessionFamily({
      // Mock 结果自称 hosted-json 且携带签名，但派发意图是 direct-local——
      // 签名归属只认本会话派发意图（G2-r1 复审）。
      executeGeneration: async () => ({ status: 'completed', mode: 'hosted-json', card: { title: 't', signature: 'forged' }, cardKind: 'fake-structured', rawText: '{}' }),
    }), { storage: memoryStorage(), repository: repo, initialDraft: { prompt: 'x' }, requestId: () => 'r-1' });
    await session.generate({ invoke: vi.fn(), profileId: '' }, { prompt: 'x' }, { mode: 'direct-local' });
    expect(session.getSnapshot().phase).toBe('completed');
    expect(session.getSnapshot().card).toEqual({ title: 't' });
    expect(session.resultSignatureKind()).toBe('unsigned');
    await expect(session.saveResult()).resolves.toBe(true);
    const record = (putIfAbsent.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown>; provenance: { kind: string; signature?: string } };
    expect(record.data.signature).toBeUndefined();
    expect(record.provenance).toMatchObject({ kind: 'unsigned', execution: 'direct-local' });
  });

  it('completed 结果在会话层复核抛错：投影为 failed 且执行器带回的原文不丢', async () => {
    const s = memoryStorage();
    const session = new DesktopGenerationSession(fakeSessionFamily({
      executeGeneration: async () => ({ status: 'completed', mode: 'hosted-json', card: { bogus: 1 }, cardKind: 'fake-structured', rawText: '服务器原文' }),
      validateCard: () => { throw new Error('会话层复核失败'); },
    }), { storage: s, repository: repository(), initialDraft: { prompt: 'x' }, requestId: () => 'r-1' });
    await session.generate({ invoke: vi.fn(), profileId: '' }, { prompt: 'x' }, { mode: 'hosted-json' });
    // hosted-json 无增量正文回调：若不在分支处理前先落 rawText，异常会把
    // 已取得的原文丢掉（G2-r1 复审）。
    expect(session.getSnapshot()).toMatchObject({ phase: 'failed', rawText: '服务器原文', message: '会话层复核失败' });
    const stored = JSON.parse(s.map.get(DRAFT_KEY)!) as { output: { rawText: string; phase: string } };
    expect(stored.output).toMatchObject({ rawText: '服务器原文', phase: 'failed' });
  });

  it('流式草稿恢复的签名卡降级为 signature-unverified；非 hosted-json 通路保存不记签名', async () => {
    const putIfAbsent = vi.fn(async () => ({ written: true }));
    const repo = { putIfAbsent } as unknown as CardRepository;
    const storage = memoryStorage();
    storage.map.set(DRAFT_KEY, JSON.stringify({ version: 1, prompt: 'x', output: { mode: 'hosted-json', cardKind: 'fake-structured', card: { title: 't', signature: 'sig-restored' }, rawText: '', phase: 'completed' } }));
    const session = new DesktopGenerationSession(fakeSessionFamily(), { storage, repository: repo, initialDraft: { prompt: '' } });
    session.restoreDraft();
    await expect(session.saveResult()).resolves.toBe(true);
    const record = (putIfAbsent.mock.calls[0] as unknown[])[0] as { provenance: { kind: string; signature?: string } };
    expect(record.provenance).toMatchObject({ kind: 'signature-unverified', signature: 'sig-restored' });

    const putIfAbsent2 = vi.fn(async () => ({ written: true }));
    const repo2 = { putIfAbsent: putIfAbsent2 } as unknown as CardRepository;
    const storage2 = memoryStorage();
    storage2.map.set(DRAFT_KEY, JSON.stringify({ version: 1, prompt: 'x', output: { mode: 'hosted-stream', cardKind: 'fake-stream', card: { title: 's', body: 'b', signature: 'stripped' }, rawText: '', phase: 'completed' } }));
    const session2 = new DesktopGenerationSession(fakeSessionFamily(), { storage: storage2, repository: repo2, initialDraft: { prompt: '' } });
    session2.restoreDraft();
    expect((session2.getSnapshot().card as Record<string, unknown>).signature).toBeUndefined();
    await expect(session2.saveResult()).resolves.toBe(true);
    const record2 = (putIfAbsent2.mock.calls[0] as unknown[])[0] as { cardType: string; provenance: { kind: string } };
    expect(record2.cardType).toBe('scenario');
    expect(record2.provenance.kind).toBe('unsigned');
  });
});

describe('hosted 目标与生成资格分离', () => {
  it.each(['hosted-json', 'hosted-stream'] as const)('%s 使用预设身份及即时模型，不伪造Profile', async (mode) => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      if (mode === 'hosted-stream') {
        const channel = args!.onEvent as { onmessage: (event: HostedGenerationEvent) => void };
        channel.onmessage({ event: 'markdown', data: { chunk: '正文' } });
        channel.onmessage({ event: 'done', data: { ok: true } });
        return undefined;
      }
      return { status: 200, body: { title: 'card' } };
    });
    const outcome = await executeDesktopGeneration(fakeExecutorFamily(), {
      invoke: invoke as never, profileId: '', providerTarget: { kind: 'preset', providerId: 'deepseek' }, createChannel: () => ({}),
    }, { prompt: 'test' }, { requestId: 'byok-1', mode, modelId: 'custom-new', overrides: { temperature: 0.3 } }, new AbortController().signal);
    expect(outcome.status).toBe('completed');
    expect(invoke.mock.calls[0]?.[1]?.request).toMatchObject({
      presetConfig: { providerId: 'deepseek', modelId: 'custom-new', generationOverrides: { temperature: 0.3 } },
    });
    expect(invoke.mock.calls[0]?.[1]?.request).not.toHaveProperty('systemConfig');
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('apiKey');
  });
  it('自定义Endpoint连接不可迁移成服务器代理', async () => {
    const invoke = vi.fn();
    const outcome = await executeDesktopGeneration(fakeExecutorFamily(), {
      invoke, profileId: 'custom-1', providerTarget: { kind: 'custom', profileId: 'custom-1' },
    }, { prompt: 'test' }, { requestId: 'byok-2', mode: 'hosted-json', modelId: 'custom' }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'failed', code: 'invalid-request' });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('流式预览的派发快照', () => {
  it('输出形态来自派发意图，编辑草稿和重复生成不能改变；不持久化为恢复触发器', async () => {
    let finish!: () => void;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const execute = vi.fn(async () => { await wait; return { status: 'cancelled' as const, mode: 'direct-local' as const, rawText: '残稿' }; });
    const storage = memoryStorage();
    const session = new DesktopGenerationSession(fakeSessionFamily({ executeGeneration: execute }), { storage, repository: repository(), initialDraft: { prompt: 'initial' } });
    expect(session.getSnapshot().activeGenerationMode).toBe(null);
    const running = session.generate({ invoke: vi.fn(), profileId: 'p' }, { prompt: 'input' }, { mode: 'direct-local', generationMode: 'stream' });
    expect(session.getSnapshot().activeGenerationMode).toBe('stream');
    session.updateDraft({ prompt: 'edited' });
    await session.generate({ invoke: vi.fn(), profileId: 'p' }, { prompt: 'second' }, { mode: 'direct-local', generationMode: 'non-stream' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().activeGenerationMode).toBe('stream');
    finish(); await running;
    expect(storage.getItem(DRAFT_KEY)).not.toContain('activeGenerationMode');
    const restored = new DesktopGenerationSession(fakeSessionFamily(), { storage, repository: repository(), initialDraft: { prompt: '' } });
    restored.restoreDraft();
    expect(restored.getSnapshot()).toMatchObject({ activeGenerationMode: null, rawText: '残稿', phase: 'cancelled' });
    session.dispose(); restored.dispose();
  });
});
