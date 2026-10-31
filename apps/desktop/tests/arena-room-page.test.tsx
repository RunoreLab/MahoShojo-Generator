// @vitest-environment jsdom
/** Real Desktop routes, shared views, Room owner and bridge; only Native/browser ports are fixtures. */
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ipcFixture from '@mahoshojo/contracts/fixtures/desktop-room-ipc.json';
import serviceFixture from '@mahoshojo/contracts/fixtures/desktop-room-session.json';
import generationFixture from '@mahoshojo/contracts/fixtures/desktop-room-generation-read.json';
import {
  DESKTOP_ROOM_IPC_COMMANDS, DesktopRoomAttachRequestSchema, DesktopRoomBatchSchema,
  DesktopRoomRequestSchema, DesktopRoomSubscribeRequestSchema, getDesktopRoomHttpOperation,
  type DesktopRoomAttachResponse, type DesktopRoomBatch, type DesktopRoomHttpAction,
  type DesktopRoomSubscribeRequest,
} from '@mahoshojo/contracts/desktop-room-ipc';
import { MAX_ROOM_MEMBERS, PROPOSAL_VERSION, type ArenaProposal, type ArenaRoomSessionResponse, type ArenaRoomGenerationViewResponse } from '@mahoshojo/contracts/arena-room';
import { createDesktopRouter } from '../src/app/router';
import { parseArenaRoomJoinCode } from '@mahoshojo/multiplayer-core/room-join-code';
import { createRoomInviteScope } from '@mahoshojo/ui-web/arena-room';
import { DESKTOP_PRODUCT_ORIGIN } from '../src/platform/product-origin';
import type { DesktopArenaRoomSession } from '../src/features/arena/room-session';
import { ADVANCED_ARENA_DRAFT_KEY, ARENA_DRAFT_KEY, createInitialArenaDraft, type ArenaDraft } from '../src/features/arena/session';
import { DESKTOP_AI_CONFIG_STORAGE_KEY } from '../src/features/ai-config/desktop-ai-config-store';
import { getDesktopAiConfigStore, resetDesktopAiConfigStoreForTests } from '../src/features/ai-config/use-desktop-ai-config';
import { getDesktopCloudSessionStore, resetDesktopCloudSessionStoreForTests } from '../src/features/account/use-desktop-cloud-session';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), download: vi.fn(), downloadBlob: vi.fn(), capture: vi.fn(), owner: null as DesktopArenaRoomSession | null, roomRenders: [] as (string | null)[] }));
vi.mock('../src/platform/download-text-file', () => ({ downloadTextFile: mocks.download, downloadBinaryFile: vi.fn(), downloadBlobFile: mocks.downloadBlob }));
vi.mock('@mahoshojo/ui-web/client', async original => ({ ...await original<object>(), capturePngBlob: mocks.capture }));
// Observe the actual route-owned owner; render the original panel unchanged. No state or methods are replaced.
vi.mock('../src/features/arena/room-panel', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/features/arena/room-panel')>();
  const React = await import('react');
  return { ...actual, DesktopArenaRoomPanel: (props: import('../src/features/arena/room-panel').DesktopArenaRoomPanelProps) => {
    const state = React.useSyncExternalStore(props.owner.subscribe, props.owner.getSnapshot);
    mocks.owner = props.owner; mocks.roomRenders.push(state.session?.roomId ?? null);
    return React.createElement(actual.DesktopArenaRoomPanel, props);
  } };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true, Channel: class { onmessage?: (value: unknown) => void; } }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen }) }));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
type Signal<T> = ReturnType<typeof deferred<T>>;
type NativeChannel = { onmessage?: (value: unknown) => void };
type Operation = { action: DesktopRoomHttpAction; requestId: string; handle: string; subscriptionId: string };
type Delivery = {
  batch: DesktopRoomBatch; channel: NativeChannel; pullStarted: Signal<void>; ackStarted: Signal<void>;
  pullGate: Signal<void>; ackGate: Signal<void>; pullReturned: Signal<void>;
};

/** A queued Native endpoint: notifications never contain bodies, and ACK gates real subscription dispatch. */
class RoomNativeFixture {
  readonly actions: Operation[] = [];
  readonly subscriptions: DesktopRoomSubscribeRequest[] = [];
  readonly acknowledgements: { subscriptionId: string; batchId: string; sequence: number }[] = [];
  readonly order: string[] = [];
  pendingIntent: DesktopRoomAttachResponse['pendingIntent'] = null;
  generationReadCurrent = true;
  generationStartFence: DesktopRoomAttachResponse['generationStartFence'] = null;
  channel: NativeChannel = {};
  handle = ipcFixture.attach.handle;
  subscriptionId = ipcFixture.attach.subscriptionId;
  private attachCount = 0;
  private sequence = 0;
  private deliveries = new Map<string, Delivery>();
  private expectedAction: { kind: DesktopRoomHttpAction['kind']; signal: Signal<Operation> } | null = null;
  private expectedSubscription: Signal<DesktopRoomSubscribeRequest> | null = null;

  nextAction(kind: DesktopRoomHttpAction['kind']) {
    expect(this.expectedAction).toBeNull();
    const signal = deferred<Operation>(); this.expectedAction = { kind, signal }; return signal.promise;
  }
  nextSubscription() {
    expect(this.expectedSubscription).toBeNull();
    const signal = deferred<DesktopRoomSubscribeRequest>(); this.expectedSubscription = signal; return signal.promise;
  }
  async invoke(command: string, args: Record<string, unknown>): Promise<unknown> {
    if (command === DESKTOP_ROOM_IPC_COMMANDS.attach) {
      const request = DesktopRoomAttachRequestSchema.parse(args.request);
      expect(request.expectedUserId).toBe(serviceFixture.expectedUserId);
      this.channel = args.onEvent as NativeChannel;
      this.attachCount += 1; this.handle = `page-handle-${this.attachCount}`;
      this.subscriptionId = `page-lobby-${this.attachCount}`; this.sequence = 0;
      this.order.push('attach');
      return { handle: this.handle, subscriptionId: this.subscriptionId, pendingIntent: this.pendingIntent, generationStartBlocked: !!this.generationStartFence, generationStartFence: this.generationStartFence };
    }
    if (command === DESKTOP_ROOM_IPC_COMMANDS.detach) { this.order.push('detach'); return { detached: true }; }
    if (command === DESKTOP_ROOM_IPC_COMMANDS.subscribe) {
      const request = DesktopRoomSubscribeRequestSchema.parse(args.request);
      this.subscriptions.push(request); this.order.push('subscribe');
      this.subscriptionId = `page-socket-${this.attachCount}-${this.subscriptions.length}`; this.sequence = 0;
      this.expectedSubscription?.resolve(request); this.expectedSubscription = null;
      return { handle: this.handle, subscriptionId: this.subscriptionId };
    }
    if (command !== DESKTOP_ROOM_IPC_COMMANDS.request) throw new Error(`Unexpected Room command: ${command}`);
    const envelope = DesktopRoomRequestSchema.parse(args.request), action = envelope.request;
    if (action.kind === 'pull') {
      const delivery = this.deliveries.get(action.subscriptionId);
      expect(delivery, 'only notified bounded batches can be pulled').toBeDefined();
      if (!delivery) throw new Error('Missing queued batch');
      this.order.push(`pull:${delivery.batch.batchId}`); delivery.pullStarted.resolve();
      await delivery.pullGate.promise; delivery.pullReturned.resolve();
      return { kind: 'batch', batch: delivery.batch };
    }
    if (action.kind === 'ack') {
      const delivery = this.deliveries.get(action.subscriptionId);
      expect(delivery?.batch).toMatchObject({ handle: envelope.handle, subscriptionId: action.subscriptionId, batchId: action.batchId, sequence: action.sequence });
      if (!delivery) throw new Error('ACK without a queued batch');
      this.acknowledgements.push(action); this.order.push(`ack:${action.batchId}`); delivery.ackStarted.resolve();
      await delivery.ackGate.promise; this.deliveries.delete(action.subscriptionId);
      const event = delivery.batch.event;
      if (event.kind === 'proposal-observation' && event.observation.settle && this.pendingIntent?.intentId === event.intentId) this.pendingIntent = null;
      this.order.push(`acknowledged:${action.batchId}`);
      return { kind: 'acknowledged', handle: envelope.handle, subscriptionId: action.subscriptionId, batchId: action.batchId, sequence: action.sequence, accepted: true,
        ...(event.kind === 'generation-fragment' && event.final ? { generationRead: { requestId: event.requestId, current: this.generationReadCurrent } } : {}) };
    }
    if (action.kind === 'end-generation-start-tracking') {
      expect(this.pendingIntent?.intentId).toBe(action.intentId);
      if (this.pendingIntent?.cancelMode === 'starting-v1') expect(this.generationStartFence?.cancelIntentId).toBe(action.intentId);
      else this.generationStartFence = { roomId: this.pendingIntent!.roomId!, generationRequestId: this.pendingIntent!.generationStart!.generationRequestId };
      this.pendingIntent = null;
      return { kind: 'generation-start-tracking-ended', intentId: action.intentId, ended: true, generationStartBlocked: true, generationStartFence: this.generationStartFence };
    }
    if (action.kind === 'end-config-tracking' || action.kind === 'end-proposal-tracking') {
      expect(this.pendingIntent?.intentId).toBe(action.intentId); this.pendingIntent = null;
      this.order.push(action.kind);
      return { kind: action.kind === 'end-config-tracking' ? 'config-tracking-ended' : 'proposal-tracking-ended', intentId: action.intentId, ended: true };
    }
    const operation = { action, handle: this.handle, subscriptionId: this.subscriptionId, requestId: `page-request-${this.actions.length}` };
    this.actions.push(operation); this.order.push(`request:${action.kind}`);
    if (this.expectedAction) {
      expect(action.kind).toBe(this.expectedAction.kind);
      this.expectedAction.signal.resolve(operation); this.expectedAction = null;
    }
    return { kind: 'accepted', handle: operation.handle, subscriptionId: operation.subscriptionId, requestId: operation.requestId };
  }
  queue(event: unknown, options: { holdPull?: boolean; holdAck?: boolean } = {}): Delivery {
    expect(this.deliveries.has(this.subscriptionId), 'one bounded batch at a time').toBe(false);
    const sequence = this.sequence++;
    const batch = DesktopRoomBatchSchema.parse({ handle: this.handle, subscriptionId: this.subscriptionId, batchId: `page-batch-${this.attachCount}-${this.subscriptions.length}-${sequence}`, sequence, event });
    if (batch.event.kind === 'mutation-unknown') {
      const { operation, intentId, roomId } = batch.event;
      this.pendingIntent = { operation, intentId, roomId, ...(batch.event.generationStart ? { generationStart: batch.event.generationStart } : {}), ...(batch.event.generationTarget ? { generationTarget: batch.event.generationTarget } : {}), ...(batch.event.cancelMode ? { cancelMode: batch.event.cancelMode, startIntentId: batch.event.startIntentId } : {}) };
    }
    const delivery = { batch, channel: this.channel, pullStarted: deferred<void>(), ackStarted: deferred<void>(), pullGate: deferred<void>(), ackGate: deferred<void>(), pullReturned: deferred<void>() };
    if (!options.holdPull) delivery.pullGate.resolve();
    if (!options.holdAck) delivery.ackGate.resolve();
    this.deliveries.set(this.subscriptionId, delivery); return delivery;
  }
  notify(delivery: Delivery) {
    const { handle, subscriptionId, sequence } = delivery.batch;
    delivery.channel.onmessage?.({ type: 'available', handle, subscriptionId, sequence });
  }
  async deliver(event: unknown, options: { holdAck?: boolean } = {}) {
    const delivery = this.queue(event, options);
    await act(async () => { this.notify(delivery); await delivery.ackStarted.promise; });
    return delivery;
  }
}

