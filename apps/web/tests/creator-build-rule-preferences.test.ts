import { describe, expect, test } from 'vitest';

import {
  CREATOR_BUILD_RULE_PREFERENCE_KEY,
  readCreatorBuildRulePreference,
  writeCreatorBuildRulePreference,
} from '@/lib/creator/build-rule-preferences';

type TestStorage = Pick<Storage, 'getItem' | 'setItem'>;

const createStorage = (initial: Record<string, string> = {}): TestStorage => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

describe('creator build-rule preferences', () => {
  test('没有保存过偏好时返回 null，以保留首次进入的默认规则', () => {
    const storage = createStorage();

    expect(readCreatorBuildRulePreference(storage)).toBeNull();
  });

  test('明确关闭全部规则后可恢复空选择', () => {
    const storage = createStorage();

    writeCreatorBuildRulePreference(storage, {
      selectedRuleIds: [],
      primaryRuleId: null,
    });

    expect(readCreatorBuildRulePreference(storage)).toEqual({
      selectedRuleIds: [],
      primaryRuleId: null,
    });
    expect(JSON.parse(storage.getItem(CREATOR_BUILD_RULE_PREFERENCE_KEY) ?? '{}')).toMatchObject({
      version: 1,
      hasExplicitPreference: true,
    });
  });

  test('读取时去重规则，并把无效主规则收敛到第一个已选规则', () => {
    const storage = createStorage({
      [CREATOR_BUILD_RULE_PREFERENCE_KEY]: JSON.stringify({
        version: 1,
        hasExplicitPreference: true,
        selectedRuleIds: ['dnd-5e-lite', 'dnd-5e-lite', 'coc-7e-lite'],
        primaryRuleId: 'missing-rule',
      }),
    });

    expect(readCreatorBuildRulePreference(storage)).toEqual({
      selectedRuleIds: ['dnd-5e-lite', 'coc-7e-lite'],
      primaryRuleId: 'dnd-5e-lite',
    });
  });

  test.each([
    '{bad json',
    JSON.stringify({ version: 1, selectedRuleIds: [] }),
    JSON.stringify({ version: 2, hasExplicitPreference: true, selectedRuleIds: [] }),
    JSON.stringify({ version: 1, hasExplicitPreference: true, selectedRuleIds: 'arena-trpg-lite' }),
  ])('损坏或非当前版本偏好不会覆盖默认规则：%s', (raw) => {
    const storage = createStorage({
      [CREATOR_BUILD_RULE_PREFERENCE_KEY]: raw,
    });

    expect(readCreatorBuildRulePreference(storage)).toBeNull();
  });
});
