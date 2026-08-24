import { observeD1RoundTrip } from './telemetry';

export type D1QueryRetryMode = 'none' | 'safe-read';

export interface D1QueryOptions {
  retry?: D1QueryRetryMode;
}

export const D1_INDETERMINATE_OUTCOME_ERROR_CODE = 'D1_INDETERMINATE_OUTCOME' as const;

export class D1IndeterminateOutcomeError extends Error {
  readonly code = D1_INDETERMINATE_OUTCOME_ERROR_CODE;
  readonly status?: number;

  constructor(status?: number) {
    super(status == null
      ? 'D1 请求已发出，但无法确认是否已提交'
      : `D1 请求已发出，但无法确认是否已提交（HTTP ${status}）`);
    this.name = 'D1IndeterminateOutcomeError';
    this.status = status;
  }
}

export type D1BatchEntry = {
  sqlText: string;
  params: unknown[];
};

export type D1HttpPayload = Record<string, unknown>;
export type D1LikeRow = Record<string, unknown>;

export type D1LikeStatementResult = {
  success: boolean;
  results: D1LikeRow[];
  meta: Record<string, unknown>;
  error?: string;
};

export type D1LikeRawStatementResult = {
  success: boolean;
  rows: unknown[][];
  meta: Record<string, unknown>;
  error?: string;
  columnNames?: string[];
};

export type D1HttpTransport = {
  query(_sql: string, _params: unknown[], _options?: D1QueryOptions): Promise<D1HttpPayload>;
  queryRaw(_sql: string, _params: unknown[], _options?: D1QueryOptions): Promise<D1HttpPayload>;
  queryBatch(_entries: D1BatchEntry[], _options?: D1QueryOptions): Promise<D1HttpPayload>;
};

export type D1ForeignBatchStatement = {
  run(): Promise<D1LikeStatementResult>;
};

export type D1BatchStatement = D1PreparedStatement | D1ForeignBatchStatement;

export type D1HttpClient = {
  prepare(_sqlText: string): D1PreparedStatement;
  batch(_statements: D1BatchStatement[]): Promise<D1LikeStatementResult[]>;
  exec(_sqlText: string): Promise<{ count: number; duration: number }>;
};

export type D1HttpTransportConfig = {
  kind: 'gateway' | 'cloudflare-api';
  baseUrl?: string;
  queryUrl?: string;
  rawUrl?: string;
  token?: string;
  apiToken?: string;
  hmacSecret?: string;
  accessClientId?: string;
  accessClientSecret?: string;
  fetch?: typeof globalThis.fetch;
};

type ApiResult = {
  success?: boolean;
  results?: unknown;
  meta?: unknown;
  error?: unknown;
};

type ApiEnvelope = {
  success?: boolean;
  result?: unknown;
};

type D1Stage = 'fetch' | 'response' | 'parse' | 'envelope' | 'transport';

class D1HttpError extends Error {
  readonly stage: D1Stage;
  readonly status?: number;

  constructor(message: string, stage: D1Stage, status?: number) {
    super(message);
    this.name = 'D1HttpError';
    this.stage = stage;
    this.status = status;
  }
}

const asObject = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
);

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const textOf = (value: unknown): string => (
  typeof value === 'string' && value.trim() ? value.trim() : ''
);

const literalError = (stage: D1Stage, status?: number): D1HttpError => {
  if (stage === 'parse') return new D1HttpError('D1 HTTP 返回格式异常', stage, status);
  if (stage === 'response') return new D1HttpError(`D1 API 错误: ${status ?? 'unknown'}`, stage, status);
  return new D1HttpError('D1 HTTP 执行失败', stage, status);
};

const isRetryableStatus = (status: number): boolean => (
  status === 408
  || status === 425
  || status === 429
  || (status >= 500 && status <= 599)
);

const readErrorProperty = (error: unknown, property: 'name' | 'message' | 'cause' | 'code'): unknown => {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return undefined;
  try {
    return (error as Record<string, unknown>)[property];
  } catch {
    return undefined;
  }
};