let root: Root, container: HTMLDivElement, port: RoomNativeFixture;
let account: { userId: number; username: string } | null;
let originalClipboard: PropertyDescriptor | undefined;
let originalExecCommand: PropertyDescriptor | undefined;
const reportText = '普通单次结果：甲与乙共同守护车站。';
const profile = { version: 1, id: 'room-page-direct', name: '房间测试普通连接', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:18080/v1', modelId: 'fixture-default-model', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' };
const publicCard = { id: 'missing-version-card', name: '缺版本在线角色', type: 'character', is_public: 1, description: '缺少实际观察版本的公开卡', data: JSON.stringify({ templateId: '通用角色', name: '缺版本在线角色', content: '不得随房间创建上传的私有正文', _updatedAt: 'body-metadata-is-not-a-version' }) };
const buttons = (scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')];
const button = (text: string, scope: ParentNode = document) => buttons(scope).find(item => item.textContent?.trim() === text);
const requiredButton = (text: string, scope?: ParentNode) => { const found = button(text, scope); expect(found, text).toBeTruthy(); return found!; };
const click = async (text: string, scope?: ParentNode) => { await act(async () => requiredButton(text, scope).click()); };
const room = () => { const node = container.querySelector<HTMLElement>('[aria-label="桌面多人房间"]'); expect(node).not.toBeNull(); return node!; };
const change = async (selector: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(selector); expect(input, selector).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const ordinarySnapshot = () => ({
  ai: localStorage.getItem(DESKTOP_AI_CONFIG_STORAGE_KEY),
  advanced: localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY), battle: localStorage.getItem(ARENA_DRAFT_KEY),
  selection: structuredClone(getDesktopAiConfigStore().getSnapshot().selection),
  models: structuredClone(getDesktopAiConfigStore().getSnapshot().modelsByProfileId),
});
const assertNoExecution = () => {
  expect(mocks.invoke.mock.calls.filter(([command]) => ['stream_direct_ai', 'stream_target_ai', 'stream_hosted_ai', 'hosted_ai_request', 'arena_hosted_stream'].includes(command))).toEqual([]);
};
const assertConstrained = () => {
  expect(room().textContent).toContain('有效执行位置：服务器');
  // Ordinary controls stay mounted so unsaved local editor state survives Room mode.
  const generate = requiredButton('生成战报');
  expect(generate.closest('[hidden]')).not.toBeNull();
  expect(generate.matches(':disabled')).toBe(true);
  const result = container.querySelector('[aria-label="战报结果"]');
  if (result) expect(result.closest('[hidden]')).not.toBeNull();
  const diagnostics = container.querySelector('[aria-label="严格排位配置检查"]');
  expect(diagnostics).not.toBeNull();
  expect(diagnostics!.closest('[hidden]')).not.toBeNull();
  for (const control of container.querySelectorAll('textarea, [aria-label="API Key"], [role="combobox"]')) {
    if (control.closest('[aria-label="本次房间服务器生成选择"]')) continue;
    if (mocks.owner?.getSnapshot().session?.self.role !== 'host') expect(control.closest('[hidden]')).not.toBeNull();
    if (!mocks.owner?.canEditHostDraft()) expect(control.matches(':disabled')).toBe(true);
  }
  for (const label of ['生成战报', '发布配置', '提交提案', '开始协作生成', '发起生成', '启用严格排位']) expect(button(label, room())).toBeUndefined();
  assertNoExecution();
};
const assertNoOnline = () => {
  expect(room().querySelector('[data-member-presence="online"]')).toBeNull();
  expect([...room().querySelectorAll('[role="status"]')].some(node => node.textContent === '已在线')).toBe(false);
};
const savedDraft = (patch: Partial<ArenaDraft> = {}): ArenaDraft => ({
  ...createInitialArenaDraft(), battleMode: 'daily', generationMode: 'stream',
  combatants: ['甲', '乙'].map(name => ({ type: 'general-character', data: { templateId: '通用角色', name, content: `${name}完整本机设定` }, filename: `${name}.json`, isPreset: false, isValid: false })),
  ...patch,
});
const seedOrdinary = (draft = savedDraft()) => {
  localStorage.setItem(ADVANCED_ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft, output: { phase: 'completed', rawText: reportText, markdown: reportText, reasoning: '保留普通推理', reportFormat: 'markdown', generationMode: 'stream', executionMode: 'direct-local' } }));
  localStorage.setItem(ARENA_DRAFT_KEY, JSON.stringify({ version: 1, draft: savedDraft({ settings: { ...createInitialArenaDraft().settings, userGuidance: '简洁版独立草稿' } }) }));
};
const mount = async (path: '/arena' | '/battle' = '/arena') => {
  window.location.hash = `#${path}`;
  const router = createDesktopRouter(); await router.load();
  await act(async () => root.render(<StrictMode><RouterProvider router={router} /></StrictMode>));
  await act(async () => {
    await getDesktopCloudSessionStore().bootstrap();
    await getDesktopAiConfigStore().refreshProfiles();
  });
  expect(container.textContent).toContain('生成战报');
  return router;
};
const open = async () => {
  await click('打开多人大厅');
  expect(room().textContent).toContain('大厅已就绪');
  expect(port.order.filter(item => item === 'attach')).toHaveLength(1);
};
const startAction = async (label: string, kind: DesktopRoomHttpAction['kind']) => {
  const next = port.nextAction(kind); let operation!: Operation;
  await act(async () => { requiredButton(label, room()).click(); operation = await next; });
  return operation;
};
const responseEvent = (operation: Operation, result: unknown) => ({
  kind: 'http-result', requestId: operation.requestId,
  operation: getDesktopRoomHttpOperation(operation.action),
  response: { desktopRoom: serviceFixture.operations.create.success.desktopRoom, result },
});
const deliverGeneration = async (operation: Operation, view: ArenaRoomGenerationViewResponse, holdFinalAck = false) => {
  const text = JSON.stringify({ desktopRoom: serviceFixture.operations.create.success.desktopRoom, result: view });
  const split = text.indexOf('"markdown"');
  expect(split).toBeGreaterThan(0);
  await port.deliver({ kind: 'generation-descriptor', requestId: operation.requestId,
    roomId: view.roomId, roomEpoch: view.roomEpoch, generationId: view.generation.generationId, attempt: view.generation.attempt,
    byteLength: Buffer.byteLength(text, 'utf8'), digest: createHash('sha256').update(text).digest('hex') });
  await port.deliver({ kind: 'generation-fragment', requestId: operation.requestId, offset: 0, text: text.slice(0, split), final: false });
  expect(room().textContent).not.toContain(view.markdown);
  return port.deliver({ kind: 'generation-fragment', requestId: operation.requestId,
    offset: Buffer.byteLength(text.slice(0, split), 'utf8'), text: text.slice(split), final: true }, { holdAck: holdFinalAck });
};
const sessionFor = (role: 'host' | 'member'): ArenaRoomSessionResponse => {
  const session = structuredClone(serviceFixture.operations.create.success.result) as ArenaRoomSessionResponse;
  session.self = session.snapshot.members.find(member => member.role === role)!;
  expect(session.snapshot.members.find(member => member.userId === session.self.userId)).toEqual(session.self);
  return session;
};
const confirmMembership = async (operation: Operation, role: 'host' | 'member', session = sessionFor(role)) => {
  const subscribed = port.nextSubscription();
  await port.deliver(responseEvent(operation, session));
  await act(async () => { expect(await subscribed).toMatchObject({ roomId: session.roomId, expectedRoomEpoch: session.roomEpoch }); });
  return session;
};
const publishOnline = async (session: ArenaRoomSessionResponse) => {
  await port.deliver({ kind: 'status', state: 'online' }); assertNoOnline();
  const snapshot = snapshotEvent(session);
  await port.deliver(snapshot); assertNoOnline();
  const presence = structuredClone(ipcFixture.pulls[13]!.batch.event) as { kind: 'socket'; message: { onlineUserIds: string[] } };
  presence.message.onlineUserIds = [session.self.userId];
  await port.deliver(presence);
  expect(room().querySelectorAll('[data-member-presence="online"]')).toHaveLength(1);
  expect(room().querySelectorAll('[data-member-presence="offline"]')).toHaveLength(1);
  expect(room().textContent).toContain('当前 2 位成员，1 人在线，1 人离线。');
};
const snapshotEvent = (session: ArenaRoomSessionResponse) => ({
  kind: 'socket', message: { protocolVersion: 1, type: 'room.snapshot', roomId: session.roomId,
    roomEpoch: session.roomEpoch, controlSeq: session.snapshot.controlSeq, timestamp: '2026-10-15T12:00:00Z', payload: session.snapshot },
});
const reviewSession = (): ArenaRoomSessionResponse => {
  const session = sessionFor('host');
  const proposal: ArenaProposal = { proposalVersion: PROPOSAL_VERSION, proposalId: 'host-review-proposal', roomId: session.roomId,
    authorUserId: session.snapshot.members.find(member => member.role === 'member')!.userId,
    baseRevision: session.snapshot.revision - 2, status: 'submitted', createdAt: '2026-10-15T12:00:00Z',
    changes: [
      { changeId: 'guidance', type: 'setUserGuidance', expectedBase: { kind: 'value', value: session.snapshot.sharedConfig.userGuidance }, value: '仅更新服务器提案引导' },
      { changeId: 'language', type: 'setSelectedLanguage', expectedBase: { kind: 'value', value: session.snapshot.sharedConfig.selectedLanguage }, value: 'en-US' },
    ],
  };
  session.snapshot.proposals = [proposal];
  return session;
};
const proposalCard = (proposalId = 'host-review-proposal') => {
  const title = [...room().querySelectorAll<HTMLElement>('[title]')].find(item => item.title === proposalId);
  const card = title?.closest('li'); expect(card, proposalId).toBeTruthy(); return card!;
};
const proposalResult = (session: ArenaRoomSessionResponse, status: 'accepted' | 'partially_accepted' = 'partially_accepted') => ({
  protocolVersion: 1, roomId: session.roomId, roomEpoch: session.roomEpoch, controlSeq: session.snapshot.controlSeq,
  revision: session.snapshot.revision, proposalId: 'host-review-proposal', status, result: 'applied',
  sharedConfig: session.snapshot.sharedConfig, snapshot: session.snapshot,
});
const beginReview = async (session = reviewSession()) => {
  seedOrdinary(); await mount(); await open();
  const creating = await startAction('创建多人房间', 'create');
  await confirmMembership(creating, 'host', session); await publishOnline(session);
  return session;
};
const loseProposalResult = async (resolving: Operation, session: ArenaRoomSessionResponse, intentId: string) => {
  await port.deliver({ kind: 'mutation-unknown', operation: 'proposalResolve', intentId, roomId: session.roomId });
  await port.deliver({ kind: 'request-error', operation: 'proposalResolve', requestId: resolving.requestId, error: ipcFixture.error });
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
  mocks.owner = null; mocks.roomRenders = [];
  vi.clearAllMocks(); localStorage.clear(); resetDesktopAiConfigStoreForTests(); resetDesktopCloudSessionStoreForTests();
  mocks.download.mockReset(); mocks.downloadBlob.mockReset(); mocks.capture.mockReset().mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(window, '__MAHOSHOJO_ROOM_DOCUMENT_V1__', { configurable: true, writable: true, value: ipcFixture.attachRequest.documentNonce });
  port = new RoomNativeFixture(); account = { userId: serviceFixture.expectedUserId, username: '普通账号' };
  localStorage.setItem(DESKTOP_AI_CONFIG_STORAGE_KEY, JSON.stringify({ version: 5, selection: { executionPreference: 'client', clientTarget: { kind: 'custom', profileId: profile.id }, serverTarget: { kind: 'system' }, systemModelId: 'default' }, hiddenPresetIds: [], modelsByProfileId: { [profile.id]: { selectedModelId: 'ordinary-selected-model', customModelIds: ['ordinary-selected-model'] } }, presetsByProviderId: {} }));
  mocks.listen.mockResolvedValue(vi.fn());
  mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    if (Object.values(DESKTOP_ROOM_IPC_COMMANDS).includes(command as never)) return port.invoke(command, args);
    if (command === 'cloud_cached_account') return account ? { account } : null;
    if (command === 'cloud_auth_status') return account ? { state: 'active', account } : { state: 'signed-out' };
    if (command === 'cloud_sign_out') { account = null; return { revoked: true }; }
    if (command === 'list_provider_profile_ids') return [profile.id];
    if (command === 'get_provider_profile') return JSON.stringify(profile);
    if (command === 'has_provider_secret') return true;
    if (command === 'list_local_cards' || command === 'list_web_packages') return { documents: [] };
    if (command === 'list_arena_story_sessions') return { rows: [], nextCursor: null };
    if (command === 'describe_arena_story_pending') return null;
    if (command === 'cloud_card_library_request') {
      const request = args.request as { routeId: string; query?: Record<string, string> };
      if (request.routeId === 'public-data-cards.query') return { status: 200, body: request.query?.id ? { success: true, card: publicCard } : { success: true, cards: [publicCard], total: 1 } };
      return { status: 200, body: { success: true, cards: [], tags: [], total: 0 } };
    }
    // Optional top-bar profile/message reads are outside this route slice.
    throw new Error(`Unconfigured Native command: ${command}`);
  });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/languages.json') return new Response(JSON.stringify([{ code: 'zh-CN', name: '简体中文' }, { code: 'en-US', name: '英语' }]));
    if (url.startsWith('/presets/') || url.startsWith('/scenario-presets/') || url.startsWith('/questionnaires/')) return new Response(readFileSync(resolve(process.cwd(), '../../content', url.slice(1)), 'utf8'));
    throw new Error(`Unexpected browser request: ${url}`);
  }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  Reflect.deleteProperty(window, '__MAHOSHOJO_ROOM_DOCUMENT_V1__');
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard); else Reflect.deleteProperty(navigator, 'clipboard');
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand); else Reflect.deleteProperty(document, 'execCommand');
  vi.useRealTimers();
});

