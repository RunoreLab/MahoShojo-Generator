import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { dataCardTags, tags } from '@/lib/db/schema';

export type TagScope = 'user' | 'system' | 'admin';

export type TagRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: TagScope;
  is_active: number;
  created_at: string;
  updated_at: string;
};

type DataCardTagInsertRow = {
  dataCardId: string;
  tagId: string;
  createdByUserId: number;
  createdAt: string;
};

const asTagScope = (value: unknown): TagScope => {
  if (value === 'system' || value === 'admin') return value;
  return 'user';
};

const asTagRow = (row: {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}): TagRow => ({
  id: row.id,
  name: row.name,
  description: typeof row.description === 'string' ? row.description : null,
  category: typeof row.category === 'string' ? row.category : null,
  scope: asTagScope(row.scope),
  is_active: row.isActive ? 1 : 0,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
});

const sanitizeTagIds = (tagIds: string[]): string[] =>
  Array.from(new Set(tagIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)));

export const listTags = async (
  db: AppDrizzleDb,
  input?: { includeInactive?: boolean },
): Promise<TagRow[]> => {
  const includeInactive = input?.includeInactive === true;
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      description: tags.description,
      category: tags.category,
      scope: tags.scope,
      isActive: tags.isActive,
      createdAt: tags.createdAt,
      updatedAt: tags.updatedAt,
    })
    .from(tags)
    .where(includeInactive ? undefined : eq(tags.isActive, true))
    .orderBy(asc(tags.category), asc(tags.id));

  return rows.map(asTagRow);
};

export const listTagsByIds = async (
  db: AppDrizzleDb,
  tagIds: string[],
): Promise<TagRow[]> => {
  const safeTagIds = sanitizeTagIds(tagIds);
  if (safeTagIds.length === 0) return [];

  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      description: tags.description,
      category: tags.category,
      scope: tags.scope,
      isActive: tags.isActive,
      createdAt: tags.createdAt,
      updatedAt: tags.updatedAt,
    })
    .from(tags)
    .where(inArray(tags.id, safeTagIds));

  return rows.map(asTagRow);
};

export const listTagsForDataCard = async (
  db: AppDrizzleDb,
  dataCardId: string,
): Promise<TagRow[]> => {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      description: tags.description,
      category: tags.category,
      scope: tags.scope,
      isActive: tags.isActive,
      createdAt: tags.createdAt,
      updatedAt: tags.updatedAt,
    })
    .from(dataCardTags)
    .innerJoin(tags, eq(tags.id, dataCardTags.tagId))
    .where(eq(dataCardTags.dataCardId, dataCardId))
    .orderBy(asc(tags.category), asc(tags.id));

  return rows.map(asTagRow);
};

export const listActiveUserScopeTagsByIds = async (
  db: AppDrizzleDb,
  tagIds: string[],
): Promise<TagRow[]> => {
  const safeTagIds = sanitizeTagIds(tagIds);
  if (safeTagIds.length === 0) return [];

  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      description: tags.description,
      category: tags.category,
      scope: tags.scope,
      isActive: tags.isActive,
      createdAt: tags.createdAt,
      updatedAt: tags.updatedAt,
    })
    .from(tags)
    .where(and(inArray(tags.id, safeTagIds), eq(tags.isActive, true), eq(tags.scope, 'user')));

  return rows.map(asTagRow);
};

export const listUserScopeTagIds = async (db: AppDrizzleDb): Promise<string[]> => {
  const rows = await db
    .select({
      id: tags.id,
    })
    .from(tags)
    .where(eq(tags.scope, 'user'));

  return rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
};

export const deleteDataCardTagsByIds = async (
  db: AppDrizzleDb,
  dataCardId: string,
  tagIds: string[],
): Promise<void> => {
  const safeTagIds = sanitizeTagIds(tagIds);
  if (safeTagIds.length === 0) return;

  await db
    .delete(dataCardTags)
    .where(and(eq(dataCardTags.dataCardId, dataCardId), inArray(dataCardTags.tagId, safeTagIds)));
};

export const upsertDataCardTags = async (
  db: AppDrizzleDb,
  rows: DataCardTagInsertRow[],
): Promise<void> => {
  if (rows.length === 0) return;

  await db
    .insert(dataCardTags)
    .values(
      rows.map((row) => ({
        dataCardId: row.dataCardId,
        tagId: row.tagId,
        createdByUserId: row.createdByUserId,
        createdAt: row.createdAt,
      })),
    )
    .onConflictDoUpdate({
      target: [dataCardTags.dataCardId, dataCardTags.tagId],
      set: {
        createdByUserId: rows[0]?.createdByUserId ?? null,
        createdAt: rows[0]?.createdAt ?? null,
      },
    });
};
