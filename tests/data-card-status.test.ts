import { describe, expect, test } from 'bun:test';

import { getDataCardStatus, getDataCardVisibilityValue, isDataCardBanned } from '@/lib/data-card-status';

describe('data-card-status', () => {
  test('兼容 snake_case 与 camelCase 的可见性字段', () => {
    expect(getDataCardStatus({ is_public: 1 }).status).toBe('public');
    expect(getDataCardStatus({ isPublic: 1 }).status).toBe('public');
    expect(getDataCardStatus({ _isPublic: 1 }).status).toBe('public');
    expect(getDataCardStatus({ isPublic: true }).status).toBe('public');
    expect(getDataCardStatus({ is_public: 0 }).status).toBe('private');
    expect(getDataCardStatus({ is_public: -1 }).status).toBe('banned');
    expect(getDataCardStatus({ _isPublic: -1 }).status).toBe('banned');
  });

  test('封禁判定支持 camel/snake 双输入并保持三态语义', () => {
    expect(isDataCardBanned({ is_public: -1 })).toBe(true);
    expect(isDataCardBanned({ isPublic: -1 })).toBe(true);
    expect(isDataCardBanned({ _isPublic: -1 })).toBe(true);
    expect(isDataCardBanned({ isPublic: true })).toBe(false);
    expect(isDataCardBanned({ is_public: 1 })).toBe(false);
  });

  test('空输入降级为私有状态且不报错', () => {
    expect(getDataCardStatus(null).status).toBe('private');
    expect(getDataCardStatus(undefined).status).toBe('private');
    expect(isDataCardBanned(null)).toBe(false);
  });

  test('getDataCardVisibilityValue 输出 canonical -1/0/1', () => {
    expect(getDataCardVisibilityValue({ is_public: -1 })).toBe(-1);
    expect(getDataCardVisibilityValue({ isPublic: 1 })).toBe(1);
    expect(getDataCardVisibilityValue({ isPublic: true })).toBe(1);
    expect(getDataCardVisibilityValue({ _isPublic: -1 })).toBe(-1);
    expect(getDataCardVisibilityValue({ _isPublic: false })).toBe(0);
    expect(getDataCardVisibilityValue({})).toBe(0);
  });
});
