import { describe, expect, it, vi } from 'vitest';
import {
  createAutoReviewBackend,
  createAutoReviewEngine,
  orderBackendEntries,
  parseAutoReviewConfig,
  resolveAutoReviewThresholds,
  resolveUncertainAction,
  type AutoReviewProviderEntry,
} from '../src/auto-review';
import { AUTO_REVIEW_JEV_QUESTIONS_V2 } from '../src/auto-review/question-set';

const target = { id: 'card-1', name: '测试卡', description: '简介', data: '{"k":"v"}' };

const jevEntry = (over: Record<string, unknown> = {}): AutoReviewProviderEntry =>
  ({
    id: 'jev-1',
    kind: 'jev-decisions',
    endpoint: 'workers-ai',
    accountId: 'acct',
    apiKey: 'key',
    model: 'clef-flash',
    ...over,
  }) as AutoReviewProviderEntry;

/** v2 问题集全 key 答案（9 个 noul 题）；校验是严格的，缺一题即后端失败。 */
const fullAnswers = (over: Record<string, number> = {}): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const key of Object.keys(AUTO_REVIEW_JEV_QUESTIONS_V2)) out[key] = 0.05;
  out.should_pass = 0.95;
  return { ...out, ...over };
};

const jevResponse = (answers: Record<string, number>) =>
  new Response(JSON.stringify({ result: { answers } }), { status: 200 });

