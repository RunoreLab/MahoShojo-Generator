import { authStorage } from '@/lib/auth';
import { INFRASTRUCTURE_ERROR_MESSAGES } from '@/lib/client/apiError';
import { honoApiConfig } from '@/config/hono-api';
import {
  isHonoApiPath,
  resolveGenerationApiUrl,
} from '@/lib/hono-api-routing';
import {
  selectHostedDrPlacement,
  type HostedDrDecisionReason,
  type HostedPlacementDecision,
} from '@/lib/hosted-dr/client-preflight';
import {
  createHostedDrSelectionTelemetry,
  createHostedDrTerminalTelemetry,
  emitHostedDrClientTelemetry,
  observeHostedDrClientTelemetry,
  type HostedDrClientTelemetryObserver,
} from '@/lib/hosted-dr/client-preflight-telemetry';

export { isHonoApiEnabled, isHonoApiPath, resolveGenerationApiUrl } from '@/lib/hono-api-routing';

export type GenerationApiClientErrorCode =
  | Extract<
    HostedDrDecisionReason,
    'OPERATION_NOT_DECLARED' | 'DR_NOT_ELIGIBLE' | 'NO_READY_PLACEMENT'
  >
  | 'AMBIGUOUS_OPERATION_OUTCOME'
  | 'GENERATION_INTENT_ALREADY_DISPATCHED';

export class GenerationApiClientError extends Error {
  readonly code: GenerationApiClientErrorCode;
  readonly decision: HostedPlacementDecision | null;

  constructor(
    code: GenerationApiClientErrorCode,
    message: string,
    decision: HostedPlacementDecision | null = null,
  ) {
    super(message);
    this.name = 'GenerationApiClientError';
    this.code = code;
    this.decision = decision;
  }
}

type GenerationFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type GenerationApiAuth = Readonly<{
  getAuthHeader: () => Promise<string | null>;
  getActivityHeaders: () => Promise<Record<string, string>>;
}>;

type GenerationApiIntentDependencies = {
  auth?: GenerationApiAuth;
  fetcher?: GenerationFetch;
  observe?: HostedDrClientTelemetryObserver;
  selectPlacement?: typeof selectHostedDrPlacement;
};

export type GenerationApiIntent = Readonly<{
  dispatch: (input: string, init?: RequestInit) => Promise<Response>;
}>;

const unavailableError = (
  decision: HostedPlacementDecision,
): GenerationApiClientError => {
  if (decision.reason === 'DR_NOT_ELIGIBLE') {
    return new GenerationApiClientError(
      decision.reason,
      INFRASTRUCTURE_ERROR_MESSAGES.DR_NOT_ELIGIBLE,
      decision,
    );
  }
  if (decision.reason === 'OPERATION_NOT_DECLARED') {
    return new GenerationApiClientError(
      decision.reason,
      INFRASTRUCTURE_ERROR_MESSAGES.OPERATION_NOT_DECLARED,
      decision,
    );
  }
  return new GenerationApiClientError(
    'NO_READY_PLACEMENT',
    INFRASTRUCTURE_ERROR_MESSAGES.NO_READY_PLACEMENT,
    decision,
  );
};

const ambiguousOutcomeError = (
  decision: HostedPlacementDecision | null,
): GenerationApiClientError => new GenerationApiClientError(
  'AMBIGUOUS_OPERATION_OUTCOME',
  INFRASTRUCTURE_ERROR_MESSAGES.AMBIGUOUS_OPERATION_OUTCOME,
  decision,
);

const responseTerminalClass = (
  response: Response,
): 'response-ok' | 'response-error' | 'ambiguous' => {
  if (response.status >= 500) return 'ambiguous';
  return response.ok ? 'response-ok' : 'response-error';
};

const wrapAmbiguousBodyErrors = (
  response: Response,
  decision: HostedPlacementDecision | null,
  observe: HostedDrClientTelemetryObserver,
): Response => {
  if (!response.body || !decision) {
    if (decision) {
      emitHostedDrClientTelemetry(
        observe,
        createHostedDrTerminalTelemetry(
          decision,
          responseTerminalClass(response),
        ),
      );
    }
    return response;
  }
  const reader = response.body.getReader();
  let terminalObserved = false;
  const observeTerminal = (
    terminalClass: Parameters<typeof createHostedDrTerminalTelemetry>[1],
  ) => {
    if (terminalObserved) return;
    terminalObserved = true;
    emitHostedDrClientTelemetry(
      observe,
      createHostedDrTerminalTelemetry(decision, terminalClass),
    );
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          observeTerminal(responseTerminalClass(response));
          controller.close();
        } else controller.enqueue(chunk.value);
      } catch {
        observeTerminal('ambiguous');
        controller.error(ambiguousOutcomeError(decision));
      }
    },
    cancel(reason) {
      observeTerminal('cancelled');
      return reader.cancel(reason);
    },
  });
  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
};

export const createGenerationApiIntent = ({
  auth = authStorage,
  fetcher = fetch,
  observe = observeHostedDrClientTelemetry,
  selectPlacement = selectHostedDrPlacement,
}: GenerationApiIntentDependencies = {}): GenerationApiIntent => {
  let consumed = false;

  return Object.freeze({
    async dispatch(
      input: string,
      init: RequestInit = {},
    ): Promise<Response> {
      if (consumed) {
        throw new GenerationApiClientError(
          'GENERATION_INTENT_ALREADY_DISPATCHED',
          INFRASTRUCTURE_ERROR_MESSAGES.GENERATION_INTENT_ALREADY_DISPATCHED,
        );
      }
      consumed = true;

      let target = resolveGenerationApiUrl(input);
      let decision: HostedPlacementDecision | null = null;
      if (honoApiConfig.routingMode === 'client-preflight' && isHonoApiPath(input)) {
        decision = await selectPlacement({
          path: input,
          method: init.method ?? 'GET',
          fetcher,
        });
        emitHostedDrClientTelemetry(observe, createHostedDrSelectionTelemetry(decision));
        if (decision.placement === 'unavailable') {
          emitHostedDrClientTelemetry(
            observe,
            createHostedDrTerminalTelemetry(decision, 'not-dispatched'),
          );
          throw unavailableError(decision);
        }
        target = decision.placement === 'hono-primary'
          ? `${honoApiConfig.origin.replace(/\/+$/u, '')}${input}`
          : input;
      }

      const headers = new Headers(init.headers ?? {});
      const authHeader = await auth.getAuthHeader();
      if (authHeader && !headers.has('Authorization')) {
        headers.set('Authorization', authHeader);
      }

      const activityHeaders = await auth.getActivityHeaders();
      for (const [name, value] of Object.entries(activityHeaders)) {
        if (!headers.has(name)) headers.set(name, value);
      }

      try {
        const response = await fetcher(target, {
          ...init,
          headers,
          credentials: target === input ? (init.credentials ?? 'same-origin') : 'omit',
        });
        return wrapAmbiguousBodyErrors(response, decision, observe);
      } catch {
        if (decision) {
          emitHostedDrClientTelemetry(
            observe,
            createHostedDrTerminalTelemetry(decision, 'ambiguous'),
          );
        }
        throw ambiguousOutcomeError(decision);
      }
    },
  });
};

export const generationApiFetch = async (
  input: string,
  init: RequestInit = {},
): Promise<Response> => createGenerationApiIntent().dispatch(input, init);
