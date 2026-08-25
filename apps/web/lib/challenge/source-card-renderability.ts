import { inferTemplate } from '@/lib/data-card-converter';

export type ChallengeRenderableTemplate = 'magical-girl' | 'canshou' | 'general';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isRenderableMagicalGirlCardPayload = (cardPayload: Record<string, unknown>): boolean =>
  safeString(cardPayload.codename).length > 0
  && isRecord(cardPayload.appearance)
  && isRecord(cardPayload.magicConstruct)
  && isRecord(cardPayload.wonderlandRule)
  && isRecord(cardPayload.blooming)
  && isRecord(cardPayload.analysis);

export function inferChallengeRenderableTemplate(
  cardPayload: Record<string, unknown>
): ChallengeRenderableTemplate | null {
  const template = inferTemplate(cardPayload);
  if (template === 'magical-girl' || template === 'canshou' || template === 'general') {
    return template;
  }
  return null;
}

export function isChallengeRenderableSourceCard(cardPayload: Record<string, unknown>): boolean {
  const template = inferChallengeRenderableTemplate(cardPayload);
  if (!template) return false;
  if (template === 'magical-girl') {
    return isRenderableMagicalGirlCardPayload(cardPayload);
  }
  return true;
}