describe('parseAutoReviewConfig', () => {
  it('空配置回退默认值且无诊断', () => {
    const c = parseAutoReviewConfig({});
    expect(c.providers).toEqual([]);
    expect(c.routing.strategy).toBe('priority');
    expect(c.policy).toEqual({ onUncertain: 'normal', exemptUserPolicy: 'skip', notifyOnAutoReject: true });
    expect(c.errors).toEqual([]);
  });

  it('解析 providers/routing/policy', () => {
    const c = parseAutoReviewConfig({
      AI_REVIEW_PROVIDERS_CONFIG: JSON.stringify([jevEntry()]),
      AI_REVIEW_ROUTING: JSON.stringify({ strategy: 'weighted-random' }),
      AI_REVIEW_POLICY: JSON.stringify({ onUncertain: 'hold', exemptUserPolicy: 'review', notifyOnAutoReject: false }),
    });
    expect(c.providers).toHaveLength(1);
    expect(c.providers[0].id).toBe('jev-1');
    expect(c.routing.strategy).toBe('weighted-random');
    expect(c.policy).toEqual({ onUncertain: 'hold', exemptUserPolicy: 'review', notifyOnAutoReject: false });
    expect(c.errors).toEqual([]);
  });

  it('非法 JSON：回退默认且记入 errors（不再静默）', () => {
    const c = parseAutoReviewConfig({
      AI_REVIEW_PROVIDERS_CONFIG: '{bad json',
      AI_REVIEW_ROUTING: '{"strategy":"nope"}',
    });
    expect(c.providers).toEqual([]);
    expect(c.routing.strategy).toBe('priority');
    expect(c.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('非法条目单独剔除并诊断，合法条目保留', () => {
    const c = parseAutoReviewConfig({
      AI_REVIEW_PROVIDERS_CONFIG: JSON.stringify([
        jevEntry(),
        { id: 'bad', kind: 'omni-moderation' }, // 缺 baseUrl
      ]),
    });
    expect(c.providers).toHaveLength(1);
    expect(c.errors.some((e) => e.includes('bad') || e.includes('[1]'))).toBe(true);
  });

  it('重复 id / workers-ai 缺凭据 / 非法 URL / unknown 字段均入 errors', () => {
    const c = parseAutoReviewConfig({
      AI_REVIEW_PROVIDERS_CONFIG: JSON.stringify([
        jevEntry(),
        jevEntry(), // duplicate id
        { id: 'w', kind: 'jev-decisions', endpoint: 'workers-ai', model: 'clef-flash' }, // 缺 accountId/apiKey
        { id: 'u', kind: 'omni-moderation', baseUrl: 'ftp://x', model: 'm' }, // 非 http(s)
        { id: 'x', kind: 'llm', surpriseField: 1 }, // unknown field
      ]),
    });
    expect(c.providers).toHaveLength(1);
    expect(c.errors.join('\n')).toMatch(/duplicate id "jev-1"/);
    expect(c.errors.join('\n')).toMatch(/accountId/);
    expect(c.errors.join('\n')).toMatch(/baseUrl/);
    expect(c.errors.join('\n')).toMatch(/surpriseField|Unrecognized/);
  });
});

describe('resolveAutoReviewThresholds', () => {
  it('clef-flash 命中实测登记值', () => {
    expect(resolveAutoReviewThresholds(jevEntry())).toMatchObject({ rejectAt: 0.5, approveBelow: 0.2 });
  });
  it('条目内 thresholds 覆盖默认值', () => {
    const t = resolveAutoReviewThresholds(jevEntry({ thresholds: { rejectAt: 0.8 } }));
    expect(t.rejectAt).toBe(0.8);
    expect(t.approveBelow).toBe(0.2);
  });
  it('mercury 登记 overall veto', () => {
    const t = resolveAutoReviewThresholds(jevEntry({ model: 'inception/mercury-decide' }));
    expect(t.useOverallVeto).toBe(true);
    expect(t.catVetoAt).toBe(0.7);
  });
});

describe('resolveUncertainAction', () => {
  it('normal：豁免通过、普通留 pending', () => {
    expect(resolveUncertainAction('normal', true)).toBe('approve');
    expect(resolveUncertainAction('normal', false)).toBe('pending');
  });
  it('hold/approve/reject 固定动作', () => {
    expect(resolveUncertainAction('hold', true)).toBe('pending');
    expect(resolveUncertainAction('approve', false)).toBe('approve');
    expect(resolveUncertainAction('reject', true)).toBe('reject');
  });
});

describe('jev-decisions backend', () => {
  it('分类分超阈值 → reject 并映射类目', async () => {
    const fetchImpl = vi.fn(async () => jevResponse(fullAnswers({ v_sexual: 0.9, should_pass: 0.1 })));
    const backend = createAutoReviewBackend(jevEntry(), { fetch: fetchImpl });
    const out = await backend.review(target);
    expect(out.verdict).toBe('reject');
    expect(out.category).toBe('sexual');
    expect(out.score).toBeCloseTo(0.9);
    expect(out.reason).toContain('性内容');
    expect(out.inputCoverage).toEqual({ truncated: false, parseError: false });
    // workers-ai URL 组装
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/accounts/acct/ai/run/@cf/cloudflare/clef-flash');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key');
  });

  it('全部低分 → approve', async () => {
    const backend = createAutoReviewBackend(jevEntry(), {
      fetch: vi.fn(async () => jevResponse(fullAnswers())),
    });
    expect((await backend.review(target)).verdict).toBe('approve');
  });

  it('中间灰分 → uncertain', async () => {
    const backend = createAutoReviewBackend(jevEntry(), {
      fetch: vi.fn(async () => jevResponse(fullAnswers({ v_sexual: 0.3, v_overall: 0.3, should_pass: 0.6 }))),
    });
    expect((await backend.review(target)).verdict).toBe('uncertain');
  });

  it('mercury 登记口径：overall veto 触发 reject', async () => {
    const backend = createAutoReviewBackend(jevEntry({ model: 'inception/mercury-decide' }), {
      fetch: vi.fn(async () => jevResponse(fullAnswers({ v_overall: 0.8, v_sexual: 0.1 }))),
    });
    expect((await backend.review(target)).verdict).toBe('reject');
  });

  it('只回 1/9 题 → 响应不完整抛错（缺数据≠安全）', async () => {
    const backend = createAutoReviewBackend(jevEntry(), {
      fetch: vi.fn(async () => jevResponse({ v_sexual: 0.01 })),
    });
    await expect(backend.review(target)).rejects.toThrow('missing or invalid');
  });

  it.each([NaN, -0.1, 1.5, 'high'])('answer=%s 非法 → 抛错', async (bad) => {
    const backend = createAutoReviewBackend(jevEntry(), {
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ result: { answers: fullAnswers({ v_hate: bad as number }) } })),
      ),
    });
    await expect(backend.review(target)).rejects.toThrow('missing or invalid');
  });

  it('HTTP 错误抛出异常（由引擎回退）', async () => {
    const backend = createAutoReviewBackend(jevEntry(), {
      fetch: vi.fn(async () => new Response('{}', { status: 500 })),
    });
    await expect(backend.review(target)).rejects.toThrow('jev-decisions 500');
  });

  it('options.signal 透传给 fetch', async () => {
    const fetchImpl = vi.fn(async () => jevResponse(fullAnswers()));
    const backend = createAutoReviewBackend(jevEntry(), { fetch: fetchImpl });
    const controller = new AbortController();
    await backend.review(target, { signal: controller.signal });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});

