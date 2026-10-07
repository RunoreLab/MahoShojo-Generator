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

const jevResponse = (answers: Record<string, number>) =>
  new Response(JSON.stringify({ result: { answers } }), { status: 200 });

describe('parseAutoReviewConfig', () => {
  it('空配置回退默认值', () => {
    const c = parseAutoReviewConfig({});
    expect(c.providers).toEqual([]);
    expect(c.routing.strategy).toBe('priority');
    expect(c.policy).toEqual({ onUncertain: 'normal', exemptUserPolicy: 'skip', notifyOnAutoReject: true });
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
  });

  it('非法 JSON 静默回退', () => {
    const c = parseAutoReviewConfig({
      AI_REVIEW_PROVIDERS_CONFIG: '{bad json',
      AI_REVIEW_ROUTING: '{"strategy":"nope"}',
    });
    expect(c.providers).toEqual([]);
    expect(c.routing.strategy).toBe('priority');
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
    const fetchImpl = vi.fn(async () => jevResponse({ v_sexual: 0.9, v_overall: 0.4, should_pass: 0.2 }));
    const backend = createAutoReviewBackend(jevEntry(), { fetch: fetchImpl });
    const out = await backend.review(target);
    expect(out.verdict).toBe('reject');
    expect(out.category).toBe('sexual');
    expect(out.score).toBeCloseTo(0.9);
    expect(out.reason).toContain('性内容');
    // workers-ai URL 组装
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/accounts/acct/ai/run/@cf/cloudflare/clef-flash');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key');
  });

  it('全部低分 → approve', async () => {
    const backend = createAutoReviewBackend(jevEntry(), {
      fetch: vi.fn(async () => jevResponse({ v_sexual: 0.01, v_overall: 0.05, should_pass: 0.95 })),
    });
    expect((await backend.review(target)).verdict).toBe('approve');
  });

  it('中间灰分 → uncertain', async () => {
    const backend = createAutoReviewBackend(jevEntry(), {
      fetch: vi.fn(async () => jevResponse({ v_sexual: 0.3, v_overall: 0.3, should_pass: 0.6 })),
    });
    expect((await backend.review(target)).verdict).toBe('uncertain');
  });

  it('mercury 登记口径：overall veto 触发 reject', async () => {
    const backend = createAutoReviewBackend(jevEntry({ model: 'inception/mercury-decide' }), {
      fetch: vi.fn(async () => jevResponse({ v_overall: 0.8, v_sexual: 0.1 })),
    });
    expect((await backend.review(target)).verdict).toBe('reject');
  });

  it('HTTP 错误抛出异常（由引擎回退）', async () => {
    const backend = createAutoReviewBackend(jevEntry(), {
      fetch: vi.fn(async () => new Response('{}', { status: 500 })),
    });
    await expect(backend.review(target)).rejects.toThrow('jev-decisions 500');
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

  it('解析失败抛异常', async () => {
    const backend = createAutoReviewBackend(entry, { fetch: vi.fn(async () => chat('???')) });
    await expect(backend.review(target)).rejects.toThrow('unparseable');
  });
});

describe('llm backend', () => {
  it('generate 结果映射 verdict/categories', async () => {
    const generate = vi.fn(async () => ({
      reviews: [{ id: 'card-1', verdict: 'rejected', violationScore: 0.9, categories: ['sexual'], reason: '露骨性描写' }],
    }));
    const backend = createAutoReviewBackend(
      { id: 'llm', kind: 'llm', modelOverride: 'm1' } as AutoReviewProviderEntry,
      { generate },
    );
    const out = await backend.review(target);
    expect(out.verdict).toBe('reject');
    expect(out.category).toBe('sexual');
    expect(generate).toHaveBeenCalledOnce();
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
    const fetchImpl = vi.fn(async () => jevResponse({ v_sexual: 0.01, should_pass: 0.9 }));
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
      return calls === 1 ? new Response('{}', { status: 503 }) : jevResponse({ v_sexual: 0.9 });
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
