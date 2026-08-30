import { describe, expect, test } from 'vitest';

import {
  buildBattleReportGenerationCombatantInserts,
  extractBattleReportGenerationErrorMessage,
} from '@/lib/arena/battle-report-record-utils';

describe('battle-report-record-utils', () => {
  test('extractBattleReportGenerationErrorMessage: 提取并截断 extra_json 中的错误信息', () => {
    expect(extractBattleReportGenerationErrorMessage(null)).toBeNull();
    expect(extractBattleReportGenerationErrorMessage('')).toBeNull();
    expect(extractBattleReportGenerationErrorMessage('{"stage":"x"}')).toBeNull();
    expect(extractBattleReportGenerationErrorMessage('{"errorMessage":"  上游限流  "}')).toBe('上游限流');
  });

  test('buildBattleReportGenerationCombatantInserts: 为预设角色生成标准写库行', () => {
    const rows = buildBattleReportGenerationCombatantInserts('gen-1', [
      {
        type: 'magical-girl',
        data: { codename: '雪绒', templateId: 'M12_greatness_in_simplicity.json' },
        isNative: true,
        isPreset: true,
        filename: 'M12_greatness_in_simplicity.json',
        teamId: null,
        characterGuidance: null,
        sourceDataCardId: null,
        sourceDataCardUpdatedAt: null,
      },
      {
        type: 'magical-girl',
        data: { name: '艾草', templateId: 'M10_mugwort.json' },
        isNative: true,
        isPreset: true,
        filename: 'M10_mugwort.json',
        teamId: null,
        characterGuidance: '全力输出',
        sourceDataCardId: null,
        sourceDataCardUpdatedAt: null,
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      generationId: 'gen-1',
      sortIndex: 0,
      name: '雪绒',
      templateId: 'M12_greatness_in_simplicity.json',
      isPreset: true,
    });
    expect(rows[1]).toMatchObject({
      generationId: 'gen-1',
      sortIndex: 1,
      name: '艾草',
      templateId: 'M10_mugwort.json',
      isPreset: true,
      characterGuidance: '全力输出',
    });
  });
});