const errorName = (error: unknown): string => {
  const name = readErrorProperty(error, 'name');
  return typeof name === 'string' ? name : '';
};

const causeCode = (error: unknown): string => {
  const cause = readErrorProperty(error, 'cause');
  const code = readErrorProperty(cause, 'code');
  return typeof code === 'string' ? code : '';
};

const errorMessage = (error: unknown): string => {
  const message = readErrorProperty(error, 'message');
  return typeof message === 'string' ? message : '';
};

const isRetryableFetchError = (error: unknown): boolean => {
  const name = errorName(error);
  const code = causeCode(error);
  return name === 'TypeError' && (
    code === 'UND_ERR_CONNECT_TIMEOUT'
    || errorMessage(error).toLowerCase().includes('fetch failed')
  );
};

const isAbort = (error: unknown): boolean => errorName(error) === 'AbortError';

const isTimeout = (error: unknown): boolean => (
  errorName(error) === 'TimeoutError'
  || errorName(error) === 'Timeout'
  || causeCode(error) === 'UND_ERR_CONNECT_TIMEOUT'
);

const isInstanceOf = <T extends Error>(
  error: unknown,
  constructor: abstract new (..._args: never[]) => T,
): error is T => {
  try {
    return error instanceof constructor;
  } catch {
    return false;
  }
};

const errorClass = (
  error: unknown,
  stage: D1Stage,
): 'aborted' | 'timeout' | 'transport' | 'response' | 'unknown' => {
  if (isAbort(error)) return 'aborted';
  if (isTimeout(error)) return 'timeout';
  if (stage === 'response') return 'response';
  if (stage === 'fetch' || stage === 'transport') return 'transport';
  return 'unknown';
};

const now = (): number => (
  typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now()
);

const observeError = (started: number, error: unknown, stage: D1Stage): void => {
  observeD1RoundTrip({
    durationMs: Math.max(0, now() - started),
    rowsRead: 0,
    rowsWritten: 0,
    outcome: 'error',
    errorClass: errorClass(error, stage),
  });
};

const finite = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null
);

const nonNegativeFinite = (value: unknown): number => (
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
);

const rowsRead = (result: {
  results?: unknown;
  rows?: unknown;
  meta?: Record<string, unknown>;
}): number => {
  const rawRows = asObject(result.results)?.rows;
  return finite(result.meta?.['rows_read'])
    ?? (Array.isArray(result.results)
      ? result.results.length
      : Array.isArray(result.rows)
        ? result.rows.length
        : Array.isArray(rawRows) ? rawRows.length : 0);
};

const rowsWritten = (result: {
  results?: unknown;
  rows?: unknown;
  meta?: Record<string, unknown>;
}): number => (
  finite(result.meta?.['rows_written']) ?? finite(result.meta?.changes) ?? 0
);

const observeSuccess = (started: number, result: {
  results?: unknown;
  rows?: unknown;
  meta?: Record<string, unknown>;
}): void => {
  observeD1RoundTrip({
    durationMs: Math.max(0, now() - started),
    rowsRead: rowsRead(result),
    rowsWritten: rowsWritten(result),
    outcome: 'ok',
  });
};

type ParsedStatement = {
  results: unknown;
  meta: Record<string, unknown>;
  error?: string;
  malformed?: boolean;
  legacy?: boolean;
};

function parseStatement(payload: unknown): ParsedStatement {
  const envelope = asObject(payload) as ApiEnvelope | null;
  if (!envelope) throw literalError('parse');
  if (envelope.success === false) throw new D1HttpError('D1 HTTP 执行失败', 'envelope');
  if (envelope.success !== true || !Array.isArray(envelope.result) || envelope.result.length === 0) {
    return { results: [], meta: {}, malformed: true };
  }

  const first = asObject(envelope.result[0]) as ApiResult | null;
  if (!first) return { results: [], meta: {}, malformed: true };
  if (first.success === false) throw new D1HttpError('D1 SQL 执行失败', 'envelope');
  // Keep accepting the historical payload shape used by queryD1Payload callers;
  // the high-level client still gets an empty result for this legacy envelope.
  if (first.success === undefined && Object.keys(first).length > 0) {
    return { results: [], meta: {}, legacy: true };
  }
  const rawResult = asObject(first.results);
  const hasValidResults = Array.isArray(first.results)
    || Boolean(rawResult && Array.isArray(rawResult.rows));
  if (first.success !== true || !hasValidResults) {
    return { results: [], meta: {}, malformed: true };
  }

  const error = textOf(first.error);
  return {
    results: first.results,
    meta: asObject(first.meta) ?? {},
    ...(error ? { error } : {}),
  };
}

