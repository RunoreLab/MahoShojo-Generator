export type HostedDrRequestClass =
  | 'safe-read'
  | 'durably-idempotent-command'
  | 'non-idempotent-operation';

export type HostedDrDispatchState = 'not-dispatched' | 'dispatched' | 'unknown';

export type HostedDrPrimaryHealth = 'healthy' | 'unavailable' | 'unknown';

export type HostedDrRuntime = 'hono-primary' | 'next-dr' | 'fail-closed';

export type HostedDrSelectionInput = {
  requestClass: HostedDrRequestClass;
  dispatchState: HostedDrDispatchState;
  primaryHealth: HostedDrPrimaryHealth;
  hasDurableIdempotencyProof: boolean;
};

export const HOSTED_DR_CONTRACT_VERSION = 'g25e1-v1' as const;
export const HOSTED_DR_READINESS_SQL = 'SELECT 1 AS ok' as const;

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
