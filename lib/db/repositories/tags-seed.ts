import { inArray } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { tagAliases, tags } from '@/lib/db/schema';

export type TagSeedScope = 'user' | 'system' | 'admin';

export type TagSeedRowInput = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: TagSeedScope;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const normalizeTagIds = (tagIds: string[]): string[] =>
  Array.from(
    new Set(
      tagIds
        .map((id) => (typeof id === 'string' ? id.trim() : ''))
        .filter(Boolean),
    ),
  );

export const listAllTagIds = async (db: AppDrizzleDb): Promise<string[]> => {
  const rows = await db
    .select({
      id: tags.id,
    })
    .from(tags);

  return rows
    .map((row) => (typeof row.id === 'string' ? row.id.trim() : ''))
    .filter(Boolean);
};

export const upsertTagSeedRow = async (
  db: AppDrizzleDb,
  input: TagSeedRowInput,
): Promise<void> => {
  await db
    .insert(tags)
    .values({
      id: input.id,
      name: input.name,
      description: input.description,
      category: input.category,
      scope: input.scope,
      isActive: input.isActive,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    })
    .onConflictDoUpdate({
      target: tags.id,
      set: {
        name: input.name,
        description: input.description,
        category: input.category,
        scope: input.scope,
        isActive: input.isActive,
        updatedAt: input.updatedAt,
      },
    });
};

export const upsertTagAliasSeedRow = async (
  db: AppDrizzleDb,
  input: { alias: string; tagId: string; createdAt: string },
): Promise<void> => {
  await db
    .insert(tagAliases)
    .values({
      alias: input.alias,
      tagId: input.tagId,
      createdAt: input.createdAt,
    })
    .onConflictDoUpdate({
      target: tagAliases.alias,
      set: {
        tagId: input.tagId,
      },
    });
};

export const deactivateTagsByIds = async (
  db: AppDrizzleDb,
  input: { tagIds: string[]; updatedAt: string },
): Promise<number> => {
  const safeTagIds = normalizeTagIds(input.tagIds);
  if (safeTagIds.length === 0) return 0;

  const rows = await db
    .update(tags)
    .set({
      isActive: false,
      updatedAt: input.updatedAt,
    })
    .where(inArray(tags.id, safeTagIds))
    .returning({
      id: tags.id,
    });

  return rows.length;
};
