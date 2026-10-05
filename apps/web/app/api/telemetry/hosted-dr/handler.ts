import type {
  HostedDrClientTelemetryEvent,
  HostedDrProbeDurationBucket,
} from '@/lib/hosted-dr/client-preflight-telemetry';
import type { HostedDrProbeOutcome, HostedDrDecisionReason, HostedDrPlacement } from '@/lib/hosted-dr/client-preflight';
import {
  createHostedDrTelemetryLocalRateLimiter,
  enforceHostedDrTelemetryRateLimit,
  getHostedDrTelemetryRateLimitBindings,
  type HostedDrTelemetryLocalRateLimiter,
  type HostedDrTelemetryRateLimitBindings,
} from '@/lib/hosted-dr/client-telemetry-rate-limit';
import {
  HOSTED_DR_CONTRACT_VERSION,
  isHostedDrContractVersionCompatible,
} from '@mahoshojo/hosted-api/hosted-dr';
import honoApiRoutes from '../../../../../../config/hono-api-routes.json';

const MAX_BODY_BYTES = 8 * 1024;
const MAX_CONTRACT_VERSION_LENGTH = 32;

const routeFamilies = new Set([
  'undeclared',
  ...honoApiRoutes.sharedRouteIds.map((routeId) => `/api/${routeId}`),
]);

const placements: ReadonlySet<HostedDrPlacement> = new Set([
  'hono-primary',
  'next-dr',
  'unavailable',
]);

const decisionReasons: ReadonlySet<HostedDrDecisionReason> = new Set([
  'PRIMARY_ONLY',
  'PRIMARY_READY',
  'DR_READY',
  'OPERATION_NOT_DECLARED',
  'DR_NOT_ELIGIBLE',
  'NO_READY_PLACEMENT',
]);

const probeOutcomes: ReadonlySet<HostedDrProbeOutcome | 'not-run'> = new Set([
  'ready',
  'timeout',
  'not-ready',
  'protocol-error',
  'network-error',
  'not-run',
]);

const probeDurationBuckets: ReadonlySet<HostedDrProbeDurationBucket> = new Set([
  'not-run',
  '0-49ms',
  '50-199ms',
  '200-999ms',
  '1000-2999ms',
  '3000ms+',
]);

const terminalClasses: ReadonlySet<Extract<
  HostedDrClientTelemetryEvent,
  { phase: 'dispatch-terminal' }
>['terminalClass']> = new Set([
  'response-ok',
  'response-error',
  'ambiguous',
  'not-dispatched',
]);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const hasExactKeys = (record: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = [...keys].sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]);
};

const isStringIn = <T extends string>(value: unknown, values: ReadonlySet<T>): value is T => (
  typeof value === 'string' && values.has(value as T)
);

const isCompatibleContractVersion = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length <= MAX_CONTRACT_VERSION_LENGTH
  && isHostedDrContractVersionCompatible(value, HOSTED_DR_CONTRACT_VERSION)
);

const isProbePairValid = (
  outcome: unknown,
  durationBucket: unknown,
): boolean => (
  isStringIn(outcome, probeOutcomes)
  && isStringIn(durationBucket, probeDurationBuckets)
  && ((outcome === 'not-run') === (durationBucket === 'not-run'))
);

const isProbeReady = (
  outcome: unknown,
  durationBucket: unknown,
): boolean => outcome === 'ready' && durationBucket !== 'not-run';

const isProbeNotReady = (
  outcome: unknown,
  durationBucket: unknown,
): boolean => outcome !== 'ready' && outcome !== 'not-run' && durationBucket !== 'not-run';

const isProbeNotRun = (
  outcome: unknown,
  durationBucket: unknown,
): boolean => outcome === 'not-run' && durationBucket === 'not-run';

const isSelectionCombinationValid = (value: Record<string, unknown>): boolean => {
  const primaryReady = isProbeReady(value.primaryProbeOutcome, value.primaryProbeDurationBucket);
  const primaryNotReady = isProbeNotReady(value.primaryProbeOutcome, value.primaryProbeDurationBucket);
  const primaryNotRun = isProbeNotRun(value.primaryProbeOutcome, value.primaryProbeDurationBucket);
  const drReady = isProbeReady(value.drProbeOutcome, value.drProbeDurationBucket);
  const drNotReady = isProbeNotReady(value.drProbeOutcome, value.drProbeDurationBucket);
  const drNotRun = isProbeNotRun(value.drProbeOutcome, value.drProbeDurationBucket);

  switch (value.selectionReason) {
    case 'PRIMARY_ONLY':
      return value.selectedPlacement === 'hono-primary' && primaryNotRun && drNotRun;
    case 'PRIMARY_READY':
      return value.selectedPlacement === 'hono-primary' && primaryReady && drNotRun;
    case 'DR_READY':
      return value.selectedPlacement === 'next-dr' && primaryNotReady && drReady;
    case 'OPERATION_NOT_DECLARED':
      // Older clients probed primary before discovering an undeclared operation.
      return value.selectedPlacement === 'unavailable'
        && (primaryNotRun || primaryNotReady)
        && drNotRun;
    case 'DR_NOT_ELIGIBLE':
      // Preserve the pre-9531beaa event shape for clients that still emit it.
      return value.selectedPlacement === 'unavailable' && primaryNotReady && drNotRun;
    case 'NO_READY_PLACEMENT':
      return value.selectedPlacement === 'unavailable' && primaryNotReady && drNotReady;
    default:
      return false;
  }
};

