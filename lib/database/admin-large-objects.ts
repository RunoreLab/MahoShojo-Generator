import { queryFromD1 } from './core';
import type { LargeObjectAssetFamily } from '@/lib/admin/large-object-insights';
import { listAllObjects } from '@/lib/r2';

export type AdminLargeObjectRow = {
  id: string;
  kind: string;
  owner_ref_id: string;
  owner_user_id: number | null;
  owner_username: string | null;
  r2_key: string;
  bytes: number;
  stored_bytes: number | null;
  sha256: string | null;
  content_type: string | null;
  content_encoding: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminLargeObjectKindSummary = {
  kind: string;
  total: number;
  bytes: number;
  storedBytes: number;
  lastCreatedAt: string | null;
};

export type AdminLargeObjectFamilySummary = {
  family: LargeObjectAssetFamily;
  total: number;
  bytes: number;
  storedBytes: number;
};

export type AdminLargeObjectConsistencySample = {
  rowId: string | null;
  kind: string;
  ownerRefId: string | null;
  ownerUserId: number | null;
  ownerUsername: string | null;
  r2Key: string;
  createdAt: string | null;
  updatedAt: string | null;
  detail: string;
  adminHref: string | null;
};

export type AdminLargeObjectConsistencyBucket = {
  count: number;
  available: boolean;
  samples: AdminLargeObjectConsistencySample[];
};

export type AdminLargeObjectConsistencyReport = {
  generatedAt: string;
  inspectedKinds: string[];
  skippedKinds: string[];
  indexedRowsInspected: number;
  r2ObjectsInspected: number;
  truncatedR2Scan: boolean;
  notes: string[];
  orphan: AdminLargeObjectConsistencyBucket;
  dangling: AdminLargeObjectConsistencyBucket;
  missingIndex: AdminLargeObjectConsistencyBucket;
};

export interface AdminLargeObjectListFilters {
  page?: number;
  limit?: number;
  kind?: string;
  search?: string;
  ownerUserId?: number;
  dateFrom?: string;
  dateTo?: string;
  minBytes?: number;
  maxBytes?: number;
  family?: LargeObjectAssetFamily;
}

const readRows = <T>(result: unknown): T[] => {
  const rows = (result as { result?: Array<{ results?: T[] }> })?.result?.[0]?.results;
  return Array.isArray(rows) ? rows : [];
};

const readInt = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return 0;
};

const readNullableInt = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return null;
};

const readNullableString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const readBool = (value: unknown): boolean => readInt(value) > 0;

const mapLargeObjectRow = (row: Record<string, unknown>): AdminLargeObjectRow => ({
  id: typeof row.id === 'string' ? row.id : '',
  kind: typeof row.kind === 'string' ? row.kind : '',
  owner_ref_id: typeof row.owner_ref_id === 'string' ? row.owner_ref_id : '',
  owner_user_id: readNullableInt(row.owner_user_id),
  owner_username: readNullableString(row.owner_username),
  r2_key: typeof row.r2_key === 'string' ? row.r2_key : '',
  bytes: readInt(row.bytes),
  stored_bytes: readNullableInt(row.stored_bytes),
  sha256: readNullableString(row.sha256),
  content_type: readNullableString(row.content_type),
  content_encoding: readNullableString(row.content_encoding),
  created_at: typeof row.created_at === 'string' ? row.created_at : '',
  updated_at: typeof row.updated_at === 'string' ? row.updated_at : '',
});

const buildFamilyWhereClause = (family: LargeObjectAssetFamily): string => {
  if (family === 'image') {
    return `(
      lo.content_type LIKE 'image/%'
      OR lower(lo.kind) IN ('portrait', 'illustration')
      OR lower(lo.kind) LIKE '%_image'
      OR lower(lo.kind) LIKE '%_illustration'
      OR lower(lo.kind) LIKE '%_portrait'
    )`;
  }
  if (family === 'text') {
    return `(
      lo.kind = 'battle_report_generation_output'
      OR lo.content_type LIKE 'text/%'
      OR lo.content_type LIKE '%json%'
      OR lo.content_type LIKE '%markdown%'
      OR lo.content_type LIKE '%xml%'
    )`;
  }
  return `NOT ${buildFamilyWhereClause('image')} AND NOT ${buildFamilyWhereClause('text')}`;
};

