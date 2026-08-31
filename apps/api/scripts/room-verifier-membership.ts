import type { ArenaDataCardRefVerifier } from '../src/arena-room/arena-data-card-ref-verifier';
import {
  createArenaRoomMembershipService,
  type ArenaRoomMembershipServiceOptions,
} from '../src/arena-room/room-membership-service';
import { createArenaRoomGenerationPresetResolver } from '../src/arena-room/room-generation-preset-registry';

const verifierReferences: ArenaDataCardRefVerifier = Object.freeze({
  verify: async ({ refs }) => refs,
});

const verifierPresets = createArenaRoomGenerationPresetResolver();

/**
 * Local verifier composition root. Durable verifiers exercise Room/Redis
 * semantics without a D1 gateway, but must still satisfy the same fail-closed
 * membership dependencies as production.
 */
export const createRoomVerifierMembershipService = (
  options: Omit<ArenaRoomMembershipServiceOptions, 'references' | 'presets'>,
) => createArenaRoomMembershipService({
  ...options,
  references: verifierReferences,
  presets: verifierPresets,
});
