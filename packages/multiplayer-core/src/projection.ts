import {
  ArenaRoomSnapshotSchema,
  parseArenaRoomSharedConfig,
  OpaqueKeySchema,
  RoomEventSchema,
  type ArenaRoomSnapshot,
  type ControlRoomEvent,
  type DataCardRef,
  type HostLocalCombatantStub,
  type HostLocalMaterialStub,
  type HostLocalScenarioStub,
  type SharedHistorySettings,
  type TeamAssignment,
  type ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import { deepClone, isRecord } from './utils';

/**
 * Minimal source contract for the projection boundary. A Web adapter may carry
 * extra local fields at runtime, but it must first normalize them to these
 * stable keys/refs; this package never guesses a BattleStore mapping.
 */
export interface ArenaRoomNormalizedSource {
  readonly battleMode: ArenaRoomSharedConfig['battleMode'];
  readonly combatants: readonly ({
    readonly key: string;
    readonly ref: DataCardRef;
    readonly characterGuidance?: string;
  } | HostLocalCombatantStub)[];
  readonly teams: readonly TeamAssignment[];
  readonly scenario: {
    readonly key: string;
    readonly ref: DataCardRef;
  } | HostLocalScenarioStub | null;
  readonly auxScenarios: readonly ({ readonly key: string; readonly ref: DataCardRef } | HostLocalScenarioStub)[];
  readonly materials: readonly ({ readonly key: string; readonly ref: DataCardRef } | HostLocalMaterialStub)[];
  readonly userGuidance: ArenaRoomSharedConfig['userGuidance'];
  readonly storyLength: ArenaRoomSharedConfig['storyLength'];
  readonly customStoryLength: ArenaRoomSharedConfig['customStoryLength'];
  readonly selectedLanguage: ArenaRoomSharedConfig['selectedLanguage'];
  readonly historySettings: SharedHistorySettings;
}

const projectDataCardRef = (value: unknown): Record<string, unknown> => {
  const source = isRecord(value) ? value : {};
  return {
    id: source.id,
    kind: source.kind,
    versionToken: source.versionToken,
  };
};

const projectCombatant = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  const key = value.key;
  if (typeof key === 'string' && key.startsWith('host-local:')) {
    const output: Record<string, unknown> = {
      key,
      displayName: value.displayName,
      type: value.type,
      source: 'host-local',
    };
    if (value.characterGuidance !== undefined) output.characterGuidance = value.characterGuidance;
    return output;
  }

  const output: Record<string, unknown> = {
    key,
    ref: projectDataCardRef(value.ref),
  };
  if (value.characterGuidance !== undefined) output.characterGuidance = value.characterGuidance;
  return output;
};

const projectScenarioOrMaterial = (value: unknown): unknown => {
  if (value === null) return null;
  if (!isRecord(value)) return value;
  const key = value.key;
  if (typeof key === 'string' && key.startsWith('host-local:')) {
    const output: Record<string, unknown> = {
      key,
      displayName: value.displayName,
      type: value.type,
      source: 'host-local',
    };
    if (value.guidance !== undefined) output.guidance = value.guidance;
    return output;
  }
  return {
    key,
    ref: projectDataCardRef(value.ref),
  };
};

const projectTeam = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  return {
    key: value.key,
    displayName: value.displayName,
    combatantKeys: Array.isArray(value.combatantKeys) ? [...value.combatantKeys] : value.combatantKeys,
  };
};

const projectHistorySettings = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  return {
    readArenaHistory: value.readArenaHistory,
    readArenaHistoryLimit: value.readArenaHistoryLimit,
    isArenaHistoryUnlimited: value.isArenaHistoryUnlimited,
    writeArenaHistory: value.writeArenaHistory,
    readCurrentState: value.readCurrentState,
    writeCurrentState: value.writeCurrentState,
    readNarrativeHistory: value.readNarrativeHistory,
    readNarrativeHistoryLimit: value.readNarrativeHistoryLimit,
    isNarrativeHistoryUnlimited: value.isNarrativeHistoryUnlimited,
    writeNarrativeHistory: value.writeNarrativeHistory,
  };
};

const projectConfig = (input: unknown): unknown => {
  if (!isRecord(input)) return input;
  return {
    battleMode: input.battleMode,
    combatants: Array.isArray(input.combatants) ? input.combatants.map(projectCombatant) : input.combatants,
    teams: Array.isArray(input.teams) ? input.teams.map(projectTeam) : input.teams,
    scenario: projectScenarioOrMaterial(input.scenario),
    auxScenarios: Array.isArray(input.auxScenarios) ? input.auxScenarios.map(projectScenarioOrMaterial) : input.auxScenarios,
    materials: Array.isArray(input.materials) ? input.materials.map(projectScenarioOrMaterial) : input.materials,
    userGuidance: input.userGuidance,
    storyLength: input.storyLength,
    customStoryLength: input.customStoryLength,
    selectedLanguage: input.selectedLanguage,
    historySettings: projectHistorySettings(input.historySettings),
  };
};

