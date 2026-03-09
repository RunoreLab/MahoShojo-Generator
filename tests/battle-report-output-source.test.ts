import { describe, expect, test } from 'bun:test';

import {
  formatBattleReportOutputSource,
  getBattleReportOutputSource,
  hasBattleReportStoredOutput,
} from '@/lib/admin/battle-report-output-source';

describe('battle-report-output-source', () => {
  test('有 preview 时判定为 d1', () => {
    expect(getBattleReportOutputSource({ outputPreview: 'preview', hasIndexedLargeObject: false })).toBe('d1');
    expect(hasBattleReportStoredOutput({ outputPreview: 'preview', hasIndexedLargeObject: false })).toBe(true);
  });

  test('无 preview 但有索引时判定为 r2', () => {
    expect(getBattleReportOutputSource({ outputPreview: '', hasIndexedLargeObject: true })).toBe('r2');
    expect(formatBattleReportOutputSource('r2')).toBe('R2 对象');
  });

  test('无 preview 且无索引时判定为 none', () => {
    expect(getBattleReportOutputSource({ outputPreview: null, hasIndexedLargeObject: false })).toBe('none');
    expect(hasBattleReportStoredOutput({ outputPreview: null, hasIndexedLargeObject: false })).toBe(false);
  });
});
