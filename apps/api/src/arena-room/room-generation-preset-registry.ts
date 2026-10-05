import {
  DataCardRefSchema,
  type DataCardRef,
} from '@mahoshojo/contracts/arena-room';

import { GENERATED_ARENA_ROOM_PRESETS } from './generated/arena-room-preset-registry';
import type { ArenaRoomGenerationCanonicalContent } from './room-generation-materializer';

export type ArenaRoomGenerationPresetResolverErrorCode =
  | 'ARENA_ROOM_PRESET_CONTENT_INVALID'
  | 'ARENA_ROOM_PRESET_INPUT_INVALID'
  | 'ARENA_ROOM_PRESET_NOT_FOUND'
  | 'ARENA_ROOM_PRESET_VERSION_MISMATCH';

export class ArenaRoomGenerationPresetResolverError extends Error {
  constructor(readonly code: ArenaRoomGenerationPresetResolverErrorCode) {
    super(code);
    this.name = 'ArenaRoomGenerationPresetResolverError';
  }
}

const fail = (code: ArenaRoomGenerationPresetResolverErrorCode): never => {
  throw new ArenaRoomGenerationPresetResolverError(code);
};

const deepFreeze = <Value>(value: Value, seen = new WeakSet<object>()): Value => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
};

const entries = GENERATED_ARENA_ROOM_PRESETS.map((entry) => {
  if (typeof entry.payload !== 'object' || entry.payload === null || Array.isArray(entry.payload)) {
    return fail('ARENA_ROOM_PRESET_CONTENT_INVALID');
  }
  return Object.freeze({
    ...entry,
    payload: deepFreeze(entry.payload) as Readonly<Record<string, unknown>>,
  });
});

const keyOf = (kind: string, id: string): string => `${kind}\u0000${id}`;
const entriesByKey = new Map(entries.map((entry) => [keyOf(entry.kind, entry.id), entry]));

export const ARENA_ROOM_GENERATION_PRESET_REFS: readonly DataCardRef[] = Object.freeze(entries.map((entry) => (
  Object.freeze({
    id: entry.id,
    kind: entry.kind,
    versionToken: entry.versionToken,
  }) as DataCardRef
)));

export type ArenaRoomGenerationPresetResolver = Readonly<{
  resolve(input: Readonly<{ ref: DataCardRef }>): Promise<ArenaRoomGenerationCanonicalContent>;
}>;

export const createArenaRoomGenerationPresetResolver = (
): ArenaRoomGenerationPresetResolver => Object.freeze({
  async resolve(input) {
    const parsed = DataCardRefSchema.safeParse(input.ref);
    if (
      !parsed.success
      || parsed.data.id !== input.ref.id
      || parsed.data.versionToken !== input.ref.versionToken
    ) return fail('ARENA_ROOM_PRESET_INPUT_INVALID');
    const entry = entriesByKey.get(keyOf(parsed.data.kind, parsed.data.id));
    if (!entry) return fail('ARENA_ROOM_PRESET_NOT_FOUND');
    if (entry.versionToken !== parsed.data.versionToken) {
      return fail('ARENA_ROOM_PRESET_VERSION_MISMATCH');
    }
    return Object.freeze({
      ref: Object.freeze({ ...parsed.data }),
      displayName: entry.displayName,
      sourceType: entry.sourceType,
      payload: entry.payload,
    });
  },
});
