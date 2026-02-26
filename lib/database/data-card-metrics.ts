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

type DataCardMetricsRepoBundle = {
  db: unknown;
  upsertDataCardMetricsByDataCardId: (
    db: unknown,
    payload: UpsertDataCardMetricsPayload,
    nowIso: string,
  ) => Promise<boolean>;
  getDataCardMetricsRowsByIds: (
    db: unknown,
    dataCardIds: string[],
  ) => Promise<Array<{
    data_card_id: string;
    tech_score: number;
    tech_level: TechLevel;
    is_native: number | null;
    data_card_updated_at: string;
  }>>;
};

const readDataCardMetricsRepoBundle = async (): Promise<DataCardMetricsRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/data-card-metrics'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      upsertDataCardMetricsByDataCardId: repo.upsertDataCardMetricsByDataCardId as DataCardMetricsRepoBundle['upsertDataCardMetricsByDataCardId'],
      getDataCardMetricsRowsByIds: repo.getDataCardMetricsRowsByIds as DataCardMetricsRepoBundle['getDataCardMetricsRowsByIds'],
    };
  } catch {
    return null;
  }
};

export async function upsertDataCardMetrics(payload: UpsertDataCardMetricsPayload): Promise<boolean> {
  try {
    const bundle = await readDataCardMetricsRepoBundle();
    if (!bundle) return false;
    const nowIso = new Date().toISOString();
    return await bundle.upsertDataCardMetricsByDataCardId(bundle.db, payload, nowIso);
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

  try {
    const bundle = await readDataCardMetricsRepoBundle();
    if (!bundle) return map;
    const rows = await bundle.getDataCardMetricsRowsByIds(bundle.db, dataCardIds);

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

