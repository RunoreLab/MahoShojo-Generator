import { DesktopRoomPresetConfigSchema } from '@mahoshojo/contracts/desktop-room-session';
import type { DesktopHostedPresetConfig } from '@mahoshojo/contracts/desktop-cloud';
import { evaluateArenaGenerationReadiness, matchArenaRoomVisibleStartBundle, type ArenaRoomHostWorkspaceBundle, isArenaRoomGenerationCancelTargetCurrent, type ArenaRoomGenerationCancelTarget } from '@mahoshojo/multiplayer-core';
import { createArenaMemberProposalModel, type ArenaMemberProposalModel } from '@mahoshojo/multiplayer-core/member-proposal';
import { observeArenaRoomConfigPublish, validateProposalChanges, type ArenaRoomConfigPublishTarget, type ArenaRoomConfigPublishObservation, type ArenaRoomProposalReconciliationObservation } from '@mahoshojo/multiplayer-core';
import { ArenaProposalSchema, ArenaRoomProposalResolveRequestSchema, ArenaRoomProposalSubmitRequestSchema, ArenaRoomPublishConfigRequestSchema, ArenaRoomSessionResponseSchema, jsonUtf8ByteLength, type ArenaProposal, type ArenaRoomProposalResolveRequest, type ArenaRoomProposalSubmitRequest, type ArenaRoomCreateRequest, type ArenaRoomSessionResponse, type ArenaRoomSharedConfig, type RoomDirectoryEntry, type RoomDirectoryVisibility, type RoomPresenceSnapshot, type RoomServerTransportMessage } from '@mahoshojo/contracts/arena-room';
import { DesktopRoomSessionRoomIdSchema, isDesktopRoomStartWithinNodeBudget } from '@mahoshojo/contracts/desktop-room-session';
import { DesktopRoomStartCapacityError, DesktopRoomStartComplexityError } from './room-source';
import { DesktopRoomActionSchema, DESKTOP_ROOM_IPC_LIMITS, getDesktopRoomHttpOperation, type DesktopRoomGenerationStartFence, type DesktopRoomMutationOperation, type DesktopRoomBatch, type DesktopRoomHttpAction, type DesktopRoomHttpOperation } from '@mahoshojo/contracts/desktop-room-ipc';
import { ArenaRoomBridgeError, createArenaRoomBridge, type ArenaRoomAcceptance, type ArenaRoomChannel } from '../../platform/arena-room-bridge';
import type { InvokeFn } from '../../platform/cloud-bridge';
import type { DesktopCloudSessionStore } from '../account/cloud-session-store';
import { GenerationStoryBuffer } from '@mahoshojo/multiplayer-core/generation-story-buffer';
import type { RoomGenerationView } from '@mahoshojo/ui-web/arena-room';
import type { ArenaRoomGenerationStartRequest, ArenaRoomGenerationViewResponse, StoryDeltaEvent } from '@mahoshojo/contracts/arena-room';
import type { DesktopGenerationIdentity } from '../../platform/arena-room-generation-reader';

export type DesktopRoomGenerationView = RoomGenerationView & { readonly result: ArenaRoomGenerationViewResponse['result'] | null };
const emptyGeneration = (): DesktopRoomGenerationView => ({ phase: 'idle', markdown: '', gap: null, finalAuthoritative: false, generationRecordId: null, errorCode: null, recoveryCode: null, result: null });
const generationKey = (identity: DesktopGenerationIdentity) => JSON.stringify([identity.roomId, identity.roomEpoch, identity.generationId, identity.attempt]);
const terminalGeneration = (state: string) => ['completed', 'failed', 'cancelled', 'producer_lost'].includes(state);
type GenerationFlight = { owner: Owner; key: string; rerun: boolean; promise: Promise<void>; cancelReceipt?: { intentId: string; current: boolean } };

export type RoomUnknownIntent = { operation: DesktopRoomMutationOperation; roomId: string | null; intentId: string | null; generationTarget?: { roomEpoch: string; generationId: string; attempt: number }; generationStart?: { roomEpoch: string; generationRequestId: string; retryable: boolean; presetConfig?: DesktopHostedPresetConfig }; cancelMode?: 'starting-v1'; startIntentId?: string };
export type DesktopConfigTracking = { id: string; roomId: string; phase: 'publishing' | 'unknown' | 'ended-needs-read'; target: ArenaRoomConfigPublishTarget | null; observation: ArenaRoomConfigPublishObservation };
type ProposalAction = Extract<DesktopRoomHttpAction, { kind: 'proposal-submit' | 'proposal-withdraw' | 'proposal-resolve' }>;
export type DesktopProposalTracking = { id: string | null; roomId: string; proposalId: string | null; operation: 'proposalSubmit' | 'proposalWithdraw' | 'proposalResolve'; phase: 'resolving' | 'unknown' | 'settled' | 'ended-needs-read'; observation: ArenaRoomProposalReconciliationObservation | null; intent?: ProposalAction | null };
export interface DesktopRoomState {
  opened: boolean; busy: boolean; constrained: boolean;
  phase: 'detached' | 'attaching' | 'ready' | 'connecting' | 'online' | 'offline' | 'reconnecting' | 'closed' | 'unavailable';
  session: ArenaRoomSessionResponse | null; presence: RoomPresenceSnapshot | null; snapshotReceived: boolean;
  rooms: readonly RoomDirectoryEntry[]; nextCursor: string | null;
  configTracking: DesktopConfigTracking | null; proposalTracking: DesktopProposalTracking | null;
  memberModel: ArenaMemberProposalModel | null;
  generation: DesktopRoomGenerationView; generationReading: boolean;
  generationStartBlocked: boolean; generationStartFence: DesktopRoomGenerationStartFence | null;
  unknown: RoomUnknownIntent | null; error: string | null; notice: string | null;
  sourceIssues: readonly string[];
}
const initial = (): DesktopRoomState => ({ opened: false, busy: false, constrained: false, phase: 'detached', session: null, presence: null, snapshotReceived: false, rooms: [], nextCursor: null, unknown: null, error: null, notice: null, sourceIssues: [], configTracking: null, proposalTracking: null, memberModel: null, generation: emptyGeneration(), generationReading: false, generationStartBlocked: false, generationStartFence: null });
const staleView: DesktopRoomState = { ...initial(), error: '账号或页面身份已变化，请重新打开多人房间。' };
export interface DesktopRoomDeps {
  invoke: InvokeFn;
  account: Pick<DesktopCloudSessionStore, 'getSnapshot' | 'getCredentialEpoch' | 'subscribe'>;
  documentNonce: () => string | undefined;
  canStart?: () => boolean;
  createChannel?: () => ArenaRoomChannel;
  randomId?: () => string;
}
export type DesktopRoomSource = { ok: true; sharedConfig: ArenaRoomSharedConfig } | { ok: false; issues: readonly string[] };
type Owner = { userId: number; epoch: number; nonce: string; token: symbol };
type Flight = { newStart?: boolean; startingCancelTarget?: DesktopGenerationIdentity; action: DesktopRoomHttpAction; operation: DesktopRoomHttpOperation; requestId: string | null; accepted: boolean; acknowledged: boolean; result: 'success' | 'error' | null; subscribe: boolean; settlesUnknown: boolean; knownNotApplied: boolean };
// Remounts share the explicit intent counter within this actual Document. Reload
// receives a different immutable nonce; no handle or credential is persisted.
let lastDocument: string | undefined; let attachIntent = 0;
const nextAttachIntent = (nonce: string): number => { if (lastDocument !== nonce) { lastDocument = nonce; attachIntent = 0; } if (attachIntent >= Number.MAX_SAFE_INTEGER) throw new Error('attach intent exhausted'); return ++attachIntent; };
export const readDesktopRoomDocumentNonce = (): string | undefined => {
  const value: unknown = Reflect.get(window, '__MAHOSHOJO_ROOM_DOCUMENT_V1__');
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value) ? value : undefined;
};
const isProposalOperation = (operation: string | undefined): operation is DesktopProposalTracking['operation'] => operation === 'proposalSubmit' || operation === 'proposalWithdraw' || operation === 'proposalResolve';
const blocksProposalTracking = (tracking: DesktopProposalTracking | null) => !!tracking && tracking.phase !== 'settled';
const unavailableProposalObservation = (): ArenaRoomProposalReconciliationObservation => ({ observation: 'target-unavailable', linked: false, settle: false, outcome: null, terminalStatus: null });
const sameProposalIdentity = (left: ArenaProposal, right: ArenaProposal): boolean => {
  const a = ArenaProposalSchema.safeParse(left), b = ArenaProposalSchema.safeParse(right);
  return a.success && b.success && a.data.proposalVersion === b.data.proposalVersion
    && a.data.proposalId === b.data.proposalId && a.data.roomId === b.data.roomId
    && a.data.authorUserId === b.data.authorUserId && a.data.baseRevision === b.data.baseRevision
    && JSON.stringify(a.data.changes) === JSON.stringify(b.data.changes);
};
const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const freezeIntent = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeIntent); Object.freeze(value); }
  return value;
};
const requiresTrackedObservation = (operation: string | undefined) => operation === 'generationStart' || operation === 'generationCancel' || operation === 'config' || isProposalOperation(operation);
const isMutation = (action: DesktopRoomHttpAction) => action.kind !== 'discover' && action.kind !== 'session' && action.kind !== 'generation-read';
const unknownFor = (action: DesktopRoomHttpAction): RoomUnknownIntent | null => {
  if (action.kind === 'generation-cancel') return { operation: 'generationCancel', roomId: action.roomId, intentId: null, generationTarget: { roomEpoch: action.expectedRoomEpoch, generationId: action.generationId, attempt: action.expectedAttempt } };
  if (action.kind === 'create' || action.kind === 'resume-create') return { operation: 'create', roomId: null, intentId: action.kind === 'resume-create' ? action.intentId : null };
  if (action.kind === 'join' || action.kind === 'leave' || action.kind === 'close' || action.kind === 'config') return { operation: action.kind, roomId: action.roomId, intentId: null };
  if (action.kind === 'proposal-submit' || action.kind === 'proposal-withdraw' || action.kind === 'proposal-resolve') return { operation: getDesktopRoomHttpOperation(action) as DesktopRoomMutationOperation, roomId: action.roomId, intentId: null };
  return null;
};
export const describeDesktopRoomError = (error: ArenaRoomBridgeError): string => {
  if (error.code === 'input-too-large') return '本机材料超过 12 MiB 来源上限，请减少材料后重试。普通草稿不会被截断。';
  if (error.code === 'input-too-complex') return '本机材料结构过于复杂，请减少嵌套或条目后重试。材料不会被截断。';
  if (error.code === 'not-authenticated') return '当前房间登录已失效，请重新验证账号后打开房间。';
  if (error.code === 'storage-unavailable') return '本机凭据信息暂不可读取。请恢复后按当前状态明确核对或重试；未确认的操作仍可能已发生。';
  if (error.code === 'backpressure') return '房间消费容量已用尽。请保留未确认操作，不要据此重新发送；已有生成请只读核对或明确停止本机跟踪。关闭应用不代表服务器操作未发生；刷新页面也不会清除未确认的投递。';
  if (error.code === 'busy') return '上一项房间操作尚未结束，请稍后明确重试。';
  if (error.code === 'scope-changed') return '房间、账号或页面已变化，旧操作不再应用。';
  if (error.serverCode === 'ROOM_DESKTOP_OPERATION_UNSUPPORTED') return '服务器不支持此桌面操作，请更新服务端后再明确重试。';
  if (error.serverCode === 'ROOM_NOT_FOUND') return '房间已结束或当前不可找到。';
  if (error.serverCode === 'ROOM_FORBIDDEN') return '当前账号不再具有此房间的访问资格。';
  if (error.code === 'presence-unsupported' || error.code === 'invalid-response') return '服务器尚未支持受检房间协议，或回执无法验证。';
  return '多人房间操作未完成，请按当前状态明确核对或重试。';
};

