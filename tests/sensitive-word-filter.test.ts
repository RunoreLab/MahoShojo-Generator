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

  it('应能识别中文分隔符绕过（丨）', async () => {
    const result = await quickCheck('我来自中丨华丨帝丨国。');
    expect(result.hasSensitiveWords).toBe(true);
    expect(result.matchDetails.some((d) => d.matchType === 'variant')).toBe(true);
  });

  it('应能识别偏旁部首分隔绕过（艹）', async () => {
    const result = await quickCheck('我来自中亻华亻帝亻国。');
    expect(result.hasSensitiveWords).toBe(true);
    expect(result.matchDetails.some((d) => d.matchType === 'variant')).toBe(true);
  });

  it('应能识别纯拼音绕过（falungong/zhonghuadiguo 等）', async () => {
    const result = await quickCheck('wo lai zi zhong hua di guo');
    expect(result.hasSensitiveWords).toBe(true);
    expect(result.detectedWords.some((w) => w.includes('(拼音)'))).toBe(true);
  });

  it('不应将英文名 + AI 误判为“性爱”(拼音)', async () => {
    const result = await quickCheck('Dr. Zhang Xing 是一位 AI 专家。');
    expect(result.hasSensitiveWords).toBe(false);
  });
});
