import { extractModerationTextFromJsonString } from '../admin/ai-review-prompt';
import type { ReviewTarget } from './types';

/**
 * 把待审卡压平成审查 state 文本：名称 + 简介 + data 全部字符串叶子。
 * 决策模型上下文 64k，这里放宽到 12k 字符（旧 llm 通路沿用 6k 限制
 * 由既有 extract 默认参数决定，见 backends/llm.ts）。
 */
const AUTO_REVIEW_STATE_MAX = 12_000;

export const buildAutoReviewStateText = (target: ReviewTarget): string => {
  const extract = extractModerationTextFromJsonString(target.data, {
    maxTotalLength: AUTO_REVIEW_STATE_MAX,
  });
  const header = [
    `数据卡名称: ${target.name}`,
    target.description ? `数据卡简介: ${target.description}` : null,
    target.type ? `数据卡类型: ${target.type}` : null,
    '---- 卡内容 ----',
  ]
    .filter(Boolean)
    .join('\n');
  return `${header}\n${extract.text}`.slice(0, AUTO_REVIEW_STATE_MAX + header.length);
};
