type ArenaQueue = 'strict' | 'free';

type InvalidPresetArenaRatingRow = {
  entityId: string;
  queue: ArenaQueue;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  updatedAt: string;
};

type ArenaMaintenanceRepoBundle = {
  db: unknown;
  listInvalidPresetArenaRatings: (
    db: unknown,
    presetIds: string[],
  ) => Promise<InvalidPresetArenaRatingRow[]>;
  hasPresetArenaRatingByQueue: (
    db: unknown,
    input: { entityId: string; queue: ArenaQueue },
  ) => Promise<boolean>;
  deletePresetArenaRatingByQueue: (
    db: unknown,
    input: { entityId: string; queue: ArenaQueue },
  ) => Promise<number>;
  renamePresetArenaRatingByQueue: (
    db: unknown,
    input: {
      fromEntityId: string;
      toEntityId: string;
      queue: ArenaQueue;
      updatedAt: string;
    },
  ) => Promise<number>;
};

const readArenaMaintenanceRepoBundle = async (): Promise<ArenaMaintenanceRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/arena-maintenance'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      listInvalidPresetArenaRatings:
        repo.listInvalidPresetArenaRatings as ArenaMaintenanceRepoBundle['listInvalidPresetArenaRatings'],
      hasPresetArenaRatingByQueue:
        repo.hasPresetArenaRatingByQueue as ArenaMaintenanceRepoBundle['hasPresetArenaRatingByQueue'],
      deletePresetArenaRatingByQueue:
        repo.deletePresetArenaRatingByQueue as ArenaMaintenanceRepoBundle['deletePresetArenaRatingByQueue'],
      renamePresetArenaRatingByQueue:
        repo.renamePresetArenaRatingByQueue as ArenaMaintenanceRepoBundle['renamePresetArenaRatingByQueue'],
    };
  } catch {
    return null;
  }
};

const requireArenaMaintenanceRepoBundle = async (): Promise<ArenaMaintenanceRepoBundle> => {
  const bundle = await readArenaMaintenanceRepoBundle();
  if (bundle) return bundle;
  throw new Error('未检测到可用的 D1 连接，请检查 Cloudflare D1 配置或运行时绑定');
};

export async function listInvalidPresetArenaRatings(
  presetIds: string[],
): Promise<InvalidPresetArenaRatingRow[]> {
  const bundle = await requireArenaMaintenanceRepoBundle();
  return bundle.listInvalidPresetArenaRatings(bundle.db, presetIds);
}

export async function hasPresetArenaRatingByQueue(input: {
  entityId: string;
  queue: ArenaQueue;
}): Promise<boolean> {
  const bundle = await requireArenaMaintenanceRepoBundle();
  return bundle.hasPresetArenaRatingByQueue(bundle.db, input);
}

export async function deletePresetArenaRatingByQueue(input: {
  entityId: string;
  queue: ArenaQueue;
}): Promise<number> {
  const bundle = await requireArenaMaintenanceRepoBundle();
  return bundle.deletePresetArenaRatingByQueue(bundle.db, input);
}

export async function renamePresetArenaRatingByQueue(input: {
  fromEntityId: string;
  toEntityId: string;
  queue: ArenaQueue;
  updatedAt: string;
}): Promise<number> {
  const bundle = await requireArenaMaintenanceRepoBundle();
  return bundle.renamePresetArenaRatingByQueue(bundle.db, input);
}

