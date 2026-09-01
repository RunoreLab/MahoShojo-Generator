/**
 * Client opt-in header for Arena Room granular error taxonomy negotiation.
 * Version 2 negotiated responses replace the ambiguous host-local combined error.
 * The legacy code remains parseable for rolling compatibility with v1 clients.
 */
export const ARENA_ROOM_ERROR_TAXONOMY_HEADER = 'x-mahoshojo-arena-error-taxonomy' as const;
export const ARENA_ROOM_ERROR_TAXONOMY_VERSION = '2' as const;

export const ARENA_ROOM_HTTP_ERROR_CODES = [
  'ROOM_AUTHENTICATION_REQUIRED',
  'ROOM_AUTHENTICATION_DENIED',
  'ROOM_FORBIDDEN',
  'ROOM_NOT_FOUND',
  'ROOM_PAYLOAD_TOO_LARGE',
  'ROOM_REQUEST_INVALID',
  'ROOM_CONFLICT',
  'ROOM_RATE_LIMITED',
  'ROOM_UNAVAILABLE',
  'ROOM_GENERATION_COMBATANTS_EMPTY',
  'ROOM_GENERATION_COMBATANTS_INSUFFICIENT',
  'ROOM_GENERATION_SCENARIO_REQUIRED',
  'ROOM_GENERATION_COMBATANT_LIMIT',
  'ROOM_GENERATION_RANDOM_COMBATANT_UNRESOLVED',
  'ROOM_GENERATION_RECONCILIATION_REQUIRED',
  'ROOM_MEMBER_LIMIT_REACHED',
  'ROOM_PROPOSAL_PENDING_LIMIT_REACHED',
  'ROOM_PROPOSAL_CHANGE_LIMIT',
  'ROOM_PROPOSAL_BYTE_LIMIT',
  'ROOM_CONFIG_FRAME_TOO_LARGE',
  'ROOM_CONFIG_SHAREABILITY_INVALID',
  'ROOM_CONFIG_COMBATANT_LIMIT',
  'ROOM_CONFIG_REFERENCE_LIMIT',
  'ROOM_HOST_LOCAL_PAYLOAD_MISSING',
  'ROOM_HOST_LOCAL_PAYLOAD_INVALID',
  'ROOM_HOST_LOCAL_KIND_MISMATCH',
  'ROOM_HOST_LOCAL_DIGEST_MISMATCH',
  'ROOM_HOST_LOCAL_TYPE_MISMATCH',
  /** @deprecated v1 compatibility response; v2 clients receive a specific host-local code. */
  'ROOM_HOST_LOCAL_PAYLOAD_MISSING_OR_MISMATCH',
  'ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING',
  'ROOM_HOST_LOCAL_CONTENT_VERSION_MISMATCH',
  'ROOM_REFERENCE_VERSION_MISSING',
  'ROOM_REFERENCE_STALE',
  'ROOM_REFERENCE_DENIED',
  'ROOM_RUNTIME_BODY_LIMIT',
  'ROOM_RUNTIME_REFERENCE_LIMIT',
  'ROOM_RUNTIME_ADJUDICATION_LIMIT',
  'ROOM_RUNTIME_PROMPT_BUDGET_EXCEEDED',
  'ROOM_PROVIDER_CONFIG_INVALID',
] as const;
export type ArenaRoomHttpErrorCode = typeof ARENA_ROOM_HTTP_ERROR_CODES[number];

export const ARENA_ROOM_HOSTED_ERROR_CODES = [
  'ARENA_REQUEST_TOO_LARGE',
  'ARENA_PARTICIPANTS_LIMIT',
  'ARENA_REFERENCE_ITEMS_LIMIT',
  'ARENA_ADJUDICATION_EVENTS_LIMIT',
  'ARENA_PROMPT_BUDGET_EXCEEDED',
  'ARENA_SAFETY_PROMPT_BUDGET_EXCEEDED',
  'ARENA_CUSTOM_PROVIDER_INVALID',
  'ARENA_PROVIDER_UNKNOWN',
  'ARENA_MODEL_UNKNOWN',
  'ARENA_PROVIDER_KEY_EMPTY',
  'ARENA_PARTICIPANTS_INVALID',
  'ARENA_PVP_CONTEXT_INVALID',
  'ARENA_MULTIPLAYER_SNAPSHOT_INVALID',
  'ARENA_MATERIALIZATION_VERSION_UNSUPPORTED',
  'ARENA_CONTENT_POLICY_REJECTED',
  'GENERATION_REQUEST_CONFLICT',
] as const;
export type ArenaRoomHostedErrorCode = typeof ARENA_ROOM_HOSTED_ERROR_CODES[number];

