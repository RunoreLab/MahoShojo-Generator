import 'server-only';

import { queryD1Payload, queryD1RawPayload } from '@/lib/database/core';

type D1HttpApiError = {
  message?: unknown;
};

type D1HttpApiResult = {
  success?: boolean;
  results?: unknown;
  meta?: unknown;
  error?: unknown;
};

type D1HttpApiEnvelope = {
  success?: boolean;
  errors?: unknown;
  result?: unknown;
};

type D1LikeRow = Record<string, unknown>;

type D1LikeStatementResult = {
  success: boolean;
  results: D1LikeRow[];
  meta: Record<string, unknown>;
  error?: string;
};

type D1LikeRawStatementResult = {
  success: boolean;
  rows: unknown[][];
  meta: Record<string, unknown>;
  error?: string;
  columnNames?: string[];
};

type SqlExecutor = (sql: string, params: unknown[]) => Promise<D1LikeStatementResult>;
type SqlRawExecutor = (sql: string, params: unknown[]) => Promise<D1LikeRawStatementResult>;
type SqlBatchExecutor = (entries: BatchEntry[]) => Promise<D1LikeStatementResult[]>;

type BatchEntry = {
  sqlText: string;
  params: unknown[];
};

const clientCache = new Map<string, unknown>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toErrorMessage = (value: unknown): string => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value instanceof Error && value.message.trim()) return value.message.trim();
  return '';
};

const normalizeRows = (value: unknown): D1LikeRow[] => {
  const rows = asArray(value);
  const out: D1LikeRow[] = [];
  for (const row of rows) {
    const obj = asObject(row);
    if (!obj) continue;
    out.push(obj);
  }
  return out;
};

const normalizeRawRows = (value: unknown): unknown[][] => {
  const root = asObject(value);
  const rows = root ? asArray(root.rows) : asArray(value);
  const out: unknown[][] = [];

  for (const row of rows) {
    if (Array.isArray(row)) {
      out.push(row);
      continue;
    }

    const obj = asObject(row);
    if (obj) {
      out.push(Object.values(obj));
    }
  }

  return out;
};

const inferColumnNames = (value: unknown): string[] => {
  const root = asObject(value);
  const columns = root ? asArray(root.columns) : [];
  if (columns.length > 0) {
    return columns
      .map((item) => (typeof item === 'string' ? item : String(item)))
      .filter((item) => item.length > 0);
  }

  const rows = root ? asArray(root.rows) : asArray(value);
  if (rows.length === 0) return [];

  const firstRowObj = asObject(rows[0]);
  if (!firstRowObj) return [];
  return Object.keys(firstRowObj);
};

const normalizeMeta = (value: unknown): Record<string, unknown> => {
  const meta = asObject(value);
  return meta ?? {};
};

const parseEnvelopeError = (envelope: D1HttpApiEnvelope): string => {
  const errors = asArray(envelope.errors);
  const messages: string[] = [];
  for (const item of errors) {
    const obj = asObject(item) as D1HttpApiError | null;
    const message = toErrorMessage(obj?.message);
    if (message) messages.push(message);
  }
  return messages.join('; ');
};

const parseStatementError = (result: D1HttpApiResult): string => {
  return toErrorMessage(result.error);
};

const parseD1StatementPayload = (payload: unknown, sql: string): {
  results: unknown;
  meta: Record<string, unknown>;
  error?: string;
} => {
  const envelope = asObject(payload) as D1HttpApiEnvelope | null;
  if (!envelope) {
    throw new Error('D1 HTTP 返回格式异常：payload 不是对象');
  }

  if (envelope.success === false) {
    const message = parseEnvelopeError(envelope);
    throw new Error(`D1 HTTP 执行失败: ${message || 'unknown error'}; sql=${sql.slice(0, 120)}`);
  }

  const statementResults = asArray(envelope.result);
  const first = asObject(statementResults[0]) as D1HttpApiResult | null;
  if (!first) {
    return {
      results: [],
      meta: {},
    };
  }

  if (first.success === false) {
    const message = parseStatementError(first);
    throw new Error(`D1 SQL 执行失败: ${message || 'unknown error'}; sql=${sql.slice(0, 120)}`);
  }

  const statementError = parseStatementError(first);
  return {
    results: first.results,
    meta: normalizeMeta(first.meta),
    ...(statementError ? { error: statementError } : {}),
  };
};

