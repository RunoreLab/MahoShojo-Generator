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

