import type { AdjudicationResult } from './arena-types';

const normalizeText = (value: unknown): string => {
  return typeof value === 'string' ? value.trim() : '';
};

export const hasAdjudicationRecordSection = (markdown: string): boolean => {
  return /(^|\n)##\s*随机判定记录\s*(\n|$)/.test(markdown);
};

/** A repeated indent stays a number until a consumer emits bounded frames. */
export type AdjudicationMarkdownPart = string | Readonly<{ spaces: number }>;
export const materializeAdjudicationMarkdownPart = (part: AdjudicationMarkdownPart): string => (
  typeof part === 'string' ? part : ' '.repeat(part.spaces)
);

/** The original formatter's only source of labels, filtering and indentation.
 * Legacy string callers join these parts; streaming callers never allocate a
 * depth-sized prefix. Invalid/unsafe dimensions fail before repeat allocation.
 */
export function* iterateAdjudicationRecordMarkdownParts(
  adjudicationResults: AdjudicationResult[] | null | undefined,
): Generator<AdjudicationMarkdownPart> {
  if (!Array.isArray(adjudicationResults) || adjudicationResults.length === 0) return;
  let started = false;
  for (const result of adjudicationResults) {
    const description = normalizeText(result?.description);
    const outcome = normalizeText(result?.outcome);
    const details = normalizeText(result?.details);
    if (!description || !outcome) continue;
    const depth = typeof result?.depth === 'number' && Number.isFinite(result.depth)
      ? Math.max(0, Math.floor(result.depth)) : 0;
    const spaces = depth * 2;
    if (!Number.isSafeInteger(spaces) || !Number.isSafeInteger(spaces * 2)) {
      throw new RangeError('判定缩进无法用安全字节长度表示，原数据未修改');
    }
    yield started ? '\n' : '## 随机判定记录\n'; started = true;
    yield { spaces }; yield '- **事件**: '; yield description; yield '\n';
    yield { spaces }; yield '  - **结果**: '; yield outcome;
    if (details) { yield ' ('; yield details; yield ')'; }
  }
}

export const buildAdjudicationRecordMarkdown = (
  adjudicationResults: AdjudicationResult[] | null | undefined,
): string => Array.from(iterateAdjudicationRecordMarkdownParts(adjudicationResults), materializeAdjudicationMarkdownPart).join('');
