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

export type TagAliasRow = {
  alias: string;
  tag_id: string;
  created_at: string;
};

export const isSafeTagId = (value: string): boolean => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return false;
  return /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/.test(trimmed);
};

export async function getTags(options?: { includeInactive?: boolean }): Promise<TagRow[]> {
  try {
    const includeInactive = options?.includeInactive === true;
    const result = (await queryFromD1(
      `SELECT id, name, description, category, scope, is_active, created_at, updated_at
       FROM tags
       ${includeInactive ? '' : 'WHERE is_active = 1'}
       ORDER BY category ASC, id ASC`,
      []
    )) as any;

    const rows = (result?.result?.[0]?.results ?? []) as TagRow[];
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error('读取 tags 失败:', error);
    return [];
  }
}

export async function getTagsByIds(tagIds: string[]): Promise<TagRow[]> {
  if (!tagIds.length) return [];
  const placeholders = tagIds.map(() => '?').join(', ');
  try {
    const result = (await queryFromD1(
      `SELECT id, name, description, category, scope, is_active, created_at, updated_at
       FROM tags
       WHERE id IN (${placeholders})`,
      tagIds
    )) as any;
    const rows = (result?.result?.[0]?.results ?? []) as TagRow[];
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error('按 ID 读取 tags 失败:', error);
    return [];
  }
}

export async function getTagsForDataCard(dataCardId: string): Promise<TagRow[]> {
  try {
    const result = (await queryFromD1(
      `SELECT t.id, t.name, t.description, t.category, t.scope, t.is_active, t.created_at, t.updated_at
       FROM data_card_tags dct
       JOIN tags t ON t.id = dct.tag_id
       WHERE dct.data_card_id = ?
       ORDER BY t.category ASC, t.id ASC`,
      [dataCardId]
    )) as any;
    const rows = (result?.result?.[0]?.results ?? []) as TagRow[];
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error('读取 data_card_tags 失败:', error);
    return [];
  }
}

