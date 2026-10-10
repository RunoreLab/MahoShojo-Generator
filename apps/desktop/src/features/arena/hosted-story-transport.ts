import {
  DesktopArenaHostedStoryCreateRequestSchema, DesktopArenaHostedStoryRecoveryPointerSchema,
  type DesktopArenaHostedStoryCreateRequest, type DesktopArenaHostedStoryRecoveryPointer,
} from '@mahoshojo/contracts/desktop-arena-story-transport';
import type { DesktopArenaHostedControlRequest } from '@mahoshojo/contracts/desktop-arena-hosted';
import {
  openArenaGenerationStreamClient, type ArenaGenerationConnectionState, type PersistedArenaGeneration,
} from '@mahoshojo/hosted-api/arena-generation/client';
import {
  ArenaHostedBridgeError, controlArenaHosted, openArenaHostedStream,
  type ArenaHostedChannel, type ArenaHostedHandshake,
} from '../../platform/arena-hosted-bridge';
import type { InvokeFn } from '../../platform/cloud-bridge';

const endpoint = '/api/arena/session/generate-next';
const encoder = new TextEncoder();
export const ARENA_HOSTED_STORY_USER_STOP = 'arena-story-user-stop';

export type ArenaHostedStoryTransportIntent =
  | { mode: 'create'; pointer: DesktopArenaHostedStoryRecoveryPointer; request: DesktopArenaHostedStoryCreateRequest }
  | { mode: 'recover'; pointer: DesktopArenaHostedStoryRecoveryPointer };
export interface ArenaHostedStoryTransportOptions {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  onResponse?: (response: ArenaHostedHandshake) => void;
  onStateChange?: (state: ArenaGenerationConnectionState) => void;
  onRecoveryState?: (state: PersistedArenaGeneration) => void;
  createChannel?: () => ArenaHostedChannel;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  maxReconnectAttempts?: number;
}
const delay = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('detached', 'AbortError')); return; }
  const aborted = () => { clearTimeout(timer); reject(new DOMException('detached', 'AbortError')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, milliseconds);
  signal?.addEventListener('abort', aborted, { once: true });
});

/** Pure Native/C0 wiring, not a pending/create/save owner. The caller reads the exact Native pending
 * before create/reconcile and owns output originals. Cold recovery always rebinds the original actor
 * and replays from zero; only this live C0 subscription may use its fully delivered cursor prefix. */
