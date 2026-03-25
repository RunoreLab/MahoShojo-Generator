import type { AdjudicationResult } from '@/types/arena';

export type AdjudicationOutcomeTone = 'success' | 'failure' | 'neutral';

const normalizeText = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

export const resolveAdjudicationOutcomeTone = (outcome: unknown): AdjudicationOutcomeTone => {
  const normalized = normalizeText(outcome);
  if (normalized === '成功' || normalized === '大成功') return 'success';
  if (normalized === '失败' || normalized === '大失败') return 'failure';
  return 'neutral';
};

export const hasAdjudicationRecordSection = (markdown: string): boolean => {
  return /(^|\n)##\s*随机判定记录\s*(\n|$)/.test(markdown);
};

export const buildAdjudicationRecordMarkdown = (
  adjudicationResults: AdjudicationResult[] | null | undefined
): string => {
  if (!Array.isArray(adjudicationResults) || adjudicationResults.length === 0) return '';

  const lines = adjudicationResults
    .map((result) => {
      const description = normalizeText(result?.description);
      const outcome = normalizeText(result?.outcome);
      const details = normalizeText(result?.details);
      if (!description || !outcome) return null;
      const depth = typeof result?.depth === 'number' && Number.isFinite(result.depth)
        ? Math.max(0, Math.floor(result.depth))
        : 0;
      const prefix = ' '.repeat(depth * 2);
      return `${prefix}- **事件**: ${description}\n${prefix}  - **结果**: ${outcome}${details ? ` (${details})` : ''}`;
    })
    .filter((item): item is string => Boolean(item));

  if (lines.length === 0) return '';

  return `## 随机判定记录\n${lines.join('\n')}`;
};
