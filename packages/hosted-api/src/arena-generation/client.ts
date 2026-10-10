import { parseGenerationSseBlock } from './sse';

export type GenerationApiRoutePin = Readonly<{ placement: 'hono-primary' | 'next-dr' }>;

export const isGenerationApiRoutePin = (value: unknown): value is GenerationApiRoutePin => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).length !== 1 || !Object.prototype.hasOwnProperty.call(value, 'placement')) return false;
  const placement = (value as { placement?: unknown }).placement;
  return placement === 'hono-primary' || placement === 'next-dr';
};

const GENERATION_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;

const isGenerationIdentifier = (value: unknown): value is string => (
  typeof value === 'string' && GENERATION_IDENTIFIER_PATTERN.test(value)
);

export type ArenaGenerationConnectionState =
  | 'connecting'
  | 'generating'
  | 'recovering_initial'
  | 'reconnecting'
  | 'resuming'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'cancel_unconfirmed'
  | 'producer_lost'
  | 'interrupted'
  | 'unknown';

const ARENA_GENERATION_RECOVERY_STATES: readonly ArenaGenerationConnectionState[] = [
  'recovering_initial',
  'reconnecting',
  'resuming',
];

export const isArenaGenerationRecoveryState = (
  state: ArenaGenerationConnectionState | null | undefined,
): boolean => Boolean(state && ARENA_GENERATION_RECOVERY_STATES.includes(state));

export const arenaGenerationConnectionNotice = (
  state: ArenaGenerationConnectionState,
): string | null => {
  if (state === 'reconnecting') {
    return '网络连接暂时中断，战报仍在服务器生成，正在恢复连接。';
  }
  if (state === 'resuming' || state === 'recovering_initial') {
    return '正在恢复上一场战报生成。';
  }
  if (state === 'producer_lost') return '生成进程已丢失，无法安全自动重试。';
  if (state === 'cancelling') return '正在请求服务器停止生成，请稍候。';
  if (state === 'cancelled') {
    return '服务器已接受停止请求。当前预览可能不完整，但可继续查看。';
  }
  if (state === 'cancel_unconfirmed') {
    return '未能确认服务器已收到停止请求；生成可能仍在后台继续，请稍后检查。';
  }
  if (state === 'interrupted') {
    return '战报连接恢复次数已耗尽；已接收正文会保留，但保存与恢复状态暂时无法确认。';
  }
  return null;
};

export const mergeArenaGenerationSnapshotMarkdown = (
  deliveredMarkdown: string,
  snapshotMarkdown: string,
): string => snapshotMarkdown || deliveredMarkdown;

export type PersistedArenaGeneration = {
  version: 1 | 2 | 3;
  generationRequestId: string;
  generationId: string | null;
  lastEventId: string | null;
  state: ArenaGenerationConnectionState;
  updatedAt: string;
  endpoint?: string;
  bodyHash?: string;
  routePin?: GenerationApiRoutePin | null;
};

/** Public generation metadata only. Transport owns authentication and request bodies. */
export type ArenaGenerationClientOptions = {
  endpoint: string;
  bodyHash: string;
  signal?: AbortSignal;
  generationRequestId?: string;
  maxReconnectAttempts?: number;
  baseReconnectDelayMs?: number;
  cancelConfirmationTimeoutMs?: number;
  random?: () => number;
  now?: () => Date;
  getInitialRoutePin?(): GenerationApiRoutePin | null;
  onStateChange?(_state: ArenaGenerationConnectionState): void;
};