describe('Desktop /arena Room journey through the real route and Native bridge', () => {
  it('uses shared room BYOK controls, requires saved Key, freezes confirmation and retries only the original intent', async () => {
    seedOrdinary(); await mount(); const before = ordinarySnapshot(); await open();
    const creating = await startAction('创建多人房间', 'create');
    if (creating.action.kind !== 'create') throw new Error('Expected create');
    const session = reviewSession(); session.snapshot.sharedConfig = creating.action.request.sharedConfig; session.snapshot.activeGeneration = null;
    await confirmMembership(creating, 'host', session); await publishOnline(session);
    const funding = () => room().querySelector<HTMLElement>('[aria-label="本次房间服务器生成选择"]')!;
    const selectProvider = async (name: string) => {
      await act(async () => funding().querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
      const option = [...funding().querySelectorAll<HTMLButtonElement>('[role="option"]')].find(node => node.querySelector('span')?.textContent === name);
      expect(option).toBeTruthy(); await act(async () => option!.click());
    };
    expect(funding().textContent).toContain('服务器系统默认');
    await selectProvider('DeepSeek');
    expect(funding().textContent).toContain('服务器 BYOK');
    const store = getDesktopAiConfigStore();
    await act(async () => store.setPresetKeyDraft('deepseek', 'synthetic-unsaved-key'));
    expect(requiredButton('开始多人生成', room()).disabled).toBe(true);
    expect(funding().textContent).toContain('尚未保存');
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'set_provider_secret')).toBe(false);
    await act(async () => store.setPresetKeyDraft('deepseek', ''));
    expect(requiredButton('开始多人生成', room()).disabled).toBe(false);
    await click('开始多人生成', room()); expect(room().querySelector('[aria-label="确认多人生成配置"]')).not.toBeNull();
    await selectProvider('服务器系统默认'); expect(room().querySelector('[aria-label="确认多人生成配置"]')).toBeNull();
    await selectProvider('DeepSeek');
    await act(async () => funding().querySelectorAll<HTMLButtonElement>('[role="combobox"]')[1]!.click());
    await click('自定义模型 ID', funding());
    await change('[aria-label="本次房间服务器生成选择"] [aria-label="自定义模型 ID"]', 'my-room-model');
    expect(funding().querySelectorAll('[role="combobox"]')[1]!.textContent).toContain('my-room-model');
    await act(async () => buttons(funding()).find(node => node.textContent?.includes('高级生成设置'))!.click());
    await change('[aria-label="本次房间服务器生成选择"] input[inputmode="numeric"]', '128');
    await change('[aria-label="本次房间服务器生成选择"] input[inputmode="decimal"]', '0.5');
    await change('[aria-label="本次房间服务器生成选择"] input[inputmode="numeric"]', '');
    await click('开始多人生成', room()); const start = await startAction('确认按当前配置开始', 'generation-start');
    if (start.action.kind !== 'generation-start' || !start.action.presetConfig) throw new Error('Expected BYOK start');
    expect(start.action.presetConfig).toMatchObject({ providerId: 'deepseek', modelId: 'my-room-model', generationOverrides: { temperature: 0.5 } });
    expect(start.action.request.generation).not.toHaveProperty('customProvider');
    expect(JSON.stringify(start.action)).not.toMatch(/synthetic-unsaved-key|secretRef|apiKey|baseUrl/);
    const pending = { operation: 'generationStart', intentId: start.requestId, roomId: session.roomId,
      generationStart: { roomEpoch: session.roomEpoch, generationRequestId: start.action.request.generationRequestId, retryable: true, presetConfig: start.action.presetConfig } };
    await port.deliver({ kind: 'mutation-unknown', ...pending });
    await port.deliver({ kind: 'request-error', operation: 'generationStart', requestId: start.requestId, error: ipcFixture.error });
    await act(async () => store.setPresetKeyDraft('deepseek', 'synthetic-new-draft-not-used'));
    expect(room().textContent).toContain('原请求使用：服务器 BYOK');
    expect(funding()).toBeNull();
    await click('以原请求重试', room()); const retry = await startAction('确认以原请求重试', 'retry-generation-start');
    expect(retry.action).toEqual({ kind: 'retry-generation-start', intentId: start.requestId });
    expect(store.getPresetKeyDraft('deepseek')).toBe('synthetic-new-draft-not-used');
    expect(ordinarySnapshot()).toEqual(before);
    expect(mocks.invoke.mock.calls.some(([command]) => command === 'set_provider_secret')).toBe(false);
    assertNoExecution();
  });

  it('keeps the ordinary manual model input mounted through Room BYOK mode and exit', async () => {
    seedOrdinary(); await mount();
    const ordinaryCombos = [...container.querySelectorAll<HTMLButtonElement>('[role="combobox"]')];
    expect(ordinaryCombos.length).toBeGreaterThanOrEqual(2);
    await act(async () => ordinaryCombos[1]!.click()); await click('自定义模型 ID');
    await change('[aria-label="自定义模型 ID"]', 'ordinary-temporary-model');
    const input = container.querySelector<HTMLInputElement>('[aria-label="自定义模型 ID"]')!;
    const before = ordinarySnapshot(); await open(); const creating = await startAction('创建多人房间', 'create');
    const session = sessionFor('host'); await confirmMembership(creating, 'host', session); await publishOnline(session);
    expect(container.querySelector('[aria-label="自定义模型 ID"]')).toBe(input);
    expect(input.closest('[hidden]')).not.toBeNull(); expect(input.value).toBe('ordinary-temporary-model');
    vi.mocked(window.confirm).mockReturnValueOnce(true); await click('断开本机房间连接', room());
    expect(container.querySelector('[aria-label="自定义模型 ID"]')).toBe(input); expect(input.closest('[hidden]')).toBeNull();
    expect(input.value).toBe('ordinary-temporary-model'); expect(ordinarySnapshot()).toEqual(before); assertNoExecution();
  });
  it('shows complete frozen host sources, confirms start, then abandons only local tracking and returns to a usable lobby', async () => {
    seedOrdinary(); await mount(); const before = ordinarySnapshot(); await open();
    const creating = await startAction('创建多人房间', 'create');
    if (creating.action.kind !== 'create') throw new Error('Expected create');
    const session = reviewSession(); session.snapshot.sharedConfig = creating.action.request.sharedConfig; session.snapshot.activeGeneration = null;
    await confirmMembership(creating, 'host', session); await publishOnline(session);
    const full = room().querySelector<HTMLSelectElement>('[aria-label="选择完整本机来源"]')!;
    expect(full).not.toBeNull();
    await act(async () => { full.value = 'combatants'; full.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(room().textContent).toContain('甲完整本机设定'); expect(ordinarySnapshot()).toEqual(before);
    await click('开始多人生成', room()); expect(room().textContent).toContain('待处理提案');
    await click('返回检查', room()); expect(port.actions.map(item => item.action.kind)).toEqual(['create']);
    await click('开始多人生成', room()); const start = await startAction('确认按当前配置开始', 'generation-start');
    expect(start.action).toMatchObject({ request: { generation: { arenaFreeRankingEnabled: false }, hostLocalPayloads: [{ kind: 'character' }, { kind: 'character' }] } });
    expect(JSON.stringify(start.action)).toContain('甲完整本机设定'); expect(JSON.stringify(start.action)).not.toContain(profile.baseUrl);
    if (start.action.kind !== 'generation-start') throw new Error('Expected start');
    await port.deliver({ kind: 'mutation-unknown', operation: 'generationStart', intentId: start.requestId, roomId: session.roomId,
      generationStart: { roomEpoch: session.roomEpoch, generationRequestId: start.action.request.generationRequestId, retryable: true } });
    await port.deliver({ kind: 'request-error', operation: 'generationStart', requestId: start.requestId, error: ipcFixture.error });
    expect(room().textContent).toContain('原生成请求结果未知');
    await click('以原请求重试', room()); expect(room().textContent).toContain('可能补执行'); await click('返回检查', room());
    await click('停止本机跟踪并返回大厅', room()); expect(room().textContent).toContain('不能再以原 ID 重试');
    await click('确认停止本机跟踪', room());
    expect(room().textContent).toContain('大厅已就绪'); expect(room().textContent).toContain('未确认生成记录');
    expect(requiredButton('创建多人房间', room()).disabled).toBe(false); await change('#arena-room-join-code', 'another-room'); expect(requiredButton('加入房间', room()).disabled).toBe(false);
    const checking = await startAction('只读核对保留记录的原房间', 'session');
    await confirmMembership(checking, 'host', session); await publishOnline(session);
    expect(requiredButton('开始多人生成', room()).disabled).toBe(true); expect(requiredButton('关闭房间', room()).disabled).toBe(false);
    expect(ordinarySnapshot()).toEqual(before); expect(port.actions.map(item => item.action.kind)).toEqual(['create', 'generation-start', 'session']);
    // Only the one explicitly confirmed Room start crossed Native; no ordinary/provider generation.
    expect(mocks.invoke.mock.calls.filter(([command]) => /^(direct_|hosted_|generation_)/.test(String(command)))).toEqual([]);
  });
  it('hands a confirmed starting placeholder to one stop request, then exits unknown to lobby and preserves the original fence', async () => {
    seedOrdinary(); await mount(); const before = ordinarySnapshot(); await open();
    const creating = await startAction('创建多人房间', 'create');
    if (creating.action.kind !== 'create') throw new Error('Expected create');
    const session = reviewSession(); session.snapshot.sharedConfig = creating.action.request.sharedConfig; session.snapshot.proposals = []; session.snapshot.activeGeneration = null;
    await confirmMembership(creating, 'host', session); await publishOnline(session);
    await click('开始多人生成', room()); const start = await startAction('确认按当前配置开始', 'generation-start');
    if (start.action.kind !== 'generation-start') throw new Error('Expected start');
    const pending = { operation: 'generationStart', intentId: start.requestId, roomId: session.roomId,
      generationStart: { roomEpoch: session.roomEpoch, generationRequestId: start.action.request.generationRequestId, retryable: true } };
    await port.deliver({ kind: 'mutation-unknown', ...pending });
    await port.deliver({ kind: 'request-error', operation: 'generationStart', requestId: start.requestId, error: ipcFixture.error });
    const { finishedAt: _finished, ...generation } = generationFixture.operation.success.result.generation;
    const active = { ...session, snapshot: { ...session.snapshot, controlSeq: session.snapshot.controlSeq + 1,
      activeGeneration: { ...generation, state: 'starting' as const, generationRequestId: start.action.request.generationRequestId } } };
    const nextRead = port.nextAction('generation-read'); await port.deliver(snapshotEvent(active)); const read = await nextRead;
    await port.deliver({ kind: 'request-error', operation: 'generationRead', requestId: read.requestId, error: { ...ipcFixture.error, outcome: 'not-applicable' } });
    await click('放弃原重试并尝试停止', room());
    expect(room().textContent).toContain('旧服务拒绝'); expect(room().textContent).toContain('原材料');
    await click('取消', room()); expect(port.actions.filter(item => item.action.kind === 'cancel-generation-start')).toHaveLength(0);
    await click('放弃原重试并尝试停止', room()); const cancel = await startAction('销毁原重试许可并尝试停止', 'cancel-generation-start');
    expect(cancel.action).toEqual({ kind: 'cancel-generation-start', intentId: start.requestId });
    const linked = { operation: 'generationCancel', intentId: cancel.requestId, roomId: session.roomId,
      generationTarget: { roomEpoch: session.roomEpoch, generationId: generation.generationId, attempt: generation.attempt }, cancelMode: 'starting-v1', startIntentId: start.requestId };
    port.generationStartFence = { roomId: session.roomId, generationRequestId: start.action.request.generationRequestId,
      cancelMode: 'starting-v1', startIntentId: start.requestId, cancelIntentId: cancel.requestId };
    await port.deliver({ kind: 'mutation-unknown', ...linked });
    const recovery = port.nextAction('generation-read');
    await port.deliver({ kind: 'request-error', operation: 'generationCancel', requestId: cancel.requestId,
      error: { ...ipcFixture.error, outcome: 'unknown', serverCode: 'ROOM_DESKTOP_PROTOCOL_INVALID' } });
    const checking = await recovery;
    await port.deliver({ kind: 'request-error', operation: 'generationRead', requestId: checking.requestId, error: { ...ipcFixture.error, outcome: 'not-applicable' } });
    expect(button('以原请求重试', room())).toBeUndefined(); expect(room().textContent).toContain('不会恢复原材料');
    await click('停止本机跟踪并返回大厅', room()); expect(room().textContent).toContain('不会取消服务器任务'); await click('确认停止本机跟踪', room());
    expect(room().textContent).toContain('大厅已就绪'); expect(requiredButton('创建多人房间', room()).disabled).toBe(false);
    await change('#arena-room-join-code', 'another-room'); expect(requiredButton('加入房间', room()).disabled).toBe(false);
    const original = await startAction('只读核对保留记录的原房间', 'session'); await confirmMembership(original, 'host', active);
    const finalRead = port.nextAction('generation-read'); await publishOnline(active); const reading = await finalRead;
    await port.deliver({ kind: 'request-error', operation: 'generationRead', requestId: reading.requestId, error: { ...ipcFixture.error, outcome: 'not-applicable' } });
    expect(requiredButton('开始多人生成', room()).disabled).toBe(true); expect(requiredButton('关闭房间', room()).disabled).toBe(false);
    expect(requiredButton('停止当前生成', room()).disabled).toBe(true);
    expect(port.actions.filter(item => item.action.kind === 'cancel-generation-start')).toHaveLength(1);
    expect(port.actions.some(item => item.action.kind === 'generation-cancel' || item.action.kind === 'retry-generation-start')).toBe(false);
    expect(ordinarySnapshot()).toEqual(before); assertNoExecution();
  });
  it.each(['/arena', '/battle'] as const)('%s exposes only its intended Room entry and never attaches on mount', async path => {
    await mount(path);
    expect(Boolean(button('打开多人大厅'))).toBe(path === '/arena');
    expect(port.order).toEqual([]); assertNoExecution();
  });

  it.each(['image', 'markdown'] as const)('shows %s export errors in the actual constrained room rather than the hidden ordinary editor', async kind => {
    seedOrdinary(); await mount(); const before = ordinarySnapshot(); await open();
    await change('#arena-room-join-code', serviceFixture.operations.join.success.result.roomId);
    const joining = await startAction('加入房间', 'join');
    const session = await confirmMembership(joining, 'member'); await publishOnline(session);
    const completed = structuredClone(generationFixture.operation.success.result) as ArenaRoomGenerationViewResponse;
    completed.roomId = session.roomId; completed.roomEpoch = session.roomEpoch;
    completed.generation.configRevision = session.snapshot.revision;
    completed.markdown = '# 可导出的房间战报\n失败后保留完整正文';
    const nextRead = port.nextAction('generation-read');
    await port.deliver(snapshotEvent({ ...session, snapshot: { ...session.snapshot,
      controlSeq: session.snapshot.controlSeq + 1, activeGeneration: completed.generation } }));
    await deliverGeneration(await nextRead, completed);
    assertConstrained();
    const failure = new Error('房间下载端口暂时不可用');
    if (kind === 'image') mocks.capture.mockRejectedValueOnce(failure);
    else mocks.download.mockImplementationOnce(() => { throw failure; });
    const label = kind === 'image' ? '📱 保存为图片' : '📄 下载记录';
    await click(label, room());
    const alert = room().querySelector('.error-message[role="alert"]');
    expect(alert?.textContent).toContain(kind === 'image' ? '生成图片失败' : failure.message);
    expect(alert?.closest('[hidden]')).toBeNull();
    expect(room().querySelector('.result-card')?.textContent).toContain('失败后保留完整正文');
    expect([...container.querySelectorAll('.error-message[role="alert"]')].filter(node => node.closest('[hidden]'))).toEqual([]);
    await click(label, room());
    expect(room().querySelector('.error-message[role="alert"]')).toBeNull();
    expect(ordinarySnapshot()).toEqual(before);
    expect(port.actions.map(operation => operation.action.kind)).toEqual(['join', 'generation-read']);
    assertNoExecution();
  });

  it.each([true, false])('reads checked room report fragments and requires current final ACK (%s) before authoritative display', async finalCurrent => {
    seedOrdinary(); await mount(); const before = ordinarySnapshot(); await open();
    await change('#arena-room-join-code', serviceFixture.operations.join.success.result.roomId);
    const joining = await startAction('加入房间', 'join');
    const session = await confirmMembership(joining, 'member'); await publishOnline(session);
    const completed = structuredClone(generationFixture.operation.success.result) as ArenaRoomGenerationViewResponse;
    completed.roomId = session.roomId; completed.roomEpoch = session.roomEpoch;
    completed.generation.configRevision = session.snapshot.revision;
    completed.markdown = '# 核验后的最终战报\n完整最终正文';
    const running = { ...completed.generation, state: 'running' as const }; delete running.finishedAt;
    const nextRead = port.nextAction('generation-read');
    const active = { ...session, snapshot: { ...session.snapshot, controlSeq: session.snapshot.controlSeq + 1, activeGeneration: running } };
    await port.deliver(snapshotEvent(active));
    const reading = await nextRead;
    expect(reading.action).toEqual({ kind: 'generation-read', generationId: running.generationId, expectedRoomEpoch: session.roomEpoch, expectedAttempt: running.attempt });
    const preview: ArenaRoomGenerationViewResponse = { protocolVersion: 1, roomId: session.roomId, roomEpoch: session.roomEpoch,
      generation: running, status: 'running', markdown: '# 房间预览\n当前正文', nextChunkSeq: 1, finalAuthoritative: false };
    const previewDelivery = await deliverGeneration(reading, preview, true);
    expect(room().textContent).not.toContain('当前正文');
    await act(async () => { previewDelivery.ackGate.resolve(); await vi.waitFor(() => expect(room().textContent).toContain('当前正文')); });
    expect(room().querySelector('[data-arena-room-generation-report="v1"] .result-card')).not.toBeNull();
    expect(room().textContent).toContain('当前显示实时预览');
    expect(room().textContent).not.toContain('战报已完成');
    await port.deliver({ kind: 'socket', message: { protocolVersion: 1, type: 'story.delta', roomId: session.roomId, roomEpoch: session.roomEpoch,
      generationId: running.generationId, chunkSeq: 1, timestamp: '2026-10-15T12:01:00Z', payload: { delta: '\n新实时片段' } } });
    expect(room().textContent).toContain('新实时片段');
    const finalRead = port.nextAction('generation-read');
    await port.deliver({ kind: 'socket', message: { protocolVersion: 1, type: 'generation.completed', roomId: session.roomId, roomEpoch: session.roomEpoch,
      controlSeq: active.snapshot.controlSeq + 1, timestamp: '2026-10-15T12:02:00Z', payload: {
        generationRequestId: running.generationRequestId, generationId: running.generationId, attempt: running.attempt,
        configRevision: running.configRevision, snapshotDigest: running.snapshotDigest, collaborativeInfluence: running.collaborativeInfluence,
        participantUserIds: running.participantUserIds, generationRecordId: completed.generationRecordId,
      } } });
    expect(room().textContent).not.toContain('战报已完成');
    const finalDelivery = await deliverGeneration(await finalRead, completed, true);
    expect(room().textContent).not.toContain('完整最终正文');
    port.generationReadCurrent = finalCurrent;
    await act(async () => { finalDelivery.ackGate.resolve(); await vi.waitFor(() => expect(mocks.owner!.getSnapshot().generationReading).toBe(false)); });
    if (finalCurrent) {
      expect(room().textContent).toContain('战报已完成');
      expect(room().textContent).toContain('完整最终正文');
      expect(room().textContent).toContain('最终内容已从生成记录恢复并核验');
      expect(room().textContent).not.toContain('新实时片段');
    } else {
      expect(room().textContent).not.toContain('战报已完成');
      expect(room().textContent).not.toContain('完整最终正文');
      expect(room().textContent).toContain('新实时片段');
      expect(mocks.owner!.getSnapshot().generation.finalAuthoritative).toBe(false);
      expect(mocks.owner!.getSnapshot().phase).toBe('online');
      expect(button('重新同步战报', room())).toBeTruthy();
      expect(port.actions.map(operation => operation.action.kind)).toEqual(['join', 'generation-read', 'generation-read']);
      const retrying = await startAction('重新同步战报', 'generation-read');
      port.generationReadCurrent = true;
      await deliverGeneration(retrying, completed);
      await act(async () => { await vi.waitFor(() => expect(room().textContent).toContain('战报已完成')); });
      expect(room().textContent).toContain('完整最终正文');
    }
    expect(port.actions.map(operation => operation.action.kind)).toEqual(finalCurrent
      ? ['join', 'generation-read', 'generation-read']
      : ['join', 'generation-read', 'generation-read', 'generation-read']);
    expect(ordinarySnapshot()).toEqual(before); assertNoExecution();
    for (const label of ['开始协作生成', '停止生成', '重做角色更新', '应用手动修改', '保存到云端']) expect(button(label, room())).toBeUndefined();
  });

  it('explains invalid and ambiguous pasted invitations without dispatching any Native action', async () => {
    seedOrdinary(); await mount(); await open();
    const before = ordinarySnapshot(), location = window.location.href;
    for (const [input, error] of [
      ['邀请里没有可用房间码', '未识别到有效房间码'],
      ['https://untrusted.invalid/invite', '未识别到有效房间码'],
      ['5f0c9a2e-3b1d-4c8a-9e2f-7a6b5c4d3e2f 0f0c9a2e-3b1d-4c8a-9e2f-7a6b5c4d3e20', '检测到多个房间码'],
    ]) {
      await change('#arena-room-join-code', input);
      expect(room().querySelector('[role="alert"]')).toBeNull();
      expect(room().textContent).not.toContain('将加入：');
      await click('加入房间', room());
      expect(room().querySelector('[role="alert"]')?.textContent).toContain(error);
    }
    expect(port.actions).toEqual([]);
    expect(port.order).toEqual(['attach']);
    expect(ordinarySnapshot()).toEqual(before); expect(window.location.href).toBe(location);
    await change('#arena-room-join-code', 'room-valid');
    expect(room().querySelector('[role="alert"]')).toBeNull();
    expect(room().textContent).toContain('将加入：room-valid');
    assertNoExecution();
  });

  it.each([
    ['魔法少女竞技场邀请你加入多人房间！\n房间：邀请测试\n房间码：5f0c9a2e-3b1d-4c8a-9e2f-7a6b5c4d3e2f\n\n打开 https://untrusted.invalid/arena ，在「多人房间」中粘贴邀请', '5f0c9a2e-3b1d-4c8a-9e2f-7a6b5c4d3e2f'],
    ['欢迎加入 https://untrusted.invalid/?room=5F0C9A2E-3B1D-4C8A-9E2F-7A6B5C4D3E2F 再次确认 5f0c9a2e-3b1d-4c8a-9e2f-7a6b5c4d3e2f', '5f0c9a2e-3b1d-4c8a-9e2f-7a6b5c4d3e2f'],
    ['Room ID: room-invite-1（欢迎） https://untrusted.invalid', 'room-invite-1'],
  ])('previews the canonical invite target and sends it only once after an explicit join: %s', async (input, roomId) => {
    const clipboard = { readText: vi.fn() };
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    try {
      seedOrdinary(); await mount(); await open();
      const before = ordinarySnapshot(), location = window.location.href;
      const openWindow = vi.spyOn(window, 'open').mockReturnValue(null);
      await change('#arena-room-join-code', input);
      expect(room().textContent).toContain(`将加入：${roomId}`);
      expect(port.actions).toEqual([]);
      const joining = requiredButton('加入房间', room());
      await act(async () => { joining.click(); joining.click(); });
      expect(port.actions.map(item => item.action)).toEqual([{ kind: 'join', roomId, request: { displayName: '普通账号' } }]);
      expect(joining.matches(':disabled')).toBe(true);
      expect(JSON.stringify(mocks.invoke.mock.calls)).not.toContain('untrusted.invalid');
      expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toContain('untrusted.invalid');
      expect(openWindow).not.toHaveBeenCalled(); expect(clipboard.readText).not.toHaveBeenCalled();
      expect(window.location.href).toBe(location); expect(ordinarySnapshot()).toEqual(before); assertNoExecution();
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  const enterInviteSession = async (role: 'host' | 'member' = 'host') => {
    await mount(); await open();
    const target = sessionFor(role);
    target.snapshot.members.find(member => member.role === 'host')!.displayName = 'room id: other-room';
    await change('#arena-room-title', '房间码：title-room');
    await change('#arena-room-join-code', target.roomId);
    const joining = await startAction('加入房间', 'join');
    await confirmMembership(joining, role, target); await publishOnline(target);
    return target;
  };
  const clipboardForInvite = (writeText: (text: string) => Promise<void>) => {
    const clipboard = { writeText: vi.fn(writeText), readText: vi.fn() };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    return clipboard;
  };

  it.each(['host', 'member'] as const)('%s explicitly shares canonical product invite with active members, no navigation or clipboard read', async role => {
    const clipboard = clipboardForInvite(async () => {}), openWindow = vi.spyOn(window, 'open');
    const session = await enterInviteSession(role);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    const actionsBefore = port.actions.length, beforeLocation = window.location.href;
    await click('分享房间', room());
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    const text = clipboard.writeText.mock.calls[0]![0];
    expect(text).toContain(`${DESKTOP_PRODUCT_ORIGIN}/arena`);
    expect(text).not.toContain('api.mahoshojo'); expect(text).not.toContain('tauri://');
    expect(text).toContain(`当前成员：2/${MAX_ROOM_MEMBERS} 人`); expect(text).not.toContain('当前在线');
    expect(parseArenaRoomJoinCode(text)).toEqual({ ok: true, roomId: session.roomId });
    expect(requiredButton('已复制邀请', room()).getAttribute('aria-label')).toBe('复制房间邀请文案');
    expect(clipboard.readText).not.toHaveBeenCalled(); expect(openWindow).not.toHaveBeenCalled();
    expect(window.location.href).toBe(beforeLocation); expect(port.actions).toHaveLength(actionsBefore);
    expect(vi.mocked(fetch).mock.calls.every(([input]) => !String(input).startsWith(DESKTOP_PRODUCT_ORIGIN))).toBe(true);
    assertNoExecution();
  });

  it('reports failed copy and lets the user retry without automatic clipboard reads or writes', async () => {
    const clipboard = clipboardForInvite(async () => { throw new Error('clipboard denied'); });
    await enterInviteSession(); await click('分享房间', room());
    expect(button('复制失败，请重试', room())).toBeTruthy(); expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(document.execCommand).toHaveBeenCalledExactlyOnceWith('copy');
    clipboard.writeText.mockResolvedValueOnce(); await click('复制失败，请重试', room());
    expect(button('已复制邀请', room())).toBeTruthy(); expect(clipboard.writeText).toHaveBeenCalledTimes(2);
    expect(clipboard.readText).not.toHaveBeenCalled(); assertNoExecution();
  });

  it.each(['account-success', 'account-failure', 'document-success', 'document-failure', 'room-success', 'room-failure'] as const)('does not apply late clipboard feedback after %s retirement and reattachment', async scenario => {
    const pending = deferred<void>();
    const clipboard = clipboardForInvite(() => pending.promise.then(() => { if (scenario.endsWith('failure')) throw new Error('clipboard denied'); }));
    const original = await enterInviteSession(); await click('分享房间', room());
    expect(button('复制中…', room())).toBeTruthy();
    if (scenario.startsWith('account')) {
      await act(async () => { await getDesktopCloudSessionStore().signOut(); });
      account = { userId: serviceFixture.expectedUserId, username: '普通账号' };
      await act(async () => { await getDesktopCloudSessionStore().refresh(); });
    } else if (scenario.startsWith('document')) {
      Object.defineProperty(window, '__MAHOSHOJO_ROOM_DOCUMENT_V1__', { configurable: true, writable: true, value: 'b'.repeat(64) });
      // Existing owner revalidates its immutable Document nonce on the next account notification.
      await act(async () => { await getDesktopCloudSessionStore().refresh(); });
    } else {
      vi.mocked(window.confirm).mockReturnValueOnce(true); await click('断开本机房间连接', room());
    }
    await click('打开多人大厅', room()); await change('#arena-room-join-code', original.roomId);
    const joining = await startAction('加入房间', 'join'); await confirmMembership(joining, 'host', original); await publishOnline(original);
    expect(button('分享房间', room())).toBeTruthy();
    await act(async () => pending.resolve());
    expect(button('分享房间', room())).toBeTruthy();
    expect(button('已复制邀请', room())).toBeUndefined(); expect(button('复制失败，请重试', room())).toBeUndefined();
    expect(clipboard.writeText).toHaveBeenCalledTimes(1); expect(clipboard.readText).not.toHaveBeenCalled();
    expect(document.execCommand).not.toHaveBeenCalled(); assertNoExecution();
  });

  const leaveAndRejoinSameOwner = async (session: ArenaRoomSessionResponse) => {
    const owner = mocks.owner!;
    const identity = owner.confirmationOwner();
    const renderedBefore = mocks.roomRenders.length;
    const retirement = createRoomInviteScope({ readScope: () => {
      const current = owner.getSnapshot().session;
      return current ? JSON.stringify([current.roomId, current.roomEpoch, current.self.userId]) : null;
    }, subscribe: owner.subscribe });
    const oldScope = retirement.getSnapshot();
    // No consumer reads the scope again until the full Native leave/rejoin completes.
    const stopRetirement = retirement.subscribe(() => {});
    const observed: (string | null)[] = [];
    const unsubscribe = owner.subscribe(() => observed.push(owner.getSnapshot().session?.roomId ?? null));
    const deliverInBatch = async (event: unknown) => {
      const delivery = port.queue(event); port.notify(delivery); await delivery.ackStarted.promise;
      // Native ACK completion releases the real owner flight before the next explicit intent.
      await delivery.ackGate.promise;
      if (owner.getSnapshot().busy) await new Promise<void>(resolve => {
        const stop = owner.subscribe(() => { if (!owner.getSnapshot().busy) { stop(); resolve(); } });
      });
    };
    await act(async () => {
      const leaving = port.nextAction('leave'); await owner.leave();
      await deliverInBatch(responseEvent(await leaving, serviceFixture.operations.leave.success.result));
      expect(owner.getSnapshot().session).toBeNull();
      const joining = port.nextAction('join'); await owner.join(session.roomId, '普通账号');
      const subscription = port.nextSubscription();
      await deliverInBatch(responseEvent(await joining, session)); await subscription;
    });
    unsubscribe(); stopRetirement();
    expect(mocks.owner).toBe(owner); expect(owner.confirmationOwner()).toBe(identity);
    expect(observed).toContain(null); expect(observed.at(-1)).toBe(session.roomId);
    expect(retirement.getSnapshot()).not.toBe(oldScope);
    // Real Native ACK awaits currently render null even inside one async act. This is
    // same-owner lifecycle coverage, not proof of an unrendered production ABA batch.
    expect(mocks.roomRenders.slice(renderedBefore)).toContain(null);
  };

  it.each([true, false])('same owner leave/rejoin retires late copy success=%s', async success => {
    const pending = deferred<void>();
    clipboardForInvite(() => pending.promise.then(() => { if (!success) throw new Error('old clipboard rejected'); }));
    const original = await enterInviteSession('member'); await click('分享房间', room());
    await leaveAndRejoinSameOwner(original);
    await act(async () => pending.resolve());
    expect(button('分享房间', room())).toBeTruthy();
    expect(button('已复制邀请', room())).toBeUndefined(); expect(button('复制失败，请重试', room())).toBeUndefined();
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('same owner leave/rejoin timer cannot clear new copy feedback', async () => {
    clipboardForInvite(async () => {});
    const original = await enterInviteSession('member'); vi.useFakeTimers(); await click('分享房间', room());
    await act(async () => vi.advanceTimersByTime(1_000));
    await leaveAndRejoinSameOwner(original); expect(button('分享房间', room())).toBeTruthy();
    await click('分享房间', room());
    await act(async () => vi.advanceTimersByTime(1_000)); expect(button('已复制邀请', room())).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(1_000)); expect(button('分享房间', room())).toBeTruthy();
  });

  it('does not let a retired room copy timer clear the new owner feedback', async () => {
    clipboardForInvite(async () => {});
    const original = await enterInviteSession(); vi.useFakeTimers(); await click('分享房间', room());
    await act(async () => vi.advanceTimersByTime(1_000));
    vi.mocked(window.confirm).mockReturnValueOnce(true); await click('断开本机房间连接', room());
    await click('打开多人大厅', room()); await change('#arena-room-join-code', original.roomId);
    const joining = await startAction('加入房间', 'join'); await confirmMembership(joining, 'host', original); await publishOnline(original);
    await click('分享房间', room());
    await act(async () => vi.advanceTimersByTime(1_000)); expect(button('已复制邀请', room())).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(1_000)); expect(button('分享房间', room())).toBeTruthy();
  });

  it.each(['account', 'document'] as const)('keeps a parsed invite behind the %s fence before join', async retirement => {
    await mount(); await open();
    await change('#arena-room-join-code', '房间码：room-retired（欢迎）');
    expect(room().textContent).toContain('将加入：room-retired');
    const join = requiredButton('加入房间', room());
    if (retirement === 'account') {
      await act(async () => { await getDesktopCloudSessionStore().signOut(); });
    } else {
      Object.defineProperty(window, '__MAHOSHOJO_ROOM_DOCUMENT_V1__', { configurable: true, writable: true, value: 'b'.repeat(64) });
    }
    await act(async () => join.click());
    expect(port.actions).toEqual([]); expect(port.subscriptions).toEqual([]); assertNoExecution();
  });

  it('keeps the ordinary preference, model, independent drafts and result through lobby cancellation', async () => {
    seedOrdinary(); await mount();
    expect(container.querySelector('[aria-label="战报结果"]')?.textContent).toContain(reportText);
    const before = ordinarySnapshot(); await open();
    expect(button('生成战报')).toBeTruthy(); expect(ordinarySnapshot()).toEqual(before);
    await click('断开本机房间连接', room());
    expect(window.confirm).not.toHaveBeenCalled();
    expect(port.order).toEqual(['attach', 'detach']);
    expect(port.actions).toEqual([]); expect(ordinarySnapshot()).toEqual(before);
    expect(container.querySelector('[aria-label="战报结果"]')?.textContent).toContain(reportText);
    expect(getDesktopAiConfigStore().getSnapshot().modelsByProfileId[profile.id]?.selectedModelId).toBe('ordinary-selected-model');
    assertNoExecution();
  });

  it('lets an online host add preset characters and main/auxiliary scenarios, then publish explicitly', async () => {
    seedOrdinary(savedDraft({ battleMode: 'scenario' })); await mount(); await open();
    const creating = await startAction('创建多人房间', 'create');
    const authority = await confirmMembership(creating, 'host'); await publishOnline(authority);
    const draft = () => JSON.parse(ordinarySnapshot().advanced!).draft as ArenaDraft;
    const beforeCount = draft().combatants.length;
    const preset = container.querySelector<HTMLButtonElement>('button[aria-label^="选择预设角色："]')!;
    expect(preset).toBeTruthy(); expect(preset.matches(':disabled')).toBe(false);
    await act(async () => preset.click());
    await vi.waitFor(() => expect(draft().combatants).toHaveLength(beforeCount + 1));
    await act(async () => buttons().find(node => node.textContent?.includes('预设情景（内置）'))!.click());
    const scenarioPreset = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(node => node.getAttribute('aria-label')!.startsWith('选择预设情景：'))!;
    expect(scenarioPreset).toBeTruthy(); expect(scenarioPreset.matches(':disabled')).toBe(false);
    await act(async () => scenarioPreset.click());
    await vi.waitFor(() => expect(draft().scenario.content).not.toBeNull());
    const auxiliaryPreset = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(node => node.getAttribute('aria-label')!.startsWith('选择预设情景：'))!;
    await act(async () => auxiliaryPreset.click());
    await vi.waitFor(() => expect(draft().auxScenarios).toHaveLength(1));
    expect(port.actions.map(value => value.action.kind)).toEqual(['create']);
    await click('比较本地与房间设置', room());
    await vi.waitFor(() => expect(button('发布已比较的设置', room())).toBeDefined());
    await click('发布已比较的设置', room()); const publishing = await startAction('确认发布房间配置', 'config');
    expect(publishing.action).toMatchObject({ kind: 'config', request: { sharedConfig: { combatants: expect.any(Array), scenario: expect.any(Object), auxScenarios: expect.any(Array) } } });
    expect(preset.matches(':disabled')).toBe(true); assertNoExecution();
  });

  it('allows an online host to select a main scenario from the real shared library', async () => {
    seedOrdinary(savedDraft({ battleMode: 'scenario' })); await mount(); await open();
    const creating = await startAction('创建多人房间', 'create');
    const authority = await confirmMembership(creating, 'host'); await publishOnline(authority);
    const original = mocks.invoke.getMockImplementation()!;
    const card = { ...publicCard, type: 'scenario', name: '房主在线情景', updated_at: '2026-10-31T01:00:00Z',
      data: JSON.stringify({ templateId: '通用情景', title: '房主在线情景', content: '完整舞台' }) };
    mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
      const request = args.request as { routeId?: string; query?: Record<string, string> } | undefined;
      if (command === 'cloud_card_library_request' && request?.routeId === 'public-data-cards.query')
        return { status: 200, body: request.query?.id ? { success: true, card } : { success: true, cards: [card], total: 1 } };
      return original(command, args);
    });
    await click('浏览在线情景库');
    const library = document.querySelector<HTMLElement>('[role="dialog"][aria-label="选择情景数据卡"]')!;
    expect(library).not.toBeNull();
    await act(async () => buttons(library).find(item => item.textContent?.startsWith('公开'))!.click());
    const row = [...library.querySelectorAll<HTMLElement>('.grid > .relative')].find(item => item.querySelector('h4')?.textContent === card.name)!;
    expect(row).toBeTruthy();
    const select = row.matches('[role="button"][aria-label^="选择"]') ? row : null;
    expect(select).not.toBeNull(); await act(async () => select!.click());
    await vi.waitFor(() => expect(JSON.parse(ordinarySnapshot().advanced!).draft.scenario.content?.title).toBe(card.name));
    expect(port.actions.map(value => value.action.kind)).toEqual(['create']); assertNoExecution();
  });

  it('drops a pending host preset import if room freshness is lost before the source returns', async () => {
    seedOrdinary(); await mount(); await open();
    const creating = await startAction('创建多人房间', 'create');
    const authority = await confirmMembership(creating, 'host'); await publishOnline(authority);
    const before = ordinarySnapshot().advanced, pending = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const preset = container.querySelector<HTMLButtonElement>('button[aria-label^="选择预设角色："]')!;
    await act(async () => preset.click());
    await port.deliver({ kind: 'status', state: 'offline' });
    await act(async () => pending.resolve(new Response(JSON.stringify({ templateId: '通用角色', name: '迟到角色', content: '不能导入' }))));
    expect(ordinarySnapshot().advanced).toBe(before);
    expect(preset.matches(':disabled')).toBe(true);
    expect(port.actions.map(value => value.action.kind)).toEqual(['create']); assertNoExecution();
  });

  it('edits only four local host story fields while preserving authority and requiring a fresh explicit publish', async () => {
    const seed = savedDraft(); seedOrdinary({ ...seed, scenario: { ...seed.scenario, isPreset: false } }); await mount(); const before = ordinarySnapshot(); await open();
    const create = await startAction('创建多人房间', 'create'); const authority = await confirmMembership(create, 'host');
    const editor = container.querySelector<HTMLElement>('[aria-label="房主本地故事设置"]')!;
    expect(editor).not.toBeNull(); expect(editor.querySelector('input[name="arena_story_guidance"]')!.matches(':disabled')).toBe(true);
    await publishOnline(authority); assertConstrained();
    expect(editor.querySelector('input[name="arena_story_guidance"]')!.matches(':disabled')).toBe(false);
    expect(container.querySelectorAll('#arena-story-guidance')).toHaveLength(1);
    expect(container.querySelectorAll('#room-host-draft-arena-story-guidance')).toHaveLength(1);
    expect(editor.querySelector<HTMLLabelElement>('label[for="room-host-draft-arena-story-guidance"]')!.control).toBe(editor.querySelector('#room-host-draft-arena-story-guidance'));
    await click('比较本地与房间设置', room());
    await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); expect(button('发布已比较的设置', room())).toBeDefined(); });
    await click('发布已比较的设置', room()); expect(room().querySelector('[aria-label="确认发布房间配置"]')).not.toBeNull();
    await change('#room-host-draft-arena-story-guidance', '房主本地新引导');
    expect(room().querySelector('[aria-label="确认发布房间配置"]')).toBeNull();
    await click('自定义', editor); await change('#room-host-draft-custom-story-length', '1234'); await click('长篇(2000+)', editor);
    const language = editor.querySelector<HTMLSelectElement>('#room-host-draft-language-select')!;
    const other = [...language.options].find(option => option.value && option.value !== language.value)!; expect(other).toBeDefined();
    await act(async () => { language.value = other.value; language.dispatchEvent(new Event('change', { bubbles: true })); });
    const after = ordinarySnapshot(), oldStored = JSON.parse(before.advanced!), newStored = JSON.parse(after.advanced!);
    expect(newStored.draft).toEqual({ ...oldStored.draft, settings: { ...oldStored.draft.settings, userGuidance: '房主本地新引导' }, storyLength: 'long', customStoryLength: '', selectedLanguage: other.value });
    // The legacy fixture omits optional output fields; the existing autosave serializes their null defaults.
    expect(newStored.output).toEqual({ ...oldStored.output, failureDiagnostic: null, hosted: null, hostedGenerationId: null, renderSnapshot: null }); expect({ ...after, advanced: before.advanced }).toEqual(before);
    expect(port.actions.map(value => value.action.kind)).toEqual(['create']);
    expect(room().textContent).toContain(`修订 ${authority.snapshot.revision}`); assertConstrained();
    await click('比较本地与房间设置', room()); await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); expect(button('发布已比较的设置', room())).toBeDefined(); });
    await click('发布已比较的设置', room()); const publishing = await startAction('确认发布房间配置', 'config');
    expect(publishing.action).toMatchObject({ kind: 'config', request: { expectedRevision: authority.snapshot.revision,
      sharedConfig: { userGuidance: '房主本地新引导', storyLength: 'long', customStoryLength: null, selectedLanguage: other.value } } });
    expect(editor.querySelector('input[name="arena_story_guidance"]')!.matches(':disabled')).toBe(true);
    await port.deliver({ kind: 'mutation-unknown', operation: 'config', intentId: 'config-unknown', roomId: authority.roomId });
    await port.deliver({ kind: 'request-error', operation: 'config', requestId: publishing.requestId, error: ipcFixture.error });
    expect(editor.querySelector('input[name="arena_story_guidance"]')!.matches(':disabled')).toBe(true);
    await change('#room-host-draft-arena-story-guidance', 'must remain blocked');
    expect(ordinarySnapshot().advanced).toBe(after.advanced); expect(port.actions.map(value => value.action.kind)).toEqual(['create', 'config']); assertNoExecution();
  });

  it('keeps received proposals read-only for members and removes them on account retirement without writes', async () => {
    seedOrdinary(); await mount(); const before = ordinarySnapshot(); await open();
    await change('#arena-room-join-code', serviceFixture.operations.join.success.result.roomId);
    const joining = await startAction('加入房间', 'join'); const authority = await confirmMembership(joining, 'member');
    await publishOnline(authority);
    const event = structuredClone(ipcFixture.pulls[12]!.batch.event) as { kind: 'socket'; message: { controlSeq: number; payload: ArenaRoomSessionResponse['snapshot'] } };
    event.message.controlSeq += 1; event.message.payload.controlSeq = event.message.controlSeq;
    event.message.payload.proposals = [{ proposalVersion: PROPOSAL_VERSION, proposalId: 'received-proposal', roomId: authority.roomId,
      authorUserId: authority.self.userId, baseRevision: event.message.payload.revision, status: 'submitted', createdAt: '2026-10-15T12:00:00Z',
      changes: [{ changeId: 'guidance', type: 'setUserGuidance', expectedBase: { kind: 'value', value: event.message.payload.sharedConfig.userGuidance }, value: '只读提案目标' }] }];
    await port.deliver(event);
    const view = () => container.querySelector('[aria-label="房间提案只读预览"]');
    expect(view()?.textContent).toContain('只读提案目标'); expect(view()?.textContent).toContain(`修订 ${event.message.payload.revision}`);
    expect(view()?.querySelector('button, input, select, textarea')).toBeNull();
    for (const label of ['接受所选', '拒绝全部', '提交提案', '撤回提案']) expect(button(label, room())).toBeUndefined();
    await port.deliver({ kind: 'status', state: 'resync-required' });
    expect(view()?.textContent).toContain('最后已收到的房间快照（当前未同步）'); expect(view()?.textContent).toContain('received-proposal');
    expect(ordinarySnapshot()).toEqual(before); expect(port.actions.map(value => value.action.kind)).toEqual(['join']); assertNoExecution();
    await act(async () => { await getDesktopCloudSessionStore().signOut(); });
    expect(view()).toBeNull(); expect(container.textContent).not.toContain('只读提案目标');
  });

  it('reviews only active host pending proposals and installs the resolved authority without touching the dirty local draft', async () => {
    const session = reviewSession(), original = structuredClone(session.snapshot.proposals[0]!);
    session.snapshot.proposals.push({ ...structuredClone(original), proposalId: 'legacy/unsafe-proposal' },
      { ...structuredClone(original), proposalId: 'already-terminal', status: 'accepted' });
    seedOrdinary(); await mount(); await open();
    const creating = await startAction('创建多人房间', 'create'); await confirmMembership(creating, 'host', session);
    expect(requiredButton('接受所选', proposalCard()).disabled).toBe(true);
    await publishOnline(session);
    const safe = proposalCard(), unsafe = proposalCard('legacy/unsafe-proposal');
    expect(requiredButton('接受所选', safe).disabled).toBe(false);
    expect(requiredButton('拒绝全部', safe).disabled).toBe(false);
    expect(requiredButton('接受所选', unsafe).disabled).toBe(true);
    expect(requiredButton('拒绝全部', unsafe).disabled).toBe(true);
    await click('拒绝全部', unsafe);
    expect(buttons(room()).filter(item => item.textContent?.trim() === '接受所选')).toHaveLength(2);
    for (const label of ['提交提案', '撤回提案']) expect(button(label, room())).toBeUndefined();
    await change('#room-host-draft-arena-story-guidance', '尚未发布的本机 dirty draft');
    const before = ordinarySnapshot();
    const selected = safe.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'); expect(selected).toHaveLength(2);
    await act(async () => selected[1]!.click());
    const resolving = await startAction('接受所选', 'proposal-resolve');
    expect(resolving.action).toMatchObject({ kind: 'proposal-resolve', roomId: session.roomId, proposalId: original.proposalId,
      request: { expectedRoomEpoch: session.roomEpoch, resolution: 'accept-selected', selectedChangeIds: ['guidance'] } });
    if (resolving.action.kind !== 'proposal-resolve') throw new Error('Expected proposal resolution');
    expect(resolving.action.request).not.toHaveProperty('expectedControlSeq');
    expect(resolving.action.request).not.toHaveProperty('overrideChangeIds');
    // The proposal is older than the room revision, but its selected target's expectedBase still matches.
    expect(original.baseRevision).toBeLessThan(session.snapshot.revision);
    expect(original.changes[0]!.expectedBase).toEqual({ kind: 'value', value: session.snapshot.sharedConfig.userGuidance });
    expect(session.snapshot.proposals[0]).toEqual(original);
    const resolved = structuredClone(session); resolved.snapshot.revision += 1; resolved.snapshot.controlSeq += 1;
    resolved.snapshot.sharedConfig.userGuidance = '仅更新服务器提案引导';
    resolved.snapshot.proposals = resolved.snapshot.proposals.filter(item => item.proposalId !== original.proposalId);
    const delivered = await port.deliver(responseEvent(resolving, proposalResult(resolved)), { holdAck: true });
    expect(room().querySelector('[aria-label="房间权威设定摘要"]')?.textContent).toContain(`修订 ${resolved.snapshot.revision}`);
    expect(port.subscriptions).toHaveLength(1); expect(ordinarySnapshot()).toEqual(before);
    const subscribed = port.nextSubscription(); await act(async () => { delivered.ackGate.resolve(); await subscribed; });
    await publishOnline(resolved);
    expect(room().textContent).not.toContain('提案 ID：host-review-proposal');
    expect(container.querySelector<HTMLInputElement>('#room-host-draft-arena-story-guidance')!.value).toBe('尚未发布的本机 dirty draft');
    await click('比较本地与房间设置', room());
    await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); expect(room().querySelector('[aria-label="本地与房间配置比较"] pre')).not.toBeNull(); });
    const comparison = room().querySelectorAll('[aria-label="本地与房间配置比较"] pre');
    expect(JSON.parse(comparison[0]!.textContent!)).toEqual(resolved.snapshot.sharedConfig);
    expect(JSON.parse(comparison[1]!.textContent!)).toMatchObject({ userGuidance: '尚未发布的本机 dirty draft' });
    expect(ordinarySnapshot()).toEqual(before); expect(port.actions.map(item => item.action.kind)).toEqual(['create', 'proposal-resolve']); assertNoExecution();
  });

  it('keeps unknown resolutions blocked until exact Native observation ACK and distinguishes different from partial scope-unverified outcomes', async () => {
    let session = await beginReview(); const before = ordinarySnapshot();
    const cases = [
      { proposalId: 'host-review-proposal', intentId: 'unknown-different', outcome: 'different', terminalStatus: 'withdrawn', text: '结果与原意图不同' },
      { proposalId: 'next-review-proposal', intentId: 'unknown-partial', outcome: 'scope-unverified', terminalStatus: 'partially_accepted', text: '具体接受范围尚无法确认' },
    ] as const;
    for (const [index, outcome] of cases.entries()) {
      const resolving = await startAction('接受所选', 'proposal-resolve');
      await loseProposalResult(resolving, session, outcome.intentId);
      expect(requiredButton('接受所选', proposalCard(outcome.proposalId)).disabled).toBe(true);
      expect(requiredButton('拒绝全部', proposalCard(outcome.proposalId)).disabled).toBe(true);
      await click('接受所选', proposalCard(outcome.proposalId));
      expect(port.actions.filter(item => item.action.kind === 'proposal-resolve')).toHaveLength(index + 1);
      const read = await startAction('读取房间核对提案', 'session');
      const observed = structuredClone(session); observed.snapshot.controlSeq += 1;
      observed.snapshot.proposals = [{ ...observed.snapshot.proposals.find(item => item.proposalId === outcome.proposalId)!, status: outcome.terminalStatus }];
      if (index === 0) observed.snapshot.proposals.push({ ...structuredClone(reviewSession().snapshot.proposals[0]!), proposalId: 'next-review-proposal' });
      const subscriptionCount = port.subscriptions.length;
      await port.deliver(responseEvent(read, observed));
      expect(port.subscriptions).toHaveLength(subscriptionCount);
      const evidence = await port.deliver({ kind: 'proposal-observation', intentId: outcome.intentId,
        observation: { observation: 'terminal', linked: true, settle: true, outcome: outcome.outcome, terminalStatus: outcome.terminalStatus } }, { holdAck: true });
      expect(port.pendingIntent?.intentId).toBe(outcome.intentId);
      expect(room().querySelector('[aria-label="提案处理状态"]')).not.toBeNull();
      expect(room().querySelector('[aria-label="提案处理状态"]')?.textContent).toContain('原提案操作结果未知');
      expect(room().textContent).not.toContain(outcome.text);
      expect(buttons(room()).filter(item => item.textContent?.trim() === '接受所选').every(item => item.disabled)).toBe(true);
      expect(port.subscriptions).toHaveLength(subscriptionCount);
      const subscribed = port.nextSubscription(); await act(async () => { evidence.ackGate.resolve(); await subscribed; });
      expect(port.pendingIntent).toBeNull(); expect(room().textContent).toContain(outcome.text);
      expect(port.order.indexOf(`acknowledged:${evidence.batch.batchId}`)).toBeLessThan(port.order.lastIndexOf('subscribe'));
      session = observed; await publishOnline(session);
      if (index === 0) expect(requiredButton('接受所选', proposalCard('next-review-proposal')).disabled).toBe(false);
      expect(ordinarySnapshot()).toEqual(before); assertNoExecution();
    }
    expect(port.actions.map(item => item.action.kind)).toEqual(['create', 'proposal-resolve', 'session', 'proposal-resolve', 'session']);
  });

  it('ends proposal tracking explicitly and requires a fresh read before making a new review selection', async () => {
    const session = await beginReview(); const before = ordinarySnapshot();
    const boxes = proposalCard().querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => boxes[1]!.click());
    const resolving = await startAction('拒绝全部', 'proposal-resolve');
    expect(resolving.action).toEqual({ kind: 'proposal-resolve', roomId: session.roomId, proposalId: 'host-review-proposal',
      request: { expectedRoomEpoch: session.roomEpoch, expectedRevision: session.snapshot.revision, resolution: 'reject' } });
    await loseProposalResult(resolving, session, 'ending-proposal-intent');
    await click('明确结束本机提案跟踪', room());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('不会'));
    expect(port.order).not.toContain('end-proposal-tracking');
    vi.mocked(window.confirm).mockReturnValue(true); await click('明确结束本机提案跟踪', room());
    expect(port.order.filter(item => item === 'end-proposal-tracking')).toHaveLength(1);
    expect(button('接受所选', room())).toBeUndefined(); expect(button('创建多人房间', room())).toBeUndefined();
    expect(port.actions.map(item => item.action.kind)).toEqual(['create', 'proposal-resolve']);
    const read = await startAction('读取最新房间后重新审阅', 'session');
    const fresh = structuredClone(session); fresh.snapshot.controlSeq += 1;
    await confirmMembership(read, 'host', fresh);
    expect(requiredButton('接受所选', proposalCard()).disabled).toBe(true);
    await publishOnline(fresh);
    const refreshedBoxes = proposalCard().querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect([...refreshedBoxes].every(input => input.checked && !input.disabled)).toBe(true);
    expect(requiredButton('接受所选', proposalCard()).disabled).toBe(false);
    expect(port.actions.map(item => item.action.kind)).toEqual(['create', 'proposal-resolve', 'session']);
    expect(ordinarySnapshot()).toEqual(before); assertNoExecution();
  });

  it('drops a late proposal resolution after owner retirement without replacing the current ordinary draft', async () => {
    const session = await beginReview();
    const resolving = await startAction('接受所选', 'proposal-resolve');
    const resolved = structuredClone(session); resolved.snapshot.revision += 1; resolved.snapshot.controlSeq += 1;
    resolved.snapshot.sharedConfig.userGuidance = '旧账号晚到的服务器设定'; resolved.snapshot.proposals = [];
    const late = port.queue(responseEvent(resolving, proposalResult(resolved, 'accepted')), { holdPull: true });
    await act(async () => { port.notify(late); await late.pullStarted.promise; });
    await act(async () => { await getDesktopCloudSessionStore().signOut(); });
    expect(room().querySelector('[aria-label="房主提案审阅"]')).toBeNull();
    await change('#arena-story-guidance', '账号退休后的当前普通草稿');
    const afterRetirement = ordinarySnapshot(), textAfterRetirement = container.textContent;
    await act(async () => { late.pullGate.resolve(); await late.pullReturned.promise; });
    await act(async () => port.notify(late));
    expect(ordinarySnapshot()).toEqual(afterRetirement); expect(container.textContent).toBe(textAfterRetirement);
    expect(container.querySelector<HTMLInputElement>('#arena-story-guidance')!.value).toBe('账号退休后的当前普通草稿');
    expect(container.textContent).not.toContain('旧账号晚到的服务器设定'); expect(port.subscriptions).toHaveLength(1);
    expect(port.actions.map(item => item.action.kind)).toEqual(['create', 'proposal-resolve']); assertNoExecution();
  });

  it('creates as host, waits for HTTP ACK before subscribe and for snapshot plus presence before online, then closes explicitly', async () => {
    seedOrdinary(); await mount(); const before = ordinarySnapshot(); await open();
    const operation = await startAction('创建多人房间', 'create'); assertConstrained(); assertNoOnline();
    expect(operation.action).toMatchObject({ kind: 'create', request: { displayName: '普通账号', sharedConfig: { combatants: [{ source: 'host-local' }, { source: 'host-local' }] } } });
    expect(JSON.stringify(operation.action)).not.toContain('完整本机设定');
    const session = sessionFor('host');
    const delivered = await port.deliver(responseEvent(operation, session), { holdAck: true });
    expect(room().textContent).toContain('你是房主'); assertNoOnline();
    expect(port.subscriptions).toEqual([]); expect(ordinarySnapshot()).toEqual(before);
    const subscribed = port.nextSubscription();
    await act(async () => { delivered.ackGate.resolve(); await subscribed; });
    expect(port.order.indexOf(`acknowledged:${delivered.batch.batchId}`)).toBeLessThan(port.order.indexOf('subscribe'));
    expect(room().querySelectorAll('[data-member-presence="unknown"]')).toHaveLength(2);
    await publishOnline(session); assertConstrained();
    const beforeComparison = mocks.invoke.mock.calls.length;
    await click('比较本地与房间设置', room());
    await vi.waitFor(async () => { await act(async () => { await Promise.resolve(); }); expect(room().textContent).toContain('与房间当前设置相比，本地修改了'); });
    expect(mocks.invoke.mock.calls.length).toBe(beforeComparison);
    expect(room().textContent).not.toContain('完整本机设定');
    expect(ordinarySnapshot()).toEqual(before);
    await click('关闭房间', room()); await click('取消', room());
    expect(port.actions.map(item => item.action.kind)).toEqual(['create']);
    await click('关闭房间', room());
    const closing = await startAction('确认关闭房间', 'close');
    expect(closing.action).toEqual({ kind: 'close', roomId: session.roomId, expectedRoomEpoch: session.roomEpoch });
    await port.deliver(responseEvent(closing, serviceFixture.operations.close.success.result));
    expect(room().textContent).toContain('房间已关闭。');
    expect(button('生成战报')).toBeTruthy();
    expect(container.querySelector('[aria-label="战报结果"]')?.textContent).toContain(reportText);
    await click('断开本机房间连接', room());
    expect(ordinarySnapshot()).toEqual(before); assertNoExecution();
  });

  it('joins as the exact member without uploading the local draft and leaves only after confirmation', async () => {
    seedOrdinary(); await mount(); const before = ordinarySnapshot(); await open();
    await change('#arena-room-join-code', serviceFixture.operations.join.success.result.roomId);
    const joining = await startAction('加入房间', 'join');
    expect(joining.action).toEqual({ kind: 'join', roomId: serviceFixture.operations.join.success.result.roomId, request: { displayName: '普通账号' } });
    const session = await confirmMembership(joining, 'member');
    expect(button('比较本地与房间设置', room())).toBeUndefined();
    expect(room().textContent).toContain('你是成员'); expect(button('关闭房间', room())).toBeUndefined();
    await publishOnline(session); assertConstrained();
    await click('离开房间', room()); await click('取消', room());
    expect(port.actions.map(item => item.action.kind)).toEqual(['join']);
    await click('离开房间', room()); const leaving = await startAction('确认离开房间', 'leave');
    expect(leaving.action).toEqual({ kind: 'leave', roomId: session.roomId, expectedRoomEpoch: session.roomEpoch });
    await port.deliver(responseEvent(leaving, serviceFixture.operations.leave.success.result));
    expect(room().textContent).toContain('已离开房间。');
    expect(room().querySelector('[aria-label="房间成员列表"]')).toBeNull();
    await click('断开本机房间连接', room());
    expect(ordinarySnapshot()).toEqual(before);
    expect(container.querySelector('[aria-label="战报结果"]')?.textContent).toContain(reportText); assertNoExecution();
  });

  it.each(['host', 'member'] as const)('does not revive a previous %s confirmation after same-account reattachment to the same room epoch', async role => {
    seedOrdinary(); await mount(); const before = ordinarySnapshot(); await open();
    const roomId = serviceFixture.operations.join.success.result.roomId;
    await change('#arena-room-join-code', roomId);
    const originalJoin = await startAction('加入房间', 'join');
    const originalSession = await confirmMembership(originalJoin, role);
    await publishOnline(originalSession);
    const exitLabel = role === 'host' ? '关闭房间' : '离开房间';
    const confirmLabel = role === 'host' ? '确认关闭房间' : '确认离开房间';
    const exitKind = role === 'host' ? 'close' : 'leave';
    await click(exitLabel, room());
    expect(room().querySelector('[role="alertdialog"][aria-label="确认房间管理动作"]')).not.toBeNull();
    expect(button(confirmLabel, room())).toBeTruthy();
    expect(port.actions.map(item => item.action.kind)).toEqual(['join']);

    await act(async () => { await getDesktopCloudSessionStore().signOut(); });
    expect(getDesktopCloudSessionStore().getSnapshot().verification).toBe('signed-out');
    expect(room().querySelector('[aria-label="房间成员列表"]')).toBeNull();
    account = { userId: serviceFixture.expectedUserId, username: '普通账号' };
    await act(async () => { await getDesktopCloudSessionStore().refresh(); });
    expect(getDesktopCloudSessionStore().getSnapshot().verification).toBe('verified');
    await click('打开多人大厅', room());
    expect(port.order.filter(item => item === 'attach')).toHaveLength(2);
    await change('#arena-room-join-code', roomId);
    const nextJoin = await startAction('加入房间', 'join');
    const nextSession = await confirmMembership(nextJoin, role);
    // Same visible identity is deliberately insufficient: the owner/credential generation changed.
    expect(nextSession).toEqual(originalSession);
    expect(nextJoin.handle).not.toBe(originalJoin.handle);
    await publishOnline(nextSession);
    expect(room().querySelector('[role="alertdialog"][aria-label="确认房间管理动作"]')).toBeNull();
    expect(button(confirmLabel, room())).toBeUndefined();
    expect(port.actions.map(item => item.action.kind)).toEqual(['join', 'join']);
    assertConstrained();

    await click(exitLabel, room());
    expect(room().querySelector('[role="alertdialog"][aria-label="确认房间管理动作"]')).not.toBeNull();
    const freshExit = await startAction(confirmLabel, exitKind);
    expect(freshExit.action).toEqual({ kind: exitKind, roomId, expectedRoomEpoch: nextSession.roomEpoch });
    expect(freshExit.handle).toBe(nextJoin.handle);
    await port.deliver(responseEvent(freshExit, serviceFixture.operations[exitKind].success.result));
    expect(port.actions.map(item => item.action.kind)).toEqual(['join', 'join', exitKind]);
    expect(ordinarySnapshot()).toEqual(before);
    expect(container.querySelector('[aria-label="战报结果"]')?.textContent).toContain(reportText);
    assertNoExecution();
  });

  it('requires an explicit canonical-empty choice when the real public selection lacks an observed version', async () => {
    seedOrdinary(savedDraft({ combatants: [] })); await mount();
    await click('浏览在线角色库');
    const library = document.querySelector<HTMLElement>('[role="dialog"][aria-label="选择角色数据卡"]'); expect(library).not.toBeNull();
    const tab = buttons(library!).find(item => item.textContent?.startsWith('公开')); expect(tab).toBeTruthy();
    await act(async () => tab!.click());
    const card = [...library!.querySelectorAll<HTMLElement>('.grid > .relative')].find(item => item.querySelector('h4')?.textContent === publicCard.name); expect(card).toBeTruthy();
    const select = card!.querySelector<HTMLButtonElement>('button[aria-label="加入"]'); expect(select).not.toBeNull();
    await act(async () => select!.click());
    expect(library!.isConnected).toBe(true);
    expect(card!.querySelector('button[aria-label="移除"]')).not.toBeNull();
    await act(async () => library!.querySelector<HTMLButtonElement>('button[aria-label="关闭选择角色数据卡"]')!.click());
    expect(library!.isConnected).toBe(false);
    const selected = JSON.parse(localStorage.getItem(ADVANCED_ARENA_DRAFT_KEY)!).draft.combatants.at(-1);
    expect(selected).toMatchObject({ desktopSource: 'online', sourceDataCardId: publicCard.id });
    expect(selected.sourceDataCardUpdatedAt).toBeUndefined();
    const before = ordinarySnapshot(); await open(); await click('创建多人房间', room());
    expect(room().textContent).toContain('在线内容引用缺少版本信息');
    expect(button('明确创建空草稿房间', room())).toBeTruthy(); expect(port.actions).toEqual([]);
    expect(ordinarySnapshot()).toEqual(before);
    await click('明确创建空草稿房间', room());
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('项目标准空草稿'));
    expect(port.actions).toEqual([]);
    vi.mocked(window.confirm).mockReturnValue(true);
    const empty = await startAction('明确创建空草稿房间', 'create');
    expect(empty.action).toMatchObject({ kind: 'create', request: { sharedConfig: { battleMode: 'classic', reportFormat: 'markdown', combatants: [], teams: [], scenario: null, auxScenarios: [], materials: [], userGuidance: '', historySettings: { readArenaHistoryLimit: 3 } } } });
    expect(port.actions).toHaveLength(1); expect(ordinarySnapshot()).toEqual(before);
    await click('断开本机房间连接', room());
    expect(ordinarySnapshot()).toEqual(before);
    expect(container.querySelector('[aria-label="战报结果"]')?.textContent).toContain(reportText); assertNoExecution();
  });

  it('requires confirmation to resume only the original unknown create intent and never sends a fresh create', async () => {
    await mount(); await open(); const creating = await startAction('创建多人房间', 'create');
    const original = structuredClone(creating.action);
    await port.deliver({ kind: 'mutation-unknown', operation: 'create', intentId: 'original-create-intent', roomId: null });
    await port.deliver({ kind: 'request-error', requestId: creating.requestId, operation: 'create', error: ipcFixture.error });
    expect(room().textContent).toContain('原创建操作结果未知'); assertConstrained();
    await click('确认恢复原创建意图', room());
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining('resume-only'));
    expect(port.actions).toHaveLength(1);
    vi.mocked(window.confirm).mockReturnValue(true);
    const resumed = await startAction('确认恢复原创建意图', 'resume-create');
    expect(resumed.action).toEqual({ kind: 'resume-create', intentId: 'original-create-intent' });
    expect(port.actions.map(item => item.action.kind)).toEqual(['create', 'resume-create']);
    expect(creating.action).toEqual(original);
    await confirmMembership(resumed, 'host');
    expect(room().querySelector('[aria-label="核对未知房间操作"]')).toBeNull(); assertNoExecution();
  });

  it('renders restored config tracking without a room snapshot and ends only through explicit confirmation', async () => {
    port.pendingIntent = { operation: 'config', intentId: 'original-config-intent', roomId: serviceFixture.operations.session.success.result.roomId };
    await mount(); await open();
    expect(room().textContent).toContain('原目标已不可恢复');
    expect(button('发布已比较的设置', room())).toBeUndefined();
    await click('结束本次跟踪', room()); expect(port.order).not.toContain('end-config-tracking');
    await click('继续跟踪', room()); expect(port.order).not.toContain('end-config-tracking');
    await click('结束本次跟踪', room()); await click('确认结束跟踪', room());
    expect(port.order.filter(value => value === 'end-config-tracking')).toHaveLength(1);
    expect(room().textContent).toContain('不会撤销服务器请求');
    expect(button('重新读取房间', room())).toBeDefined();
    expect(button('创建多人房间', room())).toBeUndefined(); expect(port.actions).toEqual([]);
    const read = await startAction('重新读取房间', 'session'); await confirmMembership(read, 'host');
    expect(room().querySelector('[aria-label="配置发布跟踪"]')).toBeNull();
    expect(button('比较本地与房间设置', room())).toBeDefined(); assertNoExecution();
  });

  it.each(['join', 'leave', 'close'] as const)('reconciles an unknown %s only with a scoped session read', async operation => {
    port.pendingIntent = { operation, intentId: `original-${operation}-intent`, roomId: serviceFixture.operations.session.success.result.roomId };
    await mount(); await open(); assertConstrained();
    expect(room().querySelector('#arena-room-join-code')).toBeNull();
    expect(button('加入房间', room())).toBeUndefined();
    expect(port.actions).toEqual([]);
    const read = await startAction('读取房间核对结果', 'session');
    expect(read.action).toEqual({ kind: 'session', roomId: port.pendingIntent.roomId });
    expect(window.confirm).not.toHaveBeenCalled();
    await confirmMembership(read, operation === 'close' ? 'host' : 'member');
    expect(port.actions.map(item => item.action.kind)).toEqual(['session']);
    expect(room().querySelector('[aria-label="核对未知房间操作"]')).toBeNull(); assertNoExecution();
  });

  it('renders bounded directory member counts without claiming online presence or accumulating pages', async () => {
    await mount(); await open(); const discovery = await startAction('刷新', 'discover');
    expect(discovery.action).toEqual({ kind: 'discover', query: { limit: 50 } });
    await port.deliver(responseEvent(discovery, serviceFixture.boundaryExamples.directoryWith50Items.result));
    const list = room().querySelector('[aria-label="公开房间列表"]')!;
    expect(list.children).toHaveLength(50); expect(list.textContent).toContain('2/32 人');
    expect(list.querySelector('[data-member-presence]')).toBeNull(); assertNoOnline();
    expect(room().textContent).toContain('人数不是在线人数');
    const next = await startAction('下一页', 'discover');
    expect(next.action).toEqual({ kind: 'discover', query: { limit: 50, cursor: 'next-page' } });
    await port.deliver(responseEvent(next, serviceFixture.operations.discover.success.result));
    expect(room().querySelector('[aria-label="公开房间列表"]')!.children).toHaveLength(1);
    expect(button('下一页', room())).toBeUndefined(); assertNoOnline(); assertNoExecution();
  });

  it.each(['account', 'document'] as const)('drops a late pulled membership batch after %s retirement without resurrecting UI', async retirement => {
    seedOrdinary(); const router = await mount(); await open();
    const joining = await (async () => { await change('#arena-room-join-code', serviceFixture.operations.join.success.result.roomId); return startAction('加入房间', 'join'); })();
    const late = port.queue(responseEvent(joining, sessionFor('member')), { holdPull: true });
    await act(async () => { port.notify(late); await late.pullStarted.promise; });
    if (retirement === 'account') {
      await act(async () => { await getDesktopCloudSessionStore().signOut(); });
      expect(getDesktopCloudSessionStore().getSnapshot().verification).toBe('signed-out');
    } else {
      Object.defineProperty(window, '__MAHOSHOJO_ROOM_DOCUMENT_V1__', { configurable: true, writable: true, value: 'b'.repeat(64) });
      vi.mocked(window.confirm).mockReturnValue(true);
      await act(async () => { await router.navigate({ to: '/battle' }); });
      expect(button('打开多人大厅')).toBeUndefined();
    }
    const afterRetirement = container.textContent;
    await act(async () => { late.pullGate.resolve(); await late.pullReturned.promise; });
    const pulls = port.order.filter(item => item.startsWith('pull:'));
    await act(async () => port.notify(late));
    expect(port.order.filter(item => item.startsWith('pull:'))).toEqual(pulls);
    expect(container.textContent).toBe(afterRetirement);
    expect(container.querySelector('[aria-label="房间成员列表"]')).toBeNull();
    expect(port.subscriptions).toEqual([]);
    expect(port.actions.map(item => item.action.kind)).toEqual(['join']);
    expect(port.acknowledgements).toHaveLength(retirement === 'account' ? 1 : 0);
    assertNoExecution();
  });
});