export const openArenaHostedStoryTransport = async (
  invoke: InvokeFn,
  intent: ArenaHostedStoryTransportIntent,
  options: ArenaHostedStoryTransportOptions = {},
): Promise<Response> => {
  const pointer = DesktopArenaHostedStoryRecoveryPointerSchema.parse(intent.pointer);
  const create = intent.mode === 'create' ? DesktopArenaHostedStoryCreateRequestSchema.parse(intent.request) : null;
  if (create && (create.product !== pointer.product || create.requestId !== pointer.requestId
    || JSON.stringify(create.actor) !== JSON.stringify(pointer.actor) || create.inputDigest !== pointer.inputDigest
    || create.clientBodyHash !== pointer.bodyHash || pointer.state !== 'prepared'
    || pointer.generationId !== undefined || pointer.cursor !== undefined)) {
    throw new ArenaHostedBridgeError('invalid-request', 'not-dispatched');
  }
  const scope = { product: pointer.product, requestId: pointer.requestId, actor: pointer.actor };
  const isCurrent = () => options.isCurrent?.() !== false;
  const assertCurrent = () => { if (!isCurrent()) throw new ArenaHostedBridgeError('scope-changed', 'not-dispatched'); };
  assertCurrent(); options.signal?.throwIfAborted();
  let generationId = pointer.generationId ?? null, explicitRestoreLookup = !create;
  const onResponse = (response: ArenaHostedHandshake) => {
    assertCurrent(); options.signal?.throwIfAborted();
    if (response.generationId) {
      if (generationId && response.generationId !== generationId) throw new ArenaHostedBridgeError('protocol');
      generationId = response.generationId;
    }
    if (response.headerMeta && (response.headerMeta.reportFormat !== 'markdown'
      || response.headerMeta.webPackageRef !== undefined
      || response.headerMeta.mode && response.headerMeta.mode !== pointer.battleMode
      || response.headerMeta.outputContract !== undefined && response.headerMeta.outputContract !== 'stream-markdown')) {
      throw new ArenaHostedBridgeError('protocol');
    }
    options.onResponse?.(response);
  };
  const short = async (request: DesktopArenaHostedControlRequest, signal?: AbortSignal) => {
    assertCurrent(); signal?.throwIfAborted();
    const reply = await controlArenaHosted(invoke, request);
    assertCurrent(); signal?.throwIfAborted();
    if (reply.body.generationRequestId && reply.body.generationRequestId !== pointer.requestId
      || reply.body.generationId && generationId && reply.body.generationId !== generationId) {
      throw new ArenaHostedBridgeError('protocol');
    }
    if (reply.body.generationId) generationId = reply.body.generationId;
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  const restoredState: PersistedArenaGeneration | null = create ? null : {
    version: 3, endpoint, bodyHash: pointer.bodyHash, generationRequestId: pointer.requestId,
    generationId: null, lastEventId: null, state: 'unknown', updatedAt: pointer.updatedAt,
    routePin: { placement: 'hono-primary' },
  };
  return openArenaGenerationStreamClient({
    endpoint, bodyHash: pointer.bodyHash, generationRequestId: pointer.requestId, signal: options.signal,
    maxReconnectAttempts: options.maxReconnectAttempts, getInitialRoutePin: () => ({ placement: 'hono-primary' }),
    onStateChange: (state) => { if (isCurrent()) options.onStateChange?.(state); },
  }, {
    loadState: () => restoredState,
    saveState: (state) => {
      if (isCurrent() && (!options.signal?.aborted || options.signal.reason === ARENA_HOSTED_STORY_USER_STOP)) options.onRecoveryState?.(state);
    },
    prepareCreate: (requestId) => { if (requestId !== pointer.requestId) throw new ArenaHostedBridgeError('invalid-request', 'not-dispatched'); },
    createRequestId: () => { throw new ArenaHostedBridgeError('invalid-request', 'not-dispatched'); },
    encodeUtf8: (text) => encoder.encode(text), waitForReconnectOpportunity: options.wait ?? delay,
    classifyExplicitAbort: (reason) => reason === ARENA_HOSTED_STORY_USER_STOP ? 'user' : null,
    isInitialCreateOutcomeAmbiguous: (error) => error instanceof ArenaHostedBridgeError && error.dispatchState === 'unknown',
    observeResponse: () => undefined,
    transport: {
      create: ({ signal, onRoutePinSelected }) => {
        assertCurrent();
        if (!create) return Promise.reject(new ArenaHostedBridgeError('create-already-attempted', 'not-dispatched'));
        onRoutePinSelected({ placement: 'hono-primary' });
        return openArenaHostedStream(invoke, create, { signal, onResponse, createChannel: options.createChannel });
      },
      lookup: ({ signal }) => {
        const restoreSession = explicitRestoreLookup; explicitRestoreLookup = false;
        return short({ operation: 'lookup-request', ...scope, ...(restoreSession ? { restoreSession: true } : {}) }, signal);
      },
      resume: ({ generationId: id, lastEventId, signal }) => {
        assertCurrent();
        return openArenaHostedStream(invoke, { operation: 'resume', ...scope, generationId: id,
          ...(lastEventId ? { after: lastEventId } : {}) }, { signal, onResponse, createChannel: options.createChannel });
      },
      cancel: ({ generationId: id, reason, signal }) => short({ operation: 'stop', ...scope,
        ...(id ? { generationId: id } : {}), reason }, signal),
    },
  });
};
