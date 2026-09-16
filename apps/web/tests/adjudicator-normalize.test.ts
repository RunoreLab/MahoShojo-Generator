import { describe, expect, test } from 'vitest';
import { ArenaRoomHostRuntimeGenerationSchema } from '@mahoshojo/contracts/arena-room';

import type { AdjudicatorEvent } from '@/types/arena';
import { normalizeAdjudicationEvents } from '@/lib/adjudicator/normalize';

const createDeterministicIdFactory = () => {
  let counter = 0;
  return (prefix: 'event' | 'outcome') => `${prefix}-${++counter}`;
};

describe('normalizeAdjudicationEvents', () => {
  test('复现多人 JSON 校验错误，并清理嵌套删除事件留下的 undefined', () => {
    const events: AdjudicatorEvent[] = [{
      id: 'root', description: '根事件', type: 'custom', sourceKey: undefined,
      onSuccess: undefined, onFailure: undefined, probability: undefined,
      outcomes: [{
        id: 'outcome', name: '结果', probability: 100,
        chainedEvent: { event: {
          id: 'child', description: '后续', type: 'binary', probability: 0,
          onSuccess: { event: {
            id: 'leaf', description: '末端', type: 'custom',
            outcomes: [{ id: 'leaf-outcome', name: '结果', probability: 100, chainedEvent: undefined }],
          } },
          onFailure: undefined, outcomes: undefined,
        } },
      }],
    }];
    const before = ArenaRoomHostRuntimeGenerationSchema.safeParse({ adjudicationEvents: events });
    expect(before.success).toBe(false);
    if (!before.success) expect(before.error.issues).toEqual([expect.objectContaining({
      path: ['adjudicationEvents'], message: 'must be a bounded plain JSON value without unsafe keys',
    })]);

    const normalized = normalizeAdjudicationEvents(events);
    expect(ArenaRoomHostRuntimeGenerationSchema.safeParse({ adjudicationEvents: normalized }).success).toBe(true);
    // 与旧单人 JSON 序列化结果一致，不修改概率、ID 或原输入。
    expect(normalized).toStrictEqual(JSON.parse(JSON.stringify(events)));
    expect(Object.prototype.hasOwnProperty.call(events[0], 'onSuccess')).toBe(true);
    expect(normalizeAdjudicationEvents(normalized)).toBe(normalized);
  });

  test.each([
    { constructor: 'unsafe' },
    { extra: undefined },
    { extra: new Date() },
    { probability: Number.NaN },
  ])('规范化不会静默吞掉其他非法数据：%j', (invalid) => {
    const events = [{ id: 'root', description: '', type: 'binary' as const, ...invalid }];
    expect(ArenaRoomHostRuntimeGenerationSchema.safeParse({
      adjudicationEvents: normalizeAdjudicationEvents(events),
    }).success).toBe(false);
  });

  test('输入已规范时返回原引用', () => {
    const events: AdjudicatorEvent[] = [
      {
        id: 'event-a',
        description: 'A',
        type: 'binary',
        probability: 50,
      },
      {
        id: 'event-b',
        description: 'B',
        type: 'custom',
        outcomes: [
          { id: 'outcome-1', name: '结果1', probability: 100 },
        ],
      },
    ];

    const normalized = normalizeAdjudicationEvents(events, { createId: createDeterministicIdFactory() });
    expect(normalized).toBe(events);
  });

  test('补齐缺失的事件 id，并保证同层唯一', () => {
    const events: AdjudicatorEvent[] = [
      { description: 'A', type: 'binary', probability: 50 } as any,
      { id: '   ', description: 'B', type: 'binary', probability: 50 } as any,
      { id: 'fixed', description: 'C', type: 'binary', probability: 50 },
      { id: 'fixed', description: 'D', type: 'binary', probability: 50 },
    ];

    const normalized = normalizeAdjudicationEvents(events, { createId: createDeterministicIdFactory() });
    expect(normalized).not.toBe(events);

    const ids = normalized.map((e) => e.id);
    expect(ids.every((id) => typeof id === 'string' && id.trim().length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    expect(normalized[2].id).toBe('fixed');
  });

  test('补齐 outcomes id 并递归处理 chainedEvent / onSuccess / onFailure', () => {
    const events: AdjudicatorEvent[] = [
      {
        id: 'root',
        description: 'Root',
        type: 'custom',
        outcomes: [
          { name: '结果1', probability: 50 } as any,
          { id: 'dup', name: '结果2', probability: 50, chainedEvent: { event: { description: '子事件', type: 'binary', probability: 50 } as any } },
          { id: 'dup', name: '结果3', probability: 0 } as any,
        ],
        onSuccess: { event: { description: '成功后续', type: 'binary', probability: 50 } as any },
        onFailure: { event: { id: 'fail', description: '失败后续', type: 'binary', probability: 50 } },
      },
    ];

    const normalized = normalizeAdjudicationEvents(events, { createId: createDeterministicIdFactory() });
    const root = normalized[0]!;

    expect(root.id).toBe('root');
    expect(root.onSuccess?.event.id).toMatch(/^event-/);
    expect(root.onFailure?.event.id).toBe('fail');

    const outcomeIds = (root.outcomes || []).map((o) => o.id);
    expect(outcomeIds.every((id) => typeof id === 'string' && id.trim().length > 0)).toBe(true);
    expect(new Set(outcomeIds).size).toBe(outcomeIds.length);

    const chainedId = root.outcomes?.[1]?.chainedEvent?.event.id;
    expect(typeof chainedId).toBe('string');
    expect(chainedId).toMatch(/^event-/);
  });
});
