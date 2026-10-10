import { Channel } from '@tauri-apps/api/core';
import {
  ARENA_COMPANION_JSON_LIMITS, parseArenaCompanionEnvelope,
  type ArenaCompanionEnvelope,
} from '@mahoshojo/contracts/arena-companion';
import {
  DesktopArenaHostedJsonCreateRequestSchema, DesktopArenaHostedJsonChannelEventSchema,
  type DesktopArenaHostedJsonCreateRequest, type DesktopArenaHostedJsonChannelEvent,
} from '@mahoshojo/contracts/desktop-arena-hosted-json';
import {
  ARENA_HOSTED_STREAM_COMMAND, ArenaHostedBridgeError, detachArenaHosted,
  normalizeArenaHostedBridgeFailure, type ArenaHostedChannel,
} from './arena-hosted-bridge';
import type { InvokeFn } from './cloud-bridge';

export type ArenaHostedJsonHandshake = Extract<DesktopArenaHostedJsonChannelEvent, { kind: 'json-response' }>;
export interface ArenaHostedJsonReply {
  response: ArenaHostedJsonHandshake;
  envelope: ArenaCompanionEnvelope;
}

/** A single complete companion delivery. It never starts a retry or accepts a partial report. */
export const openArenaHostedJson = (
  invoke: InvokeFn,
  value: DesktopArenaHostedJsonCreateRequest,
  options: {
    signal?: AbortSignal;
    onResponse?: (response: ArenaHostedJsonHandshake) => void;
    onActivity?: () => void;
    createChannel?: () => ArenaHostedChannel;
  } = {},
): Promise<ArenaHostedJsonReply> => {
  const request = DesktopArenaHostedJsonCreateRequestSchema.parse(value);
  const abortError = () => new DOMException('已停止本机接收；服务器终态仍需按原请求确认。', 'AbortError');
  if (options.signal?.aborted) return Promise.reject(abortError());
  const encoder = new TextEncoder();
  let sequence = 0, wireBytes = 0, ended = false, detached = false;
  let fragments: string[] = [];
  let response: ArenaHostedJsonHandshake | undefined;
  let envelope: ArenaCompanionEnvelope | undefined;
  let resolve!: (value: ArenaHostedJsonReply) => void;
  let reject!: (error: unknown) => void;
  const result = new Promise<ArenaHostedJsonReply>((yes, no) => { resolve = yes; reject = no; });
  const detach = () => {
    if (detached) return;
    detached = true;
    void detachArenaHosted(invoke, { product: request.product, requestId: request.requestId }).catch(() => undefined);
  };
  const finish = (error?: unknown) => {
    if (ended) return;
    ended = true; fragments = []; wireBytes = 0;
    options.signal?.removeEventListener('abort', onAbort);
    if (error || !response || !envelope) {
      envelope = undefined;
      reject(error ?? new ArenaHostedBridgeError('protocol'));
    } else {
      // Only this checked object remains live; the joined transport text is not retained.
      resolve({ response, envelope }); envelope = undefined;
    }
  };
  const onAbort = () => { detach(); finish(abortError()); };
  const channel = options.createChannel?.() ?? new Channel<unknown>();
  channel.onmessage = (raw) => {
    if (ended) return;
    const parsed = DesktopArenaHostedJsonChannelEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.requestId !== request.requestId || parsed.data.sequence !== sequence) {
      detach(); finish(new ArenaHostedBridgeError('protocol')); return;
    }
    sequence += 1;
    const event = parsed.data;
    try {
      options.onActivity?.();
      if (event.kind === 'json-response') {
        if (response || (event.generationRequestId && event.generationRequestId !== request.requestId)) throw new ArenaHostedBridgeError('protocol');
        if (event.status >= 200 && event.status < 300 && (!event.generationId || event.generationRequestId !== request.requestId)) throw new ArenaHostedBridgeError('protocol');
        response = event; options.onResponse?.(event);
      } else if (event.kind === 'json-fragment') {
        if (!response || envelope) throw new ArenaHostedBridgeError('protocol');
        wireBytes += encoder.encode(event.text).byteLength;
        if (wireBytes > ARENA_COMPANION_JSON_LIMITS.wireBytes) throw new ArenaHostedBridgeError('protocol');
        fragments.push(event.text);
        if (event.final) {
          envelope = parseArenaCompanionEnvelope(fragments.join(''));
          fragments = [];
          const success = response.status >= 200 && response.status < 300;
          if (success !== ('report' in envelope.body)
            || (envelope.body.generationId && response.generationId && envelope.body.generationId !== response.generationId)
            || ('generationRequestId' in envelope.body && envelope.body.generationRequestId
              && envelope.body.generationRequestId !== request.requestId)) throw new ArenaHostedBridgeError('protocol');
        }
      } else {
        if (!response || !envelope || fragments.length) throw new ArenaHostedBridgeError('protocol');
        finish();
      }
    } catch { detach(); finish(new ArenaHostedBridgeError('protocol')); }
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) { onAbort(); return result; }
  try {
    void invoke(ARENA_HOSTED_STREAM_COMMAND, { request, onEvent: channel }).then(
      () => { if (!ended) finish(new ArenaHostedBridgeError('protocol')); },
      (cause: unknown) => { if (!ended) finish(normalizeArenaHostedBridgeFailure(cause)); },
    );
  } catch (cause) { finish(normalizeArenaHostedBridgeFailure(cause)); }
  return result;
};
