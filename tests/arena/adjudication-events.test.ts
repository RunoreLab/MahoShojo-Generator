import { describe, expect, test } from 'vitest';

import {
  buildAdjudicationSourceKey,
  filterAdjudicationEventsBySources,
  markAdjudicationEventsWithSource,
} from '@/lib/arena/adjudication-events';

describe('arena adjudication events helpers', () => {
  test('buildAdjudicationSourceKey prioritizes card id over file name and label', () => {
    expect(
      buildAdjudicationSourceKey({
        sourceDataCardId: ' card-1 ',
        sourceFileName: 'source.json',
        sourceLabel: '来源卡',
      })
    ).toBe('data_card:card-1');
    expect(buildAdjudicationSourceKey({ sourceFileName: 'source.json', sourceLabel: '来源卡' })).toBe('file:source.json');
    expect(buildAdjudicationSourceKey({ sourceLabel: '来源卡' })).toBe('label:来源卡');
  });

  test('markAdjudicationEventsWithSource attaches sourceKey to each event', () => {
    const events = [
      { id: 'evt-1', description: '事件 1', type: 'binary' as const, probability: 50 },
      { id: 'evt-2', description: '事件 2', type: 'binary' as const, probability: 60 },
    ];

    const next = markAdjudicationEventsWithSource(events, 'data_card:card-1');

    expect(next).toEqual([
      { ...events[0], sourceKey: 'data_card:card-1' },
      { ...events[1], sourceKey: 'data_card:card-1' },
    ]);
    expect(events[0]).not.toHaveProperty('sourceKey');
  });

  test('filterAdjudicationEventsBySources removes only matching sources', () => {
    const events = [
      { id: 'evt-1', description: 'A', type: 'binary' as const, probability: 50, sourceKey: 'data_card:card-1' },
      { id: 'evt-2', description: 'B', type: 'binary' as const, probability: 50, sourceKey: 'file:scenario.json' },
      { id: 'evt-3', description: 'C', type: 'binary' as const, probability: 50 },
    ];

    expect(filterAdjudicationEventsBySources(events, ['data_card:card-1', 'file:missing.json']).map((event) => event.id)).toEqual([
      'evt-2',
      'evt-3',
    ]);
  });
});
