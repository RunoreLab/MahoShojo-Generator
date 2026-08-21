type D1Meta = Record<string, unknown>;

type D1Result = {
  success: boolean;
  results?: unknown;
  meta?: D1Meta;
  error?: string;
};

type D1PreparedStatement = {
  bind: (...params: unknown[]) => D1PreparedStatement;
  all: () => Promise<D1Result>;
  raw: (options?: { columnNames?: boolean }) => Promise<unknown[][]>;
};

type D1Session = {
  prepare: (sql: string) => D1PreparedStatement;
  batch: (statements: D1PreparedStatement[]) => Promise<D1Result[]>;
  getBookmark?: () => string | null;
};

type D1Database = D1Session & {
  withSession?: (constraint?: string) => D1Session;
};

type GatewayEnv = {
  DB: D1Database;
  D1_GATEWAY_HMAC_SECRET?: string;
  D1_GATEWAY_TOKEN?: string;
  D1_GATEWAY_ALLOW_INSECURE_LOCAL?: string;
};

type StatementInput = {
  sql: string;
  params: unknown[];
};

const MAX_BODY_BYTES = 512 * 1024;
const MAX_SQL_CHARS = 100_000;
const MAX_BATCH_STATEMENTS = 50;
const MAX_PARAMS = 1_000;
const MAX_CLOCK_SKEW_MS = 60_000;
const FORBIDDEN_SQL_RE = /^\s*(?:--[^\n]*\n\s*)*(?:CREATE|ALTER|DROP|TRUNCATE|VACUUM|ATTACH|DETACH)\b/i;

const json = (payload: unknown, status = 200, headers?: HeadersInit): Response => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  },
);

const timingSafeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const bytesToHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');

const sign = async (secret: string, value: string): Promise<string> => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
};

const isAuthorized = async (request: Request, env: GatewayEnv, bodyText: string): Promise<boolean> => {
  const hostname = new URL(request.url).hostname;
  if (env.D1_GATEWAY_ALLOW_INSECURE_LOCAL === 'true'
    && ['localhost', '127.0.0.1', '::1'].includes(hostname)) return true;

  const bearer = request.headers.get('authorization');
  if (env.D1_GATEWAY_TOKEN && bearer === `Bearer ${env.D1_GATEWAY_TOKEN}`) return true;

  const secret = env.D1_GATEWAY_HMAC_SECRET?.trim();
  if (!secret) return false;

  const timestamp = request.headers.get('x-mahoshojo-timestamp') || '';
  const nonce = request.headers.get('x-mahoshojo-nonce') || '';
  const suppliedSignature = request.headers.get('x-mahoshojo-signature') || '';
  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) return false;
  if (!/^[A-Za-z0-9-]{16,128}$/.test(nonce)) return false;
  if (!/^[a-f0-9]{64}$/i.test(suppliedSignature)) return false;

  const pathname = new URL(request.url).pathname;
  const expectedSignature = await sign(secret, `${timestamp}\n${nonce}\n${pathname}\n${bodyText}`);
  return timingSafeEqual(expectedSignature, suppliedSignature.toLowerCase());
};

const normalizeStatement = (value: unknown): StatementInput => {
  if (!value || typeof value !== 'object') throw new Error('语句必须是对象');
  const record = value as { sql?: unknown; params?: unknown };
  const sql = typeof record.sql === 'string' ? record.sql.trim() : '';
  const params = record.params === undefined ? [] : record.params;

  if (!sql || sql.length > MAX_SQL_CHARS) throw new Error('SQL 为空或过长');
  if (FORBIDDEN_SQL_RE.test(sql)) throw new Error('Gateway 禁止执行 DDL 或维护语句');
  if (!Array.isArray(params) || params.length > MAX_PARAMS) throw new Error('SQL params 格式异常或数量过多');
  return { sql, params };
};

const readBody = async (request: Request): Promise<string> => {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new Error('请求体过大');
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) throw new Error('请求体过大');
  return bodyText;
};

const getSession = (request: Request, database: D1Database): D1Session => {
  if (!database.withSession) return database;
  const bookmark = request.headers.get('x-d1-bookmark')?.trim();
  const constraint = request.headers.get('x-d1-session-constraint')?.trim();
  return database.withSession(bookmark || constraint || 'first-primary');
};

const toResultEnvelope = (results: D1Result[], session: D1Session): Response => {
  const bookmark = session.getBookmark?.() || '';
  return json(
    { success: true, result: results },
    200,
    bookmark ? { 'X-D1-Bookmark': bookmark } : undefined,
  );
};

const executeQuery = async (request: Request, env: GatewayEnv, rawMode: boolean): Promise<Response> => {
  let bodyText: string;
  try {
    bodyText = await readBody(request);
  } catch (error) {
    return json({ success: false, errors: [{ message: error instanceof Error ? error.message : '请求体无效' }] }, 413);
  }

  if (!await isAuthorized(request, env, bodyText)) {
    return json({ success: false, errors: [{ message: 'Unauthorized' }] }, 401);
  }

  try {
    const body = JSON.parse(bodyText) as { sql?: unknown; params?: unknown; batch?: unknown };
    const session = getSession(request, env.DB);

    if (Array.isArray(body.batch)) {
      if (rawMode) throw new Error('raw endpoint 不支持 batch');
      if (body.batch.length < 1 || body.batch.length > MAX_BATCH_STATEMENTS) {
        throw new Error('batch 语句数量必须在 1 到 50 之间');
      }
      const statements = body.batch.map(normalizeStatement);
      const prepared = statements.map((statement) => session.prepare(statement.sql).bind(...statement.params));
      return toResultEnvelope(await session.batch(prepared), session);
    }

    const statement = normalizeStatement(body);
    const prepared = session.prepare(statement.sql).bind(...statement.params);
    if (rawMode) {
      const matrix = await prepared.raw({ columnNames: true });
      const [columnNames = [], ...rows] = matrix;
      return toResultEnvelope([{
        success: true,
        results: { columns: columnNames, rows },
        meta: {},
      }], session);
    }

    return toResultEnvelope([await prepared.all()], session);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'D1 Gateway 执行失败';
    return json({ success: false, errors: [{ message }] }, 400);
  }
};

const gatewayWorker = {
  async fetch(request: Request, env: GatewayEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'mahoshojo-d1-gateway' });
    }
    if (request.method !== 'POST') return json({ success: false, errors: [{ message: 'Method not allowed' }] }, 405);
    if (url.pathname === '/v1/query') return executeQuery(request, env, false);
    if (url.pathname === '/v1/raw') return executeQuery(request, env, true);
    return json({ success: false, errors: [{ message: 'Not found' }] }, 404);
  },
};

export default gatewayWorker;
