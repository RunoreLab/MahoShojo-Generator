import {
  ArenaRoomHostLocalPayloadSchema,
  ArenaRoomSharedConfigSchema,
  type ArenaRoomHostLocalPayload,
  type ArenaRoomSessionResponse,
  type ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import type { ArenaRoomHostWorkspaceBundle } from './shared-config';

export type ArenaRoomHostWorkspaceAuthority = Readonly<{
  roomId: string;
  roomEpoch: string;
  revision: number;
  ownerUserId: string;
  sharedConfig: ArenaRoomSharedConfig;
}>;

export type ArenaRoomGenerationStartInputs = Readonly<{
  sharedConfig: ArenaRoomSharedConfig;
  hostLocalPayloads: readonly ArenaRoomHostLocalPayload[];
}>;

export type ArenaRoomHostWorkspaceDirtyReason =
  | 'baseline-missing'
  | 'host-local-content'
  | 'shared-config';

export type ArenaRoomHostWorkspaceComparison =
  | Readonly<{
      kind: 'clean';
      start: ArenaRoomGenerationStartInputs;
    }>
  | Readonly<{
      kind: 'dirty';
      reasons: readonly ArenaRoomHostWorkspaceDirtyReason[];
      current: ArenaRoomGenerationStartInputs;
      room: ArenaRoomGenerationStartInputs | null;
    }>;

export type ArenaRoomHostWorkspace = Readonly<{
  capturePublished(
    authority: ArenaRoomHostWorkspaceAuthority,
    bundle: ArenaRoomHostWorkspaceBundle,
  ): void;
  compare(
    authority: ArenaRoomHostWorkspaceAuthority,
    bundle: ArenaRoomHostWorkspaceBundle,
  ): ArenaRoomHostWorkspaceComparison;
  retainFor(authority: ArenaRoomHostWorkspaceAuthority | null): void;
  clear(): void;
}>;

export const arenaRoomHostWorkspaceAuthorityFromSession = (
  session: ArenaRoomSessionResponse | null,
): ArenaRoomHostWorkspaceAuthority | null => {
  if (!session || session.self.role !== 'host') return null;
  return Object.freeze({
    roomId: session.roomId,
    roomEpoch: session.roomEpoch,
    revision: session.snapshot.revision,
    ownerUserId: session.self.userId,
    sharedConfig: session.snapshot.sharedConfig,
  });
};

type Baseline = Readonly<{
  roomId: string;
  roomEpoch: string;
  ownerUserId: string;
  payloads: readonly ArenaRoomHostLocalPayload[];
  digests: ReadonlyMap<string, string>;
}>;

type DataCardKind = ArenaRoomHostLocalPayload['kind'];

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, entry]) => [key, canonicalize(entry)]));
};

const sameConfig = (left: ArenaRoomSharedConfig, right: ArenaRoomSharedConfig): boolean => (
  JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
);

export const areArenaRoomSharedConfigsEqual = sameConfig;

const sameAuthorityOwner = (
  baseline: Baseline,
  authority: ArenaRoomHostWorkspaceAuthority,
): boolean => (
  baseline.roomId === authority.roomId
  && baseline.roomEpoch === authority.roomEpoch
  && baseline.ownerUserId === authority.ownerUserId
);

const expectedLocalKinds = (
  config: ArenaRoomSharedConfig,
): ReadonlyMap<string, DataCardKind> | null => {
  const expected = new Map<string, DataCardKind>();
  const add = (key: string, kind: DataCardKind): boolean => {
    if (expected.has(key)) return false;
    expected.set(key, kind);
    return true;
  };
  for (const combatant of config.combatants) {
    if ('source' in combatant && !add(combatant.key, 'character')) return null;
  }
  if (config.scenario && 'source' in config.scenario) {
    if (!add(config.scenario.key, 'scenario')) return null;
  }
  for (const scenario of config.auxScenarios) {
    if ('source' in scenario && !add(scenario.key, 'scenario')) return null;
  }
  for (const material of config.materials) {
    if ('source' in material && !add(material.key, 'material')) return null;
  }
  return expected;
};

const selectExactPayloads = (
  config: ArenaRoomSharedConfig,
  payloads: readonly ArenaRoomHostLocalPayload[],
): readonly ArenaRoomHostLocalPayload[] | null => {
  const expected = expectedLocalKinds(config);
  if (!expected) return null;
  const byKey = new Map<string, ArenaRoomHostLocalPayload>();
  for (const input of payloads) {
    const parsed = ArenaRoomHostLocalPayloadSchema.safeParse(input);
    if (!parsed.success || byKey.has(parsed.data.key)) return null;
    byKey.set(parsed.data.key, parsed.data);
  }
  const selected: ArenaRoomHostLocalPayload[] = [];
  for (const [key, kind] of expected) {
    const payload = byKey.get(key);
    if (!payload || payload.kind !== kind) return null;
    selected.push(structuredClone(payload));
  }
  return selected;
};

