import { inArray } from 'drizzle-orm';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import { dataCardMetrics } from '@/lib/db/schema';
import type { TechLevel } from '@/lib/metrics/techIndex';

export type UpsertDataCardMetricsPayload = {
  dataCardId: string;
  techScore: number;
  techLevel: TechLevel;
  isNative: boolean | null;
  dataCardUpdatedAt: string;
  detailsJson?: Record<string, unknown> | null;
};

export type DataCardMetricsReadRow = {
  data_card_id: string;
  tech_score: number;
  tech_level: TechLevel;
  is_native: number | null;
  data_card_updated_at: string;
};

const toIntOrNull = (value: unknown): number | null => {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
};

const toTechLevel = (value: unknown): TechLevel => {
  return (typeof value === 'string' ? value : 'D') as TechLevel;
};

export const upsertDataCardMetricsByDataCardId = async (
  db: AppDrizzleDb,
  payload: UpsertDataCardMetricsPayload,
  nowIso: string,
): Promise<boolean> => {
  const inserted = await db
    .insert(dataCardMetrics)
    .values({
      dataCardId: payload.dataCardId,
      techScore: payload.techScore,
      techLevel: payload.techLevel,
      isNative: payload.isNative,
      dataCardUpdatedAt: payload.dataCardUpdatedAt,
      detailsJson: payload.detailsJson ? JSON.stringify(payload.detailsJson) : null,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: dataCardMetrics.dataCardId,
      set: {
        techScore: payload.techScore,
        techLevel: payload.techLevel,
        isNative: payload.isNative,
        dataCardUpdatedAt: payload.dataCardUpdatedAt,
        detailsJson: payload.detailsJson ? JSON.stringify(payload.detailsJson) : null,
        updatedAt: nowIso,
      },
    })
    .returning({
      dataCardId: dataCardMetrics.dataCardId,
    });

  return inserted.length > 0;
};

export const getDataCardMetricsRowsByIds = async (
  db: AppDrizzleDb,
  dataCardIds: string[],
): Promise<DataCardMetricsReadRow[]> => {
  const ids = Array.from(new Set(dataCardIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)));
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      dataCardId: dataCardMetrics.dataCardId,
      techScore: dataCardMetrics.techScore,
      techLevel: dataCardMetrics.techLevel,
      isNative: dataCardMetrics.isNative,
      dataCardUpdatedAt: dataCardMetrics.dataCardUpdatedAt,
    })
    .from(dataCardMetrics)
    .where(inArray(dataCardMetrics.dataCardId, ids));

  return rows
    .map((row) => ({
      data_card_id: typeof row.dataCardId === 'string' ? row.dataCardId : '',
      tech_score: toIntOrNull(row.techScore) ?? 0,
      tech_level: toTechLevel(row.techLevel),
      is_native: typeof row.isNative === 'boolean' ? (row.isNative ? 1 : 0) : toIntOrNull(row.isNative),
      data_card_updated_at: typeof row.dataCardUpdatedAt === 'string' ? row.dataCardUpdatedAt : '',
    }))
    .filter((row) => row.data_card_id.length > 0);
};
