import { createHash } from 'node:crypto';

import {
  ArenaRoomHostLocalPayloadSchema,
  ArenaRoomHostRuntimeGenerationSchema,
  ArenaRoomSharedConfigSchema,
  type ArenaRoomHostLocalPayload,
  type ArenaRoomHostRuntimeGeneration,
  type ArenaRoomSharedConfig,
  type DataCardRef,
} from '@mahoshojo/contracts/arena-room';
import { inferCharacterKind } from '@mahoshojo/domain/data-cards';

export type ArenaRoomGenerationMaterializationErrorCode =
  | 'ARENA_ROOM_GENERATION_CONFIG_INVALID'
  | 'ARENA_ROOM_HOST_IDENTITY_INVALID'
  | 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_MISSING'
  | 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_INVALID'
  | 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_KIND_MISMATCH'
  | 'ARENA_ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING'
  | 'ARENA_ROOM_HOST_LOCAL_CONTENT_VERSION_MISMATCH'
  | 'ARENA_ROOM_HOST_LOCAL_PAYLOAD_TYPE_MISMATCH'
  | 'ARENA_ROOM_HOST_RUNTIME_INVALID'
  | 'ARENA_ROOM_REFERENCE_CONTENT_INVALID'
  | 'ARENA_ROOM_REFERENCE_STALE';

export type ArenaRoomGenerationMaterializationTarget = Readonly<{
  kind: 'room' | 'combatant' | 'scenario' | 'material';
  displayName?: string;
}>;

export class ArenaRoomGenerationMaterializationError extends Error {
  constructor(
    readonly code: ArenaRoomGenerationMaterializationErrorCode,
    readonly target?: ArenaRoomGenerationMaterializationTarget,
  ) {
    super(code);
    this.name = 'ArenaRoomGenerationMaterializationError';
  }
}

export type ArenaRoomGenerationCanonicalContent = Readonly<{
  ref: DataCardRef;
  payload: Readonly<Record<string, unknown>>;
  displayName: string;
  sourceType?: string;
}>;

export type ArenaRoomGenerationContentResolver = Readonly<{
  resolveOnline(input: Readonly<{
    ref: DataCardRef;
    hostAccountUserId: number;
  }>): Promise<ArenaRoomGenerationCanonicalContent>;
  resolvePreset(input: Readonly<{
    ref: DataCardRef;
  }>): Promise<ArenaRoomGenerationCanonicalContent>;
}>;

export type ArenaRoomGenerationMaterializer = Readonly<{
  materialize(input: Readonly<{
    sharedConfig: ArenaRoomSharedConfig;
    hostAccountUserId: number;
    hostLocalPayloads: readonly ArenaRoomHostLocalPayload[];
    hostRuntime: ArenaRoomHostRuntimeGeneration;
  }>): Promise<Readonly<Record<string, unknown>>>;
}>;

const fail = (
  code: ArenaRoomGenerationMaterializationErrorCode,
  target?: ArenaRoomGenerationMaterializationTarget,
): never => {
  throw new ArenaRoomGenerationMaterializationError(code, target);
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const canonicalRefMatches = (left: DataCardRef, right: DataCardRef): boolean => (
  left.id === right.id
  && left.kind === right.kind
  && left.versionToken === right.versionToken
);

const canonicalJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => [key, canonicalJsonValue((value as Record<string, unknown>)[key])]));
};

const contentVersion = (payload: Readonly<Record<string, unknown>>): string => (
  `sha256:${createHash('sha256').update(JSON.stringify(canonicalJsonValue(payload))).digest('hex')}`
);

const characterType = (payload: unknown): 'magical-girl' | 'canshou' | 'general-character' => {
  switch (inferCharacterKind(payload)) {
    case 'magical-girl': return 'magical-girl';
    case 'canshou': return 'canshou';
    case 'general': return 'general-character';
    case 'unknown': return fail('ARENA_ROOM_REFERENCE_CONTENT_INVALID');
  }
};

const fileName = (displayName: string): string => (
  displayName.toLowerCase().endsWith('.json') ? displayName : `${displayName}.json`
);

