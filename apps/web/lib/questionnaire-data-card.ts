import { validateDataCard } from '@/lib/schemas';

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
  return payload ? validateDataCard(payload).type === 'questionnaire' : false;
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
