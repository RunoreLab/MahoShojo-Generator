import { Channel } from '@tauri-apps/api/core';
import {
  DESKTOP_ARENA_HOSTED_LIMITS,
  DesktopArenaHostedChannelEventSchema,
  DesktopArenaHostedErrorSchema,
  type DesktopArenaHostedError,
  DesktopArenaHostedControlRequestSchema,
  DesktopArenaHostedControlResponseSchema,
  DesktopArenaHostedDetachRequestSchema,
  DesktopArenaHostedStreamRequestSchema,
  DesktopArenaHostedRecoveryHintRequestSchema,
  DesktopArenaHostedRecoveryHintSchema,
  type DesktopArenaHostedRecoveryHintRequest,
  type DesktopArenaHostedRecoveryHint,
  parseDesktopArenaHostedSseBlock,
  type DesktopArenaHostedChannelEvent,
  type DesktopArenaHostedControlRequest,
  type DesktopArenaHostedControlResponse,
  type DesktopArenaHostedDetachRequest,
  type DesktopArenaHostedStreamRequest,
} from '@mahoshojo/contracts/desktop-arena-hosted';
import type { InvokeFn } from './cloud-bridge';

export const ARENA_HOSTED_STREAM_COMMAND = 'arena_hosted_stream';
export const ARENA_HOSTED_CONTROL_COMMAND = 'arena_hosted_control';
export const ARENA_HOSTED_RECOVERY_HINT_COMMAND = 'arena_hosted_recovery_hint';
export const ARENA_HOSTED_DETACH_COMMAND = 'arena_hosted_detach';
export type ArenaHostedHandshake = Extract<DesktopArenaHostedChannelEvent, { kind: 'response' }>;
export interface ArenaHostedChannel { onmessage: (value: unknown) => void }
export class ArenaHostedBridgeError extends Error {
  constructor(readonly code: DesktopArenaHostedError['code'] | 'protocol' | 'transport', readonly dispatchState: 'not-dispatched' | 'unknown' = 'unknown', readonly intentOwnership: DesktopArenaHostedError['intentOwnership'] = 'unknown') {
    const messages: Partial<Record<DesktopArenaHostedError['code'] | 'protocol' | 'transport', string>> = {
      'capability-unavailable': '服务器尚未声明所选生成方式及身份保护所需协议，未开始生成。',
      'storage-unavailable': '原生恢复凭据无法保存或读取，请检查本机安全存储。',
      'scope-changed': '账号或当前请求身份已变化，原操作已停止。',
      'create-already-attempted': '该请求已尝试创建，请查找或续流，不重复创建。',
      'recovery-conflict': '原生恢复身份与本机指针不一致；清除页面指针不会清除该身份，也不会停止服务器。请保留原记录，不能换身份重试。',
      'recovery-unavailable': '原恢复凭据不可用，不能换身份恢复该请求。',
      'recovery-expired': '原恢复凭据已到期，不能重新创建原请求。',
      protocol: '服务器生成返回了不符合协议的数据，已保留收到的正文。',
    };
    super(messages[code] ?? '服务器连接或协议失败，已保留收到的正文。');
    this.name = 'ArenaHostedBridgeError';
  }
}
export const normalizeArenaHostedBridgeFailure = (cause: unknown): ArenaHostedBridgeError => {
  const parsed = DesktopArenaHostedErrorSchema.safeParse(cause);
  return parsed.success ? new ArenaHostedBridgeError(parsed.data.code, parsed.data.dispatchState, parsed.data.intentOwnership) : new ArenaHostedBridgeError('transport');
};
const abortError = () => new DOMException('已停止本机订阅；服务器终态仍需确认。', 'AbortError');

/** Detach is local only. It never substitutes for the server stop operation. */
export const detachArenaHosted = async (invoke: InvokeFn, scope: DesktopArenaHostedDetachRequest): Promise<void> => {
  const request = DesktopArenaHostedDetachRequestSchema.parse(scope);
  try { await invoke(ARENA_HOSTED_DETACH_COMMAND, { request }); }
  catch (cause) { throw normalizeArenaHostedBridgeFailure(cause); }
};

export const controlArenaHosted = async (invoke: InvokeFn, request: DesktopArenaHostedControlRequest): Promise<DesktopArenaHostedControlResponse> => {
  const parsed = DesktopArenaHostedControlRequestSchema.parse(request);
  let raw: unknown;
  try { raw = await invoke(ARENA_HOSTED_CONTROL_COMMAND, { request: parsed }); }
  catch (cause) { throw normalizeArenaHostedBridgeFailure(cause); }
  const result = DesktopArenaHostedControlResponseSchema.safeParse(raw);
  if (!result.success) throw new ArenaHostedBridgeError('protocol');
  return result.data;
};

