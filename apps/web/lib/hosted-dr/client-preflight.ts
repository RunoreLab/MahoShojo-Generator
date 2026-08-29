import {
  hostedDrClientOperations,
  hostedDrClientRouting,
} from '@/config/hosted-dr-client.generated';
import { isHostedDrContractVersionCompatible } from '@mahoshojo/hosted-api/hosted-dr';
import {
  HOSTED_DR_CAPABILITY_HEADER,
  HOSTED_DR_OPERATION_METHOD_HEADER,
} from '@/lib/hosted-dr/probe-contract';

export type HostedDrClientOperation = (typeof hostedDrClientOperations)[number];
export type HostedDrClientRouting = Readonly<{
  primaryOrigin: string;
  drOrigin: string;
  primaryProbePath: string;
  drProbePath: string;
  preflightTimeoutMs: number;
  contractVersion: string;
}>;
export type HostedDrPlacement = 'hono-primary' | 'next-dr' | 'unavailable';
export type HostedDrProbeOutcome =
  | 'ready'
  | 'timeout'
  | 'not-ready'
  | 'protocol-error'
  | 'network-error';
export type HostedDrProbeReason =
  | 'PRIMARY_READY'
  | 'PRIMARY_PROBE_TIMEOUT'
  | 'PRIMARY_NOT_READY'
  | 'PRIMARY_PROBE_PROTOCOL_ERROR'
  | 'DR_READY'
  | 'DR_PROBE_TIMEOUT'
  | 'DR_NOT_READY'
  | 'DR_PROBE_PROTOCOL_ERROR';
export type HostedDrDecisionReason =
  | 'PRIMARY_READY'
  | 'DR_READY'
  | 'OPERATION_NOT_DECLARED'
  | 'DR_NOT_ELIGIBLE'
  | 'NO_READY_PLACEMENT';

export type HostedDrProbeResult = Readonly<{
  outcome: HostedDrProbeOutcome;
  reason: HostedDrProbeReason;
  durationMs: number;
}>;

export type HostedPlacementDecision = Readonly<{
  placement: HostedDrPlacement;
  reason: HostedDrDecisionReason;
  contractVersion: string;
  routeFamily: string;
  primaryProbe: HostedDrProbeResult;
  drProbe: HostedDrProbeResult | null;
}>;

type HostedDrFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type SelectHostedDrPlacementInput = {
  path: string;
  method: string;
  fetcher?: HostedDrFetch;
  timeoutMs?: number;
  now?: () => number;
  routing?: HostedDrClientRouting;
};

type ProbeInput = {
  fetcher: HostedDrFetch;
  url: string;
  timeoutMs: number;
  expectedPlacement: Exclude<HostedDrPlacement, 'unavailable'>;
  contractVersion: string;
  now: () => number;
  operation?: HostedDrClientOperation;
};

const escapeRegExp = (value: string): string => (
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
);

const routeMatchers = hostedDrClientOperations.map((operation) => ({
  operation,
  pattern: new RegExp(`^${operation.route
    .split('/')
    .map((segment) => (/^\[[^\]]+\]$/u.test(segment) ? '[^/]+' : escapeRegExp(segment)))
    .join('/')}/?$`, 'u'),
}));