/**
 * Projects a local/normalized source into the strictly allowlisted room wire shape.
 * The projection deliberately constructs every nested object instead of deleting
 * suspected secrets from a copied object.
 */
export const buildArenaRoomSharedConfig = (input: ArenaRoomNormalizedSource): ArenaRoomSharedConfig => (
  parseArenaRoomSharedConfig(projectConfig(input))
);

/** Parses a wire config and returns a fully detached local working copy. */
export const applyArenaRoomSharedConfig = (input: unknown): ArenaRoomSharedConfig => {
  const parsed = parseArenaRoomSharedConfig(input);
  return deepClone(parsed);
};

const parseViewerUserId = (input: string): string | null => {
  const parsed = OpaqueKeySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
};

/**
 * Projects the public snapshot for one active room member. The authority
 * checkpoint remains unprojected; only this detached public copy is filtered.
 */
export const projectArenaRoomSnapshotForViewer = (
  input: unknown,
  viewerUserId: string,
): ArenaRoomSnapshot => {
  const snapshot = ArenaRoomSnapshotSchema.parse(input);
  const viewerId = parseViewerUserId(viewerUserId);
  const viewer = viewerId === null
    ? undefined
    : snapshot.members.find((member) => (
      member.userId === viewerId && member.membershipState === 'active'
    ));
  const proposals = viewer?.role === 'host'
    ? snapshot.proposals
    : viewerId === null
      ? []
      : snapshot.proposals.filter((proposal) => proposal.authorUserId === viewerId);

  return ArenaRoomSnapshotSchema.parse({
    ...deepClone(snapshot),
    proposals: deepClone(proposals),
  });
};

/**
 * Projects Proposal control events without creating a side-channel summary.
 * A Proposal hidden from a member is replaced by a room.snapshot carrying the
 * same controlSeq, so the viewer's control stream remains sequence-preserving.
 * The predecessor snapshot is optional and lets an author see their own
 * terminal proposal event without exposing another author's terminal ID.
 */
export const projectArenaRoomEventForViewer = (
  eventInput: unknown,
  snapshotInput: unknown,
  viewerUserId: string,
  predecessorSnapshotInput?: unknown,
): ControlRoomEvent => {
  const event = RoomEventSchema.parse(eventInput);
  const snapshot = ArenaRoomSnapshotSchema.parse(snapshotInput);
  if (event.roomId !== snapshot.roomId || event.roomEpoch !== snapshot.roomEpoch) {
    throw new Error('event and projection snapshot must identify the same room epoch');
  }

  if (event.type === 'room.snapshot') {
    return RoomEventSchema.parse({
      ...deepClone(event),
      payload: projectArenaRoomSnapshotForViewer(event.payload, viewerUserId),
    }) as ControlRoomEvent;
  }

  if (
    event.type !== 'proposal.submitted'
    && event.type !== 'proposal.updated'
    && event.type !== 'proposal.resolved'
  ) {
    return deepClone(event) as ControlRoomEvent;
  }

  const viewerId = parseViewerUserId(viewerUserId);
  const viewer = viewerId === null
    ? undefined
    : snapshot.members.find((member) => (
      member.userId === viewerId && member.membershipState === 'active'
    ));
  let proposalAuthorUserId: string | undefined;
  if (event.type === 'proposal.submitted' || event.type === 'proposal.updated') {
    proposalAuthorUserId = event.payload.proposal.authorUserId;
  } else if (predecessorSnapshotInput !== undefined) {
    const predecessor = ArenaRoomSnapshotSchema.parse(predecessorSnapshotInput);
    if (predecessor.roomId !== event.roomId || predecessor.roomEpoch !== event.roomEpoch) {
      throw new Error('event and predecessor snapshot must identify the same room epoch');
    }
    proposalAuthorUserId = predecessor.proposals.find(
      (proposal) => proposal.proposalId === event.payload.proposalId,
    )?.authorUserId;
  }

  const canViewProposal = viewer?.role === 'host'
    || (viewerId !== null && proposalAuthorUserId === viewerId);
  if (canViewProposal) return deepClone(event);

  const projectedSnapshot = projectArenaRoomSnapshotForViewer(snapshot, viewerUserId);
  return RoomEventSchema.parse({
    protocolVersion: event.protocolVersion,
    roomId: event.roomId,
    roomEpoch: event.roomEpoch,
    controlSeq: event.controlSeq,
    timestamp: event.timestamp,
    type: 'room.snapshot',
    payload: {
      ...projectedSnapshot,
      controlSeq: event.controlSeq,
    },
  }) as ControlRoomEvent;
};
