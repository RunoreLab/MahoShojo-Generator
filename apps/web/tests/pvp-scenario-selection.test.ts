import { describe, expect, test } from 'vitest';

import { getPvpScenarioTitle, parsePvpScenarioSelection } from '@/lib/pvp/scenario';

describe('pvp: scenario selection', () => {
  test('rejects local scenario payload without data card id', () => {
    expect(parsePvpScenarioSelection(null)).toBeNull();
    expect(parsePvpScenarioSelection({})).toBeNull();
    expect(parsePvpScenarioSelection({ fileName: 'x.json', content: { title: 'x' } })).toBeNull();
  });

  test('accepts normalized selection format', () => {
    const parsed = parsePvpScenarioSelection({
      kind: 'data_card',
      id: 'abc',
      updatedAt: '2025-01-01T00:00:00.000Z',
      name: '测试情景',
      isPublic: true,
      author: 'alice',
    });
    expect(parsed).toEqual({
      kind: 'data_card',
      id: 'abc',
      updatedAt: '2025-01-01T00:00:00.000Z',
      name: '测试情景',
      isPublic: true,
      author: 'alice',
    });
    expect(getPvpScenarioTitle(parsed!)).toBe('测试情景');
  });

  test('accepts legacy selection format with sourceDataCardId', () => {
    const parsed = parsePvpScenarioSelection({
      content: { title: 'ignored' },
      fileName: 'ignored.json',
      isNative: true,
      sourceDataCardId: 'card_1',
      sourceDataCardUpdatedAt: '2025-01-02T00:00:00.000Z',
      sourceDataCardName: '旧情景',
      sourceIsPublic: 1,
      sourceAuthor: 'bob',
    });
    expect(parsed).toEqual({
      kind: 'data_card',
      id: 'card_1',
      updatedAt: '2025-01-02T00:00:00.000Z',
      name: '旧情景',
      isPublic: true,
      author: 'bob',
    });
    expect(getPvpScenarioTitle(parsed!)).toBe('旧情景');
  });

  test('rejects unknown kind', () => {
    expect(parsePvpScenarioSelection({ kind: 'snapshot', id: 'x' })).toBeNull();
  });

  test('accepts preset selection format', () => {
    const parsed = parsePvpScenarioSelection({
      kind: 'preset',
      filename: 'S01_queen_will.json',
      name: '预设情景（测试别名）',
    });
    expect(parsed).toEqual({
      kind: 'preset',
      filename: 'S01_queen_will.json',
      name: '预设情景（测试别名）',
    });
    expect(getPvpScenarioTitle(parsed!)).toBe('预设情景（测试别名）');
  });

  test('rejects unknown preset filename', () => {
    expect(parsePvpScenarioSelection({ kind: 'preset', filename: 'does-not-exist.json' })).toBeNull();
  });

  test('title falls back to id', () => {
    const parsed = parsePvpScenarioSelection({ id: 'card_2' });
    expect(parsed?.name).toBeNull();
    expect(getPvpScenarioTitle(parsed!)).toBe('card_2');
  });
});
