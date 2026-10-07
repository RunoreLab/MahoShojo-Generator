/**
 * 公开数据卡自动审查：后端抽象与归一化裁决类型。
 *
 * 设计依据 docs/reports/2026-10-07_110910_公开数据卡自动审查模型接入调研与方案.md：
 * 单模型单审、统一 {verdict, score, category, reason, details} 归一化输出。
 */

/** 站内统一红线类目。各后端把自家分类映射进该集合；未覆盖维度不参与评分。 */
export const AUTO_REVIEW_CATEGORIES = [
  'sexual',
  'gore',
  'hate',
  'political',
  'illegal',
  'spam',
  'inject',
  'other',
] as const;
export type AutoReviewCategory = (typeof AUTO_REVIEW_CATEGORIES)[number];

export const AUTO_REVIEW_CATEGORY_LABELS: Record<AutoReviewCategory, string> = {
  sexual: '性内容',
  gore: '血腥猎奇',
  hate: '仇恨/攻击',
  political: '现实政治影射',
  illegal: '违法/危险内容',
  spam: '垃圾/噪声内容',
  inject: '审核绕过指令',
  other: '违规内容',
};

export type ReviewTarget = {
  id: string;
  name: string;
  description: string;
  /** data 字段的 JSON 原文 */
  data: string;
  type?: string | null;
};

export type ReviewVerdict = 'approve' | 'reject' | 'uncertain';

export type ReviewOutcome = {
  verdict: ReviewVerdict;
  /** 归一化违规倾向分 0–1（各后端按自身口径折算；无语义分数的后端给 0/1） */
  score: number;
  category?: AutoReviewCategory;
  /** 面向用户的简短中文理由（通知文案素材） */
  reason?: string;
  /** 后端原生明细（逐题概率、category_scores、原始类目串等），保留供日志/审计/调阈 */
  details?: Record<string, unknown>;
};

export type AutoReviewBackendKind = 'jev-decisions' | 'omni-moderation' | 'nemotron' | 'llm';

export interface AutoReviewBackend {
  readonly id: string;
  readonly kind: AutoReviewBackendKind;
  review(_target: ReviewTarget): Promise<ReviewOutcome>;
}

export type AutoReviewRoutingStrategy = 'priority' | 'weighted-random';

export type AutoReviewUncertainPolicy = 'normal' | 'hold' | 'approve' | 'reject';
export type AutoReviewExemptPolicy = 'skip' | 'review';

export type AutoReviewPolicy = {
  onUncertain: AutoReviewUncertainPolicy;
  exemptUserPolicy: AutoReviewExemptPolicy;
  notifyOnAutoReject: boolean;
};

export const DEFAULT_AUTO_REVIEW_POLICY: AutoReviewPolicy = {
  onUncertain: 'normal',
  exemptUserPolicy: 'skip',
  notifyOnAutoReject: true,
};

/** uncertain 裁决落地：返回本卡应采取的动作。 */
export const resolveUncertainAction = (
  policy: AutoReviewUncertainPolicy,
  isReviewExempt: boolean,
): 'approve' | 'reject' | 'pending' => {
  switch (policy) {
    case 'approve':
      return 'approve';
    case 'reject':
      return 'reject';
    case 'hold':
      return 'pending';
    case 'normal':
    default:
      return isReviewExempt ? 'approve' : 'pending';
  }
};
