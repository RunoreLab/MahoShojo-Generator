import type {
  DataCardPayloadRow,
  NativeBackfillFilter,
  NativeBackfillRow,
  RatedPublicCharacterRow,
  ScriptArenaQueue,
  TechIndexBackfillFilter,
  TechIndexBackfillRow,
} from '@/lib/db/repositories/data-card-tech-index';

type TechIndexRepoBundle = {
  db: unknown;
  countNativeBackfillCandidates: (db: unknown, filter: NativeBackfillFilter) => Promise<number>;
  listNativeBackfillCandidateBatch: (
    db: unknown,
    filter: NativeBackfillFilter,
    limit: number,
  ) => Promise<NativeBackfillRow[]>;
  updateNativeFlagsByDataCardIds: (
    db: unknown,
    rows: Array<{ id: string; isNative: boolean }>,
    nowIso: string,
  ) => Promise<void>;
  countTechIndexBackfillCandidates: (db: unknown, filter: TechIndexBackfillFilter) => Promise<number>;
  listTechIndexBackfillCandidateBatch: (
    db: unknown,
    filter: TechIndexBackfillFilter,
    limit: number,
  ) => Promise<TechIndexBackfillRow[]>;
  listTechIndexBackfillCandidatesByIds: (
    db: unknown,
    filter: Omit<TechIndexBackfillFilter, 'startAfterId'>,
    dataCardIds: string[],
  ) => Promise<TechIndexBackfillRow[]>;
  listArenaRatedPublicCharacterCards: (
    db: unknown,
    input: { queue: ScriptArenaQueue; minGames: number; limit?: number | null },
  ) => Promise<RatedPublicCharacterRow[]>;
  listDataCardPayloadRowsByIds: (db: unknown, dataCardIds: string[]) => Promise<DataCardPayloadRow[]>;
  getDataCardPayloadRowById: (db: unknown, dataCardId: string) => Promise<DataCardPayloadRow | null>;
};

const readTechIndexRepoBundle = async (): Promise<TechIndexRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/data-card-tech-index'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      countNativeBackfillCandidates:
        repo.countNativeBackfillCandidates as TechIndexRepoBundle['countNativeBackfillCandidates'],
      listNativeBackfillCandidateBatch:
        repo.listNativeBackfillCandidateBatch as TechIndexRepoBundle['listNativeBackfillCandidateBatch'],
      updateNativeFlagsByDataCardIds:
        repo.updateNativeFlagsByDataCardIds as TechIndexRepoBundle['updateNativeFlagsByDataCardIds'],
      countTechIndexBackfillCandidates:
        repo.countTechIndexBackfillCandidates as TechIndexRepoBundle['countTechIndexBackfillCandidates'],
      listTechIndexBackfillCandidateBatch:
        repo.listTechIndexBackfillCandidateBatch as TechIndexRepoBundle['listTechIndexBackfillCandidateBatch'],
      listTechIndexBackfillCandidatesByIds:
        repo.listTechIndexBackfillCandidatesByIds as TechIndexRepoBundle['listTechIndexBackfillCandidatesByIds'],
      listArenaRatedPublicCharacterCards:
        repo.listArenaRatedPublicCharacterCards as TechIndexRepoBundle['listArenaRatedPublicCharacterCards'],
      listDataCardPayloadRowsByIds:
        repo.listDataCardPayloadRowsByIds as TechIndexRepoBundle['listDataCardPayloadRowsByIds'],
      getDataCardPayloadRowById:
        repo.getDataCardPayloadRowById as TechIndexRepoBundle['getDataCardPayloadRowById'],
    };
  } catch {
    return null;
  }
};

const requireTechIndexRepoBundle = async (): Promise<TechIndexRepoBundle> => {
  const bundle = await readTechIndexRepoBundle();
  if (bundle) return bundle;
  throw new Error('未检测到可用的 D1 连接，请检查 Cloudflare D1 配置或运行时绑定');
};

export async function countNativeBackfillCandidates(filter: NativeBackfillFilter): Promise<number> {
  const bundle = await requireTechIndexRepoBundle();
  return bundle.countNativeBackfillCandidates(bundle.db, filter);
}

export async function listNativeBackfillCandidateBatch(
  filter: NativeBackfillFilter,
  limit: number,
): Promise<NativeBackfillRow[]> {
  const bundle = await requireTechIndexRepoBundle();
  return bundle.listNativeBackfillCandidateBatch(bundle.db, filter, limit);
}

export async function updateNativeFlagsByDataCardIds(
  rows: Array<{ id: string; isNative: boolean }>,
): Promise<void> {
  const bundle = await requireTechIndexRepoBundle();
  const nowIso = new Date().toISOString();
  await bundle.updateNativeFlagsByDataCardIds(bundle.db, rows, nowIso);
}

export async function countTechIndexBackfillCandidates(filter: TechIndexBackfillFilter): Promise<number> {
  const bundle = await requireTechIndexRepoBundle();
  return bundle.countTechIndexBackfillCandidates(bundle.db, filter);
}

export async function listTechIndexBackfillCandidateBatch(
  filter: TechIndexBackfillFilter,
  limit: number,
): Promise<TechIndexBackfillRow[]> {
  const bundle = await requireTechIndexRepoBundle();
  return bundle.listTechIndexBackfillCandidateBatch(bundle.db, filter, limit);
}

export async function listTechIndexBackfillCandidatesByIds(
  filter: Omit<TechIndexBackfillFilter, 'startAfterId'>,
  dataCardIds: string[],
): Promise<TechIndexBackfillRow[]> {
  const bundle = await requireTechIndexRepoBundle();
  return bundle.listTechIndexBackfillCandidatesByIds(bundle.db, filter, dataCardIds);
}

export async function listArenaRatedPublicCharacterCards(input: {
  queue: ScriptArenaQueue;
  minGames: number;
  limit?: number | null;
}): Promise<RatedPublicCharacterRow[]> {
  const bundle = await requireTechIndexRepoBundle();
  return bundle.listArenaRatedPublicCharacterCards(bundle.db, input);
}

export async function listDataCardPayloadRowsByIds(dataCardIds: string[]): Promise<DataCardPayloadRow[]> {
  const bundle = await requireTechIndexRepoBundle();
  return bundle.listDataCardPayloadRowsByIds(bundle.db, dataCardIds);
}

export async function getDataCardPayloadRowById(dataCardId: string): Promise<DataCardPayloadRow | null> {
  const bundle = await requireTechIndexRepoBundle();
  return bundle.getDataCardPayloadRowById(bundle.db, dataCardId);
}