const memberWorkspace = () => {
  const node = container.querySelector<HTMLElement>('[aria-labelledby="arena-room-proposal-workspace-heading"]');
  expect(node, 'the real shared full member workspace').not.toBeNull(); return node!;
};
const memberGuidance = () => {
  const input = memberWorkspace().querySelector<HTMLInputElement>('input[name="arena_story_guidance"]');
  expect(input).not.toBeNull(); return input!;
};
const editMemberGuidance = async (value: string) => {
  const input = memberGuidance(); await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const beginMember = async () => {
  seedOrdinary(); await mount(); const ordinary = ordinarySnapshot(); await open();
  await change('#arena-room-join-code', serviceFixture.operations.join.success.result.roomId);
  const joining = await startAction('加入房间', 'join'); const session = await confirmMembership(joining, 'member');
  return { session, ordinary };
};
const submitMemberPreview = async () => {
  await click('预览提案', memberWorkspace());
  const next = port.nextAction('proposal-submit'); let operation!: Operation;
  await act(async () => { requiredButton('提交提案').click(); operation = await next; });
  expect(operation.action.kind).toBe('proposal-submit'); return operation;
};
const memberSummary = (session: ArenaRoomSessionResponse, proposalId: string, status: 'submitted' | 'withdrawn') => ({
  protocolVersion: 1, roomId: session.roomId, roomEpoch: session.roomEpoch,
  controlSeq: session.snapshot.controlSeq + 100, revision: session.snapshot.revision + 100, proposalId, status, result: 'applied',
});

describe('Desktop member full shared editor journey', () => {
  it('requires fresh authority, preserves ordinary state while editing, and restores it only after confirmed leave', async () => {
    const { session, ordinary } = await beginMember();
    expect(memberWorkspace().textContent).toContain('选择预设魔法少女');
    expect(memberWorkspace().textContent).toContain('选择预设残兽');
    expect(memberGuidance().matches(':disabled')).toBe(true);
    expect(memberWorkspace().textContent).not.toContain('上次提案请求结果未知');
    await publishOnline(session); expect(memberGuidance().matches(':disabled')).toBe(false);
    // HTML text inputs normalize line breaks; the model retains the full protocol value.
    expect(memberGuidance().value).toBe(session.snapshot.sharedConfig.userGuidance.replace(/[\r\n]/g, ''));
    await editMemberGuidance('仅保存在成员稿中的修改');
    expect(ordinarySnapshot()).toEqual(ordinary); expect(port.actions.map(item => item.action.kind)).toEqual(['join']);
    assertConstrained(); assertNoExecution();
    await click('离开房间', room()); expect(room().textContent).toContain('未提交成员草稿'); await click('取消', room());
    expect(memberGuidance().value).toBe('仅保存在成员稿中的修改');
    await click('离开房间', room()); const leaving = await startAction('确认离开房间', 'leave');
    await port.deliver(responseEvent(leaving, serviceFixture.operations.leave.success.result));
    expect(container.querySelector('[aria-labelledby="arena-room-proposal-workspace-heading"]')).toBeNull();
    await click('断开本机房间连接', room()); expect(ordinarySnapshot()).toEqual(ordinary);
    expect(container.querySelector('[aria-label="战报结果"]')?.textContent).toContain(reportText); assertNoExecution();
  });

  it('dispatches frozen submit and own-pending withdraw through fixed Native actions without summary cursor advancement', async () => {
    const { session, ordinary } = await beginMember(); await publishOnline(session);
    await editMemberGuidance('成员已确认的完整提案'); const submitting = await submitMemberPreview();
    if (submitting.action.kind !== 'proposal-submit') throw new Error('Expected fixed submit action');
    const intent = submitting.action.request;
    expect(intent).toMatchObject({ expectedRoomEpoch: session.roomEpoch, baseRevision: session.snapshot.revision,
      changes: [expect.objectContaining({ type: 'setUserGuidance', value: '成员已确认的完整提案' })] });
    expect(intent.changes).toHaveLength(1);
    await port.deliver(responseEvent(submitting, memberSummary(session, intent.proposalId, 'submitted')));
    expect(room().textContent).toContain(`修订 ${session.snapshot.revision}`);
    expect(memberGuidance().value).toBe('成员已确认的完整提案'); expect(memberGuidance().matches(':disabled')).toBe(true);
    const fresh = structuredClone(session); fresh.snapshot.controlSeq += 1;
    fresh.snapshot.proposals = [{ proposalVersion: PROPOSAL_VERSION, proposalId: intent.proposalId, roomId: session.roomId,
      authorUserId: session.self.userId, baseRevision: intent.baseRevision, changes: intent.changes, status: 'submitted', createdAt: '2026-10-15T12:00:00Z' }];
    await publishOnline(fresh);
    const next = port.nextAction('proposal-withdraw'); let withdrawing!: Operation;
    await act(async () => { requiredButton('撤回提案', memberWorkspace()).click(); withdrawing = await next; });
    expect(withdrawing.action).toEqual({ kind: 'proposal-withdraw', roomId: session.roomId, proposalId: intent.proposalId, request: { expectedRoomEpoch: session.roomEpoch } });
    await port.deliver(responseEvent(withdrawing, memberSummary(fresh, intent.proposalId, 'withdrawn')));
    expect(room().textContent).toContain(`修订 ${session.snapshot.revision}`);
    expect(port.actions.map(item => item.action.kind)).toEqual(['join', 'proposal-submit', 'proposal-withdraw']);
    expect(ordinarySnapshot()).toEqual(ordinary); assertNoExecution();
  });

  it('keeps an unknown submit frozen through absent reads and releases only after the exact Native terminal ACK', async () => {
    const { session, ordinary } = await beginMember(); await publishOnline(session);
    await editMemberGuidance('未知请求仍保留的成员稿'); const submitting = await submitMemberPreview();
    await port.deliver({ kind: 'mutation-unknown', operation: 'proposalSubmit', intentId: 'member-unknown', roomId: session.roomId });
    await port.deliver({ kind: 'request-error', operation: 'proposalSubmit', requestId: submitting.requestId, error: ipcFixture.error });
    expect(memberWorkspace().textContent).toContain('上次提案请求结果未知');
    expect(memberGuidance().matches(':disabled')).toBe(true);
    const readNext = port.nextAction('session'); let read!: Operation;
    await act(async () => { requiredButton('重新连接并对账', memberWorkspace()).click(); read = await readNext; });
    const absent = structuredClone(session); absent.snapshot.controlSeq += 1; absent.snapshot.proposals = [];
    await port.deliver(responseEvent(read, absent));
    expect(memberWorkspace().textContent).toContain('上次提案请求结果未知');
    expect(port.actions.filter(item => item.action.kind === 'proposal-submit')).toHaveLength(1);
    const subscriptionCount = port.subscriptions.length;
    const evidence = await port.deliver({ kind: 'proposal-observation', intentId: 'member-unknown',
      observation: { observation: 'terminal', linked: true, settle: true, outcome: 'scope-unverified', terminalStatus: 'partially_accepted' } }, { holdAck: true });
    expect(memberWorkspace().textContent).toContain('上次提案请求结果未知');
    expect(port.pendingIntent?.intentId).toBe('member-unknown'); expect(port.subscriptions).toHaveLength(subscriptionCount);
    const subscribed = port.nextSubscription(); await act(async () => { evidence.ackGate.resolve(); await subscribed; });
    expect(port.pendingIntent).toBeNull(); expect(memberWorkspace().textContent).toContain('具体接受范围尚无法确认');
    expect(port.order.indexOf(`acknowledged:${evidence.batch.batchId}`)).toBeLessThan(port.order.lastIndexOf('subscribe'));
    await publishOnline(absent);
    expect(memberGuidance().value).toBe('未知请求仍保留的成员稿'); expect(memberGuidance().matches(':disabled')).toBe(false);
    expect(port.actions.map(item => item.action.kind)).toEqual(['join', 'proposal-submit', 'session']);
    expect(ordinarySnapshot()).toEqual(ordinary); assertNoExecution();
  });


  it('retains the detached dirty draft after explicit tracking end and fresh authority without resending', async () => {
    const { session, ordinary } = await beginMember(); await publishOnline(session);
    await editMemberGuidance('明确结束后仍可复制的草稿'); const submitting = await submitMemberPreview();
    await port.deliver({ kind: 'mutation-unknown', operation: 'proposalSubmit', intentId: 'member-end', roomId: session.roomId });
    await port.deliver({ kind: 'request-error', operation: 'proposalSubmit', requestId: submitting.requestId, error: ipcFixture.error });
    await click('结束本机跟踪（不取消服务器操作）', memberWorkspace());
    expect(port.order).not.toContain('end-proposal-tracking');
    vi.mocked(window.confirm).mockReturnValue(true); await click('结束本机跟踪（不取消服务器操作）', memberWorkspace());
    expect(port.order.filter(item => item === 'end-proposal-tracking')).toHaveLength(1);
    expect(memberGuidance().value).toBe('明确结束后仍可复制的草稿'); expect(memberGuidance().matches(':disabled')).toBe(true);
    const read = await startAction('读取最新房间后重新审阅', 'session');
    const fresh = structuredClone(session); fresh.snapshot.controlSeq += 1; fresh.snapshot.revision += 1;
    fresh.snapshot.sharedConfig.userGuidance = '服务器最新设置';
    await confirmMembership(read, 'member', fresh); await publishOnline(fresh);
    expect(memberGuidance().value).toBe('明确结束后仍可复制的草稿');
    expect(memberWorkspace().textContent).toContain('房间设置已更新');
    expect(port.actions.map(item => item.action.kind)).toEqual(['join', 'proposal-submit', 'session']);
    expect(ordinarySnapshot()).toEqual(ordinary); assertNoExecution();
  });

  it.each([true, false])('uses the fixed random route and a fresh public read, available=%s', async available => {
    const originalInvoke = mocks.invoke.getMockImplementation()!;
    const card = { ...publicCard, id: 'random-member-character', name: '随机公开角色', review_status: 'approved', updated_at: 'observed-before-read' };
    mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
      if (command === 'cloud_card_library_request') {
        const request = args.request as { routeId: string; query?: Record<string, string> };
        if (request.routeId === 'random-public-card.query') return { status: 200, body: { success: true, card } };
        if (request.routeId === 'public-data-cards.query' && request.query?.id === card.id) return available
          ? { status: 200, body: { success: true, card: { ...card, updated_at: 'latest-observed-token' } } }
          : { status: 404, body: { success: false } };
      }
      return originalInvoke(command, args);
    });
    const { session, ordinary } = await beginMember(); await publishOnline(session);
    await click('随机匹配角色', memberWorkspace());
    await vi.waitFor(() => expect(memberWorkspace().textContent).toContain(available ? card.name : '该公开数据卡不存在或已撤回'));
    const requests = mocks.invoke.mock.calls.filter(([command]) => command === 'cloud_card_library_request').map(([, args]) => (args as { request: { routeId: string; query?: unknown } }).request);
    expect(requests.filter(request => request.routeId === 'random-public-card.query')).toEqual([{ routeId: 'random-public-card.query', query: { type: 'character' } }]);
    expect(requests.some(request => request.routeId === 'public-data-cards.query' && (request.query as { id?: string })?.id === card.id)).toBe(true);
    if (available) {
      const submitting = await submitMemberPreview();
      expect(submitting.action).toMatchObject({ kind: 'proposal-submit', request: { changes: expect.arrayContaining([
        expect.objectContaining({ type: 'addCombatant', ref: { id: card.id, kind: 'character', versionToken: 'latest-observed-token' } }),
      ]) } });
      expect(JSON.stringify(submitting.action)).not.toContain('不得随房间创建上传的私有正文');
    } else expect(port.actions.map(item => item.action.kind)).toEqual(['join']);
    expect(ordinarySnapshot()).toEqual(ordinary); assertNoExecution();
  });


  it('permanently retires a preview when freshness is lost, while retaining the dirty draft across the same snapshot', async () => {
    const { session, ordinary } = await beginMember(); await publishOnline(session);
    await editMemberGuidance('断线前的独立成员草稿'); await click('预览提案', memberWorkspace());
    expect(requiredButton('提交提案').disabled).toBe(false);
    await port.deliver({ kind: 'status', state: 'offline' });
    await publishOnline(session);
    expect(button('提交提案')).toBeUndefined();
    expect(memberGuidance().value).toBe('断线前的独立成员草稿');
    expect(port.actions.map(item => item.action.kind)).toEqual(['join']);
    await click('预览提案', memberWorkspace()); expect(requiredButton('提交提案').disabled).toBe(false);
    expect(ordinarySnapshot()).toEqual(ordinary); assertNoExecution();
  });


  it('drops a random source result dispatched before freshness loss even after the same snapshot returns', async () => {
    const originalInvoke = mocks.invoke.getMockImplementation()!;
    const pending = deferred<unknown>();
    const card = { ...publicCard, id: 'late-random-member', name: '旧随机响应不得入稿', review_status: 'approved', updated_at: 'observed-token' };
    mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
      if (command === 'cloud_card_library_request') {
        const request = args.request as { routeId: string; query?: Record<string, string> };
        if (request.routeId === 'random-public-card.query') return pending.promise;
        if (request.routeId === 'public-data-cards.query' && request.query?.id === card.id) return { status: 200, body: { success: true, card } };
      }
      return originalInvoke(command, args);
    });
    const { session, ordinary } = await beginMember(); await publishOnline(session);
    await click('随机匹配角色', memberWorkspace());
    await port.deliver({ kind: 'status', state: 'offline' }); await publishOnline(session);
    await act(async () => { pending.resolve({ status: 200, body: { success: true, card } }); });
    await vi.waitFor(() => expect(button('随机匹配角色', memberWorkspace())).toBeDefined());
    expect(memberWorkspace().textContent).not.toContain(card.name);
    expect(requiredButton('预览提案', memberWorkspace()).disabled).toBe(true);
    expect(port.actions.map(item => item.action.kind)).toEqual(['join']);
    expect(ordinarySnapshot()).toEqual(ordinary); assertNoExecution();
  });

});

