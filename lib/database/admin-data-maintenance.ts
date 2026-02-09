import { deleteObject } from '@/lib/r2';

import { queryFromD1 } from './core';

export type AdminDataCleanupTarget =
  | 'battle_report_generations'
  | 'arena_rating_events'
  | 'pvp_rounds'
  | 'large_objects';

export type AdminDataCleanupRiskLevel = 'low' | 'medium' | 'high';

export type AdminDataCleanupScopeInput = {
  dateFrom?: string;
  dateTo?: string;
  statusIn?: string[];
  queue?: string;
  kind?: string;
  pvpOnly?: boolean;
};

export type AdminDataCleanupFieldActionInput = {
  type: 'field';
  field: string;
  op: 'truncate' | 'set_null_or_default';
  truncate?: {
    maxChars?: number;
  };
  setMode?: 'null' | 'empty' | 'default';
};

export type AdminDataCleanupDeleteRowsActionInput = {
  type: 'delete_rows';
  deleteR2?: boolean;
};

export type AdminDataCleanupActionInput =
  | AdminDataCleanupFieldActionInput
  | AdminDataCleanupDeleteRowsActionInput;

export type AdminDataCleanupPlanInput = {
  target?: unknown;
  scope?: unknown;
  actions?: unknown;
};

type AdminDataCleanupScope = {
  dateFrom?: string;
  dateTo?: string;
  statusIn?: string[];
  queue?: 'strict' | 'free';
  kind?: string;
  pvpOnly?: boolean;
};

type AdminDataCleanupFieldAction = {
  type: 'field';
  field: string;
  op: 'truncate' | 'set_null_or_default';
  maxChars?: number;
  setMode?: 'null' | 'empty' | 'default';
};

type AdminDataCleanupDeleteRowsAction = {
  type: 'delete_rows';
  deleteR2: boolean;
};

type AdminDataCleanupAction = AdminDataCleanupFieldAction | AdminDataCleanupDeleteRowsAction;

type AdminDataCleanupPlan = {
  target: AdminDataCleanupTarget;
  scope: AdminDataCleanupScope;
  actions: AdminDataCleanupAction[];
};

type CleanupFieldDefinition = {
  field: string;
  label: string;
  defaultValue: string | null;
};

type CleanupTargetDefinition = {
  target: AdminDataCleanupTarget;
  label: string;
  table: string;
  idColumn: string;
  orderBy: string;
  dateColumn?: string;
  statusValues?: string[];
  queueValues?: Array<'strict' | 'free'>;
  supportsPvpOnly?: boolean;
  supportsKind?: boolean;
  fieldDefinitions: CleanupFieldDefinition[];
  sizeEstimateFields: string[];
};

type WhereClause = {
  whereSql: string;
  params: unknown[];
  warnings: string[];
};

type D1Row = Record<string, unknown>;

