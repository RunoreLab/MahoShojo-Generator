import type {
  ArenaRoomSharedConfig,
  DataCardRef,
} from '@mahoshojo/contracts/arena-room';

import {
  ArenaDataCardRefVerifierError,
  type ArenaDataCardRefVerifier,
} from './arena-data-card-ref-verifier';

const uniqueRefs = (refs: readonly DataCardRef[]): readonly DataCardRef[] => {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const identity = JSON.stringify([ref.id, ref.kind, ref.versionToken]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

/** Returns every canonical online DataCard ref currently used by Shared Config. */
export const canonicalArenaRoomSharedConfigRefs = (
  config: ArenaRoomSharedConfig,
): readonly DataCardRef[] => {
  const entries = [
    ...config.combatants,
    ...(config.scenario === null ? [] : [config.scenario]),
    ...config.auxScenarios,
    ...config.materials,
  ];
  return uniqueRefs(entries.flatMap((entry) => (
    entry.key.startsWith('data-card:') && 'ref' in entry ? [entry.ref] : []
  )));
};

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
