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

export const isGenerationApiClientErrorCode = (
  error: unknown,
  code: GenerationApiClientErrorCode,
): boolean => {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === 'GenerationApiClientError' && candidate.code === code;
};

type GenerationFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type GenerationApiAuth = Readonly<{
  getAuthHeader: () => Promise<string | null>;
  getActivityHeaders: () => Promise<Record<string, string>>;
}>;

export type GenerationApiIntentDependencies = {
  auth?: GenerationApiAuth;
  fetcher?: GenerationFetch;
  observe?: HostedDrClientTelemetryObserver;
  selectPlacement?: typeof selectHostedDrPlacement;
  onSettled?: () => void;
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
  ambiguousServerOutcome = true,
): 'response-ok' | 'response-error' | 'ambiguous' => {
  if (response.status >= 500) {
    return ambiguousServerOutcome ? 'ambiguous' : 'response-error';
  }
  return response.ok ? 'response-ok' : 'response-error';
};

const isPotentiallyMutatingMethod = (method: string): boolean => (
  method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
);

const wrapAmbiguousBodyErrors = (
  response: Response,
  decision: HostedPlacementDecision | null,
  observe: HostedDrClientTelemetryObserver,
  settle: () => void,
  ambiguousServerOutcome: boolean,
): Response => {
  if (!response.body) {
    if (decision) {
      emitHostedDrClientTelemetry(
        observe,
        createHostedDrTerminalTelemetry(
          decision,
          responseTerminalClass(response, ambiguousServerOutcome),
        ),
      );
    }
    settle();
    return response;
  }
  const reader = response.body.getReader();
  const isSse = response.headers.get('content-type')
    ?.toLowerCase()
    .includes('text/event-stream') === true;
  const sseDecoder = isSse ? new TextDecoder() : null;
  let sseTerminalBuffer = '';
  let terminalObserved = false;
  const observeTerminal = (
    terminalClass: Parameters<typeof createHostedDrTerminalTelemetry>[1],
  ) => {
    if (terminalObserved) return;
    terminalObserved = true;
    if (decision) {
      emitHostedDrClientTelemetry(
        observe,
        createHostedDrTerminalTelemetry(decision, terminalClass),
      );
    }
    settle();
  };
  const inspectSseTerminal = (
    chunk?: Uint8Array,
    flush = false,
  ): 'response-ok' | 'response-error' | null => {
    if (!sseDecoder) return null;
    sseTerminalBuffer += chunk
      ? sseDecoder.decode(chunk, { stream: true })
      : sseDecoder.decode();
    sseTerminalBuffer = sseTerminalBuffer.replace(/\r\n?/gu, '\n');
    let separatorIndex = sseTerminalBuffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const block = sseTerminalBuffer.slice(0, separatorIndex);
      sseTerminalBuffer = sseTerminalBuffer.slice(separatorIndex + 2);
      const event = block
        .split('\n')
        .find((line) => line.startsWith('event:'))
        ?.slice('event:'.length)
        .trim();
      if (event === 'done') return 'response-ok';
      if (event === 'error') return 'response-error';
      separatorIndex = sseTerminalBuffer.indexOf('\n\n');
    }
    if (flush && sseTerminalBuffer.trim()) {
      const event = sseTerminalBuffer
        .split('\n')
        .find((line) => line.startsWith('event:'))
        ?.slice('event:'.length)
        .trim();
      sseTerminalBuffer = '';
      if (event === 'done') return 'response-ok';
      if (event === 'error') return 'response-error';
    }
    if (sseTerminalBuffer.length > 65_536) {
      sseTerminalBuffer = sseTerminalBuffer.slice(-1024);
    }
    return null;
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          const sseTerminal = inspectSseTerminal(undefined, true);
          if (sseTerminal) observeTerminal(sseTerminal);
          if (isSse && !terminalObserved) {
            observeTerminal('ambiguous');
            controller.error(ambiguousOutcomeError(decision));
            return;
          }
          if (!isSse) {
            observeTerminal(responseTerminalClass(response, ambiguousServerOutcome));
          }
          controller.close();
        } else {
          const sseTerminal = inspectSseTerminal(chunk.value);
          if (sseTerminal) observeTerminal(sseTerminal);
          controller.enqueue(chunk.value);
        }
      } catch {
        observeTerminal('ambiguous');
        controller.error(ambiguousOutcomeError(decision));
      }
    },
    async cancel(reason) {
      const hadExplicitTerminal = terminalObserved;
      if (!hadExplicitTerminal) observeTerminal('ambiguous');
      try {
        await reader.cancel(reason);
      } catch {
        // dispatch 后的取消结果始终按 ambiguous 投影，不泄漏底层 stream 错误。
      }
      if (!hadExplicitTerminal) throw ambiguousOutcomeError(decision);
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
  onSettled,
}: GenerationApiIntentDependencies = {}): GenerationApiIntent => {
  let consumed = false;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    try {
      onSettled?.();
    } catch {
      // lifecycle observer 不得改变客户端权威结果。
    }
  };

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
      const operationMethod = (init.method ?? 'GET').trim().toUpperCase();
      const ambiguousServerOutcome = isPotentiallyMutatingMethod(operationMethod);

      let target = resolveGenerationApiUrl(input);
      let decision: HostedPlacementDecision | null = null;
      if (honoApiConfig.routingMode === 'client-preflight' && isHonoApiPath(input)) {
        try {
          decision = await selectPlacement({
            path: input,
            method: operationMethod,
            fetcher,
          });
        } catch (error) {
          settle();
          throw error;
        }
        emitHostedDrClientTelemetry(observe, createHostedDrSelectionTelemetry(decision));
        if (decision.placement === 'unavailable') {
          emitHostedDrClientTelemetry(
            observe,
            createHostedDrTerminalTelemetry(decision, 'not-dispatched'),
          );
          settle();
          throw unavailableError(decision);
        }
        target = decision.placement === 'hono-primary'
          ? `${honoApiConfig.origin.replace(/\/+$/u, '')}${input}`
          : input;
      }

      const headers = new Headers(init.headers ?? {});
      try {
        const authHeader = await auth.getAuthHeader();
        if (authHeader && !headers.has('Authorization')) {
          headers.set('Authorization', authHeader);
        }

        const activityHeaders = await auth.getActivityHeaders();
        for (const [name, value] of Object.entries(activityHeaders)) {
          if (!headers.has(name)) headers.set(name, value);
        }
      } catch (error) {
        settle();
        throw error;
      }

      let response: Response;
      try {
        response = await fetcher(target, {
          ...init,
          headers,
          credentials: target === input ? (init.credentials ?? 'same-origin') : 'omit',
        });
      } catch {
        if (decision) {
          emitHostedDrClientTelemetry(
            observe,
            createHostedDrTerminalTelemetry(decision, 'ambiguous'),
          );
        }
        settle();
        throw ambiguousOutcomeError(decision);
      }

      if (ambiguousServerOutcome && response.status >= 500) {
        if (decision) {
          emitHostedDrClientTelemetry(
            observe,
            createHostedDrTerminalTelemetry(decision, 'ambiguous'),
          );
        }
        try {
          await response.body?.cancel();
        } catch {
          // 业务请求已经 dispatch；清理响应体失败不得覆盖 ambiguous 结果。
        }
        settle();
        throw ambiguousOutcomeError(decision);
      }

      return wrapAmbiguousBodyErrors(
        response,
        decision,
        observe,
        settle,
        ambiguousServerOutcome,
      );
    },
  });
};

export type GenerationApiIntentLatch = Readonly<{
  tryAcquire: () => GenerationApiIntent | null;
}>;

export const createGenerationApiIntentLatch = (
  dependencies: GenerationApiIntentDependencies = {},
): GenerationApiIntentLatch => {
  let activeIntent: GenerationApiIntent | null = null;
  return Object.freeze({
    tryAcquire() {
      if (activeIntent) return null;
      const intent = createGenerationApiIntent({
        ...dependencies,
        onSettled: () => {
          if (activeIntent === intent) activeIntent = null;
          dependencies.onSettled?.();
        },
      });
      activeIntent = intent;
      return intent;
    },
  });
};