type PreviewSampleRow = {
  id: string | number;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export type AdminDataCleanupPreviewResult = {
  target: AdminDataCleanupTarget;
  targetLabel: string;
  planHash: string;
  normalizedPlan: {
    target: AdminDataCleanupTarget;
    scope: AdminDataCleanupScope;
    actions: AdminDataCleanupAction[];
  };
  affectedRows: number;
  estimatedBytesBefore: number;
  estimatedBytesAfter: number;
  estimatedBytesSaved: number;
  riskLevel: AdminDataCleanupRiskLevel;
  warnings: string[];
  dependencyImpact: Record<string, number>;
  samples: PreviewSampleRow[];
};

export type AdminDataCleanupExecutionResult = {
  target: AdminDataCleanupTarget;
  targetLabel: string;
  planHash: string;
  totalMatchedRows: number;
  selectedRows: number;
  truncatedByMaxRows: boolean;
  affectedRows: number;
  cellChanges: number;
  batchCount: number;
  warnings: string[];
  r2Deleted: number;
  r2DeleteFailed: number;
  dependencyImpact: Record<string, number>;
};

export type AdminDataCleanupBatchProgress = {
  batchNo: number;
  batchSize: number;
  affectedRows: number;
  cellChanges: number;
  mode: 'delete_rows' | 'field_update';
  note: string;
};

export type AdminDataCleanupJobStatus = 'running' | 'completed' | 'failed';

export type AdminDataCleanupJobListRow = {
  id: string;
  target: AdminDataCleanupTarget;
  status: AdminDataCleanupJobStatus;
  riskLevel: AdminDataCleanupRiskLevel | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  totalMatchedRows: number;
  selectedRows: number;
  affectedRows: number;
  cellChanges: number;
  r2Deleted: number;
  r2DeleteFailed: number;
  warningCount: number;
  errorText: string | null;
};

export type AdminDataCleanupJobLogRow = {
  id: number;
  batchNo: number;
  affectedRows: number;
  cellChanges: number;
  note: string | null;
  createdAt: string;
};

export type AdminDataCleanupJobDetail = AdminDataCleanupJobListRow & {
  planHash: string;
  scope: Record<string, unknown>;
  actions: unknown[];
  preview: Record<string, unknown> | null;
  warnings: string[];
  logs: AdminDataCleanupJobLogRow[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_KEYWORD_RE = /^[a-zA-Z0-9_\-:.]+$/;

const isTooManySqlVariablesError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes('too many sql variables');
};

const withSqlVariableFallbackForNumericResult = async (
  ids: Array<string | number>,
  run: (safeIds: Array<string | number>) => Promise<number>,
): Promise<number> => {
  if (ids.length <= 0) return 0;
  try {
    return await run(ids);
  } catch (error) {
    if (!isTooManySqlVariablesError(error) || ids.length <= 1) throw error;
    const mid = Math.floor(ids.length / 2);
    if (mid <= 0 || mid >= ids.length) throw error;
    const left = await withSqlVariableFallbackForNumericResult(ids.slice(0, mid), run);
    const right = await withSqlVariableFallbackForNumericResult(ids.slice(mid), run);
    return left + right;
  }
};

const withSqlVariableFallbackForRows = async <T>(
  ids: Array<string | number>,
  run: (safeIds: Array<string | number>) => Promise<T[]>,
): Promise<T[]> => {
  if (ids.length <= 0) return [];
  try {
    return await run(ids);
  } catch (error) {
    if (!isTooManySqlVariablesError(error) || ids.length <= 1) throw error;
    const mid = Math.floor(ids.length / 2);
    if (mid <= 0 || mid >= ids.length) throw error;
    const left = await withSqlVariableFallbackForRows(ids.slice(0, mid), run);
    const right = await withSqlVariableFallbackForRows(ids.slice(mid), run);
    return [...left, ...right];
  }
};

const cleanupTargetDefinitions: Record<AdminDataCleanupTarget, CleanupTargetDefinition> = {
  battle_report_generations: {
    target: 'battle_report_generations',
    label: '战报生成记录',
    table: 'battle_report_generations',
    idColumn: 'id',
    orderBy: 'started_at DESC, id ASC',
    dateColumn: 'started_at',
    statusValues: ['completed', 'aborted', 'failed'],
    supportsPvpOnly: true,
    fieldDefinitions: [
      { field: 'output_preview', label: '战报正文预览', defaultValue: null },
      { field: 'user_guidance_preview', label: '用户引导预览', defaultValue: null },
      { field: 'adjudication_events_preview', label: '判定器事件预览', defaultValue: null },
      { field: 'extra_json', label: '扩展 JSON', defaultValue: null },
      { field: 'user_agent', label: 'User Agent', defaultValue: null },
      { field: 'referer', label: 'Referer', defaultValue: null },
      { field: 'accept_language', label: 'Accept-Language', defaultValue: null },
      { field: 'ip', label: '原始 IP', defaultValue: null },
      { field: 'cf_ray', label: 'CF Ray', defaultValue: null },
    ],
    sizeEstimateFields: [
      'output_preview',
      'user_guidance_preview',
      'adjudication_events_preview',
      'extra_json',
      'user_agent',
      'referer',
      'accept_language',
      'ip',
      'cf_ray',
    ],
  },
  arena_rating_events: {
    target: 'arena_rating_events',
    label: '排位事件',
    table: 'arena_rating_events',
    idColumn: 'id',
    orderBy: 'created_at DESC, id ASC',
    dateColumn: 'created_at',
    statusValues: ['pending', 'applied', 'skipped', 'failed'],
    queueValues: ['strict', 'free'],
    fieldDefinitions: [
      { field: 'details_json', label: '事件详情 JSON', defaultValue: null },
      { field: 'skip_reason', label: '跳过原因', defaultValue: null },
    ],
    sizeEstimateFields: ['details_json', 'skip_reason'],
  },
  pvp_rounds: {
    target: 'pvp_rounds',
    label: 'PVP 回合记录',
    table: 'pvp_rounds',
    idColumn: 'id',
    orderBy: 'created_at DESC, id ASC',
    dateColumn: 'created_at',
    statusValues: ['pending', 'resolving', 'completed', 'aborted'],
    fieldDefinitions: [
      { field: 'public_snapshot_json', label: '公开快照 JSON', defaultValue: null },
      { field: 'result_json', label: '回合结果 JSON', defaultValue: null },
      { field: 'winner_name', label: '胜者名称', defaultValue: null },
    ],
    sizeEstimateFields: ['public_snapshot_json', 'result_json', 'winner_name'],
  },
  large_objects: {
    target: 'large_objects',
    label: '大对象索引',
    table: 'large_objects',
    idColumn: 'id',
    orderBy: 'created_at DESC, id ASC',
    dateColumn: 'created_at',
    supportsKind: true,
    fieldDefinitions: [],
    sizeEstimateFields: [],
  },
};

let ensureCleanupAuditTablesPromise: Promise<boolean> | null = null;

const parseJsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
};

const parseJsonArray = (value: unknown): unknown[] => {
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const newCleanupJobId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `cleanup_${crypto.randomUUID()}`;
    }
  } catch {
    // ignore
  }
  return `cleanup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const ensureCleanupAuditTables = async (): Promise<boolean> => {
  if (ensureCleanupAuditTablesPromise) return ensureCleanupAuditTablesPromise;

  ensureCleanupAuditTablesPromise = (async () => {
    try {
      await queryFromD1(
        `CREATE TABLE IF NOT EXISTS admin_cleanup_jobs (
          id TEXT PRIMARY KEY NOT NULL,
          target TEXT NOT NULL,
          plan_hash TEXT NOT NULL,
          scope_json TEXT,
          actions_json TEXT,
          preview_json TEXT,
          risk_level TEXT,
          status TEXT NOT NULL,
          total_matched_rows INTEGER DEFAULT 0,
          selected_rows INTEGER DEFAULT 0,
          affected_rows INTEGER DEFAULT 0,
          cell_changes INTEGER DEFAULT 0,
          batch_count INTEGER DEFAULT 0,
          r2_deleted INTEGER DEFAULT 0,
          r2_delete_failed INTEGER DEFAULT 0,
          warnings_json TEXT,
          error_text TEXT,
          created_by_user_id INTEGER,
          created_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          updated_at TEXT NOT NULL
        );`,
      );

      await queryFromD1(
        `CREATE INDEX IF NOT EXISTS idx_admin_cleanup_jobs_created_at
         ON admin_cleanup_jobs(created_at DESC);`,
      );
      await queryFromD1(
        `CREATE INDEX IF NOT EXISTS idx_admin_cleanup_jobs_status_created_at
         ON admin_cleanup_jobs(status, created_at DESC);`,
      );

      await queryFromD1(
        `CREATE TABLE IF NOT EXISTS admin_cleanup_job_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id TEXT NOT NULL,
          batch_no INTEGER NOT NULL,
          affected_rows INTEGER DEFAULT 0,
          cell_changes INTEGER DEFAULT 0,
          note TEXT,
          created_at TEXT NOT NULL
        );`,
      );
      await queryFromD1(
        `CREATE INDEX IF NOT EXISTS idx_admin_cleanup_job_logs_job_id_batch
         ON admin_cleanup_job_logs(job_id, batch_no);`,
      );

      return true;
    } catch (error) {
      console.warn('[data-maintenance] 初始化审计表失败（降级继续执行）:', error);
      return false;
    }
  })();

  return ensureCleanupAuditTablesPromise;
};

const readRows = <T>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const readFirstRow = (result: unknown): D1Row => {
  const row = (result as any)?.result?.[0]?.results?.[0];
  return row && typeof row === 'object' ? (row as D1Row) : {};
};

const readChanges = (result: unknown): number => {
  const changes = (result as any)?.result?.[0]?.meta?.changes;
  if (typeof changes !== 'number' || !Number.isFinite(changes)) return 0;
  return Math.max(0, Math.floor(changes));
};

const toInt = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return 0;
};

const dedupeStringArray = (values: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  values.forEach((raw) => {
    const v = String(raw || '').trim();
    if (!v) return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
};

const ensureDate = (value: unknown, fieldName: string): string | undefined => {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${fieldName} 必须是 YYYY-MM-DD 字符串`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!DATE_RE.test(trimmed)) throw new Error(`${fieldName} 格式非法（应为 YYYY-MM-DD）`);
  return trimmed;
};

