import { captureArenaRoomGenerationCancelTarget, type ArenaRoomHostWorkspaceBundle } from '@mahoshojo/multiplayer-core';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArenaRoomCreateRequestSchema, ArenaRoomSessionResponseSchema, type ArenaProposal, type ArenaRoomProposalResolveRequest, type ArenaRoomSessionResponse } from '@mahoshojo/contracts/arena-room';
import {
  DESKTOP_ROOM_ERROR_MESSAGE, DESKTOP_ROOM_IPC_COMMANDS,
  DesktopRoomBatchSchema, DesktopRoomEventSchema, DesktopRoomRequestSchema,
  type DesktopRoomAttachResponse, type DesktopRoomEvent, type DesktopRoomHttpAction,
  type DesktopRoomHttpOperation,
} from '@mahoshojo/contracts/desktop-room-ipc';
import { DesktopCloudSessionStore } from '../src/features/account/cloud-session-store';
import { DesktopArenaRoomSession, type DesktopRoomSource, type DesktopRoomState } from '../src/features/arena/room-session';
import { type ArenaRoomChannel } from '../src/platform/arena-room-bridge';
import { CLOUD_AUTH_STATUS_COMMAND, CLOUD_SIGN_OUT_COMMAND } from '../src/platform/cloud-bridge';

const fixture = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/desktop-room-ipc.json', import.meta.url), 'utf8'));
const proposalFixture = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/desktop-room-proposals.json', import.meta.url), 'utf8'));
const generationFixture = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/desktop-room-generation-read.json', import.meta.url), 'utf8'));
const events: DesktopRoomEvent[] = fixture.pulls.map((pull: { batch: unknown }) => DesktopRoomBatchSchema.parse(pull.batch).event);
const createRequest = ArenaRoomCreateRequestSchema.parse(fixture.requests.find((entry: { request: { kind: string } }) => entry.request.kind === 'create').request.request);
const host = ArenaRoomSessionResponseSchema.parse(fixture.pulls[2].batch.event.response.result);
const member = ArenaRoomSessionResponseSchema.parse({ ...host, self: host.snapshot.members.find(value => value.role === 'member') });
const details = { ...createRequest.directory, displayName: createRequest.displayName };
const source = (): Promise<DesktopRoomSource> => Promise.resolve({ ok: true, sharedConfig: createRequest.sharedConfig });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const success = (operation: DesktopRoomHttpOperation, requestId: string, result?: unknown): DesktopRoomEvent => {
  const event = events.find(value => value.kind === 'http-result' && value.operation === (operation === 'config' ? 'session' : operation) && 'result' in value.response);
  if (!event || event.kind !== 'http-result') throw new Error(`Missing canonical ${operation} success`);
  return DesktopRoomEventSchema.parse({ ...event, operation, requestId, response: { ...event.response, ...(result === undefined ? {} : { result }) } });
};
const socket = (type: string): DesktopRoomEvent => {
  const event = events.find(value => value.kind === 'socket' && value.message.type === type);
  if (!event) throw new Error(`Missing canonical ${type} message`);
  return event;
};
const whenState = (session: DesktopArenaRoomSession, predicate: (state: DesktopRoomState) => boolean): Promise<void> => {
  if (predicate(session.getSnapshot())) return Promise.resolve();
  return new Promise(resolve => {
    const unsubscribe = session.subscribe(() => {
      if (predicate(session.getSnapshot())) { unsubscribe(); resolve(); }
    });
  });
};

const sessions: DesktopArenaRoomSession[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); });

async function harness() {
  // Use the real account store, session and bridge. Only the Native boundary and
  // immutable Document identity are controlled; no private methods are replaced.
  const account = new DesktopCloudSessionStore({ invoke: async command => {
    if (command === CLOUD_AUTH_STATUS_COMMAND) return { state: 'active', account: { userId: fixture.expectedUserId, username: 'room-test', displayName: '房间测试' } };
    if (command === CLOUD_SIGN_OUT_COMMAND) return { revoked: true };
    throw new Error(`Unexpected account command: ${command}`);
  } });
  await account.refresh();
  let nonce: string | undefined = fixture.attachRequest.documentNonce;
  let nonceThrows = false;
  let canStart = true;
  let subscriptionId = '';
  let attachCount = 0;
  let subscribeCount = 0;
  let sequence = 0;
  let requestCount = 0;
  let pendingIntent: DesktopRoomAttachResponse['pendingIntent'] = null;
  let endFails = false;
  let generationStartFence: DesktopRoomAttachResponse['generationStartFence'] = null;
  const attachGates: Array<{
    entered: ReturnType<typeof deferred<DesktopRoomAttachResponse>>;
    response: ReturnType<typeof deferred<unknown>>;
  }> = [];
  const channels: ArenaRoomChannel[] = [];
  const requests: DesktopRoomHttpAction[] = [];
  type HttpPlan = {
    kind: DesktopRoomHttpAction['kind']; requestId: string;
    entered: ReturnType<typeof deferred<DesktopRoomHttpAction>>;
    response: ReturnType<typeof deferred<unknown>>;
  };
  const plans: HttpPlan[] = [];
  type Delivery = {
    batch: ReturnType<typeof DesktopRoomBatchSchema.parse>;
    pulled: ReturnType<typeof deferred<void>>;
    ackEntered: ReturnType<typeof deferred<void>>;
    ack: ReturnType<typeof deferred<unknown>>;
  };
  const deliveries: Delivery[] = [];
  const awaitingAck = new Map<string, Delivery>();
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    if (command === DESKTOP_ROOM_IPC_COMMANDS.attach) {
      subscriptionId = `lobby-${++attachCount}`;
      const response: DesktopRoomAttachResponse = { ...fixture.attach, subscriptionId, pendingIntent, generationStartBlocked: !!generationStartFence, generationStartFence };
      const gate = attachGates.shift();
      if (gate) { gate.entered.resolve(response); return gate.response.promise; }
      return response;
    }
    if (command === DESKTOP_ROOM_IPC_COMMANDS.detach) return fixture.detach;
    if (command === DESKTOP_ROOM_IPC_COMMANDS.subscribe) {
      subscriptionId = `socket-${++subscribeCount}`;
      return { handle: fixture.attach.handle, subscriptionId };
    }
    if (command !== DESKTOP_ROOM_IPC_COMMANDS.request) throw new Error(`Unexpected room command: ${command}`);
    const { request } = DesktopRoomRequestSchema.parse(args?.request);
    if (request.kind === 'pull') {
      const next = deliveries.shift();
      if (!next) throw new Error('Unexpected pull');
      expect(request.subscriptionId).toBe(next.batch.subscriptionId);
      next.pulled.resolve();
      return { kind: 'batch', batch: next.batch };
    }
    if (request.kind === 'ack') {
      const delivery = awaitingAck.get(request.batchId);
      if (!delivery) throw new Error('Unexpected acknowledgement');
      expect(request).toMatchObject({ subscriptionId: delivery.batch.subscriptionId, sequence: delivery.batch.sequence });
      awaitingAck.delete(request.batchId);
      delivery.ackEntered.resolve();
      return delivery.ack.promise;
    }
    if (request.kind === 'end-generation-start-tracking') {
      if (endFails) throw new Error('Lost end receipt');
      if (pendingIntent?.intentId !== request.intentId || !pendingIntent.roomId) throw new Error('Wrong start token');
      if (pendingIntent.cancelMode === 'starting-v1') {
        if (generationStartFence?.cancelIntentId !== request.intentId) throw new Error('Wrong cancel fence');
      } else {
        if (!pendingIntent.generationStart) throw new Error('Wrong start token');
        generationStartFence = { roomId: pendingIntent.roomId, generationRequestId: pendingIntent.generationStart.generationRequestId };
      }
      pendingIntent = null;
      return { kind: 'generation-start-tracking-ended', intentId: request.intentId, ended: true, generationStartBlocked: true, generationStartFence };
    }
    if (request.kind === 'end-proposal-tracking') {
      if (endFails) throw new Error('Lost end receipt');
      if (pendingIntent?.intentId !== request.intentId) throw new Error('Wrong proposal token');
      pendingIntent = null; return { kind: 'proposal-tracking-ended', intentId: request.intentId, ended: true };
    }
    if (request.kind === 'end-config-tracking') {
      if (endFails) throw new Error('Lost end receipt');
      if (pendingIntent?.intentId !== request.intentId) throw new Error('Wrong config token');
      pendingIntent = null; return { kind: 'config-tracking-ended', intentId: request.intentId, ended: true };
    }
    requests.push(request);
    const plan = plans.shift();
    if (!plan || request.kind !== plan.kind) throw new Error(`Unexpected HTTP action: ${request.kind}`);
    plan.entered.resolve(request);
    return plan.response.promise;
  });
  const randomId = vi.fn(() => createRequest.creationRequestId);
  const session = new DesktopArenaRoomSession({
    invoke, account, randomId, canStart: () => canStart,
    documentNonce: () => { if (nonceThrows) throw new Error('Document unavailable'); return nonce; },
    createChannel: () => { const channel = { onmessage: (_value: unknown) => undefined }; channels.push(channel); return channel; },
  });
  sessions.push(session);
  const plan = (kind: HttpPlan['kind']) => {
    const value = { kind, requestId: `request-${++requestCount}`, entered: deferred<DesktopRoomHttpAction>(), response: deferred<unknown>() };
    plans.push(value);
    return { ...value, accept: () => value.response.resolve({ kind: 'accepted', handle: fixture.attach.handle, subscriptionId, requestId: value.requestId }) };
  };
  const emit = (event: DesktopRoomEvent) => {
    const batch = DesktopRoomBatchSchema.parse({ handle: fixture.attach.handle, subscriptionId, sequence: sequence++, batchId: `batch-${sequence}`, event });
    const delivery = { batch, pulled: deferred<void>(), ackEntered: deferred<void>(), ack: deferred<unknown>() };
    deliveries.push(delivery); awaitingAck.set(batch.batchId, delivery);
    channels.at(-1)!.onmessage({ type: 'available', handle: batch.handle, subscriptionId, sequence: batch.sequence });
    return { ...delivery, acknowledge: (patch: Record<string, unknown> = {}) => delivery.ack.resolve({
      kind: 'acknowledged', handle: batch.handle, subscriptionId: batch.subscriptionId,
      batchId: batch.batchId, sequence: batch.sequence, accepted: true,
      ...(event.kind === 'generation-fragment' && event.final ? { generationRead: { requestId: event.requestId, current: true } } : {}), ...patch,
    }) };
  };
  const receive = async (event: DesktopRoomEvent) => {
    const delivery = emit(event);
    await delivery.ackEntered.promise;
    delivery.acknowledge();
  };
  return { session, account, invoke, randomId, requests, channels, plan, emit, receive,
    holdAttach: () => {
      const gate = { entered: deferred<DesktopRoomAttachResponse>(), response: deferred<unknown>() };
      attachGates.push(gate); return gate;
    },
    subscriptions: () => invoke.mock.calls.filter(([command]) => command === DESKTOP_ROOM_IPC_COMMANDS.subscribe),
    setNonce: (value: string | undefined) => { nonce = value; },
    throwNonce: () => { nonceThrows = true; },
    setCanStart: (value: boolean) => { canStart = value; },
    setEndFails: () => { endFails = true; },
    setFence: (value: DesktopRoomAttachResponse['generationStartFence']) => { generationStartFence = value; },
    setPending: (value: DesktopRoomAttachResponse['pendingIntent']) => { pendingIntent = value; },
  };
}
type Harness = Awaited<ReturnType<typeof harness>>;

async function joinRoom(h: Harness, result = member) {
  await h.session.open();
  const request = h.plan('join');
  const joining = h.session.join(member.roomId, member.self.displayName);
  await request.entered.promise;
  request.accept(); await joining;
  const ready = whenState(h.session, state => !state.busy && state.phase === 'connecting');
  await h.receive(success('join', request.requestId, result));
  await ready;
}

const proposal: ArenaProposal = {
  proposalVersion: 1, proposalId: 'desktop-proposal-1', roomId: host.roomId, authorUserId: String(member.self.userId),
  baseRevision: host.snapshot.revision, status: 'submitted', createdAt: '2026-10-01T00:00:00Z',
  changes: [{ type: 'setUserGuidance', changeId: 'guidance', value: 'proposal guidance', expectedBase: { kind: 'value', value: host.snapshot.sharedConfig!.userGuidance } },
    { type: 'setSelectedLanguage', changeId: 'language', value: 'zh-CN', expectedBase: { kind: 'value', value: host.snapshot.sharedConfig!.selectedLanguage } }],
};
const proposalHost = (value: ArenaProposal = proposal): ArenaRoomSessionResponse => ArenaRoomSessionResponseSchema.parse({
  ...host, snapshot: { ...host.snapshot, proposals: [value] },
});
const rejectProposal = (session: ArenaRoomSessionResponse): ArenaRoomProposalResolveRequest => ({ expectedRoomEpoch: session.roomEpoch, resolution: 'reject' });
async function installOnlineSnapshot(h: Harness, value: ArenaRoomSessionResponse) {
  const event = socket('room.snapshot');
  if (event.kind !== 'socket' || event.message.type !== 'room.snapshot') throw new Error('Missing room snapshot');
  await h.receive(DesktopRoomEventSchema.parse({ kind: 'socket', message: { ...event.message, roomId: value.roomId, roomEpoch: value.roomEpoch,
    controlSeq: value.snapshot.controlSeq, payload: value.snapshot } }));
  await h.receive({ kind: 'status', state: 'online' });
  await whenState(h.session, state => state.phase === 'online' && state.snapshotReceived && !state.busy);
}
async function joinProposalHost(h: Harness, value = proposalHost()) {
  await joinRoom(h, value); await installOnlineSnapshot(h, value); return h.session.getSnapshot().session!;
}
const resolved = (requestId: string, value: ArenaRoomSessionResponse, proposalId = proposal.proposalId): DesktopRoomEvent => DesktopRoomEventSchema.parse({
  kind: 'http-result', operation: 'proposalResolve', requestId, response: { ...proposalFixture.proposalResolve.success,
    result: { ...proposalFixture.proposalResolve.success.result, proposalId, roomId: value.roomId, roomEpoch: value.roomEpoch,
      revision: value.snapshot.revision, controlSeq: value.snapshot.controlSeq, sharedConfig: value.snapshot.sharedConfig, snapshot: value.snapshot } },
});

it('permits local editing only for the current online active host without an active generation', async () => {
  const h = await harness();
  const value = ArenaRoomSessionResponseSchema.parse({ ...host, snapshot: { ...host.snapshot, activeGeneration: null } });
  await joinRoom(h, value); expect(h.session.canEditHostDraft()).toBe(false);
  await installOnlineSnapshot(h, value); expect(h.session.canEditHostDraft()).toBe(true);
  await h.receive({ kind: 'status', state: 'offline' }); expect(h.session.canEditHostDraft()).toBe(false);
  await installOnlineSnapshot(h, value); expect(h.session.canEditHostDraft()).toBe(true);
  h.session.detach(); expect(h.session.canEditHostDraft()).toBe(false);
  const m = await harness(); await joinRoom(m); await installOnlineSnapshot(m, member);
  expect(m.session.canEditHostDraft()).toBe(false);
});

