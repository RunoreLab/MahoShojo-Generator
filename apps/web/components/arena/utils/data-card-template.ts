import { inferTemplate, type InferableTemplate } from '@/lib/data-card-converter';

/**
 * Resolve the template used by Arena routing.
 *
 * Structural inference remains authoritative whenever it succeeds. The database
 * card type is only used for the unknown fallback so that a non-standard card
 * declared as a scenario cannot fall through to the combatant branch.
 */
export const resolveArenaDataCardTemplate = (
  data: unknown,
  declaredCardType: unknown,
): InferableTemplate => {
  const inferredTemplate = inferTemplate(data);
  if (inferredTemplate !== 'unknown') return inferredTemplate;
  return declaredCardType === 'scenario' ? 'scenario' : inferredTemplate;
};
