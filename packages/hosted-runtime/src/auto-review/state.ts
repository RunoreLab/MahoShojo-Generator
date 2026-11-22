import { exceedsUtf8ByteLimit, MAX_DATA_CARD_BYTES } from '@mahoshojo/domain/data-card-size';
import type { ReviewInputCoverage, ReviewTarget } from './types';

/** 自动审核正文的 UTF-8 字节上限，与数据卡上传上限一致。 */
export const AUTO_REVIEW_STATE_MAX = MAX_DATA_CARD_BYTES;

export type AutoReviewState = {
  text: string;
  coverage: ReviewInputCoverage;
};

/** 仅提取正文内容与覆盖信息（llm 后端按自有格式组织输入时使用）。 */
export const extractAutoReviewContent = (target: ReviewTarget): AutoReviewState => {
  if (exceedsUtf8ByteLimit(target.data, AUTO_REVIEW_STATE_MAX)) {
    return { text: '', coverage: { truncated: true, parseError: false } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(target.data);
  } catch {
    return { text: '', coverage: { truncated: true, parseError: true } };
  }

  try {
    return { text: JSON.stringify(parsed), coverage: { truncated: false, parseError: false } };
  } catch {
    // 例如正文的嵌套超过运行时 JSON.stringify 能处理的深度。
    return { text: '', coverage: { truncated: true, parseError: false } };
  }
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
  return { text: `${header}\n${text}`, coverage };
};