describe('Desktop Arena Room session through the real Native bridge', () => {
  const startHost = () => ArenaRoomSessionResponseSchema.parse({ ...host, snapshot: { ...host.snapshot,
    activeGeneration: null, sharedConfig: { ...host.snapshot.sharedConfig, battleMode: 'daily', combatants: [host.snapshot.sharedConfig.combatants[0]], teams: [], scenario: null, auxScenarios: [], materials: [] } } });
  const startBundle = (value: ArenaRoomSessionResponse): ArenaRoomHostWorkspaceBundle => ({ sharedConfig: value.snapshot.sharedConfig, hostLocalPayloads: [], hostLocalContentDigests: [] });
  const pendingStart = (value: ArenaRoomSessionResponse, id: string, retryable = true) => ({ operation: 'generationStart' as const, intentId: id, roomId: value.roomId,
    generationStart: { roomEpoch: value.roomEpoch, generationRequestId: createRequest.creationRequestId, retryable } });

  const unavailableRead = (id: string): DesktopRoomEvent => ({ kind: 'request-error', requestId: id, operation: 'generationRead',
    error: { code: 'network-error', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'not-applicable' } });
  async function reservedStart() {
    const h = await harness();
    const { finishedAt: _finished, ...generation } = generationFixture.operation.success.result.generation;
    const value = ArenaRoomSessionResponseSchema.parse({ ...startHost(), snapshot: { ...startHost().snapshot,
      activeGeneration: { ...generation, state: 'starting', generationRequestId: createRequest.creationRequestId } } });
    const pending = pendingStart(value, 'original-start'); h.setPending(pending); await h.session.open();
    const session = h.plan('session'), checking = h.session.reconcile(); await session.entered.promise; session.accept(); await checking;
    await h.receive(success('session', session.requestId, value)); await whenState(h.session, state => !state.busy && state.phase === 'connecting');
    const read = h.plan('generation-read'); await installOnlineSnapshot(h, value); await read.entered.promise; read.accept();
    await h.receive(unavailableRead(read.requestId)); await whenState(h.session, state => !state.generationReading);
    return { h, value, pending };
  }
  it('hands one starting intent to cancellation, retains unknown on old-server rejection, and exits without unlocking new start', async () => {
    const { h, value, pending } = await reservedStart();
    const target = captureArenaRoomGenerationCancelTarget(h.session.getSnapshot().session)!, identity = h.session.confirmationOwner()!;
    expect(h.session.startingCancelBlockedReason()).toBeNull();
    const cancel = h.plan('cancel-generation-start'), sending = h.session.cancelPendingStart(pending.intentId, target, identity);
    expect(await cancel.entered.promise).toEqual({ kind: 'cancel-generation-start', intentId: pending.intentId });
    await h.session.cancelPendingStart(pending.intentId, target, identity);
    await h.session.retryStartGeneration(pending.intentId, identity);
    cancel.accept(); await sending;
    const next = { operation: 'generationCancel' as const, roomId: value.roomId, intentId: cancel.requestId,
      generationTarget: { roomEpoch: value.roomEpoch, generationId: target.generationId, attempt: target.attempt }, cancelMode: 'starting-v1' as const, startIntentId: pending.intentId };
    const fence = { roomId: value.roomId, generationRequestId: pending.generationStart.generationRequestId, cancelMode: 'starting-v1' as const, startIntentId: pending.intentId, cancelIntentId: cancel.requestId };
    h.setPending(next); h.setFence(fence);
    const read = h.plan('generation-read');
    await h.receive({ kind: 'request-error', requestId: cancel.requestId, operation: 'generationCancel',
      error: { code: 'service-rejected', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'unknown', serverCode: 'ROOM_DESKTOP_PROTOCOL_INVALID' } });
    await read.entered.promise; read.accept(); await h.receive(unavailableRead(read.requestId)); await whenState(h.session, state => !state.busy && !state.generationReading);
    expect(h.session.getSnapshot()).toMatchObject({ unknown: next, generationStartBlocked: true, phase: 'online', snapshotReceived: true });
    // Already delivered old start evidence may pay its own delivery debt, but cannot restore its retry UI.
    await h.receive({ kind: 'mutation-unknown', ...pending });
    expect(h.session.getSnapshot().unknown).toMatchObject(next);
    await h.session.endGenerationStartTracking(cancel.requestId, h.session.confirmationOwner()!);
    expect(h.session.getSnapshot()).toMatchObject({ unknown: null, session: null, constrained: false, phase: 'ready', generationStartBlocked: true, generationStartFence: fence });
    const discovery = h.plan('discover'), discovering = h.session.discover(); await discovery.entered.promise; discovery.accept(); await discovering;
    await h.receive(success('discover', discovery.requestId)); await whenState(h.session, state => !state.busy);
    expect(h.requests.filter(item => ['cancel-generation-start', 'retry-generation-start', 'generation-start'].includes(item.kind))).toEqual([{ kind: 'cancel-generation-start', intentId: pending.intentId }]);
  });
  it.each(['http', 'socket'] as const)('accepts terminal %s evidence notified before the handoff invoke returns', async transport => {
    const { h, value, pending } = await reservedStart();
    const target = captureArenaRoomGenerationCancelTarget(h.session.getSnapshot().session)!;
    const cancel = h.plan('cancel-generation-start'), sending = h.session.cancelPendingStart(pending.intentId, target, h.session.confirmationOwner()!);
    await cancel.entered.promise;
    const terminal = { ...value.snapshot.activeGeneration!, state: 'cancelled', finishedAt: '2026-10-12T00:02:00.000Z' };
    const event = transport === 'http' ? { kind: 'http-result', requestId: cancel.requestId, operation: 'generationCancel', response: {
      desktopRoom: { version: 'desktop-room-session-v1', viewerUserId: fixture.expectedUserId },
      result: { protocolVersion: 1, roomId: value.roomId, roomEpoch: value.roomEpoch, generation: terminal, status: 'cancelled' } } }
      : { kind: 'socket', message: { type: 'room.snapshot', protocolVersion: 1, roomId: value.roomId, roomEpoch: value.roomEpoch,
        controlSeq: value.snapshot.controlSeq + 1, timestamp: '2026-10-12T00:02:00.000Z', payload: { ...value.snapshot, controlSeq: value.snapshot.controlSeq + 1, activeGeneration: terminal } } };
    const delivery = h.emit(DesktopRoomEventSchema.parse(event));
    // The real bridge serializes framework invokes: queued evidence is pulled
    // after this invoke returns, even when Native notified it first.
    cancel.accept(); await sending; await delivery.ackEntered.promise;
    const read = h.plan('generation-read');
    delivery.acknowledge({ generationCancel: { intentId: cancel.requestId, current: true } });
    await whenState(h.session, state => state.unknown === null);
    expect(h.session.getSnapshot().generationStartBlocked).toBe(false);
    await read.entered.promise; read.accept(); await h.receive(unavailableRead(read.requestId)); await whenState(h.session, state => !state.generationReading);
    expect(h.session.getSnapshot()).toMatchObject({ unknown: null, generationStartBlocked: false });
    await h.receive({ kind: 'mutation-unknown', ...pending });
    expect(h.session.getSnapshot().unknown).toBeNull();
  });
  it('prevents handoff while an already-consumed old start observation awaits its ACK', async () => {
    const { h, value, pending } = await reservedStart();
    const target = captureArenaRoomGenerationCancelTarget(h.session.getSnapshot().session)!;
    const delivery = h.emit(DesktopRoomEventSchema.parse({ kind: 'socket', message: { type: 'room.snapshot', protocolVersion: 1,
      roomId: value.roomId, roomEpoch: value.roomEpoch, controlSeq: value.snapshot.controlSeq + 1, timestamp: '2026-10-12T00:02:00.000Z',
      payload: { ...value.snapshot, controlSeq: value.snapshot.controlSeq + 1, activeGeneration: { ...value.snapshot.activeGeneration!, state: 'running' } } } }));
    await delivery.ackEntered.promise;
    await h.session.cancelPendingStart(pending.intentId, target, h.session.confirmationOwner()!);
    expect(h.requests.some(item => item.kind === 'cancel-generation-start')).toBe(false);
    const read = h.plan('generation-read');
    delivery.acknowledge({ generationStart: { intentId: pending.intentId, current: true } });
    await read.entered.promise; read.accept(); await h.receive(unavailableRead(read.requestId));
    await whenState(h.session, state => !state.generationReading && state.unknown === null);
    expect(h.session.getSnapshot()).toMatchObject({ unknown: null, generationStartBlocked: false, busy: false });
    await h.session.retryStartGeneration(pending.intentId, h.session.confirmationOwner()!);
    expect(h.requests.some(item => item.kind === 'retry-generation-start')).toBe(false);
  });
  it('preserves the original start only when Native refuses handoff before admission', async () => {
    const { h, pending } = await reservedStart();
    const target = captureArenaRoomGenerationCancelTarget(h.session.getSnapshot().session)!;
    const cancel = h.plan('cancel-generation-start'), sending = h.session.cancelPendingStart(pending.intentId, target, h.session.confirmationOwner()!);
    await cancel.entered.promise;
    cancel.response.reject({ code: 'busy', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'not-applied' }); await sending;
    expect(h.session.getSnapshot()).toMatchObject({ unknown: pending, generationStartBlocked: false, busy: false, phase: 'online', snapshotReceived: true });
  });

  it('freezes one visible start and keeps an unknown intent through a pre-business retry refusal', async () => {
    const h = await harness(), value = startHost(); await joinProposalHost(h, value);
    const current = h.session.getSnapshot().session!, identity = h.session.confirmationOwner()!;
    const source = { bundle: startBundle(current), generation: { narrativeHistory: ['frozen source'] } };
    const start = h.plan('generation-start'); const sending = h.session.startGeneration(current, identity, async () => source, () => true);
    const action = await start.entered.promise;
    expect(action).toMatchObject({ kind: 'generation-start', request: { generationRequestId: createRequest.creationRequestId, generation: source.generation } });
    start.accept(); await sending;
    const pending = pendingStart(value, start.requestId); h.setPending(pending);
    await h.receive({ kind: 'mutation-unknown', ...pending });
    await h.receive({ kind: 'request-error', operation: 'generationStart', requestId: start.requestId, error: fixture.error });
    await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'online', unknown: pending });
    const retried = h.plan('retry-generation-start'); const retrying = h.session.retryStartGeneration(pending.intentId, h.session.confirmationOwner()!);
    expect(await retried.entered.promise).toEqual({ kind: 'retry-generation-start', intentId: start.requestId }); retried.accept(); await retrying;
    await h.receive({ kind: 'request-error', operation: 'generationStart', requestId: retried.requestId, error: { ...fixture.error, outcome: 'not-applied' } });
    await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot().unknown).toMatchObject(pending);
    expect(h.requests.map(request => request.kind)).toEqual(['join', 'generation-start', 'retry-generation-start']);
  });
  it('freezes a bounded non-secret BYOK selection before source preparation awaits', async () => {
    const h = await harness(), value = startHost(); await joinProposalHost(h, value);
    const current = h.session.getSnapshot().session!, gate = deferred<{ bundle: ArenaRoomHostWorkspaceBundle; generation: object }>();
    const presetConfig = { providerId: 'deepseek', modelId: 'deepseek-v4-flash', generationOverrides: { temperature: 0.5 } };
    const start = h.plan('generation-start');
    const sending = h.session.startGeneration(current, h.session.confirmationOwner()!, () => gate.promise, () => true, presetConfig);
    presetConfig.modelId = 'changed'; presetConfig.generationOverrides.temperature = 1;
    gate.resolve({ bundle: startBundle(current), generation: {} });
    expect(await start.entered.promise).toMatchObject({ presetConfig: { providerId: 'deepseek', modelId: 'deepseek-v4-flash', generationOverrides: { temperature: 0.5 } } });
    start.accept(); await sending;
  });
  it.each(['source-change', 'authority-change', 'prepare-failure'] as const)('refuses source preparation after %s without a start invocation', async kind => {
    const h = await harness(), value = startHost(); await joinProposalHost(h, value);
    const current = h.session.getSnapshot().session!, gate = deferred<{ bundle: ArenaRoomHostWorkspaceBundle; generation: object }>();
    let fresh = true;
    const sending = h.session.startGeneration(current, h.session.confirmationOwner()!, () => gate.promise, () => fresh);
    if (kind === 'source-change') fresh = false;
    if (kind === 'authority-change') await h.receive({ kind: 'status', state: 'offline' });
    if (kind === 'prepare-failure') gate.reject(new Error('private source failure')); else gate.resolve({ bundle: startBundle(current), generation: {} });
    await sending; expect(h.requests.map(request => request.kind)).toEqual(['join']);
    expect(h.session.getSnapshot()).toMatchObject({ busy: false, unknown: null });
  });
  it('explicitly stops local start tracking, returns to the lobby and allows another room without removing the start fence', async () => {
    const h = await harness(), value = startHost(), pending = pendingStart(value, 'original-start'); h.setPending(pending);
    await h.session.open();
    expect(h.session.getSnapshot().unknown).toMatchObject(pending);
    await h.session.endGenerationStartTracking(pending.intentId, h.session.confirmationOwner()!);
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'ready', busy: false, unknown: null, session: null, constrained: false,
      generationStartBlocked: true, generationStartFence: { roomId: value.roomId, generationRequestId: createRequest.creationRequestId } });
    const discovery = h.plan('discover'), discovering = h.session.discover(); await discovery.entered.promise; discovery.accept(); await discovering;
    await h.receive(success('discover', discovery.requestId)); await whenState(h.session, state => !state.busy);
    const joining = h.plan('join'), join = h.session.join('another-room', 'host'); await joining.entered.promise; joining.accept(); await join;
    const other = ArenaRoomSessionResponseSchema.parse({ ...value, roomId: 'another-room', snapshot: { ...value.snapshot, roomId: 'another-room' } });
    await h.receive(success('join', joining.requestId, other)); await whenState(h.session, state => state.phase === 'connecting' && !state.busy);
    await installOnlineSnapshot(h, other);
    const prepare = vi.fn(async () => ({ bundle: startBundle(other), generation: {} }));
    await h.session.startGeneration(h.session.getSnapshot().session!, h.session.confirmationOwner()!, prepare, () => true);
    expect(prepare).not.toHaveBeenCalled(); expect(h.session.startGenerationBlockedReason()).toContain('防重复记录');
    expect(h.requests.map(request => request.kind)).toEqual(['discover', 'join']);
  });
  it('keeps a lost stop-tracking receipt unresolved until an explicit attach reads the Native state', async () => {
    const h = await harness(), pending = pendingStart(startHost(), 'original-start'); h.setPending(pending); await h.session.open(); h.setEndFails();
    await h.session.endGenerationStartTracking(pending.intentId, h.session.confirmationOwner()!);
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'unavailable', unknown: pending });
    h.setPending(null); h.setFence({ roomId: pending.roomId, generationRequestId: pending.generationStart.generationRequestId });
    await h.session.open(); expect(h.session.getSnapshot()).toMatchObject({ phase: 'ready', unknown: null, generationStartBlocked: true });
    expect(h.requests).toEqual([]);
  });
  it('owns an isolated member draft, follows clean revisions and retains dirty stale input until explicit sync', async () => {
    const h = await harness(); await joinRoom(h); await installOnlineSnapshot(h, member);
    const model = h.session.getSnapshot().memberModel!;
    expect(model.store.getState().editor.workingConfig).toEqual(member.snapshot.sharedConfig);
    const clean = { ...member, snapshot: { ...member.snapshot, revision: member.snapshot.revision + 1, controlSeq: member.snapshot.controlSeq + 1,
      sharedConfig: { ...member.snapshot.sharedConfig, userGuidance: 'new authority' } } };
    await installOnlineSnapshot(h, clean);
    expect(h.session.getSnapshot().memberModel).toBe(model);
    expect(model.store.getState().editor).toMatchObject({ dirty: false, baselineRevision: clean.snapshot.revision, workingConfig: { userGuidance: 'new authority' } });
    model.actions.setUserGuidance('member working');
    const preview = model.preparePreview('frozen-member-preview');
    const dirty = { ...clean, snapshot: { ...clean.snapshot, revision: clean.snapshot.revision + 1, controlSeq: clean.snapshot.controlSeq + 1,
      sharedConfig: { ...clean.snapshot.sharedConfig, userGuidance: 'newer authority' } } };
    await installOnlineSnapshot(h, dirty);
    expect(model.isPreviewCurrent(preview)).toBe(false);
    expect(model.store.getState().editor).toMatchObject({ dirty: true, stale: true, baselineRevision: clean.snapshot.revision, workingConfig: { userGuidance: 'member working' } });
    const current = h.session.getSnapshot().session!;
    h.session.syncMemberProposal(current, h.session.confirmationOwner()!);
    expect(model.store.getState().editor).toMatchObject({ dirty: false, stale: false, workingConfig: { userGuidance: 'newer authority' } });
  });

  it.each(['offline', 'resync-status', 'resync-socket', 'control-gap', 'same-revision-conflict'] as const)(
    'permanently expires member confirmation and source generation across %s with identical recovery', async loss => {
      const h = await harness(); await joinRoom(h); await installOnlineSnapshot(h, member);
      const identity = h.session.confirmationOwner(), model = h.session.getSnapshot().memberModel!;
      model.actions.setUserGuidance('retain the complete dirty draft');
      const editor = model.store.getState().editor, generation = model.store.getState().generation;
      const preview = model.preparePreview('before-freshness-loss');
      const snapshot = socket('room.snapshot');
      if (snapshot.kind !== 'socket' || snapshot.message.type !== 'room.snapshot') throw new Error('Missing snapshot');
      const event = loss === 'offline' ? { kind: 'status', state: 'offline' }
        : loss === 'resync-status' ? { kind: 'status', state: 'resync-required' }
        : loss === 'resync-socket' ? { kind: 'socket', message: { protocolVersion: 1, type: 'room.resync.required', reason: 'replay-unavailable' } }
        : loss === 'control-gap' ? { kind: 'socket', message: { ...snapshot.message, type: 'room.config.updated',
          roomId: member.roomId, roomEpoch: member.roomEpoch, controlSeq: member.snapshot.controlSeq + 2,
          payload: { revision: member.snapshot.revision + 1, sharedConfig: member.snapshot.sharedConfig } } }
        : { kind: 'socket', message: { ...snapshot.message, roomId: member.roomId, roomEpoch: member.roomEpoch,
          controlSeq: member.snapshot.controlSeq, payload: { ...member.snapshot,
            sharedConfig: { ...member.snapshot.sharedConfig, userGuidance: 'inconsistent same revision' } } } };
      await h.receive(DesktopRoomEventSchema.parse(event));
      expect(h.session.getSnapshot().snapshotReceived).toBe(false);
      expect(model.store.getState().editor).toEqual(editor);
      expect(model.isPreviewCurrent(preview)).toBe(false);
      expect(model.store.getState().generation).toBe(generation + 1);
      // Repeated loss notifications must not continually rotate the source scope.
      await h.receive(DesktopRoomEventSchema.parse(event));
      expect(model.store.getState().generation).toBe(generation + 1);
      await installOnlineSnapshot(h, member);
      expect(h.session.confirmationOwner()).toBe(identity);
      expect(h.session.getSnapshot().memberModel).toBe(model);
      expect(model.store.getState().editor).toEqual(editor);
      expect(model.isPreviewCurrent(preview)).toBe(false);
      expect(() => model.takePreviewIntent(preview)).toThrow('提案预览已失效');
      expect(model.store.getState().generation).toBe(generation + 1);
      const renewed = model.preparePreview('after-freshness-recovery');
      // A repeated online notification and identical authority are not a new loss boundary.
      await installOnlineSnapshot(h, member);
      expect(model.store.getState().generation).toBe(generation + 1);
      expect(model.isPreviewCurrent(renewed)).toBe(true);
      expect(model.takePreviewIntent(renewed).changes).toEqual(preview.intent!.changes);
      expect(h.requests.map(value => value.kind)).toEqual(['join']);
    });

  it('expires member confirmation at a fresh read start, retaining dirty values through the new subscription', async () => {
    const h = await harness(); await joinRoom(h); await installOnlineSnapshot(h, member);
    const identity = h.session.confirmationOwner(), model = h.session.getSnapshot().memberModel!;
    model.actions.setUserGuidance('keep on explicit fresh read');
    const editor = model.store.getState().editor, generation = model.store.getState().generation;
    const preview = model.preparePreview('before-fresh-read');
    const read = h.plan('session'), reading = h.session.reconnect(); await read.entered.promise;
    expect(h.session.getSnapshot().snapshotReceived).toBe(false);
    expect(model.isPreviewCurrent(preview)).toBe(false);
    expect(model.store.getState().generation).toBe(generation + 1);
    read.accept(); await reading;
    await h.receive(success('session', read.requestId, member));
    await whenState(h.session, state => !state.busy && state.phase === 'connecting');
    await installOnlineSnapshot(h, member);
    expect(h.session.confirmationOwner()).toBe(identity);
    expect(h.session.getSnapshot().memberModel).toBe(model);
    expect(model.store.getState().editor).toEqual(editor);
    expect(model.store.getState().generation).toBe(generation + 1);
    expect(model.isPreviewCurrent(preview)).toBe(false);
    expect(model.isPreviewCurrent(model.preparePreview('after-fresh-read'))).toBe(true);
  });

  it('requires explicit replacement across room epochs and destroys the member model on owner loss', async () => {
    const h = await harness(); await joinRoom(h); await installOnlineSnapshot(h, member);
    const model = h.session.getSnapshot().memberModel!;
    model.actions.setUserGuidance('keep across epoch');
    const next = { ...member, roomEpoch: 'next-epoch', snapshot: { ...member.snapshot, roomEpoch: 'next-epoch' } };
    await installOnlineSnapshot(h, next);
    expect(model.store.getState().editor).toMatchObject({ replacementRequired: true, workingConfig: { userGuidance: 'keep across epoch' } });
    const current = h.session.getSnapshot().session!;
    h.session.syncMemberProposal(current, h.session.confirmationOwner()!);
    expect(model.store.getState().editor).toMatchObject({ replacementRequired: false, baselineEpoch: 'next-epoch' });
    h.session.detach();
    expect(model.store.getState().disposed).toBe(true);
    expect(h.session.getSnapshot().memberModel).toBeNull();
    expect(() => model.actions.setUserGuidance('late')).toThrow();
  });

  it('submits a frozen old-baseline member intent once and only settles its summary on exact ACK', async () => {
    const h = await harness(); await joinRoom(h); await installOnlineSnapshot(h, member);
    const model = h.session.getSnapshot().memberModel!;
    model.actions.setUserGuidance('member intent');
    const newer = { ...member, snapshot: { ...member.snapshot, revision: member.snapshot.revision + 1, controlSeq: member.snapshot.controlSeq + 1,
      sharedConfig: { ...member.snapshot.sharedConfig, selectedLanguage: 'en-US' } } };
    await installOnlineSnapshot(h, newer);
    const current = h.session.getSnapshot().session!, identity = h.session.confirmationOwner()!;
    const preview = model.preparePreview('desktop-member-submit');
    const intent = model.takePreviewIntent(preview);
    expect(intent.baseRevision).toBe(member.snapshot.revision);
    const request = h.plan('proposal-submit'); const submitting = h.session.submitProposal(current, intent, identity);
    expect(await request.entered.promise).toEqual({ kind: 'proposal-submit', roomId: member.roomId, request: intent });
    request.accept(); await submitting;
    await h.session.submitProposal(current, intent, identity);
    expect(h.requests.map(value => value.kind)).toEqual(['join', 'proposal-submit']);
    const sourceGeneration = model.store.getState().generation;
    const receipt = DesktopRoomEventSchema.parse({ kind: 'http-result', operation: 'proposalSubmit', requestId: request.requestId,
      response: { ...proposalFixture.proposalSubmit.success, result: { ...proposalFixture.proposalSubmit.success.result, proposalId: intent.proposalId, revision: 999, controlSeq: 999 } } });
    const delivery = h.emit(receipt); await delivery.ackEntered.promise;
    expect(h.session.getSnapshot()).toMatchObject({ busy: true, snapshotReceived: false, proposalTracking: { phase: 'resolving', intent: { request: intent } } });
    expect(h.session.getSnapshot().session).toBe(current);
    expect(model.store.getState().generation).toBe(sourceGeneration + 1);
    delivery.acknowledge(); await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot().proposalTracking?.phase).toBe('settled');
    expect(h.session.getSnapshot().session?.snapshot.controlSeq).toBe(current.snapshot.controlSeq);
    expect(h.session.getSnapshot().memberModel).toBe(model);
    expect(h.session.memberProposalBlockedReason()).toContain('完整房间快照');
    expect(h.subscriptions()).toHaveLength(1);
  });

  it('keeps involuntary membership loss read-only until explicit discard, while account loss destroys the draft', async () => {
    const h = await harness(); await joinRoom(h); await installOnlineSnapshot(h, member);
    const model = h.session.getSnapshot().memberModel!; model.actions.setUserGuidance('retain lost-membership input');
    const preview = model.preparePreview('before-membership-loss');
    await h.receive({ kind: 'status', state: 'closed' });
    expect(h.session.getSnapshot()).toMatchObject({ session: null, memberModel: model, constrained: true });
    expect(model.store.getState().disposed).toBe(false); expect(model.isPreviewCurrent(preview)).toBe(false);
    expect(h.session.memberWorkspaceSession()?.roomId).toBe(member.roomId);
    expect(h.session.memberProposalBlockedReason()).toContain('没有可写的成员资格');
    await h.session.join(member.roomId, 'cannot replace retained draft');
    expect(h.requests.map(value => value.kind)).toEqual(['join']);
    await h.account.signOut();
    expect(model.store.getState().disposed).toBe(true); expect(h.session.getSnapshot().memberModel).toBeNull();
    expect(h.session.memberWorkspaceSession()).toBeNull();
  });

  it.each(['kick', 'close'] as const)('retains %s socket loss read-only and discards only on explicit detach', async loss => {
    const h = await harness(); await joinRoom(h); await installOnlineSnapshot(h, member);
    const model = h.session.getSnapshot().memberModel!; model.actions.setUserGuidance('unsubmitted member input');
    if (loss === 'kick') {
      const snapshot = socket('room.snapshot');
      if (snapshot.kind !== 'socket' || snapshot.message.type !== 'room.snapshot') throw new Error('Missing snapshot');
      await h.receive(DesktopRoomEventSchema.parse({ kind: 'socket', message: { ...snapshot.message,
        roomId: member.roomId, roomEpoch: member.roomEpoch, controlSeq: member.snapshot.controlSeq + 1,
        payload: { ...member.snapshot, controlSeq: member.snapshot.controlSeq + 1, members: member.snapshot.members.filter(value => value.userId !== member.self.userId) } } }));
    } else {
      const previous = socket('room.snapshot'); if (previous.kind !== 'socket') throw new Error('Missing snapshot');
      await h.receive(DesktopRoomEventSchema.parse({ kind: 'socket', message: { ...previous.message, type: 'room.closing', payload: {}, roomId: member.roomId, roomEpoch: member.roomEpoch, controlSeq: member.snapshot.controlSeq + 1 } }));
    }
    expect(h.session.getSnapshot()).toMatchObject({ session: null, snapshotReceived: false, memberModel: model, constrained: true });
    expect(model.exportSharedConfig().userGuidance).toBe('unsubmitted member input');
    expect(h.session.needsLeaveConfirmation()).toBe(true);
    h.session.detach();
    expect(model.store.getState().disposed).toBe(true);
    expect(h.session.getSnapshot()).toMatchObject({ memberModel: null, session: null, constrained: false });
    expect(h.session.memberWorkspaceSession()).toBeNull();
  });

  it('retains dirty values through Native owner renewal and explicit end, without reviving the old model', async () => {
    const h = await harness(); await joinRoom(h); await installOnlineSnapshot(h, member);
    const original = h.session.getSnapshot().memberModel!;
    original.actions.setUserGuidance('unsent draft survives');
    const preview = original.preparePreview('desktop-member-unknown');
    const intent = original.takePreviewIntent(preview), current = h.session.getSnapshot().session!;
    const request = h.plan('proposal-submit'); const submitting = h.session.submitProposal(current, intent, h.session.confirmationOwner()!);
    await request.entered.promise; request.accept(); await submitting;
    const pending = { operation: 'proposalSubmit' as const, roomId: member.roomId, intentId: 'member-unknown' };
    h.setPending(pending);
    await h.receive({ kind: 'mutation-unknown', ...pending });
    await h.receive({ kind: 'request-error', operation: 'proposalSubmit', requestId: request.requestId,
      error: { code: 'network-error', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'unknown' } });
    await whenState(h.session, state => !state.busy);
    await h.session.open();
    const recovered = h.session.getSnapshot().memberModel!;
    expect(original.store.getState().disposed).toBe(true);
    expect(original.isPreviewCurrent(preview)).toBe(false);
    expect(recovered).not.toBe(original);
    expect(recovered.store.getState().editor).toMatchObject({ dirty: true, baselineRevision: intent.baseRevision, workingConfig: { userGuidance: 'unsent draft survives' } });
    expect(h.session.getSnapshot().proposalTracking?.intent).toMatchObject({ kind: 'proposal-submit', request: intent });
    await h.session.endProposalTracking(pending.intentId);
    expect(h.session.getSnapshot()).toMatchObject({ session: null, memberModel: recovered, proposalTracking: { phase: 'ended-needs-read' } });
    expect(recovered.store.getState().disposed).toBe(false);
    const read = h.plan('session'); const reading = h.session.readProposalAfterEnd(); await read.entered.promise; read.accept(); await reading;
    const replacement = h.session.getSnapshot().memberModel!;
    expect(replacement).not.toBe(recovered);
    expect(recovered.store.getState().disposed).toBe(true);
    const newer = { ...member, snapshot: { ...member.snapshot, controlSeq: member.snapshot.controlSeq + 1, revision: member.snapshot.revision + 1,
      sharedConfig: { ...member.snapshot.sharedConfig, userGuidance: 'new authority' } } };
    await h.receive(success('session', read.requestId, newer)); await whenState(h.session, state => !state.busy);
    expect(replacement.store.getState().editor).toMatchObject({ dirty: true, stale: true, baselineRevision: intent.baseRevision, workingConfig: { userGuidance: 'unsent draft survives' } });
    expect(h.session.getSnapshot().proposalTracking).toBeNull();
    expect(h.requests.map(value => value.kind)).toEqual(['join', 'proposal-submit', 'session']);
  });

  it('allows only fresh active members to submit canonical IDs with a non-future baseline', async () => {
    const h = await harness(); await joinRoom(h);
    const model = h.session.getSnapshot().memberModel!; model.actions.setUserGuidance('member intent');
    const intent = model.takePreviewIntent(model.preparePreview('desktop-member-submit'));
    let current = h.session.getSnapshot().session!, identity = h.session.confirmationOwner()!;
    await h.session.submitProposal(current, intent, identity);
    await installOnlineSnapshot(h, member); current = h.session.getSnapshot().session!;
    await h.session.submitProposal(current, { ...intent, baseRevision: current.snapshot.revision + 1 }, identity);
    await h.session.submitProposal(current, { ...intent, proposalId: '../unsafe' }, identity);
    await h.session.submitProposal(current, intent, Symbol('old owner'));
    h.setCanStart(false); await h.session.submitProposal(current, intent, identity);
    h.setCanStart(true); h.session.detach(); await h.session.submitProposal(current, intent, identity);
    expect(h.requests.map(value => value.kind)).toEqual(['join']);
  });

  it('withdraws only the current member’s own exact pending proposal through Native', async () => {
    const h = await harness();
    const own = { ...member, snapshot: { ...member.snapshot, proposals: [proposal] } };
    await joinRoom(h, own); await installOnlineSnapshot(h, own);
    const current = h.session.getSnapshot().session!, identity = h.session.confirmationOwner()!;
    await h.session.withdrawProposal(current, 'missing', identity);
    const request = h.plan('proposal-withdraw'); const withdrawing = h.session.withdrawProposal(current, proposal.proposalId, identity);
    expect(await request.entered.promise).toEqual({ kind: 'proposal-withdraw', roomId: current.roomId, proposalId: proposal.proposalId, request: { expectedRoomEpoch: current.roomEpoch } });
    request.accept(); await withdrawing;
    await h.session.withdrawProposal(current, proposal.proposalId, identity);
    const receipt = DesktopRoomEventSchema.parse({ kind: 'http-result', operation: 'proposalWithdraw', requestId: request.requestId, response: proposalFixture.proposalWithdraw.success });
    await h.receive(receipt); await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot().proposalTracking).toMatchObject({ phase: 'settled', operation: 'proposalWithdraw' });
    expect(h.session.getSnapshot().session).toBe(current);
    expect(h.requests.map(value => value.kind)).toEqual(['join', 'proposal-withdraw']);
  });

  it('resolves a current host proposal through the fixed bridge and settles only its exact ACK', async () => {
    const h = await harness(); const current = await joinProposalHost(h);
    const request = h.plan('proposal-resolve');
    const resolving = h.session.resolveProposal(current, proposal, rejectProposal(current), h.session.confirmationOwner()!);
    expect(await request.entered.promise).toEqual({ kind: 'proposal-resolve', roomId: current.roomId, proposalId: proposal.proposalId, request: rejectProposal(current) });
    expect(h.session.getSnapshot().proposalTracking).toEqual({ id: null, roomId: current.roomId, proposalId: proposal.proposalId, operation: 'proposalResolve', phase: 'resolving', observation: null, intent: { kind: 'proposal-resolve', roomId: current.roomId, proposalId: proposal.proposalId, request: rejectProposal(current) } });
    request.accept(); await resolving;
    await h.session.resolveProposal(current, proposal, rejectProposal(current), h.session.confirmationOwner()!);
    expect(h.requests.map(value => value.kind)).toEqual(['join', 'proposal-resolve']);
    const result = { ...current, snapshot: { ...current.snapshot, proposals: [], controlSeq: current.snapshot.controlSeq + 1 } };
    const delivery = h.emit(resolved(request.requestId, result)); await delivery.ackEntered.promise;
    expect(h.session.getSnapshot()).toMatchObject({ busy: true, session: result, proposalTracking: { phase: 'resolving' } });
    expect(h.subscriptions()).toHaveLength(1);
    delivery.acknowledge(); await whenState(h.session, state => !state.busy && state.phase === 'connecting');
    expect(h.session.getSnapshot().proposalTracking).toMatchObject({ phase: 'settled', observation: null });
    expect(h.subscriptions()).toHaveLength(2);
  });

  it('keeps an ordinary selection and its old diagnostic revision after unrelated authority advances', async () => {
    const h = await harness(); const reviewed = await joinProposalHost(h);
    const latest = { ...reviewed, snapshot: { ...reviewed.snapshot, revision: reviewed.snapshot.revision + 1, controlSeq: reviewed.snapshot.controlSeq + 1 } };
    await installOnlineSnapshot(h, latest);
    const selection: ArenaRoomProposalResolveRequest = { expectedRoomEpoch: reviewed.roomEpoch, expectedRevision: reviewed.snapshot.revision,
      resolution: 'accept-selected', selectedChangeIds: ['language', 'guidance'] };
    const request = h.plan('proposal-resolve');
    const resolving = h.session.resolveProposal(reviewed, proposal, selection, h.session.confirmationOwner()!);
    expect(await request.entered.promise).toMatchObject({ request: selection });
    selection.selectedChangeIds!.reverse();
    expect(h.requests.at(-1)).toMatchObject({ request: { selectedChangeIds: ['language', 'guidance'], expectedRevision: reviewed.snapshot.revision } });
    request.accept(); await resolving;
  });

  it('requires override review to match both the reviewed and current revisions without rewriting it', async () => {
    const h = await harness(); const reviewed = await joinProposalHost(h);
    const latest = { ...reviewed, snapshot: { ...reviewed.snapshot, revision: reviewed.snapshot.revision + 1, controlSeq: reviewed.snapshot.controlSeq + 1 } };
    await installOnlineSnapshot(h, latest);
    const selection: ArenaRoomProposalResolveRequest = { expectedRoomEpoch: reviewed.roomEpoch, expectedRevision: reviewed.snapshot.revision,
      resolution: 'accept-selected', selectedChangeIds: ['guidance'], overrideChangeIds: ['guidance'] };
    await h.session.resolveProposal(reviewed, proposal, selection, h.session.confirmationOwner()!);
    await h.session.resolveProposal(reviewed, proposal, { ...selection, expectedRevision: latest.snapshot.revision }, h.session.confirmationOwner()!);
    expect(h.requests.map(value => value.kind)).toEqual(['join']);
    expect(h.session.getSnapshot().error).toContain('重新审阅');
    const request = h.plan('proposal-resolve');
    const resolving = h.session.resolveProposal(h.session.getSnapshot().session!, proposal, { ...selection, expectedRevision: latest.snapshot.revision }, h.session.confirmationOwner()!);
    await request.entered.promise; request.accept(); await resolving;
  });

  it.each(['stale-owner', 'member', 'inactive', 'offline', 'missing-snapshot', 'can-start', 'room', 'epoch', 'self', 'changed-identity', 'removed', 'terminal'] as const)(
    'does not dispatch a proposal resolve for %s', async guard => {
      const h = await harness(); let reviewed = await joinProposalHost(h); let identity = h.session.confirmationOwner()!;
      if (guard === 'stale-owner') identity = Symbol('old');
      if (guard === 'can-start') h.setCanStart(false);
      if (guard === 'offline') { await h.receive({ kind: 'status', state: 'offline' }); await whenState(h.session, state => state.phase === 'offline'); }
      if (guard === 'missing-snapshot') { await h.receive({ kind: 'status', state: 'offline' }); await h.receive({ kind: 'status', state: 'online' }); }
      if (guard === 'room') reviewed = { ...reviewed, roomId: 'another-room' };
      if (guard === 'epoch') reviewed = { ...reviewed, roomEpoch: 'another-epoch' };
      if (guard === 'self') reviewed = { ...reviewed, self: { ...reviewed.self, userId: 'another-self' } };
      if (guard === 'member') reviewed = { ...reviewed, self: { ...reviewed.self, role: 'member' } };
      if (guard === 'inactive') reviewed = { ...reviewed, self: { ...reviewed.self, membershipState: 'revoked' } };
      if (guard === 'changed-identity' || guard === 'removed' || guard === 'terminal') {
        const proposals: ArenaProposal[] = guard === 'removed' ? [] : [{ ...proposal, ...(guard === 'terminal' ? { status: 'rejected' as const } : { authorUserId: host.self.userId }) }];
        await installOnlineSnapshot(h, { ...reviewed, snapshot: { ...reviewed.snapshot, proposals, controlSeq: reviewed.snapshot.controlSeq + 1 } });
      }
      await h.session.resolveProposal(reviewed, proposal, rejectProposal(reviewed), identity);
      expect(h.requests.map(value => value.kind)).toEqual(['join']);
    });

  it.each(['../legacy', 'with/slash', 'with\\backslash', 'encoded%2Fid', 'double%252Fid'])(
    'keeps legacy unsafe proposal ID %s read-only', async proposalId => {
      const h = await harness(); const value = { ...proposal, proposalId }; const current = await joinProposalHost(h, proposalHost(value));
      await h.session.resolveProposal(current, value, rejectProposal(current), h.session.confirmationOwner()!);
      expect(h.requests.map(value => value.kind)).toEqual(['join']);
      expect(h.session.getSnapshot().error).toContain('只读');
    });

  it('preserves a safe Unicode proposal ID exactly and rejects normalized selections', async () => {
    const h = await harness(); const value = { ...proposal, proposalId: '提案 内部空格' }; const current = await joinProposalHost(h, proposalHost(value));
    await h.session.resolveProposal(current, value, { expectedRoomEpoch: current.roomEpoch, resolution: 'accept-selected', selectedChangeIds: [' guidance '] }, h.session.confirmationOwner()!);
    expect(h.requests.map(value => value.kind)).toEqual(['join']);
    const request = h.plan('proposal-resolve'); const resolving = h.session.resolveProposal(current, value, rejectProposal(current), h.session.confirmationOwner()!);
    expect(await request.entered.promise).toMatchObject({ proposalId: '提案 内部空格' }); request.accept(); await resolving;
  });

  it('keeps a real resolve unknown through GET and partial evidence until exact Native observation ACK', async () => {
    const h = await harness(); const current = await joinProposalHost(h);
    const request = h.plan('proposal-resolve'); const resolving = h.session.resolveProposal(current, proposal, rejectProposal(current), h.session.confirmationOwner()!);
    await request.entered.promise; request.accept(); await resolving;
    const pending = { operation: 'proposalResolve' as const, roomId: current.roomId, intentId: 'resolve-unknown' };
    h.setPending(pending);
    await h.receive({ kind: 'mutation-unknown', ...pending });
    await h.receive({ kind: 'request-error', operation: 'proposalResolve', requestId: request.requestId,
      error: { code: 'network-error', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'unknown' } });
    await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot().proposalTracking).toMatchObject({ operation: pending.operation, roomId: pending.roomId, id: pending.intentId, proposalId: proposal.proposalId, phase: 'unknown' });
    const read = h.plan('session'); const reading = h.session.checkProposalTracking(); await read.entered.promise; read.accept(); await reading;
    await h.receive(success('session', read.requestId, current)); await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot().unknown).toMatchObject(pending);
    const observation = { observation: 'terminal' as const, linked: true, settle: true, outcome: 'scope-unverified' as const, terminalStatus: 'partially_accepted' as const };
    const delivery = h.emit({ kind: 'proposal-observation', intentId: pending.intentId, observation }); await delivery.ackEntered.promise;
    expect(h.session.getSnapshot()).toMatchObject({ unknown: pending, proposalTracking: { phase: 'unknown', observation } });
    await h.session.resolveProposal(current, proposal, rejectProposal(current), h.session.confirmationOwner()!);
    delivery.acknowledge(); await whenState(h.session, state => state.unknown === null && !state.busy);
    expect(h.session.getSnapshot().proposalTracking).toMatchObject({ phase: 'settled', observation });
    expect(h.requests.map(value => value.kind)).toEqual(['join', 'proposal-resolve', 'session']);
  });

  it.each(['different', 'scope-unverified'] as const)('retains the true %s terminal observation after ACK', async outcome => {
    const h = await harness(); const pending = { operation: 'proposalResolve' as const, roomId: host.roomId, intentId: 'old-resolve' };
    h.setPending(pending); await h.session.open();
    const observation = { observation: 'terminal' as const, linked: true, settle: true, outcome,
      terminalStatus: outcome === 'different' ? 'withdrawn' as const : 'partially_accepted' as const };
    await h.receive({ kind: 'proposal-observation', intentId: pending.intentId, observation });
    await whenState(h.session, state => state.unknown === null);
    expect(h.session.getSnapshot().proposalTracking).toMatchObject({ phase: 'settled', observation });
    expect(h.session.isConstrained()).toBe(false);
  });

  it.each(['pending', 'absent', 'conflict', 'scope-changed', 'target-unavailable'] as const)('keeps unknown for Native %s evidence even after exact ACK', async observation => {
    const h = await harness(); const pending = { operation: 'proposalResolve' as const, roomId: host.roomId, intentId: 'pending-resolve' };
    h.setPending(pending); await h.session.open();
    const evidence = { observation, linked: observation === 'pending' || observation === 'absent', settle: false, outcome: null, terminalStatus: null };
    await h.receive({ kind: 'proposal-observation', intentId: pending.intentId, observation: evidence });
    expect(h.session.getSnapshot()).toMatchObject({ unknown: pending, proposalTracking: { phase: 'unknown', observation: evidence } });
    expect(h.session.isConstrained()).toBe(true);
  });

  it.each(['not-applied', 'invalid-ack', 'wrong-proposal', 'regressed-snapshot'] as const)('handles a resolve %s without manufacturing a successful receipt', async outcome => {
    const h = await harness(); const current = await joinProposalHost(h);
    const request = h.plan('proposal-resolve'); const resolving = h.session.resolveProposal(current, proposal, rejectProposal(current), h.session.confirmationOwner()!);
    await request.entered.promise; request.accept(); await resolving;
    if (outcome === 'not-applied') {
      await h.receive({ kind: 'request-error', operation: 'proposalResolve', requestId: request.requestId,
        error: { code: 'service-rejected', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'not-applied', serverCode: 'ROOM_DESKTOP_OPERATION_UNSUPPORTED' } });
      await whenState(h.session, state => !state.busy);
      expect(h.session.getSnapshot()).toMatchObject({ unknown: null, proposalTracking: null, session: current });
    } else {
      const result = outcome === 'regressed-snapshot' ? { ...current, snapshot: { ...current.snapshot, controlSeq: current.snapshot.controlSeq - 1 } } : current;
      const delivery = h.emit(resolved(request.requestId, result, outcome === 'wrong-proposal' ? 'other-proposal' : proposal.proposalId));
      if (outcome === 'invalid-ack') { await delivery.ackEntered.promise; delivery.acknowledge({ batchId: 'wrong-batch' }); }
      await whenState(h.session, state => state.phase === 'unavailable');
      expect(h.session.getSnapshot()).toMatchObject({ unknown: { operation: 'proposalResolve' }, proposalTracking: { phase: 'unknown' } });
      expect(h.subscriptions()).toHaveLength(1);
    }
    expect(h.requests.map(value => value.kind)).toEqual(['join', 'proposal-resolve']);
  });

  it('rejects partial atomic groups and missing dependencies without expanding the selection', async () => {
    const h = await harness(); const value: ArenaProposal = { ...proposal, changes: proposal.changes.map((change, index) => ({ ...change,
      atomicGroupId: 'together', ...(index === 1 ? { dependsOn: ['guidance'] } : {}) })) };
    const current = await joinProposalHost(h, proposalHost(value));
    for (const selectedChangeIds of [['language'], ['guidance'], ['guidance', 'guidance'], ['missing'], []]) {
      await h.session.resolveProposal(current, value, { expectedRoomEpoch: current.roomEpoch, resolution: 'accept-selected', selectedChangeIds }, h.session.confirmationOwner()!);
    }
    expect(h.requests.map(value => value.kind)).toEqual(['join']);
    expect(h.session.getSnapshot().proposalTracking).toBeNull();
  });

  it('requires a fresh read when an end receipt was lost but Native later reports no pending intent', async () => {
    const h = await harness(); const pending = { operation: 'proposalResolve' as const, roomId: host.roomId, intentId: 'lost-end' };
    h.setPending(pending); await h.session.open(); h.setEndFails(); await h.session.endProposalTracking(pending.intentId);
    h.setPending(null); await h.session.checkProposalTracking();
    expect(h.session.getSnapshot()).toMatchObject({ unknown: null, proposalTracking: { phase: 'ended-needs-read' } });
    await h.session.create(details, source, () => true); await h.session.join(host.roomId, 'host'); await h.session.discover();
    expect(h.requests).toHaveLength(0);
  });

  it('ends only the explicit proposal token and requires a fresh GET ACK before further writes', async () => {
    const h = await harness(); const pending = { operation: 'proposalResolve' as const, roomId: host.roomId, intentId: 'end-resolve' };
    h.setPending(pending); await h.session.open();
    expect(h.session.getSnapshot().proposalTracking).toMatchObject({ id: pending.intentId, proposalId: null, observation: { observation: 'target-unavailable', linked: false } });
    await h.session.endProposalTracking('wrong-token');
    expect(h.invoke.mock.calls.some(([, args]) => (args?.request as { request?: { kind: string } })?.request?.kind === 'end-proposal-tracking')).toBe(false);
    await h.session.endProposalTracking(pending.intentId);
    expect(h.session.getSnapshot()).toMatchObject({ unknown: null, session: null, proposalTracking: { phase: 'ended-needs-read' } });
    await h.session.create(details, source, () => true); await h.session.join(host.roomId, 'host'); await h.session.discover();
    expect(h.requests).toHaveLength(0);
    const read = h.plan('session'); const reading = h.session.readProposalAfterEnd(); await read.entered.promise; read.accept(); await reading;
    const delivery = h.emit(success('session', read.requestId, proposalHost())); await delivery.ackEntered.promise;
    expect(h.session.getSnapshot().proposalTracking?.phase).toBe('ended-needs-read');
    const current = h.session.getSnapshot().session!;
    await h.session.resolveProposal(current, proposal, rejectProposal(current), h.session.confirmationOwner()!);
    delivery.acknowledge(); await whenState(h.session, state => !state.busy && state.phase === 'connecting');
    expect(h.session.getSnapshot().proposalTracking).toBeNull();
    await installOnlineSnapshot(h, proposalHost());
    const request = h.plan('proposal-resolve'); const resolving = h.session.resolveProposal(h.session.getSnapshot().session!, proposal, rejectProposal(current), h.session.confirmationOwner()!);
    await request.entered.promise; request.accept(); await resolving;
    expect(h.requests.map(value => value.kind)).toEqual(['session', 'proposal-resolve']);
  });

  it('preserves proposal tracking if reattachment fails or a fresh read proves the room unavailable', async () => {
    const h = await harness(); const pending = { operation: 'proposalResolve' as const, roomId: host.roomId, intentId: 'retained-resolve' };
    h.setPending(pending); await h.session.open();
    const gate = h.holdAttach(); const reopening = h.session.open(); await gate.entered.promise; gate.response.resolve({ invalid: true }); await reopening;
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'unavailable', constrained: true, unknown: pending, proposalTracking: { phase: 'unknown', id: pending.intentId } });
    await h.session.open(); await h.session.endProposalTracking(pending.intentId);
    const read = h.plan('session'); const reading = h.session.readProposalAfterEnd(); await read.entered.promise; read.accept(); await reading;
    await h.receive({ kind: 'request-error', operation: 'session', requestId: read.requestId,
      error: { code: 'service-rejected', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'not-applicable', serverCode: 'ROOM_NOT_FOUND' } });
    await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot()).toMatchObject({ session: null, phase: 'closed', constrained: true, proposalTracking: { phase: 'ended-needs-read' } });
    expect(h.session.needsLeaveConfirmation()).toBe(true);
  });

  it('does not claim old proposal basis or check a replacement token after reopen', async () => {
    const h = await harness(); const pending = { operation: 'proposalResolve' as const, roomId: host.roomId, intentId: 'resolve-A' };
    h.setPending(pending); await h.session.open();
    h.setEndFails(); await h.session.endProposalTracking(pending.intentId);
    expect(h.session.getSnapshot().phase).toBe('unavailable');
    h.setPending({ ...pending, intentId: 'resolve-B' }); await h.session.checkProposalTracking();
    expect(h.session.getSnapshot().proposalTracking).toMatchObject({ id: 'resolve-B', proposalId: null, phase: 'unknown', observation: { observation: 'target-unavailable', linked: false } });
    expect(h.requests).toHaveLength(0);
  });

  it('publishes only an explicitly compared current host projection with exact CAS scope', async () => {
    const h = await harness(); await joinRoom(h, host);
    const original = h.session.getSnapshot().session!;
    const target = { ...original.snapshot.sharedConfig!, userGuidance: 'confirmed target' };
    await h.session.publishConfig(original, target, Symbol('stale'), () => true);
    await h.session.publishConfig(original, target, h.session.confirmationOwner()!, () => false);
    expect(h.requests.map(value => value.kind)).toEqual(['join']);
    const request = h.plan('config');
    const publishing = h.session.publishConfig(original, target, h.session.confirmationOwner()!, () => true);
    expect(await request.entered.promise).toEqual({ kind: 'config', roomId: host.roomId, request: {
      expectedRoomEpoch: host.roomEpoch, expectedRevision: host.snapshot.revision, expectedControlSeq: host.snapshot.controlSeq, sharedConfig: target,
    } });
    target.userGuidance = 'later draft';
    expect(h.session.getSnapshot().configTracking?.target?.request.sharedConfig.userGuidance).toBe('confirmed target');
    request.accept(); await publishing;
    await h.receive(success('config', request.requestId, original)); await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot().configTracking).toBeNull();
    expect(h.session.getSnapshot().notice).toContain('原配置请求已获确认');
  });

  it('explains an old producer refusal without retrying or retaining a false unknown write', async () => {
    const h = await harness(); await joinRoom(h, host);
    const original = h.session.getSnapshot().session!;
    const request = h.plan('config'); const publishing = h.session.publishConfig(original, original.snapshot.sharedConfig,
      h.session.confirmationOwner()!, () => true);
    await request.entered.promise; request.accept(); await publishing;
    await h.receive(DesktopRoomEventSchema.parse({ kind: 'request-error', operation: 'config', requestId: request.requestId,
      error: { code: 'service-rejected', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'not-applied', serverCode: 'ROOM_DESKTOP_OPERATION_UNSUPPORTED' } }));
    await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot()).toMatchObject({ error: '服务器不支持此桌面操作，请更新服务端后再明确重试。', unknown: null, configTracking: null });
    expect(h.requests.map(value => value.kind)).toEqual(['join', 'config']);
    expect(h.session.getSnapshot().session).toBe(original);
  });

  it('keeps the original target after unknown and GET, without retrying the config write', async () => {
    const h = await harness(); await joinRoom(h, host);
    const original = h.session.getSnapshot().session!;
    const target = { ...original.snapshot.sharedConfig!, userGuidance: 'original target' };
    const request = h.plan('config'); const publishing = h.session.publishConfig(original, target, h.session.confirmationOwner()!, () => true);
    await request.entered.promise; request.accept(); await publishing;
    await h.receive(DesktopRoomEventSchema.parse({ kind: 'mutation-unknown', operation: 'config', roomId: host.roomId, intentId: 'config-original' }));
    await h.receive(DesktopRoomEventSchema.parse({ kind: 'request-error', operation: 'config', requestId: request.requestId,
      error: { code: 'network-error', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'unknown' } }));
    await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot().configTracking).toMatchObject({ id: 'config-original', phase: 'unknown', target: { request: { sharedConfig: target } } });
    const check = h.plan('session'); const checking = h.session.checkConfigPublish(); await check.entered.promise; check.accept(); await checking;
    const current = { ...host, snapshot: { ...host.snapshot, revision: host.snapshot.revision + 3, sharedConfig: target } };
    await h.receive(success('session', check.requestId, current)); await whenState(h.session, state => !state.busy && state.phase === 'connecting');
    expect(h.session.getSnapshot().configTracking?.observation).toBe('target-matches');
    expect(h.session.getSnapshot().unknown?.intentId).toBe('config-original');
    await h.session.publishConfig(h.session.getSnapshot().session!, target, h.session.confirmationOwner()!, () => true);
    expect(h.requests.map(value => value.kind)).toEqual(['join', 'config', 'session']);
    h.session.detach();
    expect(h.invoke.mock.calls.some(([, args]) => (args?.request as { request?: {kind: string} })?.request?.kind === 'end-config-tracking')).toBe(false);
  });

  it('does not let recovery of an old unknown target dispatch a GET for a newly attached intent', async () => {
    const h = await harness(); h.setPending({ operation: 'config', roomId: host.roomId, intentId: 'config-A' }); await h.session.open();
    h.setEndFails(); await h.session.endConfigTracking('config-A');
    expect(h.session.getSnapshot().phase).toBe('unavailable');
    h.setPending({ operation: 'config', roomId: host.roomId, intentId: 'config-B' });
    await h.session.checkConfigPublish();
    expect(h.session.getSnapshot().configTracking?.id).toBe('config-B');
    expect(h.requests).toEqual([]);
  });

  it('restored unknown only observes current state, explicitly ends exact token, then requires a new read', async () => {
    const h = await harness(); const pending = { operation: 'config' as const, roomId: host.roomId, intentId: 'config-A' };
    h.setPending(pending); await h.session.open();
    expect(h.session.getSnapshot().configTracking).toMatchObject({ id: 'config-A', target: null, observation: 'target-unavailable' });
    await h.session.endConfigTracking('old-token');
    expect(h.invoke.mock.calls.some(([, args]) => (args?.request as {request?: {kind: string}})?.request?.kind === 'end-config-tracking')).toBe(false);
    const check = h.plan('session'); const checking = h.session.checkConfigPublish(); await check.entered.promise; check.accept(); await checking;
    await h.receive(success('session', check.requestId, host)); await whenState(h.session, state => !state.busy && state.phase === 'connecting');
    expect(h.session.getSnapshot().unknown).toMatchObject(pending);
    expect(h.session.getSnapshot().configTracking?.observation).toBe('target-unavailable');
    await h.session.endConfigTracking('config-A');
    expect(h.session.getSnapshot()).toMatchObject({ unknown: null, session: null, configTracking: { phase: 'ended-needs-read' } });
    await h.session.create(details, source, () => true); await h.session.join(host.roomId, 'host'); await h.session.discover();
    expect(h.requests.map(value => value.kind)).toEqual(['session']);
    const read = h.plan('session'); const reading = h.session.readConfigAfterEnd(); await read.entered.promise; read.accept(); await reading;
    await h.receive(success('session', read.requestId, host)); await whenState(h.session, state => !state.busy && state.phase === 'connecting');
    expect(h.session.getSnapshot().configTracking).toBeNull(); expect(h.session.getSnapshot().session).toEqual(host);
    expect(h.requests.map(value => value.kind)).toEqual(['session', 'session']);
  });

  it.each(['create', 'join'] as const)('keeps early %s availability behind accepted and exact ACK before subscribing, then permits the role-appropriate exit', async kind => {
    const h = await harness(); await h.session.open();
    const request = h.plan(kind);
    const operation = kind === 'create' ? h.session.create(details, source, () => true) : h.session.join(member.roomId, member.self.displayName);
    await request.entered.promise;
    const result = kind === 'create' ? host : member;
    const delivery = h.emit(success(kind, request.requestId, result));
    // Native invokes use one lane: early availability cannot pull its body until
    // accepted returns. This deliberately does not fabricate an earlier ACK.
    expect(h.subscriptions()).toHaveLength(0);
    expect(h.invoke.mock.calls.filter(([, args]) => (args?.request as { request?: { kind: string } })?.request?.kind === 'pull')).toHaveLength(0);
    request.accept(); await operation;
    await delivery.ackEntered.promise;
    expect(h.session.getSnapshot()).toMatchObject({ busy: true, constrained: true, session: { roomId: result.roomId }, snapshotReceived: false, presence: null });
    expect(h.subscriptions()).toHaveLength(0);
    const ready = whenState(h.session, state => !state.busy && state.phase === 'connecting');
    delivery.acknowledge(); await ready;
    expect(h.subscriptions()).toEqual([[DESKTOP_ROOM_IPC_COMMANDS.subscribe, { request: { handle: fixture.attach.handle, roomId: result.roomId, expectedRoomEpoch: result.roomEpoch } }]]);
    expect(h.session.needsLeaveConfirmation()).toBe(true);
    await (kind === 'create' ? h.session.leave() : h.session.close());
    expect(h.requests).toHaveLength(1);

    const exitKind = kind === 'create' ? 'close' : 'leave';
    const exit = h.plan(exitKind);
    const exiting = kind === 'create' ? h.session.close() : h.session.leave();
    expect(await exit.entered.promise).toEqual({ kind: exitKind, roomId: result.roomId, expectedRoomEpoch: result.roomEpoch });
    exit.accept(); await exiting;
    const idle = whenState(h.session, state => !state.busy && state.session === null);
    await h.receive(success(exitKind, exit.requestId)); await idle;
    expect(h.session.isConstrained()).toBe(false);
    expect(h.session.needsLeaveConfirmation()).toBe(false);
    expect(h.subscriptions()).toHaveLength(1);
  });

  it.each([{ accepted: false }, { batchId: 'wrong-batch' }])('never subscribes on an invalid ACK receipt %j', async patch => {
    const h = await harness(); await h.session.open();
    const request = h.plan('join'); const joining = h.session.join(member.roomId, member.self.displayName);
    await request.entered.promise; request.accept(); await joining;
    const delivery = h.emit(success('join', request.requestId, member)); await delivery.ackEntered.promise;
    const unavailable = whenState(h.session, state => state.phase === 'unavailable');
    delivery.acknowledge(patch); await unavailable;
    expect(h.subscriptions()).toHaveLength(0);
    expect(h.session.getSnapshot()).toMatchObject({ busy: false, presence: null, snapshotReceived: false });
  });

  it.each(['current', 'ROOM_NOT_FOUND', 'ROOM_FORBIDDEN'] as const)('retains restored config unknown after current-state read: %s', async outcome => {
    const h = await harness();
    const pending = { operation: 'config' as const, roomId: host.roomId, intentId: 'original-config-intent' };
    h.setPending(pending); await h.session.open();
    expect(h.session.getSnapshot()).toMatchObject({ unknown: pending, session: null, constrained: true });
    const request = h.plan('session'); const checking = h.session.reconcile();
    expect(await request.entered.promise).toEqual({ kind: 'session', roomId: host.roomId });
    request.accept(); await checking;
    if (outcome === 'current') await h.receive(success('session', request.requestId, host));
    else await h.receive(DesktopRoomEventSchema.parse({ kind: 'request-error', operation: 'session', requestId: request.requestId,
      error: { code: 'service-rejected', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'not-applicable', serverCode: outcome } }));
    await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot()).toMatchObject({ unknown: pending, constrained: true });
    expect(h.session.getSnapshot().unknown).toMatchObject(pending); // No original target is reconstructed from a draft or GET.
    await h.session.create(details, source, () => true); await h.session.join(host.roomId, '成员'); await h.session.close();
    expect(h.requests.map(value => value.kind)).toEqual(['session']);
  });

  it.each(['proposalSubmit', 'proposalWithdraw', 'proposalResolve'] as const)('retains %s unknown after a GET until a separately acknowledged observation', async operation => {
    const h = await harness();
    const pending = { operation, roomId: host.roomId, intentId: 'proposal-original' };
    h.setPending(pending); await h.session.open();
    const read = h.plan('session'); const reading = h.session.reconcile();
    await read.entered.promise; read.accept(); await reading;
    await h.receive(success('session', read.requestId, host));
    await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot().unknown).toMatchObject(pending);
    expect(h.subscriptions()).toHaveLength(0);
    const event: DesktopRoomEvent = { kind: 'proposal-observation', intentId: pending.intentId,
      observation: { observation: 'terminal', linked: true, settle: true, outcome: 'scope-unverified', terminalStatus: 'partially_accepted' } };
    const delivery = h.emit(event); await delivery.ackEntered.promise;
    expect(h.session.getSnapshot().unknown).toMatchObject(pending);
    delivery.acknowledge();
    await whenState(h.session, state => state.unknown === null && !state.busy && state.phase === 'connecting');
    expect(h.subscriptions()).toHaveLength(1);
    expect(h.session.getSnapshot().notice).toContain('具体接受范围尚无法确认');
    expect(h.requests.map(request => request.kind)).toEqual(['session']);
  });
  it.each(['wrong-ack', 'new-owner'] as const)('does not release proposal tracking on %s', async failure => {
    const h = await harness();
    const pending = { operation: 'proposalWithdraw' as const, roomId: host.roomId, intentId: 'proposal-original' };
    h.setPending(pending); await h.session.open();
    const delivery = h.emit({ kind: 'proposal-observation', intentId: pending.intentId,
      observation: { observation: 'terminal', linked: true, settle: true, outcome: 'satisfied', terminalStatus: 'withdrawn' } });
    await delivery.ackEntered.promise;
    expect(h.session.getSnapshot().unknown).toMatchObject(pending);
    let reopening: Promise<symbol | null> | undefined;
    if (failure === 'new-owner') { h.session.detach(); reopening = h.session.open(); }
    delivery.acknowledge(failure === 'wrong-ack' ? { batchId: 'wrong-batch' } : {});
    if (failure === 'wrong-ack') await whenState(h.session, state => state.phase === 'unavailable');
    else await reopening;
    expect(h.session.getSnapshot().unknown).toMatchObject(pending);
    expect(h.subscriptions()).toHaveLength(0);
  });
  it.each(['ROOM_NOT_FOUND', 'ROOM_FORBIDDEN'] as const)('does not turn proposal recovery %s into a write receipt', async code => {
    const h = await harness();
    const pending = { operation: 'proposalSubmit' as const, roomId: host.roomId, intentId: 'proposal-original' };
    h.setPending(pending); await h.session.open();
    const read = h.plan('session'); const reading = h.session.reconcile(); await read.entered.promise; read.accept(); await reading;
    await h.receive({ kind: 'request-error', requestId: read.requestId, operation: 'session',
      error: { code: 'service-rejected', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'not-applicable', serverCode: code } });
    await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot().unknown).toMatchObject(pending);
    expect(h.requests.map(request => request.kind)).toEqual(['session']);
  });
  it('does not resubscribe or release pending tracking for an ordinary socket observation', async () => {
    const h = await harness();
    const pending = { operation: 'proposalResolve' as const, roomId: host.roomId, intentId: 'proposal-original' };
    h.setPending(pending); await h.session.open();
    const read = h.plan('session'); const reading = h.session.reconcile(); await read.entered.promise; read.accept(); await reading;
    await h.receive(success('session', read.requestId, host)); await whenState(h.session, state => !state.busy);
    const observation: DesktopRoomEvent = { kind: 'proposal-observation', intentId: pending.intentId,
      observation: { observation: 'pending', linked: true, settle: false, outcome: null, terminalStatus: null } };
    await h.receive(observation); await whenState(h.session, state => !state.busy && state.phase === 'connecting');
    expect(h.subscriptions()).toHaveLength(1);
    await h.receive(observation); for (let i = 0; i < 24; i += 1) await Promise.resolve();
    expect(h.subscriptions()).toHaveLength(1);
    expect(h.session.getSnapshot().unknown).toMatchObject(pending);
  });
  it('requires explicit reopen and resume-create for an unknown create without allocating a replacement creation ID', async () => {
    const h = await harness(); await h.session.open();
    const request = h.plan('create'); const creating = h.session.create(details, source, () => true);
    await request.entered.promise;
    request.response.reject({ code: 'network-error', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'unknown' });
    await creating;
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'unavailable', unknown: { operation: 'create', intentId: null, roomId: null } });
    expect(h.requests.map(value => value.kind)).toEqual(['create']);
    expect(h.randomId).toHaveBeenCalledTimes(1);
    const pending = { operation: 'create' as const, roomId: null, intentId: 'original-create-intent' };
    h.setPending(pending); await h.session.reconcile();
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'ready', unknown: pending, constrained: true });
    await h.session.create(details, source, () => true); await h.session.join(member.roomId, '成员'); await h.session.discover();
    expect(h.requests.map(value => value.kind)).toEqual(['create']);
    const resume = h.plan('resume-create'); const reconciling = h.session.reconcile();
    expect(await resume.entered.promise).toEqual({ kind: 'resume-create', intentId: pending.intentId });
    resume.accept(); await reconciling;
    const ready = whenState(h.session, state => !state.busy && state.phase === 'connecting');
    await h.receive(success('create', resume.requestId, host)); await ready;
    expect(h.randomId).toHaveBeenCalledTimes(1);
    expect(h.requests.map(value => value.kind)).toEqual(['create', 'resume-create']);
    expect(h.session.getSnapshot().unknown).toBeNull();
  });

  it.each(['native-rejected', 'invalid-receipt'] as const)('preserves create uncertainty after an %s ACK and resumes only the original Native intent', async failure => {
    const h = await harness(); await h.session.open();
    const request = h.plan('create'); const creating = h.session.create(details, source, () => true);
    await request.entered.promise; request.accept(); await creating;
    const delivery = h.emit(success('create', request.requestId, host)); await delivery.ackEntered.promise;
    expect(h.session.getSnapshot()).toMatchObject({ busy: true, constrained: true, session: host, snapshotReceived: false });
    const unavailable = whenState(h.session, state => state.phase === 'unavailable');
    delivery.acknowledge(failure === 'native-rejected' ? { accepted: false } : { batchId: 'not-the-accepted-batch' });
    await unavailable;
    expect(h.session.getSnapshot()).toMatchObject({
      busy: false, constrained: true, unknown: { operation: 'create', roomId: null },
      presence: null, snapshotReceived: false,
    });
    expect(h.subscriptions()).toHaveLength(0);
    expect(h.requests.map(value => value.kind)).toEqual(['create']);

    const pending = { operation: 'create' as const, roomId: null, intentId: 'native-unacknowledged-create' };
    h.setPending(pending);
    await h.session.reconnect();
    expect(h.session.getSnapshot()).toMatchObject({ unknown: pending, constrained: true });
    // A reconnect button cannot reinterpret an unacknowledged create as a GET
    // membership recovery or allocate a replacement mutation identity.
    await h.session.reconnect();
    await h.session.create(details, source, () => true);
    expect(h.requests.map(value => value.kind)).toEqual(['create']);
    expect(h.randomId).toHaveBeenCalledTimes(1);
    expect(h.subscriptions()).toHaveLength(0);

    const resume = h.plan('resume-create'); const reconciling = h.session.reconcile();
    expect(await resume.entered.promise).toEqual({ kind: 'resume-create', intentId: pending.intentId });
    resume.accept(); await reconciling;
    const resumed = h.emit(success('create', resume.requestId, host)); await resumed.ackEntered.promise;
    expect(h.session.getSnapshot().unknown).toMatchObject(pending);
    expect(h.subscriptions()).toHaveLength(0);
    const ready = whenState(h.session, state => !state.busy && state.phase === 'connecting');
    resumed.acknowledge(); await ready;
    expect(h.session.getSnapshot().unknown).toBeNull();
    expect(h.requests.map(value => value.kind)).toEqual(['create', 'resume-create']);
    expect(h.randomId).toHaveBeenCalledTimes(1);
  });

  it('retains the verified room without claiming online when Native committed the create ACK but its reply was lost', async () => {
    const h = await harness(); await h.session.open();
    const request = h.plan('create'); const creating = h.session.create(details, source, () => true);
    await request.entered.promise; request.accept(); await creating;
    const delivery = h.emit(success('create', request.requestId, host)); await delivery.ackEntered.promise;
    // Native's next attach is the authority for its receipt. The renderer sees
    // only a rejected invoke and must not infer whether that receipt committed.
    h.setPending(null);
    const unavailable = whenState(h.session, state => state.phase === 'unavailable');
    delivery.ack.reject(new Error('ACK response transport lost')); await unavailable;
    expect(h.session.getSnapshot()).toMatchObject({
      session: host, constrained: true, unknown: { operation: 'create', roomId: null },
      presence: null, snapshotReceived: false,
    });
    expect(h.requests.map(value => value.kind)).toEqual(['create']);
    expect(h.subscriptions()).toHaveLength(0);

    await h.session.open();
    expect(h.session.getSnapshot()).toMatchObject({ session: host, unknown: null, constrained: true, presence: null, snapshotReceived: false, busy: false });
    expect(h.session.getSnapshot().phase).not.toBe('online');
    expect(h.subscriptions()).toHaveLength(0);
    expect(h.requests.map(value => value.kind)).toEqual(['create']);
    const read = h.plan('session'); const reconnecting = h.session.reconnect();
    expect(await read.entered.promise).toEqual({ kind: 'session', roomId: host.roomId });
    read.accept(); await reconnecting;
    const ready = whenState(h.session, state => !state.busy && state.phase === 'connecting');
    await h.receive(success('session', read.requestId, host)); await ready;
    expect(h.requests.map(value => value.kind)).toEqual(['create', 'session']);
    expect(h.subscriptions()).toHaveLength(1);
    expect(h.randomId).toHaveBeenCalledTimes(1);
  });

  it.each(
    (['join', 'leave', 'close'] as const).flatMap(operation =>
      (['ROOM_NOT_FOUND', 'ROOM_FORBIDDEN'] as const).flatMap(code =>
        (['exact', 'rejected'] as const).map(ack => ({ operation, code, ack })))),
  )('settles an unknown $operation on matched $code only after an $ack ACK', async ({ operation, code, ack }) => {
    const h = await harness();
    const pending = { operation, roomId: member.roomId, intentId: `unknown-${operation}` };
    h.setPending(pending); await h.session.open();
    const read = h.plan('session'); const reconciling = h.session.reconcile();
    expect(await read.entered.promise).toEqual({ kind: 'session', roomId: pending.roomId });
    read.accept(); await reconciling;
    const error = DesktopRoomEventSchema.parse({
      ...fixture.pulls[7].batch.event, requestId: read.requestId,
      response: {
        desktopRoom: { version: 'desktop-room-session-v1', viewerUserId: fixture.expectedUserId },
        error: { code, message: '房间或成员资格已结束', outcome: 'not-applicable' },
      },
    });
    const delivery = h.emit(error); await delivery.ackEntered.promise;
    expect(h.session.getSnapshot()).toMatchObject({ busy: true, constrained: true, unknown: pending });
    expect(h.session.needsLeaveConfirmation()).toBe(true);
    const finished = whenState(h.session, state => !state.busy);
    delivery.acknowledge({ accepted: ack === 'exact' }); await finished;
    if (ack === 'exact') {
      expect(h.session.getSnapshot()).toMatchObject({ phase: 'closed', unknown: null, constrained: false, session: null });
      expect(h.session.needsLeaveConfirmation()).toBe(false);
    } else {
      expect(h.session.getSnapshot()).toMatchObject({ phase: 'unavailable', unknown: pending, constrained: true });
      expect(h.session.needsLeaveConfirmation()).toBe(true);
    }
    expect(h.requests).toEqual([{ kind: 'session', roomId: pending.roomId }]);
    expect(h.subscriptions()).toHaveLength(0); expect(h.randomId).not.toHaveBeenCalled();
  });

  it.each(['source-changed', 'other-operation', 'signed-out', 'document-changed'] as const)('does not POST or allocate an ID when %s invalidates source preparation', async change => {
    const h = await harness(); await h.session.open();
    const prepared = deferred<DesktopRoomSource>(); let current = true;
    const prepare = vi.fn(() => prepared.promise);
    const creating = h.session.create(details, prepare, () => current);
    expect(prepare).toHaveBeenCalledTimes(1); expect(h.session.isBusy()).toBe(true);
    if (change === 'source-changed') current = false;
    if (change === 'other-operation') h.setCanStart(false);
    if (change === 'signed-out') await h.account.signOut();
    if (change === 'document-changed') h.setNonce('b'.repeat(64));
    prepared.resolve({ ok: true, sharedConfig: createRequest.sharedConfig }); await creating;
    expect(h.requests).toEqual([]); expect(h.randomId).not.toHaveBeenCalled();
    expect(h.session.isConstrained()).toBe(false); expect(h.session.isBusy()).toBe(false);
  });

  it('keeps unshareable source diagnostics and never silently creates an empty room', async () => {
    const h = await harness(); await h.session.open();
    await h.session.create(details, async () => ({ ok: false, issues: ['来源无法验证'] }), () => true);
    expect(h.session.getSnapshot()).toMatchObject({ sourceIssues: ['来源无法验证'], busy: false, constrained: false });
    expect(h.requests).toEqual([]); expect(h.randomId).not.toHaveBeenCalled();
  });

  it.each(['signed-out', 'detach', 'document-changed'] as const)('retires %s while an ACK is in flight without subscribing or reviving its old room', async change => {
    const h = await harness(); await h.session.open();
    const request = h.plan('join'); const joining = h.session.join(member.roomId, member.self.displayName);
    await request.entered.promise; request.accept(); await joining;
    const delivery = h.emit(success('join', request.requestId, member)); await delivery.ackEntered.promise;
    if (change === 'signed-out') await h.account.signOut();
    if (change === 'detach') h.session.detach();
    if (change === 'document-changed') h.setNonce('b'.repeat(64));
    expect(h.session.getSnapshot()).toMatchObject({ session: null, presence: null, snapshotReceived: false });
    expect(h.session.isBusy()).toBe(false); expect(h.session.isConstrained()).toBe(false);
    delivery.acknowledge();
    if (change === 'signed-out') await h.account.refresh();
    // The new attach shares the Native lane, so completing it also proves that
    // the delayed old receipt and retirement have passed through that lane.
    await h.session.open();
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'ready', session: null, busy: false, unknown: null });
    expect(h.subscriptions()).toHaveLength(0);
    expect(h.requests.map(value => value.kind)).toEqual(['join']);
  });

  it('does not reconnect an old room into a replacement owner after same-account verification retires a delayed attach', async () => {
    const h = await harness(); await joinRoom(h);
    const delivery = h.emit({ kind: 'status', state: 'offline' }); await delivery.ackEntered.promise;
    const unavailable = whenState(h.session, state => state.phase === 'unavailable');
    delivery.ack.reject(new Error('Socket status ACK transport lost')); await unavailable;
    expect(h.session.getSnapshot()).toMatchObject({ session: member, unknown: null });
    const userId = h.account.getSnapshot().account!.userId;
    const credentialEpoch = h.account.getCredentialEpoch();
    const gate = h.holdAttach();
    const reconnecting = h.session.reconnect();
    const oldAttach = await gate.entered.promise;
    const oldOwner = h.session.confirmationOwner();
    expect(oldOwner).not.toBeNull();

    const verifying = h.account.refresh();
    expect(h.account.getSnapshot().verification).toBe('checking');
    expect(h.session.confirmationOwner()).toBeNull();
    await verifying;
    expect(h.account.getSnapshot()).toMatchObject({ verification: 'verified', account: { userId } });
    expect(h.account.getCredentialEpoch()).toBe(credentialEpoch);
    const reopening = h.session.open();
    const replacementOwner = h.session.confirmationOwner();
    expect(replacementOwner).not.toBeNull(); expect(replacementOwner).not.toBe(oldOwner);
    gate.response.resolve(oldAttach);
    await reconnecting;
    expect(await reopening).toBe(replacementOwner);
    expect(h.session.confirmationOwner()).toBe(replacementOwner);
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'ready', session: null, unknown: null, busy: false });
    expect(h.requests.map(value => value.kind)).toEqual(['join']);
    expect(h.subscriptions()).toHaveLength(1);
  });

  it.each(['leave', 'close'] as const)('rejects a %s success for another room without presenting success or clearing its original membership', async operation => {
    const h = await harness();
    const original = operation === 'leave' ? member : host;
    await joinRoom(h, original);
    const notices: Array<string | null> = [];
    const unsubscribe = h.session.subscribe(() => { notices.push(h.session.getSnapshot().notice); });
    const request = h.plan(operation);
    const exiting = operation === 'leave' ? h.session.leave() : h.session.close();
    await request.entered.promise; request.accept(); await exiting;
    const unavailable = whenState(h.session, state => state.phase === 'unavailable');
    const delivery = h.emit(success(operation, request.requestId, {
      protocolVersion: 1, roomId: 'another-room', outcome: operation === 'leave' ? 'left' : 'closed',
    }));
    await unavailable; unsubscribe();
    expect(h.session.getSnapshot()).toMatchObject({
      session: original, constrained: true, busy: false,
      unknown: { operation, roomId: original.roomId },
    });
    expect(notices).not.toContain('已离开房间。'); expect(notices).not.toContain('房间已关闭。');
    expect(h.invoke.mock.calls.some(([, args]) => {
      const request = (args?.request as { request?: { kind: string; batchId?: string } })?.request;
      return request?.kind === 'ack' && request.batchId === delivery.batch.batchId;
    })).toBe(false);
    expect(h.subscriptions()).toHaveLength(1);
  });

  it.each(['missing', 'throws'] as const)('fails closed on a %s Document nonce in pure snapshot reads', async mode => {
    const h = await harness(); await joinRoom(h);
    const calls = h.invoke.mock.calls.length;
    if (mode === 'missing') h.setNonce(undefined); else h.throwNonce();
    expect(() => h.session.getSnapshot()).not.toThrow();
    expect(h.session.getSnapshot()).toMatchObject({ opened: false, session: null, presence: null, snapshotReceived: false });
    expect(h.session.isBusy()).toBe(false); expect(h.session.isConstrained()).toBe(false); expect(h.session.needsLeaveConfirmation()).toBe(false);
    expect(h.invoke.mock.calls).toHaveLength(calls);
  });

  it('keeps the lobby unconstrained and replaces bounded directory pages instead of accumulating them', async () => {
    const h = await harness(); await h.session.open();
    expect(h.session.isConstrained()).toBe(false); expect(h.session.needsLeaveConfirmation()).toBe(false);
    const item = fixture.pulls[0].batch.event.response.result.items[0];
    for (const page of [0, 1]) {
      const request = h.plan('discover'); const discovering = h.session.discover(page === 1);
      expect(await request.entered.promise).toEqual({ kind: 'discover', query: { limit: 50, ...(page === 1 ? { cursor: 'next_page' } : {}) } });
      expect(h.session.isConstrained()).toBe(false);
      request.accept(); await discovering;
      const items = Array.from({ length: 50 }, (_, index) => ({ ...item, roomId: `page-${page}-room-${index}` }));
      const idle = whenState(h.session, state => !state.busy);
      await h.receive(success('discover', request.requestId, { items, nextCursor: page === 0 ? 'next_page' : null })); await idle;
      expect(h.session.getSnapshot().rooms).toEqual(items);
      expect(h.session.getSnapshot().rooms).toHaveLength(50);
      expect(h.session.needsLeaveConfirmation()).toBe(false);
    }
    expect(h.session.getSnapshot().nextCursor).toBeNull(); expect(h.subscriptions()).toHaveLength(0);
  });

  it('requires fresh socket snapshot and valid presence, clears proof offline, and never accumulates story deltas', async () => {
    const h = await harness(); await joinRoom(h);
    await h.receive({ kind: 'status', state: 'online' });
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'online', snapshotReceived: false, presence: null });
    await h.receive(socket('room.presence'));
    expect(h.session.getSnapshot().presence).toBeNull();
    await h.receive(socket('room.snapshot'));
    expect(h.session.getSnapshot()).toMatchObject({ snapshotReceived: true, presence: null });
    await h.receive(socket('room.presence'));
    expect(h.session.getSnapshot().presence?.onlineUserIds).toEqual(['user-host']);
    const online = h.session.getSnapshot();
    const delta = socket('story.delta');
    if (delta.kind !== 'socket' || delta.message.type !== 'story.delta') throw new Error('Missing story fixture');
    for (let chunkSeq = 0; chunkSeq < 3; chunkSeq += 1) {
      await h.receive({ kind: 'socket', message: { ...delta.message, chunkSeq, payload: { delta: `story-canary-${chunkSeq}` } } });
      expect(h.session.getSnapshot()).toBe(online);
    }
    expect(JSON.stringify(h.session.getSnapshot())).not.toContain('story-canary');
    await h.receive({ kind: 'status', state: 'offline' });
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'offline', snapshotReceived: false, presence: null, session: { roomId: member.roomId } });
    await h.receive({ kind: 'status', state: 'online' });
    await h.receive(socket('room.presence'));
    expect(h.session.getSnapshot()).toMatchObject({ snapshotReceived: false, presence: null });
    await h.receive(socket('room.snapshot'));
    await h.receive({ kind: 'socket', message: { protocolVersion: 1, type: 'room.presence', roomId: member.roomId, roomEpoch: member.roomEpoch, onlineUserIds: ['not-a-member'] } });
    expect(h.session.getSnapshot().presence).toBeNull();
    await h.receive(socket('room.presence'));
    expect(h.session.getSnapshot().presence?.onlineUserIds).toEqual(['user-host']);
    expect(h.requests.map(value => value.kind)).toEqual(['join']);
  });
});