/** Page-owned read model for the fixed Native session transport. No networking,
 * automatic mutation retry or persistent provider configuration. */
export class DesktopArenaRoomSession {
  private state = initial(); private readonly listeners = new Set<() => void>();
  private owner: Owner | null = null; private flight: Flight | null = null;
  private authorityVersion = 0;
  private configSequence = 0;
  private memberAuthority: ArenaRoomSessionResponse | null = null;
  private proposalRecoveryIntent: string | null = null;
  private generationIdentity: string | null = null;
  private startSettledIntent: string | null = null;
  private cancelTerminalKey: string | null = null;
  private startingCancelSettledIntent: string | null = null;
  private generationFlight: GenerationFlight | null = null;
  private generationStories = new GenerationStoryBuffer();
  private generationNextChunkSeq = 0;
  private generationBaseline = false;
  private generationTerminal = false;
  private generationTerminalPhase: RoomGenerationView['phase'] | null = null;
  private generationStableFailure = false;
  private generationGapRequested = false;
  private disposed = false; private unsubscribe: (() => void) | null = null;
  private readonly bridge: ReturnType<typeof createArenaRoomBridge>;
  constructor(private readonly deps: DesktopRoomDeps) {
    this.bridge = createArenaRoomBridge(deps.invoke, { createChannel: deps.createChannel, getDocumentNonce: deps.documentNonce,
      isCurrent: () => this.current(), acceptBatch: (batch, context) => this.accept(batch, context),
      onAcknowledged: (batch, context) => this.acknowledged(batch, context), onError: error => this.failed(error, true) });
  }
  activate = () => { this.disposed = false; this.unsubscribe ??= this.deps.account.subscribe(() => { if (this.owner && !this.current()) this.invalidate(); }); };
  getSnapshot = (): DesktopRoomState => this.owner && !this.current() ? staleView : this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<DesktopRoomState>, retainMemberDraft = false) {
    const previousAuthority = this.state;
    const previousModel = this.state.memberModel;
    const wasFresh = this.state.phase === 'online' && this.state.snapshotReceived;
    this.state = { ...this.state, ...patch };
    if ('session' in patch) this.syncGenerationIdentity();
    const tracking = this.state.configTracking;
    if ('session' in patch && tracking?.phase === 'unknown') this.state = { ...this.state,
      configTracking: { ...tracking, observation: observeArenaRoomConfigPublish(tracking.target, this.state.session, true) } };
    if ('session' in patch || 'memberModel' in patch) {
      const session = this.state.session;
      if (previousModel && previousModel !== this.state.memberModel) previousModel.dispose();
      if ((!session && !retainMemberDraft) || (session && (session.self.role !== 'member' || session.self.membershipState !== 'active')) || !this.current()) {
        this.state.memberModel?.dispose();
        this.state = { ...this.state, memberModel: null }; this.memberAuthority = null;
      } else if (session && this.state.memberModel) {
        try { this.state.memberModel.sync(session.snapshot); this.memberAuthority = session; }
        catch { this.state = { ...this.state, snapshotReceived: false, phase: 'offline', error: '房间权威配置不一致，请重新读取后再同步。' }; }
      } else if (session) { this.state = { ...this.state, memberModel: createArenaMemberProposalModel(session.snapshot) }; this.memberAuthority = session; }
    }
    if (this.state.memberModel && !this.state.session) this.state = { ...this.state, constrained: true };
    // Losing trusted freshness permanently expires confirmation and in-flight source
    // generations, even when the same authority returns. Keep the detached draft.
    // Check the final state so a failed model.sync is covered as well as transport loss.
    if (wasFresh && (this.state.phase !== 'online' || !this.state.snapshotReceived)) this.state.memberModel?.invalidatePreview();
    if (previousAuthority.session !== this.state.session || previousAuthority.presence !== this.state.presence
      || previousAuthority.phase !== this.state.phase || previousAuthority.snapshotReceived !== this.state.snapshotReceived) this.authorityVersion += 1;
    this.listeners.forEach(listener => listener());
  }
  private current(owner = this.owner): boolean {
    if (!owner || owner !== this.owner || this.disposed) return false;
    try { const account = this.deps.account.getSnapshot();
    return account.account?.userId === owner.userId && this.deps.account.getCredentialEpoch() === owner.epoch
      && account.verification === 'verified' && account.authFlow.kind === 'idle' && this.deps.documentNonce() === owner.nonce; } catch { return false; }
  }
  private currentGeneration(): DesktopGenerationIdentity | null {
    const session = this.state.session, active = session?.snapshot.activeGeneration;
    return session && active && session.self.membershipState === 'active' ? { roomId: session.roomId,
      roomEpoch: session.roomEpoch, generationId: active.generationId, attempt: active.attempt } : null;
  }
  private syncGenerationIdentity(): void {
    const identity = this.currentGeneration(), key = identity && generationKey(identity);
    if (key !== this.generationIdentity) {
      this.generationIdentity = key; this.generationStories = new GenerationStoryBuffer();
      this.generationNextChunkSeq = 0; this.generationBaseline = false; this.generationTerminal = false; this.generationTerminalPhase = null;
      this.generationStableFailure = false; this.generationGapRequested = false;
      this.state = { ...this.state, generation: emptyGeneration(), generationReading: false };
      if (this.generationFlight && key) this.generationFlight.rerun = true;
    }
    const mirror = this.state.session?.snapshot.activeGeneration;
    if (!mirror || !key) return;
    if (terminalGeneration(mirror.state)) { this.generationTerminal = true; this.generationTerminalPhase = mirror.state; }
    if (!this.state.generation.finalAuthoritative && ((!this.generationBaseline && !this.generationTerminal) || terminalGeneration(mirror.state))) {
      this.state = { ...this.state, generation: { ...this.state.generation, phase: mirror.state } };
    }
  }
  private generationCurrent(owner: Owner, key: string): boolean {
    return this.current(owner) && this.generationIdentity === key && this.currentGeneration() !== null;
  }
  private pendingStartIdentity(): DesktopGenerationIdentity | null {
    const pending = this.state.unknown, session = this.state.session, mirror = session?.snapshot.activeGeneration;
    return pending?.operation === 'generationStart' && pending.generationStart && session && mirror
      && pending.roomId === session.roomId && pending.generationStart.roomEpoch === session.roomEpoch
      && pending.generationStart.generationRequestId === mirror.generationRequestId ? this.currentGeneration() : null;
  }
  private pendingCancelIdentity(): DesktopGenerationIdentity | null {
    const pending = this.state.unknown;
    return pending?.operation === 'generationCancel' && pending.roomId && pending.generationTarget
      ? { roomId: pending.roomId, ...pending.generationTarget } : null;
  }
  private settleCancel(identity: DesktopGenerationIdentity, status: string, receipt: ArenaRoomAcceptance['generationCancel']): void {
    const target = this.pendingCancelIdentity();
    if (!receipt?.current || (this.state.unknown?.intentId !== null ? this.state.unknown?.intentId !== receipt.intentId : this.flight?.operation !== 'generationCancel') || !target || generationKey(target) !== generationKey(identity) || !terminalGeneration(status)) return;
    this.cancelTerminalKey = generationKey(target);
    if (this.flight?.operation === 'generationCancel') this.flight.settlesUnknown = true;
    this.publish({ unknown: null, notice: '已核对原生成已结束；这不证明由停止请求造成。完整战报仍由读取确认。' });
  }
  startGenerationBlockedReason = (): string | null => {
    const state = this.state, session = state.session;
    if (state.generationStartBlocked) return '本窗口仍保留未确认生成的防重复记录，暂不能开始新生成；只读、退出和其它房间操作仍可用。';
    if (!this.current() || state.phase !== 'online' || !state.snapshotReceived) return '等待当前连接的完整房间快照。';
    if (state.busy || this.flight || state.generationReading || state.unknown || state.configTracking || blocksProposalTracking(state.proposalTracking)
      || this.deps.canStart?.() === false) return '上一项操作尚未结束，请先核对。';
    if (!session || session.self.role !== 'host' || session.self.membershipState !== 'active') return '只有当前房主可以开始生成。';
    if (session.snapshot.activeGeneration && !terminalGeneration(session.snapshot.activeGeneration.state)) return '当前生成尚未结束。';
    const readiness = evaluateArenaGenerationReadiness(session.snapshot.sharedConfig);
    return readiness.ready ? null : readiness.issues.map(issue => issue.userAction).join(' ');
  };
  async endGenerationStartTracking(intentId: string, identity: symbol): Promise<void> {
    const pending = this.state.unknown, owner = this.owner;
    if (this.confirmationOwner() !== identity || this.state.busy || this.state.generationReading
      || !pending || (pending.operation !== 'generationStart' && pending.cancelMode !== 'starting-v1') || pending.intentId !== intentId) return;
    this.flight = null;
    this.publish({ busy: true });
    try {
      const ended = await this.bridge.endGenerationStartTracking(intentId);
      if (!this.current(owner) || this.state.unknown?.intentId !== intentId) return;
      this.publish({ busy: false, unknown: null, session: null, presence: null, snapshotReceived: false,
        generationStartBlocked: ended.generationStartBlocked, generationStartFence: ended.generationStartFence,
        constrained: false, phase: 'ready', error: null });
      await this.open();
      if (this.current()) this.publish({ notice: '已停止本机跟踪并销毁原材料与重试许可。服务器任务不会取消；防重复记录仍保留，可在大厅换房或只读核对原房间。' });
    } catch {
      if (this.current(owner)) this.publish({ busy: false, phase: 'unavailable',
        error: '停止本机跟踪的回执未确认，请重新验证本机状态；不会重新发送生成。' });
    }
  }
  checkGenerationStartFence = () => {
    const fence = this.state.generationStartFence;
    return fence && !this.state.busy && !this.state.unknown && (!this.state.session || this.state.session.roomId === fence.roomId)
      ? this.dispatch({ kind: 'session', roomId: fence.roomId }) : Promise.resolve();
  };
  /** Source preparation and the first large invoke share one bridge-owned admission slot. */
  async startGeneration(session: ArenaRoomSessionResponse, identity: symbol,
    prepare: () => Promise<{ bundle: ArenaRoomHostWorkspaceBundle; generation: ArenaRoomGenerationStartRequest['generation'] }>,
    sourceCurrent: () => boolean, presetConfig?: DesktopHostedPresetConfig): Promise<void> {
    const parsedFunding = presetConfig === undefined ? null : DesktopRoomPresetConfigSchema.safeParse(presetConfig);
    if (parsedFunding && !parsedFunding.success) return;
    const frozenPreset = parsedFunding?.data ? JSON.parse(JSON.stringify(parsedFunding.data)) as DesktopHostedPresetConfig : undefined;
    if (this.confirmationOwner() !== identity || this.state.session !== session || this.startGenerationBlockedReason() || !sourceCurrent()) return;
    const owner = this.owner, generationRequestId = this.deps.randomId?.() ?? crypto.randomUUID();
    const flight: Flight = { newStart: true, action: { kind: 'retry-generation-start', intentId: 'pending-start' }, operation: 'generationStart',
      requestId: null, accepted: false, acknowledged: false, result: null, subscribe: false, settlesUnknown: false, knownNotApplied: false };
    this.flight = flight; this.startSettledIntent = null;
    this.publish({ busy: true, error: null, sourceIssues: [], notice: '正在冻结眼前配置与完整来源。',
      unknown: { operation: 'generationStart', roomId: session.roomId, intentId: null,
        generationStart: { roomEpoch: session.roomEpoch, generationRequestId, retryable: false, ...(frozenPreset ? { presetConfig: frozenPreset } : {}) } } });
    let prepared = false;
    try {
      const accepted = await this.bridge.generationStart(async () => {
        const input = await prepare().catch(cause => {
          if (cause instanceof DesktopRoomStartCapacityError) throw new ArenaRoomBridgeError('input-too-large', 'not-applied');
          if (cause instanceof DesktopRoomStartComplexityError) throw new ArenaRoomBridgeError('input-too-complex', 'not-applied');
          throw cause;
        });
        if (!this.current(owner) || this.state.session !== session || this.state.phase !== 'online' || !this.state.snapshotReceived
          || !sourceCurrent() || this.deps.canStart?.() === false) throw new ArenaRoomBridgeError('scope-changed', 'not-applied');
        const matched = matchArenaRoomVisibleStartBundle(session.snapshot.sharedConfig, input.bundle);
        if (!matched) { this.publish({ error: '眼前设置或本地正文与房间尚未落定一致。请先比较并明确发布当前设置，再重新开始。' }); throw new ArenaRoomBridgeError('invalid-request', 'not-applied'); }
        const request = {
          expectedRoomEpoch: session.roomEpoch, expectedRevision: session.snapshot.revision, expectedControlSeq: session.snapshot.controlSeq,
          generationRequestId, sharedConfig: matched.sharedConfig, hostLocalPayloads: [...matched.hostLocalPayloads], generation: input.generation,
        };
        if (!isDesktopRoomStartWithinNodeBudget(request)) throw new ArenaRoomBridgeError('input-too-complex', 'not-applied');
        prepared = true;
        return { kind: 'generation-start', roomId: session.roomId, request, ...(frozenPreset ? { presetConfig: frozenPreset } : {}) };
      });
      if (!this.current(owner) || this.flight !== flight) return;
      if (flight.requestId && flight.requestId !== accepted.requestId) throw new ArenaRoomBridgeError('invalid-response', 'unknown');
      flight.requestId = accepted.requestId; flight.accepted = true;
      if (this.state.unknown?.operation === 'generationStart' && this.state.unknown.intentId === null) this.publish({ unknown: { ...this.state.unknown, intentId: accepted.requestId } });
      this.finishFlight(flight);
    } catch (cause) {
      if (!this.current(owner) || this.flight !== flight) return;
      const error = cause instanceof ArenaRoomBridgeError ? cause : new ArenaRoomBridgeError(cause instanceof DesktopRoomStartComplexityError ? 'input-too-complex' : 'invalid-request', prepared ? 'unknown' : 'not-applied');
      if (error.outcome === 'not-applied') {
        this.flight = null; this.publish({ busy: false, unknown: null, error: this.state.error ?? describeDesktopRoomError(error) });
      } else this.failed(error);
    }
  }
  retryStartGeneration = (intentId: string, identity: symbol): Promise<void> => {
    const pending = this.state.unknown;
    if (this.confirmationOwner() !== identity || pending?.operation !== 'generationStart' || pending.intentId !== intentId
      || !pending.generationStart?.retryable || this.state.busy || this.state.phase !== 'online' || !this.state.snapshotReceived) return Promise.resolve();
    return this.dispatch({ kind: 'retry-generation-start', intentId });
  };
  startingCancelBlockedReason = (): string | null => {
    const pending = this.state.unknown, session = this.state.session;
    if (!this.current() || this.state.phase !== 'online' || !this.state.snapshotReceived) return '等待当前连接的完整房间快照。';
    if (this.state.busy || this.flight || this.state.generationReading || this.state.configTracking || blocksProposalTracking(this.state.proposalTracking)
      || this.deps.canStart?.() === false) return '等待原网络操作真正结束后，才可放弃重试并尝试停止。';
    if (pending?.operation !== 'generationStart' || !pending.intentId || !this.pendingStartIdentity()
      || session?.snapshot.activeGeneration?.state !== 'starting' || session.self.role !== 'host' || session.self.membershipState !== 'active') {
      return '仅当前房主可对原请求的已确认占位尝试停止；没有匹配占位时请只读核对。';
    }
    return null;
  };
  cancelPendingStart = (intentId: string, target: ArenaRoomGenerationCancelTarget, identity: symbol): Promise<void> => {
    if (this.confirmationOwner() !== identity || this.state.unknown?.intentId !== intentId || this.startingCancelBlockedReason() !== null
      || !isArenaRoomGenerationCancelTargetCurrent(target, this.state.session)) return Promise.resolve();
    return this.dispatch({ kind: 'cancel-generation-start', intentId });
  };
  private settleStart(receipt: ArenaRoomAcceptance['generationStart']): void {
    if (!receipt?.current || (this.state.unknown?.intentId !== null ? this.state.unknown?.intentId !== receipt.intentId : this.flight?.operation !== 'generationStart')) return;
    this.startSettledIntent = receipt.intentId;
    if (this.flight?.operation === 'generationStart') this.flight.settlesUnknown = true;
    this.publish({ unknown: null, notice: '原生成已建立。等待当前房间权威状态后，可继续读取或停止该任务。' });
  }
  cancelGenerationBlockedReason = (): string | null => {
    if (!this.current() || this.state.phase !== 'online' || !this.state.snapshotReceived) return '等待当前连接的完整房间快照。';
    if (this.state.busy || this.flight || this.state.unknown || this.state.configTracking || blocksProposalTracking(this.state.proposalTracking)
      || this.deps.canStart?.() === false) return '上一项操作尚未结束，请先核对。';
    const session = this.state.session, fence = this.state.generationStartFence;
    if (fence?.cancelMode === 'starting-v1' && session?.roomId === fence.roomId
      && session.snapshot.activeGeneration?.generationRequestId === fence.generationRequestId) return '原占位已尝试一次停止；请只读核对，不能再次发送停止请求。';
    if (this.generationTerminal || this.cancelTerminalKey === this.generationIdentity || !session || session.self.role !== 'host' || session.self.membershipState !== 'active'
      || !['starting', 'running'].includes(session.snapshot.activeGeneration?.state ?? '')) return '只有当前房主可以停止正在生成的战报。';
    return null;
  };
  cancelGeneration = (target: ArenaRoomGenerationCancelTarget, identity: symbol): Promise<void> => {
    if (this.confirmationOwner() !== identity || this.cancelGenerationBlockedReason() !== null
      || !isArenaRoomGenerationCancelTargetCurrent(target, this.state.session)) return Promise.resolve();
    return this.dispatch({ kind: 'generation-cancel', roomId: target.roomId, generationId: target.generationId,
      expectedRoomEpoch: target.roomEpoch, expectedAttempt: target.attempt });
  };
  cancelTrackingUnavailable = (): boolean => {
    const target = this.pendingCancelIdentity(), current = this.currentGeneration();
    return !!target && (!current || generationKey(target) !== generationKey(current));
  };
  /** Recovery never dispatches generation start or replays a cancellation. */
  retryGenerationRecovery = (): Promise<void> => this.requestGenerationRecovery('manual');
  private requestGenerationRecovery(reason: 'baseline' | 'reconnect' | 'gap' | 'terminal' | 'manual', rerun = false): Promise<void> {
    const identity = this.currentGeneration(), owner = this.owner;
    if (!owner || !identity || !this.current(owner) || !this.state.snapshotReceived || this.state.phase !== 'online') return Promise.resolve();
    const pendingTarget = this.pendingCancelIdentity() ?? this.pendingStartIdentity();
    if (this.state.unknown && (!pendingTarget || generationKey(pendingTarget) !== generationKey(identity))) return Promise.resolve();
    if (reason === 'manual' && this.state.busy) return Promise.resolve();
    const key = generationKey(identity);
    if (reason !== 'manual' && (this.generationStableFailure || this.state.generation.finalAuthoritative)) return Promise.resolve();
    const flight = this.generationFlight;
    if (flight) {
      // A newer terminal/snapshot/identity needs one reread; duplicate deltas do not
      // turn one pending GET into an unbounded retry queue.
      if (flight.key !== key || reason === 'terminal' || reason === 'reconnect') flight.rerun = true;
      return flight.promise;
    }
    if (reason === 'gap' && this.generationGapRequested && !rerun) return Promise.resolve();
    if (reason === 'manual') { this.generationStableFailure = false; this.generationGapRequested = false; }
    if (reason === 'gap') this.generationGapRequested = true;
    const entry: GenerationFlight = { owner, key, rerun: false, promise: Promise.resolve() };
    this.generationFlight = entry;
    this.publish({ generationReading: true, generation: { ...this.state.generation, phase: 'resyncing', recoveryCode: null } });
    entry.promise = (async () => {
      try {
        const view = await this.bridge.generationRead(identity);
        if (!this.generationCurrent(owner, key)) return;
        if (this.generationTerminal && !terminalGeneration(view.status)) {
          // A running GET begun before terminal control cannot undo that control.
          if (!rerun) entry.rerun = true;
          this.publish({ generation: { ...this.state.generation, phase: this.generationTerminalPhase ?? 'unavailable',
            recoveryCode: 'ROOM_GENERATION_RECOVERY_TRANSIENT' } });
          return;
        }
        const terminal = terminalGeneration(view.status);
        // bridge.generationRead resolves only after its accepted, current final-fragment ACK.
        this.settleCancel(identity, view.status, entry.cancelReceipt);
        const buffered = terminal ? null : this.generationStories.rebase(view.nextChunkSeq);
        this.generationNextChunkSeq = buffered?.nextChunkSeq ?? view.nextChunkSeq;
        this.generationBaseline = true; this.generationTerminal ||= terminal;
        if (terminal || !buffered?.gap) { this.generationStories = new GenerationStoryBuffer(); this.generationGapRequested = false; }
        const phase = view.status === 'reserved' ? 'starting' : view.status === 'finalizing' ? 'running' : view.status === 'producer_lost' ? 'failed' : view.status;
        if (terminal) this.generationTerminalPhase = phase;
        this.publish({ generation: { phase, markdown: view.markdown + (buffered?.markdown ?? ''), gap: buffered?.gap ?? null,
          finalAuthoritative: view.finalAuthoritative, generationRecordId: view.generationRecordId ?? null,
          errorCode: view.errorCode ?? null, recoveryCode: buffered?.gap ? 'ROOM_GENERATION_RECOVERY_TRANSIENT' : null, result: view.result ?? null } });
        if (buffered?.gap && !rerun) entry.rerun = true;
      } catch (cause) {
        if (!this.generationCurrent(owner, key)) return;
        const error = cause instanceof ArenaRoomBridgeError ? cause : new ArenaRoomBridgeError('internal-error');
        if (error.code === 'scope-changed') {
          this.publish({ generation: { ...this.state.generation, phase: 'unavailable', recoveryCode: 'ROOM_GENERATION_RECOVERY_TRANSIENT' } });
          return;
        }
        const stable = ['invalid-response', 'invalid-request', 'response-too-large'].includes(error.code)
          || ['ROOM_DESKTOP_RESPONSE_INVALID', 'ROOM_DESKTOP_RESPONSE_TOO_LARGE', 'ROOM_DESKTOP_PROTOCOL_INVALID', 'ROOM_DESKTOP_OPERATION_UNSUPPORTED'].includes(error.serverCode ?? '');
        const gone = ['ROOM_GENERATION_NOT_FOUND', 'ROOM_NOT_FOUND', 'ROOM_FORBIDDEN'].includes(error.serverCode ?? '');
        this.generationStableFailure = stable || gone;
        this.publish({ generation: { ...this.state.generation,
          phase: this.generationTerminalPhase ?? 'unavailable',
          recoveryCode: gone ? 'ROOM_GENERATION_RECOVERY_NOT_FOUND' : stable ? 'ROOM_GENERATION_RECOVERY_PROTOCOL' : 'ROOM_GENERATION_RECOVERY_TRANSIENT' } });
      } finally {
        if (this.generationFlight === entry) {
          this.generationFlight = null;
          if (this.current(owner)) this.publish({ generationReading: false });
          if (entry.rerun && this.current(owner) && !this.generationStableFailure) {
            // One coalesced trailing read; a still-stale response stops until a new
            // meaningful event or explicit retry rather than creating a storm.
            await this.requestGenerationRecovery('baseline', true);
          }
        }
      }
    })();
    return entry.promise;
  }
  private applyStoryDelta(event: StoryDeltaEvent): void {
    const identity = this.currentGeneration();
    // The wire allocates an attempt-unique generationId for story frames.
    if (!identity || !this.state.snapshotReceived || this.state.phase !== 'online' || this.generationTerminal || event.generationId !== identity.generationId) return;
    if (!this.generationBaseline || this.generationFlight || this.state.generation.gap) {
      this.generationStories.add(event);
      // Rebase only against a GET cursor. A partially previewed suffix must stay
      // retained if the next authoritative response still predates that suffix.
      return;
    }
    if (event.chunkSeq < this.generationNextChunkSeq) return;
    if (event.chunkSeq > this.generationNextChunkSeq) {
      this.generationStories.add(event);
      this.publish({ generation: { ...this.state.generation, gap: { expectedChunkSeq: this.generationNextChunkSeq, receivedChunkSeq: event.chunkSeq } } });
      return;
    }
    this.generationNextChunkSeq += 1;
    this.publish({ generation: { ...this.state.generation, markdown: this.state.generation.markdown + event.payload.delta } });
  }
  private invalidate() { this.state.memberModel?.dispose(); this.memberAuthority = null; this.proposalRecoveryIntent = null; this.cancelTerminalKey = null; this.owner = null; this.flight = null; this.bridge.detach(); this.state = { ...staleView }; this.syncGenerationIdentity(); this.listeners.forEach(listener => listener()); }
  detach = () => { this.proposalRecoveryIntent = null; this.cancelTerminalKey = null; this.owner = null; this.flight = null; this.bridge.detach(); this.publish({ ...initial(), notice: '已断开本机连接；这不表示已离开房间或停止服务器任务。' }); };
  dispose = () => { this.detach(); this.disposed = true; this.unsubscribe?.(); this.unsubscribe = null; };
  /** Last verified projection is for retained read-only draft presentation, never write authority. */
  memberWorkspaceSession = (): ArenaRoomSessionResponse | null => this.current() && this.state.memberModel ? this.memberAuthority : null;
  confirmationOwner = (): symbol | null => this.current() ? this.owner!.token : null;
  isBusy = () => this.current() && this.state.busy;
  isConstrained = () => this.current() && this.state.constrained;
  /** Local host edits never change authority until an explicit compare/publish. */
  canEditHostDraft = () => this.current() && this.state.phase === 'online' && this.state.snapshotReceived
    && this.state.session?.self.role === 'host' && this.state.session.self.membershipState === 'active'
    && !this.state.busy && !this.state.unknown && !this.state.configTracking && !blocksProposalTracking(this.state.proposalTracking)
    && (!this.state.session.snapshot.activeGeneration || terminalGeneration(this.state.session.snapshot.activeGeneration.state));
  needsLeaveConfirmation = () => this.current() && (this.state.busy || this.state.memberModel !== null || this.state.session !== null || this.state.unknown !== null || this.state.configTracking !== null || blocksProposalTracking(this.state.proposalTracking));
  async open(): Promise<symbol | null> {
    if (this.disposed) return null;
    if (this.owner && !this.current()) this.invalidate();
    this.activate();
    if (this.disposed || this.state.busy || this.deps.canStart?.() === false) return null;
    const account = this.deps.account.getSnapshot(); let nonce: string | undefined; try { nonce = this.deps.documentNonce(); } catch { nonce = undefined; }
    if (!account.account || account.verification !== 'verified' || account.authFlow.kind !== 'idle') { this.publish({ opened: true, error: '请先验证并登录账号，再打开多人房间。' }); return null; }
    if (!nonce) { this.publish({ opened: true, error: '当前窗口无法验证房间页面身份，请重新打开应用窗口。' }); return null; }
    const previousTracking = this.current() ? this.state.configTracking : null;
    const previousProposalTracking = this.current() ? this.state.proposalTracking : null;
    const previousSession = this.current() ? this.state.session : null;
    const previousEditor = this.current() ? this.state.memberModel?.store.getState().editor : null;
    const previousMemberAuthority = this.current() ? this.memberAuthority : null;
    const previousUnknown = this.current() ? this.state.unknown : null;
    const owner = { userId: account.account.userId, epoch: this.deps.account.getCredentialEpoch(), nonce, token: Symbol() };
    // Same-account/document recovery retains values, never old callbacks or preview capabilities.
    let memberModel: ArenaMemberProposalModel | null = null;
    if (previousEditor && previousMemberAuthority?.self.role === 'member' && previousMemberAuthority.self.membershipState === 'active') {
      memberModel = createArenaMemberProposalModel({ roomId: previousEditor.roomId, roomEpoch: previousEditor.baselineEpoch,
        revision: previousEditor.baselineRevision, sharedConfig: previousEditor.baselineConfig });
      if (previousEditor.dirty) memberModel.update(() => structuredClone(previousEditor.workingConfig));
      memberModel.sync(previousMemberAuthority.snapshot);
    }
    this.owner = owner; this.flight = null; this.cancelTerminalKey = null; this.proposalRecoveryIntent = null;
    this.generationFlight = null; this.generationIdentity = null;
    this.publish({ ...initial(), opened: true, busy: true, phase: 'attaching', session: previousSession, memberModel, constrained: !!previousSession,
      ...(blocksProposalTracking(previousProposalTracking) ? { unknown: previousUnknown, constrained: true,
        proposalTracking: { ...previousProposalTracking!, proposalId: null, observation: unavailableProposalObservation() } } : {}) }, !!memberModel);
    try {
      const attached = await this.bridge.attach({ documentNonce: nonce, attachIntent: nextAttachIntent(nonce), expectedUserId: owner.userId });
      if (!this.current(owner)) return null;
      const unknown = attached.pendingIntent;
      const configTracking: DesktopConfigTracking | null = unknown?.operation === 'config' && unknown.roomId
        ? { id: unknown.intentId, roomId: unknown.roomId, phase: 'unknown', target: null, observation: 'target-unavailable' }
        : previousTracking?.phase === 'ended-needs-read' ? previousTracking : null;
      const proposalTracking: DesktopProposalTracking | null = unknown?.roomId && isProposalOperation(unknown.operation)
        ? { id: unknown.intentId, roomId: unknown.roomId, proposalId: previousProposalTracking?.id === unknown.intentId ? previousProposalTracking.proposalId : null, operation: unknown.operation, phase: 'unknown', observation: unavailableProposalObservation(),
          intent: previousProposalTracking?.id === unknown.intentId && previousProposalTracking.roomId === unknown.roomId && previousProposalTracking.operation === unknown.operation ? previousProposalTracking.intent : null }
        : !unknown && previousProposalTracking && previousProposalTracking.phase !== 'settled'
          ? { ...previousProposalTracking, phase: 'ended-needs-read', proposalId: null, observation: null } : null;
      this.publish({ busy: false, phase: previousSession ? 'offline' : 'ready', session: previousSession, memberModel, unknown, configTracking, proposalTracking,
        generationStartBlocked: attached.generationStartBlocked, generationStartFence: attached.generationStartFence,
        constrained: !!unknown || !!previousSession || !!configTracking || blocksProposalTracking(proposalTracking), notice: unknown ? '发现本机尚未确认的原操作，请明确核对；不会自动重发。' : null }, !!memberModel);
      return owner.token;
    } catch (cause) { if (this.current(owner)) this.failed(cause instanceof ArenaRoomBridgeError ? cause : new ArenaRoomBridgeError('internal-error')); }
    return null;
  }
  async create(details: { title: string; visibility: RoomDirectoryVisibility; displayName: string }, prepare: () => Promise<DesktopRoomSource>, sourceCurrent: () => boolean): Promise<void> {
    if (!this.current() || this.state.busy || this.state.session || this.state.memberModel || this.state.unknown || this.state.configTracking || blocksProposalTracking(this.state.proposalTracking) || this.deps.canStart?.() === false) return;
    const owner = this.owner; this.publish({ busy: true, constrained: true, error: null, sourceIssues: [] });
    try {
      const source = await prepare();
      if (!this.current(owner)) return;
      if (!sourceCurrent() || this.deps.canStart?.() === false) { this.publish({ busy: false, constrained: false, error: '本机草稿或其他操作已变化，请重新确认创建。' }); return; }
      if (!source.ok) { this.publish({ busy: false, constrained: false, sourceIssues: source.issues, error: '当前设定不能完整共享。可重新选择来源，或明确选择创建空草稿房间；原草稿不会清除。' }); return; }
      const request: ArenaRoomCreateRequest = { creationRequestId: this.deps.randomId?.() ?? crypto.randomUUID(), displayName: details.displayName, directory: { title: details.title, visibility: details.visibility }, sharedConfig: source.sharedConfig };
      this.publish({ busy: false }); await this.dispatch({ kind: 'create', request });
    } catch { if (this.current(owner)) this.publish({ busy: false, constrained: false, error: '读取当前可共享设定失败，原草稿仍保留。' }); }
  }
  async publishConfig(session: ArenaRoomSessionResponse, sharedConfig: ArenaRoomSharedConfig, identity: symbol, sourceCurrent: () => boolean): Promise<void> {
    if (!this.current() || this.confirmationOwner() !== identity || this.state.session !== session || this.state.busy
      || this.state.unknown || this.state.configTracking || blocksProposalTracking(this.state.proposalTracking) || this.deps.canStart?.() === false || !sourceCurrent()
      || session.self.role !== 'host' || session.self.membershipState !== 'active') return;
    const request = ArenaRoomPublishConfigRequestSchema.safeParse({ expectedRoomEpoch: session.roomEpoch,
      expectedRevision: session.snapshot.revision, expectedControlSeq: session.snapshot.controlSeq, sharedConfig });
    if (!request.success) { this.publish({ error: '当前设置不能完整共享，请重新比较。' }); return; }
    const target: ArenaRoomConfigPublishTarget = { roomId: session.roomId, selfUserId: session.self.userId, request: structuredClone(request.data) };
    this.publish({ configTracking: { id: `local-config-${++this.configSequence}`, roomId: session.roomId, phase: 'publishing', target, observation: 'unobserved' } });
    await this.dispatch({ kind: 'config', roomId: session.roomId, request: target.request });
  }
  /** Snapshot freshness gates actions, never the retained detached draft itself. */
  memberProposalBlockedReason = (): string | null => {
    const state = this.getSnapshot(), session = state.session;
    if (!this.current() || !session || session.self.role !== 'member' || session.self.membershipState !== 'active') return '当前没有可写的成员资格，此处是本页保留的只读草稿，不代表最新房间权威状态；可明确断开本机连接并丢弃草稿，恢复普通 Arena。';
    if (!DesktopRoomSessionRoomIdSchema.safeParse(session.roomId).success) return '此房间标识不支持桌面安全寻址，仅可查看。';
    if (state.busy || this.flight || state.unknown || state.configTracking || blocksProposalTracking(state.proposalTracking)) return '上一项房间操作尚未结束，请先核对当前状态。';
    if (state.phase !== 'online' || !state.snapshotReceived) return '等待当前连接的完整房间快照；提案草稿仍保留。';
    if (this.deps.canStart?.() === false) return '其他本机操作尚未结束，提案草稿仍保留。';
    return null;
  };
  private memberScope(session: ArenaRoomSessionResponse, identity: symbol): boolean {
    const current = this.state.session;
    return this.confirmationOwner() === identity && this.memberProposalBlockedReason() === null && !!current
      && current.roomId === session.roomId && current.roomEpoch === session.roomEpoch && current.self.userId === session.self.userId
      && session.self.role === 'member' && session.self.membershipState === 'active';
  }
  syncMemberProposal(session: ArenaRoomSessionResponse, identity: symbol): void {
    if (!this.memberScope(session, identity) || this.state.session !== session) return;
    this.state.memberModel?.replace(session.snapshot);
  }
  async submitProposal(session: ArenaRoomSessionResponse, intent: ArenaRoomProposalSubmitRequest, identity: symbol): Promise<void> {
    if (!this.memberScope(session, identity)) return;
    const current = this.state.session!;
    const parsed = ArenaRoomProposalSubmitRequestSchema.safeParse(intent);
    if (!parsed.success || canonicalJson(parsed.data) !== canonicalJson(intent)
      || intent.expectedRoomEpoch !== current.roomEpoch || intent.baseRevision > current.snapshot.revision
      || !validateProposalChanges(intent.changes, intent.changes.map(change => change.changeId)).valid) {
      this.publish({ error: '提案意图无效或房间实例已变化，请重新预览。' }); return;
    }
    // baseRevision is diagnostic; expectedBase within each frozen change drives ordinary merges.
    const action: ProposalAction = freezeIntent({ kind: 'proposal-submit', roomId: current.roomId, request: structuredClone(intent) });
    if (!DesktopRoomActionSchema.safeParse(action).success) { this.publish({ error: '此房间或提案标识不支持桌面写入，仍可只读查看。' }); return; }
    if (current.snapshot.proposals.some(proposal => proposal.proposalId === intent.proposalId)) { this.publish({ error: '此提案标识已存在，请先核对原提案。' }); return; }
    this.publish({ proposalTracking: { id: null, roomId: current.roomId, proposalId: intent.proposalId, operation: 'proposalSubmit', phase: 'resolving', observation: null, intent: action } });
    await this.dispatch(action);
  }
  async withdrawProposal(session: ArenaRoomSessionResponse, proposalId: string, identity: symbol): Promise<void> {
    if (!this.memberScope(session, identity)) return;
    const current = this.state.session!;
    const proposal = current.snapshot.proposals.find(item => item.proposalId === proposalId);
    const reviewed = session.snapshot.proposals.find(item => item.proposalId === proposalId);
    if (!proposal || !reviewed || proposal.status !== 'submitted' || reviewed.status !== 'submitted'
      || proposal.authorUserId !== current.self.userId || !sameProposalIdentity(proposal, reviewed)) return;
    const action: ProposalAction = freezeIntent({ kind: 'proposal-withdraw', roomId: current.roomId, proposalId, request: { expectedRoomEpoch: current.roomEpoch } });
    if (!DesktopRoomActionSchema.safeParse(action).success) { this.publish({ error: '此提案标识不支持桌面安全寻址，仅可查看。' }); return; }
    this.publish({ proposalTracking: { id: null, roomId: current.roomId, proposalId, operation: 'proposalWithdraw', phase: 'resolving', observation: null, intent: action } });
    await this.dispatch(action);
  }
  async resolveProposal(session: ArenaRoomSessionResponse, proposal: ArenaProposal, request: ArenaRoomProposalResolveRequest, identity: symbol): Promise<void> {
    const current = this.state.session;
    if (!this.current() || this.confirmationOwner() !== identity || !current || this.state.busy || this.flight
      || this.state.phase !== 'online' || !this.state.snapshotReceived
      || this.state.unknown || this.state.configTracking || blocksProposalTracking(this.state.proposalTracking) || this.deps.canStart?.() === false
      || current.roomId !== session.roomId || current.roomEpoch !== session.roomEpoch || current.self.userId !== session.self.userId
      || current.self.role !== 'host' || current.self.membershipState !== 'active'
      || session.self.role !== 'host' || session.self.membershipState !== 'active') return;
    const pending = current.snapshot.proposals.find(item => item.proposalId === proposal.proposalId);
    const reviewed = session.snapshot.proposals.find(item => item.proposalId === proposal.proposalId);
    if (!pending || !reviewed || pending.status !== 'submitted' || proposal.status !== 'submitted' || reviewed.status !== 'submitted'
      || proposal.roomId !== current.roomId || !sameProposalIdentity(proposal, pending) || !sameProposalIdentity(proposal, reviewed)) {
      this.publish({ error: '提案身份或状态已变化，请重新读取后选择。' }); return;
    }
    const parsed = ArenaRoomProposalResolveRequestSchema.safeParse(request);
    if (!parsed.success || request.expectedRoomEpoch !== current.roomEpoch
      || parsed.data.expectedRoomEpoch !== request.expectedRoomEpoch
      || JSON.stringify(parsed.data.selectedChangeIds) !== JSON.stringify(request.selectedChangeIds)
      || JSON.stringify(parsed.data.overrideChangeIds) !== JSON.stringify(request.overrideChangeIds)
      || (request.resolution === 'accept-selected' && !validateProposalChanges(pending.changes, request.selectedChangeIds).valid)) {
      this.publish({ error: '提案选择无效，请重新检查依赖、原子组与所选变更。' }); return;
    }
    // Ordinary merges retain the user's original selection and diagnostic revision.
    // Only explicit overrides require the exact revision that was reviewed.
    if (request.overrideChangeIds?.length && (request.expectedRevision !== session.snapshot.revision
      || request.expectedRevision !== current.snapshot.revision)) {
      this.publish({ error: '房间配置已变化，请重新审阅冲突后再确认覆盖。' }); return;
    }
    const action = { kind: 'proposal-resolve' as const, roomId: current.roomId, proposalId: proposal.proposalId, request: parsed.data };
    if (!DesktopRoomActionSchema.safeParse(action).success) {
      this.publish({ error: '此房间或提案标识不支持桌面写入，仍可只读查看。' }); return;
    }
    this.publish({ proposalTracking: { id: null, roomId: current.roomId, proposalId: proposal.proposalId, operation: 'proposalResolve', phase: 'resolving', observation: null, intent: freezeIntent(structuredClone(action)) } });
    await this.dispatch(action);
  }
  async checkProposalTracking(): Promise<void> {
    const tracking = this.state.proposalTracking, owner = this.owner;
    if (!this.current() || this.state.busy || tracking?.phase !== 'unknown') return;
    if (this.state.phase === 'unavailable') {
      const token = await this.open();
      if (!token || this.confirmationOwner() !== token || !this.current() || this.owner?.userId !== owner?.userId
        || this.owner?.epoch !== owner?.epoch || this.owner?.nonce !== owner?.nonce
        || this.state.proposalTracking?.phase !== 'unknown' || this.state.proposalTracking.roomId !== tracking.roomId
        || this.state.proposalTracking.operation !== tracking.operation
        || (tracking.id && this.state.proposalTracking.id !== tracking.id)) return;
    }
    await this.dispatch({ kind: 'session', roomId: tracking.roomId });
  }
  async endProposalTracking(intentId: string): Promise<void> {
    const tracking = this.state.proposalTracking, pending = this.state.unknown, owner = this.owner;
    if (!this.current() || this.state.busy || tracking?.phase !== 'unknown' || tracking.id !== intentId
      || !isProposalOperation(pending?.operation) || pending?.intentId !== intentId) return;
    this.flight = null; this.proposalRecoveryIntent = null;
    this.publish({ busy: true, session: null, presence: null, snapshotReceived: false }, true);
    try {
      await this.bridge.endProposalTracking(intentId);
      if (!this.current(owner) || this.state.proposalTracking?.id !== intentId) return;
      this.publish({ busy: false, unknown: null, session: null, phase: 'ready', constrained: true,
        proposalTracking: { ...tracking, phase: 'ended-needs-read', proposalId: null, observation: null },
        notice: '已结束本机提案跟踪；服务器请求不会因此取消。请重新读取房间后再选择。', error: null }, true);
    } catch {
      if (this.current(owner) && this.state.proposalTracking?.id === intentId) this.publish({ busy: false, phase: 'unavailable',
        error: '结束提案跟踪的回执无法确认，请重新核对本机跟踪与当前房间。' });
    }
  }
  async readProposalAfterEnd(): Promise<void> {
    const tracking = this.state.proposalTracking, owner = this.owner;
    if (!this.current() || this.state.busy || tracking?.phase !== 'ended-needs-read') return;
    const token = await this.open();
    const current = this.state.proposalTracking;
    if (!token || !this.current() || current?.phase !== 'ended-needs-read' || current.id !== tracking.id || current.roomId !== tracking.roomId
      || this.owner?.userId !== owner?.userId || this.owner?.epoch !== owner?.epoch || this.owner?.nonce !== owner?.nonce) return;
    await this.dispatch({ kind: 'session', roomId: tracking.roomId });
  }
  async checkConfigPublish(): Promise<void> {
    const tracking = this.state.configTracking;
    if (!tracking || tracking.phase !== 'unknown' || this.state.busy || !this.current()) return;
    const owner = this.owner, pendingId = this.state.unknown?.intentId;
    if (this.state.phase === 'unavailable') {
      const token = await this.open();
      if (!token || this.confirmationOwner() !== token || !this.current() || this.owner?.userId !== owner?.userId
        || this.owner?.epoch !== owner?.epoch || this.owner?.nonce !== owner?.nonce
        || (this.state.configTracking && (this.state.configTracking.roomId !== tracking.roomId
          || (pendingId && this.state.configTracking.id !== pendingId)))) return;
    }
    await this.dispatch({ kind: 'session', roomId: tracking.roomId });
  }
  async endConfigTracking(id: string): Promise<void> {
    const tracking = this.state.configTracking, pending = this.state.unknown, owner = this.owner;
    if (!this.current() || this.state.busy || tracking?.phase !== 'unknown' || tracking.id !== id
      || pending?.operation !== 'config' || pending.intentId !== id) return;
    this.flight = null;
    this.publish({ busy: true, session: null, presence: null, snapshotReceived: false });
    try {
      await this.bridge.endConfigTracking(id);
      if (!this.current(owner) || this.state.configTracking?.id !== id) return;
      this.publish({ busy: false, unknown: null, session: null, phase: 'ready', constrained: true,
        configTracking: { ...tracking, phase: 'ended-needs-read', target: null, observation: 'unobserved' },
        notice: '已结束本机跟踪；服务器请求不会因此取消。', error: null });
    } catch {
      if (this.current(owner) && this.state.configTracking?.id === id) this.publish({ busy: false, phase: 'unavailable',
        error: '结束跟踪的回执无法确认，请重新核对本机跟踪与当前房间。' });
    }
  }
  async readConfigAfterEnd(): Promise<void> {
    const tracking = this.state.configTracking, owner = this.owner;
    if (!this.current() || this.state.busy || tracking?.phase !== 'ended-needs-read') return;
    const token = await this.open();
    if (!token || !this.current() || this.state.configTracking !== tracking || this.owner?.userId !== owner?.userId
      || this.owner?.epoch !== owner?.epoch || this.owner?.nonce !== owner?.nonce) return;
    await this.dispatch({ kind: 'session', roomId: tracking.roomId });
  }
  discover = (more = false) => this.dispatch({ kind: 'discover', query: { limit: 50, ...(more && this.state.nextCursor ? { cursor: this.state.nextCursor } : {}) } });
  join = (roomId: string, displayName: string) => {
    if (this.state.session || this.state.memberModel || this.state.unknown || this.state.configTracking || blocksProposalTracking(this.state.proposalTracking) || this.deps.canStart?.() === false || !/^[\w-]{1,128}$/u.test(roomId.trim())) return Promise.resolve();
    return this.dispatch({ kind: 'join', roomId: roomId.trim(), request: { displayName } });
  };
  leave = () => { const s = this.state.session; return s && s.self.role === 'member' ? this.dispatch({ kind: 'leave', roomId: s.roomId, expectedRoomEpoch: s.roomEpoch }) : Promise.resolve(); };
  close = () => { const s = this.state.session; return s && s.self.role === 'host' ? this.dispatch({ kind: 'close', roomId: s.roomId, expectedRoomEpoch: s.roomEpoch }) : Promise.resolve(); };
  reconcile = () => {
    const pending = this.state.unknown;
    if (this.state.phase === 'unavailable') return this.open();
    if (!pending) return Promise.resolve();
    if (pending.operation === 'generationStart' && this.state.phase === 'online' && this.state.snapshotReceived && this.pendingStartIdentity()) return this.retryGenerationRecovery();
    if (pending.operation === 'generationCancel' && this.state.phase === 'online' && this.state.snapshotReceived && !this.cancelTrackingUnavailable()) return this.retryGenerationRecovery();
    if (pending.operation === 'create') return pending.intentId ? this.dispatch({ kind: 'resume-create', intentId: pending.intentId }) : this.open();
    return pending.roomId ? this.dispatch({ kind: 'session', roomId: pending.roomId }) : Promise.resolve();
  };
  reconnect = async () => {
    const session = this.state.session, owner = this.owner;
    if (!session) return this.open();
    if (!this.current(owner)) return;
    if (this.state.phase === 'unavailable') {
      const incarnation = await this.open();
      if (!incarnation || this.confirmationOwner() !== incarnation || !this.current() || this.owner?.userId !== owner?.userId || this.owner?.epoch !== owner?.epoch || this.owner?.nonce !== owner?.nonce) return;
    }
    if (this.state.unknown?.operation === 'create') return;
    return this.dispatch({ kind: 'session', roomId: session.roomId });
  };
  private async dispatch(action: DesktopRoomHttpAction): Promise<void> {
    if (!this.current() || this.state.busy || this.flight) return;
    if (this.state.proposalTracking?.phase === 'resolving' && action !== this.state.proposalTracking.intent && action.kind !== 'proposal-resolve') return;
    if ((this.state.configTracking?.phase === 'ended-needs-read' || this.state.proposalTracking?.phase === 'ended-needs-read') && action.kind !== 'session') return;
    if (this.state.unknown && !['session', 'resume-create', 'retry-generation-start', 'cancel-generation-start'].includes(action.kind)) return;
    if (this.state.unknown?.operation === 'create' && action.kind !== 'resume-create') return;
    const startingCancelTarget = action.kind === 'cancel-generation-start' ? this.pendingStartIdentity() : null;
    if (action.kind === 'cancel-generation-start' && (!startingCancelTarget || this.state.unknown?.intentId !== action.intentId || this.startingCancelBlockedReason() !== null)) return;
    const owner = this.owner;
    const flight: Flight = { ...(startingCancelTarget ? { startingCancelTarget } : {}), action, operation: getDesktopRoomHttpOperation(action), requestId: null, accepted: false, acknowledged: false, result: null, subscribe: false, settlesUnknown: false, knownNotApplied: false };
    const previous = this.state;
    this.flight = flight;
    this.publish({ busy: true, error: null, constrained: this.state.constrained || isMutation(action),
      ...(action.kind === 'session' ? { presence: null, snapshotReceived: false } : {}),
      ...(isMutation(action) && action.kind !== 'generation-cancel' && action.kind !== 'cancel-generation-start' && action.kind !== 'retry-generation-start' ? { presence: null, ...(this.state.proposalTracking?.phase === 'settled' ? { proposalTracking: null } : {}) } : {}) });
    if (action.kind === 'generation-cancel') { this.cancelTerminalKey = null; this.publish({ unknown: unknownFor(action), notice: '正在发送一次停止请求。' }); }
    if (action.kind === 'cancel-generation-start' && startingCancelTarget) {
      this.cancelTerminalKey = null;
      const { roomId, ...generationTarget } = startingCancelTarget;
      this.publish({ unknown: { operation: 'generationCancel', roomId, intentId: null, generationTarget, cancelMode: 'starting-v1', startIntentId: action.intentId },
        generationStartBlocked: true, notice: '正在交接原占位的停止请求。交接后原材料与重试许可不可恢复；只会尝试一次停止。' });
    }
    const dispatchAuthorityVersion = this.authorityVersion;
    try {
      const accepted = await this.bridge.request(action);
      if (!this.current(owner) || this.flight !== flight) return;
      if (flight.requestId && flight.requestId !== accepted.requestId) { this.failed(new ArenaRoomBridgeError('invalid-response', isMutation(action) ? 'unknown' : 'not-applicable')); return; }
      // generationCancel uses one Native ID for the accepted request and retained intent.
      if ((action.kind === 'generation-cancel' || action.kind === 'cancel-generation-start') && this.state.unknown?.operation === 'generationCancel' && this.state.unknown.intentId === null) this.publish({ unknown: { ...this.state.unknown, intentId: accepted.requestId } });
      flight.requestId = accepted.requestId; flight.accepted = true; this.finishFlight(flight);
    } catch (cause) {
      if (this.current(owner) && this.flight === flight) {
        const error = cause instanceof ArenaRoomBridgeError ? cause : new ArenaRoomBridgeError('internal-error', isMutation(action) ? 'unknown' : 'not-applicable');
        if ((error.code === 'busy' || action.kind === 'cancel-generation-start') && error.outcome === 'not-applied' && !flight.accepted && !flight.acknowledged && flight.requestId === null) {
          // Native refused admission; it did not disconnect the room or make the
          // mutation unknown. Roll back only this dispatch's freshness changes,
          // never a newer socket observation or an existing pending intent.
          const restore = this.authorityVersion === dispatchAuthorityVersion
            ? { phase: previous.phase, snapshotReceived: previous.snapshotReceived, presence: previous.presence } : {};
          const configTracking = flight.operation === 'config' && this.state.configTracking === previous.configTracking
            && this.state.configTracking?.phase === 'publishing' ? null : this.state.configTracking;
          const proposalTracking = isProposalOperation(flight.operation) && this.state.proposalTracking === previous.proposalTracking
            && this.state.proposalTracking?.phase === 'resolving' ? null : this.state.proposalTracking;
          this.flight = null;
          if (action.kind === 'generation-cancel' || action.kind === 'cancel-generation-start') this.publish({
            unknown: previous.unknown,
            generationStartBlocked: previous.generationStartBlocked, generationStartFence: previous.generationStartFence });
          this.publish({ ...restore, busy: false, error: describeDesktopRoomError(error), configTracking, proposalTracking,
            constrained: this.state.session !== null || this.state.memberModel !== null || this.state.unknown !== null || configTracking !== null || blocksProposalTracking(proposalTracking) });
          return;
        }
        this.failed(error);
      }
    }
  }
  private correlate(requestId: string, operation: DesktopRoomHttpOperation): Flight | null {
    const flight = this.flight;
    if (!flight || flight.operation !== operation || flight.requestId && flight.requestId !== requestId) return null;
    flight.requestId = requestId;
    const pending = this.state.unknown;
    if (flight.action.kind === 'cancel-generation-start' && pending?.cancelMode === 'starting-v1'
      && pending.startIntentId === flight.action.intentId && pending.intentId === null) {
      this.publish({ unknown: { ...pending, intentId: requestId } });
    }
    return flight;
  }
  private accept(batch: DesktopRoomBatch, context: ArenaRoomAcceptance): boolean {
    if (!this.current() || !context.isCurrent()) return false;
    const event = batch.event;
    if (event.kind === 'http-result' || event.kind === 'request-error') {
      const flight = this.correlate(event.requestId, event.operation); if (!flight) return false;
      if (event.kind === 'request-error') {
        this.applyFailure(new ArenaRoomBridgeError(event.error.code, event.error.outcome, event.error.serverCode), flight); flight.result = 'error';
      } else {
        if (!('result' in event.response)) { this.applyFailure(new ArenaRoomBridgeError('service-rejected', event.response.error.outcome, event.response.error.code), flight); flight.result = 'error'; }
        else {
          if ('roomId' in flight.action && 'roomId' in event.response.result && event.response.result.roomId !== flight.action.roomId) return false;
          flight.result = 'success';
          if (event.operation === 'discover') this.publish({ rooms: event.response.result.items, nextCursor: event.response.result.nextCursor });
          else if (event.operation === 'generationStart') {
            const pending = this.state.unknown, result = event.response.result;
            if (!flight.settlesUnknown && (pending?.operation !== 'generationStart' || pending.roomId !== result.roomId
              || pending.generationStart?.roomEpoch !== result.roomEpoch || pending.generationStart.generationRequestId !== result.generation.generationRequestId)) return false;
            // Receipt binds the request; it cannot advance the room control cursor.
          }
          else if (event.operation === 'generationCancel') {
            const target = flight.startingCancelTarget ?? (flight.action.kind === 'generation-cancel'
              ? { roomId: flight.action.roomId, roomEpoch: flight.action.expectedRoomEpoch, generationId: flight.action.generationId, attempt: flight.action.expectedAttempt } : null);
            const result = event.response.result;
            if (!target || result.roomId !== target.roomId || result.roomEpoch !== target.roomEpoch || result.generation.generationId !== target.generationId || result.generation.attempt !== target.attempt) return false;
            const terminal = terminalGeneration(result.status);
            // A terminal body alone is not an ACK-time cancellation settlement.
            const alreadySettled = flight.settlesUnknown;
            if (terminal && this.generationIdentity === generationKey({ roomId: result.roomId, roomEpoch: result.roomEpoch, generationId: result.generation.generationId, attempt: result.generation.attempt })) {
              this.generationTerminal = true; this.generationTerminalPhase = result.generation.state;
              if (!this.state.generation.finalAuthoritative) this.publish({ generation: { ...this.state.generation, phase: result.generation.state } });
            }
            if (!terminal && !alreadySettled) this.publish({ notice: '停止请求已收到，正在等待原生成终态；不会再次发送。' });
          }
          else if (event.operation === 'leave' || event.operation === 'close') this.publish({ session: null, presence: null, snapshotReceived: false, phase: 'ready', notice: event.response.result.outcome === 'left' ? '已离开房间。' : '房间已关闭。' });
          else if (event.operation === 'proposalSubmit' || event.operation === 'proposalWithdraw') {
            // Summary receipts never install a complete replica cursor, even if optional state is present.
            const proposalId = flight.action.kind === 'proposal-submit' ? flight.action.request.proposalId
              : flight.action.kind === 'proposal-withdraw' ? flight.action.proposalId : null;
            if (!proposalId || event.response.result.proposalId !== proposalId) return false;
            this.publish({ presence: null, snapshotReceived: false, phase: 'offline', notice: '提案操作回执已确认；请读取房间查看当前状态。' });
          } else if (event.operation === 'proposalResolve') {
            const previous = this.state.session, snapshot = event.response.result.snapshot;
            if (flight.action.kind !== 'proposal-resolve' || event.response.result.proposalId !== flight.action.proposalId
              || !previous || !snapshot || previous.roomId !== snapshot.roomId || previous.roomEpoch !== snapshot.roomEpoch
              || snapshot.controlSeq < previous.snapshot.controlSeq || snapshot.revision < previous.snapshot.revision) return false;
            const result = this.checkedSession({ ...previous, snapshot });
            flight.subscribe = true;
            this.publish({ session: result, presence: null, snapshotReceived: false, rooms: [], nextCursor: null, notice: '提案处理回执已确认，正在建立在线连接。' });
          } else {
            const result = event.response.result;
            // Recovery's observation is a separate delivery; do not retire it by subscribing after the GET ACK.
            flight.subscribe = !(event.operation === 'session' && isProposalOperation(this.state.unknown?.operation));
            if (!flight.subscribe) this.proposalRecoveryIntent = this.state.unknown?.intentId ?? null;
            this.publish({ session: result, presence: null, snapshotReceived: false, rooms: [], nextCursor: null, notice: event.operation === 'config' ? '原配置请求已获确认，正在建立在线连接。' : event.operation === 'session' ? '已读取服务器当前房间状态。' : '成员资格已确认，正在建立在线连接。' });
          }
        }
      }
    } else if (event.kind === 'mutation-unknown') {
      if (event.operation === 'generationStart' && event.intentId === this.startSettledIntent) return true;
      if (event.operation === 'generationCancel' && event.intentId === this.startingCancelSettledIntent) return true;
      if (event.operation === 'generationStart' && (this.state.unknown?.cancelMode === 'starting-v1' && this.state.unknown.startIntentId === event.intentId
        || this.state.generationStartFence?.cancelMode === 'starting-v1' && this.state.generationStartFence.startIntentId === event.intentId)) return true;
      if (event.operation === 'generationCancel' && event.roomId && event.generationTarget
        && this.cancelTerminalKey === generationKey({ roomId: event.roomId, ...event.generationTarget })) return true;
      if (event.operation === 'config' && event.roomId) this.publish({ configTracking: { id: event.intentId, roomId: event.roomId, phase: 'unknown', target: this.state.configTracking?.target ?? null, observation: this.state.configTracking?.observation ?? 'target-unavailable' } });
      if (isProposalOperation(event.operation) && event.roomId) {
        const previous = this.state.proposalTracking;
        this.publish({ proposalTracking: { id: event.intentId, roomId: event.roomId, operation: event.operation, phase: 'unknown',
          proposalId: previous?.roomId === event.roomId && previous.operation === event.operation ? previous.proposalId : null,
          intent: previous?.roomId === event.roomId && previous.operation === event.operation ? previous.intent : null, observation: null } });
      }
      this.publish({ unknown: event, constrained: true, notice: '操作结果尚未确认，请明确核对原意图。' });
    } else if (event.kind === 'proposal-observation') {
      // Consumer acceptance alone cannot release the pending intent; wait for its exact Native ACK.
      if (!isProposalOperation(this.state.unknown?.operation) || this.state.unknown?.intentId !== event.intentId) return false;
      if (this.state.proposalTracking?.id === event.intentId) this.publish({ proposalTracking: { ...this.state.proposalTracking, observation: event.observation } });
    } else if (event.kind === 'status') {
      if (event.state === 'closed') this.publish({ session: null, presence: null, snapshotReceived: false, constrained: !!this.flight || !!this.state.unknown || !!this.state.configTracking || blocksProposalTracking(this.state.proposalTracking), phase: 'closed', notice: '房间或当前成员资格已结束。' }, true);
      else if (event.state === 'detached' || event.state === 'backpressure' || event.state === 'resync-required') this.publish({ presence: null, snapshotReceived: false, phase: event.state === 'detached' ? 'detached' : 'offline' });
      else this.publish({ phase: event.state, ...(event.state === 'online' ? {} : { presence: null, snapshotReceived: false }) });
    } else if (event.kind === 'socket') this.applySocket(event.message);
    return context.isCurrent() && this.current();
  }
  private acknowledged(batch: DesktopRoomBatch, context: ArenaRoomAcceptance) {
    if (!context.isCurrent() || !this.current()) return;
    const cleared = context.generationStartFence, fence = this.state.generationStartFence;
    if (cleared && fence && fence.cancelMode === undefined && cleared.roomId === fence.roomId && cleared.generationRequestId === fence.generationRequestId) {
      this.publish({ generationStartBlocked: false, generationStartFence: null, notice: '已取得原请求或原房间结束的权威证据，防重复记录已解除；这不证明任务被取消。' });
    }
    const cancellation = context.generationCancel, pending = this.state.unknown;
    const event = batch.event;
    const linkedPending = pending?.cancelMode === 'starting-v1' && pending.intentId === cancellation?.intentId;
    const linkedFence = fence?.cancelMode === 'starting-v1' && fence.cancelIntentId === cancellation?.intentId;
    if (cancellation?.current && (linkedPending || linkedFence)) {
      this.startingCancelSettledIntent = cancellation.intentId;
      this.startSettledIntent = linkedPending ? pending.startIntentId ?? null : fence?.startIntentId ?? null;
      if (this.flight?.operation === 'generationCancel' && this.flight.requestId === cancellation.intentId) this.flight.settlesUnknown = true;
      this.publish({ generationStartBlocked: false, generationStartFence: null, ...(linkedPending ? { unknown: null } : {}),
        notice: '已取得原目标终态或原房关闭的权威证据，防重复记录已解除；这不证明停止请求造成取消。完整战报仍须读取确认。' });
    }
    this.settleStart(context.generationStart);
    if (event.kind === 'generation-fragment' && event.final && this.generationFlight) {
      this.generationFlight.cancelReceipt = context.generationCancel;
      return;
    }
    if (event.kind === 'socket') {
      const message = event.message;
      const mirror = message.type === 'room.snapshot' ? message.payload.activeGeneration
        : message.type === 'generation.completed' || message.type === 'generation.failed' ? { ...message.payload, state: message.type === 'generation.completed' ? 'completed' : 'failed' } : null;
      if (mirror && 'roomEpoch' in message) this.settleCancel({ roomId: message.roomId, roomEpoch: message.roomEpoch, generationId: mirror.generationId, attempt: mirror.attempt }, mirror.state, context.generationCancel);
      if (message.type === 'room.snapshot') void this.requestGenerationRecovery('reconnect');
      else if (message.type === 'generation.started') void this.requestGenerationRecovery('baseline');
      else if (message.type === 'generation.completed' || message.type === 'generation.failed') void this.requestGenerationRecovery('terminal');
      else if (message.type === 'story.delta' && (!this.generationBaseline || this.state.generation.gap)) void this.requestGenerationRecovery('gap');
      return;
    }
    if (event.kind === 'status') {
      if (event.state === 'online') void this.requestGenerationRecovery('baseline');
      return;
    }
    if (event.kind === 'proposal-observation') {
      if (!isProposalOperation(this.state.unknown?.operation) || this.state.unknown?.intentId !== event.intentId) return;
      const observation = event.observation;
      this.publish({ ...(observation.settle ? { unknown: null } : {}),
        ...(this.state.proposalTracking?.id === event.intentId ? { proposalTracking: { ...this.state.proposalTracking, observation, phase: observation.settle ? 'settled' as const : 'unknown' as const } } : {}),
        constrained: this.state.session !== null || !observation.settle || this.state.configTracking !== null,
        notice: observation.settle
          ? observation.outcome === 'scope-unverified' ? '已观察到提案部分接受；具体接受范围尚无法确认。'
            : observation.outcome === 'different' ? '已观察到提案结束，结果与原意图不同。' : '已观察到与原意图一致的提案状态；这不证明由原请求造成。'
          : '尚未取得足够关联证据，保留原提案防重发状态。',
      });
      if (this.proposalRecoveryIntent === event.intentId) {
        this.proposalRecoveryIntent = null;
        if (this.flight?.operation === 'session') this.flight.subscribe = true;
        else if (!this.flight && this.state.session) void this.startSubscription();
      }
      return;
    }
    if (event.kind !== 'http-result' && event.kind !== 'request-error') return;
    const flight = this.correlate(event.requestId, event.operation); if (!flight) return;
    if (event.kind === 'http-result' && 'result' in event.response && event.operation === 'session') {
      const result = event.response.result, mirror = result.snapshot.activeGeneration;
      if (mirror) this.settleCancel({ roomId: result.roomId, roomEpoch: result.roomEpoch, generationId: mirror.generationId, attempt: mirror.attempt }, mirror.state, context.generationCancel);
    }
    if (event.kind === 'http-result' && 'result' in event.response && event.operation === 'generationCancel') {
      const result = event.response.result;
      this.settleCancel({ roomId: result.roomId, roomEpoch: result.roomEpoch, generationId: result.generation.generationId, attempt: result.generation.attempt }, result.status, context.generationCancel);
    }
    flight.acknowledged = true; this.finishFlight(flight);
  }
  private finishFlight(flight: Flight) {
    if (this.flight !== flight || !flight.accepted || !flight.acknowledged || !this.current()) return;
    this.flight = null;
    const settled = flight.settlesUnknown || flight.result === 'success' && flight.operation !== 'discover' && flight.operation !== 'generationCancel' && flight.operation !== 'generationStart'
      && (flight.operation !== 'session' || (this.state.unknown?.operation !== 'create' && !requiresTrackedObservation(this.state.unknown?.operation)));
    if (settled) this.publish({ unknown: null });
    if (flight.result === 'success' && (flight.operation === 'config' || (flight.operation === 'session' && this.state.configTracking?.phase === 'ended-needs-read'))) this.publish({ configTracking: null });
    if (flight.result === 'success' && isProposalOperation(flight.operation) && this.state.proposalTracking) this.publish({ proposalTracking: { ...this.state.proposalTracking, phase: 'settled', observation: null } });
    if (flight.result === 'success' && flight.operation === 'session' && this.state.proposalTracking?.phase === 'ended-needs-read') this.publish({ proposalTracking: null });
    this.publish({ busy: false, constrained: this.state.session !== null || this.state.unknown !== null || this.state.configTracking !== null || blocksProposalTracking(this.state.proposalTracking) });
    if (flight.operation === 'generationStart') void this.requestGenerationRecovery('baseline');
    if (flight.operation === 'generationCancel' && this.state.unknown?.operation === 'generationCancel') void this.requestGenerationRecovery('baseline');
    if (flight.operation === 'generationCancel' && flight.settlesUnknown) void this.requestGenerationRecovery('terminal');
    if (flight.subscribe && this.state.session) void this.startSubscription();
  }
  private async startSubscription() {
    const owner = this.owner; const session = this.state.session; if (!session || !this.current()) return;
    this.publish({ busy: true, phase: 'connecting', presence: null, snapshotReceived: false });
    try { await this.bridge.subscribe(session.roomId, session.roomEpoch); if (this.current(owner)) this.publish({ busy: false }); }
    catch (cause) { if (this.current(owner)) this.failed(cause instanceof ArenaRoomBridgeError ? cause : new ArenaRoomBridgeError('internal-error')); }
  }
  private applyFailure(error: ArenaRoomBridgeError, flight: Flight | null) {
    const unknown = flight && !flight.settlesUnknown && isMutation(flight.action) && error.outcome === 'unknown' ? this.state.unknown ?? unknownFor(flight.action) : this.state.unknown;
    const ended = flight?.operation === 'session' && ['ROOM_NOT_FOUND', 'ROOM_FORBIDDEN'].includes(error.serverCode ?? '');
    if (flight && error.outcome === 'not-applied') flight.knownNotApplied = true;
    if (flight?.operation === 'config' && this.state.configTracking) this.publish({ configTracking: error.outcome === 'not-applied' ? null : { ...this.state.configTracking, phase: 'unknown' } });
    if (isProposalOperation(flight?.operation) && this.state.proposalTracking) this.publish({ proposalTracking: error.outcome === 'not-applied' ? null : { ...this.state.proposalTracking, phase: 'unknown' } });
    if (flight?.operation === 'session' && this.state.configTracking?.phase === 'unknown') this.publish({ configTracking: { ...this.state.configTracking, observation: 'authority-unavailable' } });
    if (ended && flight && this.state.unknown?.operation !== 'create' && !requiresTrackedObservation(this.state.unknown?.operation)) flight.settlesUnknown = true;
    const startingCancel = flight?.action.kind === 'cancel-generation-start' || unknown?.cancelMode === 'starting-v1';
    this.publish({ error: startingCancel ? '停止尚未确认。旧服务拒绝或回执未知都不会恢复原材料与重试许可；请只读核对，或停止本机跟踪返回大厅。' : describeDesktopRoomError(error), unknown: !startingCancel && (flight?.operation === 'generationCancel' || flight?.newStart) && error.outcome === 'not-applied' ? null : unknown,
      ...(ended ? { session: null, presence: null, snapshotReceived: false, phase: 'closed' as const } : {}) }, ended);
  }
  private failed(error: ArenaRoomBridgeError, retired = false) {
    if (!this.current()) return;
    const flight = this.flight;
    if (flight?.acknowledged && flight.result === 'success') {
      flight.accepted = true; this.finishFlight(flight);
      if (retired) this.publish({ busy: false, presence: null, snapshotReceived: false, phase: 'unavailable' });
      return;
    }
    const incompleteMutation = flight && isMutation(flight.action) && !flight.acknowledged
      && !flight.knownNotApplied && error.outcome !== 'not-applied';
    this.applyFailure(incompleteMutation ? new ArenaRoomBridgeError(error.code, 'unknown', error.serverCode) : error, flight); this.flight = null;
    this.publish({ busy: false, constrained: this.state.session !== null || this.state.unknown !== null || this.state.configTracking !== null || blocksProposalTracking(this.state.proposalTracking), presence: null, snapshotReceived: false, phase: 'unavailable' });
  }
  private checkedSession(session: ArenaRoomSessionResponse): ArenaRoomSessionResponse {
    if (jsonUtf8ByteLength(session) > DESKTOP_ROOM_IPC_LIMITS.batchBytes) throw new ArenaRoomBridgeError('backpressure');
    const parsed = ArenaRoomSessionResponseSchema.safeParse(session);
    if (!parsed.success) throw new ArenaRoomBridgeError('invalid-response');
    return parsed.data;
  }
  private applySocket(message: RoomServerTransportMessage) {
    const session = this.state.session; if (!session) return;
    if (message.type === 'room.resync.required') { this.publish({ phase: 'reconnecting', presence: null, snapshotReceived: false }); return; }
    if (message.roomId !== session.roomId || (message.type !== 'room.snapshot' && message.roomEpoch !== session.roomEpoch)) return;
    if (message.type === 'room.presence') {
      if (this.state.snapshotReceived && message.onlineUserIds.every(id => session.snapshot.members.some(member => member.userId === id && member.membershipState === 'active'))) this.publish({ presence: message });
      return;
    }
    if (message.type === 'story.delta') { this.applyStoryDelta(message); return; }
    if (message.type !== 'room.snapshot' && message.controlSeq <= session.snapshot.controlSeq) return;
    if (message.type === 'room.snapshot' && message.roomEpoch === session.roomEpoch && message.controlSeq < session.snapshot.controlSeq) return;
    if (message.type === 'room.closing') { this.publish({ session: null, presence: null, snapshotReceived: false, phase: 'closed', constrained: !!this.flight || !!this.state.unknown || !!this.state.configTracking || blocksProposalTracking(this.state.proposalTracking), notice: '房间已关闭。' }, true); return; }
    if (message.type === 'room.snapshot') {
      const self = message.payload.members.find(member => member.userId === session.self.userId && member.membershipState === 'active');
      if (!self) { this.publish({ session: null, presence: null, snapshotReceived: false, phase: 'closed', constrained: !!this.flight || !!this.state.unknown || !!this.state.configTracking || blocksProposalTracking(this.state.proposalTracking), notice: '当前成员资格已结束。' }, true); return; }
      this.publish({ session: this.checkedSession({ ...session, roomEpoch: message.roomEpoch, self, snapshot: message.payload }), presence: null, snapshotReceived: true }); return;
    }
    if (message.controlSeq !== session.snapshot.controlSeq + 1) { this.publish({ presence: null, snapshotReceived: false, phase: 'reconnecting' }); return; }
    let snapshot = { ...session.snapshot, controlSeq: message.controlSeq }; let self = session.self;
    if (message.type === 'room.member.joined' || message.type === 'room.member.left' || message.type === 'room.host.online' || message.type === 'room.host.offline') {
      const member = message.payload.member;
      snapshot = { ...snapshot, members: snapshot.members.filter(item => item.userId !== member.userId).concat(member) };
      if (member.userId === self.userId) { if (member.membershipState !== 'active') { this.publish({ session: null, presence: null, snapshotReceived: false, phase: 'closed', constrained: !!this.flight || !!this.state.unknown || !!this.state.configTracking || blocksProposalTracking(this.state.proposalTracking), notice: '当前成员资格已结束。' }, true); return; } self = member; }
    } else if (message.type === 'room.config.updated') snapshot = { ...snapshot, revision: message.payload.revision, sharedConfig: message.payload.sharedConfig };
    else if (message.type === 'proposal.submitted' || message.type === 'proposal.updated') snapshot = { ...snapshot, proposals: snapshot.proposals.filter(item => item.proposalId !== message.payload.proposal.proposalId).concat(message.payload.proposal) };
    else if (message.type === 'proposal.resolved') snapshot = { ...snapshot, proposals: snapshot.proposals.filter(item => item.proposalId !== message.payload.proposalId) };
    else {
      const current = snapshot.activeGeneration; const payload = message.payload;
      snapshot = { ...snapshot, activeGeneration: { generationRequestId: payload.generationRequestId, generationId: payload.generationId, attempt: payload.attempt,
        configRevision: payload.configRevision, snapshotDigest: payload.snapshotDigest, collaborativeInfluence: payload.collaborativeInfluence,
        participantUserIds: payload.participantUserIds, ...(payload.hostAccountUserId === undefined ? {} : { hostAccountUserId: payload.hostAccountUserId }),
        state: message.type === 'generation.started' ? 'running' : message.type === 'generation.completed' ? 'completed' : 'failed',
        startedAt: current?.generationId === payload.generationId && current.attempt === payload.attempt ? current.startedAt : message.timestamp,
        ...(message.type === 'generation.started' ? {} : { finishedAt: message.timestamp }) } };
    }
    this.publish({ session: this.checkedSession({ ...session, self, snapshot }) });
  }
}
