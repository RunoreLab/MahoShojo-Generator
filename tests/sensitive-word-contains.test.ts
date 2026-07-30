import { describe, expect, test } from 'vitest';

import { containsSensitiveWord, quickCheck, SensitiveWordFilter } from '@/lib/sensitive-word-filter';

describe('containsSensitiveWord', () => {
  test.each([
    ['普通文本', false],
    ['大陆官方', true],
    ['访问 Pornhub', true],
    ['大-陆-官-方', true],
    ['daluguanfang', true],
  ])('与完整扫描对 %s 的布尔结果一致', async (text, expected) => {
    const fullResult = await quickCheck(text);

    expect(fullResult.hasSensitiveWords).toBe(expected);
    await expect(containsSensitiveWord(text)).resolves.toBe(fullResult.hasSensitiveWords);
  });

  test('布尔路径不调用会扫描全文并分配匹配数组的 FindAll', async () => {
    const filter = new SensitiveWordFilter();
    await filter.containsSensitiveWord('初始化');
    const internal = filter as any;
    internal.plainSearch.FindAll = () => {
      throw new Error('FindAll must not be used');
    };
    internal.pinyinSearch.FindAll = () => {
      throw new Error('FindAll must not be used');
    };

    await expect(filter.containsSensitiveWord('大陆官方'.repeat(10_000))).resolves.toBe(true);
    await expect(filter.containsSensitiveWord('daluguanfang')).resolves.toBe(true);
  });
});