export async function getTagAliases(options?: { tagId?: string; search?: string; limit?: number; offset?: number }): Promise<TagAliasRow[]> {
  const tagId = typeof options?.tagId === 'string' ? options.tagId.trim() : '';
  const search = typeof options?.search === 'string' ? options.search.trim() : '';
  const limit = Math.max(1, Math.min(500, Math.floor(options?.limit ?? 200)));
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));

  try {
    const whereParts: string[] = [];
    const params: unknown[] = [];

    if (tagId) {
      whereParts.push('ta.tag_id = ?');
      params.push(tagId);
    }

    if (search) {
      whereParts.push('(ta.alias LIKE ? OR ta.tag_id LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const result = (await queryFromD1(
      `SELECT alias, tag_id, created_at
       FROM tag_aliases ta
       ${whereSql}
       ORDER BY alias ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )) as any;

    const rows = (result?.result?.[0]?.results ?? []) as TagAliasRow[];
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error('读取 tag_aliases 失败:', error);
    return [];
  }
}

export async function upsertTag(payload: {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  scope: TagScope;
  isActive?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const id = typeof payload.id === 'string' ? payload.id.trim() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const description = typeof payload.description === 'string' ? payload.description.trim() : payload.description ?? null;
  const category = typeof payload.category === 'string' ? payload.category.trim() : payload.category ?? null;
  const scope = payload.scope;
  const isActive = payload.isActive === false ? 0 : 1;

  if (!id || !name) return { ok: false, error: '缺少 id 或 name' };
  if (!isSafeTagId(id)) return { ok: false, error: 'tag id 不合法：仅允许字母数字，且可包含 : _ -' };
  if (scope !== 'user' && scope !== 'system' && scope !== 'admin') return { ok: false, error: 'scope 不合法' };

  try {
    const nowIso = new Date().toISOString();
    const result = (await queryFromD1(
      `INSERT INTO tags (id, name, description, category, scope, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         category = excluded.category,
         scope = excluded.scope,
         is_active = excluded.is_active,
         updated_at = excluded.updated_at`,
      [id, name, description, category, scope, isActive, nowIso, nowIso]
    )) as any;

    return { ok: Boolean(result?.success) };
  } catch (error) {
    console.error('写入 tags 失败:', error);
    return { ok: false, error: '写入失败' };
  }
}

export async function upsertTagAlias(payload: { alias: string; tagId: string }): Promise<{ ok: boolean; error?: string }> {
  const alias = typeof payload.alias === 'string' ? payload.alias.trim() : '';
  const tagId = typeof payload.tagId === 'string' ? payload.tagId.trim() : '';
  if (!alias || !tagId) return { ok: false, error: '缺少 alias 或 tagId' };

  try {
    const nowIso = new Date().toISOString();
    const result = (await queryFromD1(
      `INSERT INTO tag_aliases (alias, tag_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(alias) DO UPDATE SET
         tag_id = excluded.tag_id`,
      [alias, tagId, nowIso]
    )) as any;
    return { ok: Boolean(result?.success) };
  } catch (error) {
    console.error('写入 tag_aliases 失败:', error);
    return { ok: false, error: '写入失败' };
  }
}

export async function deleteTagAlias(alias: string): Promise<{ ok: boolean; error?: string }> {
  const normalized = typeof alias === 'string' ? alias.trim() : '';
  if (!normalized) return { ok: false, error: '缺少 alias' };
  try {
    const result = (await queryFromD1('DELETE FROM tag_aliases WHERE alias = ?', [normalized])) as any;
    return { ok: Boolean(result?.success) };
  } catch (error) {
    console.error('删除 tag_aliases 失败:', error);
    return { ok: false, error: '删除失败' };
  }
}

export async function replaceUserTagsForDataCard(payload: {
  dataCardId: string;
  userId: number;
  tagIds: string[];
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const uniqueTagIds = Array.from(new Set(payload.tagIds.map((id) => id.trim()).filter(Boolean)));

    if (uniqueTagIds.length > 30) {
      return { ok: false, error: '最多只能选择 30 个标签' };
    }

    const tags = await getTagsByIds(uniqueTagIds);
    const invalid = tags.filter((t) => t.is_active !== 1 || t.scope !== 'user').map((t) => t.id);
    if (tags.length !== uniqueTagIds.length || invalid.length > 0) {
      return { ok: false, error: '包含无效标签或非用户标签' };
    }

    // 先清空该卡的所有 user scope 标签（避免口径分裂）
    await queryFromD1(
      `DELETE FROM data_card_tags
       WHERE data_card_id = ?
         AND tag_id IN (SELECT id FROM tags WHERE scope = 'user')`,
      [payload.dataCardId]
    );

    if (!uniqueTagIds.length) return { ok: true };

    const nowIso = new Date().toISOString();
    const valuesSql = uniqueTagIds.map(() => '(?,?,?,?)').join(', ');
    const params: unknown[] = [];
    for (const tagId of uniqueTagIds) {
      params.push(payload.dataCardId, tagId, payload.userId, nowIso);
    }

    const insertResult = (await queryFromD1(
      `INSERT OR REPLACE INTO data_card_tags (data_card_id, tag_id, created_by_user_id, created_at)
       VALUES ${valuesSql}`,
      params
    )) as any;

    return { ok: Boolean(insertResult?.success) };
  } catch (error) {
    console.error('更新 data_card_tags 失败:', error);
    return { ok: false, error: '写入失败' };
  }
}

export async function replaceScopedTagsForDataCard(payload: {
  dataCardId: string;
  scope: Exclude<TagScope, 'user'>;
  tagIds: string[];
  createdByUserId?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  const dataCardId = typeof payload.dataCardId === 'string' ? payload.dataCardId.trim() : '';
  const scope = payload.scope;
  if (!dataCardId) return { ok: false, error: '缺少 dataCardId' };
  if (scope !== 'system' && scope !== 'admin') return { ok: false, error: 'scope 不支持' };

  try {
    const uniqueTagIds = Array.from(new Set(payload.tagIds.map((id) => id.trim()).filter(Boolean)));
    if (uniqueTagIds.length > 30) {
      return { ok: false, error: '最多只能选择 30 个标签' };
    }

    const tags = await getTagsByIds(uniqueTagIds);
    const invalid = tags.filter((t) => t.is_active !== 1 || t.scope !== scope).map((t) => t.id);
    if (tags.length !== uniqueTagIds.length || invalid.length > 0) {
      return { ok: false, error: '包含无效标签或 scope 不匹配' };
    }

    await queryFromD1(
      `DELETE FROM data_card_tags
       WHERE data_card_id = ?
         AND tag_id IN (SELECT id FROM tags WHERE scope = ?)`,
      [dataCardId, scope]
    );

    if (!uniqueTagIds.length) return { ok: true };

    const nowIso = new Date().toISOString();
    const createdByUserId =
      typeof payload.createdByUserId === 'number' && Number.isFinite(payload.createdByUserId) && payload.createdByUserId > 0
        ? Math.floor(payload.createdByUserId)
        : null;

    const valuesSql = uniqueTagIds.map(() => '(?,?,?,?)').join(', ');
    const params: unknown[] = [];
    for (const tagId of uniqueTagIds) {
      params.push(dataCardId, tagId, createdByUserId, nowIso);
    }

    const insertResult = (await queryFromD1(
      `INSERT OR REPLACE INTO data_card_tags (data_card_id, tag_id, created_by_user_id, created_at)
       VALUES ${valuesSql}`,
      params
    )) as any;

    return { ok: Boolean(insertResult?.success) };
  } catch (error) {
    console.error('更新 data_card_tags（scoped）失败:', error);
    return { ok: false, error: '写入失败' };
  }
}
