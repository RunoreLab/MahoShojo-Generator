import { queryFromD1 } from './core';
import type { BattleReportGenerationMode, BattleReportGenerationStatus } from './battle-report-generations';

export interface AdminBattleReportGenerationListFilters {
  page?: number;
  limit?: number;
  sortBy?: 'started_at' | 'duration_ms' | 'total_tokens' | 'created_at';
  sortOrder?: 'asc' | 'desc';

  status?: BattleReportGenerationStatus;
  mode?: string;
  generationMode?: BattleReportGenerationMode;

  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD

  userId?: number;
  username?: string;
  scenarioDataCardId?: string;
  endpoint?: string;

  hasSensitiveWords?: boolean;
  hasShieldWords?: boolean;

  search?: string;
}

export interface AdminBattleReportGenerationListRow {
  id: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: BattleReportGenerationStatus;
  generation_mode: BattleReportGenerationMode;
  endpoint: string;

  user_id: number | null;
  username: string | null;
  user_prefix: string | null;

  mode: string;
  scenario_title: string | null;
  scenario_data_card_id: string | null;

  combatant_count: number | null;
  headline: string | null;
  winner: string | null;

  ai_provider_name: string | null;
  ai_provider_type: string | null;
  ai_model: string | null;

  total_tokens: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;

  output_chars: number | null;
  output_bytes: number | null;
  output_has_sensitive_words: number | null;
  output_has_shield_words: number | null;

  combatants_write_ok: number | null;
  combatants_row_count: number | null;
  combatants_write_error: string | null;

  combatant_names: string | null;
  combatant_card_ids: string | null;
}

export interface AdminBattleReportGenerationCombatantRow {
  id: number;
  generation_id: string;
  sort_index: number;
  name: string;
  type: string | null;
  template_id: string | null;
  is_native: number | null;
  is_preset: number | null;
  team_id: number | null;
  data_card_id: string | null;
  data_card_updated_at: string | null;
  size_chars: number | null;
  size_bytes: number | null;
  created_at: string;
}

export interface AdminBattleReportGenerationDetail {
  generation: Record<string, unknown>;
  combatants: AdminBattleReportGenerationCombatantRow[];
}

const DEFAULT_EXPORT_MAX_ROWS = 5_000;

const sortableColumns: Record<NonNullable<AdminBattleReportGenerationListFilters['sortBy']>, string> = {
  started_at: 'brg.started_at',
  duration_ms: 'brg.duration_ms',
  total_tokens: 'brg.total_tokens',
  created_at: 'brg.created_at',
};

function buildWhereClause(filters: AdminBattleReportGenerationListFilters): { whereSql: string; params: (string | number)[] } {
  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.status) {
    whereClauses.push('brg.status = ?');
    params.push(filters.status);
  }

  if (filters.mode) {
    whereClauses.push('brg.mode = ?');
    params.push(filters.mode);
  }

  if (filters.generationMode) {
    whereClauses.push('brg.generation_mode = ?');
    params.push(filters.generationMode);
  }

  if (filters.dateFrom) {
    whereClauses.push("DATE(brg.started_at) >= DATE(?)");
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    whereClauses.push("DATE(brg.started_at) <= DATE(?)");
    params.push(filters.dateTo);
  }

  if (typeof filters.userId === 'number' && Number.isFinite(filters.userId)) {
    whereClauses.push('brg.user_id = ?');
    params.push(filters.userId);
  }

  if (filters.username) {
    whereClauses.push('brg.username LIKE ?');
    params.push(`%${filters.username}%`);
  }

  if (filters.scenarioDataCardId) {
    whereClauses.push('brg.scenario_data_card_id = ?');
    params.push(filters.scenarioDataCardId);
  }

  if (filters.endpoint) {
    whereClauses.push('brg.endpoint LIKE ?');
    params.push(`%${filters.endpoint}%`);
  }

  if (filters.hasSensitiveWords) {
    whereClauses.push('brg.output_has_sensitive_words = 1');
  }

  if (filters.hasShieldWords) {
    whereClauses.push('brg.output_has_shield_words = 1');
  }

  if (filters.search) {
    const searchTerm = `%${filters.search}%`;
    const numeric = Number(filters.search);
    const orClauses: string[] = [
      'brg.id LIKE ?',
      'brg.username LIKE ?',
      'brg.user_prefix LIKE ?',
      'brg.mode LIKE ?',
      'brg.endpoint LIKE ?',
      'brg.scenario_title LIKE ?',
      'brg.scenario_data_card_id LIKE ?',
      'brg.headline LIKE ?',
      'brg.winner LIKE ?',
      `EXISTS(
        SELECT 1
        FROM battle_report_generation_combatants c
        WHERE c.generation_id = brg.id
          AND (c.name LIKE ? OR c.data_card_id LIKE ?)
      )`,
    ];

    const baseParams: (string | number)[] = [
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
      searchTerm,
    ];

    if (Number.isFinite(numeric) && Number.isInteger(numeric)) {
      orClauses.push('brg.user_id = ?');
      baseParams.push(numeric);
    }

    whereClauses.push(`(${orClauses.join(' OR ')})`);
    params.push(...baseParams);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  return { whereSql, params };
}

