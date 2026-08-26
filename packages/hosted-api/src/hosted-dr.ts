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
