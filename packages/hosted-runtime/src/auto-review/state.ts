import { extractModerationTextFromJsonString } from '../admin/ai-review-prompt';
import type { ReviewInputCoverage, ReviewTarget } from './types';

/**
 * 把待审卡压平成审查 state 文本：名称 + 简介 + data 全部字符串叶子。
 * 决策模型上下文 64k，这里放宽到 12k 字符；覆盖信息（截断/解析失败）
 * 随文本一并返回，供引擎裁决门禁使用——truncate 的输入禁止 approve。
 */
export const AUTO_REVIEW_STATE_MAX = 12_000;

export type AutoReviewState = {
  text: string;
  coverage: ReviewInputCoverage;
};

/** 仅提取正文内容与覆盖信息（llm 后端按自有格式组织输入时使用）。 */
export const extractAutoReviewContent = (target: ReviewTarget): AutoReviewState => {
  const extract = extractModerationTextFromJsonString(target.data, {
    maxTotalLength: AUTO_REVIEW_STATE_MAX,
  });
  return { text: extract.text, coverage: { truncated: extract.truncated, parseError: extract.parseError } };
};

export const buildAutoReviewState = (target: ReviewTarget): AutoReviewState => {
  const { text, coverage } = extractAutoReviewContent(target);
  const header = [
    `数据卡名称: ${target.name}`,
    target.description ? `数据卡简介: ${target.description}` : null,
    target.type ? `数据卡类型: ${target.type}` : null,
    '---- 卡内容 ----',
  ]
    .filter(Boolean)
    .join('\n');
  const combined = `${header}\n${text}`;
  const limit = AUTO_REVIEW_STATE_MAX + header.length;
  if (combined.length <= limit) return { text: combined, coverage };
  return { text: combined.slice(0, limit), coverage: { ...coverage, truncated: true } };
};
