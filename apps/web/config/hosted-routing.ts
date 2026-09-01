import routing from '../../../config/hosted-routing.json';

export type HostedDrOperationSafety =
  | 'safe-read'
  | 'new-non-idempotent'
  | 'durably-idempotent';

export type HostedDrClientOperation = Readonly<{
  route: string;
  method: string;
  safety: HostedDrOperationSafety;
}>;

export const hostedDrStableOrigin = routing.origins.stable;
export const hostedDrPreviewOrigin = routing.origins.preview;

export const hostedDrClientRouting = Object.freeze({
  primaryOrigin: routing.origins.primary,
  drOrigin: routing.origins.dr,
  primaryProbePath: routing.probes.primaryPath,
  drProbePath: routing.probes.drPath,
  preflightTimeoutMs: routing.probes.preflightTimeoutMs,
  contractVersion: routing.contractVersion,
});

export const hostedDrClientOperations = Object.freeze(
  routing.operations.map((operation) => Object.freeze({
    route: operation.route,
    method: operation.method,
    safety: operation.safety as HostedDrOperationSafety,
  })),
) as readonly HostedDrClientOperation[];