const ensureKeyword = (value: unknown, fieldName: string): string | undefined => {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${fieldName} 必须是字符串`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!SAFE_KEYWORD_RE.test(trimmed)) throw new Error(`${fieldName} 包含非法字符`);
  return trimmed;
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const safeSize = Math.max(1, Math.floor(size || 1));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${entries.join(',')}}`;
};

const sha256Hex = async (value: string): Promise<string> => {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const bytes = Array.from(new Uint8Array(buffer));
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const getTargetDefinition = (target: unknown): CleanupTargetDefinition => {
  if (typeof target !== 'string') throw new Error('target 非法');
  const definition = cleanupTargetDefinitions[target as AdminDataCleanupTarget];
  if (!definition) throw new Error(`不支持的 target: ${target}`);
  return definition;
};

const normalizeScope = (targetDefinition: CleanupTargetDefinition, input: unknown): AdminDataCleanupScope => {
  const raw = (input && typeof input === 'object') ? (input as Record<string, unknown>) : {};
  const scope: AdminDataCleanupScope = {};

  scope.dateFrom = ensureDate(raw.dateFrom, 'dateFrom');
  scope.dateTo = ensureDate(raw.dateTo, 'dateTo');

  if (scope.dateFrom && scope.dateTo && scope.dateFrom > scope.dateTo) {
    throw new Error('dateFrom 不能晚于 dateTo');
  }

  if (targetDefinition.statusValues) {
    const rawStatuses = Array.isArray(raw.statusIn) ? raw.statusIn.map((item) => String(item || '').trim()) : [];
    const statusIn = dedupeStringArray(rawStatuses);
    const invalid = statusIn.filter((item) => !targetDefinition.statusValues?.includes(item));
    if (invalid.length > 0) {
      throw new Error(`statusIn 包含非法值: ${invalid.join(', ')}`);
    }
    if (statusIn.length > 0) scope.statusIn = statusIn;
  }

  if (targetDefinition.queueValues) {
    const queue = ensureKeyword(raw.queue, 'queue');
    if (queue) {
      if (!targetDefinition.queueValues.includes(queue as 'strict' | 'free')) {
        throw new Error(`queue 仅支持 ${targetDefinition.queueValues.join('/')}`);
      }
      scope.queue = queue as 'strict' | 'free';
    }
  }

  if (targetDefinition.supportsKind) {
    const kind = ensureKeyword(raw.kind, 'kind');
    if (kind) scope.kind = kind;
  }

  if (targetDefinition.supportsPvpOnly) {
    if (raw.pvpOnly === true) scope.pvpOnly = true;
    if (raw.pvpOnly === false) scope.pvpOnly = false;
  }

  return scope;
};

const normalizeActions = (targetDefinition: CleanupTargetDefinition, input: unknown): AdminDataCleanupAction[] => {
  if (!Array.isArray(input) || input.length <= 0) {
    throw new Error('actions 不能为空');
  }

  const actionList: AdminDataCleanupAction[] = input.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`actions[${index}] 非法`);
    const raw = item as Record<string, unknown>;
    const type = raw.type;

    if (type === 'delete_rows') {
      return {
        type: 'delete_rows',
        deleteR2: raw.deleteR2 === true,
      } satisfies AdminDataCleanupDeleteRowsAction;
    }

    if (type !== 'field') {
      throw new Error(`actions[${index}] type 非法`);
    }

    const field = typeof raw.field === 'string' ? raw.field.trim() : '';
    if (!field) throw new Error(`actions[${index}] 缺少 field`);
    const fieldDefinition = targetDefinition.fieldDefinitions.find((itemField) => itemField.field === field);
    if (!fieldDefinition) throw new Error(`actions[${index}] 字段不支持: ${field}`);

    const op = raw.op;
    if (op !== 'truncate' && op !== 'set_null_or_default') {
      throw new Error(`actions[${index}] op 非法`);
    }

    if (op === 'truncate') {
      const rawMaxChars = (raw.truncate as Record<string, unknown> | undefined)?.maxChars;
      const maxChars = Number(rawMaxChars);
      if (!Number.isFinite(maxChars)) throw new Error(`actions[${index}] truncate.maxChars 非法`);
      const safeMaxChars = Math.floor(maxChars);
      if (safeMaxChars < 1 || safeMaxChars > 200_000) {
        throw new Error(`actions[${index}] truncate.maxChars 超出范围（1~200000）`);
      }
      return {
        type: 'field',
        field,
        op: 'truncate',
        maxChars: safeMaxChars,
      } satisfies AdminDataCleanupFieldAction;
    }

    const mode = raw.setMode === 'empty' || raw.setMode === 'default' ? raw.setMode : 'null';
    return {
      type: 'field',
      field,
      op: 'set_null_or_default',
      setMode: mode,
    } satisfies AdminDataCleanupFieldAction;
  });

  if (actionList.length > 12) {
    throw new Error('actions 过多（最多 12 项）');
  }

  const hasDeleteRows = actionList.some((item) => item.type === 'delete_rows');
  if (hasDeleteRows && actionList.length > 1) {
    throw new Error('delete_rows 不能与字段操作混用，请拆分执行');
  }

  if (targetDefinition.target === 'large_objects') {
    const hasFieldAction = actionList.some((item) => item.type === 'field');
    if (hasFieldAction) throw new Error('large_objects 仅支持 delete_rows');
  }

  return actionList;
};

const normalizePlan = (input: AdminDataCleanupPlanInput): AdminDataCleanupPlan => {
  const targetDefinition = getTargetDefinition(input.target);
  const scope = normalizeScope(targetDefinition, input.scope);
  const actions = normalizeActions(targetDefinition, input.actions);
  return {
    target: targetDefinition.target,
    scope,
    actions,
  };
};