type RequestOperation = { generationRequestId: string; signal?: AbortSignal };
type ReadOperation = { signal?: AbortSignal; routePin?: GenerationApiRoutePin };
export interface ArenaGenerationClientPorts {
  loadState(): PersistedArenaGeneration | null;
  saveState(_value: PersistedArenaGeneration): void;
  createRequestId(): string;
  encodeUtf8(_value: string): Uint8Array;
  waitForReconnectOpportunity(_milliseconds: number, _signal?: AbortSignal): Promise<void>;
  isInitialCreateOutcomeAmbiguous(_error: unknown): boolean;
  classifyExplicitAbort(_reason: unknown): 'user' | 'content_policy' | null;
  /** Called at the original pre-dispatch point; any headers/body remain host-private. */
  prepareCreate(_generationRequestId: string): void;
  /** The host may consume opaque response metadata; the core never reads actor credentials. */
  observeResponse(_response: Response): void;
  transport: {
    create(_input: RequestOperation & { onRoutePinSelected(_pin: GenerationApiRoutePin): void }): Promise<Response>;
    lookup(_input: RequestOperation & ReadOperation): Promise<Response>;
    resume(_input: ReadOperation & { generationId: string; lastEventId: string | null }): Promise<Response>;
    cancel(_input: RequestOperation & { generationId: string | null; reason: 'user' | 'content_policy' }): Promise<Response>;
  };
}

const compareDecimal = (left: string, right: string): number => {
  const normalizedLeft = left.replace(/^0+(?=\d)/u, '');
  const normalizedRight = right.replace(/^0+(?=\d)/u, '');
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length < normalizedRight.length ? -1 : 1;
  }
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
};

const compareStreamIds = (left: string, right: string): number | null => {
  const leftMatch = left.match(/^(\d+)-(\d+)$/u);
  const rightMatch = right.match(/^(\d+)-(\d+)$/u);
  if (!leftMatch || !rightMatch) return null;
  const milliseconds = compareDecimal(leftMatch[1]!, rightMatch[1]!);
  return milliseconds !== 0 ? milliseconds : compareDecimal(leftMatch[2]!, rightMatch[2]!);
};

const generationIdFromResponse = (response: Response): string | null => {
  const value = response.headers.get('x-mahoshojo-generation-id')?.trim();
  return isGenerationIdentifier(value) ? value : null;
};

const terminalState = (event: string, data: string): ArenaGenerationConnectionState | null => {
  if (event === 'done') {
    try {
      const parsed = JSON.parse(data) as { status?: unknown };
      return parsed.status === 'cancelled' ? 'cancelled' : 'completed';
    } catch {
      return 'completed';
    }
  }
  if (event !== 'error') return null;
  try {
    const parsed = JSON.parse(data) as { status?: unknown };
    return parsed.status === 'producer_lost' ? 'producer_lost' : 'failed';
  } catch {
    return 'failed';
  }
};