it('keeps top-page draft repair and discard constrained while allowing a read-only backup', async () => {
  seedOrdinary(); await mount(); await open();
  const create = await startAction('创建多人房间', 'create'); const authority = await confirmMembership(create, 'host');
  await publishOnline(authority); const before = ordinarySnapshot();
  const realSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === ADVANCED_ARENA_DRAFT_KEY) throw new DOMException('synthetic quota full', 'QuotaExceededError');
    return realSet.call(this, key, value);
  });
  await change('#room-host-draft-arena-story-guidance', '保留房主未存引导');
  await vi.waitFor(() => expect(container.querySelector('[aria-label="本机草稿提示"]')?.textContent).toContain('页面草稿保存失败'));
  const notice = container.querySelector('[aria-label="本机草稿提示"]')!;
  expect(notice.closest('[hidden]')).toBeNull();
  expect(requiredButton('重试保存草稿', notice).disabled).toBe(true);
  expect(requiredButton('清除草稿', notice).disabled).toBe(true);
  expect(requiredButton('下载会话备份', notice).disabled).toBe(false);
  vi.mocked(window.confirm).mockClear();
  await click('清除草稿', notice); await click('重试保存草稿', notice);
  expect(window.confirm).not.toHaveBeenCalled(); expect(ordinarySnapshot()).toEqual(before);
  expect(container.querySelector('[aria-label="战报结果"]')?.textContent).toContain(reportText);
  expect((container.querySelector('#room-host-draft-arena-story-guidance') as HTMLInputElement).value).toBe('保留房主未存引导');
  assertConstrained();
});