const buildWhereClause = (targetDefinition: CleanupTargetDefinition, scope: AdminDataCleanupScope): WhereClause => {
  const whereParts: string[] = [];
  const params: unknown[] = [];
  const warnings: string[] = [];

  if (scope.dateFrom && targetDefinition.dateColumn) {
    whereParts.push(`DATE(${targetDefinition.dateColumn}) >= DATE(?)`);
    params.push(scope.dateFrom);
  }
  if (scope.dateTo && targetDefinition.dateColumn) {
    whereParts.push(`DATE(${targetDefinition.dateColumn}) <= DATE(?)`);
    params.push(scope.dateTo);
  }
  if (scope.statusIn && scope.statusIn.length > 0 && targetDefinition.statusValues) {
    whereParts.push(`status IN (${scope.statusIn.map(() => '?').join(', ')})`);
    params.push(...scope.statusIn);
  }
  if (scope.queue && targetDefinition.target === 'arena_rating_events') {
    whereParts.push('queue = ?');
    params.push(scope.queue);
  }
  if (scope.kind && targetDefinition.target === 'large_objects') {
    whereParts.push('kind = ?');
    params.push(scope.kind);
  }
  if (scope.pvpOnly === true && targetDefinition.target === 'battle_report_generations') {
    whereParts.push('pvp_match_id IS NOT NULL');
  }

  if (targetDefinition.target === 'pvp_rounds') {
    whereParts.push(`status != 'resolving'`);
    warnings.push('已自动排除 status=resolving 的回合，避免影响进行中结算。');
  }

  if (targetDefinition.target === 'arena_rating_events' && (!scope.statusIn || scope.statusIn.length <= 0)) {
    whereParts.push(`status != 'pending'`);
    warnings.push('已自动排除 pending 事件，避免影响排位队列结算。');
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  return { whereSql, params, warnings };
};

const computePlanHash = async (plan: AdminDataCleanupPlan): Promise<string> => {
  const canonical = stableStringify({
    target: plan.target,
    scope: plan.scope,
    actions: plan.actions,
  });
  const hash = await sha256Hex(canonical);
  return `sha256:${hash}`;
};

const applyFieldActionToValue = (
  value: unknown,
  action: AdminDataCleanupFieldAction,
  fieldDefinition: CleanupFieldDefinition,
): unknown => {
  if (action.op === 'truncate') {
    if (typeof value !== 'string') return value;
    const maxChars = action.maxChars ?? 0;
    if (maxChars <= 0) return value;
    if (value.length <= maxChars) return value;
    return value.slice(0, maxChars);
  }

  if (action.op === 'set_null_or_default') {
    if (action.setMode === 'empty') return '';
    if (action.setMode === 'default') return fieldDefinition.defaultValue;
    return null;
  }

  return value;
};

const estimateFieldBytes = async (
  targetDefinition: CleanupTargetDefinition,
  whereSql: string,
  whereParams: unknown[],
  action: AdminDataCleanupFieldAction,
): Promise<{ beforeBytes: number; afterBytes: number }> => {
  const field = action.field;

  const beforeSql = `SELECT COALESCE(SUM(LENGTH(CAST(${field} AS BLOB))), 0) AS bytes FROM ${targetDefinition.table} ${whereSql};`;
  const beforeRow = readFirstRow(await queryFromD1(beforeSql, whereParams));
  const beforeBytes = toInt(beforeRow.bytes);

  if (action.op === 'set_null_or_default') {
    if (action.setMode === 'default') {
      const fieldDefinition = targetDefinition.fieldDefinitions.find((item) => item.field === field);
      const defaultValue = fieldDefinition?.defaultValue ?? null;
      if (!defaultValue) return { beforeBytes, afterBytes: 0 };
      const countSql = `SELECT COUNT(1) AS total FROM ${targetDefinition.table} ${whereSql};`;
      const countRow = readFirstRow(await queryFromD1(countSql, whereParams));
      const total = toInt(countRow.total);
      const bytesPerValue = new TextEncoder().encode(defaultValue).byteLength;
      return { beforeBytes, afterBytes: total * bytesPerValue };
    }
    return { beforeBytes, afterBytes: 0 };
  }

  const maxChars = action.maxChars ?? 0;
  if (maxChars <= 0) return { beforeBytes, afterBytes: beforeBytes };

  const afterSql = `
    SELECT
      COALESCE(SUM(
        CASE
          WHEN ${field} IS NULL THEN 0
          ELSE MIN(LENGTH(CAST(${field} AS BLOB)), ?)
        END
      ), 0) AS bytes
    FROM ${targetDefinition.table}
    ${whereSql};
  `;
  const afterRow = readFirstRow(await queryFromD1(afterSql, [maxChars, ...whereParams]));
  const afterBytes = toInt(afterRow.bytes);
  return { beforeBytes, afterBytes };
};

const estimateDeleteRowsBytes = async (
  targetDefinition: CleanupTargetDefinition,
  whereSql: string,
  whereParams: unknown[],
): Promise<number> => {
  if (targetDefinition.target === 'large_objects') {
    const row = readFirstRow(
      await queryFromD1(`SELECT COALESCE(SUM(bytes), 0) AS bytes FROM ${targetDefinition.table} ${whereSql};`, whereParams),
    );
    return toInt(row.bytes);
  }

  if (targetDefinition.sizeEstimateFields.length <= 0) return 0;

  const parts = targetDefinition.sizeEstimateFields
    .map((field) => `COALESCE(SUM(LENGTH(CAST(${field} AS BLOB))), 0)`)
    .join(' + ');
  const sql = `SELECT (${parts}) AS bytes FROM ${targetDefinition.table} ${whereSql};`;
  const row = readFirstRow(await queryFromD1(sql, whereParams));
  return toInt(row.bytes);
};

const loadPreviewSamples = async (
  targetDefinition: CleanupTargetDefinition,
  whereSql: string,
  whereParams: unknown[],
  actions: AdminDataCleanupAction[],
  previewLimit: number,
): Promise<PreviewSampleRow[]> => {
  const fieldActions = actions.filter((item): item is AdminDataCleanupFieldAction => item.type === 'field');
  if (fieldActions.length <= 0) return [];

  const fields = dedupeStringArray(fieldActions.map((item) => item.field));
  if (fields.length <= 0) return [];

  const sql = `
    SELECT ${targetDefinition.idColumn} AS __id, ${fields.join(', ')}
    FROM ${targetDefinition.table}
    ${whereSql}
    ORDER BY ${targetDefinition.orderBy}
    LIMIT ?;
  `;
  const rows = readRows<D1Row>(await queryFromD1(sql, [...whereParams, previewLimit]));
  return rows.map((row) => {
    const id = (row.__id as string | number) ?? '';
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    fields.forEach((field) => {
      before[field] = row[field];
      after[field] = row[field];
    });

    fieldActions.forEach((action) => {
      const fieldDefinition = targetDefinition.fieldDefinitions.find((item) => item.field === action.field);
      if (!fieldDefinition) return;
      after[action.field] = applyFieldActionToValue(after[action.field], action, fieldDefinition);
    });

    return { id, before, after };
  });
};

const computeDependencyImpact = async (
  targetDefinition: CleanupTargetDefinition,
  whereSql: string,
  whereParams: unknown[],
  actions: AdminDataCleanupAction[],
): Promise<Record<string, number>> => {
  const hasDeleteRows = actions.some((item) => item.type === 'delete_rows');
  if (!hasDeleteRows) return {};

  if (targetDefinition.target === 'battle_report_generations') {
    const sql = `
      SELECT
        (SELECT COUNT(1) FROM battle_report_generation_combatants WHERE generation_id IN (SELECT id FROM battle_report_generations ${whereSql})) AS combatants,
        (SELECT COUNT(1) FROM arena_rating_events WHERE generation_id IN (SELECT id FROM battle_report_generations ${whereSql})) AS arenaRatingEvents,
        (SELECT COUNT(1) FROM large_objects WHERE kind = 'battle_report_generation_output' AND owner_ref_id IN (SELECT id FROM battle_report_generations ${whereSql})) AS battleReportLargeObjects;
    `;
    const row = readFirstRow(await queryFromD1(sql, [...whereParams, ...whereParams, ...whereParams]));
    return {
      battle_report_generation_combatants: toInt(row.combatants),
      arena_rating_events: toInt(row.arenaRatingEvents),
      large_objects_battle_report_generation_output: toInt(row.battleReportLargeObjects),
    };
  }

  if (targetDefinition.target === 'large_objects') {
    const row = readFirstRow(
      await queryFromD1(
        `SELECT COALESCE(SUM(bytes), 0) AS bytes, COUNT(1) AS total FROM large_objects ${whereSql};`,
        whereParams,
      ),
    );
    return {
      total_rows: toInt(row.total),
      total_bytes: toInt(row.bytes),
    };
  }

  return {};
};

const computeRiskLevel = (
  actions: AdminDataCleanupAction[],
  affectedRows: number,
  estimatedBytesSaved: number,
): AdminDataCleanupRiskLevel => {
  const hasDeleteRows = actions.some((item) => item.type === 'delete_rows');
  if (hasDeleteRows) return 'high';
  if (affectedRows >= 50_000) return 'high';
  if (estimatedBytesSaved >= 200 * 1024 * 1024) return 'high';
  if (affectedRows >= 5_000) return 'medium';
  if (estimatedBytesSaved >= 20 * 1024 * 1024) return 'medium';
  return 'low';
};

const addPreviewWarnings = (
  targetDefinition: CleanupTargetDefinition,
  actions: AdminDataCleanupAction[],
  affectedRows: number,
): string[] => {
  const warnings: string[] = [];
  if (affectedRows <= 0) warnings.push('当前筛选范围未命中数据。');

  const deleteRowsAction = actions.find((item): item is AdminDataCleanupDeleteRowsAction => item.type === 'delete_rows');
  if (deleteRowsAction) {
    warnings.push('你选择了 delete_rows（整行删除），该操作风险较高。');
    if (targetDefinition.target === 'large_objects' && !deleteRowsAction.deleteR2) {
      warnings.push('当前 delete_rows 未勾选 deleteR2，可能留下未索引的 R2 对象。');
    }
    if (targetDefinition.target === 'battle_report_generations') {
      warnings.push('删除战报记录会级联删除战报参战者与部分排位事件关联。');
    }
  }

  if (targetDefinition.target === 'battle_report_generations') {
    const touchesOutputPreview = actions.some(
      (item) => item.type === 'field' && item.field === 'output_preview',
    );
    if (touchesOutputPreview) {
      warnings.push('output_preview 被清理后，前台仅能依赖 R2 正文兜底。');
    }
  }

  return warnings;
};

const loadMatchedIds = async (
  targetDefinition: CleanupTargetDefinition,
  whereSql: string,
  whereParams: unknown[],
  maxRows: number,
): Promise<Array<string | number>> => {
  const sql = `
    SELECT ${targetDefinition.idColumn} AS id
    FROM ${targetDefinition.table}
    ${whereSql}
    ORDER BY ${targetDefinition.orderBy}
    LIMIT ?;
  `;
  const rows = readRows<{ id: string | number }>(await queryFromD1(sql, [...whereParams, maxRows]));
  return rows.map((row) => row.id).filter((value) => value !== null && value !== undefined);
};

const applyFieldActionForIds = async (
  targetDefinition: CleanupTargetDefinition,
  ids: Array<string | number>,
  action: AdminDataCleanupFieldAction,
): Promise<number> => {
  if (ids.length <= 0) return 0;

  if (action.op === 'truncate') {
    const maxChars = action.maxChars ?? 0;
    if (maxChars <= 0) return 0;
    return await withSqlVariableFallbackForNumericResult(ids, async (safeIds) => {
      const placeholders = safeIds.map(() => '?').join(', ');
      const sql = `
        UPDATE ${targetDefinition.table}
        SET ${action.field} = SUBSTR(${action.field}, 1, ?)
        WHERE ${targetDefinition.idColumn} IN (${placeholders})
          AND ${action.field} IS NOT NULL
          AND LENGTH(${action.field}) > ?;
      `;
      const result = await queryFromD1(sql, [maxChars, ...safeIds, maxChars]);
      return readChanges(result);
    });
  }

  const fieldDefinition = targetDefinition.fieldDefinitions.find((item) => item.field === action.field);
  const nextValue = action.setMode === 'empty'
    ? ''
    : action.setMode === 'default'
      ? (fieldDefinition?.defaultValue ?? null)
      : null;

  return await withSqlVariableFallbackForNumericResult(ids, async (safeIds) => {
    const placeholders = safeIds.map(() => '?').join(', ');
    const sql = `
      UPDATE ${targetDefinition.table}
      SET ${action.field} = ?
      WHERE ${targetDefinition.idColumn} IN (${placeholders})
        AND (
          ${action.field} IS NOT ?
          OR (${action.field} IS NULL AND ? IS NOT NULL)
        );
    `;
    const result = await queryFromD1(sql, [nextValue, ...safeIds, nextValue, nextValue]);
    return readChanges(result);
  });
};

const deleteRowsForIds = async (
  targetDefinition: CleanupTargetDefinition,
  ids: Array<string | number>,
): Promise<number> => {
  if (ids.length <= 0) return 0;
  return await withSqlVariableFallbackForNumericResult(ids, async (safeIds) => {
    const placeholders = safeIds.map(() => '?').join(', ');
    const sql = `DELETE FROM ${targetDefinition.table} WHERE ${targetDefinition.idColumn} IN (${placeholders});`;
    const result = await queryFromD1(sql, safeIds);
    return readChanges(result);
  });
};

const deleteR2ObjectsForLargeObjectIds = async (ids: Array<string | number>): Promise<{ ok: number; failed: number }> => {
  if (ids.length <= 0) return { ok: 0, failed: 0 };
  const rows = await withSqlVariableFallbackForRows(ids, async (safeIds) => {
    const placeholders = safeIds.map(() => '?').join(', ');
    const sql = `SELECT r2_key FROM large_objects WHERE id IN (${placeholders})`;
    return readRows<{ r2_key: string }>(await queryFromD1(sql, safeIds));
  });

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const key = typeof row.r2_key === 'string' ? row.r2_key.trim() : '';
    if (!key) continue;
    const result = await deleteObject(key);
    if (result.success) ok += 1;
    else failed += 1;
  }
  return { ok, failed };
};