const parseTelemetryEvent = (value: unknown): HostedDrClientTelemetryEvent | null => {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || !isCompatibleContractVersion(value.contractVersion)
    || !isStringIn(value.routeFamily, routeFamilies)
    || !isStringIn(value.selectedPlacement, placements)
    || typeof value.phase !== 'string') {
    return null;
  }

  if (value.phase === 'selection') {
    const validKeys = [
      'schemaVersion',
      'phase',
      'contractVersion',
      'routeFamily',
      'selectedPlacement',
      'selectionReason',
      'primaryProbeOutcome',
      'primaryProbeDurationBucket',
      'drProbeOutcome',
      'drProbeDurationBucket',
    ] as const;
    if (!hasExactKeys(value, validKeys)
      || !isStringIn(value.selectionReason, decisionReasons)
      || !isProbePairValid(value.primaryProbeOutcome, value.primaryProbeDurationBucket)
      || !isProbePairValid(value.drProbeOutcome, value.drProbeDurationBucket)
      || !isSelectionCombinationValid(value)) {
      return null;
    }
    return value as unknown as HostedDrClientTelemetryEvent;
  }

  if (value.phase === 'dispatch-terminal') {
    const validKeys = [
      'schemaVersion',
      'phase',
      'contractVersion',
      'routeFamily',
      'selectedPlacement',
      'terminalClass',
    ] as const;
    if (!hasExactKeys(value, validKeys) || !isStringIn(value.terminalClass, terminalClasses)) {
      return null;
    }
    return value as unknown as HostedDrClientTelemetryEvent;
  }

  return null;
};

const responseHeaders = (extra: Record<string, string> = {}): Headers => new Headers({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  ...extra,
});

const errorResponse = (status: number, code: string, extra: Record<string, string> = {}) => new Response(
  JSON.stringify({ ok: false, code }),
  { status, headers: responseHeaders({ 'Content-Type': 'application/json', ...extra }) },
);

type BodyReadResult =
  | { kind: 'ok'; body: ArrayBuffer }
  | { kind: 'too-large' }
  | { kind: 'read-error' };

const readBodyWithinLimit = async (request: Request): Promise<BodyReadResult> => {
  if (!request.body) return { kind: 'ok', body: new ArrayBuffer(0) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // body 已经超限，清理失败不改变拒绝结果。
        }
        return { kind: 'too-large' };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: 'read-error' };
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'ok', body: body.buffer };
};

export type HostedDrTelemetryHandlerDependencies = Readonly<{
  getRateLimitBindings?: () => HostedDrTelemetryRateLimitBindings | null;
  localRateLimiter?: HostedDrTelemetryLocalRateLimiter;
  now?: () => number;
}>;

export const createHostedDrTelemetryHandler = ({
  getRateLimitBindings = getHostedDrTelemetryRateLimitBindings,
  localRateLimiter = createHostedDrTelemetryLocalRateLimiter(),
  now = Date.now,
}: HostedDrTelemetryHandlerDependencies = {}) => async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return errorResponse(405, 'METHOD_NOT_ALLOWED', { Allow: 'POST' });
  }

  const rateLimit = await enforceHostedDrTelemetryRateLimit({
    request,
    bindings: getRateLimitBindings(),
    localLimiter: localRateLimiter,
    now: now(),
  });
  if (!rateLimit.allowed) {
    return errorResponse(429, 'TELEMETRY_RATE_LIMITED', { 'Retry-After': '60' });
  }

  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    return errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE');
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
      return errorResponse(413, 'TELEMETRY_BODY_TOO_LARGE');
    }
  }

  const bodyResult = await readBodyWithinLimit(request);
  if (bodyResult.kind === 'too-large') return errorResponse(413, 'TELEMETRY_BODY_TOO_LARGE');
  if (bodyResult.kind === 'read-error') return errorResponse(400, 'INVALID_TELEMETRY_BODY');

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bodyResult.body));
  } catch {
    return errorResponse(400, 'INVALID_TELEMETRY_EVENT');
  }
  const event = parseTelemetryEvent(parsed);
  if (!event) return errorResponse(400, 'INVALID_TELEMETRY_EVENT');

  console.info(JSON.stringify({ event: 'hosted.dr.client.telemetry', ...event }));
  return new Response(null, { status: 204, headers: responseHeaders() });
};

export const appRouteHandler = createHostedDrTelemetryHandler();

export default appRouteHandler;
