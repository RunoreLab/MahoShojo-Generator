import type {
  HostedDrProbeOutcome,
  HostedPlacementDecision,
} from './client-preflight';

export const HOSTED_DR_CLIENT_TELEMETRY_EVENT = 'mahoshojo:hosted-dr-client-telemetry';
const HOSTED_DR_CLIENT_TELEMETRY_ENDPOINT = '/api/telemetry/hosted-dr';

export type HostedDrProbeDurationBucket =
  | 'not-run'
  | '0-49ms'
  | '50-199ms'
  | '200-999ms'
  | '1000-2999ms'
  | '3000ms+';

type HostedDrClientTelemetryCommon = Readonly<{
  schemaVersion: 1;
  contractVersion: string;
  routeFamily: string;
  selectedPlacement: HostedPlacementDecision['placement'];
}>;

export type HostedDrClientTelemetryEvent =
  | (HostedDrClientTelemetryCommon & Readonly<{
    phase: 'selection';
    selectionReason: HostedPlacementDecision['reason'];
    primaryProbeOutcome: HostedDrProbeOutcome | 'not-run';
    primaryProbeDurationBucket: HostedDrProbeDurationBucket;
    drProbeOutcome: HostedDrProbeOutcome | 'not-run';
    drProbeDurationBucket: HostedDrProbeDurationBucket;
  }>)
  | (HostedDrClientTelemetryCommon & Readonly<{
    phase: 'dispatch-terminal';
    terminalClass:
      | 'response-ok'
      | 'response-error'
      | 'ambiguous'
      | 'not-dispatched';
  }>);

export type HostedDrClientTelemetryObserver = (
  event: HostedDrClientTelemetryEvent,
) => void;

const probeDurationBucket = (
  durationMs: number | null,
): HostedDrProbeDurationBucket => {
  if (durationMs === null) return 'not-run';
  if (durationMs < 50) return '0-49ms';
  if (durationMs < 200) return '50-199ms';
  if (durationMs < 1_000) return '200-999ms';
  if (durationMs < 3_000) return '1000-2999ms';
  return '3000ms+';
};

const isProbeFailure = (
  outcome: HostedDrProbeOutcome | 'not-run',
): boolean => outcome !== 'ready' && outcome !== 'not-run';

const shouldSendToServer = (event: HostedDrClientTelemetryEvent): boolean => {
  if (event.phase === 'dispatch-terminal') return event.terminalClass !== 'response-ok';
  if (event.selectedPlacement === 'unavailable') return true;
  return isProbeFailure(event.primaryProbeOutcome) || isProbeFailure(event.drProbeOutcome)
    || Math.random() < 0.1;
};

const sendToServerBestEffort = (event: HostedDrClientTelemetryEvent): void => {
  if (!shouldSendToServer(event)) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  try {
    const body = JSON.stringify(event);
    void fetch(HOSTED_DR_CLIENT_TELEMETRY_ENDPOINT, {
      method: 'POST',
      body,
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      referrerPolicy: 'no-referrer',
    }).catch(() => undefined);
  } catch {
    // Telemetry transport 失败不得改变选择、dispatch 或权威结果。
  }
};

export const observeHostedDrClientTelemetry: HostedDrClientTelemetryObserver = (event) => {
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(HOSTED_DR_CLIENT_TELEMETRY_EVENT, {
        detail: event,
      }));
    } catch {
      // 非标准 window/event 实现不得阻断 best-effort server sink。
    }
  }
  sendToServerBestEffort(event);
};

export const emitHostedDrClientTelemetry = (
  observer: HostedDrClientTelemetryObserver,
  event: HostedDrClientTelemetryEvent,
): void => {
  try {
    observer(Object.freeze(event));
  } catch {
    // 客户端观测失败不得改变选择、dispatch 或权威结果。
  }
};

export const createHostedDrSelectionTelemetry = (
  decision: HostedPlacementDecision,
): HostedDrClientTelemetryEvent => Object.freeze({
  schemaVersion: 1,
  phase: 'selection',
  contractVersion: decision.contractVersion,
  routeFamily: decision.routeFamily,
  selectedPlacement: decision.placement,
  selectionReason: decision.reason,
  primaryProbeOutcome: decision.primaryProbe?.outcome ?? 'not-run',
  primaryProbeDurationBucket: probeDurationBucket(decision.primaryProbe?.durationMs ?? null),
  drProbeOutcome: decision.drProbe?.outcome ?? 'not-run',
  drProbeDurationBucket: probeDurationBucket(decision.drProbe?.durationMs ?? null),
});

export const createHostedDrTerminalTelemetry = (
  decision: HostedPlacementDecision,
  terminalClass: Extract<
    HostedDrClientTelemetryEvent,
    { phase: 'dispatch-terminal' }
  >['terminalClass'],
): HostedDrClientTelemetryEvent => Object.freeze({
  schemaVersion: 1,
  phase: 'dispatch-terminal',
  contractVersion: decision.contractVersion,
  routeFamily: decision.routeFamily,
  selectedPlacement: decision.placement,
  terminalClass,
});
