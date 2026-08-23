import { observeD1RoundTrip, type D1RoundTripErrorClass } from './telemetry';

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

type SqlExecutor = (_sql: string, _params: unknown[]) => Promise<D1LikeStatementResult>;
type SqlRawExecutor = (_sql: string, _params: unknown[]) => Promise<D1LikeRawStatementResult>;
type SqlBatchExecutor = (_entries: BatchEntry[]) => Promise<D1LikeStatementResult[]>;

type BatchEntry = {
  sqlText: string;
  params: unknown[];
};

export type D1HttpTransport = {
  query(_sql: string, _params: unknown[]): Promise<unknown>;
  queryRaw(_sql: string, _params: unknown[]): Promise<unknown>;
  queryBatch(_entries: BatchEntry[]): Promise<unknown>;
};

const now = (): number => (
  typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now()
);

const classifyD1Error = (error: unknown): D1RoundTripErrorClass => {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  const lowered = message.toLowerCase();
  if (lowered.includes('abort')) return 'aborted';
  if (lowered.includes('timeout') || message.includes('超时')) return 'timeout';
  if (error instanceof TypeError || lowered.includes('fetch') || lowered.includes('network')) {
    return 'transport';
  }
  if (lowered.includes('response') || lowered.includes('http')) return 'response';
  return 'unknown';
};

const readRowsWritten = (result: { meta?: Record<string, unknown> }): number => {
  const changes = result.meta?.changes;
  return typeof changes === 'number' && Number.isFinite(changes) ? Math.max(0, changes) : 0;
};

const observeD1Success = (
  startedAt: number,
  result: { results?: unknown[]; rows?: unknown[][]; meta?: Record<string, unknown> },
): void => {
  observeD1RoundTrip({
    durationMs: Math.max(0, now() - startedAt),
    rowsRead: Array.isArray(result.results) ? result.results.length : Array.isArray(result.rows) ? result.rows.length : 0,
    rowsWritten: readRowsWritten(result),
    outcome: 'ok',
  });
};

const observeD1Failure = (startedAt: number, error: unknown): void => {
  observeD1RoundTrip({
    durationMs: Math.max(0, now() - startedAt),
    rowsRead: 0,
    rowsWritten: 0,
    outcome: 'error',
    errorClass: classifyD1Error(error),
  });
};

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

class HttpD1PreparedStatement {
  private readonly sqlText: string;
  private readonly executor: SqlExecutor;
  private readonly rawExecutor: SqlRawExecutor | null;
  private readonly params: unknown[];

  constructor(
    sqlText: string,
    executor: SqlExecutor,
    rawExecutor: SqlRawExecutor | null,
    params: unknown[] = [],
  ) {
    this.sqlText = sqlText;
    this.executor = executor;
    this.rawExecutor = rawExecutor;
    this.params = params;
  }

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
  private readonly executor: SqlExecutor;
  private readonly rawExecutor: SqlRawExecutor;
  private readonly batchExecutor: SqlBatchExecutor;

  constructor(
    executor: SqlExecutor,
    rawExecutor: SqlRawExecutor,
    batchExecutor: SqlBatchExecutor,
  ) {
    this.executor = executor;
    this.rawExecutor = rawExecutor;
    this.batchExecutor = batchExecutor;
  }

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

export const createHttpD1Client = (transport: D1HttpTransport): unknown => {

  const executor: SqlExecutor = async (sqlText, params) => {
    const startedAt = now();
    try {
      const payload = await transport.query(sqlText, params);
      const result = parseD1LikeStatementResult(payload, sqlText);
      observeD1Success(startedAt, result);
      return result;
    } catch (error) {
      observeD1Failure(startedAt, error);
      throw error;
    }
  };

  const batchExecutor: SqlBatchExecutor = async (entries) => {
    const startedAt = now();
    if (entries.length === 0) {
      throw new Error('D1 HTTP batch 至少需要一条 SQL 语句');
    }
    try {
      const payload = await transport.queryBatch(entries.map((entry) => ({
        sqlText: normalizeBatchSqlText(entry.sqlText),
        params: [...entry.params],
      })));
      const result = parseD1LikeStatementBatchResult(payload, entries);
      observeD1RoundTrip({
        durationMs: Math.max(0, now() - startedAt),
        rowsRead: result.reduce((total, item) => total + item.results.length, 0),
        rowsWritten: result.reduce((total, item) => total + readRowsWritten(item), 0),
        outcome: 'ok',
      });
      return result;
    } catch (error) {
      observeD1Failure(startedAt, error);
      throw error;
    }
  };

  const rawExecutor: SqlRawExecutor = async (sqlText, params) => {
    const startedAt = now();
    try {
      const payload = await transport.queryRaw(sqlText, params);
      const result = parseD1LikeRawStatementResult(payload, sqlText);
      observeD1Success(startedAt, result);
      return result;
    } catch (error) {
      observeD1Failure(startedAt, error);
      throw error;
    }
  };

  const client = new HttpD1DatabaseClient(executor, rawExecutor, batchExecutor);
  return client as unknown;
};
