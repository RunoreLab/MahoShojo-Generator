import { describe, expect, test } from 'bun:test';

import type { AdjudicatorEvent } from '@/types/arena';
import { normalizeAdjudicationEvents } from '@/lib/adjudicator/normalize';

const createDeterministicIdFactory = () => {
  let counter = 0;
  return (prefix: 'event' | 'outcome') => `${prefix}-${++counter}`;
};

describe('normalizeAdjudicationEvents', () => {
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

