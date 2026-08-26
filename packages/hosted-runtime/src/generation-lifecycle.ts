export type HostedGenerationOperation =
  | 'generate-magical-girl-details'
  | 'generate-magical-girl-details-stream'
  | 'generate-sublimation'
  | 'generate-sublimation-stream';

export type HostedGenerationPlacement = 'hono-primary' | 'next-dr';
export type HostedGenerationOutcome = 'success' | 'rejected' | 'failure' | 'cancelled';

export type HostedGenerationLifecycleObservation = {
  event: 'hosted-generation';
  operation: HostedGenerationOperation;
  placement: HostedGenerationPlacement;
  outcome: HostedGenerationOutcome;
  durationMs: number;
};

export type HostedGenerationService = (_request: Request) => Promise<Response>;
export type HostedGenerationLifecycleObserver = (
  _observation: HostedGenerationLifecycleObservation,
) => void;

type ObservedServiceOptions = {
  operation: HostedGenerationOperation;
  placement: HostedGenerationPlacement;
  service: HostedGenerationService;
  observe: HostedGenerationLifecycleObserver;
  now?: () => number;
};

const safelyObserve = (
  observe: HostedGenerationLifecycleObserver,
  observation: HostedGenerationLifecycleObservation,
): void => {
  try {
    observe(observation);
  } catch {
    // Telemetry failures must not affect hosted generation behavior.
  }
};

const outcomeFromResponse = (response: Response, signal: AbortSignal): HostedGenerationOutcome => {
  if (signal.aborted) return 'cancelled';
  if (response.status < 400) return 'success';
  return response.status < 500 ? 'rejected' : 'failure';
};

const isStreamOperation = (operation: HostedGenerationOperation): boolean => (
  operation.endsWith('-stream')
);

const normalizeDuration = (value: number): number => (
  Number.isFinite(value) && value > 0 ? value : 0
);

const instrumentStreamLifecycle = (
  response: Response,
  signal: AbortSignal,
  finish: (_outcome: HostedGenerationOutcome) => void,
): Response => {
  if (!response.body || response.body.locked) {
    finish(outcomeFromResponse(response, signal));
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          finish(signal.aborted ? 'cancelled' : 'success');
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        finish(signal.aborted ? 'cancelled' : 'failure');
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish('cancelled');
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

export const createObservedHostedGenerationService = (
  options: ObservedServiceOptions,
): HostedGenerationService => {
  const now = options.now ?? (() => performance.now());
  return async (request) => {
    const startedAt = now();
    let finished = false;
    const finish = (outcome: HostedGenerationOutcome): void => {
      if (finished) return;
      finished = true;
      safelyObserve(options.observe, {
        event: 'hosted-generation',
        operation: options.operation,
        placement: options.placement,
        outcome,
        durationMs: normalizeDuration(now() - startedAt),
      });
    };
    try {
      const response = await options.service(request);
      if (
        isStreamOperation(options.operation)
        && response.status < 400
        && response.body
      ) {
        return instrumentStreamLifecycle(response, request.signal, finish);
      }
      finish(outcomeFromResponse(response, request.signal));
      return response;
    } catch (error) {
      finish(request.signal.aborted ? 'cancelled' : 'failure');
      throw error;
    }
  };
};

export const createStructuredNextDrLifecycleObserver = (
  logger: (_line: string) => void = (line) => console.info(line),
): HostedGenerationLifecycleObserver => (observation) => {
  logger(JSON.stringify({
    event: 'hosted.generation.lifecycle',
    schemaVersion: 1,
    operation: observation.operation,
    placement: 'next-dr',
    outcome: observation.outcome,
    durationMs: observation.durationMs,
  }));
};
