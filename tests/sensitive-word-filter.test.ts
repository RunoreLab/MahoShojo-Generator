import { quickCheck } from '@/lib/sensitive-word-filter';

describe('sensitive-word-filter（繁体/拼音/去符号绕过）', () => {
  it('应能识别繁体字变体（繁转简后命中）', async () => {
    const result = await quickCheck('我来自中華帝國。');
    expect(result.hasSensitiveWords).toBe(true);
    expect(result.matchDetails.some((d) => d.word.includes('中华帝国'))).toBe(true);
  });

  it('应能识别插入符号的绕过（去符号后命中）', async () => {
    const result = await quickCheck('我来自中-华-帝-国。');
    expect(result.hasSensitiveWords).toBe(true);
    expect(result.matchDetails.some((d) => d.matchType === 'variant')).toBe(true);
  });

  it('应能识别纯拼音绕过（falungong/zhonghuadiguo 等）', async () => {
    const result = await quickCheck('wo lai zi zhong hua di guo');
    expect(result.hasSensitiveWords).toBe(true);
    expect(result.detectedWords.some((w) => w.includes('(拼音)'))).toBe(true);
  });
});

