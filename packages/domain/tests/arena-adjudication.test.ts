import { expect, it, vi } from 'vitest';
import { resolveAdjudicationEvents } from '../src/arena-adjudication';
it('uses current runtime zero-probability, bounded rolls and chained outcome semantics', () => {
  const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(2).mockReturnValueOnce(0.49);
  expect(resolveAdjudicationEvents([{ type: 'binary', description: '零概率', probability: 0, onFailure: { event: { type: 'binary', probability: 100, description: '必成' } } }, { type: 'custom', outcomes: [{ name: '甲', probability: 1 }, { name: '乙', probability: 1 }] }], random)).toEqual([
    { depth: 0, description: '零概率', type: 'binary', roll: 1, outcome: '失败', details: '掷骰(1) vs 成功率(0%)' },
    { depth: 1, description: '必成', type: 'binary', roll: 100, outcome: '成功', details: '掷骰(100) vs 成功率(100%)' },
    { depth: 0, description: '', type: 'custom', roll: 50, outcome: '甲', details: '掷骰(50) 命中概率区间' },
  ]); expect(random).toHaveBeenCalledTimes(3);
});
it('keeps depth 20 ceiling and never draws for non-arrays', () => {
  const random = vi.fn(() => 0.5); expect(resolveAdjudicationEvents(null, random)).toEqual([]); expect(resolveAdjudicationEvents([{}], random, 21)).toEqual([]); expect(random).not.toHaveBeenCalled();
});

it('preserves unknown result types for display without accepting a new event algorithm', () => {
  const expected: import('../src/arena-types').AdjudicationResult = { depth: 0, description: '旧未知事件', type: 'legacy-unknown', roll: 51, outcome: '未知', details: '' };
  expect(resolveAdjudicationEvents([{ type: expected.type, description: expected.description }], () => 0.5)).toEqual([expected]);
});