const BATTLE_REPORT_OUTPUT_KIND = 'battle_report_generation_output';
const BATTLE_REPORT_R2_PREFIX = 'v1/battle-report-generations/';
const CONSISTENCY_SAMPLE_LIMIT = 5;

type IndexedBattleReportConsistencyRow = {
  rowId: string;
  kind: string;
  ownerRefId: string;
  ownerUserId: number | null;
  ownerUsername: string | null;
  r2Key: string;
  createdAt: string | null;
  updatedAt: string | null;
  generationId: string | null;
  generationStatus: string | null;
  generationStartedAt: string | null;
  hasOutputPreview: boolean;
};

type MissingIndexGenerationRow = {
  generationId: string;
  generationStatus: string | null;
  startedAt: string | null;
  ownerUserId: number | null;
  ownerUsername: string | null;
};

const mapIndexedBattleReportConsistencyRow = (row: Record<string, unknown>): IndexedBattleReportConsistencyRow => ({
  rowId: typeof row.id === 'string' ? row.id : '',
  kind: typeof row.kind === 'string' ? row.kind : '',
  ownerRefId: typeof row.owner_ref_id === 'string' ? row.owner_ref_id : '',
  ownerUserId: readNullableInt(row.owner_user_id),
  ownerUsername: readNullableString(row.owner_username),
  r2Key: typeof row.r2_key === 'string' ? row.r2_key : '',
  createdAt: readNullableString(row.created_at),
  updatedAt: readNullableString(row.updated_at),
  generationId: readNullableString(row.generation_id),
  generationStatus: readNullableString(row.generation_status),
  generationStartedAt: readNullableString(row.generation_started_at),
  hasOutputPreview: readBool(row.has_output_preview),
});

const mapMissingIndexGenerationRow = (row: Record<string, unknown>): MissingIndexGenerationRow => ({
  generationId: typeof row.generation_id === 'string' ? row.generation_id : '',
  generationStatus: readNullableString(row.generation_status),
  startedAt: readNullableString(row.started_at),
  ownerUserId: readNullableInt(row.owner_user_id),
  ownerUsername: readNullableString(row.owner_username),
});

const buildBattleReportAdminHref = (generationId: string | null): string | null => {
  if (!generationId) return null;
  return `/admin/battle-report-generations?id=${encodeURIComponent(generationId)}`;
};

const parseBattleReportGenerationIdFromR2Key = (r2Key: string): string | null => {
  const match = r2Key.match(/^v1\/battle-report-generations\/\d{4}\/\d{2}\/\d{2}\/([^/]+)\/output\.(?:json|md)$/);
  if (!match || typeof match[1] !== 'string') return null;
  const generationId = match[1].trim();
  return generationId ? generationId : null;
};

const sortByNullableIsoDesc = <T>(items: T[], pickIso: (item: T) => string | null | undefined): T[] => {
  return [...items].sort((a, b) => {
    const aMs = Date.parse(pickIso(a) ?? '');
    const bMs = Date.parse(pickIso(b) ?? '');
    const aSafe = Number.isFinite(aMs) ? aMs : 0;
    const bSafe = Number.isFinite(bMs) ? bMs : 0;
    return bSafe - aSafe;
  });
};

