export type BattleReportOutputSource = 'd1' | 'r2' | 'none';

const hasNonEmptyText = (value: unknown): boolean => {
  return typeof value === 'string' && value.trim().length > 0;
};

export const getBattleReportOutputSource = (input: {
  outputPreview: unknown;
  hasIndexedLargeObject: unknown;
}): BattleReportOutputSource => {
  if (hasNonEmptyText(input.outputPreview)) return 'd1';
  if (input.hasIndexedLargeObject === true || input.hasIndexedLargeObject === 1 || input.hasIndexedLargeObject === '1') {
    return 'r2';
  }
  return 'none';
};

export const hasBattleReportStoredOutput = (input: {
  outputPreview: unknown;
  hasIndexedLargeObject: unknown;
}): boolean => {
  return getBattleReportOutputSource(input) !== 'none';
};

export const formatBattleReportOutputSource = (source: BattleReportOutputSource): string => {
  if (source === 'd1') return 'D1 预览';
  if (source === 'r2') return 'R2 对象';
  return '未存储';
};