export const getAdminDataCleanupTargetSchemas = () => {
  return Object.values(cleanupTargetDefinitions).map((item) => ({
    target: item.target,
    label: item.label,
    fieldDefinitions: item.fieldDefinitions,
    supportsKind: item.supportsKind === true,
    supportsPvpOnly: item.supportsPvpOnly === true,
    queueValues: item.queueValues ?? [],
    statusValues: item.statusValues ?? [],
  }));
};

export async function createAdminDataCleanupJob(input: {
  plan: AdminDataCleanupPlanInput;
  planHash: string;
  preview: AdminDataCleanupPreviewResult;
  createdByUserId?: number | null;
}): Promise<{ ok: boolean; jobId: string | null; warning?: string }> {
  const ready = await ensureCleanupAuditTables();
  if (!ready) {
    return { ok: false, jobId: null, warning: '审计表不可用，本次执行不会记录历史。' };
  }

  try {
    const normalizedPlan = normalizePlan(input.plan);
    const nowIso = new Date().toISOString();
    const jobId = newCleanupJobId();
    const result = await queryFromD1(
      `INSERT INTO admin_cleanup_jobs (
        id, target, plan_hash, scope_json, actions_json, preview_json, risk_level, status,
        total_matched_rows, selected_rows, affected_rows, cell_changes, batch_count,
        r2_deleted, r2_delete_failed, warnings_json, error_text,
        created_by_user_id, created_at, started_at, finished_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        jobId,
        normalizedPlan.target,
        input.planHash,
        JSON.stringify(normalizedPlan.scope),
        JSON.stringify(normalizedPlan.actions),
        JSON.stringify({
          affectedRows: input.preview.affectedRows,
          estimatedBytesBefore: input.preview.estimatedBytesBefore,
          estimatedBytesAfter: input.preview.estimatedBytesAfter,
          estimatedBytesSaved: input.preview.estimatedBytesSaved,
          dependencyImpact: input.preview.dependencyImpact,
          sampleCount: input.preview.samples.length,
        }),
        input.preview.riskLevel,
        'running',
        input.preview.affectedRows,
        0,
        0,
        0,
        0,
        0,
        0,
        JSON.stringify(input.preview.warnings ?? []),
        null,
        typeof input.createdByUserId === 'number' && Number.isFinite(input.createdByUserId) && input.createdByUserId > 0
          ? Math.floor(input.createdByUserId)
          : null,
        nowIso,
        nowIso,
        null,
        nowIso,
      ],
    );

    if (readChanges(result) <= 0) {
      return { ok: false, jobId: null, warning: '写入任务记录失败（未影响行）。' };
    }
    return { ok: true, jobId };
  } catch (error) {
    console.warn('[data-maintenance] 创建任务记录失败（降级继续执行）:', error);
    return { ok: false, jobId: null, warning: error instanceof Error ? error.message : '任务记录写入失败' };
  }
}

export async function appendAdminDataCleanupJobLog(
  jobId: string,
  progress: AdminDataCleanupBatchProgress,
): Promise<void> {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) return;
  const ready = await ensureCleanupAuditTables();
  if (!ready) return;

  try {
    const nowIso = new Date().toISOString();
    await queryFromD1(
      `INSERT INTO admin_cleanup_job_logs (job_id, batch_no, affected_rows, cell_changes, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        safeJobId,
        progress.batchNo,
        progress.affectedRows,
        progress.cellChanges,
        progress.note,
        nowIso,
      ],
    );
  } catch (error) {
    console.warn('[data-maintenance] 任务日志写入失败:', error);
  }
}

