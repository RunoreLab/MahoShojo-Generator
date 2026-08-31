import { beforeEach, describe, expect, test, vi } from 'vitest';

const { getLargeObjectByOwnerRefMock, getObjectTextMock } = vi.hoisted(() => ({
  getLargeObjectByOwnerRefMock: vi.fn(),
  getObjectTextMock: vi.fn(),
}));

vi.mock('@/lib/database/large-objects', () => ({
  getLargeObjectByOwnerRef: getLargeObjectByOwnerRefMock,
}));

vi.mock('@/lib/r2', () => ({
  getObjectText: getObjectTextMock,
}));

import {
  buildBattleReportGenerationCombatantInserts,
  extractBattleReportGenerationErrorMessage,
  loadBattleReportGenerationOutputText,
} from '@/lib/arena/battle-report-record-utils';

describe('battle-report-record-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  test('loadBattleReportGenerationOutputText: legacy D1 preview 仍优先且不读取 R2', async () => {
    const result = await loadBattleReportGenerationOutputText({
      generationId: 'gen-d1',
      outputPreview: 'D1 中的完整战报',
    });

    expect(result).toEqual({
      outputText: 'D1 中的完整战报',
      source: 'd1',
      hasStoredOutput: true,
      readError: null,
    });
    expect(getLargeObjectByOwnerRefMock).not.toHaveBeenCalled();
    expect(getObjectTextMock).not.toHaveBeenCalled();
  });

  test('loadBattleReportGenerationOutputText: R2 读取成功时返回战报正文', async () => {
    getLargeObjectByOwnerRefMock.mockResolvedValue({ r2_key: 'battle-reports/gen-r2.md' });
    getObjectTextMock.mockResolvedValue({
      success: true,
      status: 200,
      data: { text: 'R2 中的战报正文' },
    });

    const result = await loadBattleReportGenerationOutputText({
      generationId: 'gen-r2',
      outputPreview: null,
    });

    expect(getLargeObjectByOwnerRefMock).toHaveBeenCalledWith('battle_report_generation_output', 'gen-r2');
    expect(getObjectTextMock).toHaveBeenCalledWith('battle-reports/gen-r2.md');
    expect(result).toEqual({
      outputText: 'R2 中的战报正文',
      source: 'r2',
      hasStoredOutput: true,
      readError: null,
    });
  });

  test('loadBattleReportGenerationOutputText: R2 Lifecycle 清理对象后视为正文已过期', async () => {
    getLargeObjectByOwnerRefMock.mockResolvedValue({ r2_key: 'battle-reports/gen-expired.md' });
    getObjectTextMock.mockResolvedValue({
      success: false,
      status: 404,
      error: 'NoSuchKey',
    });

    const result = await loadBattleReportGenerationOutputText({
      generationId: 'gen-expired',
      outputPreview: '',
    });

    expect(result).toEqual({
      outputText: '',
      source: 'r2',
      hasStoredOutput: false,
      readError: null,
    });
  });

  test.each([
    ['403', { success: false, status: 403, error: 'AccessDenied' }],
    ['5xx', { success: false, status: 503, error: 'ServiceUnavailable' }],
    ['network', { success: false, error: 'fetch failed' }],
  ])('loadBattleReportGenerationOutputText: R2 %s 失败仍保留可重试的读取错误', async (_kind, r2Result) => {
    getLargeObjectByOwnerRefMock.mockResolvedValue({ r2_key: 'battle-reports/gen-error.md' });
    getObjectTextMock.mockResolvedValue(r2Result);

    const result = await loadBattleReportGenerationOutputText({
      generationId: 'gen-error',
      outputPreview: null,
    });

    expect(result).toEqual({
      outputText: '',
      source: 'r2',
      hasStoredOutput: true,
      readError: r2Result.error,
    });
  });
});