const parseDisplayName = (value: unknown): string => {
  if (typeof value !== 'string') return fail('ARENA_ROOM_REFERENCE_CONTENT_INVALID');
  const normalized = value.trim();
  if (normalized.length === 0) return fail('ARENA_ROOM_REFERENCE_CONTENT_INVALID');
  return normalized;
};

type SharedEntry = ArenaRoomSharedConfig['combatants'][number]
  | Exclude<ArenaRoomSharedConfig['scenario'], null>
  | ArenaRoomSharedConfig['auxScenarios'][number]
  | ArenaRoomSharedConfig['materials'][number];

const targetForEntry = (entry: SharedEntry): ArenaRoomGenerationMaterializationTarget => {
  if ('source' in entry) {
    if (entry.type === 'scenario') return { kind: 'scenario', displayName: entry.displayName };
    if (entry.type === 'material') return { kind: 'material', displayName: entry.displayName };
    return { kind: 'combatant', displayName: entry.displayName };
  }
  switch (entry.ref.kind) {
    case 'character': return { kind: 'combatant' };
    case 'scenario': return { kind: 'scenario' };
    case 'material': return { kind: 'material' };
  }
};

type ResolvedEntry = Readonly<{
  payload: Readonly<Record<string, unknown>>;
  displayName: string;
  source: 'online' | 'preset' | 'host-local';
  ref?: DataCardRef;
  sourceType: string;
}>;