export async function getAdminBattleReportGenerations(
  filters: AdminBattleReportGenerationListFilters
): Promise<{ records: AdminBattleReportGenerationListRow[]; total: number }> {
  const {
    page = 1,
    limit = 20,
    sortBy = 'started_at',
    sortOrder = 'desc',
  } = filters;

  const offset = (page - 1) * limit;
  const { whereSql, params } = buildWhereClause(filters);

  const sortColumn = sortableColumns[sortBy] || sortableColumns.started_at;
  const orderSql = sortOrder === 'asc' ? 'ASC' : 'DESC';

  const dataSql = `
    SELECT
      brg.id,
      brg.started_at,
      brg.ended_at,
      brg.duration_ms,
      brg.status,
      brg.generation_mode,
      brg.endpoint,
      brg.user_id,
      COALESCE(brg.username, u.username) AS username,
      COALESCE(brg.user_prefix, u.prefix) AS user_prefix,
      brg.mode,
      brg.scenario_title,
      brg.scenario_data_card_id,
      brg.combatant_count,
      brg.headline,
      brg.winner,
      brg.ai_provider_name,
      brg.ai_provider_type,
      brg.ai_model,
      brg.total_tokens,
      brg.prompt_tokens,
      brg.completion_tokens,
      brg.cached_tokens,
      brg.reasoning_tokens,
      brg.output_chars,
      brg.output_bytes,
      brg.output_has_sensitive_words,
      brg.output_has_shield_words,
      brg.combatants_write_ok,
      brg.combatants_row_count,
      brg.combatants_write_error,
      group_concat(c.name, ' / ') AS combatant_names,
      group_concat(c.data_card_id, ' / ') AS combatant_card_ids
    FROM battle_report_generations brg
    LEFT JOIN users u ON u.id = brg.user_id
    LEFT JOIN battle_report_generation_combatants c ON c.generation_id = brg.id
    ${whereSql}
    GROUP BY brg.id
    ORDER BY ${sortColumn} ${orderSql}
    LIMIT ? OFFSET ?;
  `;

  const countSql = `
    SELECT COUNT(brg.id) AS total
    FROM battle_report_generations brg
    ${whereSql};
  `;

  const dataParams = [...params, limit, offset];
  const countParams = [...params];

  const [dataResult, countResult] = await Promise.all([
    queryFromD1(dataSql, dataParams),
    queryFromD1(countSql, countParams),
  ]);

  const records = (dataResult as any)?.success ? ((dataResult as any).result?.[0]?.results || []) : [];
  const total = (countResult as any)?.success ? Number((countResult as any).result?.[0]?.results?.[0]?.total || 0) : 0;

  return { records, total };
}