const parseTransportStatements = (
  payload: unknown,
  expectedCount?: number,
): ParsedStatement[] => {
  const envelope = asObject(payload) as ApiEnvelope | null;
  if (!envelope) throw literalError('parse');
  if (envelope.success === false) throw new D1HttpError('D1 HTTP 执行失败', 'envelope');
  if (envelope.success !== true || !Array.isArray(envelope.result) || envelope.result.length === 0) {
    throw literalError('parse');
  }
  if (expectedCount !== undefined && envelope.result.length !== expectedCount) {
    throw literalError('parse');
  }

  return envelope.result.map((item) => {
    const result = asObject(item) as ApiResult | null;
    if (!result) throw literalError('parse');
    if (result.success === false) throw new D1HttpError('D1 SQL 执行失败', 'envelope');

    const rawResult = asObject(result.results);
    const hasValidResults = Array.isArray(result.results)
      || Boolean(rawResult && Array.isArray(rawResult.rows));
    if (result.success !== true || !hasValidResults) throw literalError('parse');

    const error = textOf(result.error);
    return {
      results: result.results,
      meta: asObject(result.meta) ?? {},
      ...(error ? { error } : {}),
    };
  });
};

const normalizeRows = (value: unknown): D1LikeRow[] => asArray(value).flatMap((row) => {
  const object = asObject(row);
  return object ? [object] : [];
});

const normalizeRawRows = (value: unknown): unknown[][] => {
  const root = asObject(value);
  return (root ? asArray(root.rows) : asArray(value)).flatMap((row) => {
    if (Array.isArray(row)) return [row];
    const object = asObject(row);
    return object ? [Object.values(object)] : [];
  });
};

const columnNames = (value: unknown): string[] => {
  const root = asObject(value);
  const columns = root ? asArray(root.columns) : [];
  if (columns.length) return columns.filter((column): column is string => typeof column === 'string');

  const first = (root ? asArray(root.rows) : asArray(value))[0];
  const object = asObject(first);
  return object ? Object.keys(object) : [];
};

const parseLike = (payload: unknown): D1LikeStatementResult => {
  const result = parseStatement(payload);
  if (result.malformed) throw literalError('parse');
  return {
    success: true,
    results: normalizeRows(result.results),
    meta: result.meta,
    ...(result.error ? { error: result.error } : {}),
  };
};

const parseRawLike = (payload: unknown): D1LikeRawStatementResult => {
  const result = parseStatement(payload);
  if (result.malformed) throw literalError('parse');
  return {
    success: true,
    rows: normalizeRawRows(result.results),
    meta: result.meta,
    ...(result.error ? { error: result.error } : {}),
    columnNames: columnNames(result.results),
  };
};

const parseBatchLike = (payload: unknown, count: number): D1LikeStatementResult[] => {
  const envelope = asObject(payload) as ApiEnvelope | null;
  if (!envelope) throw literalError('parse');
  if (envelope.success === false) throw new D1HttpError('D1 HTTP batch 执行失败', 'envelope');

  const results = asArray(envelope.result);
  if (results.length !== count) throw new D1HttpError('D1 HTTP batch 返回结果数量异常', 'parse');

  return results.map((item, index) => {
    try {
      return parseLike({ success: true, result: [item] });
    } catch (error) {
      if (error instanceof D1HttpError) {
        throw new D1HttpError(`D1 SQL batch 第 ${index + 1} 条执行失败`, error.stage, error.status);
      }
      throw error;
    }
  });
};

const bytesToHex = (bytes: ArrayBuffer): string => (
  Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('')
);

