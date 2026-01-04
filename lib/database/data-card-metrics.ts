import { queryFromD1 } from './core';
import type { TechLevel } from '@/lib/metrics/techIndex';

export interface DataCardMetricsRow {
  data_card_id: string;
  tech_score: number;
  tech_level: TechLevel;
  is_native: number | null;
  data_card_updated_at: string;
  details_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertDataCardMetricsPayload {
  dataCardId: string;
  techScore: number;
  techLevel: TechLevel;
  isNative: boolean | null;
  dataCardUpdatedAt: string;
  detailsJson?: Record<string, unknown> | null;
}

export async function upsertDataCardMetrics(payload: UpsertDataCardMetricsPayload): Promise<boolean> {
  try {
    const nowIso = new Date().toISOString();
    const isNativeValue = typeof payload.isNative === 'boolean' ? (payload.isNative ? 1 : 0) : null;
    const detailsJson = payload.detailsJson ? JSON.stringify(payload.detailsJson) : null;

    const result = (await queryFromD1(
      `INSERT INTO data_card_metrics (
        data_card_id,
        tech_score,
        tech_level,
        is_native,
        data_card_updated_at,
        details_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(data_card_id) DO UPDATE SET
        tech_score = excluded.tech_score,
        tech_level = excluded.tech_level,
        is_native = excluded.is_native,
        data_card_updated_at = excluded.data_card_updated_at,
        details_json = excluded.details_json,
        updated_at = excluded.updated_at`,
      [
        payload.dataCardId,
        payload.techScore,
        payload.techLevel,
        isNativeValue,
        payload.dataCardUpdatedAt,
        detailsJson,
        nowIso,
        nowIso,
      ]
    )) as any;

    return Boolean(result?.success);
  } catch (error) {
    console.error('写入 data_card_metrics 失败:', error);
    return false;
  }
}

export async function getDataCardMetricsByIds(
  dataCardIds: string[]
): Promise<Map<string, Pick<DataCardMetricsRow, 'tech_score' | 'tech_level' | 'is_native' | 'data_card_updated_at'>>> {
  const map = new Map<string, Pick<DataCardMetricsRow, 'tech_score' | 'tech_level' | 'is_native' | 'data_card_updated_at'>>();
  if (!dataCardIds.length) return map;

  const placeholders = dataCardIds.map(() => '?').join(', ');
  try {
    const result = (await queryFromD1(
      `SELECT data_card_id, tech_score, tech_level, is_native, data_card_updated_at
       FROM data_card_metrics
       WHERE data_card_id IN (${placeholders})`,
      dataCardIds
    )) as any;

    const rows = (result?.result?.[0]?.results ?? []) as Array<{
      data_card_id: string;
      tech_score: number;
      tech_level: TechLevel;
      is_native: number | null;
      data_card_updated_at: string;
    }>;

    for (const row of rows) {
      if (!row?.data_card_id) continue;
      map.set(row.data_card_id, {
        tech_score: row.tech_score,
        tech_level: row.tech_level,
        is_native: row.is_native,
        data_card_updated_at: row.data_card_updated_at,
      });
    }

    return map;
  } catch (error) {
    console.error('读取 data_card_metrics 失败:', error);
    return map;
  }
}