const normalizeBundle = (bundle: ArenaRoomHostWorkspaceBundle): Readonly<{
  sharedConfig: ArenaRoomSharedConfig;
  payloads: readonly ArenaRoomHostLocalPayload[];
  digests: ReadonlyMap<string, string>;
}> => {
  const sharedConfig = ArenaRoomSharedConfigSchema.parse(bundle.sharedConfig);
  const payloads = selectExactPayloads(sharedConfig, bundle.hostLocalPayloads);
  if (!payloads || payloads.length !== bundle.hostLocalPayloads.length) {
    throw new Error('ARENA_ROOM_HOST_WORKSPACE_PAYLOAD_MISMATCH');
  }
  const digests = new Map<string, string>();
  for (const entry of bundle.hostLocalContentDigests) {
    if (
      digests.has(entry.key)
      || !/^sha256:[0-9a-f]{64}$/u.test(entry.digest)
    ) throw new Error('ARENA_ROOM_HOST_WORKSPACE_DIGEST_INVALID');
    digests.set(entry.key, entry.digest);
  }
  if (
    digests.size !== payloads.length
    || payloads.some((entry) => !digests.has(entry.key))
  ) throw new Error('ARENA_ROOM_HOST_WORKSPACE_DIGEST_MISMATCH');
  return { sharedConfig, payloads, digests };
};

const startInputs = (
  sharedConfig: ArenaRoomSharedConfig,
  hostLocalPayloads: readonly ArenaRoomHostLocalPayload[],
): ArenaRoomGenerationStartInputs => Object.freeze({
  sharedConfig: structuredClone(sharedConfig),
  hostLocalPayloads: Object.freeze(hostLocalPayloads.map((entry) => structuredClone(entry))),
});

export const createArenaRoomHostWorkspace = (): ArenaRoomHostWorkspace => {
  let baseline: Baseline | null = null;

  return Object.freeze({
    capturePublished(authority, bundle) {
      const normalized = normalizeBundle(bundle);
      if (!sameConfig(authority.sharedConfig, normalized.sharedConfig)) {
        throw new Error('ARENA_ROOM_HOST_WORKSPACE_AUTHORITY_MISMATCH');
      }
      baseline = Object.freeze({
        roomId: authority.roomId,
        roomEpoch: authority.roomEpoch,
        ownerUserId: authority.ownerUserId,
        payloads: Object.freeze(normalized.payloads.map((entry) => structuredClone(entry))),
        digests: new Map(normalized.digests),
      });
    },

    compare(authority, bundle) {
      const normalized = normalizeBundle(bundle);
      const configMatches = sameConfig(authority.sharedConfig, normalized.sharedConfig);
      const relevantBaseline = baseline && sameAuthorityOwner(baseline, authority)
        ? baseline
        : null;
      const expected = expectedLocalKinds(authority.sharedConfig);
      const currentRoomPayloads = selectExactPayloads(
        authority.sharedConfig,
        normalized.payloads,
      );
      const baselineRoomPayloads = relevantBaseline && expected
        ? selectExactPayloads(authority.sharedConfig, relevantBaseline.payloads)
        : null;
      const hasLocalAuthority = (expected?.size ?? 0) > 0;
      const contentMatches = !hasLocalAuthority || (
        relevantBaseline !== null
        && currentRoomPayloads !== null
        && [...expected!.keys()].every((key) => (
          normalized.digests.get(key) !== undefined
          && normalized.digests.get(key) === relevantBaseline.digests.get(key)
        ))
      );

      if (configMatches && currentRoomPayloads && contentMatches) {
        return Object.freeze({
          kind: 'clean' as const,
          start: startInputs(authority.sharedConfig, currentRoomPayloads),
        });
      }

      const reasons: ArenaRoomHostWorkspaceDirtyReason[] = [];
      if (!configMatches) reasons.push('shared-config');
      if (hasLocalAuthority && !relevantBaseline) reasons.push('baseline-missing');
      else if (hasLocalAuthority && !contentMatches) reasons.push('host-local-content');
      return Object.freeze({
        kind: 'dirty' as const,
        reasons: Object.freeze(reasons),
        current: startInputs(normalized.sharedConfig, normalized.payloads),
        room: baselineRoomPayloads
          ? startInputs(authority.sharedConfig, baselineRoomPayloads)
          : null,
      });
    },

    retainFor(authority) {
      if (!authority || (baseline && !sameAuthorityOwner(baseline, authority))) {
        baseline = null;
      }
    },

    clear() {
      baseline = null;
    },
  });
};
