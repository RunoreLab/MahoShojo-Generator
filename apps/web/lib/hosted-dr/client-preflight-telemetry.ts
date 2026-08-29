import type { HostedPlacementDecision } from './client-preflight';

export const HOSTED_DR_CLIENT_TELEMETRY_EVENT = 'mahoshojo:hosted-dr-client-telemetry';

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
    primaryProbeOutcome: HostedPlacementDecision['primaryProbe']['outcome'];
    primaryProbeDurationMs: number;
    drProbeOutcome: HostedPlacementDecision['primaryProbe']['outcome'] | 'not-run';
    drProbeDurationMs: number | null;
  }>)
  | (HostedDrClientTelemetryCommon & Readonly<{
    phase: 'dispatch-terminal';
    terminalClass:
      | 'response-ok'
      | 'response-error'
      | 'ambiguous'
      | 'cancelled'
      | 'not-dispatched';
  }>);

export type HostedDrClientTelemetryObserver = (
  event: HostedDrClientTelemetryEvent,
) => void;

export const observeHostedDrClientTelemetry: HostedDrClientTelemetryObserver = (event) => {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent(HOSTED_DR_CLIENT_TELEMETRY_EVENT, {
    detail: event,
  }));
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
  primaryProbeOutcome: decision.primaryProbe.outcome,
  primaryProbeDurationMs: decision.primaryProbe.durationMs,
  drProbeOutcome: decision.drProbe?.outcome ?? 'not-run',
  drProbeDurationMs: decision.drProbe?.durationMs ?? null,
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
