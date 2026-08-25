import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { dataCards } from '@/lib/db/schema';

export type ChallengePublicCardRow = {
  id: string;
  name: string;
  data: string;
  updatedAt: string | null;
};

export async function listChallengePublicCharacterCardsByIds(
  db: AppDrizzleDb,
  ids: string[],
): Promise<ChallengePublicCardRow[]> {
  const normalizedIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (normalizedIds.length === 0) return [];

  const rows = await db
    .select({
      id: dataCards.id,
      name: dataCards.name,
      data: dataCards.data,
      updatedAt: dataCards.updatedAt,
    })
    .from(dataCards)
    .where(
      and(
        inArray(dataCards.id, normalizedIds),
        eq(dataCards.type, 'character'),
        eq(dataCards.isPublic, true),
        eq(dataCards.reviewStatus, 'approved'),
        isNull(dataCards.deletedAt),
      ),
    );

  const rowById = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: typeof row.name === 'string' ? row.name : '',
        data: typeof row.data === 'string' ? row.data : '',
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
      } satisfies ChallengePublicCardRow,
    ]),
  );

  return normalizedIds.map((id) => rowById.get(id)).filter((row): row is ChallengePublicCardRow => row !== undefined);
}
