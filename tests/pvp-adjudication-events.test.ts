import { describe, expect, test } from 'bun:test';

import { resolvePvpAdjudicationEvents } from '@/lib/pvp/adjudication-events';

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

  test('两侧都无效时返回空数组', () => {
    expect(resolvePvpAdjudicationEvents({ roomEvents: null, scenarioPayload: null })).toEqual([]);
    expect(resolvePvpAdjudicationEvents({ roomEvents: [], scenarioPayload: { title: 'x' } })).toEqual([]);
  });
});