export async function completeAdminDataCleanupJob(
  jobId: string,
  result: AdminDataCleanupExecutionResult,
): Promise<void> {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) return;
  const ready = await ensureCleanupAuditTables();
  if (!ready) return;

  try {
    const nowIso = new Date().toISOString();
    await queryFromD1(
      `UPDATE admin_cleanup_jobs
       SET
         status = 'completed',
         selected_rows = ?,
         affected_rows = ?,
         cell_changes = ?,
         batch_count = ?,
         r2_deleted = ?,
         r2_delete_failed = ?,
         warnings_json = ?,
         error_text = NULL,
         finished_at = ?,
         updated_at = ?
       WHERE id = ?`,
      [
        result.selectedRows,
        result.affectedRows,
        result.cellChanges,
        result.batchCount,
        result.r2Deleted,
        result.r2DeleteFailed,
        JSON.stringify(result.warnings ?? []),
        nowIso,
        nowIso,
        safeJobId,
      ],
    );
  } catch (error) {
    console.warn('[data-maintenance] 任务完成写回失败:', error);
  }
}

export async function failAdminDataCleanupJob(jobId: string, errorText: string): Promise<void> {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) return;
  const ready = await ensureCleanupAuditTables();
  if (!ready) return;

  try {
    const nowIso = new Date().toISOString();
    await queryFromD1(
      `UPDATE admin_cleanup_jobs
       SET status = 'failed', error_text = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`,
      [String(errorText || '未知错误').slice(0, 500), nowIso, nowIso, safeJobId],
    );
  } catch (error) {
    console.warn('[data-maintenance] 任务失败写回失败:', error);
  }
}

