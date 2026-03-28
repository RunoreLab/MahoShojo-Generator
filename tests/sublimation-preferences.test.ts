import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_SUBLIMATION_STATE_PREFERENCES,
  readSublimationStatePreferences,
} from '@/lib/sublimation/preferences';
import { DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY } from '@/lib/sublimation/arena-history';

type TestStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const createStorage = (initial: Record<string, string> = {}): TestStorage => {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
};

describe('sublimation state preferences', () => {
  test('旧存储缺少 arenaHistoryRetentionStrategy 时回退到默认策略', () => {
    const key = 'sublimation-history-state-preferences-v1';
    const storage = createStorage({
      [key]: JSON.stringify({
        readArenaHistory: false,
        writeArenaHistory: false,
        readCurrentState: true,
        writeCurrentState: false,
      }),
    });

    const result = readSublimationStatePreferences(storage, key);

    expect(result.readArenaHistory).toBe(false);
    expect(result.writeArenaHistory).toBe(false);
    expect(result.readCurrentState).toBe(true);
    expect(result.writeCurrentState).toBe(false);
    expect(result.arenaHistoryRetentionStrategy).toBe(DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY);
  });

  test('strategy 非法值时回退默认策略，但保留合法布尔值', () => {
    const key = 'sublimation-history-state-preferences-v1';
    const storage = createStorage({
      [key]: JSON.stringify({
        readArenaHistory: false,
        writeArenaHistory: true,
        readCurrentState: false,
        writeCurrentState: true,
        arenaHistoryRetentionStrategy: '__invalid__',
      }),
    });

    const result = readSublimationStatePreferences(storage, key);

    expect(result.readArenaHistory).toBe(false);
    expect(result.writeArenaHistory).toBe(true);
    expect(result.readCurrentState).toBe(false);
    expect(result.writeCurrentState).toBe(true);
    expect(result.arenaHistoryRetentionStrategy).toBe(DEFAULT_ARENA_HISTORY_RETENTION_STRATEGY);
  });

  test('JSON 损坏时整体回退默认值', () => {
    const key = 'sublimation-history-state-preferences-v1';
    const storage = createStorage({
      [key]: '{bad json',
    });

    const result = readSublimationStatePreferences(storage, key);

    expect(result).toEqual(DEFAULT_SUBLIMATION_STATE_PREFERENCES);
  });
});