export const openArenaGenerationStreamClient = async (
  options: ArenaGenerationClientOptions,
  ports: ArenaGenerationClientPorts,
): Promise<Response> => {
  if (
    options.generationRequestId !== undefined
    && !isGenerationIdentifier(options.generationRequestId)
  ) {
    throw new Error('ARENA_GENERATION_REQUEST_ID_INVALID');
  }
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const maxAttempts = options.maxReconnectAttempts ?? 8;
  const baseDelayMs = options.baseReconnectDelayMs ?? 500;
  const cancelConfirmationTimeoutMs = Math.max(1, options.cancelConfirmationTimeoutMs ?? 5_000);
  const isInitialCreateOutcomeAmbiguous = ports.isInitialCreateOutcomeAmbiguous;
  const bodyHash = options.bodyHash;
  const previous = ports.loadState();
  const resumablePrevious = previous
    && (previous.version === 1 || previous.version === 2 || previous.version === 3)
    && (
      previous.endpoint === options.endpoint
      && previous.bodyHash === bodyHash
    )
    && [
      'connecting',
      'generating',
      'recovering_initial',
      'reconnecting',
      'resuming',
      'unknown',
    ].includes(previous.state)
    ? previous
    : null;
  const generationRequestId = resumablePrevious?.generationRequestId
    ?? options.generationRequestId
    ?? ports.createRequestId();
  let generationId = resumablePrevious?.generationId ?? null;
  let lastEventId = resumablePrevious?.lastEventId ?? null;
  let routePin = resumablePrevious?.version === 3
    ? resumablePrevious.routePin ?? null
    : null;
  let state: ArenaGenerationConnectionState = resumablePrevious?.generationId
    ? 'resuming'
    : resumablePrevious
      ? 'recovering_initial'
      : 'connecting';
  let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let stopped = false;
  let explicitlyAborted = false;
  let cancelConfirmationPromise: Promise<void> | null = null;
  let terminal = false;
  let connectedViaResume = false;
  const persistCurrentState = (): void => {
    ports.saveState({
      version: 3,
      generationRequestId,
      generationId,
      lastEventId,
      state,
      updatedAt: now().toISOString(),
      endpoint: options.endpoint,
      bodyHash,
      routePin,
    });
  };
  const acceptInitialRoutePin = (selected: GenerationApiRoutePin): void => {
    if (routePin || !isGenerationApiRoutePin(selected)) return;
    routePin = Object.freeze({ placement: selected.placement });
    persistCurrentState();
  };
  const captureInitialRoutePin = (): void => {
    if (routePin) return;
    const selected = options.getInitialRoutePin?.() ?? null;
    if (isGenerationApiRoutePin(selected)) acceptInitialRoutePin(selected);
  };
  const updateState = (next: ArenaGenerationConnectionState): void => {
    state = next;
    options.onStateChange?.(next);
    persistCurrentState();
  };

  const fetchResume = async (): Promise<Response> => {
    if (!isGenerationIdentifier(generationId)) throw new Error('ARENA_GENERATION_ID_MISSING');
    updateState('resuming');
    connectedViaResume = true;
    return ports.transport.resume({ generationId, lastEventId, signal: options.signal, routePin: routePin ?? undefined });
  };

  updateState(state);
  ports.prepareCreate(generationRequestId);
  const cancelOnExplicitAbort = (): void => {
    const cancelReason = ports.classifyExplicitAbort(options.signal?.reason);
    if (!cancelReason || terminal) return;
    explicitlyAborted = true;
    stopped = true;
    updateState('cancelling');
    void currentReader?.cancel(cancelReason).catch(() => undefined);
    const cancelController = new AbortController();
    const cancelRequest = ports.transport.cancel({
      generationId, generationRequestId, reason: cancelReason, signal: cancelController.signal,
    }).then(async (response) => {
      if (response.status === 202) {
        await response.body?.cancel('cancel accepted').catch(() => undefined);
        return true;
      }
      if (!response.ok) {
        await response.body?.cancel('cancel rejected').catch(() => undefined);
        return false;
      }
      try {
        const payload = await response.json() as { cancelled?: unknown; status?: unknown };
        return payload.cancelled === true
          || payload.status === 'cancelling'
          || payload.status === 'cancelled';
      } catch {
        return false;
      }
    }).catch(() => false);
    cancelConfirmationPromise = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        cancelController.abort('cancel-confirmation-timeout');
        resolve(false);
      }, cancelConfirmationTimeoutMs);
      (timer as unknown as { unref?: () => void }).unref?.();
      void cancelRequest.then((confirmed) => {
        clearTimeout(timer);
        resolve(confirmed);
      });
    }).then((confirmed) => {
      updateState(confirmed ? 'cancelled' : 'cancel_unconfirmed');
    });
  };
  options.signal?.addEventListener('abort', cancelOnExplicitAbort, { once: true });
  if (options.signal?.aborted) cancelOnExplicitAbort();
  if (stopped) {
    await cancelConfirmationPromise;
    throw new Error('ARENA_GENERATION_CANCELLED');
  }
  const fetchCreate = (): Promise<Response> => ports.transport.create({
    generationRequestId, signal: options.signal, onRoutePinSelected: acceptInitialRoutePin,
  });
  const fetchLookup = (): Promise<Response> => ports.transport.lookup({
    generationRequestId, signal: options.signal, routePin: routePin ?? undefined,
  });
  const fetchResumeWithRetry = async (): Promise<Response> => {
    let attempt = 0;
    while (true) {
      try {
        const resumed = await fetchResume();
        ports.observeResponse(resumed);
        const transient = resumed.status === 408
          || resumed.status === 429
          || resumed.status >= 500;
        if (!transient || attempt >= maxAttempts) return resumed;
        await resumed.body?.cancel('retry initial generation resume').catch(() => undefined);
      } catch (error) {
        if (options.signal?.aborted || attempt >= maxAttempts) throw error;
      }
      updateState('reconnecting');
      const exponential = Math.min(30_000, baseDelayMs * (2 ** attempt));
      await ports.waitForReconnectOpportunity(
        Math.floor(exponential * (0.75 + random() * 0.5)),
        options.signal,
      );
      attempt += 1;
    }
  };
  const isKnownGenerationStatus = (value: unknown): boolean => (
    typeof value === 'string'
    && [
      'reserved',
      'running',
      'finalizing',
      'completed',
      'failed',
      'cancelled',
      'producer_lost',
    ].includes(value)
  );
  const recoverInitial = async (): Promise<Response> => {
    updateState('recovering_initial');
    const lookupAttempts = Math.max(1, maxAttempts + 1);
    for (let attempt = 0; attempt < lookupAttempts; attempt += 1) {
      if (attempt > 0) {
        const exponential = Math.min(30_000, baseDelayMs * (2 ** (attempt - 1)));
        await ports.waitForReconnectOpportunity(
          Math.floor(exponential * (0.75 + random() * 0.5)),
          options.signal,
        );
      }
      if (options.signal?.aborted) throw new Error('ARENA_GENERATION_CANCELLED');
      let lookup: Response;
      try {
        lookup = await fetchLookup();
      } catch (error) {
        if (options.signal?.aborted) throw error;
        continue;
      }
      ports.observeResponse(lookup);
      if (lookup.ok) {
        let payload: unknown = null;
        try {
          payload = await lookup.json();
        } catch (error) {
          if (options.signal?.aborted) throw error;
          // A malformed success is ambiguous and consumes the same lookup budget.
        }
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const record = payload as Record<string, unknown>;
          if (
            record.generationRequestId === generationRequestId
            && isGenerationIdentifier(record.generationId)
            && isKnownGenerationStatus(record.status)
          ) {
            generationId = record.generationId;
            return fetchResumeWithRetry();
          }
        }
        continue;
      }
      const retryable = lookup.status === 404
        || lookup.status === 408
        || lookup.status === 429
        || lookup.status >= 500;
      if (!retryable) {
        updateState('unknown');
        return lookup;
      }
      await lookup.body?.cancel('retry generation request lookup').catch(() => undefined);
    }
    updateState('unknown');
    throw new Error('ARENA_GENERATION_STATE_UNKNOWN');
  };
  let response!: Response;
  try {
    if (resumablePrevious?.generationId) {
      response = await fetchResumeWithRetry();
    } else if (resumablePrevious) {
      response = await recoverInitial();
    } else {
      let created: Response | null = null;
      try {
        created = await fetchCreate();
      } catch (error) {
        if (options.signal?.aborted) throw error;
        captureInitialRoutePin();
        if (!isInitialCreateOutcomeAmbiguous(error)) {
          updateState('failed');
          throw error;
        }
        response = await recoverInitial();
      }
      if (created) {
        captureInitialRoutePin();
        ports.observeResponse(created);
        generationId = generationIdFromResponse(created) ?? generationId;
        const completeSuccess = created.ok && created.body && generationId;
        const ambiguous = (created.ok && !completeSuccess)
          || created.status === 408
          || created.status === 429
          || created.status >= 500;
        if (completeSuccess) {
          response = created;
        } else if (ambiguous) {
          await created.body?.cancel('recover incomplete generation handshake').catch(() => undefined);
          response = generationId ? await fetchResumeWithRetry() : await recoverInitial();
        } else {
          updateState('failed');
          response = created;
        }
      }
    }
  } catch (error) {
    if (explicitlyAborted) await cancelConfirmationPromise;
    options.signal?.removeEventListener('abort', cancelOnExplicitAbort);
    throw error;
  }
  ports.observeResponse(response);
  generationId = generationIdFromResponse(response) ?? generationId;
  if (!response.ok || !response.body || !generationId) {
    options.signal?.removeEventListener('abort', cancelOnExplicitAbort);
    return response;
  }
  updateState(connectedViaResume ? 'resuming' : 'generating');

  const encoder = { encode: ports.encodeUtf8 };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = async (): Promise<void> => {
        let reconnectAttempt = 0;
        const reconnect = async (): Promise<void> => {
          while (true) {
            if (stopped || terminal) return;
            if (reconnectAttempt >= maxAttempts) {
              throw new Error('ARENA_RESUME_ATTEMPTS_EXHAUSTED');
            }
            updateState('reconnecting');
            if (stopped || terminal) return;
            const exponential = Math.min(30_000, baseDelayMs * (2 ** reconnectAttempt));
            await ports.waitForReconnectOpportunity(
              Math.floor(exponential * (0.75 + random() * 0.5)),
              options.signal,
            );
            if (stopped || terminal) return;
            reconnectAttempt += 1;
            try {
              response = await fetchResume();
              ports.observeResponse(response);
              if (![429, 502, 503, 504].includes(response.status)) return;
            } catch (error) {
              if (stopped || terminal) return;
              if (options.signal?.aborted || reconnectAttempt >= maxAttempts) throw error;
            }
          }
        };
        try {
          while (!stopped && !terminal) {
            if (!response.ok || !response.body) {
              if ([429, 502, 503, 504].includes(response.status)) {
                await reconnect();
                continue;
              }
              throw new Error(`ARENA_RESUME_HTTP_${response.status}`);
            }
            currentReader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            try {
              while (!stopped) {
                const next = await currentReader.read();
                if (next.done) break;
                buffer += decoder.decode(next.value, { stream: true }).replace(/\r\n?/gu, '\n');
                let separator = buffer.indexOf('\n\n');
                while (separator >= 0) {
                  const block = buffer.slice(0, separator);
                  buffer = buffer.slice(separator + 2);
                  const parsed = parseGenerationSseBlock(block);
                  if (parsed?.id) {
                    const comparison = lastEventId ? compareStreamIds(parsed.id, lastEventId) : 1;
                    if (comparison === null || comparison <= 0) {
                      separator = buffer.indexOf('\n\n');
                      continue;
                    }
                    lastEventId = parsed.id;
                  }
                  const nextTerminal = parsed ? terminalState(parsed.event, parsed.data) : null;
                  controller.enqueue(encoder.encode(`${block}\n\n`));
                  updateState(nextTerminal ?? 'generating');
                  if (nextTerminal) {
                    terminal = true;
                    break;
                  }
                  separator = buffer.indexOf('\n\n');
                }
                if (terminal) break;
              }
            } catch {
              // Connection-level failures are recoverable. Cursor only advances after
              // a complete SSE block, so a partial block is safely replayed in full.
            } finally {
              currentReader.releaseLock();
              currentReader = null;
            }
            if (stopped || terminal) break;
            await reconnect();
          }
          if (!stopped) controller.close();
        } catch (error) {
          if (!stopped) {
            if (
              error instanceof Error
              && error.message === 'ARENA_RESUME_ATTEMPTS_EXHAUSTED'
            ) {
              updateState('interrupted');
              controller.close();
            } else {
              updateState('failed');
              controller.error(error);
            }
          }
        } finally {
          if (explicitlyAborted) {
            await cancelConfirmationPromise;
            try {
              controller.close();
            } catch {
              // The consumer may have cancelled the wrapper while explicit abort
              // was waiting for the server-response reader to settle.
            }
          }
          options.signal?.removeEventListener('abort', cancelOnExplicitAbort);
        }
      };
      void pump();
    },
    cancel(reason) {
      stopped = true;
      void currentReader?.cancel(reason).catch(() => undefined);
      options.signal?.removeEventListener('abort', cancelOnExplicitAbort);
    },
  });

  const headers = new Headers(response.headers);
  headers.set('X-Mahoshojo-Generation-Id', generationId);
  headers.set('X-Mahoshojo-Generation-Request-Id', generationRequestId);
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
