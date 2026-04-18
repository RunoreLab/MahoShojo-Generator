type PersistedCreationInputs = {
  template: string;
  freeformBrief?: string | null;
  buildRules: unknown[];
  primaryRuleId?: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function buildPersistedCreationInputs(input: unknown): PersistedCreationInputs {
  if (!isRecord(input)) {
    return {
      template: 'general',
      buildRules: [],
    };
  }

  const template = typeof input.template === 'string' && input.template.trim() ? input.template.trim() : 'general';
  const buildRules = Array.isArray(input.buildRules) ? input.buildRules : [];
  const primaryRuleId = typeof input.primaryRuleId === 'string' && input.primaryRuleId.trim()
    ? input.primaryRuleId.trim()
    : input.primaryRuleId === null
      ? null
      : undefined;

  return {
    template,
    ...(
      typeof input.freeformBrief === 'string' || input.freeformBrief === null
        ? { freeformBrief: input.freeformBrief as string | null }
        : {}
    ),
    buildRules,
    ...(typeof primaryRuleId === 'undefined' ? {} : { primaryRuleId }),
  };
}
