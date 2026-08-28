import { createHash } from 'node:crypto';

import {
  ArenaMultiplayerGenerationSnapshotSchema,
  type ArenaMultiplayerGenerationSnapshot,
  type ArenaRoomSharedConfig,
  type DataCardRef,
} from '@mahoshojo/contracts/arena-room';
import type { ArenaRoomAuthorityState } from '@mahoshojo/multiplayer-core';

const canonicalJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
  );
};

const digestSnapshot = (snapshot: Omit<
  ArenaMultiplayerGenerationSnapshot,
  'snapshotDigest'
>): string => {
  const canonical = JSON.stringify(canonicalJsonValue(snapshot));
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
};

export const listArenaRoomGenerationRefs = (
  config: ArenaRoomSharedConfig,
): readonly DataCardRef[] => {
  const entries = [
    ...config.combatants,
    ...(config.scenario === null ? [] : [config.scenario]),
    ...config.auxScenarios,
    ...config.materials,
  ];
  const seen = new Set<string>();
  const refs: DataCardRef[] = [];
  for (const entry of entries) {
    if (!entry.key.startsWith('data-card:') || !('ref' in entry)) continue;
    const identity = JSON.stringify([entry.ref.id, entry.ref.kind, entry.ref.versionToken]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    refs.push(structuredClone(entry.ref));
  }
  return Object.freeze(refs);
};

export const createArenaRoomGenerationSnapshot = (
  state: ArenaRoomAuthorityState,
  generationRequestId: string,
): ArenaMultiplayerGenerationSnapshot => {
  const frozen = {
    roomId: state.snapshot.roomId,
    generationRequestId,
    configRevision: state.snapshot.revision,
    collaborativeInfluence: state.collaborativeChanges.length > 0,
    participantUserIds: state.memberAuthority
      .filter((record) => record.member.membershipState === 'active')
      .map((record) => record.accountUserId)
      .sort((left, right) => left - right),
    sharedConfig: structuredClone(state.snapshot.sharedConfig),
  };
  return ArenaMultiplayerGenerationSnapshotSchema.parse({
    ...frozen,
    snapshotDigest: digestSnapshot(frozen),
  });
};
