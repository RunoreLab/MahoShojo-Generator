import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiReviewPanel } from '../src/client/ai-review-panel';
import { OperationFeedback } from '../src/client/operation-feedback';
import { decisionItem, initialReviewDecision, reviewContextMatches, reviewTarget, submitReviewOperation, type ReviewContext } from '../src/client/ai-review-model';
import { savedOperations, saveOperation } from '../src/client/ui-model';
const version = 'a'.repeat(64), cardVersion = 'b'.repeat(64);
const row = { id: 'update', data_card_id: 'card', expectedVersion: version, cardVersion };
const context: ReviewContext = { id: 'update:update', kind: 'update', targetId: 'update', name: '测试更新', expectedVersion: version, cardId: 'card', cardVersion,
  coverage: { contentTruncated: false, contentParseError: false } };
afterEach(() => vi.unstubAllGlobals());
describe('AI 人工审核闭环', () => {
  it('待审更新同时冻结父卡版本，缺版本拒绝提交', () => {
    expect(reviewTarget('data-card-updates', row)).toEqual({ kind: 'update', id: 'update', expectedVersion: version, cardId: 'card', cardVersion });
    expect(() => reviewTarget('data-card-updates', { ...row, cardVersion: undefined })).toThrow();
    expect(decisionItem(context, row, 'rejected')).toEqual({ id: 'update', expectedVersion: version, cardId: 'card', cardVersion, decision: 'rejected' });
  });
  it('仅完整且匹配的通过建议预填，拒绝与历史／变化／截断留空', () => {
    expect(initialReviewDecision('approved', context, row)).toBe('approved');
    expect(initialReviewDecision('rejected', context, row)).toBe('');
    expect(initialReviewDecision('approved', undefined, row)).toBe('');
    expect(initialReviewDecision('approved', context, { ...row, cardVersion: version })).toBe('');
    expect(initialReviewDecision('approved', { ...context, coverage: { contentTruncated: true, contentParseError: false } }, row)).toBe('');
    expect(reviewContextMatches(context, { ...row, id: 'other' })).toBe(false);
  });
  it('密钥只进入单次请求，不进入本地恢复状态或指纹，未知结果禁止重发', async () => {
    const memory = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    const fetcher = vi.fn().mockRejectedValue(new Error('disconnect')); vi.stubGlobal('fetch', fetcher);
    const payload = { targets: [reviewTarget('data-card-updates', row)], selection: { providerId: 'deepseek', modelId: 'deepseek-chat' }, reason: '辅助审核' };
    const action = { name: 'ai.review', label: 'AI审核' };
    await expect(submitReviewOperation('admin', action, payload, 'fixture-key-one')).rejects.toThrow('disconnect');
    expect(String(fetcher.mock.calls[0][1].body)).toContain('fixture-key-one');
    const saved = savedOperations('admin')[0]; expect(saved.state).toBe('unknown');
    expect([...memory.values()].join('')).not.toContain('fixture-key');
    await expect(submitReviewOperation('admin', action, payload, 'fixture-key-two')).rejects.toThrow('已有提交记录');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(submitReviewOperation('admin', action, { ...payload, apiKey: 'secret' })).rejects.toThrow('凭据');
    await expect(submitReviewOperation('admin', action, { reason: 'opaque"key' }, 'opaque"key')).rejects.toThrow('只能填写');
  });
  it('本地存储失败时不产生付费请求', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('denied'); } });
    await expect(submitReviewOperation('admin', { name: 'ai.review', label: 'AI' }, { reason: 'test' }, 'key')).rejects.toThrow('denied');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('明确创建新请求前核实服务端终态，uncertain 仍不得重放', async () => {
    const memory = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) });
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    let status = 'uncertain'; let posts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts++; return Response.json({ status: 'succeeded', result: { jobId: 'job' } }); }
      return Response.json(url.includes('operation?') ? { result: { jobId: 'job' } } : { items: [{ id: 'job', status }] });
    }));
    const action = { name: 'ai.review', label: 'AI' }, payload = { reason: '同一范围' };
    await submitReviewOperation('admin', action, payload, 'key');
    await expect(submitReviewOperation('admin', action, payload, 'key', true)).rejects.toThrow('结果不确定');
    expect(posts).toBe(1); status = 'succeeded';
    await submitReviewOperation('admin', action, payload, 'key', true); expect(posts).toBe(2);
    const latest = savedOperations('admin').at(-1)!;
    const oldest = savedOperations('admin')[0]; saveOperation('admin', { ...oldest, state: 'succeeded' });
    expect(savedOperations('admin').at(-1)!.key).toBe(latest.key);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts++; return Response.json({}); }
      if (url.includes('operation?')) return Response.json({ result: { jobId: url.includes(latest.key) ? 'latest' : 'old' } });
      return Response.json({ items: [{ id: 'latest', status: 'uncertain' }, { id: 'old', status: 'succeeded' }] });
    }));
    await expect(submitReviewOperation('admin', action, payload, 'key', true)).rejects.toThrow('结果不确定');
    expect(posts).toBe(2);
  });
  it('统一选择器包括系统渠道，恶意名称按文本渲染', () => {
    const html = renderToStaticMarkup(createElement(AiReviewPanel, { resource: 'data-cards', rows: [{ id: 'card', name: '<img src=x onerror=alert(1)>' }], principalId: 'admin', actions: [], close: () => {} }));
    expect(html).toContain('使用系统默认配置'); expect(html).toContain('&lt;img'); expect(html).not.toContain('<img');
  });
  it('批量反馈按目标展示成功与冲突，不把部分结果当作全部成功', () => {
    const html = renderToStaticMarkup(createElement(OperationFeedback, { targets: ['<script>target</script>', '第二项'], outcome: { status: 'batch', items: [
      { status: 'succeeded', result: { decision: 'approved' } }, { status: 'conflict', result: null },
    ] } }));
    expect(html).toContain('不能视为全部完成'); expect(html).toContain('冲突目标未修改');
    expect(html).toContain('&lt;script&gt;target'); expect(html).not.toContain('<script>');
  });
});