const randomId = (): string => {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytesToHex(bytes.buffer);
};

const sign = async (
  secret: string,
  timestamp: string,
  nonce: string,
  pathname: string,
  body: string,
): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}\n${nonce}\n${pathname}\n${body}`),
  );
  return bytesToHex(signature);
};

const normalizeBase = (value: string): string => value.trim().replace(/\/+$/, '');

const retryAfter = (response: Response): number | null => {
  let value: string | null;
  try {
    value = response.headers.get('retry-after');
  } catch {
    return null;
  }
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value ?? '');
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
};

const cancelResponseBody = async (response: Response): Promise<void> => {
  try {
    const body = response.body;
    if (body) await body.cancel().catch(() => undefined);
  } catch {
    // A hostile response body must not create a second observation.
  }
};

const jitterMs = (milliseconds: number): number => {
  if (milliseconds <= 0) return 0;
  const delta = milliseconds * 0.2;
  return Math.max(0, milliseconds - delta + Math.random() * (2 * delta));
};

const retryDelay = (response: Response, attempt: number): number => {
  const retryAfterMs = retryAfter(response);
  if (retryAfterMs != null) return retryAfterMs;
  return retryBackoff(attempt);
};

const retryBackoff = (attempt: number): number => {
  const backoffMs = Math.min(8_000, 500 * 2 ** attempt);
  return jitterMs(backoffMs);
};

type SqlDisposition = 'read' | 'write';

const readOnlySqlKeywords = new Set(['SELECT', 'EXPLAIN', 'VALUES']);
const mutationSqlKeywords = new Set([
  'ALTER', 'ATTACH', 'CREATE', 'DELETE', 'DETACH', 'DROP', 'INSERT', 'PRAGMA',
  'REINDEX', 'RELEASE', 'REPLACE', 'ROLLBACK', 'SAVEPOINT', 'UPDATE', 'VACUUM',
]);

const classifySql = (sql: string): SqlDisposition => {
  const statements: string[][] = [];
  let words: string[] = [];
  let word = '';
  let quote: "'" | '"' | '`' | ']' | null = null;
  let blockComment = false;
  let lineComment = false;

  const flushWord = () => {
    if (word) {
      words.push(word.toUpperCase());
      word = '';
    }
  };
  const flushStatement = () => {
    flushWord();
    if (words.length) statements.push(words);
    words = [];
  };

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    const next = sql[index + 1] ?? '';

    if (lineComment) {
      if (character === '\n' || character === '\r') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        if (sql[index + 1] === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === '-' && next === '-') {
      flushWord();
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      flushWord();
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      flushWord();
      quote = character;
      continue;
    }
    if (character === '[') {
      flushWord();
      quote = ']';
      continue;
    }
    if (character === ';') {
      flushStatement();
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(character)) {
      word += character;
    } else {
      flushWord();
    }
  }

  if (quote || blockComment) return 'write';
  flushStatement();
  if (statements.length !== 1) return 'write';
  const [statement] = statements;
  if (!statement || !readOnlySqlKeywords.has(statement[0]!)) return 'write';
  if (statement.some((token) => mutationSqlKeywords.has(token))) return 'write';
  return 'read';
};

const isMutationSql = (sql: string): boolean => classifySql(sql) === 'write';