function buildWhereClause(filters: AdminLargeObjectListFilters): {
  whereSql: string;
  params: Array<string | number>;
} {
  const whereParts: string[] = [];
  const params: Array<string | number> = [];

  if (filters.kind) {
    whereParts.push('lo.kind = ?');
    params.push(filters.kind);
  }

  if (typeof filters.ownerUserId === 'number' && Number.isFinite(filters.ownerUserId)) {
    whereParts.push('lo.owner_user_id = ?');
    params.push(Math.floor(filters.ownerUserId));
  }

  if (typeof filters.minBytes === 'number' && Number.isFinite(filters.minBytes)) {
    whereParts.push('lo.bytes >= ?');
    params.push(Math.max(0, Math.floor(filters.minBytes)));
  }

  if (typeof filters.maxBytes === 'number' && Number.isFinite(filters.maxBytes)) {
    whereParts.push('lo.bytes <= ?');
    params.push(Math.max(0, Math.floor(filters.maxBytes)));
  }

  if (filters.dateFrom) {
    whereParts.push('DATE(lo.created_at) >= DATE(?)');
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    whereParts.push('DATE(lo.created_at) <= DATE(?)');
    params.push(filters.dateTo);
  }

  if (filters.search) {
    whereParts.push(`(
      lo.id LIKE ?
      OR lo.kind LIKE ?
      OR lo.owner_ref_id LIKE ?
      OR lo.r2_key LIKE ?
      OR u.username LIKE ?
    )`);
    const term = `%${filters.search}%`;
    params.push(term, term, term, term, term);
  }

  if (filters.family) {
    whereParts.push(buildFamilyWhereClause(filters.family));
  }

  return {
    whereSql: whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '',
    params,
  };
}

