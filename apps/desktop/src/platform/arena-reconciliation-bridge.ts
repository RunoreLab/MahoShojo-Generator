import { Channel } from '@tauri-apps/api/core';
import {
  ARENA_RECONCILIATION_LIMITS, ArenaReconciliationRequestSchema, parseArenaReconciliationResponse,
} from '@mahoshojo/contracts/arena-reconciliation';
import { DesktopArenaHostedScopeSchema, type DesktopArenaHostedScope } from '@mahoshojo/contracts/desktop-arena-hosted';
import { DesktopArenaHostedJsonChannelEventSchema } from '@mahoshojo/contracts/desktop-arena-hosted-json';
import { ARENA_HOSTED_STREAM_COMMAND, ArenaHostedBridgeError, detachArenaHosted, normalizeArenaHostedBridgeFailure, type ArenaHostedChannel } from './arena-hosted-bridge';
import type { DesktopArenaHostedStoryReconcileRequest } from '@mahoshojo/contracts/desktop-arena-story-transport';
import type { InvokeFn } from './cloud-bridge';

export interface ArenaReconciliationChannelOptions { signal?: AbortSignal; createChannel?: () => ArenaHostedChannel }

export const reconcileArenaHosted = (
  invoke: InvokeFn,
  scope: DesktopArenaHostedScope,
  value: unknown,
  options: ArenaReconciliationChannelOptions = {},
): Promise<ReturnType<typeof parseArenaReconciliationResponse>> => {
  const payload = ArenaReconciliationRequestSchema.parse(value);
  const request = { operation: 'reconcile' as const, ...DesktopArenaHostedScopeSchema.parse(scope), ...payload };
  return receiveArenaReconciliationChannel(invoke, request, payload.combatants.length, options);
};

/** Shared receiver for already validated requests. Native owns the exact story role source. */
export const receiveArenaReconciliationChannel = (
  invoke: InvokeFn,
  request: (DesktopArenaHostedScope & ReturnType<typeof ArenaReconciliationRequestSchema.parse> & { operation: 'reconcile' }) | DesktopArenaHostedStoryReconcileRequest,
  expectedCombatantCount: number,
  options: ArenaReconciliationChannelOptions = {},
): Promise<ReturnType<typeof parseArenaReconciliationResponse>> => {
  if (!Number.isInteger(expectedCombatantCount) || expectedCombatantCount < 1
    || expectedCombatantCount > ARENA_RECONCILIATION_LIMITS.maxCombatants) throw new ArenaHostedBridgeError('invalid-request', 'not-dispatched');
  const abortError = () => new DOMException('本机角色同步已停止；战报与原卡仍保留。', 'AbortError');
  if (options.signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let ended = false, channelEnded = false, nativeSettled = false, sequence = 0, wireBytes = 0, status: number | undefined;
    let fragments: string[] = [], response: ReturnType<typeof parseArenaReconciliationResponse> | undefined;
    const encoder = new TextEncoder();
    const finish = (error?: unknown) => {
      if (ended) return; ended = true; fragments = [];
      options.signal?.removeEventListener('abort', abort);
      if (error || !response) reject(error ?? new ArenaHostedBridgeError('protocol'));
      else resolve(response);
    };
    const detach = () => { void detachArenaHosted(invoke, { product: request.product, requestId: request.requestId }).catch(() => undefined); };
    const abort = () => { detach(); finish(abortError()); };
    const channel = options.createChannel?.() ?? new Channel<unknown>();
    channel.onmessage = (raw) => {
      if (ended) return;
      try {
        if (channelEnded) throw new ArenaHostedBridgeError('protocol');
        const event = DesktopArenaHostedJsonChannelEventSchema.parse(raw);
        if (event.requestId !== request.requestId || event.sequence !== sequence++) throw new ArenaHostedBridgeError('protocol');
        if (event.kind === 'json-response') {
          if (status !== undefined || event.generationId !== request.generationId || event.generationRequestId !== request.requestId) throw new ArenaHostedBridgeError('protocol');
          status = event.status;
        } else if (event.kind === 'json-fragment') {
          if (status === undefined || response) throw new ArenaHostedBridgeError('protocol');
          wireBytes += encoder.encode(event.text).byteLength;
          if (wireBytes > ARENA_RECONCILIATION_LIMITS.responseBodyBytes) throw new ArenaHostedBridgeError('protocol');
          fragments.push(event.text);
          if (event.final) {
            response = parseArenaReconciliationResponse(fragments.join(''), request.generationId, expectedCombatantCount); fragments = [];
            if ((status >= 200 && status < 300) !== ('success' in response && response.success === true)) throw new ArenaHostedBridgeError('protocol');
          }
        } else {
          if (!response || fragments.length) throw new ArenaHostedBridgeError('protocol');
          channelEnded = true;
          if (nativeSettled) finish();
        }
      } catch { detach(); finish(new ArenaHostedBridgeError('protocol')); }
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }
    try {
      void invoke(ARENA_HOSTED_STREAM_COMMAND, { request, onEvent: channel }).then(
        () => { nativeSettled = true; if (!ended) finish(channelEnded ? undefined : new ArenaHostedBridgeError('protocol')); },
        (cause: unknown) => { nativeSettled = true; if (!ended) finish(normalizeArenaHostedBridgeFailure(cause)); },
      );
    } catch (cause) { finish(normalizeArenaHostedBridgeFailure(cause)); }
  });
};