describe('Desktop current generation recovery through the Native owner', () => {
  const completed = generationFixture.operation.success.result;
  const running = JSON.parse(JSON.stringify({ ...completed, generation: { ...completed.generation, state: 'running', finishedAt: undefined }, status: 'running',
    markdown: 'baseline', nextChunkSeq: 1, finalAuthoritative: false, generationRecordId: undefined, result: undefined }));
  const activeSession = (view = running) => ArenaRoomSessionResponseSchema.parse({ ...host, snapshot: { ...host.snapshot, activeGeneration: view.generation } });
  const story = (chunkSeq: number, delta = `delta-${chunkSeq}`): DesktopRoomEvent => DesktopRoomEventSchema.parse({ kind: 'socket', message: {
    protocolVersion: 1, type: 'story.delta', roomId: host.roomId, roomEpoch: host.roomEpoch,
    generationId: running.generation.generationId, chunkSeq, timestamp: '2026-10-12T00:00:01.000Z', payload: { delta },
  } });
  const control = (type: 'generation.started' | 'generation.completed', controlSeq: number): DesktopRoomEvent => {
    const { generationRequestId, generationId, attempt, configRevision, snapshotDigest, collaborativeInfluence, participantUserIds } = completed.generation;
    return DesktopRoomEventSchema.parse({ kind: 'socket', message: { protocolVersion: 1, type, roomId: host.roomId, roomEpoch: host.roomEpoch,
      controlSeq, timestamp: '2026-10-12T00:01:00.000Z', payload: { generationRequestId, generationId, attempt, configRevision, snapshotDigest,
        collaborativeInfluence, participantUserIds, ...(type === 'generation.completed' ? { generationRecordId: 'record-1' } : {}) } } });
  };
  const transfer = async (h: Harness, requestId: string, view: unknown, invalidDigest = false) => {
    const raw = JSON.stringify({ ...generationFixture.operation.success, result: view });
    const descriptor = { ...generationFixture.descriptor, requestId, byteLength: Buffer.byteLength(raw),
      digest: invalidDigest ? '0'.repeat(64) : createHash('sha256').update(raw).digest('hex') };
    await h.receive(DesktopRoomEventSchema.parse(descriptor));
    await h.receive(DesktopRoomEventSchema.parse({ kind: 'generation-fragment', requestId, offset: 0, text: raw, final: true }));
  };
  async function start(value = activeSession()) {
    const h = await harness(); await joinRoom(h, value);
    const read = h.plan('generation-read'); await installOnlineSnapshot(h, value);
    await read.entered.promise; read.accept(); return { h, read };
  }
  const cancelReceipt = (requestId: string, view = running): DesktopRoomEvent => DesktopRoomEventSchema.parse({ kind: 'http-result', requestId, operation: 'generationCancel', response: {
    desktopRoom: generationFixture.operation.success.desktopRoom,
    result: (({ protocolVersion, roomId, roomEpoch, generation, status }) => ({ protocolVersion, roomId, roomEpoch, generation, status }))(view),
  } });
  it('sends one fixed cancellation, keeps presence/control, and requires final reader ACK to settle a running receipt', async () => {
    const { h, read } = await start(); await transfer(h, read.requestId, running); await whenState(h.session, state => !state.generationReading);
    await h.receive(socket('room.presence'));
    const before = h.session.getSnapshot(), identity = h.session.confirmationOwner()!, target = captureArenaRoomGenerationCancelTarget(before.session)!;
    const cancel = h.plan('generation-cancel'), cancelling = h.session.cancelGeneration(target, identity);
    await cancel.entered.promise;
    await h.session.cancelGeneration(target, identity);
    expect(h.requests.filter(request => request.kind === 'generation-cancel')).toHaveLength(1);
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'online', snapshotReceived: true, presence: before.presence });
    expect(h.session.getSnapshot().session?.snapshot.controlSeq).toBe(before.session?.snapshot.controlSeq);
    cancel.accept(); await cancelling;
    const recovery = h.plan('generation-read'); await h.receive(cancelReceipt(cancel.requestId));
    await recovery.entered.promise; recovery.accept();
    expect(h.session.getSnapshot().unknown).toMatchObject({ operation: 'generationCancel', generationTarget: { generationId: target.generationId } });
    const raw = JSON.stringify({ ...generationFixture.operation.success, result: completed });
    await h.receive(DesktopRoomEventSchema.parse({ ...generationFixture.descriptor, requestId: recovery.requestId, byteLength: Buffer.byteLength(raw), digest: createHash('sha256').update(raw).digest('hex') }));
    const final = h.emit({ kind: 'generation-fragment', requestId: recovery.requestId, offset: 0, text: raw, final: true });
    await final.ackEntered.promise; expect(h.session.getSnapshot().unknown?.operation).toBe('generationCancel');
    final.acknowledge({ generationCancel: { intentId: cancel.requestId, current: true } }); await whenState(h.session, state => state.unknown === null);
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'online', generation: { finalAuthoritative: true } });
    expect(h.subscriptions()).toHaveLength(1);
  });
  it('terminal WSS ACK settles without granting full report and a late running cancel receipt cannot resurrect it', async () => {
    const { h, read } = await start(); await transfer(h, read.requestId, running); await whenState(h.session, state => !state.generationReading);
    const cancel = h.plan('generation-cancel'); const sending = h.session.cancelGeneration(captureArenaRoomGenerationCancelTarget(h.session.getSnapshot().session)!, h.session.confirmationOwner()!);
    await cancel.entered.promise; cancel.accept(); await sending;
    const recovery = h.plan('generation-read');
    const terminal = h.emit(control('generation.completed', host.snapshot.controlSeq + 1));
    await terminal.ackEntered.promise; expect(h.session.getSnapshot().unknown).not.toBeNull(); terminal.acknowledge({ generationCancel: { intentId: cancel.requestId, current: true } });
    await whenState(h.session, state => state.unknown === null); await recovery.entered.promise; recovery.accept();
    expect(h.session.getSnapshot().generation.finalAuthoritative).toBe(false);
    await h.receive(cancelReceipt(cancel.requestId)); await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot().unknown).toBeNull();
    await transfer(h, recovery.requestId, completed);
    expect(h.requests.filter(request => request.kind === 'generation-cancel')).toHaveLength(1);
  });
  it('a terminal body with current=false ACK keeps the intent and prevents stale-snapshot cancellation', async () => {
    const { h, read } = await start(); await transfer(h, read.requestId, running); await whenState(h.session, state => !state.generationReading);
    const cancel = h.plan('generation-cancel'); const sending = h.session.cancelGeneration(captureArenaRoomGenerationCancelTarget(h.session.getSnapshot().session)!, h.session.confirmationOwner()!);
    await cancel.entered.promise; cancel.accept(); await sending;
    const recovery = h.plan('generation-read');
    const receipt = h.emit(cancelReceipt(cancel.requestId, completed)); await receipt.ackEntered.promise;
    receipt.acknowledge({ generationCancel: { intentId: cancel.requestId, current: false } });
    await whenState(h.session, state => !state.busy); await recovery.entered.promise; recovery.accept();
    expect(h.session.getSnapshot().unknown?.intentId).toBe(cancel.requestId);
    expect(h.session.cancelGenerationBlockedReason()).not.toBeNull();
    await transfer(h, recovery.requestId, completed);
    expect(h.session.getSnapshot().unknown?.intentId).toBe(cancel.requestId);
  });
  it.each(['digest', 'schema', 'intent'] as const)('keeps cancel unknown when terminal final ACK has invalid %s proof', async invalid => {
    const { h, read } = await start(); await transfer(h, read.requestId, running); await whenState(h.session, state => !state.generationReading);
    const cancel = h.plan('generation-cancel'); const sending = h.session.cancelGeneration(captureArenaRoomGenerationCancelTarget(h.session.getSnapshot().session)!, h.session.confirmationOwner()!);
    await cancel.entered.promise; cancel.accept(); await sending;
    const recovery = h.plan('generation-read'); await h.receive(cancelReceipt(cancel.requestId));
    await recovery.entered.promise; recovery.accept();
    const raw = JSON.stringify({ ...generationFixture.operation.success, result: invalid === 'schema' ? { ...completed, unexpected: true } : completed });
    await h.receive(DesktopRoomEventSchema.parse({ ...generationFixture.descriptor, requestId: recovery.requestId, byteLength: Buffer.byteLength(raw),
      digest: invalid === 'digest' ? '0'.repeat(64) : createHash('sha256').update(raw).digest('hex') }));
    const final = h.emit({ kind: 'generation-fragment', requestId: recovery.requestId, offset: 0, text: raw, final: true });
    await final.ackEntered.promise;
    final.acknowledge({ generationCancel: { intentId: invalid === 'intent' ? 'another-cancel' : cancel.requestId, current: true } });
    await whenState(h.session, state => !state.generationReading);
    expect(h.session.getSnapshot().unknown?.intentId).toBe(cancel.requestId);
    expect(h.requests.filter(request => request.kind === 'generation-cancel')).toHaveLength(1);
  });
  it.each(['early-availability', 'after-accepted'] as const)('retired bridge errors clear online proof during cancellation with %s', async timing => {
    const { h, read } = await start(); await transfer(h, read.requestId, running); await whenState(h.session, state => !state.generationReading);
    const cancel = h.plan('generation-cancel'); const sending = h.session.cancelGeneration(captureArenaRoomGenerationCancelTarget(h.session.getSnapshot().session)!, h.session.confirmationOwner()!);
    await cancel.entered.promise;
    const early = timing === 'early-availability' ? h.emit(cancelReceipt(cancel.requestId)) : null;
    cancel.accept(); await sending;
    const receipt = early ?? h.emit(cancelReceipt(cancel.requestId)); await receipt.ackEntered.promise; receipt.acknowledge({ accepted: false });
    await whenState(h.session, state => state.phase === 'unavailable');
    expect(h.session.getSnapshot()).toMatchObject({ presence: null, snapshotReceived: false, unknown: { operation: 'generationCancel' } });
  });
  it('reattaches a frozen cancel target and does not clear it on a running Session GET', async () => {
    const h = await harness();
    const target = { roomEpoch: host.roomEpoch, generationId: running.generation.generationId, attempt: running.generation.attempt };
    h.setPending({ operation: 'generationCancel', roomId: host.roomId, intentId: 'original-cancel', generationTarget: target });
    await h.session.open(); const session = h.plan('session'); const checking = h.session.reconcile();
    await session.entered.promise; session.accept(); await checking;
    await h.receive(success('session', session.requestId, activeSession())); await whenState(h.session, state => !state.busy);
    expect(h.session.getSnapshot().unknown).toMatchObject({ intentId: 'original-cancel', generationTarget: target });
    expect(h.requests.map(request => request.kind)).toEqual(['session']);
  });
  it('refuses stale confirmation, member cancellation and account/document changes before dispatch', async () => {
    const { h, read } = await start(); await transfer(h, read.requestId, running); await whenState(h.session, state => !state.generationReading);
    const target = captureArenaRoomGenerationCancelTarget(h.session.getSnapshot().session)!, identity = h.session.confirmationOwner()!;
    for (const stale of [{ ...target, generationId: 'old-generation' }, { ...target, attempt: target.attempt + 1 }, { ...target, roomEpoch: 'old-epoch' }]) await h.session.cancelGeneration(stale, identity);
    h.setNonce('b'.repeat(64)); await h.session.cancelGeneration(target, identity);
    expect(h.requests.filter(request => request.kind === 'generation-cancel')).toHaveLength(0);
    const memberValue = activeSession(); memberValue.self = member.self;
    const other = await start(memberValue); await transfer(other.h, other.read.requestId, running);
    await other.h.session.cancelGeneration(target, other.h.session.confirmationOwner()!);
    expect(other.h.requests.filter(request => request.kind === 'generation-cancel')).toHaveLength(0);
  });
  it.each(['close', 'leave', 'config', 'proposal-resolve'] as const)('keeps the room online when %s is refused admission during a background generation read', async kind => {
    const value = activeSession();
    if (kind === 'leave') value.self = member.self;
    if (kind === 'proposal-resolve') value.snapshot.proposals = [proposal];
    const { h, read } = await start(value);
    await h.receive(socket('room.presence'));
    const before = h.session.getSnapshot(), subscriptionCount = h.subscriptions().length;
    expect(before).toMatchObject({ phase: 'online', snapshotReceived: true, busy: false, generationReading: true });
    expect(before.presence).not.toBeNull();
    const request = h.plan(kind);
    const action = () => kind === 'close' ? h.session.close() : kind === 'leave' ? h.session.leave()
      : kind === 'config' ? h.session.publishConfig(h.session.getSnapshot().session!, { ...value.snapshot.sharedConfig, userGuidance: 'changed' }, h.session.confirmationOwner()!, () => true)
      : h.session.resolveProposal(h.session.getSnapshot().session!, proposal, rejectProposal(value), h.session.confirmationOwner()!);
    const operation = action(); await request.entered.promise;
    request.response.reject({ code: 'busy', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'not-applied' }); await operation;
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'online', snapshotReceived: true, busy: false, generationReading: true,
      unknown: null, configTracking: null, proposalTracking: null });
    expect(h.session.getSnapshot().presence).toEqual(before.presence);
    expect(h.session.getSnapshot().error).toContain('重试');
    expect(h.subscriptions()).toHaveLength(subscriptionCount);
    expect(h.invoke.mock.calls.filter(([command]) => command === DESKTOP_ROOM_IPC_COMMANDS.detach)).toHaveLength(0);
    await transfer(h, read.requestId, completed); await whenState(h.session, state => state.generation.finalAuthoritative);
    const retry = h.plan(kind), retrying = action(); await retry.entered.promise;
    retry.response.reject({ code: 'busy', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'not-applied' }); await retrying;
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'online', snapshotReceived: true, busy: false });
  });
  it.each(['close', 'config', 'proposalResolve'] as const)('retains the original %s unknown intent when its reconciliation read is locally busy', async operation => {
    const { h } = await start(); await h.receive(socket('room.presence'));
    const pending = { kind: 'mutation-unknown' as const, operation, roomId: host.roomId, intentId: 'original-unknown' };
    await h.receive(pending);
    const before = h.session.getSnapshot(), read = h.plan('session'), checking = h.session.reconcile();
    await read.entered.promise; read.response.reject({ code: 'busy', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'not-applied' }); await checking;
    const after = h.session.getSnapshot();
    expect(after).toMatchObject({ phase: 'online', snapshotReceived: true, busy: false, generationReading: true, unknown: pending });
    expect(after.presence).toEqual(before.presence);
    expect(after.configTracking).toEqual(before.configTracking);
    expect(after.proposalTracking).toEqual(before.proposalTracking);
  });
  it('reads the first current generation, rebases buffered preview, and confirms terminal control only from GET', async () => {
    const { h, read } = await start();
    const before = h.session.getSnapshot(), subscriptions = h.subscriptions().length;
    await h.receive(story(1, '+buffered'));
    expect(h.session.getSnapshot().generation.markdown).toBe('');
    await transfer(h, read.requestId, running);
    await whenState(h.session, state => !state.generationReading);
    expect(h.session.getSnapshot().generation).toMatchObject({ phase: 'running', markdown: 'baseline+buffered', finalAuthoritative: false });
    await h.receive(story(2, '+live'));
    expect(h.session.getSnapshot().generation.markdown).toBe('baseline+buffered+live');
    const terminal = h.plan('generation-read'); await h.receive(control('generation.completed', host.snapshot.controlSeq + 1));
    await terminal.entered.promise; terminal.accept();
    expect(h.session.getSnapshot().generation.finalAuthoritative).toBe(false);
    await transfer(h, terminal.requestId, completed);
    await whenState(h.session, state => state.generation.finalAuthoritative);
    expect(h.session.getSnapshot().generation.markdown).toBe(completed.markdown);
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'online', busy: false, constrained: before.constrained });
    expect(h.session.getSnapshot().session!.snapshot.sharedConfig).toEqual(before.session!.snapshot.sharedConfig);
    expect(h.subscriptions()).toHaveLength(subscriptions);
  });
  it('coalesces terminal/reconnect while a read is pending and cannot install a stale running response', async () => {
    const { h, read } = await start();
    await h.receive(control('generation.completed', host.snapshot.controlSeq + 1));
    const terminalSession = { ...activeSession(completed), snapshot: { ...activeSession(completed).snapshot, controlSeq: host.snapshot.controlSeq + 1 } };
    await installOnlineSnapshot(h, terminalSession); await installOnlineSnapshot(h, terminalSession);
    expect(h.requests.filter(request => request.kind === 'generation-read')).toHaveLength(1);
    const rerun = h.plan('generation-read'); await transfer(h, read.requestId, running);
    await rerun.entered.promise; rerun.accept();
    expect(h.session.getSnapshot().generation.markdown).toBe('');
    await transfer(h, rerun.requestId, completed); await whenState(h.session, state => state.generation.finalAuthoritative);
    expect(h.requests.filter(request => request.kind === 'generation-read')).toHaveLength(2);
  });
  it.each(['digest', 'too-large', 'invalid-dto'])('stops automatic %s reads for this identity and permits explicit retry without changing online state', async kind => {
    const { h, read } = await start();
    if (kind === 'too-large') await h.receive({ kind: 'request-error', requestId: read.requestId, operation: 'generationRead',
      error: { code: 'response-too-large', message: DESKTOP_ROOM_ERROR_MESSAGE, outcome: 'not-applicable' } });
    else await transfer(h, read.requestId, kind === 'invalid-dto' ? { ...running, extra: true } : running, kind === 'digest');
    await whenState(h.session, state => !state.generationReading);
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'online', generation: { recoveryCode: 'ROOM_GENERATION_RECOVERY_PROTOCOL' } });
    await installOnlineSnapshot(h, activeSession()); await h.receive(story(7)); await h.receive(control('generation.completed', host.snapshot.controlSeq + 1));
    expect(h.requests.filter(request => request.kind === 'generation-read')).toHaveLength(1);
    const retry = h.plan('generation-read'), retrying = h.session.retryGenerationRecovery();
    await retry.entered.promise; retry.accept(); await transfer(h, retry.requestId, completed); await retrying;
    expect(h.session.getSnapshot().generation.finalAuthoritative).toBe(true);
  });
  it.each(['descriptor', 'offset'])('keeps a stalled invalid %s stable across reconnect and terminal triggers', async kind => {
    vi.useFakeTimers();
    try {
      const { h, read } = await start();
      await h.receive({ ...generationFixture.descriptor, requestId: read.requestId, ...(kind === 'descriptor' ? { roomId: 'other-room' } : {}) });
      if (kind === 'offset') await h.receive({ ...generationFixture.fragments[0], requestId: read.requestId, offset: 1 });
      await vi.advanceTimersByTimeAsync(30_001);
      await whenState(h.session, state => !state.generationReading);
      expect(h.session.getSnapshot()).toMatchObject({ phase: 'online', generation: { recoveryCode: 'ROOM_GENERATION_RECOVERY_PROTOCOL' } });
      await installOnlineSnapshot(h, activeSession()); await h.receive(story(7));
      await h.receive(control('generation.completed', host.snapshot.controlSeq + 1));
      expect(h.requests.filter(request => request.kind === 'generation-read')).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
  it('recovers a gap from a fresh baseline without treating preview as authoritative', async () => {
    const { h, read } = await start(); await transfer(h, read.requestId, running); await whenState(h.session, state => !state.generationReading);
    const gap = h.plan('generation-read'); await h.receive(story(3, '+third')); await gap.entered.promise; gap.accept();
    await h.receive(story(4, '+fourth')); expect(h.session.getSnapshot().generation.finalAuthoritative).toBe(false);
    await transfer(h, gap.requestId, { ...running, markdown: 'fresh-through-two', nextChunkSeq: 3 });
    await whenState(h.session, state => !state.generationReading);
    expect(h.session.getSnapshot().generation).toMatchObject({ markdown: 'fresh-through-two+third+fourth', gap: null, finalAuthoritative: false });
  });
  it('retains an already-previewed suffix while a second GET still predates the buffered hole', async () => {
    const { h, read } = await start();
    await h.receive(story(1, '+one')); await h.receive(story(3, '+three'));
    const rerun = h.plan('generation-read'); await transfer(h, read.requestId, running);
    await rerun.entered.promise; rerun.accept();
    expect(h.session.getSnapshot().generation.markdown).toBe('baseline+one');
    await h.receive(story(2, '+two')); await h.receive(story(4, '+four'));
    await transfer(h, rerun.requestId, running); await whenState(h.session, state => !state.generationReading);
    expect(h.session.getSnapshot().generation).toMatchObject({ markdown: 'baseline+one+two+three+four', gap: null });
    expect(h.requests.filter(request => request.kind === 'generation-read')).toHaveLength(2);
  });
  it.each(['detach', 'document', 'account', 'member-ended', 'epoch', 'generation'])('never installs a late digest after %s changes', async reason => {
    const { h, read } = await start();
    const digest = deferred<ArrayBuffer>(), spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(() => digest.promise);
    try {
      await transfer(h, read.requestId, completed);
      if (reason === 'detach') h.session.detach();
      if (reason === 'document') h.setNonce('b'.repeat(64));
      if (reason === 'account') await h.account.signOut();
      if (reason === 'member-ended') await h.receive({ kind: 'status', state: 'closed' });
      if (reason === 'epoch' || reason === 'generation') {
        const value = activeSession();
        const updated = reason === 'epoch' ? { ...value, roomEpoch: 'new-epoch', snapshot: { ...value.snapshot, roomEpoch: 'new-epoch' } }
          : { ...value, snapshot: { ...value.snapshot, activeGeneration: { ...value.snapshot.activeGeneration!, generationId: 'new-generation', attempt: 2 } } };
        await installOnlineSnapshot(h, updated);
      }
      digest.resolve(Uint8Array.from(Buffer.from(createHash('sha256').update(JSON.stringify({ ...generationFixture.operation.success, result: completed })).digest('hex'), 'hex')).buffer);
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(h.session.getSnapshot().generation.finalAuthoritative).toBe(false);
      expect(h.session.getSnapshot().generation.markdown).toBe('');
    } finally { spy.mockRestore(); }
  });
});
