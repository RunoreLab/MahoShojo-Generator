const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
);

// Only these card-level fields represent trust, persistence identity or generation
// bookkeeping. An opaque user extension may itself contain e.g. `signature` or
// `templateId`; those nested keys are data and must not be recursively erased.
const DERIVED_CHARACTER_AUTHORITY_FIELDS = new Set([
  'signature', 'isNative', 'isPreset', 'isValid', 'isVerified', 'verificationStatus',
  'sourceDataCardId', 'sourceDataCardUpdatedAt', 'arenaRoomKey', 'adjudicationSourceKey',
  'permissions', 'generation_id', 'generationId', 'base_revision_hash',
  'created_at', 'updated_at', 'createdAt', 'updatedAt', 'generated_at', 'generatedAt',
]);

export const stripDerivedCharacterAuthority = (source: Record<string, unknown>): Record<string, unknown> => {
  const result = cloneJson(source);
  for (const key of DERIVED_CHARACTER_AUTHORITY_FIELDS) delete result[key];
  if (isObject(result.metadata)) {
    for (const key of DERIVED_CHARACTER_AUTHORITY_FIELDS) delete result.metadata[key];
  }
  return result;
};

