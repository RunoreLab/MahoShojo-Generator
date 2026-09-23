import { DataCardSummaryQuerySchema } from '@mahoshojo/contracts/data-cards';

export function readDataCardSummaryQuery(params: URLSearchParams) {
  const input: Record<string, unknown> = Object.fromEntries(params);
  for (const key of ['types', 'tagIds']) {
    if (typeof input[key] === 'string') input[key] = input[key].split(',').filter(Boolean);
  }
  if (!input.types && input.type) input.types = [input.type];
  for (const key of ['nativeOnly', 'nativeAllowedOnly', 'recommendedOnly', 'includeLegacyQuestionnaires']) {
    if (input[key] !== undefined) {
      if (!['1', '0', 'true', 'false'].includes(String(input[key]))) return null;
      input[key] = input[key] === '1' || input[key] === 'true';
    }
  }
  const parsed = DataCardSummaryQuerySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