describe('omni-moderation backend', () => {
  const entry: AutoReviewProviderEntry = {
    id: 'omni', kind: 'omni-moderation', baseUrl: 'https://api.openai.com/v1',
    apiKey: 'k', model: 'omni-moderation-latest',
  } as AutoReviewProviderEntry;

  it('flagged → reject', async () => {
    const backend = createAutoReviewBackend(entry, {
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({
          results: [{ flagged: true, categories: { sexual: true }, category_scores: { sexual: 0.9, hate: 0.01 } }],
        })),
      ),
    });
    const out = await backend.review(target);
    expect(out.verdict).toBe('reject');
    expect(out.category).toBe('sexual');
  });

  it('未 flagged 且低分 → approve', async () => {
    const backend = createAutoReviewBackend(entry, {
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ results: [{ flagged: false, categories: {}, category_scores: { hate: 0.01 } }] })),
      ),
    });
    expect((await backend.review(target)).verdict).toBe('approve');
  });

  it.each([
    ['缺 flagged', { categories: {}, category_scores: {} }],
    ['flagged 非布尔', { flagged: 'yes', categories: {}, category_scores: {} }],
    ['缺 category_scores', { flagged: false, categories: {} }],
    ['score 越界', { flagged: false, categories: {}, category_scores: { hate: 2 } }],
    ['score NaN', { flagged: false, categories: {}, category_scores: { hate: NaN } }],
  ])('wire shape 非法（%s）→ 抛错', async (_label, result) => {
    const backend = createAutoReviewBackend(entry, {
      fetch: vi.fn(async () => new Response(JSON.stringify({ results: [result] }), { status: 200 })),
    });
    await expect(backend.review(target)).rejects.toThrow('invalid response shape');
  });
});

describe('nemotron backend', () => {
  const entry: AutoReviewProviderEntry = {
    id: 'nemo', kind: 'nemotron', baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKey: 'k', model: 'nvidia/nemotron-3.5-content-safety',
  } as AutoReviewProviderEntry;
  const chat = (content: string) =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }));

  it('unsafe → reject 并映射类目', async () => {
    const backend = createAutoReviewBackend(entry, {
      fetch: vi.fn(async () => chat('User Safety: unsafe\nSafety Categories: Sexual Content')),
    });
    const out = await backend.review(target);
    expect(out.verdict).toBe('reject');
    expect(out.category).toBe('sexual');
  });

  it('safe → approve', async () => {
    const backend = createAutoReviewBackend(entry, { fetch: vi.fn(async () => chat('User Safety: safe')) });
    expect((await backend.review(target)).verdict).toBe('approve');
  });

  it('JSON 结构化输出优先解析', async () => {
    const backend = createAutoReviewBackend(entry, {
      fetch: vi.fn(async () =>
        chat(JSON.stringify({ 'User Safety': 'unsafe', 'Safety Categories': ['Hate Speech'] })),
      ),
    });
    const out = await backend.review(target);
    expect(out.verdict).toBe('reject');
    expect(out.category).toBe('hate');
  });

  it('解析失败抛异常', async () => {
    const backend = createAutoReviewBackend(entry, { fetch: vi.fn(async () => chat('???')) });
    await expect(backend.review(target)).rejects.toThrow('unparseable');
  });
});

