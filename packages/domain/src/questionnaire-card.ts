import { NarrativeHistorySchema } from './narrative-history';
import { QuestionnaireSchema } from './questionnaire';

/**
 * 问卷数据卡的领域判定（D5.0e 自 apps/web/lib/questionnaire-data-card 迁入）。
 *
 * Web 原实现经由 `validateDataCard(payload).type === 'questionnaire'`：
 * 该函数按叙事历史 → 问卷 → 残兽 → …的顺序尝试 schema，因此等价语义是
 * 「问卷 schema 通过且叙事历史 schema 不通过」——后者的 templateId 字面量
 * 约束（`'narrative-history'`）让双重命中的情况实际上只可能来自畸形卡。
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseDataCardPayload = (data: unknown): Record<string, unknown> | null => {
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return isRecord(data) ? data : null;
};

export const isQuestionnairePayload = (data: unknown): boolean => {
  const payload = parseDataCardPayload(data);
  if (!payload) return false;
  if (NarrativeHistorySchema.safeParse(payload).success) return false;
  return QuestionnaireSchema.safeParse(payload).success;
};

export const isQuestionnaireDataCard = (card: unknown): boolean => {
  if (!isRecord(card)) return false;
  if (card.type === 'questionnaire') return true;
  return card.type === 'character' && isQuestionnairePayload(card.data);
};

export const normalizeQuestionnaireDataCard = <T extends Record<string, unknown>>(
  card: T,
): (T & { type: 'questionnaire'; isLegacyQuestionnaire?: boolean }) | null => {
  if (!isQuestionnaireDataCard(card)) return null;
  if (card.type === 'questionnaire') return card as T & { type: 'questionnaire' };

  return {
    ...card,
    type: 'questionnaire',
    isLegacyQuestionnaire: true,
  };
};