export const createArenaRoomGenerationMaterializer = (
  options: Readonly<{ content: ArenaRoomGenerationContentResolver }>,
): ArenaRoomGenerationMaterializer => {
  const resolveCanonical = async (
    entry: { readonly key: string; readonly ref: DataCardRef },
    hostAccountUserId: number,
  ): Promise<ResolvedEntry> => {
    const source = entry.key.startsWith('data-card:') ? 'online'
      : entry.key.startsWith('preset:') ? 'preset'
        : fail('ARENA_ROOM_REFERENCE_CONTENT_INVALID');
    const resolved = source === 'online'
      ? await options.content.resolveOnline({ ref: entry.ref, hostAccountUserId })
      : await options.content.resolvePreset({ ref: entry.ref });
    if (!canonicalRefMatches(resolved.ref, entry.ref)) {
      return fail('ARENA_ROOM_REFERENCE_STALE');
    }
    if (!isPlainRecord(resolved.payload)) {
      return fail('ARENA_ROOM_REFERENCE_CONTENT_INVALID');
    }
    return Object.freeze({
      payload: resolved.payload,
      displayName: parseDisplayName(resolved.displayName),
      source,
      ref: resolved.ref,
      sourceType: resolved.sourceType?.trim() || resolved.ref.kind,
    });
  };

  return Object.freeze({
    async materialize(input) {
      const configResult = ArenaRoomSharedConfigSchema.safeParse(input.sharedConfig);
      if (!configResult.success) return fail('ARENA_ROOM_GENERATION_CONFIG_INVALID');
      if (!Number.isSafeInteger(input.hostAccountUserId) || input.hostAccountUserId <= 0) {
        return fail('ARENA_ROOM_HOST_IDENTITY_INVALID');
      }
      const runtimeResult = ArenaRoomHostRuntimeGenerationSchema.safeParse(input.hostRuntime);
      if (!runtimeResult.success) return fail('ARENA_ROOM_HOST_RUNTIME_INVALID');
      if (!Array.isArray(input.hostLocalPayloads)) {
        return fail('ARENA_ROOM_HOST_LOCAL_PAYLOAD_INVALID');
      }
      const localPayloads: ArenaRoomHostLocalPayload[] = [];
      for (const payload of input.hostLocalPayloads) {
        const parsed = ArenaRoomHostLocalPayloadSchema.safeParse(payload);
        if (!parsed.success) return fail('ARENA_ROOM_HOST_LOCAL_PAYLOAD_INVALID');
        localPayloads.push(parsed.data);
      }
      const localByKey = new Map<string, ArenaRoomHostLocalPayload>();
      for (const payload of localPayloads) {
        if (localByKey.has(payload.key)) {
          return fail('ARENA_ROOM_HOST_LOCAL_PAYLOAD_INVALID', { kind: 'room' });
        }
        localByKey.set(payload.key, payload);
      }

      const config = configResult.data;
      const expectedLocalKinds = new Map<string, Readonly<{
        kind: DataCardRef['kind'];
        target: ArenaRoomGenerationMaterializationTarget;
      }>>();
      const expectLocalKind = (entry: SharedEntry, kind: DataCardRef['kind']): void => {
        const key = entry.key;
        if (expectedLocalKinds.has(key)) {
          return fail('ARENA_ROOM_HOST_LOCAL_PAYLOAD_INVALID', { kind: 'room' });
        }
        expectedLocalKinds.set(key, { kind, target: targetForEntry(entry) });
      };
      for (const combatant of config.combatants) {
        if ('source' in combatant) expectLocalKind(combatant, 'character');
      }
      if (config.scenario && 'source' in config.scenario) {
        expectLocalKind(config.scenario, 'scenario');
      }
      for (const scenario of config.auxScenarios) {
        if ('source' in scenario) expectLocalKind(scenario, 'scenario');
      }
      for (const material of config.materials) {
        if ('source' in material) expectLocalKind(material, 'material');
      }
      for (const [key, expected] of expectedLocalKinds) {
        if (!localByKey.has(key)) {
          return fail('ARENA_ROOM_HOST_LOCAL_PAYLOAD_MISSING', expected.target);
        }
      }
      if ([...localByKey.keys()].some((key) => !expectedLocalKinds.has(key))) {
        return fail('ARENA_ROOM_HOST_LOCAL_PAYLOAD_INVALID', { kind: 'room' });
      }
      for (const [key, expected] of expectedLocalKinds) {
        if (localByKey.get(key)?.kind !== expected.kind) {
          return fail('ARENA_ROOM_HOST_LOCAL_PAYLOAD_KIND_MISMATCH', expected.target);
        }
      }

      const resolveEntry = async (
        entry: SharedEntry,
      ): Promise<ResolvedEntry> => {
        if ('ref' in entry) return resolveCanonical(entry, input.hostAccountUserId);
        const local = localByKey.get(entry.key);
        const target = targetForEntry(entry);
        if (!local) {
          return fail('ARENA_ROOM_HOST_LOCAL_PAYLOAD_MISSING', target);
        }
        if (!isPlainRecord(local.payload)) {
          return fail('ARENA_ROOM_HOST_LOCAL_PAYLOAD_INVALID', target);
        }
        if (entry.contentVersion === undefined) {
          return fail('ARENA_ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING', target);
        }
        if (contentVersion(local.payload) !== entry.contentVersion) {
          return fail('ARENA_ROOM_HOST_LOCAL_CONTENT_VERSION_MISMATCH', target);
        }
        return Object.freeze({
          payload: local.payload,
          displayName: entry.displayName,
          source: 'host-local',
          sourceType: entry.type,
        });
      };

      const teamIds = new Map<string, number>();
      config.teams.forEach((team, index) => {
        for (const combatantKey of team.combatantKeys) teamIds.set(combatantKey, index + 1);
      });
      const resolvedCombatants = await Promise.all(config.combatants.map(resolveEntry));
      const combatants = resolvedCombatants.map((resolved, index) => {
        const entry = config.combatants[index]!;
        const inferred = characterType(resolved.payload);
        if ('source' in entry && inferred !== entry.type) {
          return fail('ARENA_ROOM_HOST_LOCAL_PAYLOAD_TYPE_MISMATCH', targetForEntry(entry));
        }
        return Object.freeze({
          roomCombatantKey: entry.key,
          type: inferred,
          data: resolved.payload,
          // Shared Config only carries stable content identity, not a verified
          // signature verdict. Ordinary generation admits every source; strict
          // ranking must never infer native provenance from admission alone.
          isNative: resolved.source === 'preset',
          isPreset: resolved.source === 'preset',
          filename: resolved.source === 'preset' && 'ref' in entry ? entry.ref.id : null,
          teamId: teamIds.get(entry.key) ?? null,
          characterGuidance: entry.characterGuidance ?? null,
          ...(resolved.source === 'online' && resolved.ref ? {
            sourceDataCardId: resolved.ref.id,
            sourceDataCardUpdatedAt: resolved.ref.versionToken,
          } : {}),
        });
      });
      const teams: Record<number, string[]> = {};
      const teamNames: Record<number, string> = {};
      config.teams.forEach((team, index) => {
        const id = index + 1;
        teams[id] = team.combatantKeys.map((key) => {
          const combatantIndex = config.combatants.findIndex((entry) => entry.key === key);
          return resolvedCombatants[combatantIndex]!.displayName;
        });
        teamNames[id] = team.displayName;
      });

      const scenarioEntry = config.battleMode === 'scenario' ? config.scenario : null;
      const resolvedScenario = scenarioEntry ? await resolveEntry(scenarioEntry) : null;
      const resolvedAuxScenarios = config.battleMode === 'scenario'
        ? await Promise.all(config.auxScenarios.map(resolveEntry))
        : [];
      const resolvedMaterials = await Promise.all(config.materials.map(resolveEntry));
      const history = config.historySettings;
      const arenaHistoryReadLimit = history.readArenaHistory
        ? (history.isArenaHistoryUnlimited ? null : history.readArenaHistoryLimit)
        : undefined;
      const narrativeHistoryReadLimit = history.readNarrativeHistory
        ? (history.isNarrativeHistoryUnlimited ? null : history.readNarrativeHistoryLimit)
        : undefined;

      return Object.freeze({
        ...runtimeResult.data,
        combatants,
        mode: config.battleMode,
        userGuidance: config.userGuidance,
        ...(resolvedScenario && scenarioEntry ? {
          scenario: resolvedScenario.payload,
          scenarioTitle: resolvedScenario.displayName,
          scenarioFileName: resolvedScenario.source === 'preset'
            && 'ref' in scenarioEntry
            ? scenarioEntry.ref.id
            : fileName(resolvedScenario.displayName),
          ...(resolvedScenario.source === 'online' && resolvedScenario.ref ? {
            scenarioSourceDataCardId: resolvedScenario.ref.id,
            scenarioSourceDataCardUpdatedAt: resolvedScenario.ref.versionToken,
          } : {}),
        } : {}),
        ...(resolvedAuxScenarios.length > 0
          ? { auxScenarios: resolvedAuxScenarios.map((entry) => entry.payload) }
          : {}),
        ...(resolvedMaterials.length > 0 ? {
          materials: resolvedMaterials.map((resolved, index) => {
            const entry = config.materials[index]!;
            return Object.freeze({
              id: resolved.source === 'online' && resolved.ref
                ? resolved.ref.id
                : entry.key,
              name: resolved.displayName,
              content: resolved.payload,
              fileName: resolved.source === 'preset' && 'ref' in entry ? entry.ref.id : null,
              sourceKind: resolved.source === 'online' ? 'mahoshojo-data-card' : 'raw-json',
              sourceType: resolved.sourceType,
              isNative: resolved.source === 'preset',
              ...(resolved.source === 'online' && resolved.ref ? {
                sourceDataCardId: resolved.ref.id,
                sourceDataCardUpdatedAt: resolved.ref.versionToken,
              } : {}),
            });
          }),
        } : {}),
        ...(Object.keys(teams).length > 0 ? { teams, teamNames } : {}),
        language: config.selectedLanguage,
        readArenaHistory: history.readArenaHistory,
        ...(arenaHistoryReadLimit === undefined ? {} : { arenaHistoryReadLimit }),
        writeArenaHistory: history.writeArenaHistory,
        readCurrentState: history.readCurrentState,
        writeCurrentState: history.writeCurrentState,
        readNarrativeHistory: history.readNarrativeHistory,
        writeNarrativeHistory: history.writeNarrativeHistory,
        ...(narrativeHistoryReadLimit === undefined ? {} : { narrativeHistoryReadLimit }),
        storyLength: config.storyLength,
        ...(config.customStoryLength === null ? {} : {
          customStoryLength: config.customStoryLength,
        }),
      });
    },
  });
};
