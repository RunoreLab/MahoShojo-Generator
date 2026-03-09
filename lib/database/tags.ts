import { queryFromD1 } from './core';

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

const readRows = <T,>(result: unknown): T[] => {
  const rows = (result as { result?: Array<{ results?: T[] }> })?.result?.[0]?.results;
  return Array.isArray(rows) ? rows : [];
};

const readChanges = (result: unknown): number => {
  const changes = (result as { result?: Array<{ meta?: { changes?: unknown } }> })?.result?.[0]?.meta?.changes;
  if (typeof changes === 'number' && Number.isFinite(changes)) return Math.floor(changes);
  if (typeof changes === 'string' && changes.trim()) {
    const parsed = Number(changes);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return 0;
};

const sanitizeIds = (ids: string[]): string[] =>
  Array.from(new Set(ids.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)));

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

export async function replaceScopedTagsForDataCard(payload: {
  dataCardId: string;
  scope: Exclude<TagScope, 'user'>;
  tagIds: string[];
  createdByUserId: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const dataCardId = typeof payload.dataCardId === 'string' ? payload.dataCardId.trim() : '';
  const scope = payload.scope === 'system' || payload.scope === 'admin' ? payload.scope : null;
  const tagIds = sanitizeIds(payload.tagIds);
  if (!dataCardId || !scope) return { ok: false, error: '参数无效' };
  if (tagIds.length > 50) return { ok: false, error: '单个 scope 最多写入 50 个标签' };

  try {
    if (tagIds.length > 0) {
      const placeholders = tagIds.map(() => '?').join(', ');
      const validSql = `
        SELECT id
        FROM tags
        WHERE scope = ?
          AND is_active = 1
          AND id IN (${placeholders});
      `;
      const validRows = readRows<{ id: string }>(await queryFromD1(validSql, [scope, ...tagIds]));
      if (validRows.length !== tagIds.length) {
        return { ok: false, error: '包含无效标签、停用标签或 scope 不匹配标签' };
      }
    }

    await queryFromD1(
      `
        DELETE FROM data_card_tags
        WHERE data_card_id = ?
          AND tag_id IN (
            SELECT id FROM tags WHERE scope = ?
          );
      `,
      [dataCardId, scope],
    );

    if (tagIds.length === 0) return { ok: true };

    const nowIso = new Date().toISOString();
    const valuesSql = tagIds.map(() => '(?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];
    for (const tagId of tagIds) {
      params.push(dataCardId, tagId, payload.createdByUserId, nowIso);
    }

    await queryFromD1(
      `
        INSERT INTO data_card_tags (data_card_id, tag_id, created_by_user_id, created_at)
        VALUES ${valuesSql}
        ON CONFLICT(data_card_id, tag_id) DO UPDATE SET
          created_by_user_id = excluded.created_by_user_id,
          created_at = excluded.created_at;
      `,
      params,
    );

    return { ok: true };
  } catch (error) {
    console.error('replaceScopedTagsForDataCard 失败:', error);
    return { ok: false, error: '写入失败' };
  }
}

export async function upsertTag(input: {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  scope: TagScope;
  isActive: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const scope = input.scope === 'system' || input.scope === 'admin' || input.scope === 'user' ? input.scope : null;
  if (!id || !name || !scope) return { ok: false, error: '缺少标签 id / 名称 / scope' };

  try {
    const nowIso = new Date().toISOString();
    await queryFromD1(
      `
        INSERT INTO tags (id, name, description, category, scope, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          category = excluded.category,
          scope = excluded.scope,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at;
      `,
      [
        id,
        name,
        typeof input.description === 'string' ? input.description : null,
        typeof input.category === 'string' ? input.category : null,
        scope,
        input.isActive ? 1 : 0,
        nowIso,
        nowIso,
      ],
    );

    return { ok: true };
  } catch (error) {
    console.error('upsertTag 失败:', error);
    return { ok: false, error: '标签写入失败' };
  }
}

export async function getTagAliases(input?: {
  tagId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<Array<{ alias: string; tag_id: string; created_at: string }>> {
  const tagId = typeof input?.tagId === 'string' ? input.tagId.trim() : '';
  const search = typeof input?.search === 'string' ? input.search.trim() : '';
  const limit = typeof input?.limit === 'number' && Number.isFinite(input.limit) ? Math.max(1, Math.min(500, Math.floor(input.limit))) : 200;
  const offset = typeof input?.offset === 'number' && Number.isFinite(input.offset) ? Math.max(0, Math.floor(input.offset)) : 0;

  const whereParts: string[] = [];
  const params: unknown[] = [];
  if (tagId) {
    whereParts.push('ta.tag_id = ?');
    params.push(tagId);
  }
  if (search) {
    whereParts.push('(ta.alias LIKE ? OR ta.tag_id LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term);
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const rows = readRows<{ alias: string; tag_id: string; created_at: string }>(
    await queryFromD1(
      `
        SELECT ta.alias, ta.tag_id, ta.created_at
        FROM tag_aliases ta
        ${whereSql}
        ORDER BY ta.alias ASC
        LIMIT ? OFFSET ?;
      `,
      [...params, limit, offset],
    ),
  );

  return rows;
}

export async function upsertTagAlias(input: {
  alias: string;
  tagId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const alias = typeof input.alias === 'string' ? input.alias.trim() : '';
  const tagId = typeof input.tagId === 'string' ? input.tagId.trim() : '';
  if (!alias || !tagId) return { ok: false, error: '缺少 alias 或 tagId' };

  try {
    const tagExists = readRows<{ id: string }>(
      await queryFromD1('SELECT id FROM tags WHERE id = ? LIMIT 1;', [tagId]),
    )[0];
    if (!tagExists) return { ok: false, error: '标签不存在' };

    await queryFromD1(
      `
        INSERT INTO tag_aliases (alias, tag_id, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(alias) DO UPDATE SET
          tag_id = excluded.tag_id;
      `,
      [alias, tagId, new Date().toISOString()],
    );
    return { ok: true };
  } catch (error) {
    console.error('upsertTagAlias 失败:', error);
    return { ok: false, error: '标签别名写入失败' };
  }
}

export async function deleteTagAlias(alias: string): Promise<{ ok: boolean; error?: string }> {
  const safeAlias = typeof alias === 'string' ? alias.trim() : '';
  if (!safeAlias) return { ok: false, error: '缺少 alias' };

  try {
    const result = await queryFromD1('DELETE FROM tag_aliases WHERE alias = ?;', [safeAlias]);
    const changes = readChanges(result);
    if (changes <= 0) return { ok: false, error: '标签别名不存在' };
    return { ok: true };
  } catch (error) {
    console.error('deleteTagAlias 失败:', error);
    return { ok: false, error: '标签别名删除失败' };
  }
}