const parseD1LikeStatementResult = (payload: unknown, sql: string): D1LikeStatementResult => {
  const parsed = parseD1StatementPayload(payload, sql);
  return {
    success: true,
    results: normalizeRows(parsed.results),
    meta: parsed.meta,
    ...(parsed.error ? { error: parsed.error } : {}),
  };
};

const parseD1LikeRawStatementResult = (payload: unknown, sql: string): D1LikeRawStatementResult => {
  const parsed = parseD1StatementPayload(payload, sql);
  return {
    success: true,
    rows: normalizeRawRows(parsed.results),
    meta: parsed.meta,
    ...(parsed.error ? { error: parsed.error } : {}),
    columnNames: inferColumnNames(parsed.results),
  };
};

const parseD1LikeStatementBatchResult = (payload: unknown, entries: BatchEntry[]): D1LikeStatementResult[] => {
  const envelope = asObject(payload) as D1HttpApiEnvelope | null;
  if (!envelope) {
    throw new Error('D1 HTTP 返回格式异常：payload 不是对象');
  }

  if (envelope.success === false) {
    const message = parseEnvelopeError(envelope);
    throw new Error(`D1 HTTP batch 执行失败: ${message || 'unknown error'}`);
  }

  const statementResults = asArray(envelope.result);
  if (statementResults.length !== entries.length) {
    throw new Error(`D1 HTTP batch 返回结果数量异常：expected=${entries.length}, actual=${statementResults.length}`);
  }

  return statementResults.map((item, index) => {
    const result = asObject(item) as D1HttpApiResult | null;
    const sql = entries[index]?.sqlText ?? '[unknown-sql]';
    if (!result) {
      throw new Error(`D1 HTTP batch 返回格式异常：第 ${index + 1} 条语句结果不是对象`);
    }
    if (result.success === false) {
      const message = parseStatementError(result);
      throw new Error(`D1 SQL batch 第 ${index + 1} 条执行失败: ${message || 'unknown error'}; sql=${sql.slice(0, 120)}`);
    }

    const statementError = parseStatementError(result);
    return {
      success: true,
      results: normalizeRows(result.results),
      meta: normalizeMeta(result.meta),
      ...(statementError ? { error: statementError } : {}),
    };
  });
};

const normalizeBatchSqlText = (sqlText: string): string => sqlText.trim().replace(/;+\s*$/g, '');

const buildBatchSqlText = (entries: BatchEntry[]): string => {
  const statements = entries.map((entry) => normalizeBatchSqlText(entry.sqlText)).filter(Boolean);
  if (statements.length === 0) {
    throw new Error('D1 HTTP batch 至少需要一条 SQL 语句');
  }
  return `${statements.join(';\n')};`;
};

class HttpD1PreparedStatement {
  constructor(
    private readonly sqlText: string,
    private readonly executor: SqlExecutor,
    private readonly rawExecutor: SqlRawExecutor | null,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): HttpD1PreparedStatement {
    return new HttpD1PreparedStatement(this.sqlText, this.executor, this.rawExecutor, params);
  }

  toBatchEntry(): BatchEntry {
    return {
      sqlText: this.sqlText,
      params: [...this.params],
    };
  }

  async run(): Promise<D1LikeStatementResult> {
    return this.executor(this.sqlText, this.params);
  }

  async all(): Promise<D1LikeStatementResult> {
    return this.executor(this.sqlText, this.params);
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const result = await this.executor(this.sqlText, this.params);
    const row = result.results[0];
    if (!row) return null;
    if (columnName) {
      const value = row[columnName];
      return value == null ? null : (value as T);
    }
    return row as T;
  }

