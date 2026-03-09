type SeasonArchiveQueue = 'strict' | 'free';

type SeasonArchiveLeaderboardRow = {
  entityType: 'data_card' | 'preset';
  entityId: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  ratingUpdatedAt: string | null;
  dataCardName: string | null;
  dataCardDescription: string | null;
  authorName: string | null;
  authorId: number | null;
  usageCount: number | null;
  likeCount: number | null;
  favoriteCount: number | null;
  dataCardCreatedAt: string | null;
  dataCardUpdatedAt: string | null;
  techScore: number | null;
  techLevel: string | null;
  isNative: number | null;
  tagIds: string | null;
};

type SeasonArchiveRepoBundle = {
  db: unknown;
  countSeasonArchiveEligibleRows: (db: unknown, queue: SeasonArchiveQueue) => Promise<number>;
  listSeasonArchiveLeaderboardRows: (
    db: unknown,
    input: {
      queue: SeasonArchiveQueue;
      sort: 'rating_desc' | 'rating_asc';
      limit: number;
      offset: number;
    },
  ) => Promise<SeasonArchiveLeaderboardRow[]>;
};

const readSeasonArchiveRepoBundle = async (): Promise<SeasonArchiveRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/season-archive'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      countSeasonArchiveEligibleRows:
        repo.countSeasonArchiveEligibleRows as SeasonArchiveRepoBundle['countSeasonArchiveEligibleRows'],
      listSeasonArchiveLeaderboardRows:
        repo.listSeasonArchiveLeaderboardRows as SeasonArchiveRepoBundle['listSeasonArchiveLeaderboardRows'],
    };
  } catch {
    return null;
  }
};

const requireSeasonArchiveRepoBundle = async (): Promise<SeasonArchiveRepoBundle> => {
  const bundle = await readSeasonArchiveRepoBundle();
  if (bundle) return bundle;
  throw new Error('未检测到可用的 D1 连接，请检查 Cloudflare D1 配置或运行时绑定');
};

export async function countSeasonArchiveEligibleRows(
  queue: SeasonArchiveQueue,
): Promise<number> {
  const bundle = await requireSeasonArchiveRepoBundle();
  return bundle.countSeasonArchiveEligibleRows(bundle.db, queue);
}

export async function listSeasonArchiveLeaderboardRows(input: {
  queue: SeasonArchiveQueue;
  sort: 'rating_desc' | 'rating_asc';
  limit: number;
  offset?: number;
}): Promise<SeasonArchiveLeaderboardRow[]> {
  const bundle = await requireSeasonArchiveRepoBundle();
  return bundle.listSeasonArchiveLeaderboardRows(bundle.db, {
    queue: input.queue,
    sort: input.sort,
    limit: input.limit,
    offset: input.offset ?? 0,
  });
}