function createD1HttpTransport(config: D1HttpTransportConfig): D1HttpTransport {
  const base = config.baseUrl ? normalizeBase(config.baseUrl) : '';
  const queryUrl = config.queryUrl ?? `${base}/v1/query`;
  const rawUrl = config.rawUrl ?? `${base}/v1/raw`;
  if (!queryUrl || !rawUrl || (config.kind === 'gateway' && !base)) {
    throw new D1HttpError('D1 HTTP 配置无效', 'transport');
  }
  try {
    new URL(queryUrl);
    new URL(rawUrl);
  } catch {
    throw new D1HttpError('D1 HTTP 配置无效', 'transport');
  }

  const fetcher = config.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new D1HttpError('D1 HTTP fetch 不可用', 'transport');

  const request = async (
    url: string,
    body: Record<string, unknown>,
    options: D1QueryOptions,
    parse: (_payload: unknown) => unknown,
    operation: 'read' | 'write',
  ): Promise<D1HttpPayload> => {
    let bodyText: string;
    try {
      const serialized = JSON.stringify(body);
      if (typeof serialized !== 'string') throw new Error('D1 body serialization returned no string');
      bodyText = serialized;
    } catch {
      throw new D1HttpError('D1 HTTP 请求参数无效', 'transport');
    }
    const attempts = options.retry === 'safe-read' && operation === 'read' ? 5 : 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let started = 0;
      let dispatched = false;
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = config.token ?? config.apiToken;
        if (token) headers.Authorization = `Bearer ${token}`;
        if (config.accessClientId) headers['CF-Access-Client-Id'] = config.accessClientId;
        if (config.accessClientSecret) headers['CF-Access-Client-Secret'] = config.accessClientSecret;

        if (config.kind === 'gateway' && config.hmacSecret) {
          const timestamp = String(Date.now());
          const nonce = randomId();
          const pathname = new URL(url).pathname;
          headers['X-Mahoshojo-Timestamp'] = timestamp;
          headers['X-Mahoshojo-Nonce'] = nonce;
          headers['X-Mahoshojo-Signature'] = await sign(
            config.hmacSecret,
            timestamp,
            nonce,
            pathname,
            bodyText,
          );
        }

        started = now();
        const responsePromise = fetcher(url, { method: 'POST', headers, body: bodyText });
        dispatched = true;
        const response = await responsePromise;
        let responseStatus: number;
        let responseOk: boolean;
        try {
          responseStatus = response.status;
          responseOk = response.ok;
        } catch (error) {
          observeError(started, error, 'response');
          if (operation === 'write') throw new D1IndeterminateOutcomeError();
          throw literalError('parse');
        }

        if (isRetryableStatus(responseStatus) && attempt < attempts - 1) {
          observeError(started, undefined, 'response');
          await cancelResponseBody(response);
          await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
          continue;
        }

        if (!responseOk) {
          observeError(started, undefined, 'response');
          await cancelResponseBody(response);
          if (operation === 'write' && isRetryableStatus(responseStatus)) {
            throw new D1IndeterminateOutcomeError(responseStatus);
          }
          throw new D1HttpError(
            `D1 API 错误: ${responseStatus}`,
            'response',
            responseStatus,
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          observeError(started, undefined, 'parse');
          if (operation === 'write') throw new D1IndeterminateOutcomeError();
          throw literalError('parse');
        }

        try {
          const parsed = parse(payload) as {
            results?: unknown;
            rows?: unknown;
            meta?: Record<string, unknown>;
            malformed?: boolean;
            legacy?: boolean;
          } | Array<{ results?: unknown; meta?: Record<string, unknown> }>;
          if (!Array.isArray(parsed) && (parsed.malformed || (parsed.legacy && operation === 'write'))) {
            throw literalError('parse');
          }
          if (Array.isArray(parsed)) {
            observeD1RoundTrip({
              durationMs: Math.max(0, now() - started),
              rowsRead: parsed.reduce((total, item) => total + rowsRead(item), 0),
              rowsWritten: parsed.reduce((total, item) => total + rowsWritten(item), 0),
              outcome: 'ok',
            });
          } else {
            observeSuccess(started, parsed);
          }
          return payload as D1HttpPayload;
        } catch (error) {
          if (isInstanceOf(error, D1IndeterminateOutcomeError)) throw error;
          observeError(started, error, isInstanceOf(error, D1HttpError) ? error.stage : 'parse');
          if (operation === 'write' && isInstanceOf(error, D1HttpError) && error.stage === 'parse') {
            throw new D1IndeterminateOutcomeError();
          }
          throw isInstanceOf(error, D1HttpError) ? error : literalError('parse');
        }
      } catch (error) {
        if (
          isInstanceOf(error, D1IndeterminateOutcomeError)
          || (isInstanceOf(error, D1HttpError) && error.stage !== 'fetch')
        ) {
          throw error;
        }

        if (!dispatched) throw new D1HttpError('D1 HTTP 传输失败', 'transport');
        observeError(started, error, 'fetch');
        if (operation === 'write') throw new D1IndeterminateOutcomeError();
        if (!isRetryableFetchError(error) || attempt === attempts - 1) {
          throw new D1HttpError('D1 HTTP 传输失败', 'fetch');
        }
        await new Promise((resolve) => setTimeout(resolve, retryBackoff(attempt)));
      }
    }

    throw new D1HttpError('D1 HTTP 传输失败', 'fetch');
  };

  const operation = (
    url: string,
    body: Record<string, unknown>,
    options: D1QueryOptions,
    parse: (_payload: unknown) => unknown,
    kind: 'read' | 'write',
  ): Promise<D1HttpPayload> => request(url, body, options, parse, kind);

  return {
    query: (sql, params, options = {}) => operation(
      queryUrl,
      { sql, params },
      options,
      (payload) => parseTransportStatements(payload),
      isMutationSql(sql) ? 'write' : 'read',
    ),
    queryRaw: (sql, params, options = {}) => operation(
      rawUrl,
      { sql, params },
      options,
      (payload) => parseTransportStatements(payload),
      isMutationSql(sql) ? 'write' : 'read',
    ),
    queryBatch: (entries, options = {}) => {
      if (!entries.length) return Promise.reject(new D1HttpError('D1 HTTP batch 至少需要一条 SQL 语句', 'transport'));
      return operation(
        queryUrl,
        { batch: entries.map((entry) => ({
          sql: entry.sqlText.trim().replace(/;+\s*$/g, ''),
          params: [...entry.params],
        })) },
        options,
        (payload) => parseTransportStatements(payload, entries.length),
        entries.some((entry) => isMutationSql(entry.sqlText)) ? 'write' : 'read',
      );
    },
  };
}

