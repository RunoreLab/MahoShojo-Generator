import 'server-only';

import { queryD1Payload } from '@/lib/database/core';

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

type SqlExecutor = (sql: string, params: unknown[]) => Promise<D1LikeStatementResult>;

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

const parseD1LikeStatementResult = (payload: unknown, sql: string): D1LikeStatementResult => {
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
      success: true,
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
    success: true,
    results: normalizeRows(first.results),
    meta: normalizeMeta(first.meta),
    ...(statementError ? { error: statementError } : {}),
  };
};

class HttpD1PreparedStatement {
  constructor(
    private readonly sqlText: string,
    private readonly executor: SqlExecutor,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): HttpD1PreparedStatement {
    return new HttpD1PreparedStatement(this.sqlText, this.executor, params);
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
  constructor(private readonly executor: SqlExecutor) {}

  prepare(sqlText: string): HttpD1PreparedStatement {
    return new HttpD1PreparedStatement(sqlText, this.executor);
  }

  async batch(statements: unknown[]): Promise<D1LikeStatementResult[]> {
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

  const client = new HttpD1DatabaseClient(executor);
  clientCache.set(cacheKey, client as unknown);
  return client as unknown;
};
