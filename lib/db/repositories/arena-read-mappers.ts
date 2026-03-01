export type ArenaReadQueue = 'strict' | 'free';
export type ArenaReadEntityType = 'data_card' | 'preset';

export type ArenaRatingSnapshotRow = {
  queue: ArenaReadQueue;
  entityType: ArenaReadEntityType;
  entityId: string;
  rating: number;
  games: number;
};

export type ArenaRatingEventReadRow = {
  queue: ArenaReadQueue;
  status: 'pending' | 'applied' | 'skipped' | 'failed';
  skipReason: string | null;
  detailsJson: string | null;
  aEntityType: ArenaReadEntityType;
  aEntityId: string;
  bEntityType: ArenaReadEntityType;
  bEntityId: string;
  aBeforeRating: number | null;
  aAfterRating: number | null;
  aDelta: number | null;
  aBeforeGames: number | null;
  aAfterGames: number | null;
  bBeforeRating: number | null;
  bAfterRating: number | null;
  bDelta: number | null;
  bBeforeGames: number | null;
  bAfterGames: number | null;
};

const readString = (source: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') return value;
  }
  return null;
};

const readNumber = (source: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = source[key];
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const toInteger = (value: number | null, fallback = 0): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.floor(value as number);
};

const normalizeQueue = (value: string | null): ArenaReadQueue => (value === 'free' ? 'free' : 'strict');

const normalizeEntityType = (value: string | null): ArenaReadEntityType => (value === 'preset' ? 'preset' : 'data_card');

const normalizeStatus = (
  value: string | null,
): 'pending' | 'applied' | 'skipped' | 'failed' => {
  if (value === 'applied' || value === 'skipped' || value === 'failed') return value;
  return 'pending';
};

export const mapArenaRatingSnapshotRow = (input: Record<string, unknown>): ArenaRatingSnapshotRow => {
  const queue = normalizeQueue(readString(input, ['queue']));
  const entityType = normalizeEntityType(readString(input, ['entityType', 'entity_type']));
  const entityId = readString(input, ['entityId', 'entity_id']) ?? '';
  const rating = toInteger(readNumber(input, ['rating']), 0);
  const games = Math.max(0, toInteger(readNumber(input, ['games']), 0));

  return {
    queue,
    entityType,
    entityId,
    rating,
    games,
  };
};

export const mapArenaRatingEventReadRow = (input: Record<string, unknown>): ArenaRatingEventReadRow => {
  const queue = normalizeQueue(readString(input, ['queue']));
  const status = normalizeStatus(readString(input, ['status']));
  const skipReason = readString(input, ['skipReason', 'skip_reason']);
  const detailsJson = readString(input, ['detailsJson', 'details_json']);
  const aEntityType = normalizeEntityType(readString(input, ['aEntityType', 'a_entity_type']));
  const aEntityId = readString(input, ['aEntityId', 'a_entity_id']) ?? '';
  const bEntityType = normalizeEntityType(readString(input, ['bEntityType', 'b_entity_type']));
  const bEntityId = readString(input, ['bEntityId', 'b_entity_id']) ?? '';

  return {
    queue,
    status,
    skipReason,
    detailsJson,
    aEntityType,
    aEntityId,
    bEntityType,
    bEntityId,
    aBeforeRating: readNumber(input, ['aBeforeRating', 'a_before_rating']),
    aAfterRating: readNumber(input, ['aAfterRating', 'a_after_rating']),
    aDelta: readNumber(input, ['aDelta', 'a_delta']),
    aBeforeGames: readNumber(input, ['aBeforeGames', 'a_before_games']),
    aAfterGames: readNumber(input, ['aAfterGames', 'a_after_games']),
    bBeforeRating: readNumber(input, ['bBeforeRating', 'b_before_rating']),
    bAfterRating: readNumber(input, ['bAfterRating', 'b_after_rating']),
    bDelta: readNumber(input, ['bDelta', 'b_delta']),
    bBeforeGames: readNumber(input, ['bBeforeGames', 'b_before_games']),
    bAfterGames: readNumber(input, ['bAfterGames', 'b_after_games']),
  };
};
