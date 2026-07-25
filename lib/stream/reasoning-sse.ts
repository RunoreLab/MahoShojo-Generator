import { getRequestUrl } from '@/lib/request-url';
import { normalizeUsage } from '@/lib/arena/battle-report-log-utils';
import type { RawReasoningStreamEvent } from '@/lib/stream/raw-ai';
import {
  createStreamReadWithTimeout,
  STREAM_READ_IDLE_TIMEOUT_MS,
  STREAM_READ_TOTAL_TIMEOUT_MS,
} from '@/lib/stream/timeout';

type SseQueuedEvent = {
  event: string;
  payload: unknown;
};

export type ReasoningSseBridge = {
  onReasoningEvent: (event: RawReasoningStreamEvent) => void;
  toResponse: (
    textResponse: Response,
    options?: {
      usagePromise?: Promise<unknown>;
      aiModel?: string | null;
      headers?: HeadersInit;
    }
  ) => Response;
};

export const shouldUseClientSse = (req: Request): boolean => {
  try {
    const url = getRequestUrl(req);
    if (url.searchParams.get('format') === 'sse') return true;
  } catch {
    // ignore
  }
  return (req.headers.get('accept') || '').toLowerCase().includes('text/event-stream');
};

export const encodeSseEvent = (event: string, payload: unknown): Uint8Array => {
  const encoder = new TextEncoder();
  let data = 'null';
  try {
    data = JSON.stringify(payload ?? null);
  } catch (error) {
    data = JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error ?? 'json stringify failed'),
    });
  }
  return encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
};

export const createReasoningSseBridge = (label?: string): ReasoningSseBridge => {
  const queuedEvents: SseQueuedEvent[] = [];
  let sawReasoningDone = false;
  let hasReasoningText = false;
  let lastReasoningActivityAtMs: number | null = null;
  let activeController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let streamClosed = false;

  const enqueue = (event: string, payload: unknown) => {
    queuedEvents.push({ event, payload });
  };

  const onReasoningEvent = (event: RawReasoningStreamEvent) => {
    lastReasoningActivityAtMs = Date.now();
    if (event.type === 'reasoning-start') {
      enqueue('reasoning', { source: 'sdk', status: 'thinking', chunk: '' });
      flushQueuedEventsIfReady();
      return;
    }
    if (event.type === 'reasoning-delta') {
      const chunk = typeof event.text === 'string' ? event.text : '';
      if (chunk.trim()) hasReasoningText = true;
      enqueue('reasoning', { source: 'sdk', status: 'thinking', chunk });
      flushQueuedEventsIfReady();
      return;
    }
    if (event.type === 'reasoning-end') {
      sawReasoningDone = true;
      enqueue('reasoning_done', {
        source: 'sdk',
        status: hasReasoningText ? 'done' : 'unavailable',
      });
      flushQueuedEventsIfReady();
    }
  };

  const flushQueuedEvents = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    while (queuedEvents.length > 0) {
      const next = queuedEvents.shift();
      if (!next) continue;
      controller.enqueue(encodeSseEvent(next.event, next.payload));
    }
  };
  const flushQueuedEventsIfReady = () => {
    if (streamClosed || !activeController) return;
    flushQueuedEvents(activeController);
  };

  const enqueueReasoningDoneIfNeeded = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (sawReasoningDone) return;
    sawReasoningDone = true;
    controller.enqueue(
      encodeSseEvent('reasoning_done', {
        source: 'sdk',
        status: hasReasoningText ? 'done' : 'unavailable',
      })
    );
  };

  const resolveUsageWithTimeout = async (usagePromise?: Promise<unknown>, timeoutMs = 1_500): Promise<unknown> => {
    if (!usagePromise) return null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeout = new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      });
      return await Promise.race([usagePromise.catch(() => null), timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const toResponse: ReasoningSseBridge['toResponse'] = (textResponse, options) => {
    const upstreamReader = textResponse.body?.getReader() ?? null;
    if (!upstreamReader) {
      const payload = JSON.stringify({ ok: false, error: '上游响应流为空' });
      return new Response(`event: error\ndata: ${payload}\n\n`, {
        status: 500,
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    const readWithTimeout = createStreamReadWithTimeout({
      label: label ?? '通用流式 reasoning SSE',
      idleTimeoutMs: STREAM_READ_IDLE_TIMEOUT_MS,
      totalTimeoutMs: STREAM_READ_TOTAL_TIMEOUT_MS,
      getLastActivityAtMs: () => lastReasoningActivityAtMs,
      onTimeout: () => {
        try {
          void upstreamReader.cancel('timeout').catch(() => {});
        } catch {
          // ignore
        }
      },
    });

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const decoder = new TextDecoder();
        activeController = controller;
        streamClosed = false;
        try {
          flushQueuedEvents(controller);
          while (true) {
            const { done, value } = await readWithTimeout(upstreamReader);
            if (done) break;
            if (!value) continue;

            flushQueuedEvents(controller);
            const chunk = decoder.decode(value, { stream: true });
            if (chunk) {
              controller.enqueue(encodeSseEvent('markdown', { chunk }));
            }
          }

          const flushed = decoder.decode();
          if (flushed) {
            controller.enqueue(encodeSseEvent('markdown', { chunk: flushed }));
          }
          flushQueuedEvents(controller);
          enqueueReasoningDoneIfNeeded(controller);

          const usageRaw = await resolveUsageWithTimeout(options?.usagePromise);
          const normalizedUsage = normalizeUsage(usageRaw);
          const aiModel = typeof options?.aiModel === 'string' ? options.aiModel.trim() : '';
          if (normalizedUsage || aiModel) {
            controller.enqueue(
              encodeSseEvent('telemetry', {
                version: 1,
                ...(aiModel ? { aiModel } : {}),
                ...(normalizedUsage ? { usage: normalizedUsage } : {}),
              })
            );
          }

          controller.enqueue(encodeSseEvent('done', { ok: true }));
          streamClosed = true;
          activeController = null;
          controller.close();
        } catch (error) {
          flushQueuedEvents(controller);
          enqueueReasoningDoneIfNeeded(controller);
          controller.enqueue(
            encodeSseEvent('error', {
              ok: false,
              error: error instanceof Error ? error.message : String(error ?? '上游流读取失败'),
            })
          );
          streamClosed = true;
          activeController = null;
          controller.close();
        }
      },
      cancel(reason) {
        streamClosed = true;
        activeController = null;
        try {
          void upstreamReader.cancel(reason).catch(() => {});
        } catch {
          // ignore
        }
      },
    });

    const headers = new Headers(options?.headers);
    headers.set('content-type', 'text/event-stream; charset=utf-8');
    headers.set('cache-control', 'no-store');
    return new Response(body, { status: textResponse.status || 200, headers });
  };

  return {
    onReasoningEvent,
    toResponse,
  };
};
