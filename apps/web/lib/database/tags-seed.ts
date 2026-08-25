type TagSeedScope = 'user' | 'system' | 'admin';

type TagSeedRowInput = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: TagSeedScope;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type TagsSeedRepoBundle = {
  db: unknown;
  listAllTagIds: (db: unknown) => Promise<string[]>;
  upsertTagSeedRow: (db: unknown, input: TagSeedRowInput) => Promise<void>;
  upsertTagAliasSeedRow: (
    db: unknown,
    input: { alias: string; tagId: string; createdAt: string },
  ) => Promise<void>;
  deactivateTagsByIds: (
    db: unknown,
    input: { tagIds: string[]; updatedAt: string },
  ) => Promise<number>;
};

const readTagsSeedRepoBundle = async (): Promise<TagsSeedRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/tags-seed'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      listAllTagIds: repo.listAllTagIds as TagsSeedRepoBundle['listAllTagIds'],
      upsertTagSeedRow: repo.upsertTagSeedRow as TagsSeedRepoBundle['upsertTagSeedRow'],
      upsertTagAliasSeedRow:
        repo.upsertTagAliasSeedRow as TagsSeedRepoBundle['upsertTagAliasSeedRow'],
      deactivateTagsByIds: repo.deactivateTagsByIds as TagsSeedRepoBundle['deactivateTagsByIds'],
    };
  } catch {
    return null;
  }
};

const requireTagsSeedRepoBundle = async (): Promise<TagsSeedRepoBundle> => {
  const bundle = await readTagsSeedRepoBundle();
  if (bundle) return bundle;
  throw new Error('未检测到可用的 D1 连接，请检查 Cloudflare D1 配置或运行时绑定');
};

export async function listAllTagIds(): Promise<string[]> {
  const bundle = await requireTagsSeedRepoBundle();
  return bundle.listAllTagIds(bundle.db);
}

export async function upsertTagSeedRow(input: TagSeedRowInput): Promise<void> {
  const bundle = await requireTagsSeedRepoBundle();
  await bundle.upsertTagSeedRow(bundle.db, input);
}

export async function upsertTagAliasSeedRow(input: {
  alias: string;
  tagId: string;
  createdAt: string;
}): Promise<void> {
  const bundle = await requireTagsSeedRepoBundle();
  await bundle.upsertTagAliasSeedRow(bundle.db, input);
}

export async function deactivateTagsByIds(input: {
  tagIds: string[];
  updatedAt: string;
}): Promise<number> {
  const bundle = await requireTagsSeedRepoBundle();
  return bundle.deactivateTagsByIds(bundle.db, input);
}
