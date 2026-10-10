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

/** Copy only the locations whose fields change; opaque nested values remain references. */
export const planDerivedCharacterAuthorityRemoval = (source: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const result = { ...source };
  for (const key of DERIVED_CHARACTER_AUTHORITY_FIELDS) delete result[key];
  if (isObject(result.metadata)) {
    const metadata = { ...result.metadata };
    for (const key of DERIVED_CHARACTER_AUTHORITY_FIELDS) delete metadata[key];
    result.metadata = metadata;
  }
  return result;
};

/** Preserve the existing independent JSON-copy API for callers that edit its result. */
export const stripDerivedCharacterAuthority = (source: Record<string, unknown>): Record<string, unknown> => (
  planDerivedCharacterAuthorityRemoval(cloneJson(source))
);