export async function getAdminBattleReportGenerationDetail(id: string): Promise<AdminBattleReportGenerationDetail | null> {
  const generationSql = `
    SELECT
      brg.*,
      COALESCE(brg.username, u.username) AS username,
      COALESCE(brg.user_prefix, u.prefix) AS user_prefix
    FROM battle_report_generations brg
    LEFT JOIN users u ON u.id = brg.user_id
    WHERE brg.id = ?;
  `;
  const combatantsSql = `
    SELECT *
    FROM battle_report_generation_combatants
    WHERE generation_id = ?
    ORDER BY sort_index ASC;
  `;

  const [generationResult, combatantsResult] = await Promise.all([
    queryFromD1(generationSql, [id]),
    queryFromD1(combatantsSql, [id]),
  ]);

  const generation = (generationResult as any)?.success ? (generationResult as any).result?.[0]?.results?.[0] : null;
  if (!generation) return null;

  const combatants = (combatantsResult as any)?.success ? ((combatantsResult as any).result?.[0]?.results || []) : [];

  // 尝试解析 extra_json（若为 JSON 字符串）
  if (typeof (generation as any).extra_json === 'string') {
    try {
      (generation as any).extra_json = JSON.parse((generation as any).extra_json);
    } catch {
      // 忽略解析失败，保持原字符串
    }
  }

  return { generation, combatants };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function exportAdminBattleReportGenerations(params: {
  ids?: string[];
  filters?: AdminBattleReportGenerationListFilters;
  includeCombatants?: boolean;
  maxRows?: number;
}): Promise<{ rows: any[]; total: number; truncated: boolean }> {
  const includeCombatants = params.includeCombatants !== false;
  const maxRows = Math.max(1, Math.min(50_000, params.maxRows ?? DEFAULT_EXPORT_MAX_ROWS));

  let baseRows: any[] = [];
  let total = 0;
  let truncated = false;

  if (params.ids && params.ids.length > 0) {
    const ids = params.ids;
    total = ids.length;

    const rows: any[] = [];
    for (const group of chunk(ids, 500)) {
      const placeholders = group.map(() => '?').join(', ');
      const sql = `SELECT * FROM battle_report_generations WHERE id IN (${placeholders}) ORDER BY started_at DESC;`;
      const res = (await queryFromD1(sql, group)) as any;
      const part = res?.success ? res.result?.[0]?.results || [] : [];
      rows.push(...part);
    }
    baseRows = rows;
  } else {
    const filters = params.filters || {};
    const { whereSql, params: whereParams } = buildWhereClause(filters);

    const sortBy = filters.sortBy || 'started_at';
    const sortOrder = filters.sortOrder || 'desc';
    const sortColumn = sortableColumns[sortBy] || sortableColumns.started_at;
    const orderSql = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const dataSql = `
      SELECT *
      FROM battle_report_generations brg
      ${whereSql}
      ORDER BY ${sortColumn} ${orderSql}
      LIMIT ?;
    `;

    const countSql = `
      SELECT COUNT(brg.id) AS total
      FROM battle_report_generations brg
      ${whereSql};
    `;

    const [dataResult, countResult] = await Promise.all([
      queryFromD1(dataSql, [...whereParams, maxRows + 1]),
      queryFromD1(countSql, whereParams),
    ]);

    const dataRows = (dataResult as any)?.success ? ((dataResult as any).result?.[0]?.results || []) : [];
    total = (countResult as any)?.success ? Number((countResult as any).result?.[0]?.results?.[0]?.total || 0) : 0;

    if (dataRows.length > maxRows) {
      truncated = true;
      baseRows = dataRows.slice(0, maxRows);
    } else {
      baseRows = dataRows;
    }
  }

  if (!includeCombatants) {
    return { rows: baseRows, total, truncated };
  }

  const idList = baseRows.map(r => String(r.id)).filter(Boolean);
  const combatantsByGenerationId = new Map<string, AdminBattleReportGenerationCombatantRow[]>();

  for (const group of chunk(idList, 300)) {
    const placeholders = group.map(() => '?').join(', ');
    const sql = `
      SELECT *
      FROM battle_report_generation_combatants
      WHERE generation_id IN (${placeholders})
      ORDER BY generation_id ASC, sort_index ASC;
    `;
    const res = (await queryFromD1(sql, group)) as any;
    const rows = res?.success ? res.result?.[0]?.results || [] : [];
    for (const row of rows) {
      const generationId = String(row.generation_id);
      const list = combatantsByGenerationId.get(generationId) || [];
      list.push(row);
      combatantsByGenerationId.set(generationId, list);
    }
  }

  const merged = baseRows.map(row => ({
    ...row,
    extra_json: typeof row.extra_json === 'string'
      ? (() => {
          try {
            return JSON.parse(row.extra_json);
          } catch {
            return row.extra_json;
          }
        })()
      : row.extra_json,
    combatants: combatantsByGenerationId.get(String(row.id)) || [],
  }));

  return { rows: merged, total, truncated };
}