export async function listAdminDataCleanupJobs(
  limit = 20,
  status?: AdminDataCleanupJobStatus | 'all',
): Promise<AdminDataCleanupJobListRow[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 20;
  const statusFilter = status === 'running' || status === 'completed' || status === 'failed' ? status : null;
  const ready = await ensureCleanupAuditTables();
  if (!ready) return [];

  try {
    const rows = readRows<{
      id: string;
      target: string;
      status: string;
      risk_level: string | null;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
      total_matched_rows: number | string;
      selected_rows: number | string;
      affected_rows: number | string;
      cell_changes: number | string;
      r2_deleted: number | string;
      r2_delete_failed: number | string;
      warnings_json: string | null;
      error_text: string | null;
    }>(
      await queryFromD1(
        `SELECT
          id, target, status, risk_level, created_at, started_at, finished_at,
          total_matched_rows, selected_rows, affected_rows, cell_changes, r2_deleted, r2_delete_failed,
          warnings_json, error_text
         FROM admin_cleanup_jobs
         ${statusFilter ? 'WHERE status = ?' : ''}
         ORDER BY created_at DESC
         LIMIT ?`,
        statusFilter ? [statusFilter, safeLimit] : [safeLimit],
      ),
    );

    return rows.map((row) => ({
      id: row.id,
      target: (row.target as AdminDataCleanupTarget),
      status: (row.status as AdminDataCleanupJobStatus),
      riskLevel:
        row.risk_level === 'low' || row.risk_level === 'medium' || row.risk_level === 'high'
          ? row.risk_level
          : null,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      totalMatchedRows: toInt(row.total_matched_rows),
      selectedRows: toInt(row.selected_rows),
      affectedRows: toInt(row.affected_rows),
      cellChanges: toInt(row.cell_changes),
      r2Deleted: toInt(row.r2_deleted),
      r2DeleteFailed: toInt(row.r2_delete_failed),
      warningCount: parseJsonArray(row.warnings_json).length,
      errorText: typeof row.error_text === 'string' && row.error_text.trim() ? row.error_text : null,
    }));
  } catch (error) {
    console.warn('[data-maintenance] 读取任务列表失败:', error);
    return [];
  }
}

export async function getAdminDataCleanupJobDetail(jobId: string): Promise<AdminDataCleanupJobDetail | null> {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) return null;
  const ready = await ensureCleanupAuditTables();
  if (!ready) return null;

  try {
    const row = readRows<{
      id: string;
      target: string;
      status: string;
      risk_level: string | null;
      plan_hash: string;
      scope_json: string | null;
      actions_json: string | null;
      preview_json: string | null;
      warnings_json: string | null;
      error_text: string | null;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
      total_matched_rows: number | string;
      selected_rows: number | string;
      affected_rows: number | string;
      cell_changes: number | string;
      r2_deleted: number | string;
      r2_delete_failed: number | string;
    }>(
      await queryFromD1(
        `SELECT
          id, target, status, risk_level, plan_hash, scope_json, actions_json, preview_json,
          warnings_json, error_text, created_at, started_at, finished_at,
          total_matched_rows, selected_rows, affected_rows, cell_changes, r2_deleted, r2_delete_failed
         FROM admin_cleanup_jobs
         WHERE id = ?
         LIMIT 1`,
        [safeJobId],
      ),
    )[0];

    if (!row) return null;

    const logs = readRows<{
      id: number | string;
      batch_no: number | string;
      affected_rows: number | string;
      cell_changes: number | string;
      note: string | null;
      created_at: string;
    }>(
      await queryFromD1(
        `SELECT id, batch_no, affected_rows, cell_changes, note, created_at
         FROM admin_cleanup_job_logs
         WHERE job_id = ?
         ORDER BY batch_no ASC, id ASC`,
        [safeJobId],
      ),
    ).map((logRow) => ({
      id: toInt(logRow.id),
      batchNo: toInt(logRow.batch_no),
      affectedRows: toInt(logRow.affected_rows),
      cellChanges: toInt(logRow.cell_changes),
      note: typeof logRow.note === 'string' ? logRow.note : null,
      createdAt: logRow.created_at,
    }));

    return {
      id: row.id,
      target: row.target as AdminDataCleanupTarget,
      status: row.status as AdminDataCleanupJobStatus,
      riskLevel:
        row.risk_level === 'low' || row.risk_level === 'medium' || row.risk_level === 'high'
          ? row.risk_level
          : null,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      totalMatchedRows: toInt(row.total_matched_rows),
      selectedRows: toInt(row.selected_rows),
      affectedRows: toInt(row.affected_rows),
      cellChanges: toInt(row.cell_changes),
      r2Deleted: toInt(row.r2_deleted),
      r2DeleteFailed: toInt(row.r2_delete_failed),
      warningCount: parseJsonArray(row.warnings_json).length,
      errorText: typeof row.error_text === 'string' && row.error_text.trim() ? row.error_text : null,
      planHash: row.plan_hash,
      scope: parseJsonRecord(row.scope_json) ?? {},
      actions: parseJsonArray(row.actions_json),
      preview: parseJsonRecord(row.preview_json),
      warnings: parseJsonArray(row.warnings_json).filter((item): item is string => typeof item === 'string'),
      logs,
    };
  } catch (error) {
    console.warn('[data-maintenance] 读取任务详情失败:', error);
    return null;
  }
}

export async function previewAdminDataCleanup(input: AdminDataCleanupPlanInput): Promise<AdminDataCleanupPreviewResult> {
  const normalizedPlan = normalizePlan(input);
  const targetDefinition = cleanupTargetDefinitions[normalizedPlan.target];
  const { whereSql, params, warnings: scopeWarnings } = buildWhereClause(targetDefinition, normalizedPlan.scope);
  const planHash = await computePlanHash(normalizedPlan);

  const totalRow = readFirstRow(
    await queryFromD1(`SELECT COUNT(1) AS total FROM ${targetDefinition.table} ${whereSql};`, params),
  );
  const affectedRows = toInt(totalRow.total);

  const dependencyImpact = await computeDependencyImpact(targetDefinition, whereSql, params, normalizedPlan.actions);

  let estimatedBytesBefore = 0;
  let estimatedBytesAfter = 0;

  const fieldActions = normalizedPlan.actions.filter((item): item is AdminDataCleanupFieldAction => item.type === 'field');
  if (fieldActions.length > 0) {
    for (const action of fieldActions) {
      const estimate = await estimateFieldBytes(targetDefinition, whereSql, params, action);
      estimatedBytesBefore += estimate.beforeBytes;
      estimatedBytesAfter += estimate.afterBytes;
    }
  } else if (normalizedPlan.actions.some((item) => item.type === 'delete_rows')) {
    estimatedBytesBefore = await estimateDeleteRowsBytes(targetDefinition, whereSql, params);
    estimatedBytesAfter = 0;
  }

  const estimatedBytesSaved = Math.max(0, estimatedBytesBefore - estimatedBytesAfter);
  const riskLevel = computeRiskLevel(normalizedPlan.actions, affectedRows, estimatedBytesSaved);

  const samples = await loadPreviewSamples(targetDefinition, whereSql, params, normalizedPlan.actions, 8);
  const warnings = [
    ...scopeWarnings,
    ...addPreviewWarnings(targetDefinition, normalizedPlan.actions, affectedRows),
  ];

  return {
    target: normalizedPlan.target,
    targetLabel: targetDefinition.label,
    planHash,
    normalizedPlan: {
      target: normalizedPlan.target,
      scope: normalizedPlan.scope,
      actions: normalizedPlan.actions,
    },
    affectedRows,
    estimatedBytesBefore,
    estimatedBytesAfter,
    estimatedBytesSaved,
    riskLevel,
    warnings,
    dependencyImpact,
    samples,
  };
}

