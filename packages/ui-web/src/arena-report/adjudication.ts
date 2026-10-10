export {
  buildAdjudicationRecordMarkdown,
  hasAdjudicationRecordSection,
} from '@mahoshojo/domain/arena-adjudication-markdown';

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