export { createD1HttpTransport };

export class D1PreparedStatement {
  private readonly sqlText: string;
  private readonly transport: D1HttpTransport;
  private readonly params: unknown[];

  constructor(sqlText: string, transport: D1HttpTransport, params: unknown[] = []) {
    this.sqlText = sqlText;
    this.transport = transport;
    this.params = params;
  }

  bind(...params: unknown[]): D1PreparedStatement {
    return new D1PreparedStatement(this.sqlText, this.transport, params);
  }

  async run(): Promise<D1LikeStatementResult> {
    return parseLike(await this.transport.query(this.sqlText, this.params));
  }

  async all(): Promise<D1LikeStatementResult> {
    return this.run();
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const row = (await this.all()).results[0];
    if (!row) return null;
    return (columnName ? row[columnName] : row) as T ?? null;
  }

  async raw(options?: { columnNames?: boolean }): Promise<unknown[][] | [string[], ...unknown[][]]> {
    const result = parseRawLike(await this.transport.queryRaw(this.sqlText, this.params));
    if (!result.rows.length) return options?.columnNames ? [[]] : [];
    return options?.columnNames ? [result.columnNames ?? [], ...result.rows] : result.rows;
  }

  toBatchEntry(): D1BatchEntry {
    return { sqlText: this.sqlText, params: [...this.params] };
  }
}

export const createHttpD1Client = (transport: D1HttpTransport): D1HttpClient => ({
  prepare: (sqlText) => new D1PreparedStatement(sqlText, transport),
  batch: async (statements) => {
    if (!statements.length) throw new Error('D1 HTTP batch 至少需要一条 SQL 语句');
    if (!statements.every((statement): statement is D1PreparedStatement => (
      statement instanceof D1PreparedStatement
    ))) {
      const results: D1LikeStatementResult[] = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
    return parseBatchLike(
      await transport.queryBatch(statements.map((statement) => statement.toBatchEntry())),
      statements.length,
    );
  },
  exec: async (sqlText) => {
    const result = await new D1PreparedStatement(sqlText, transport).run();
    return {
      count: rowsWritten(result),
      duration: nonNegativeFinite(result.meta.duration),
    };
  },
});