describe('llm backend', () => {
  it('generate 结果映射 verdict/categories，abortSignal 透传', async () => {
    const generate = vi.fn(async () => ({
      reviews: [{ id: 'card-1', verdict: 'rejected', violationScore: 0.9, categories: ['sexual'], reason: '露骨性描写' }],
    }));
    const backend = createAutoReviewBackend(
      { id: 'llm', kind: 'llm', modelOverride: 'm1' } as AutoReviewProviderEntry,
      { generate },
    );
    const controller = new AbortController();
    const out = await backend.review(target, { signal: controller.signal });
    expect(out.verdict).toBe('reject');
    expect(out.category).toBe('sexual');
    expect(generate).toHaveBeenCalledOnce();
    expect((generate.mock.calls[0] as unknown[])[2]).toMatchObject({ abortSignal: controller.signal });
  });

  it('缺目标 review 抛异常', async () => {
    const backend = createAutoReviewBackend({ id: 'llm', kind: 'llm' } as AutoReviewProviderEntry, {
      generate: vi.fn(async () => ({ reviews: [] })),
    });
    await expect(backend.review(target)).rejects.toThrow('missing review');
  });
});

describe('engine routing', () => {
  it('priority：首个后端优先', async () => {
    const fetchImpl = vi.fn(async () => jevResponse(fullAnswers()));
    const engine = createAutoReviewEngine(
      [jevEntry({ id: 'a' }), jevEntry({ id: 'b' })],
      { fetch: fetchImpl, strategy: 'priority' },
    );
    const r = await engine.review(target);
    expect(r.backendId).toBe('a');
    expect(r.attempted).toEqual(['a']);
  });

  it('首个失败 → 回退下一后端', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response('{}', { status: 503 }) : jevResponse(fullAnswers({ v_sexual: 0.9, should_pass: 0.1 }));
    });
    const engine = createAutoReviewEngine([jevEntry({ id: 'a' }), jevEntry({ id: 'b' })], {
      fetch: fetchImpl, strategy: 'priority',
    });
    const r = await engine.review(target);
    expect(r.backendId).toBe('b');
    expect(r.attempted).toEqual(['a', 'b']);
    expect(r.outcome.verdict).toBe('reject');
  });

  it('全部失败 → uncertain（fail-closed）', async () => {
    const engine = createAutoReviewEngine([jevEntry({ id: 'a' })], {
      fetch: vi.fn(async () => new Response('{}', { status: 500 })),
      strategy: 'priority',
    });
    const r = await engine.review(target);
    expect(r.outcome.verdict).toBe('uncertain');
  });

  it('weighted-random：权重决定首个后端', () => {
    const entries = [jevEntry({ id: 'a', weight: 1 }), jevEntry({ id: 'b', weight: 9 })];
    const rngHigh = orderBackendEntries(entries, 'weighted-random', () => 0.99);
    expect(rngHigh[0].id).toBe('b');
    const rngLow = orderBackendEntries(entries, 'weighted-random', () => 0.01);
    expect(rngLow[0].id).toBe('a');
  });
});

describe('engine 输入覆盖门禁', () => {
  it('data 非法 JSON → 直接 uncertain，不调用后端', async () => {
    const fetchImpl = vi.fn();
    const engine = createAutoReviewEngine([jevEntry()], { fetch: fetchImpl });
    const r = await engine.review({ ...target, data: '{not json' });
    expect(r.outcome.verdict).toBe('uncertain');
    expect(r.inputCoverage.parseError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('输入被截断 → approve 降级 uncertain；reject 仍可落地', async () => {
    const bigTarget = { ...target, data: JSON.stringify({ f: 'x'.repeat(500) }) };
    const approveEngine = createAutoReviewEngine([jevEntry()], {
      fetch: vi.fn(async () => jevResponse(fullAnswers())),
    });
    const r1 = await approveEngine.review(bigTarget);
    expect(r1.inputCoverage.truncated).toBe(true);
    expect(r1.outcome.verdict).toBe('uncertain');

    const rejectEngine = createAutoReviewEngine([jevEntry()], {
      fetch: vi.fn(async () => jevResponse(fullAnswers({ v_gore: 0.95, should_pass: 0.05 }))),
    });
    const r2 = await rejectEngine.review(bigTarget);
    expect(r2.inputCoverage.truncated).toBe(true);
    expect(r2.outcome.verdict).toBe('reject');
  });

  it('超时中止底层请求（AbortSignal 传递）', async () => {
    let observedAbort = false;
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            observedAbort = true;
            reject(new Error('aborted'));
          });
        }),
    );
    const engine = createAutoReviewEngine([jevEntry({ timeoutMs: 20 })], { fetch: fetchImpl as never });
    const r = await engine.review(target);
    expect(r.outcome.verdict).toBe('uncertain');
    expect(observedAbort).toBe(true);
  });
});
