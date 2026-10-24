import { projectMagicTeaPartyPreset, type MagicTeaPartyPresetId } from '@mahoshojo/ai-core/magic-tea-party';
import { TeaWriteRequestSchema, type TeaHead, type TeaMessageDocument, type TeaReadResponse, type TeaSessionDocument, type TeaWriteRequest, type TeaWriteResponse } from '@mahoshojo/contracts/desktop-magic-tea-party';
import type { AiExecutionRequest } from '@mahoshojo/contracts/ai-execution';
import type { MagicTeaPartySession } from '@mahoshojo/domain/magic-tea-party/types';
import { resolveMagicTeaPartyPlayerIdentity } from '@mahoshojo/domain/magic-tea-party/player-identity';
import { TeaStorageError, type TeaNativePort } from '../../platform/magic-tea-party-native';
import type { DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';
import type { ResolvedDesktopAiTarget } from '../ai-config/desktop-ai-config';
import { desktopTeaSettings, executeTeaDirect, prepareTeaDirectRequest, readTeaMessagePages, teaReasoningMeta, teaTerminalMessage, type TeaDirectOutcome, type TeaRecord } from './direct';
import { exportDesktopTea, prepareDesktopTeaImport } from './transfer';
import { editedTeaSummary, prepareTeaSummaryRequest, prepareTeaAutoSummaryRequest, type TeaSummaryPreparation } from './summary';

type DirectoryCursor = Extract<TeaReadResponse['result'], { action: 'list' }>['nextCursor'];
type MessageCursor = Extract<TeaReadResponse['result'], { action: 'messages' }>['nextCursor'];
export type TeaCleanupSelection = { directory: TeaHead[]; incarnation: number; targets: ReadonlyArray<Readonly<{ sessionId: string; instance: string; expectedRevision: number }>>; titles: readonly string[] };
export type TeaMergePreview = Extract<TeaReadResponse['result'], { action: 'merge-preview' }>;
type Pending = { write: TeaWriteRequest; unknown: boolean; purpose: 'ordinary' | 'begin' | 'finish' | 'import' | 'fork' | 'merge' };
type Generation = { owner: number; controller: AbortController; dispatched: boolean; request: AiExecutionRequest;
  kind: 'chat' | 'choices' | 'summary'; summaryMeta?: TeaSummaryPreparation['summaryMeta']; outputFormat: 'jsonl' | 'markdown';
  automatic: boolean; autoFollowupAllowed: boolean; target: ResolvedDesktopAiTarget; droppedRatio: number; current: () => boolean;
  options: DesktopAiExecutionOptions; credentialCurrent: () => boolean; begin: Extract<TeaWriteRequest['request'], { action: 'begin-generation' }>;
  rawText: string; reasoning: string; stopped: boolean; completed: Promise<void>; release: () => void; outcome?: TeaDirectOutcome };
export type DesktopTeaIntent = { kind: 'reply' | 'selected-choice'; text: string } | { kind: 'continue' | 'choices' | 'summary' };
export type DesktopTeaState = {
  incarnation: number; directory: TeaHead[]; directoryCursor: DirectoryCursor; catalogRevision: number | null;
  record: TeaRecord | null; messages: TeaMessageDocument[]; messageCursor: MessageCursor;
  mergePreview: TeaMergePreview | null;
  editingMessageId: string | null; editingDraft: string;
  input: string; titleDraft: string | null; nameDraft: string | null; summaryDraft: string | null; busy: boolean; generating: boolean; generationKind: Generation['kind'] | null; isAutoSummarizing: boolean; pending: 'none' | 'save' | 'unknown';
  error: string | null; notice: string | null; rawUnsaved: string | null;
};
const initial = (): DesktopTeaState => ({ incarnation: 0, directory: [], directoryCursor: null, catalogRevision: null,
  record: null, messages: [], messageCursor: null, mergePreview: null, editingMessageId: null, editingDraft: '', input: '', titleDraft: null, nameDraft: null, summaryDraft: null, busy: false, generating: false, generationKind: null, isAutoSummarizing: false, pending: 'none', error: null, notice: null, rawUnsaved: null });
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const cloneWrite = (write: TeaWriteRequest): TeaWriteRequest => TeaWriteRequestSchema.parse(JSON.parse(JSON.stringify(write)));

/** One page owner. SQLite revisions fence writes; begin receipts never authorize a replacement owner to dispatch. */
export class DesktopTeaSession {
  private state = initial(); private readonly listeners = new Set<() => void>();
  private live = true; private incarnation = 0; private pending: Pending | null = null; private generation: Generation | null = null;
  private mergePreparation: object | null = null;
  private preparation: { cancelled: boolean; automatic: boolean } | null = null; private consecutiveDroppedTurns = 0;
  constructor(private readonly port: TeaNativePort, private readonly id: () => string = () => crypto.randomUUID(), private readonly now: () => number = Date.now) {}
  activate = () => { if (!this.live) { this.live = true; this.pending = null; this.generation = null; this.state = { ...initial(), incarnation: ++this.incarnation }; } };
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<DesktopTeaState>) { if (!this.live) return; this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private current(owner: number) { return this.live && owner === this.incarnation; }
  isBusy = () => this.state.mergePreview !== null || this.state.editingMessageId !== null || this.state.busy || this.state.titleDraft !== null || this.state.nameDraft !== null || this.state.summaryDraft !== null || this.state.pending !== 'none' || Boolean(this.pending) || this.state.input !== (this.state.record?.session.draft ?? '');
  setInput = (input: string) => { if (this.allowed()) this.publish({ input }); };
  stageTitle = (value: string) => { if (this.allowed() && this.state.record) this.publish({ titleDraft: value === this.state.record.session.title ? null : value }); };
  stageName = (value: string) => { if (this.allowed() && this.state.record) this.publish({ nameDraft: value === this.state.record.session.settings.userDisplayName ? null : value }); };
  stageSummary = (value: string) => {
    const automatic = this.state.isAutoSummarizing; this.cancelAutomaticIntent();
    if ((this.allowed() || automatic && this.live) && this.state.record) this.publish({ summaryDraft: !automatic && value === (this.state.record.session.summary ?? '') ? null : value });
  };
  clearSummary = () => {
    if (this.state.isAutoSummarizing) { this.stageSummary(''); return Promise.resolve(false); }
    return this.state.record ? this.update(editedTeaSummary(this.state.record.session, '', this.now())) : Promise.resolve(false);
  };
  report = (error: unknown) => this.publish({ error: error instanceof Error ? error.message : '茶会操作未完成，请保留输入后重试' });
  dispose = () => { this.live = false; this.incarnation += 1; this.generation?.controller.abort(); this.generation?.release(); this.listeners.clear(); };
  private allowed(editing = false) { return this.live && !this.state.busy && !this.pending && this.state.pending === 'none' && this.state.mergePreview === null && (editing || this.state.editingMessageId === null); }
  startMessageEdit = (messageId: string) => {
    if (!this.allowed()) return;
    if (this.isBusy()) { this.report(new Error('请先保存会话草稿，再编辑消息创建分支')); return; }
    const message = this.state.messages.find(row => row.id === messageId);
    if (!message || message.role !== 'user' || !this.state.record) return;
    this.publish({ editingMessageId: messageId, editingDraft: message.content, error: null });
  };
  setMessageEditDraft = (editingDraft: string) => {
    if (this.allowed(true) && this.state.editingMessageId) this.publish({ editingDraft });
  };
  cancelMessageEdit = () => {
    if (this.allowed(true)) this.publish({ editingMessageId: null, editingDraft: '' });
  };
  forkMessageEdit = async (): Promise<boolean> => {
    if (!this.allowed(true) || !this.state.record || !this.state.editingMessageId || !this.state.editingDraft.trim()) return false;
    const { session, instance, revision } = this.state.record;
    if (this.state.input !== (session.draft ?? '') || this.state.titleDraft !== null || this.state.nameDraft !== null || this.state.summaryDraft !== null) {
      this.report(new Error('请先取消消息编辑并保存会话草稿，再创建分支')); return false;
    }
    const message = this.state.messages.find(row => row.id === this.state.editingMessageId);
    if (!message || message.role !== 'user') return false;
    return this.write({ version: 1, request: { action: 'fork', operationId: this.id(), sessionId: session.id,
      instance, expectedRevision: revision, anchorMessageId: message.id, editedContent: this.state.editingDraft,
      targetSessionId: this.id() } }, 'fork');
  };
  prepareMerge = async (): Promise<boolean> => {
    if (!this.allowed() || !this.state.record) return false;
    if (this.isBusy()) { this.report(new Error('请先保存或取消会话草稿，再审阅分支合并')); return false; }
    const record = this.state.record; const owner = this.incarnation; const token = {};
    this.mergePreparation = token; this.publish({ busy: true, error: null, notice: null });
    try {
      const response = await this.port.read({ version: 1, request: { action: 'merge-preview', source: {
        sessionId: record.session.id, instance: record.instance, expectedRevision: record.revision,
      } } });
      if (!this.current(owner) || this.mergePreparation !== token || this.state.record !== record) return false;
      if (response.result.action !== 'merge-preview') throw new Error('分支合并预览不匹配');
      // Freeze the reviewed snapshot: a caller cannot replace identities between review and confirmation.
      const preview: TeaMergePreview = Object.freeze({ ...response.result,
        source: Object.freeze({ ...response.result.source }), parent: Object.freeze({ ...response.result.parent }) });
      this.publish({ mergePreview: preview }); return true;
    } catch (error) {
      if (this.current(owner) && this.mergePreparation === token) this.report(error instanceof TeaStorageError && error.code === 'tea-stale'
        ? new Error('该分支锚点已被替换或会话已变化，无法合并；请重新审阅，必要时重新建立分支') : error);
      return false;
    } finally {
      if (this.current(owner) && this.mergePreparation === token) { this.mergePreparation = null; this.publish({ busy: false }); }
    }
  };
  cancelMerge = () => {
    if (!this.live || this.pending) return;
    const preparing = this.mergePreparation !== null; this.mergePreparation = null;
    this.publish({ mergePreview: null, ...(preparing ? { busy: false } : {}) });
  };
  confirmMerge = async (preview: TeaMergePreview): Promise<boolean> => {
    const record = this.state.record;
    if (!this.live || this.state.busy || this.pending || this.state.pending !== 'none' || !record || this.state.mergePreview !== preview) return false;
    if (record.session.id !== preview.source.sessionId || record.instance !== preview.source.instance || record.revision !== preview.source.expectedRevision
      || this.state.editingMessageId !== null || this.state.input !== (record.session.draft ?? '')
      || this.state.titleDraft !== null || this.state.nameDraft !== null || this.state.summaryDraft !== null) {
      this.publish({ mergePreview: null, error: '会话或草稿已变化，请先保存或取消草稿，再重新审阅合并' }); return false;
    }
    return this.write({ version: 1, request: { action: 'merge', operationId: this.id(), source: { ...preview.source }, parent: { ...preview.parent },
      anchorMessageId: preview.anchorMessageId, editedMessageId: preview.editedMessageId } }, 'merge');
  };
  private nextOwner() { this.mergePreparation = null; this.incarnation += 1; this.consecutiveDroppedTurns = 0; this.publish({ incarnation: this.incarnation, mergePreview: null }); return this.incarnation; }
  private cancelAutomaticIntent() { if (this.preparation?.automatic || this.generation?.automatic) this.stop(); }
  refreshDirectory = async (next = false): Promise<void> => {
    if (!this.allowed()) return;
    const owner = this.incarnation; this.publish({ busy: true, error: null });
    try { await this.loadDirectory(owner, next); } catch (error) { if (this.current(owner)) this.report(error); }
    finally { if (this.current(owner)) this.publish({ busy: false }); }
  };
  private async loadDirectory(owner: number, next = false) {
    const response = await this.port.read({ version: 1, request: { action: 'list', cursor: next ? this.state.directoryCursor : null,
      expectedCatalogRevision: next ? this.state.catalogRevision : null, limit: 50 } });
    if (!this.current(owner)) return;
    if (response.result.action !== 'list') throw new Error('茶会目录回执不匹配');
    this.publish({ directory: response.result.rows, directoryCursor: response.result.nextCursor, catalogRevision: response.result.catalogRevision });
  }
  private async loadRecord(id: string, owner: number, input?: string, expectedInstance?: string) {
    const response = await this.port.read({ version: 1, request: { action: 'session', sessionId: id, expectedCatalogRevision: null } });
    if (!this.current(owner)) return;
    if (response.result.action !== 'session') throw new Error('茶会会话回执不匹配');
    const record = response.result.record;
    if (record && expectedInstance && record.instance !== expectedInstance) throw new Error('原父会话已被替换，请刷新目录后重新选择');
    this.publish({ record, input: input ?? record?.session.draft ?? '', titleDraft: null, nameDraft: null, summaryDraft: null, messages: [], messageCursor: null });
    if (record) {
      let last: TeaMessageDocument[] = [];
      for await (const page of readTeaMessagePages(this.port, record, () => this.current(owner))) last = page.rows.map(row => row.message);
      if (this.current(owner)) this.publish({ messages: last, messageCursor: null });
    }
  }
  private async loadMessages(record: TeaRecord, owner: number, cursor: MessageCursor) {
    const response = await this.port.read({ version: 1, request: { action: 'messages', sessionId: record.session.id, instance: record.instance,
      expectedRevision: record.revision, expectedCatalogRevision: null, cursor, limit: 100 } });
    if (!this.current(owner)) return;
    if (response.result.action !== 'messages') throw new Error('茶会消息回执不匹配');
    // A page replaces a page: bounded UI, never an unbounded append-only timeline.
    this.publish({ messages: response.result.rows.map(row => row.message), messageCursor: response.result.nextCursor });
  }
  nextMessages = async (first = false) => {
    if (!this.allowed() || !this.state.record || !first && !this.state.messageCursor) return;
    const owner = this.incarnation; this.publish({ busy: true });
    try { await this.loadMessages(this.state.record, owner, first ? null : this.state.messageCursor); }
    catch (error) { if (this.current(owner)) this.report(error); }
    finally { if (this.current(owner)) this.publish({ busy: false }); }
  };
  select = async (id: string) => {
    const previousOwner = this.incarnation;
    if (!this.allowed() || !await this.saveDraft() || !this.current(previousOwner) || !this.allowed()) return;
    const owner = this.nextOwner(); this.publish({ busy: true, error: null, notice: null });
    try { await this.loadRecord(id, owner); } catch (error) { if (this.current(owner)) this.report(error); }
    finally { if (this.current(owner)) this.publish({ busy: false }); }
  };
  create = async (presetId: MagicTeaPartyPresetId | null = null) => {
    const owner = this.incarnation;
    if (!this.allowed() || !await this.saveDraft() || !this.current(owner) || !this.allowed()) return;
    const at = this.now();
    const session: TeaSessionDocument = { id: this.id(), title: '新茶会', createdAt: at, updatedAt: at, roles: [], settings: desktopTeaSettings(null), draft: '' };
    if (presetId !== null) {
      const projection = projectMagicTeaPartyPreset({ settings: desktopTeaSettings(null) }, presetId);
      if (!projection) { this.report(new Error('未知茶会预设')); return; }
      Object.assign(session, projection.patch);
    }
    await this.write({ version: 1, request: { action: 'create', session } }, 'ordinary');
  };
  applyPreset = async (presetId: MagicTeaPartyPresetId, expected: TeaRecord, incarnation: number): Promise<boolean> => {
    if (!this.allowed() || incarnation !== this.incarnation || this.state.record !== expected) {
      this.report(new Error('会话已变化，请重新预览预设变更')); return false;
    }
    const projection = projectMagicTeaPartyPreset(expected.session, presetId);
    if (!projection) return false;
    return this.update(projection.patch);
  };
  setPin = async (id: string, pinned: boolean): Promise<boolean> => {
    if (!this.allowed()) return false;
    const head = this.state.directory.find(row => row.id === id);
    if (!head) return false;
    const active = this.state.record;
    if (active?.session.id === id && (active.instance !== head.instance || active.revision !== head.revision)) {
      this.report(new Error('当前会话已被其他持有者修改，请保留草稿后重新读取，不能仅凭目录修订确认旧正文')); return false;
    }
    return this.write({ version: 1, request: { action: 'set-pin', sessionId: id, instance: head.instance,
      expectedRevision: head.revision, pinned, operationId: this.id() } }, 'ordinary');
  };
  prepareCleanup = (ids: string[]): TeaCleanupSelection | null => {
    if (!this.allowed() || !ids.length || ids.length > 50 || new Set(ids).size !== ids.length) return null;
    const rows = ids.map(id => this.state.directory.find(row => row.id === id));
    if (rows.some(row => !row || row.pinnedAt > 0 || row.id === this.state.record?.session.id)) return null;
    return Object.freeze({ directory: this.state.directory, incarnation: this.incarnation,
      targets: Object.freeze(rows.map(row => Object.freeze({ sessionId: row!.id, instance: row!.instance, expectedRevision: row!.revision }))), titles: Object.freeze(rows.map(row => row!.title)) });
  };
  deleteSelected = async (selection: TeaCleanupSelection): Promise<boolean> => {
    if (!this.allowed() || selection.directory !== this.state.directory || selection.incarnation !== this.incarnation
      || !selection.targets.length || selection.targets.length > 50
      || selection.targets.some(target => target.sessionId === this.state.record?.session.id || !this.state.directory.some(row => row.id === target.sessionId
        && row.instance === target.instance && row.revision === target.expectedRevision && row.pinnedAt === 0))) {
      this.report(new Error('清理范围已变化，请重新选择并确认')); return false;
    }
    return this.write({ version: 1, request: { action: 'delete-selected', operationId: this.id(), targets: selection.targets.map(row => ({ ...row })) } }, 'ordinary');
  };
  update = async (patch: Partial<MagicTeaPartySession>): Promise<boolean> => {
    if (!this.allowed() || !this.state.record) return false;
    const { instance, revision, session } = this.state.record;
    const next = { ...session, ...(this.state.summaryDraft === null ? {} : editedTeaSummary(session, this.state.summaryDraft, this.now())), draft: this.state.input, ...(this.state.titleDraft === null ? {} : { title: this.state.titleDraft }), ...patch,
      settings: { ...session.settings, ...patch.settings, ...(this.state.nameDraft === null ? {} : { userDisplayName: this.state.nameDraft }) },
      id: session.id, createdAt: session.createdAt, updatedAt: this.now() };
    const { playerRoleId } = resolveMagicTeaPartyPlayerIdentity({ roles: next.roles,
      playerRoleId: typeof next.playerRoleId === 'string' ? next.playerRoleId : null });
    return this.write({ version: 1, request: { action: 'update', sessionId: session.id, instance, expectedRevision: revision,
      session: { ...next, playerRoleId } } }, 'ordinary');
  };
  updateSettings = (patch: Partial<MagicTeaPartySession['settings']>) => {
    this.cancelAutomaticIntent();
    if (!this.state.record) return Promise.resolve(false);
    const original = this.state.record.session.settings;
    const plan = original.outputPlan && typeof original.outputPlan === 'object' && !Array.isArray(original.outputPlan)
      ? original.outputPlan as Record<string, unknown> : {};
    const choices = patch.enableChoices === false ? 'off' : plan.choices === 'on' ? 'on' : 'auto';
    return this.update({ settings: { ...original, ...patch,
      ...(typeof patch.enableChoices === 'boolean' ? { outputPlan: { ...plan, choices } as MagicTeaPartySession['settings']['outputPlan'] } : {}) } });
  };
  saveDraft = async (): Promise<boolean> => {
    if (!this.state.record || this.state.input === (this.state.record.session.draft ?? '') && this.state.titleDraft === null && this.state.nameDraft === null && this.state.summaryDraft === null) return true;
    return this.update({ draft: this.state.input });
  };
  delete = async (expectedIncarnation: number, expectedId: string, expectedInstance: string, expectedRevision: number) => {
    if (!this.allowed() || expectedIncarnation !== this.incarnation || this.state.record?.session.id !== expectedId) return;
    const record = this.state.record;
    if (record.instance !== expectedInstance || record.revision !== expectedRevision || this.isBusy()) {
      this.report(new Error('会话或草稿已变化，请先保存并重新确认删除')); return;
    }
    await this.write({ version: 1, request: { action: 'delete', sessionId: expectedId, instance: record.instance, expectedRevision: record.revision } }, 'ordinary');
  };
  private async write(input: TeaWriteRequest, purpose: Pending['purpose']): Promise<boolean> {
    if (!this.live) return false;
    const owner = this.incarnation;
    let write: TeaWriteRequest;
    try { write = cloneWrite(input); } catch { this.report(new Error('内容超过桌面文本存储边界，原输入和未保存结果已保留，可导出后处理')); return false; }
    const pending = { write, purpose, unknown: false }; this.pending = pending;
    this.publish({ busy: true, pending: 'save', error: null, ...(purpose === 'merge' ? { mergePreview: null } : {}) });
    try {
      const response = await this.port.mutate(write);
      if (!this.current(owner) || this.pending !== pending) return false;
      await this.saved(pending, response.result, owner); return true;
    } catch (error) {
      if (this.current(owner) && this.pending === pending) {
        if (purpose === 'begin' && this.generation) this.generation.autoFollowupAllowed = false;
        if (purpose === 'begin' && this.generation?.automatic && !this.generation.dispatched) {
          // The initial call is the only authority to dispatch an automatic request.
          // Neither a retry nor a recovered receipt may turn it into a later charge.
          this.generation.stopped = true; this.generation.controller.abort();
        }
        pending.unknown = !(error instanceof TeaStorageError) || error.writeEvidence === 'unknown';
        const prefix = this.generation?.automatic ? '剧情已保存；自动摘要' : '本次';
        const staleMerge = purpose === 'merge' && error instanceof TeaStorageError && ['tea-stale', 'tea-missing', 'tea-busy', 'tea-invalid'].includes(error.code);
        this.publish({ busy: false, generating: false, pending: pending.unknown ? 'unknown' : 'save',
          error: pending.unknown ? `${prefix}保存结果未知，请核对原操作；不会重新调用模型` : staleMerge
            ? '父会话或分支已变化、正在生成或锚点已被替换；请放弃此未提交的合并，再重新审阅，必要时重新建立分支'
            : `${prefix}保存未完成，请重试原保存或导出保留内容` });
      }
      if (this.current(owner) && this.pending !== pending) { this.publish({ busy: false, error: '保存已确认，但重新读取失败，请刷新会话' }); return true; }
      return false;
    }
  }
  private async saved(pending: Pending, result: TeaWriteResponse['result'], owner: number) {
    const manualSummaryDraft = this.generation?.automatic ? this.state.summaryDraft : null;
    this.pending = null;
    this.publish({ pending: 'none', busy: true, error: null });
    if (result.action === 'merge') { this.consecutiveDroppedTurns = 0; this.publish({ mergePreview: null, notice: '分支合并已保存；父会话旧历史和源分支均保留，不会自动生成' }); }
    if (result.action === 'fork') this.publish({ editingMessageId: null, editingDraft: '', notice: '已打开新分支，原会话保持不变；可手动续写' });
    if (result.action === 'begin-generation') {
      const generation = this.generation;
      if (!generation || generation.owner !== owner || generation.begin.operationId !== result.operationId) return;
      this.publish({ record: { instance: result.instance, revision: result.revision, session: generation.begin.session }, input: generation.begin.session.draft ?? '', titleDraft: null, nameDraft: null, summaryDraft: manualSummaryDraft,
        messages: [...this.state.messages.slice(-98), ...(generation.begin.userMessage ? [generation.begin.userMessage] : []), { ...generation.begin.assistantMessage, ...(generation.kind === 'summary' ? { meta: { kind: 'summary' } } : {}) }] });
      if (!generation.stopped && generation.credentialCurrent()) await this.dispatch(generation);
      else await this.finish(generation, { completion: 'stopped', rawText: '', reasoning: '' });
      return;
    }
    if (result.action === 'finish-generation') { this.generation?.release(); this.generation = null; this.publish({ rawUnsaved: null, generating: false, generationKind: null, isAutoSummarizing: false }); }
    if (result.action === 'set-pin') {
      const record = this.state.record;
      if (record && record.session.id === result.sessionId && record.instance === result.instance) {
        const session = { ...record.session };
        if (result.pinnedAt > 0) { session.pinnedAt = result.pinnedAt; session.pinnedOrder = result.pinnedOrder; }
        else { delete session.pinnedAt; delete session.pinnedOrder; }
        // Organization never reloads the active editor or persists/clears its drafts.
        this.publish({ record: { ...record, revision: result.revision, session } });
      }
    }
    else if (result.action === 'delete-selected') this.publish({ notice: `已删除所选 ${result.sessions.length} 个会话；当前编辑保持不变` });
    else if (result.action === 'delete') this.publish({ record: null, messages: [], messageCursor: null, input: '', notice: '会话已删除' });
    else if ('sessionId' in result) {
      try { await this.loadRecord(result.sessionId, owner, undefined, result.action === 'merge' ? result.instance : undefined); }
      finally { if (this.current(owner) && manualSummaryDraft !== null && result.action === 'finish-generation') this.publish({ summaryDraft: manualSummaryDraft }); }
    }
    else if (result.action === 'import') {
      this.publish({ notice: '整批导入已提交；可从会话列表打开。媒体未恢复，JSONL 仍有原格式损耗边界' });
      // A historical receipt may refer to sessions deleted later; never recreate them.
    }
    if (this.current(owner)) {
      await this.loadDirectory(owner); this.publish({ busy: false });
    }
  }
  resolvePending = async () => {
    const pending = this.pending; if (!pending || this.state.busy || !this.live) return;
    const owner = this.incarnation; this.publish({ busy: true, error: null });
    try {
      const write = pending.write.request;
      if (write.action === 'merge' || write.action === 'fork' || write.action === 'import' || write.action === 'begin-generation' || write.action === 'finish-generation' || write.action === 'set-pin' || write.action === 'delete-selected') {
        const response = await this.port.read({ version: 1, request: { action: 'receipt', write: pending.write } });
        if (!this.current(owner) || this.pending !== pending) return;
        if (response.result.action !== 'receipt') throw new Error('保存回执不匹配');
        if (response.result.receipt) { await this.saved(pending, response.result.receipt.result, owner); return; }
        pending.unknown = false;
        this.publish({ pending: 'save', notice: '已确认原操作未提交，可重试同一保存；不会重复调用模型' });
      } else {
        const id = write.action === 'create' ? write.session.id : write.sessionId;
        const response = await this.port.read({ version: 1, request: { action: 'session', sessionId: id, expectedCatalogRevision: null } });
        if (!this.current(owner) || this.pending !== pending) return;
        if (response.result.action !== 'session') throw new Error('会话回执不匹配');
        const record = response.result.record;
        if (write.action === 'delete' && !record) {
          await this.saved(pending, { action: 'delete', sessionId: write.sessionId, instance: write.instance, revision: write.expectedRevision }, owner); return;
        }
        if (write.action !== 'delete' && record && canonical(record.session) === canonical(write.session)
          && (write.action === 'create' ? record.revision === 1 : record.instance === write.instance && record.revision === write.expectedRevision + 1)) {
          await this.saved(pending, { action: write.action, sessionId: id, instance: record.instance, revision: record.revision } as TeaWriteResponse['result'], owner); return;
        }
        if (write.action === 'create' ? !record : record?.instance === write.instance && record.revision === write.expectedRevision) {
          pending.unknown = false; this.publish({ pending: 'save', notice: '原写入尚未生效，可重试原操作' });
        } else throw new Error('会话已发生其他修改，不能盲目重放。请导出未保存内容，再明确放弃并重新读取');
      }
    } catch (error) { if (this.current(owner)) {
      if (this.pending !== pending) this.publish({ error: '保存已确认，但重新读取失败，请刷新会话' });
      else this.report(error);
    } }
    finally { if (this.current(owner)) this.publish({ busy: false }); }
  };
  retryPending = async () => {
    if (!this.live || !this.pending || this.pending.unknown || this.state.busy) return;
    const pending = this.pending; await this.write(pending.write, pending.purpose);
  };
  abandonPending = async () => {
    if (this.state.busy || !this.live) return;
    if (this.pending?.unknown) { this.report(new Error('保存结果仍未知，请先核对原回执；不能把未知当作未提交而放弃')); return; }
    if (this.pending?.write.request.action === 'merge') {
      this.pending = null; this.publish({ pending: 'none', mergePreview: null, error: null, notice: '已放弃未提交的合并；源分支和草稿保持不变，请重新审阅后再合并' }); return;
    }
    if (this.pending?.write.request.action === 'fork') {
      this.pending = null;
      this.publish({ pending: 'none', error: null, notice: '已放弃未提交的分支保存；原会话和消息编辑草稿保持不变' });
      return;
    }
    if (this.pending?.write.request.action === 'set-pin' || this.pending?.write.request.action === 'delete-selected') {
      this.pending = null;
      const owner = this.incarnation;
      this.publish({ pending: 'none', busy: true, error: null, notice: '已放弃未提交的组织操作；当前编辑和草稿保持不变' });
      try { await this.loadDirectory(owner); } catch (error) { if (this.current(owner)) this.report(error); }
      finally { if (this.current(owner)) this.publish({ busy: false }); }
      return;
    }
    const generation = this.generation;
    const manualSummaryDraft = generation?.automatic ? this.state.summaryDraft : null;
    if (generation && generation.dispatched && this.state.record) {
      const record = this.state.record;
      generation.controller.abort();
      const assistantMessage = { ...generation.begin.assistantMessage, status: 'error' as const,
        error: { code: 'discarded', message: '用户明确放弃未保存结果' }, meta: { ...(generation.kind === 'summary' ? { kind: 'summary', rawOutput: generation.rawText } : {}), completion: 'discarded' } };
      await this.write({ version: 1, request: { action: 'finish-generation', sessionId: record.session.id, instance: record.instance,
        expectedRevision: record.revision, operationId: this.id(), beginOperationId: generation.begin.operationId,
        session: record.session, assistantMessage } }, 'finish');
      return;
    }
    this.generation?.controller.abort(); this.generation?.release(); this.generation = null; this.pending = null;
    const id = this.state.record?.session.id; const owner = this.nextOwner();
    this.publish({ pending: 'none', rawUnsaved: null, generating: false, error: null, notice: '已明确放弃易失结果；数据库中已提交的内容仍保留', generationKind: null, isAutoSummarizing: false, busy: true });
    try {
      if (id) await this.loadRecord(id, owner);
      if (this.current(owner) && manualSummaryDraft !== null) this.publish({ summaryDraft: manualSummaryDraft });
      await this.loadDirectory(owner);
    }
    catch (error) { if (this.current(owner)) this.report(error); }
    finally { if (this.current(owner)) this.publish({ busy: false }); }
  };
  start = async (target: ResolvedDesktopAiTarget, options: DesktopAiExecutionOptions, credentialCurrent: () => boolean,
    intent: DesktopTeaIntent = { kind: 'reply', text: this.state.input }) => {
    if (this.state.isAutoSummarizing) {
      this.cancelAutomaticIntent(); this.publish({ notice: '已停止自动摘要；请等待原保存确认后再次生成，未排队或补发模型请求' }); return;
    }
    this.cancelAutomaticIntent();
    return this.startGeneration(target, options, credentialCurrent, intent);
  };
  private startGeneration = async (target: ResolvedDesktopAiTarget, options: DesktopAiExecutionOptions, credentialCurrent: () => boolean,
    intent: DesktopTeaIntent, automatic = false) => {
    if (!this.allowed() || !this.state.record) return;
    const record: TeaRecord = { ...this.state.record, session: { ...this.state.record.session,
      ...(this.state.summaryDraft === null ? {} : editedTeaSummary(this.state.record.session, this.state.summaryDraft, this.now())),
      ...(this.state.titleDraft === null ? {} : { title: this.state.titleDraft }),
      settings: { ...this.state.record.session.settings, ...(this.state.nameDraft === null ? {} : { userDisplayName: this.state.nameDraft }) } } }; const owner = this.incarnation; const input = this.state.input; const at = this.now();
    const text = 'text' in intent ? intent.text : null;
    if (text !== null && !text.trim()) return;
    const preserveDraft = intent.kind !== 'reply';
    const kind = intent.kind === 'choices' ? 'choices' : intent.kind === 'summary' ? 'summary' : 'chat';
    const outputFormat = kind === 'summary' ? 'markdown' : kind === 'choices' ? 'jsonl' : desktopTeaSettings(record.session.settings).outputFormat ?? 'jsonl';
    this.publish({ busy: true, generating: true, generationKind: kind, isAutoSummarizing: automatic, error: null });
    const preparation = { cancelled: false, automatic }; this.preparation = preparation;
    const requestId = this.id();
    const { playerRoleId, speakerName } = resolveMagicTeaPartyPlayerIdentity({ roles: record.session.roles,
      playerRoleId: typeof record.session.playerRoleId === 'string' ? record.session.playerRoleId : null,
      userDisplayName: desktopTeaSettings(record.session.settings).userDisplayName });
    record.session = { ...record.session, playerRoleId };
    const userMessage: TeaMessageDocument | null = text === null ? null : { id: this.id(), sessionId: record.session.id, role: 'user', content: text, createdAt: at, status: 'done',
      ...(playerRoleId ? { speakerId: playerRoleId } : {}), meta: { speakerName } };
    try {
      const current = () => this.current(owner) && !preparation.cancelled && credentialCurrent();
      const summary = kind === 'summary' ? automatic
        ? await prepareTeaAutoSummaryRequest(this.port, record, target, requestId, current, this.consecutiveDroppedTurns)
        : await prepareTeaSummaryRequest(this.port, record, target, requestId, current) : null;
      if (automatic && !summary) return;
      let droppedRatio = 0;
      const request = summary?.request ?? await prepareTeaDirectRequest(this.port, record, target, userMessage, requestId, current,
        kind === 'choices' ? 'choices' : 'chat', value => { droppedRatio = value; });
      if (!current()) return;
      const begin: Generation['begin'] = { action: 'begin-generation', sessionId: record.session.id, instance: record.instance, expectedRevision: record.revision,
        operationId: this.id(), session: { ...record.session, updatedAt: at, draft: preserveDraft ? input : '',
          ...(summary?.autoSummaryThroughMessageId ? { autoSummaryState: { lastAttemptedThroughMessageId: summary.autoSummaryThroughMessageId } } : {}) }, userMessage,
        assistantMessage: { id: this.id(), sessionId: record.session.id, role: 'assistant', content: '', createdAt: at, status: 'streaming' } };
      let release!: () => void; const completed = new Promise<void>(resolve => { release = resolve; });
      const generation: Generation = { owner, kind, automatic, autoFollowupAllowed: true, target, droppedRatio, current, ...(summary ? { summaryMeta: summary.summaryMeta } : {}), outputFormat, controller: new AbortController(), dispatched: false, request, options, credentialCurrent, begin, rawText: '', reasoning: '', stopped: false, completed, release };
      this.generation = generation;
      const began = await this.write({ version: 1, request: begin }, 'begin');
      if (!began && (!this.current(owner) || this.generation !== generation || !this.pending)) {
        // Release only this preparation; a late reply cannot retire a replacement owner.
        generation.release();
        if (this.current(owner) && this.generation === generation && !this.pending) {
          this.generation = null;
          this.publish({ busy: false, generating: false, generationKind: null, pending: 'none' });
        }
      }
      await completed;
    } catch (error) { if (this.current(owner) && !preparation.cancelled && credentialCurrent()) this.report(error); }
    finally { if (this.preparation === preparation) this.preparation = null; if (this.current(owner) && !this.generation?.dispatched) this.publish({ busy: false, generating: false, generationKind: null, isAutoSummarizing: false }); }
  };
  private async dispatch(generation: Generation) {
    if (!this.current(generation.owner) || this.generation !== generation || generation.dispatched) return;
    generation.dispatched = true; // A historical begin can never grant a second dispatch.
    this.publish({ busy: true, generating: true });
    const outcome = await executeTeaDirect(generation.options, generation.request, generation.controller.signal, (text, reasoning) => {
      if (!this.current(generation.owner) || this.generation !== generation || generation.stopped) return;
      if (!generation.credentialCurrent()) { generation.stopped = true; generation.controller.abort(); return; }
      generation.rawText = text; generation.reasoning = reasoning;
      this.publish({ rawUnsaved: text, messages: this.state.messages.map(message => message.id === generation.begin.assistantMessage.id ? {
        ...message, content: text, meta: { ...message.meta, ...(generation.kind === 'summary' ? { kind: 'summary' } : {}), ...teaReasoningMeta(reasoning, 'streaming') },
      } : message) });
    });
    if (!this.current(generation.owner) || this.generation !== generation) return;
    await this.finish(generation, generation.stopped || !generation.credentialCurrent()
      ? { completion: 'stopped', rawText: generation.rawText, reasoning: generation.reasoning } : outcome);
  }
  private async finish(generation: Generation, outcome: TeaDirectOutcome) {
    if (!this.current(generation.owner) || this.generation !== generation || this.pending?.purpose === 'finish') return;
    this.publish({ generating: false, rawUnsaved: outcome.rawText, busy: false });
    if (!this.current(generation.owner) || this.generation !== generation) return;
    // A synchronous UI intent may stop the result before its terminal write is frozen.
    const terminalOutcome: TeaDirectOutcome = generation.stopped || !generation.credentialCurrent()
      ? { completion: 'stopped', rawText: outcome.rawText, reasoning: outcome.reasoning } : outcome;
    generation.outcome = terminalOutcome;
    const record = this.state.record;
    if (!record) return;
    const message = teaTerminalMessage(generation.begin.assistantMessage, terminalOutcome, generation.outputFormat, generation.kind);
    const { tokenCount: _tokenCount, ...summaryExtensions } = record.session.summaryMeta && typeof record.session.summaryMeta === 'object' && !Array.isArray(record.session.summaryMeta) ? record.session.summaryMeta as Record<string, unknown> : {};
    const write: TeaWriteRequest = { version: 1, request: { action: 'finish-generation', sessionId: record.session.id, instance: record.instance,
      expectedRevision: record.revision, operationId: this.id(), beginOperationId: generation.begin.operationId,
      session: { ...record.session, updatedAt: this.now(), ...(message.meta?.choicesValid === true ? { lastChoices: message.choices } : {}),
        ...(generation.kind === 'summary' && message.status === 'done' ? { summary: message.content, summarySections: undefined,
          summaryMeta: { ...summaryExtensions, ...generation.summaryMeta, updatedAt: this.now() } } : {}) }, assistantMessage: message } };
    const committed = await this.write(write, 'finish');
    if (!committed && this.current(generation.owner) && this.generation === generation && !this.pending) {
      // The document admission gate failed before IPC. Retain the exact result for export; no model retry.
      this.publish({ pending: 'save', busy: false });
    }
    // Only the original, known-success finish path grants this one additional attempt.
    // Generic saved()/receipt/retry paths deliberately cannot call this code again.
    if (!committed || !generation.autoFollowupAllowed || generation.kind !== 'chat' || generation.stopped || terminalOutcome.completion !== 'provider'
      || message.status !== 'done' || !message.content.trim() || !generation.current()
      || Array.isArray(message.meta?.notices) && message.meta.notices.some(notice => notice && typeof notice === 'object' && notice.level === 'error')
      || !this.allowed() || this.state.summaryDraft !== null || this.state.record?.instance !== record.instance || this.state.record.revision !== record.revision + 1
      || this.state.record.session.id !== record.session.id) return;
    this.consecutiveDroppedTurns = generation.droppedRatio > 0.3 ? Math.min(2, this.consecutiveDroppedTurns + 1) : 0;
    if (this.state.record.session.settings.autoSummaryEnabled === true) {
      await this.startGeneration(generation.target, generation.options, generation.credentialCurrent, { kind: 'summary' }, true);
    }
  }
  stop = () => {
    if (this.preparation) this.preparation.cancelled = true;
    const generation = this.generation;
    if (!generation) return;
    generation.stopped = true; generation.controller.abort();
    // A terminal write already in flight is immutable; stop cannot create another terminal body.
    this.publish({ generating: false, notice: '已停止接收，保留已接受前缀；请等待保存结果' });
  };
  importText = async (text: string, format: 'json' | 'jsonl', confirmWarnings: (_warnings: string[]) => boolean = () => false) => {
    if (!this.allowed()) return;
    const owner = this.incarnation;
    try {
      const plan = prepareDesktopTeaImport(text, format, this.id, this.now());
      if (plan.warnings.length) { this.publish({ notice: plan.warnings.join('\n') }); if (!confirmWarnings(plan.warnings)) return; }
      if (!this.current(owner) || !this.allowed() || !await this.saveDraft() || !this.current(owner) || !this.allowed()) return;
      await this.write(plan.write, 'import');
    } catch (error) { if (this.current(owner)) this.report(error); }
  };
  export = async (format: 'json' | 'jsonl' | 'archive') => {
    const owner = this.incarnation;
    if (!this.allowed() || !await this.saveDraft() || !this.current(owner) || !this.allowed()) throw new Error('请先处理在途保存，再导出完整档案');
    this.publish({ busy: true });
    try { return await exportDesktopTea(this.port, this.state.record?.session.id ?? null, format, () => this.current(owner)); }
    finally { if (this.current(owner)) this.publish({ busy: false }); }
  };
  private summaryDraftText = (): string | null => {
    const session = this.state.record?.session;
    if (session && this.state.summaryDraft !== null) return JSON.stringify({ ...session,
      ...editedTeaSummary(session, this.state.summaryDraft, this.now()), draft: this.state.input,
      ...(this.state.titleDraft === null ? {} : { title: this.state.titleDraft }),
      settings: { ...session.settings, ...(this.state.nameDraft === null ? {} : { userDisplayName: this.state.nameDraft }) },
    }, null, 2);
    return null;
  };
  unsavedSummaryText = () => this.summaryDraftText() ?? this.unsavedText();
  unsavedText = () => {
    if (this.state.rawUnsaved !== null) return this.state.rawUnsaved;
    if (this.pending) return JSON.stringify(this.pending.write, null, 2);
    if (this.state.editingMessageId && this.state.record) return JSON.stringify({ sessionId: this.state.record.session.id,
      instance: this.state.record.instance, expectedRevision: this.state.record.revision,
      anchorMessageId: this.state.editingMessageId, editedContent: this.state.editingDraft }, null, 2);
    return this.summaryDraftText() ?? this.state.input;
  };
}
