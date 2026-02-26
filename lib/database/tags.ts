export type TagScope = 'user' | 'system' | 'admin';

export interface TagRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: TagScope;
  is_active: number;
  created_at: string;
  updated_at: string;
}

type TagsRepoBundle = {
  db: unknown;
  listTags: (db: unknown, input?: { includeInactive?: boolean }) => Promise<TagRow[]>;
  listTagsByIds: (db: unknown, tagIds: string[]) => Promise<TagRow[]>;
  listTagsForDataCard: (db: unknown, dataCardId: string) => Promise<TagRow[]>;
  listActiveUserScopeTagsByIds: (db: unknown, tagIds: string[]) => Promise<TagRow[]>;
  listUserScopeTagIds: (db: unknown) => Promise<string[]>;
  deleteDataCardTagsByIds: (db: unknown, dataCardId: string, tagIds: string[]) => Promise<void>;
  upsertDataCardTags: (
    db: unknown,
    rows: Array<{ dataCardId: string; tagId: string; createdByUserId: number; createdAt: string }>,
  ) => Promise<void>;
};

const readTagsRepoBundle = async (): Promise<TagsRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/tags'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      listTags: repo.listTags as TagsRepoBundle['listTags'],
      listTagsByIds: repo.listTagsByIds as TagsRepoBundle['listTagsByIds'],
      listTagsForDataCard: repo.listTagsForDataCard as TagsRepoBundle['listTagsForDataCard'],
      listActiveUserScopeTagsByIds: repo.listActiveUserScopeTagsByIds as TagsRepoBundle['listActiveUserScopeTagsByIds'],
      listUserScopeTagIds: repo.listUserScopeTagIds as TagsRepoBundle['listUserScopeTagIds'],
      deleteDataCardTagsByIds: repo.deleteDataCardTagsByIds as TagsRepoBundle['deleteDataCardTagsByIds'],
      upsertDataCardTags: repo.upsertDataCardTags as TagsRepoBundle['upsertDataCardTags'],
    };
  } catch {
    return null;
  }
};

export async function getTags(options?: { includeInactive?: boolean }): Promise<TagRow[]> {
  try {
    const bundle = await readTagsRepoBundle();
    if (!bundle) return [];
    return await bundle.listTags(bundle.db, options);
  } catch (error) {
    console.error('读取 tags 失败:', error);
    return [];
  }
}

export async function getTagsByIds(tagIds: string[]): Promise<TagRow[]> {
  if (!tagIds.length) return [];
  try {
    const bundle = await readTagsRepoBundle();
    if (!bundle) return [];
    return await bundle.listTagsByIds(bundle.db, tagIds);
  } catch (error) {
    console.error('按 ID 读取 tags 失败:', error);
    return [];
  }
}

export async function getTagsForDataCard(dataCardId: string): Promise<TagRow[]> {
  try {
    const bundle = await readTagsRepoBundle();
    if (!bundle) return [];
    return await bundle.listTagsForDataCard(bundle.db, dataCardId);
  } catch (error) {
    console.error('读取 data_card_tags 失败:', error);
    return [];
  }
}

export async function replaceUserTagsForDataCard(payload: {
  dataCardId: string;
  userId: number;
  tagIds: string[];
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const bundle = await readTagsRepoBundle();
    if (!bundle) return { ok: false, error: '数据库不可用' };

    const uniqueTagIds = Array.from(new Set(payload.tagIds.map((id) => id.trim()).filter(Boolean)));

    if (uniqueTagIds.length > 30) {
      return { ok: false, error: '最多只能选择 30 个标签' };
    }

    const validTags = await bundle.listActiveUserScopeTagsByIds(bundle.db, uniqueTagIds);
    if (validTags.length !== uniqueTagIds.length) {
      return { ok: false, error: '包含无效标签或非用户标签' };
    }

    const userScopeTagIds = await bundle.listUserScopeTagIds(bundle.db);
    await bundle.deleteDataCardTagsByIds(bundle.db, payload.dataCardId, userScopeTagIds);

    if (!uniqueTagIds.length) return { ok: true };

    const nowIso = new Date().toISOString();
    await bundle.upsertDataCardTags(
      bundle.db,
      uniqueTagIds.map((tagId) => ({
        dataCardId: payload.dataCardId,
        tagId,
        createdByUserId: payload.userId,
        createdAt: nowIso,
      })),
    );

    return { ok: true };
  } catch (error) {
    console.error('更新 data_card_tags 失败:', error);
    return { ok: false, error: '写入失败' };
  }
}