export async function executeAdminDataCleanup(input: {
  plan: AdminDataCleanupPlanInput;
  planHash?: unknown;
  maxRows?: unknown;
  batchSize?: unknown;
  confirmText?: unknown;
  onBatchCompleted?: ((progress: AdminDataCleanupBatchProgress) => Promise<void> | void) | undefined;
}): Promise<AdminDataCleanupExecutionResult> {
  const normalizedPlan = normalizePlan(input.plan);
  const targetDefinition = cleanupTargetDefinitions[normalizedPlan.target];
  const expectedPlanHash = await computePlanHash(normalizedPlan);
  const planHash = typeof input.planHash === 'string' ? input.planHash.trim() : '';
  if (!planHash || planHash !== expectedPlanHash) {
    throw new Error('planHash 不匹配，请重新预览后执行。');
  }

  const maxRowsRaw = Number(input.maxRows);
  const maxRows = Number.isFinite(maxRowsRaw) ? Math.floor(maxRowsRaw) : 1000;
  if (maxRows < 1 || maxRows > 100_000) {
    throw new Error('maxRows 超出范围（1~100000）');
  }

  const batchSizeRaw = Number(input.batchSize);
  const batchSize = Number.isFinite(batchSizeRaw) ? Math.floor(batchSizeRaw) : 200;
  if (batchSize < 1 || batchSize > 5000) {
    throw new Error('batchSize 超出范围（1~5000）');
  }

  const hasDeleteRows = normalizedPlan.actions.some((item) => item.type === 'delete_rows');
  if (hasDeleteRows) {
    const expectedConfirmText = `DELETE ${normalizedPlan.target}`;
    const confirmText = typeof input.confirmText === 'string' ? input.confirmText.trim() : '';
    if (confirmText !== expectedConfirmText) {
      throw new Error(`delete_rows 需要确认口令：${expectedConfirmText}`);
    }
  }

  const { whereSql, params, warnings: scopeWarnings } = buildWhereClause(targetDefinition, normalizedPlan.scope);
  const totalMatchedRow = readFirstRow(
    await queryFromD1(`SELECT COUNT(1) AS total FROM ${targetDefinition.table} ${whereSql};`, params),
  );
  const totalMatchedRows = toInt(totalMatchedRow.total);
  const selectedIds = await loadMatchedIds(targetDefinition, whereSql, params, maxRows);
  const selectedRows = selectedIds.length;
  const truncatedByMaxRows = totalMatchedRows > selectedRows;

  let affectedRows = 0;
  let cellChanges = 0;
  let batchCount = 0;
  let r2Deleted = 0;
  let r2DeleteFailed = 0;

  if (selectedRows > 0) {
    const batches = chunk(selectedIds, batchSize);
    batchCount = batches.length;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const idBatch = batches[batchIndex]!;
      if (idBatch.length <= 0) continue;
      const batchNo = batchIndex + 1;
      let batchAffectedRows = 0;
      let batchCellChanges = 0;
      let batchMode: AdminDataCleanupBatchProgress['mode'] = 'field_update';
      let batchNote = '';

      if (hasDeleteRows) {
        const deleteAction = normalizedPlan.actions.find(
          (item): item is AdminDataCleanupDeleteRowsAction => item.type === 'delete_rows',
        );
        if (targetDefinition.target === 'large_objects' && deleteAction?.deleteR2) {
          const r2Result = await deleteR2ObjectsForLargeObjectIds(idBatch);
          r2Deleted += r2Result.ok;
          r2DeleteFailed += r2Result.failed;
        }

        const changes = await deleteRowsForIds(targetDefinition, idBatch);
        affectedRows += changes;
        cellChanges += changes;
        batchAffectedRows = changes;
        batchCellChanges = changes;
        batchMode = 'delete_rows';
        batchNote =
          targetDefinition.target === 'large_objects' && deleteAction?.deleteR2
            ? 'delete_rows（含 R2 删除）'
            : 'delete_rows';
        if (input.onBatchCompleted) {
          await input.onBatchCompleted({
            batchNo,
            batchSize: idBatch.length,
            affectedRows: batchAffectedRows,
            cellChanges: batchCellChanges,
            mode: batchMode,
            note: batchNote,
          });
        }
        continue;
      }

      const fieldActions = normalizedPlan.actions.filter(
        (item): item is AdminDataCleanupFieldAction => item.type === 'field',
      );
      const actionNotes: string[] = [];
      for (const action of fieldActions) {
        const changes = await applyFieldActionForIds(targetDefinition, idBatch, action);
        cellChanges += changes;
        batchCellChanges += changes;
        actionNotes.push(`${action.field}:${action.op}`);
      }
      affectedRows += idBatch.length;
      batchAffectedRows = idBatch.length;
      batchNote = `field_update[${actionNotes.join(', ')}]`;
      if (input.onBatchCompleted) {
        await input.onBatchCompleted({
          batchNo,
          batchSize: idBatch.length,
          affectedRows: batchAffectedRows,
          cellChanges: batchCellChanges,
          mode: batchMode,
          note: batchNote,
        });
      }
    }
  }

  const dependencyImpact = await computeDependencyImpact(targetDefinition, whereSql, params, normalizedPlan.actions);
  const warnings = [...scopeWarnings];
  if (truncatedByMaxRows) {
    warnings.push(`命中总数 ${totalMatchedRows}，本次仅处理前 ${selectedRows} 条（maxRows=${maxRows}）。`);
  }
  if (targetDefinition.target === 'large_objects' && hasDeleteRows && r2DeleteFailed > 0) {
    warnings.push(`有 ${r2DeleteFailed} 个 R2 对象删除失败，请复核。`);
  }

  return {
    target: normalizedPlan.target,
    targetLabel: targetDefinition.label,
    planHash: expectedPlanHash,
    totalMatchedRows,
    selectedRows,
    truncatedByMaxRows,
    affectedRows,
    cellChanges,
    batchCount,
    warnings,
    r2Deleted,
    r2DeleteFailed,
    dependencyImpact,
  };
}