/** Read-only local identity diagnosis. It neither contacts nor stops the server. */
export const readArenaHostedRecoveryHint = async (invoke: InvokeFn, value: DesktopArenaHostedRecoveryHintRequest): Promise<DesktopArenaHostedRecoveryHint> => {
  const request = DesktopArenaHostedRecoveryHintRequestSchema.parse(value);
  let raw: unknown;
  try { raw = await invoke(ARENA_HOSTED_RECOVERY_HINT_COMMAND, { request }); }
  catch (cause) { throw normalizeArenaHostedBridgeFailure(cause); }
  const parsed = DesktopArenaHostedRecoveryHintSchema.safeParse(raw);
  if (!parsed.success || parsed.data.product !== request.product) throw new ArenaHostedBridgeError('protocol');
  return parsed.data;
};

/** Native transport adapter only; C0 owns cursor deduplication and all reconnect decisions. */
export const openArenaHostedStream = (
  invoke: InvokeFn,
  value: DesktopArenaHostedStreamRequest,
  options: { signal?: AbortSignal; onResponse?: (response: ArenaHostedHandshake) => void; createChannel?: () => ArenaHostedChannel } = {},
): Promise<Response> => {
  const request = DesktopArenaHostedStreamRequestSchema.parse(value);
  if (options.signal?.aborted) return Promise.reject(abortError());
  const encoder = new TextEncoder();
  let nextSequence = 0, fragmentBytes = 0, fragment = '';
  let responded = false, acceptsSse = false, ended = false, detached = false;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  let resolveResponse!: (response: Response) => void, rejectResponse!: (error: unknown) => void;
  const result = new Promise<Response>((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
  const detach = () => {
    if (detached) return; detached = true;
    void detachArenaHosted(invoke, { product: request.product, requestId: request.requestId }).catch(() => undefined);
  };
  const finish = (error?: unknown) => {
    if (ended) return;
    ended = true; fragment = ''; fragmentBytes = 0;
    options.signal?.removeEventListener('abort', onAbort);
    if (!responded) rejectResponse(error ?? new ArenaHostedBridgeError('protocol'));
    try { if (error) streamController.error(error); else streamController.close(); } catch { /* Consumer already cancelled. */ }
  };
  const onAbort = () => { detach(); finish(abortError()); };
  const body = new ReadableStream<Uint8Array>({
    start(controller) { streamController = controller; },
    cancel() { detach(); finish(); },
  });
  const channel = options.createChannel?.() ?? new Channel<unknown>();
  channel.onmessage = (raw) => {
    if (ended) return;
    const parsed = DesktopArenaHostedChannelEventSchema.safeParse(raw);
    if (!parsed.success || parsed.data.requestId !== request.requestId || parsed.data.sequence !== nextSequence) {
      detach(); finish(new ArenaHostedBridgeError('protocol')); return;
    }
    nextSequence += 1;
    const event = parsed.data;
    try {
      if (event.kind === 'response') {
        if (responded) throw new ArenaHostedBridgeError('protocol');
        if (event.generationRequestId && event.generationRequestId !== request.requestId) throw new ArenaHostedBridgeError('protocol');
        if (request.operation === 'resume' && event.generationId && event.generationId !== request.generationId) throw new ArenaHostedBridgeError('protocol');
        const headers = new Headers();
        if (event.generationId) headers.set('X-Mahoshojo-Generation-Id', event.generationId);
        if (event.generationRequestId) headers.set('X-Mahoshojo-Generation-Request-Id', event.generationRequestId);
        if (event.payloadHash) headers.set('X-Mahoshojo-Generation-Payload-Hash', event.payloadHash);
        const success = event.status >= 200 && event.status < 300;
        headers.set('Content-Type', success ? 'text/event-stream' : 'application/json');
        const responseBody = [204, 205, 304].includes(event.status) ? null : success ? body : JSON.stringify(event.body ?? {});
        const response = new Response(responseBody, { status: event.status, headers });
        options.onResponse?.(event);
        acceptsSse = success && responseBody !== null;
        responded = true; resolveResponse(response);
      } else if (event.kind === 'sse-fragment') {
        if (!responded || !acceptsSse) throw new ArenaHostedBridgeError('protocol');
        fragmentBytes += encoder.encode(event.text).byteLength;
        if (fragmentBytes > DESKTOP_ARENA_HOSTED_LIMITS.eventWireBytes) throw new ArenaHostedBridgeError('protocol');
        fragment += event.text;
        if (event.final) {
          if (!parseDesktopArenaHostedSseBlock(fragment)) throw new ArenaHostedBridgeError('protocol');
          streamController.enqueue(encoder.encode(fragment)); fragment = ''; fragmentBytes = 0;
        }
      } else {
        if (!responded || fragment) throw new ArenaHostedBridgeError('protocol');
        finish();
      }
    } catch { detach(); finish(new ArenaHostedBridgeError('protocol')); }
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) { onAbort(); return result; }
  void invoke(ARENA_HOSTED_STREAM_COMMAND, { request, onEvent: channel }).then(
    () => { if (!ended) finish(new ArenaHostedBridgeError('protocol')); },
    (cause: unknown) => { if (!ended) finish(normalizeArenaHostedBridgeFailure(cause)); },
  );
  return result;
};