const taxonomyEntry = <
  const DomainCode extends string,
  const HttpCode extends ArenaRoomHttpErrorCode,
  const HostedCodes extends readonly ArenaRoomHostedErrorCode[],
>(entry: Readonly<{
  domainCode: DomainCode;
  httpCode: HttpCode;
  hostedCodes: HostedCodes;
}>) => Object.freeze(entry);

/**
 * Public mapping from domain failures to Room HTTP codes and, when relevant,
 * the lower Hosted runtime errors which are intentionally collapsed into it.
 */
export const ARENA_ROOM_ERROR_TAXONOMY = Object.freeze([
  taxonomyEntry({ domainCode: 'AUTHENTICATION_REQUIRED', httpCode: 'ROOM_AUTHENTICATION_REQUIRED', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'AUTHENTICATION_DENIED', httpCode: 'ROOM_AUTHENTICATION_DENIED', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'FORBIDDEN', httpCode: 'ROOM_FORBIDDEN', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'ROOM_NOT_FOUND', httpCode: 'ROOM_NOT_FOUND', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'PAYLOAD_TOO_LARGE', httpCode: 'ROOM_PAYLOAD_TOO_LARGE', hostedCodes: [] }),
  taxonomyEntry({
    domainCode: 'REQUEST_INVALID',
    httpCode: 'ROOM_REQUEST_INVALID',
    hostedCodes: [
      'ARENA_PARTICIPANTS_INVALID',
      'ARENA_PVP_CONTEXT_INVALID',
      'ARENA_MULTIPLAYER_SNAPSHOT_INVALID',
      'ARENA_MATERIALIZATION_VERSION_UNSUPPORTED',
    ],
  }),
  taxonomyEntry({
    domainCode: 'CONFLICT',
    httpCode: 'ROOM_CONFLICT',
    hostedCodes: ['ARENA_CONTENT_POLICY_REJECTED', 'GENERATION_REQUEST_CONFLICT'],
  }),
  taxonomyEntry({ domainCode: 'RATE_LIMITED', httpCode: 'ROOM_RATE_LIMITED', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'UNAVAILABLE', httpCode: 'ROOM_UNAVAILABLE', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'GENERATION_COMBATANTS_EMPTY', httpCode: 'ROOM_GENERATION_COMBATANTS_EMPTY', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'GENERATION_COMBATANTS_INSUFFICIENT', httpCode: 'ROOM_GENERATION_COMBATANTS_INSUFFICIENT', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'GENERATION_SCENARIO_REQUIRED', httpCode: 'ROOM_GENERATION_SCENARIO_REQUIRED', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'GENERATION_COMBATANT_LIMIT', httpCode: 'ROOM_GENERATION_COMBATANT_LIMIT', hostedCodes: ['ARENA_PARTICIPANTS_LIMIT'] }),
  taxonomyEntry({ domainCode: 'RANDOM_COMBATANT_UNRESOLVED', httpCode: 'ROOM_GENERATION_RANDOM_COMBATANT_UNRESOLVED', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'GENERATION_RECONCILIATION_REQUIRED', httpCode: 'ROOM_GENERATION_RECONCILIATION_REQUIRED', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'MEMBER_LIMIT_REACHED', httpCode: 'ROOM_MEMBER_LIMIT_REACHED', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'PROPOSAL_PENDING_LIMIT_REACHED', httpCode: 'ROOM_PROPOSAL_PENDING_LIMIT_REACHED', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'PROPOSAL_CHANGE_LIMIT', httpCode: 'ROOM_PROPOSAL_CHANGE_LIMIT', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'PROPOSAL_BYTE_LIMIT', httpCode: 'ROOM_PROPOSAL_BYTE_LIMIT', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'CONFIG_FRAME_TOO_LARGE', httpCode: 'ROOM_CONFIG_FRAME_TOO_LARGE', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'CONFIG_SHAREABILITY_INVALID', httpCode: 'ROOM_CONFIG_SHAREABILITY_INVALID', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'CONFIG_COMBATANT_LIMIT', httpCode: 'ROOM_CONFIG_COMBATANT_LIMIT', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'CONFIG_REFERENCE_LIMIT', httpCode: 'ROOM_CONFIG_REFERENCE_LIMIT', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'HOST_LOCAL_PAYLOAD_MISSING', httpCode: 'ROOM_HOST_LOCAL_PAYLOAD_MISSING', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'HOST_LOCAL_PAYLOAD_INVALID', httpCode: 'ROOM_HOST_LOCAL_PAYLOAD_INVALID', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'HOST_LOCAL_KIND_MISMATCH', httpCode: 'ROOM_HOST_LOCAL_KIND_MISMATCH', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'HOST_LOCAL_DIGEST_MISMATCH', httpCode: 'ROOM_HOST_LOCAL_DIGEST_MISMATCH', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'HOST_LOCAL_TYPE_MISMATCH', httpCode: 'ROOM_HOST_LOCAL_TYPE_MISMATCH', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'HOST_LOCAL_PAYLOAD_MISSING_OR_MISMATCH_LEGACY', httpCode: 'ROOM_HOST_LOCAL_PAYLOAD_MISSING_OR_MISMATCH', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'HOST_LOCAL_CONTENT_VERSION_MISSING', httpCode: 'ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'HOST_LOCAL_CONTENT_VERSION_MISMATCH', httpCode: 'ROOM_HOST_LOCAL_CONTENT_VERSION_MISMATCH', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'REFERENCE_VERSION_MISSING', httpCode: 'ROOM_REFERENCE_VERSION_MISSING', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'REFERENCE_STALE', httpCode: 'ROOM_REFERENCE_STALE', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'REFERENCE_DENIED', httpCode: 'ROOM_REFERENCE_DENIED', hostedCodes: [] }),
  taxonomyEntry({ domainCode: 'RUNTIME_BODY_LIMIT', httpCode: 'ROOM_RUNTIME_BODY_LIMIT', hostedCodes: ['ARENA_REQUEST_TOO_LARGE'] }),
  taxonomyEntry({ domainCode: 'RUNTIME_REFERENCE_LIMIT', httpCode: 'ROOM_RUNTIME_REFERENCE_LIMIT', hostedCodes: ['ARENA_REFERENCE_ITEMS_LIMIT'] }),
  taxonomyEntry({ domainCode: 'RUNTIME_ADJUDICATION_LIMIT', httpCode: 'ROOM_RUNTIME_ADJUDICATION_LIMIT', hostedCodes: ['ARENA_ADJUDICATION_EVENTS_LIMIT'] }),
  taxonomyEntry({
    domainCode: 'RUNTIME_PROMPT_BUDGET_EXCEEDED',
    httpCode: 'ROOM_RUNTIME_PROMPT_BUDGET_EXCEEDED',
    hostedCodes: ['ARENA_PROMPT_BUDGET_EXCEEDED', 'ARENA_SAFETY_PROMPT_BUDGET_EXCEEDED'],
  }),
  taxonomyEntry({
    domainCode: 'PROVIDER_CONFIG_INVALID',
    httpCode: 'ROOM_PROVIDER_CONFIG_INVALID',
    hostedCodes: [
      'ARENA_CUSTOM_PROVIDER_INVALID',
      'ARENA_PROVIDER_UNKNOWN',
      'ARENA_MODEL_UNKNOWN',
      'ARENA_PROVIDER_KEY_EMPTY',
    ],
  }),
] as const);

export type ArenaRoomDomainErrorCode = typeof ARENA_ROOM_ERROR_TAXONOMY[number]['domainCode'];
