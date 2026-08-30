import { describe, expect, test } from 'vitest';

import { extractScenarioAdjudicationEvents, isLegacyAdjudicatorFormat, mergeAdjudicationEvents, resolvePvpAdjudicationEvents } from '@/lib/pvp/adjudication-events';

describe('resolvePvpAdjudicationEvents', () => {
  test('房间已配置判定器时优先使用房间事件', () => {
    const roomEvents = [
      { id: 'room_1', description: '房间事件', type: 'binary' as const, probability: 50 },
    ];
    const scenarioPayload = {
      title: '情景',
      adjudicationEvents: [
        { id: 'sc_1', description: '情景事件', type: 'binary' as const, probability: 80 },
      ],
    };

    expect(resolvePvpAdjudicationEvents({ roomEvents, scenarioPayload })).toEqual(roomEvents);
  });

  test('房间未配置判定器时回退到情景卡事件', () => {
    const roomEvents: any[] = [];
    const scenarioPayload = {
      title: '情景',
      adjudicationEvents: [
        { id: 'sc_1', description: '情景事件', type: 'binary' as const, probability: 80 },
      ],
    };

    expect(resolvePvpAdjudicationEvents({ roomEvents, scenarioPayload })).toEqual(scenarioPayload.adjudicationEvents);
  });

  test('情景卡事件为旧版格式时应忽略', () => {
    const legacyEvents = [{ event: '天气如何', probability: 50 }];
    expect(isLegacyAdjudicatorFormat(legacyEvents)).toBe(true);
    expect(resolvePvpAdjudicationEvents({ roomEvents: [], scenarioPayload: { title: '情景', adjudicationEvents: legacyEvents } })).toEqual([]);
  });

  test('两侧都无效时返回空数组', () => {
    expect(resolvePvpAdjudicationEvents({ roomEvents: null, scenarioPayload: null })).toEqual([]);
    expect(resolvePvpAdjudicationEvents({ roomEvents: [], scenarioPayload: { title: 'x' } })).toEqual([]);
  });
});

describe('mergeAdjudicationEvents', () => {
  test('按 id 进行去重合并（只追加缺失项）', () => {
    const current = [
      { id: 'a', description: 'A', type: 'binary' as const, probability: 50 },
      { id: 'b', description: 'B', type: 'binary' as const, probability: 50 },
    ];
    const incoming = [
      { id: 'b', description: 'B2', type: 'binary' as const, probability: 50 },
      { id: 'c', description: 'C', type: 'binary' as const, probability: 50 },
    ];
    expect(mergeAdjudicationEvents(current, incoming).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('extractScenarioAdjudicationEvents', () => {
  test('非对象/缺失字段返回空', () => {
    expect(extractScenarioAdjudicationEvents(null)).toEqual([]);
    expect(extractScenarioAdjudicationEvents('x')).toEqual([]);
    expect(extractScenarioAdjudicationEvents({ title: 'x' })).toEqual([]);
  });
});
