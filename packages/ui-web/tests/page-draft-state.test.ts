// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPageDraft, readPageDraftState, writePageDraft } from '../src/client/pageDraft';

const key = 'read-state-test';
const options = { version: 1, ttlMs: 1000 };
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
describe('非破坏页面草稿读取', () => {
  it('区分缺失与合法草稿', () => {
    expect(readPageDraftState(key, options)).toEqual({ kind: 'missing' });
    const stored = writePageDraft(key, { field: 'draft' }, options);
    expect(readPageDraftState(key, options)).toEqual({ kind: 'ready', stored });
  });
  it.each([
    ['{broken', 'invalid'],
    ['', 'invalid'],
    [JSON.stringify({ version: 99, updatedAt: Date.now(), payload: { future: true } }), 'version-mismatch'],
    [JSON.stringify({ version: 1, updatedAt: 1, payload: { old: true } }), 'expired'],
    [JSON.stringify({ version: 1, updatedAt: 'yesterday', payload: {} }), 'invalid'],
  ])('保留原始字节：%s', (raw, reason) => {
    localStorage.setItem(key, raw);
    expect(readPageDraftState(key, options)).toEqual({ kind: 'blocked', reason });
    expect(localStorage.getItem(key)).toBe(raw);
  });
  it('读取/显式删除失败都不静默改写存储', () => {
    localStorage.setItem(key, '{keep');
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readPageDraftState(key, options)).toEqual({ kind: 'blocked', reason: 'read-failed' });
    read.mockRestore();
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(clearPageDraft(key)).toBe(false);
    expect(localStorage.getItem(key)).toBe('{keep');
    remove.mockRestore();
    expect(clearPageDraft(key)).toBe(true);
    expect(readPageDraftState(key, options)).toEqual({ kind: 'missing' });
  });
});
