import { ARENA_CANONICAL_CAPABILITIES } from './arena-capabilities';

/** Shared wire-contract safety ceilings. Runtime TTLs and alarm values do not belong here. */
export const MAX_ROOM_MEMBERS = 16;
export const MAX_COMBATANTS = ARENA_CANONICAL_CAPABILITIES.maxCombatants;
export const MAX_ARENA_REFERENCE_ITEMS = ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity;
export const MAX_PENDING_PROPOSALS_PER_MEMBER = 8;
export const MAX_PROPOSAL_CHANGES = 32;
export const MAX_CONTROL_MESSAGE_BYTES = 64 * 1024;
export const MAX_STORY_BATCH_BYTES = 64 * 1024;
// The payload limits above remain public for content producers. These limits
// cover the complete serialized wire frame, including its envelope.
export const MAX_CONTROL_FRAME_BYTES = MAX_CONTROL_MESSAGE_BYTES;
export const MAX_STORY_FRAME_BYTES = 64 * 1024;
export const MAX_GENERATION_BRIDGE_BATCH_BYTES = 64 * 1024;
export const MAX_PROPOSAL_BYTES = 64 * 1024;
export const MAX_CHARACTER_GUIDANCE_LENGTH = 100;
export const MAX_GLOBAL_GUIDANCE_LENGTH = 200;
/** @deprecated Use the cumulative MAX_ARENA_REFERENCE_ITEMS budget. */
export const MAX_AUX_SCENARIOS = MAX_ARENA_REFERENCE_ITEMS;
/** @deprecated Use the cumulative MAX_ARENA_REFERENCE_ITEMS budget. */
export const MAX_MATERIALS = MAX_ARENA_REFERENCE_ITEMS;
export const MAX_OPAQUE_KEY_LENGTH = 256;
export const MAX_DISPLAY_NAME_LENGTH = 200;
export const MAX_CUSTOM_STORY_LENGTH = 32;
export const MAX_HISTORY_LIMIT = 999;
export const MAX_ERROR_MESSAGE_LENGTH = 200;
export const MAX_REASON_LENGTH = 200;
export const MAX_SNAPSHOT_DIGEST_LENGTH = 256;
export const MAX_ROOM_ID_LENGTH = 256;
export const MAX_LANGUAGE_LENGTH = 64;