export async function getAdminLargeObjectConsistencyReport(): Promise<AdminLargeObjectConsistencyReport> {
  const kindCatalogSql = `
    SELECT kind
    FROM large_objects
    GROUP BY kind
    ORDER BY kind ASC;
  `;

  const indexedBattleReportSql = `
    SELECT
      lo.id,
      lo.kind,
      lo.owner_ref_id,
      lo.owner_user_id,
      u.username AS owner_username,
      lo.r2_key,
      lo.created_at,
      lo.updated_at,
      brg.id AS generation_id,
      brg.status AS generation_status,
      brg.started_at AS generation_started_at,
      CASE
        WHEN NULLIF(TRIM(COALESCE(brg.output_preview, '')), '') IS NOT NULL THEN 1
        ELSE 0
      END AS has_output_preview
    FROM large_objects lo
    LEFT JOIN users u ON u.id = lo.owner_user_id
    LEFT JOIN battle_report_generations brg
      ON brg.id = lo.owner_ref_id
    WHERE lo.kind = ?
    ORDER BY datetime(lo.created_at) DESC, lo.id DESC;
  `;

  const [kindCatalogResult, indexedRowsResult, r2ScanResult] = await Promise.all([
    queryFromD1(kindCatalogSql),
    queryFromD1(indexedBattleReportSql, [BATTLE_REPORT_OUTPUT_KIND]),
    listAllObjects(BATTLE_REPORT_R2_PREFIX, { maxPages: 20, maxKeysPerPage: 1000 }),
  ]);

  const allKinds = readRows<Record<string, unknown>>(kindCatalogResult)
    .map((row) => (typeof row.kind === 'string' ? row.kind.trim() : ''))
    .filter(Boolean);
  const indexedRows = readRows<Record<string, unknown>>(indexedRowsResult).map(mapIndexedBattleReportConsistencyRow);
  const skippedKinds = allKinds.filter((kind) => kind !== BATTLE_REPORT_OUTPUT_KIND);
  const notes = [
    '当前 orphan / dangling / missing-index 仅覆盖战报正文 kind，其他资产 kind 需补 owner 映射与 R2 key 规范后再接入。',
  ];

  if (skippedKinds.length > 0) {
    notes.push(`以下 kind 暂未接入巡检：${skippedKinds.join('、')}`);
  }

  const orphanRows = indexedRows.filter((row) => !row.generationId);
  const orphanSamples = orphanRows.slice(0, CONSISTENCY_SAMPLE_LIMIT).map((row) => ({
    rowId: row.rowId,
    kind: row.kind,
    ownerRefId: row.ownerRefId,
    ownerUserId: row.ownerUserId,
    ownerUsername: row.ownerUsername,
    r2Key: row.r2Key,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    detail: '找不到 battle_report_generations 主记录，当前索引已失去业务归属。',
    adminHref: null,
  }));

  if (!r2ScanResult.success) {
    notes.push(`R2 前缀扫描失败：${r2ScanResult.error || '未知错误'}。dangling / missing-index 暂不可用。`);
    return {
      generatedAt: new Date().toISOString(),
      inspectedKinds: [BATTLE_REPORT_OUTPUT_KIND],
      skippedKinds,
      indexedRowsInspected: indexedRows.length,
      r2ObjectsInspected: 0,
      truncatedR2Scan: false,
      notes,
      orphan: {
        count: orphanRows.length,
        available: true,
        samples: orphanSamples,
      },
      dangling: {
        count: 0,
        available: false,
        samples: [],
      },
      missingIndex: {
        count: 0,
        available: false,
        samples: [],
      },
    };
  }

  const r2Objects = r2ScanResult.data?.objects ?? [];
  const r2ObjectMap = new Map(r2Objects.map((object) => [object.key, object]));
  const indexedKeySet = new Set(indexedRows.map((row) => row.r2Key).filter(Boolean));
  const danglingRows = indexedRows.filter((row) => row.generationId && !r2ObjectMap.has(row.r2Key));
  const danglingSamples = danglingRows.slice(0, CONSISTENCY_SAMPLE_LIMIT).map((row) => ({
    rowId: row.rowId,
    kind: row.kind,
    ownerRefId: row.ownerRefId,
    ownerUserId: row.ownerUserId,
    ownerUsername: row.ownerUsername,
    r2Key: row.r2Key,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    detail: row.hasOutputPreview
      ? '索引仍指向缺失的 R2 对象，但当前 generation 还保留了 D1 output_preview。'
      : '索引指向的 R2 对象不存在，且 generation 已无 D1 output_preview，正文可能不可恢复。',
    adminHref: buildBattleReportAdminHref(row.ownerRefId),
  }));

  const missingIndexObjects = sortByNullableIsoDesc(
    r2Objects.filter((object) => !indexedKeySet.has(object.key)),
    (object) => object.lastModified,
  );
  const missingIndexGenerationIds = Array.from(
    new Set(
      missingIndexObjects
        .slice(0, CONSISTENCY_SAMPLE_LIMIT)
        .map((object) => parseBattleReportGenerationIdFromR2Key(object.key))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  let generationById = new Map<string, MissingIndexGenerationRow>();
  if (missingIndexGenerationIds.length > 0) {
    const placeholders = missingIndexGenerationIds.map(() => '?').join(', ');
    const missingIndexGenerationSql = `
      SELECT
        brg.id AS generation_id,
        brg.status AS generation_status,
        brg.started_at,
        brg.user_id AS owner_user_id,
        COALESCE(brg.username, u.username) AS owner_username
      FROM battle_report_generations brg
      LEFT JOIN users u ON u.id = brg.user_id
      WHERE brg.id IN (${placeholders});
    `;
    const missingIndexGenerationResult = await queryFromD1(missingIndexGenerationSql, missingIndexGenerationIds);
    generationById = new Map(
      readRows<Record<string, unknown>>(missingIndexGenerationResult)
        .map(mapMissingIndexGenerationRow)
        .map((row) => [row.generationId, row]),
    );
  }

  const missingIndexSamples = missingIndexObjects.slice(0, CONSISTENCY_SAMPLE_LIMIT).map((object) => {
    const generationId = parseBattleReportGenerationIdFromR2Key(object.key);
    const generation = generationId ? generationById.get(generationId) ?? null : null;
    const detail = generation
      ? `R2 对象存在，但 large_objects 尚未建立索引。战报状态：${generation.generationStatus ?? '未知'}。`
      : generationId
        ? 'R2 对象存在，但找不到对应的 battle_report_generations 主记录；可能是历史遗留对象。'
        : 'R2 对象存在，但当前 key 无法解析 generationId；请核对 key 规范。';
    return {
      rowId: null,
      kind: BATTLE_REPORT_OUTPUT_KIND,
      ownerRefId: generationId,
      ownerUserId: generation?.ownerUserId ?? null,
      ownerUsername: generation?.ownerUsername ?? null,
      r2Key: object.key,
      createdAt: object.lastModified ?? null,
      updatedAt: object.lastModified ?? null,
      detail,
      adminHref: buildBattleReportAdminHref(generationId),
    };
  });

  if (r2ScanResult.data?.truncated) {
    notes.push('R2 前缀扫描达到分页上限，dangling / missing-index 结果可能不是全量。');
  }

  if (indexedRows.length === 0 && r2Objects.length === 0) {
    notes.push('当前战报正文索引与对应 R2 前缀均为空。');
  }

  return {
    generatedAt: new Date().toISOString(),
    inspectedKinds: [BATTLE_REPORT_OUTPUT_KIND],
    skippedKinds,
    indexedRowsInspected: indexedRows.length,
    r2ObjectsInspected: r2Objects.length,
    truncatedR2Scan: Boolean(r2ScanResult.data?.truncated),
    notes,
    orphan: {
      count: orphanRows.length,
      available: true,
      samples: orphanSamples,
    },
    dangling: {
      count: danglingRows.length,
      available: true,
      samples: danglingSamples,
    },
    missingIndex: {
      count: missingIndexObjects.length,
      available: true,
      samples: missingIndexSamples,
    },
  };
}

export async function listAdminLargeObjects(
  filters: AdminLargeObjectListFilters,
): Promise<{
  rows: AdminLargeObjectRow[];
  total: number;
  kindSummaries: AdminLargeObjectKindSummary[];
  familySummaries: AdminLargeObjectFamilySummary[];
  consistency: AdminLargeObjectConsistencyReport;
}> {
  const page = typeof filters.page === 'number' && Number.isFinite(filters.page) ? Math.max(1, Math.floor(filters.page)) : 1;
  const limit = typeof filters.limit === 'number' && Number.isFinite(filters.limit) ? Math.max(1, Math.min(200, Math.floor(filters.limit))) : 50;
  const offset = (page - 1) * limit;
  const { whereSql, params } = buildWhereClause(filters);

  const fromSql = `
    FROM large_objects lo
    LEFT JOIN users u ON u.id = lo.owner_user_id
    ${whereSql}
  `;

  const dataSql = `
    SELECT
      lo.*,
      u.username AS owner_username
    ${fromSql}
    ORDER BY datetime(lo.created_at) DESC, lo.id DESC
    LIMIT ? OFFSET ?;
  `;

  const countSql = `
    SELECT COUNT(*) AS total
    ${fromSql};
  `;

  const kindSummarySql = `
    SELECT
      lo.kind,
      COUNT(*) AS total,
      COALESCE(SUM(lo.bytes), 0) AS bytes,
      COALESCE(SUM(COALESCE(lo.stored_bytes, lo.bytes)), 0) AS stored_bytes,
      MAX(lo.created_at) AS last_created_at
    ${fromSql}
    GROUP BY lo.kind
    ORDER BY total DESC, lo.kind ASC
    LIMIT 12;
  `;

  const familySummarySql = `
    SELECT
      CASE
        WHEN (
          lo.content_type LIKE 'image/%'
          OR lower(lo.kind) IN ('portrait', 'illustration')
          OR lower(lo.kind) LIKE '%_image'
          OR lower(lo.kind) LIKE '%_illustration'
          OR lower(lo.kind) LIKE '%_portrait'
        ) THEN 'image'
        WHEN (
          lo.kind = 'battle_report_generation_output'
          OR lo.content_type LIKE 'text/%'
          OR lo.content_type LIKE '%json%'
          OR lo.content_type LIKE '%markdown%'
          OR lo.content_type LIKE '%xml%'
        ) THEN 'text'
        ELSE 'other'
      END AS family,
      COUNT(*) AS total,
      COALESCE(SUM(lo.bytes), 0) AS bytes,
      COALESCE(SUM(COALESCE(lo.stored_bytes, lo.bytes)), 0) AS stored_bytes
    ${fromSql}
    GROUP BY family;
  `;

  const [dataResult, countResult, kindSummaryResult, familySummaryResult, consistency] = await Promise.all([
    queryFromD1(dataSql, [...params, limit, offset]),
    queryFromD1(countSql, params),
    queryFromD1(kindSummarySql, params),
    queryFromD1(familySummarySql, params),
    getAdminLargeObjectConsistencyReport(),
  ]);

  const rows = readRows<Record<string, unknown>>(dataResult).map(mapLargeObjectRow);
  const total = readInt(readRows<Record<string, unknown>>(countResult)[0]?.total);
  const kindSummaries: AdminLargeObjectKindSummary[] = readRows<Record<string, unknown>>(kindSummaryResult).map((row) => ({
    kind: typeof row.kind === 'string' ? row.kind : '',
    total: readInt(row.total),
    bytes: readInt(row.bytes),
    storedBytes: readInt(row.stored_bytes),
    lastCreatedAt: readNullableString(row.last_created_at),
  }));

  const familyMap = new Map<LargeObjectAssetFamily, AdminLargeObjectFamilySummary>();
  for (const row of readRows<Record<string, unknown>>(familySummaryResult)) {
    const familyRaw = typeof row.family === 'string' ? row.family : 'other';
    const family: LargeObjectAssetFamily =
      familyRaw === 'image' || familyRaw === 'text' || familyRaw === 'other' ? familyRaw : 'other';
    familyMap.set(family, {
      family,
      total: readInt(row.total),
      bytes: readInt(row.bytes),
      storedBytes: readInt(row.stored_bytes),
    });
  }

  const familySummaries = (['text', 'image', 'other'] as LargeObjectAssetFamily[]).map((family) => (
    familyMap.get(family) ?? { family, total: 0, bytes: 0, storedBytes: 0 }
  ));

  return { rows, total, kindSummaries, familySummaries, consistency };
}

export async function getAdminLargeObjectById(id: string): Promise<AdminLargeObjectRow | null> {
  const safeId = typeof id === 'string' ? id.trim() : '';
  if (!safeId) return null;

  const sql = `
    SELECT
      lo.*,
      u.username AS owner_username
    FROM large_objects lo
    LEFT JOIN users u ON u.id = lo.owner_user_id
    WHERE lo.id = ?
    LIMIT 1;
  `;

  const row = readRows<Record<string, unknown>>(await queryFromD1(sql, [safeId]))[0];
  return row ? mapLargeObjectRow(row) : null;
}

export async function deleteAdminLargeObjectById(id: string): Promise<{ ok: boolean; changes: number; error?: string }> {
  const safeId = typeof id === 'string' ? id.trim() : '';
  if (!safeId) return { ok: false, changes: 0, error: '缺少 id' };

  try {
    const result = await queryFromD1('DELETE FROM large_objects WHERE id = ?;', [safeId]);
    const changes = readInt((result as { result?: Array<{ meta?: { changes?: number } }> })?.result?.[0]?.meta?.changes);
    return { ok: true, changes };
  } catch (error) {
    return {
      ok: false,
      changes: 0,
      error: error instanceof Error ? error.message : '删除 large_objects 失败',
    };
  }
}
