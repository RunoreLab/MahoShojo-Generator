import { anonymizeIp, getClientIpFromHeaders } from '@/lib/arena/battle-report-log-utils';
import { createDrizzleDb, getRuntimeD1ClientWithoutHttpFallback } from '@/lib/db/drizzle';
import { createAuthAuditLog } from '@/lib/db/repositories/auth-audit-logs';

export type AuthAuditSource = 'better-auth' | 'legacy' | 'mixed' | 'unknown';
export type AuthAuditIdentifierType = 'email' | 'username' | 'user-id' | 'auth-key' | 'unknown';

export type RecordAuthAuditLogInput = {
  req: Request;
  eventType: string;
  authSource: AuthAuditSource;
  resultCode: string;
  businessUserId?: number | null;
  authUserId?: string | null;
  identifierType?: AuthAuditIdentifierType | null;
  resultMessage?: string | null;
  metadata?: Record<string, unknown> | null;
};

type D1PreparedStatementLike = {
  bind: (...params: unknown[]) => D1PreparedStatementLike;
  first: <T = unknown>(columnName?: string) => Promise<T | null>;
};

type D1ClientLike = {
  prepare: (sql: string) => D1PreparedStatementLike;
};

const authAuditTableReadyCache = new WeakMap<object, boolean>();

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isD1PreparedStatementLike = (value: unknown): value is D1PreparedStatementLike => {
  if (!isObject(value)) return false;
  return typeof value.bind === 'function' && typeof value.first === 'function';
};

const isD1ClientLike = (value: unknown): value is D1ClientLike => {
  if (!isObject(value)) return false;
  return typeof value.prepare === 'function';
};

const hasNoSuchAuditTableError = (error: unknown): boolean => {
  if (typeof error === 'string') {
    return error.toLowerCase().includes('no such table: auth_audit_logs');
  }
  if (error instanceof Error) {
    return error.message.toLowerCase().includes('no such table: auth_audit_logs');
  }
  return false;
};

const queryAuthAuditTableReady = async (client: D1ClientLike): Promise<boolean> => {
  const statement = client.prepare(
    'SELECT 1 AS ok FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1',
  );
  if (!isD1PreparedStatementLike(statement)) return false;

  const row = await statement.bind('table', 'auth_audit_logs').first<Record<string, unknown>>();
  return row !== null;
};

const ensureAuthAuditTableReady = async (client: unknown): Promise<boolean> => {
  if (!isObject(client)) return false;
  if (authAuditTableReadyCache.has(client)) {
    return authAuditTableReadyCache.get(client) ?? false;
  }
  if (!isD1ClientLike(client)) {
    authAuditTableReadyCache.set(client, false);
    return false;
  }

  try {
    const ready = await queryAuthAuditTableReady(client);
    authAuditTableReadyCache.set(client, ready);
    return ready;
  } catch {
    authAuditTableReadyCache.set(client, false);
    return false;
  }
};

const normalizeUserAgent = (value: string | null): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toJsonString = (value: Record<string, unknown> | null | undefined): string | null => {
  if (!value) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

export const recordAuthAuditLog = async (input: RecordAuthAuditLogInput): Promise<void> => {
  const runtimeClient = getRuntimeD1ClientWithoutHttpFallback();
  if (!runtimeClient) return;

  if (!(await ensureAuthAuditTableReady(runtimeClient))) return;

  const db = createDrizzleDb(runtimeClient);

  try {
    const ip = getClientIpFromHeaders(input.req.headers);
    const ipAnonymized = anonymizeIp(ip);
    const userAgent = normalizeUserAgent(input.req.headers.get('user-agent'));

    await createAuthAuditLog(db, {
      businessUserId: input.businessUserId ?? null,
      authUserId: input.authUserId ?? null,
      eventType: input.eventType,
      authSource: input.authSource,
      identifierType: input.identifierType ?? null,
      ip,
      ipAnonymized,
      userAgent,
      resultCode: input.resultCode,
      resultMessage: input.resultMessage ?? null,
      metadataJson: toJsonString(input.metadata),
    });
  } catch (error) {
    if (hasNoSuchAuditTableError(error)) {
      authAuditTableReadyCache.set(runtimeClient as object, false);
      return;
    }
    console.error('[auth-audit] 记录审计日志失败:', error);
  }
};
