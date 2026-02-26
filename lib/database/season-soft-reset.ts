type Queue = 'strict' | 'free' | 'all';
type ArenaQueue = 'strict' | 'free';

type QueueStatsRow = {
  queue: string;
  count: number;
  minRating: number;
  maxRating: number;
};

type RatingSampleRow = {
  entityType: string;
  entityId: string;
  queue: ArenaQueue;
  rating: number;
  games: number;
  updatedAt: string;
};

type AutoSummaryRow = {
  total: number;
  played: number;
  maxRatingPlayed: number | null;
  top20AvgRatingPlayed: number | null;
  aboveMaxStartPlayed: number;
  inactive30DaysPlayed: number;
};

type SeasonSoftResetRepoBundle = {
  db: unknown;
  listSeasonSoftResetQueueStats: (db: unknown, queue: Queue) => Promise<QueueStatsRow[]>;
  listSeasonSoftResetRatingSamples: (
    db: unknown,
    input: { queue: ArenaQueue; limit: number; order: 'asc' | 'desc' },
  ) => Promise<RatingSampleRow[]>;
  getSeasonSoftResetAutoSummary: (
    db: unknown,
    input: { queue: ArenaQueue; nowIso: string; maxStartRating: number },
  ) => Promise<AutoSummaryRow>;
  countSeasonSoftResetPlayedRows: (db: unknown, queue: ArenaQueue) => Promise<number>;
  getSeasonSoftResetGamesValueAtOffset: (
    db: unknown,
    input: { queue: ArenaQueue; offset: number },
  ) => Promise<number | null>;
  getSeasonSoftResetInactiveDaysValueAtOffset: (
    db: unknown,
    input: { queue: ArenaQueue; nowIso: string; offset: number },
  ) => Promise<number | null>;
  executeSeasonSoftResetQueueUpdate: (
    db: unknown,
    input: {
      queue: ArenaQueue;
      ratingExpr: string;
      ratingParams: unknown[];
      nowIso: string;
      includeLegacyColumns: boolean;
    },
  ) => Promise<number>;
};

const readSeasonSoftResetRepoBundle = async (): Promise<SeasonSoftResetRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/season-soft-reset'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      listSeasonSoftResetQueueStats:
        repo.listSeasonSoftResetQueueStats as SeasonSoftResetRepoBundle['listSeasonSoftResetQueueStats'],
      listSeasonSoftResetRatingSamples:
        repo.listSeasonSoftResetRatingSamples as SeasonSoftResetRepoBundle['listSeasonSoftResetRatingSamples'],
      getSeasonSoftResetAutoSummary:
        repo.getSeasonSoftResetAutoSummary as SeasonSoftResetRepoBundle['getSeasonSoftResetAutoSummary'],
      countSeasonSoftResetPlayedRows:
        repo.countSeasonSoftResetPlayedRows as SeasonSoftResetRepoBundle['countSeasonSoftResetPlayedRows'],
      getSeasonSoftResetGamesValueAtOffset:
        repo.getSeasonSoftResetGamesValueAtOffset as SeasonSoftResetRepoBundle['getSeasonSoftResetGamesValueAtOffset'],
      getSeasonSoftResetInactiveDaysValueAtOffset:
        repo.getSeasonSoftResetInactiveDaysValueAtOffset as SeasonSoftResetRepoBundle['getSeasonSoftResetInactiveDaysValueAtOffset'],
      executeSeasonSoftResetQueueUpdate:
        repo.executeSeasonSoftResetQueueUpdate as SeasonSoftResetRepoBundle['executeSeasonSoftResetQueueUpdate'],
    };
  } catch {
    return null;
  }
};

const requireSeasonSoftResetRepoBundle = async (): Promise<SeasonSoftResetRepoBundle> => {
  const bundle = await readSeasonSoftResetRepoBundle();
  if (bundle) return bundle;
  throw new Error('未检测到可用的 D1 连接，请检查 Cloudflare D1 配置或运行时绑定');
};

export async function listSeasonSoftResetQueueStats(queue: Queue): Promise<QueueStatsRow[]> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.listSeasonSoftResetQueueStats(bundle.db, queue);
}

export async function listSeasonSoftResetRatingSamples(input: {
  queue: ArenaQueue;
  limit: number;
  order: 'asc' | 'desc';
}): Promise<RatingSampleRow[]> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.listSeasonSoftResetRatingSamples(bundle.db, input);
}

export async function getSeasonSoftResetAutoSummary(input: {
  queue: ArenaQueue;
  nowIso: string;
  maxStartRating: number;
}): Promise<AutoSummaryRow> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.getSeasonSoftResetAutoSummary(bundle.db, input);
}

export async function countSeasonSoftResetPlayedRows(queue: ArenaQueue): Promise<number> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.countSeasonSoftResetPlayedRows(bundle.db, queue);
}

export async function getSeasonSoftResetGamesValueAtOffset(input: {
  queue: ArenaQueue;
  offset: number;
}): Promise<number | null> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.getSeasonSoftResetGamesValueAtOffset(bundle.db, input);
}

export async function getSeasonSoftResetInactiveDaysValueAtOffset(input: {
  queue: ArenaQueue;
  nowIso: string;
  offset: number;
}): Promise<number | null> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.getSeasonSoftResetInactiveDaysValueAtOffset(bundle.db, input);
}

export async function executeSeasonSoftResetQueueUpdate(input: {
  queue: ArenaQueue;
  ratingExpr: string;
  ratingParams: unknown[];
  nowIso: string;
  includeLegacyColumns: boolean;
}): Promise<number> {
  const bundle = await requireSeasonSoftResetRepoBundle();
  return bundle.executeSeasonSoftResetQueueUpdate(bundle.db, input);
}
