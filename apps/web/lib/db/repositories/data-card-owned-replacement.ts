import { sql, type SQL } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import type { OnlineDataCardType, OnlineDataCardVisibility, DataCardReviewStatus } from '@mahoshojo/contracts/data-cards';

/** 版本只覆盖会被替换/影响审核的实际内容，统计计数变化不使编辑失效。 */
export interface OwnedReplacementSnapshot {
  id: string; user_id: number; type: OnlineDataCardType; name: string;
  description: string | null; data: string; is_public: OnlineDataCardVisibility;
  review_status: DataCardReviewStatus | null; updated_at: string | null; deleted_at: string | null;
  favorite_count: number; usage_count: number;
  pending_id: string | null; pending_user_id: number | null;
  pending_name: string | null; pending_description: string | null; pending_data: string | null;
  pending_created_at: string | null; pending_updated_at: string | null;
}

export async function readOwnedReplacementSnapshot(db: AppDrizzleDb, id: string, userId: number): Promise<OwnedReplacementSnapshot | null> {
  const rows = await db.all<OwnedReplacementSnapshot>(sql`
    SELECT c.id, c.user_id, c.type, c.name, c.description, c.data,
      CAST(c.is_public AS INTEGER) AS is_public, c.review_status, c.updated_at, c.deleted_at,
      COALESCE(c.favorite_count, 0) AS favorite_count, COALESCE(c.usage_count, 0) AS usage_count,
      p.id AS pending_id, p.user_id AS pending_user_id, p.name AS pending_name,
      p.description AS pending_description, p.data AS pending_data,
      p.created_at AS pending_created_at, p.updated_at AS pending_updated_at
    FROM data_cards c LEFT JOIN data_card_updates p ON p.data_card_id = c.id
    WHERE c.id = ${id} AND c.user_id = ${userId} AND c.deleted_at IS NULL LIMIT 1`);
  return rows[0] ?? null;
}

export async function getOwnedReplacementVersion(row: OwnedReplacementSnapshot): Promise<string> {
  // Fixed field order; no timestamps alone, no reliance on object insertion order.
  const snapshot = [row.id, row.user_id, row.type, row.name, row.description, row.data,
    row.is_public, row.review_status, row.updated_at, row.deleted_at,
    row.pending_id, row.pending_user_id, row.pending_name, row.pending_description,
    row.pending_data, row.pending_created_at, row.pending_updated_at];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(snapshot)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function snapshotCondition(row: OwnedReplacementSnapshot): SQL {
  const pending = row.pending_id === null
    ? sql`NOT EXISTS (SELECT 1 FROM data_card_updates p WHERE p.data_card_id = ${row.id})`
    : sql`EXISTS (SELECT 1 FROM data_card_updates p WHERE p.data_card_id = ${row.id}
        AND p.id IS ${row.pending_id} AND p.user_id IS ${row.pending_user_id}
        AND p.name IS ${row.pending_name} AND p.description IS ${row.pending_description}
        AND p.data IS ${row.pending_data} AND p.created_at IS ${row.pending_created_at}
        AND p.updated_at IS ${row.pending_updated_at})`;
  return sql`EXISTS (SELECT 1 FROM data_cards c WHERE c.id = ${row.id}
    AND c.user_id = ${row.user_id} AND c.type IS ${row.type} AND c.name IS ${row.name}
    AND c.description IS ${row.description} AND c.data IS ${row.data}
    AND CAST(c.is_public AS INTEGER) IS ${row.is_public} AND c.review_status IS ${row.review_status}
    AND c.updated_at IS ${row.updated_at} AND c.deleted_at IS NULL) AND ${pending}`;
}

/** One SQLite/D1 statement: the predicates and replacement share the same write lock.
 * INSERT SELECT's WHERE guards both the insert and its unique-key UPSERT branch.
 * No read-then-write transaction emulation, no migrations, no timestamp-only CAS.
 */
export async function replaceOwnedDataCardAtomically(db: AppDrizzleDb, row: OwnedReplacementSnapshot, data: string, pendingReview: boolean): Promise<boolean> {
  const condition = snapshotCondition(row);
  const rows = pendingReview
    ? await db.all<{ id: string }>(sql`
        INSERT INTO data_card_updates (id, data_card_id, user_id, name, description, data, created_at, updated_at)
        SELECT ${crypto.randomUUID()}, ${row.id}, ${row.user_id}, ${row.name}, ${row.description}, ${data}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        WHERE ${condition}
        ON CONFLICT(data_card_id) DO UPDATE SET
          user_id = excluded.user_id, name = excluded.name, description = excluded.description,
          data = excluded.data, created_at = COALESCE(data_card_updates.created_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
        RETURNING id`)
    : await db.all<{ id: string }>(sql`
        UPDATE data_cards SET name = ${row.name}, description = ${row.description}, data = ${data}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${row.id} AND user_id = ${row.user_id} AND ${condition} RETURNING id`);
  return rows.length === 1;
}
