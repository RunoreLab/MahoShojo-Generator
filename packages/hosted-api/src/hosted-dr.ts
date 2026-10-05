import { ARENA_ROOM_ERROR_TAXONOMY_HEADER } from '@mahoshojo/contracts/arena-room';

export type HostedDrRequestClass =
  | 'safe-read'
  | 'durably-idempotent-command'
  | 'non-idempotent-operation';

export type HostedDrDispatchState = 'not-dispatched' | 'dispatched' | 'unknown';

export type HostedDrPrimaryHealth = 'healthy' | 'unavailable' | 'unknown';

export type HostedDrRuntime = 'hono-primary' | 'next-dr' | 'fail-closed';

export {
  parseHostedApiDeploymentTarget,
  type HostedApiDeploymentTarget,
} from './deployment-target';

export type HostedDrSelectionInput = {
  requestClass: HostedDrRequestClass;
  dispatchState: HostedDrDispatchState;
  primaryHealth: HostedDrPrimaryHealth;
  hasDurableIdempotencyProof: boolean;
};

export const HOSTED_DR_CONTRACT_VERSION = 'g25e1-v1' as const;
export const HOSTED_DR_READINESS_SQL = 'SELECT 1 AS ok' as const;
export const HOSTED_API_CORS_ORIGINS_ENVIRONMENT = 'HONO_CORS_ORIGINS' as const;
export const HOSTED_API_CORS_ALLOW_HEADERS = [
  'Content-Type',
  'Authorization',
  ARENA_ROOM_ERROR_TAXONOMY_HEADER,
  'X-Request-Id',
  'X-Mahoshojo-Activity-Token',
  'X-Mahoshojo-Generation-Actor-Token',
  'X-Mahoshojo-User-Id',
  'X-Mahoshojo-AI-Meta',
  'Last-Event-ID',
] as const;
export const HOSTED_API_CORS_EXPOSE_HEADERS = [
  'X-Request-Id',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'Retry-After',
  'X-Mahoshojo-Generation-Actor-Token',
  'X-Mahoshojo-Generation-Id',
  'X-Mahoshojo-Generation-Request-Id',
  'X-Mahoshojo-Generation-Fallback',
  'X-Mahoshojo-Stream-Meta',
  'X-Mahoshojo-Arena-Companion-Operation',
  'X-Mahoshojo-Arena-Execution-Placement',
] as const;
export const HOSTED_API_CORS_ALLOW_METHODS = [
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const;

const HOSTED_DR_VERSION_PATTERN = /^(g25e\d+)-v(\d+)$/u;
const HOSTED_DR_MAX_VERSION_SKEW = 1;

const parseHostedDrContractVersion = (
  value: string,
): { family: string; version: number } | null => {
  const match = HOSTED_DR_VERSION_PATTERN.exec(value);
  if (!match) return null;
  const version = Number(match[2]);
  if (!Number.isSafeInteger(version) || version < 1) return null;
  return { family: match[1]!, version };
};

export const isHostedDrContractVersionCompatible = (
  runtimeContractVersion: string,
  clientContractVersion: string,
): boolean => {
  const runtime = parseHostedDrContractVersion(runtimeContractVersion);
  const client = parseHostedDrContractVersion(clientContractVersion);
  return Boolean(
    runtime
    && client
    && runtime.family === client.family
    && Math.abs(runtime.version - client.version) <= HOSTED_DR_MAX_VERSION_SKEW
  );
};

const matchesHostedWildcardOrigin = (origin: string, rule: string): boolean => {
  const wildcardPrefix = /^(https?):\/\/\*\./iu;
  if (!wildcardPrefix.test(rule)) return false;

  try {
    const wildcardHostPrefix = 'cors-wildcard.';
    const ruleUrl = new URL(rule.replace(wildcardPrefix, `$1://${wildcardHostPrefix}`));
    const originUrl = new URL(origin);
    const baseHostname = ruleUrl.hostname.slice(wildcardHostPrefix.length);
    return Boolean(baseHostname)
      && !ruleUrl.username
      && !ruleUrl.password
      && ruleUrl.pathname === '/'
      && !ruleUrl.search
      && !ruleUrl.hash
      && originUrl.protocol === ruleUrl.protocol
      && originUrl.port === ruleUrl.port
      && originUrl.hostname.endsWith(`.${baseHostname}`);
  } catch {
    return false;
  }
};

export const resolveHostedApiCorsOrigin = (
  origin: string,
  allowedOrigins: readonly string[],
): string => {
  if (allowedOrigins.includes('*')) return origin;
  return allowedOrigins.some((rule) => (
    rule === origin || matchesHostedWildcardOrigin(origin, rule)
  )) ? origin : '';
};

const HOSTED_API_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export const hasValidHostedApiProductionCorsOrigins = (
  allowedOrigins: readonly string[],
): boolean => allowedOrigins.length > 0 && allowedOrigins.every((rule) => {
  if (!rule || rule === '*') return false;
  const wildcardPrefix = /^https:\/\/\*\./iu;
  const wildcardHostPrefix = 'cors-wildcard.';
  const normalizedRule = wildcardPrefix.test(rule)
    ? rule.replace(wildcardPrefix, `https://${wildcardHostPrefix}`)
    : rule;
  try {
    const origin = new URL(normalizedRule);
    const hostname = origin.hostname.startsWith(wildcardHostPrefix)
      ? origin.hostname.slice(wildcardHostPrefix.length)
      : origin.hostname;
    return origin.protocol === 'https:'
      && Boolean(hostname)
      && !HOSTED_API_LOOPBACK_HOSTS.has(hostname)
      && !origin.username
      && !origin.password
      && origin.pathname === '/'
      && !origin.search
      && !origin.hash;
  } catch {
    return false;
  }
});

const appendVaryOrigin = (headers: Headers): void => {
  const current = headers.get('Vary')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  if (!current.some((value) => value.toLowerCase() === 'origin')) current.push('Origin');
  headers.set('Vary', current.join(', '));
};

const applyHostedApiCorsHeaders = (
  headers: Headers,
  origin: string,
  allowedOrigins: readonly string[],
): boolean => {
  const allowedOrigin = resolveHostedApiCorsOrigin(origin, allowedOrigins);
  appendVaryOrigin(headers);
  if (!allowedOrigin) return false;
  headers.set('Access-Control-Allow-Origin', allowedOrigin);
  return true;
};

export const createHostedApiCorsPreflightResponse = (
  request: Request,
  allowedOrigins: readonly string[],
): Response => {
  const headers = new Headers({
    'Access-Control-Allow-Headers': HOSTED_API_CORS_ALLOW_HEADERS.join(', '),
    'Access-Control-Allow-Methods': HOSTED_API_CORS_ALLOW_METHODS.join(', '),
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
  });
  applyHostedApiCorsHeaders(headers, request.headers.get('Origin') ?? '', allowedOrigins);
  return new Response(null, { status: 204, headers });
};

export const withHostedApiCorsHeaders = (
  request: Request,
  response: Response,
  allowedOrigins: readonly string[],
): Response => {
  const origin = request.headers.get('Origin');
  if (!origin) return response;
  const headers = new Headers(response.headers);
  if (applyHostedApiCorsHeaders(headers, origin, allowedOrigins)) {
    headers.set('Access-Control-Expose-Headers', HOSTED_API_CORS_EXPOSE_HEADERS.join(', '));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

type HostedDrReadinessStatementResult = {
  success: boolean;
  results: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
  error?: string;
};

type HostedDrReadinessStatement = {
  bind(..._params: unknown[]): HostedDrReadinessStatement;
  run(_options?: { retry?: 'none' | 'safe-read' }): Promise<HostedDrReadinessStatementResult>;
  all(_options?: { retry?: 'none' | 'safe-read' }): Promise<HostedDrReadinessStatementResult>;
};

type HostedDrReadinessClient = {
  prepare(_sql: string): HostedDrReadinessStatement;
};

type HostedDrReadinessSession = {
  client: HostedDrReadinessClient;
  consistency: 'replica-ok' | 'primary';
  initialBookmark: string | null;
  getBookmark(): string | null;
};

export type HostedDrReadinessDatabaseProvider = {
  id: 'hono-d1-primary' | 'cloudflare-d1-binding';
  openSession(_input: {
    consistency: 'replica-ok' | 'primary';
    bookmark?: string | null;
  }): HostedDrReadinessSession | null;
};

export type HostedDrReadinessPlacement = 'hono-primary' | 'next-dr';

export type HostedDrReadinessService = (_request: Request) => Promise<Response>;

const readinessHeaders = (extra?: HeadersInit): Headers => {
  const headers = new Headers(extra);
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return headers;
};

const readinessResponse = (
  request: Request,
  payload: Record<string, unknown>,
  status: number,
  extraHeaders?: HeadersInit,
): Response => new Response(
  request.method.toUpperCase() === 'HEAD' ? null : JSON.stringify(payload),
  {
    status,
    headers: readinessHeaders(extraHeaders),
  },
);

const isReadyResult = (value: HostedDrReadinessStatementResult): boolean => (
  value.success
  && value.results.length === 1
  && value.results[0]?.ok === 1
);

export const createHostedDrReadinessService = (input: {
  placement: HostedDrReadinessPlacement;
  provider: HostedDrReadinessDatabaseProvider;
  target?: Readonly<{
    capabilityId: string;
    operationMethod: string;
  }>;
}): HostedDrReadinessService => async (request) => {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return readinessResponse(request, {
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
    }, 405, { Allow: 'GET, HEAD' });
  }

  try {
    const session = input.provider.openSession({ consistency: 'replica-ok' });
    if (!session) throw new Error('database session unavailable');
    const result = await session.client
      .prepare(HOSTED_DR_READINESS_SQL)
      .all({ retry: 'safe-read' });
    if (!isReadyResult(result)) throw new Error('database readiness failed');
    return readinessResponse(request, {
      ok: true,
      contractVersion: HOSTED_DR_CONTRACT_VERSION,
      placement: input.placement,
      databaseProvider: input.provider.id,
      consistency: 'replica-ok',
      ...(input.target ?? {}),
    }, 200);
  } catch {
    return readinessResponse(request, {
      ok: false,
      code: 'HOSTED_DR_CAPABILITY_UNAVAILABLE',
      contractVersion: HOSTED_DR_CONTRACT_VERSION,
    }, 503);
  }
};

/**
 * Pure control-plane decision contract. This function never probes an origin,
 * dispatches a request, retries an operation, or mutates the decision of an
 * already dispatched request.
 */
export const selectHostedDrRuntime = (
  input: HostedDrSelectionInput,
): HostedDrRuntime => {
  if (input.dispatchState !== 'not-dispatched') {
    if (input.requestClass === 'safe-read') {
      return input.primaryHealth === 'unknown' ? 'fail-closed' : 'next-dr';
    }
    if (
      input.requestClass === 'durably-idempotent-command'
      && input.hasDurableIdempotencyProof
      && input.primaryHealth === 'unavailable'
    ) {
      return 'next-dr';
    }
    return 'fail-closed';
  }

  if (input.primaryHealth === 'healthy') {
    return 'hono-primary';
  }
  if (input.primaryHealth === 'unknown') {
    return 'fail-closed';
  }
  if (
    input.requestClass === 'durably-idempotent-command'
    && !input.hasDurableIdempotencyProof
  ) {
    return 'fail-closed';
  }
  return 'next-dr';
};