  async raw(options?: { columnNames?: boolean }): Promise<unknown[][] | [string[], ...unknown[][]]> {
    if (this.rawExecutor) {
      const result = await this.rawExecutor(this.sqlText, this.params);
      const rows = result.rows;
      if (rows.length === 0) {
        return options?.columnNames ? [[]] : [];
      }

      if (options?.columnNames) {
        return [result.columnNames ?? [], ...rows];
      }
      return rows;
    }

    const result = await this.executor(this.sqlText, this.params);
    const rows = result.results;
    if (rows.length === 0) {
      return options?.columnNames ? [[]] : [];
    }

    const columnNames = Object.keys(rows[0]!);
    const matrix = rows.map((row) => columnNames.map((key) => row[key]));
    if (options?.columnNames) {
      return [columnNames, ...matrix];
    }
    return matrix;
  }
}

const toBatchResult = async (statement: unknown): Promise<D1LikeStatementResult> => {
  if (statement instanceof HttpD1PreparedStatement) {
    return statement.run();
  }

  const candidate = asObject(statement);
  const run = candidate?.run;
  if (typeof run !== 'function') {
    throw new Error('D1 HTTP batch 仅支持本适配器创建的 prepared statements');
  }

  const result = await run.call(candidate);
  return parseD1LikeStatementResult({ success: true, result: [result] }, '[batch-run]');
};

class HttpD1DatabaseClient {
  constructor(
    private readonly executor: SqlExecutor,
    private readonly rawExecutor: SqlRawExecutor,
    private readonly batchExecutor: SqlBatchExecutor,
  ) {}

  prepare(sqlText: string): HttpD1PreparedStatement {
    return new HttpD1PreparedStatement(sqlText, this.executor, this.rawExecutor);
  }

  async batch(statements: unknown[]): Promise<D1LikeStatementResult[]> {
    const allHttpPreparedStatements = statements.every((statement) => statement instanceof HttpD1PreparedStatement);
    if (allHttpPreparedStatements) {
      const entries = statements.map((statement) => (statement as HttpD1PreparedStatement).toBatchEntry());
      return this.batchExecutor(entries);
    }

    const results: D1LikeStatementResult[] = [];
    for (const statement of statements) {
      results.push(await toBatchResult(statement));
    }
    return results;
  }

  async exec(sqlText: string): Promise<{ count: number; duration: number }> {
    const result = await this.executor(sqlText, []);
    const changes = result.meta.changes;
    const duration = result.meta.duration;
    const count =
      typeof changes === 'number' && Number.isFinite(changes) ? Math.max(0, Math.floor(changes)) : 0;
    const cost =
      typeof duration === 'number' && Number.isFinite(duration) ? Math.max(0, duration) : 0;
    return { count, duration: cost };
  }
}

const readHttpD1Config = (): { accountId: string; databaseId: string; apiToken: string } | null => {
  if (typeof process === 'undefined') return null;
  const env = process.env;
  if (!env) return null;

  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = env.D1_DATABASE_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) return null;
  return { accountId, databaseId, apiToken };
};

export const createHttpD1ClientFromEnv = (): unknown | null => {
  const config = readHttpD1Config();
  if (!config) return null;

  const cacheKey = `${config.accountId}:${config.databaseId}:${config.apiToken}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const executor: SqlExecutor = async (sqlText, params) => {
    const payload = await queryD1Payload(sqlText, params);
    return parseD1LikeStatementResult(payload, sqlText);
  };

  const batchExecutor: SqlBatchExecutor = async (entries) => {
    const sqlText = buildBatchSqlText(entries);
    const params = entries.flatMap((entry) => entry.params);
    const payload = await queryD1Payload(sqlText, params);
    return parseD1LikeStatementBatchResult(payload, entries);
  };

  const rawExecutor: SqlRawExecutor = async (sqlText, params) => {
    const payload = await queryD1RawPayload(sqlText, params);
    return parseD1LikeRawStatementResult(payload, sqlText);
  };

  const client = new HttpD1DatabaseClient(executor, rawExecutor, batchExecutor);
  clientCache.set(cacheKey, client as unknown);
  return client as unknown;
};
