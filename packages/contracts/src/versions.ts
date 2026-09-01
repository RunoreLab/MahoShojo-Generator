import { z } from './zod';

import { ArenaContractError } from './errors';

export const PROTOCOL_VERSION = 1 as const;
export const ROOM_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const PROPOSAL_VERSION = 1 as const;
export const GENERATION_BRIDGE_VERSION = 1 as const;

export const SUPPORTED_PEER_RANGE = Object.freeze({
  minInclusive: PROTOCOL_VERSION,
  maxInclusive: PROTOCOL_VERSION,
});

/** @deprecated Use SUPPORTED_PEER_RANGE; retained as a public compatibility alias. */
export const SUPPORTED_PEER_VERSION_RANGE = SUPPORTED_PEER_RANGE;

export const PeerVersionInfoSchema = z
  .object({
    protocolVersion: z.number().int(),
    roomSnapshotSchemaVersion: z.number().int(),
    proposalVersion: z.number().int(),
    generationBridgeVersion: z.number().int(),
  })
  .strict();

export type PeerVersionInfo = z.infer<typeof PeerVersionInfoSchema>;

export const isSupportedProtocolVersion = (version: number): boolean =>
  Number.isInteger(version) &&
  version >= SUPPORTED_PEER_RANGE.minInclusive &&
  version <= SUPPORTED_PEER_RANGE.maxInclusive;

export const isPeerVersionCompatible = (peer: unknown): boolean => {
  const parsed = PeerVersionInfoSchema.safeParse(peer);
  if (!parsed.success) return false;

  return (
    isSupportedProtocolVersion(parsed.data.protocolVersion) &&
    parsed.data.roomSnapshotSchemaVersion === ROOM_SNAPSHOT_SCHEMA_VERSION &&
    parsed.data.proposalVersion === PROPOSAL_VERSION &&
    parsed.data.generationBridgeVersion === GENERATION_BRIDGE_VERSION
  );
};

export const assertPeerVersionCompatible = (peer: unknown): PeerVersionInfo => {
  let parsed: PeerVersionInfo;
  try {
    parsed = PeerVersionInfoSchema.parse(peer);
  } catch (error) {
    throw new ArenaContractError('protocol-incompatible', 'invalid peer version info', undefined, error);
  }
  if (!isPeerVersionCompatible(parsed)) {
    throw new ArenaContractError('protocol-incompatible');
  }
  return parsed;
};
