import type {
  ArenaRoomSharedConfig,
  DataCardRef,
} from '@mahoshojo/contracts/arena-room';

import {
  ArenaDataCardRefVerifierError,
  type ArenaDataCardRefVerifier,
} from './arena-data-card-ref-verifier';
import {
  ArenaRoomGenerationPresetResolverError,
  type ArenaRoomGenerationPresetResolver,
} from './room-generation-preset-registry';

export type ArenaRoomPresetRefVerifierErrorCode =
  | 'ARENA_ROOM_PRESET_REF_RESOLVER_UNAVAILABLE'
  | 'ARENA_ROOM_PRESET_REF_INPUT_INVALID'
  | 'ARENA_ROOM_PRESET_REF_NOT_FOUND'
  | 'ARENA_ROOM_PRESET_REF_VERSION_MISMATCH';

export class ArenaRoomPresetRefVerifierError extends Error {
  constructor(readonly code: ArenaRoomPresetRefVerifierErrorCode) {
    super(code);
    this.name = 'ArenaRoomPresetRefVerifierError';
  }
}

const uniqueRefs = (refs: readonly DataCardRef[]): readonly DataCardRef[] => {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const identity = JSON.stringify([ref.id, ref.kind, ref.versionToken]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

const sharedConfigEntries = (config: ArenaRoomSharedConfig) => [
  ...config.combatants,
  ...(config.scenario === null ? [] : [config.scenario]),
  ...config.auxScenarios,
  ...config.materials,
];

/** Returns every canonical online DataCard ref currently used by Shared Config. */
export const canonicalArenaRoomSharedConfigRefs = (
  config: ArenaRoomSharedConfig,
): readonly DataCardRef[] => {
  return uniqueRefs(sharedConfigEntries(config).flatMap((entry) => (
    entry.key.startsWith('data-card:') && 'ref' in entry ? [entry.ref] : []
  )));
};

export const canonicalArenaRoomSharedConfigPresetRefs = (
  config: ArenaRoomSharedConfig,
): readonly DataCardRef[] => uniqueRefs(sharedConfigEntries(config).flatMap((entry) => (
  entry.key.startsWith('preset:') && 'ref' in entry ? [entry.ref] : []
)));

export const verifyArenaRoomSharedConfigRefs = async (input: {
  readonly references?: ArenaDataCardRefVerifier;
  readonly sharedConfig: ArenaRoomSharedConfig;
  readonly hostAccountUserId: number;
}): Promise<void> => {
  const refs = canonicalArenaRoomSharedConfigRefs(input.sharedConfig);
  if (refs.length === 0) return;
  if (!input.references) {
    throw new ArenaDataCardRefVerifierError('ARENA_DATA_CARD_REF_D1_UNAVAILABLE');
  }
  await input.references.verify({
    refs,
    hostAccountUserId: input.hostAccountUserId,
  });
};

export const verifyArenaRoomSharedConfigPresetRefs = async (input: {
  readonly presets?: Pick<ArenaRoomGenerationPresetResolver, 'resolve'>;
  readonly sharedConfig: ArenaRoomSharedConfig;
}): Promise<void> => {
  const refs = canonicalArenaRoomSharedConfigPresetRefs(input.sharedConfig);
  if (refs.length === 0) return;
  if (!input.presets) {
    throw new ArenaRoomPresetRefVerifierError('ARENA_ROOM_PRESET_REF_RESOLVER_UNAVAILABLE');
  }
  for (const ref of refs) {
    try {
      await input.presets.resolve({ ref });
    } catch (error) {
      if (!(error instanceof ArenaRoomGenerationPresetResolverError)) throw error;
      switch (error.code) {
        case 'ARENA_ROOM_PRESET_INPUT_INVALID':
          throw new ArenaRoomPresetRefVerifierError('ARENA_ROOM_PRESET_REF_INPUT_INVALID');
        case 'ARENA_ROOM_PRESET_NOT_FOUND':
          throw new ArenaRoomPresetRefVerifierError('ARENA_ROOM_PRESET_REF_NOT_FOUND');
        case 'ARENA_ROOM_PRESET_VERSION_MISMATCH':
          throw new ArenaRoomPresetRefVerifierError('ARENA_ROOM_PRESET_REF_VERSION_MISMATCH');
        default:
          throw new ArenaRoomPresetRefVerifierError('ARENA_ROOM_PRESET_REF_RESOLVER_UNAVAILABLE');
      }
    }
  }
};