const pathnameOf = (input: string): string => input.split(/[?#]/u, 1)[0] ?? input;

export const lookupHostedDrClientOperation = (
  path: string,
  method: string,
): HostedDrClientOperation | null => {
  const pathname = pathnameOf(path);
  const normalizedMethod = method.trim().toUpperCase();
  return routeMatchers.find(({ operation, pattern }) => (
    operation.method === normalizedMethod && pattern.test(pathname)
  ))?.operation ?? null;
};

export const isHostedDrOperationEligible = (
  operation: HostedDrClientOperation,
): boolean => (
  operation.contractStatus === 'verified'
  && (
    (
      operation.requestClass === 'safe-read'
      && operation.drMode === 'safe-read'
      && operation.replayPolicy === 'safe-read-only'
    )
    || (
      operation.requestClass === 'non-idempotent-operation'
      && operation.drMode === 'new-request-only'
      && operation.replayPolicy === 'never-after-dispatch'
    )
  )
);

const hasNoStore = (response: Response): boolean => (
  response.headers.get('cache-control')
    ?.split(',')
    .some((directive) => directive.trim().toLowerCase() === 'no-store') === true
);

const freezeProbe = (
  outcome: HostedDrProbeOutcome,
  reason: HostedDrProbeReason,
  durationMs: number,
): HostedDrProbeResult => Object.freeze({
  outcome,
  reason,
  durationMs: Math.max(0, durationMs),
});

const probeOnce = async ({
  fetcher,
  url,
  timeoutMs,
  expectedPlacement,
  contractVersion,
  now,
  operation,
}: ProbeInput): Promise<HostedDrProbeResult> => {
  const startedAt = now();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const isPrimary = expectedPlacement === 'hono-primary';

  try {
    const response = await fetcher(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
      ...(operation ? {
        headers: {
          [HOSTED_DR_CAPABILITY_HEADER]: operation.route.slice('/api/'.length),
          [HOSTED_DR_OPERATION_METHOD_HEADER]: operation.method,
        },
      } : {}),
    });
    const durationMs = now() - startedAt;
    if (!response.ok) {
      return freezeProbe(
        'not-ready',
        isPrimary ? 'PRIMARY_NOT_READY' : 'DR_NOT_READY',
        durationMs,
      );
    }
    if (!hasNoStore(response)) {
      return freezeProbe(
        'protocol-error',
        isPrimary ? 'PRIMARY_PROBE_PROTOCOL_ERROR' : 'DR_PROBE_PROTOCOL_ERROR',
        durationMs,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return freezeProbe(
        'protocol-error',
        isPrimary ? 'PRIMARY_PROBE_PROTOCOL_ERROR' : 'DR_PROBE_PROTOCOL_ERROR',
        now() - startedAt,
      );
    }
    const record = typeof body === 'object' && body !== null && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
    const valid = record?.ok === true
      && record.placement === expectedPlacement
      && typeof record.contractVersion === 'string'
      && isHostedDrContractVersionCompatible(record.contractVersion, contractVersion)
      && (!isPrimary || record.service === 'mahoshojo-hono')
      && (!operation || (
        record.capabilityId === operation.route.slice('/api/'.length)
        && record.operationMethod === operation.method
      ));
    return valid
      ? freezeProbe('ready', isPrimary ? 'PRIMARY_READY' : 'DR_READY', now() - startedAt)
      : freezeProbe(
        'protocol-error',
        isPrimary ? 'PRIMARY_PROBE_PROTOCOL_ERROR' : 'DR_PROBE_PROTOCOL_ERROR',
        now() - startedAt,
      );
  } catch {
    return freezeProbe(
      timedOut ? 'timeout' : 'network-error',
      timedOut
        ? (isPrimary ? 'PRIMARY_PROBE_TIMEOUT' : 'DR_PROBE_TIMEOUT')
        : (isPrimary ? 'PRIMARY_NOT_READY' : 'DR_NOT_READY'),
      now() - startedAt,
    );
  } finally {
    clearTimeout(timeout);
  }
};

const freezeDecision = (
  placement: HostedDrPlacement,
  reason: HostedDrDecisionReason,
  contractVersion: string,
  routeFamily: string,
  primaryProbe: HostedDrProbeResult,
  drProbe: HostedDrProbeResult | null,
): HostedPlacementDecision => Object.freeze({
  placement,
  reason,
  contractVersion,
  routeFamily,
  primaryProbe,
  drProbe,
});

export const selectHostedDrPlacement = async ({
  path,
  method,
  fetcher = fetch,
  routing = hostedDrClientRouting,
  timeoutMs = routing.preflightTimeoutMs,
  now = () => performance.now(),
}: SelectHostedDrPlacementInput): Promise<HostedPlacementDecision> => {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 3000) {
    throw new TypeError('Hosted DR preflight timeout 必须在 500..3000ms');
  }
  const operation = lookupHostedDrClientOperation(path, method);
  const routeFamily = operation?.route ?? 'undeclared';
  const primaryProbe = await probeOnce({
    fetcher,
    url: `${routing.primaryOrigin}${routing.primaryProbePath}`,
    timeoutMs,
    expectedPlacement: 'hono-primary',
    contractVersion: routing.contractVersion,
    now,
  });
  if (primaryProbe.outcome === 'ready') {
    return freezeDecision(
      'hono-primary',
      'PRIMARY_READY',
      routing.contractVersion,
      routeFamily,
      primaryProbe,
      null,
    );
  }
  if (!operation) {
    return freezeDecision(
      'unavailable',
      'OPERATION_NOT_DECLARED',
      routing.contractVersion,
      routeFamily,
      primaryProbe,
      null,
    );
  }
  if (!isHostedDrOperationEligible(operation)) {
    return freezeDecision(
      'unavailable',
      'DR_NOT_ELIGIBLE',
      routing.contractVersion,
      routeFamily,
      primaryProbe,
      null,
    );
  }

  const drProbe = await probeOnce({
    fetcher,
    url: `${routing.drOrigin}${routing.drProbePath}`,
    timeoutMs,
    expectedPlacement: 'next-dr',
    contractVersion: routing.contractVersion,
    now,
    operation,
  });
  return drProbe.outcome === 'ready'
    ? freezeDecision(
      'next-dr',
      'DR_READY',
      routing.contractVersion,
      routeFamily,
      primaryProbe,
      drProbe,
    )
    : freezeDecision(
      'unavailable',
      'NO_READY_PLACEMENT',
      routing.contractVersion,
      routeFamily,
      primaryProbe,
      drProbe,
    );
};
