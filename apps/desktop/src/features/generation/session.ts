import type { AIReasoningEnvelope } from '@mahoshojo/contracts/ai-reasoning';
import type { OnlineDataCardType } from '@mahoshojo/contracts/data-cards';
import { deriveLocalDataCardIdV1, digestLocalCardPayloadV1 } from '@mahoshojo/local-library/digest';
import { LocalCardRecordV1Schema, type LocalCardExecutionProvenance } from '@mahoshojo/local-library/record';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';
import {
  GenerationTransportError,
  type DesktopExecutionMode,
  type DesktopGenerationIntent,
  type DesktopGenerationOutcome,
  type GenerationResultCardData,
} from './executor';

const MAX_DRAFT_CHARACTERS = 4 * 1024 * 1024;
const STREAM_DRAFT_SAVE_INTERVAL_MS = 1000;

export interface GenerationDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type Mode = DesktopExecutionMode;
type Phase = 'idle' | 'generating' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
const EXECUTION_MODES: readonly Mode[] = ['direct-local', 'direct-remote', 'hosted-stream', 'hosted-json'];
const STORED_PHASES: readonly string[] = ['idle', 'completed', 'failed', 'cancelled', 'uncertain'];

export interface GenerationStoredOutput<TCardKind extends string> {
  mode: Mode;
  cardKind?: TCardKind;
  card: GenerationResultCardData | null;
  rawText: string;
  phase: Exclude<Phase, 'generating'>;
}

/** 持久化草稿：家族字段（`TDraft`）+ 公共版本号/输出版块。 */
export type StoredGenerationDraft<TDraft, TCardKind extends string> = TDraft & {
  version: 1;
  savedAt?: number;
  output?: GenerationStoredOutput<TCardKind>;
};

export type GenerationExecutor<
  TInput,
  TIntent extends DesktopGenerationIntent = DesktopGenerationIntent,
  TCardKind extends string = string,
> = (
  options: DesktopAiExecutionOptions,
  input: TInput,
  intent: TIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
) => Promise<DesktopGenerationOutcome<TCardKind>>;

/**
 * 通用生成会话家族描述符（D5.1-G2）：草稿字段解析、残余草稿判定、
 * 卡片校验/标题/卡库类型/签名归属按家族注入；草稿闸门、取消、
 * uncertain 投影与保存 provenance 的语义家族间一致。
 */
export interface GenerationSessionFamily<
  TDraft,
  TInput,
  TIntent extends DesktopGenerationIntent = DesktopGenerationIntent,
  TCardKind extends string = string,
> {
  /** 草稿 localStorage 键。 */
  draftKey: string;
  /** 缺省结果卡 kind（草稿未声明 cardKind 或恢复无卡输出时的兜底）。 */
  defaultCardKind: TCardKind;
  /**
   * 家族字段解析（不含 version/output——公共件另行校验组装）。
   * 抛 Error 则整份草稿判为损坏并进入保护阻断。
   */
  parseDraftFields(value: Record<string, unknown>): TDraft;
  /** 持久化 cardKind 归一化：未声明/非法值回退 `defaultCardKind`。 */
  normalizeStoredCardKind(value: unknown): TCardKind;
  /**
   * 「残余草稿」判定：不含用户内容的空壳（自动写回产物）直接静默应用，
   * 不占用「恢复/清除」门禁。
   */
  isResidueDraft(draft: StoredGenerationDraft<TDraft, TCardKind>): boolean;
  /** 结果卡校验（generate 完成、草稿恢复、保存前共用）；抛 Error 即判损坏。 */
  validateCard(kind: TCardKind, value: unknown): GenerationResultCardData;
  /** 卡库 `cardType` 归属（character/scenario/history/questionnaire）。 */
  cardTypeOf(kind: TCardKind): OnlineDataCardType;
  /** 保存到本地卡库时的标题推导。 */
  titleOf(kind: TCardKind, card: GenerationResultCardData): string;
  /** 新鲜 hosted-json 响应可如实记录的签名字段；无签名通路返回 undefined。 */
  signatureFrom(kind: TCardKind, card: GenerationResultCardData): string | undefined;
  /** 非签名可信通路（草稿恢复的 direct/流式、本机即时产出）剥除混入的签名字段。 */
  stripSignature(card: GenerationResultCardData): void;
  /** 本机即时产出的卡归一化（如问卷家族补 `userAnswers=[]`）。 */
  prepareLocalCard?(card: GenerationResultCardData): void;
  /** 缺省生成执行器（家族绑定的 execute 包装；测试可经 `execute` 依赖注入替身）。 */
  executeGeneration: GenerationExecutor<TInput, TIntent, TCardKind>;
}

export interface GenerationSessionState<TDraft, TCardKind extends string = string> {
  draft: TDraft;
  pendingRestore: boolean;
  draftError: string | null;
  draftSaved: boolean;
  draftSavedAt: number | null;
  phase: Phase;
  /** 只描述本次派发的输出形态，不从可编辑草稿推断，也不持久化。 */
  activeGenerationMode: 'stream' | 'non-stream' | null;
  rawText: string;
  card: GenerationResultCardData | null;
  cardKind: TCardKind;
  /** 当前卡来自可编辑 localStorage 草稿恢复（而非本次会话的新响应），签名可信度要降级表述。 */
  resultRestored: boolean;
  reasoning: AIReasoningEnvelope | null;
  message: string | null;
  saving: boolean;
  saveStatus: 'idle' | 'saved' | 'already-present' | 'failed';
  saveError: string | null;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** 执行模式 → 本地卡库 provenance execution（hosted 两通路统一记 'hosted'）。 */
const modeExecutionProvenance = (mode: Mode): LocalCardExecutionProvenance =>
  mode === 'hosted-stream' || mode === 'hosted-json' ? 'hosted' : mode;

/**
 * 单个页面生命周期中的生成意图所有者（D5.1-G2 泛化）：草稿读写/闸门、
 * 取消、uncertain 投影、保存 provenance 与家族无关；家族差异全部经
 * `GenerationSessionFamily` 注入。同步上锁，异步完成后才释放。
 */
export class DesktopGenerationSession<
  TDraft,
  TInput,
  TIntent extends DesktopGenerationIntent = DesktopGenerationIntent,
  TCardKind extends string = string,
> {
  private state: GenerationSessionState<TDraft, TCardKind>;
  private listeners = new Set<() => void>();
  private pending: StoredGenerationDraft<TDraft, TCardKind> | null = null;
  private blocked = false;
  private editedSinceRead = false;
  private disposed = false;
  private controller: AbortController | null = null;
  private mode: Mode = 'direct-local';
  private draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    protected readonly family: GenerationSessionFamily<TDraft, TInput, TIntent, TCardKind>,
    private readonly dependencies: {
      storage: GenerationDraftStorage;
      repository: CardRepository;
      initialDraft: TDraft;
      execute?: GenerationExecutor<TInput, TIntent, TCardKind>;
      requestId?: () => string;
    },
  ) {
    this.state = { draft: clone(dependencies.initialDraft), pendingRestore: false, draftError: null, draftSaved: true, draftSavedAt: null, phase: 'idle', activeGenerationMode: null, rawText: '', card: null, cardKind: family.defaultCardKind, resultRestored: false, reasoning: null, message: null, saving: false, saveStatus: 'idle', saveError: null };
    try {
      const raw = dependencies.storage.getItem(family.draftKey);
      if (raw !== null) {
        const saved = this.parseDraft(raw);
        // 残余草稿（空壳自动写回）直接应用，不占用「恢复/清除」门禁。
        if (family.isResidueDraft(saved)) this.applyRestoredDraft(saved, false);
        else { this.pending = saved; this.state.pendingRestore = true; }
      }
    } catch {
      this.blocked = true;
      this.state.draftSaved = false;
      this.state.draftError = '旧草稿无法读取，原数据已保留。仍可继续填写和生成；本次内容暂不自动保存，请及时保存到本地库或导出。';
    }
  }
  getSnapshot = (): GenerationSessionState<TDraft, TCardKind> => this.state;
  isBusy = (): boolean => this.controller !== null || this.state.saving;
  hasUnsavedResult = (): boolean => this.state.card !== null && this.state.saveStatus !== 'saved' && this.state.saveStatus !== 'already-present';
  /** Corrupt or future-version storage is preserved until the user explicitly clears it. */
  isDraftBlocked = (): boolean => this.blocked;
  /** 受保护的旧数据不等于新修改；memory-only 工作仍须离开确认。 */
  hasUnsavedDraft = (): boolean => !this.state.pendingRestore && !this.state.draftSaved && (!this.blocked || this.editedSinceRead);
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<GenerationSessionState<TDraft, TCardKind>>): void {
    if (this.disposed) return;
    if (patch.draftSaved === false) this.editedSinceRead = true;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  updateDraft(draft: TDraft): void {
    if (this.disposed || this.state.pendingRestore || this.controller || this.state.saving) return;
    this.publish({ draft: clone(draft), draftSaved: false });
    this.retryDraftSave();
  }
  restoreDraft(announce = true): void {
    if (this.disposed || !this.pending) return;
    const saved = this.pending;
    this.pending = null;
    this.applyRestoredDraft(saved, announce);
  }
  /**
   * 应用一份已解析草稿。`announce` 控制「已恢复草稿」提示：显式点按「恢复草稿」
   * 时如实播报；构造期的残余草稿静默应用，不制造提示噪声。
   */
  private applyRestoredDraft(saved: StoredGenerationDraft<TDraft, TCardKind>, announce: boolean): void {
    if (saved.output) this.mode = saved.output.mode;
    const { version: _version, savedAt, output, ...restoredDraft } = saved;
    this.publish({ draft: clone(restoredDraft) as TDraft, pendingRestore: false, draftSaved: true, draftSavedAt: savedAt ?? null, phase: output?.phase ?? 'idle', card: output?.card ?? null, cardKind: output?.card ? output.cardKind ?? this.family.defaultCardKind : this.family.defaultCardKind, resultRestored: output?.card != null, reasoning: null, rawText: output?.rawText ?? '', message: output?.phase === 'uncertain' ? '已恢复草稿；上次生成的服务器执行结果未能确认，不会自动重新生成。' : announce && output ? '已恢复草稿；不会自动重新生成。' : null });
  }
  discardDraft(): void {
    if (this.disposed || this.controller || this.state.saving) return;
    try {
      this.dependencies.storage.removeItem(this.family.draftKey);
      this.pending = null;
      this.blocked = false;
      this.editedSinceRead = false;
      this.publish({ draft: clone(this.dependencies.initialDraft), pendingRestore: false, draftError: null, draftSaved: true, draftSavedAt: null, phase: 'idle', rawText: '', card: null, cardKind: this.family.defaultCardKind, resultRestored: false, reasoning: null, message: null, saveStatus: 'idle', saveError: null });
    } catch { this.publish({ draftError: '清除草稿失败，原草稿保护仍生效。', draftSaved: false }); }
  }
  retryDraftSave(): void {
    if (this.draftSaveTimer !== null) clearTimeout(this.draftSaveTimer);
    this.draftSaveTimer = null;
    if (this.disposed || this.blocked || this.state.pendingRestore) return;
    const { draft, card, cardKind, rawText, phase } = this.state;
    // hosted-json 在途时被中止/切页：无法确认服务器是否已执行——
    // 草稿持久化为 uncertain 而非干净 cancelled，恢复后继续如实呈现。
    const storedPhase = phase === 'generating'
      ? (this.mode === 'hosted-json' ? 'uncertain' : 'cancelled')
      : phase;
    const savedAt = Date.now();
    const stored: StoredGenerationDraft<TDraft, TCardKind> = { version: 1, ...clone(draft), savedAt, output: { mode: this.mode, cardKind, card, rawText, phase: storedPhase } };
    try {
      const raw = JSON.stringify(stored);
      if (raw.length > MAX_DRAFT_CHARACTERS) throw new Error('草稿超过大小限制');
      this.dependencies.storage.setItem(this.family.draftKey, raw);
      this.publish({ draftSaved: true, draftSavedAt: savedAt, draftError: null });
    } catch { this.publish({ draftSaved: false, draftError: '草稿写入失败，当前内容仅保留在此页面。请重试保存草稿。' }); }
  }
  private scheduleDraftSave(): void {
    // 固定窗口合并，不随 delta 重置计时，持续输出也会定期落盘。
    if (this.draftSaveTimer !== null) return;
    this.draftSaveTimer = setTimeout(() => this.retryDraftSave(), STREAM_DRAFT_SAVE_INTERVAL_MS);
  }
  async generate(
    options: DesktopAiExecutionOptions,
    input: TInput,
    intent: Omit<TIntent, 'requestId'>,
    discardUnsavedResult = false,
  ): Promise<void> {
    if (this.disposed || this.controller || this.state.saving || this.state.pendingRestore) return;
    if (this.hasUnsavedResult() && !discardUnsavedResult) return;
    const controller = new AbortController();
    this.controller = controller;
    this.mode = intent.mode;
    this.publish({ phase: 'generating', activeGenerationMode: intent.mode === 'hosted-stream' || (intent.mode !== 'hosted-json' && intent.generationMode === 'stream') ? 'stream' : 'non-stream', card: null, cardKind: this.family.defaultCardKind, resultRestored: false, reasoning: null, rawText: '', message: null, saveStatus: 'idle', saveError: null, draftSaved: false });
    this.retryDraftSave();
    try {
      const execute = this.dependencies.execute ?? this.family.executeGeneration;
      const outcome = await execute(options, clone(input), { ...intent, requestId: (this.dependencies.requestId ?? (() => crypto.randomUUID()))() } as TIntent, controller.signal, (text: string) => {
        if (this.disposed || controller.signal.aborted) return;
        this.publish({ rawText: text, draftSaved: false });
        this.scheduleDraftSave();
      });
      if (this.disposed) return;
      // 先把执行器带回的正文落进状态再进入分支处理：completed 分支的家族
      // validateCard 可能再次抛错，hosted-json 没有增量正文回调——不先落库
      // （状态意义上），catch 里的 this.state.rawText 仍是空串，已取得的
      // 原文会随异常一并丢失（D5.1-G2-r1 复审）。
      this.publish({ rawText: outcome.rawText });
      if (outcome.status === 'completed' && !controller.signal.aborted) {
        const card = clone(outcome.card);
        // 签名只可能来自本会话派发的 hosted-json 通路；其余意图的结果中混入
        // 签名字段一律剥除——与 parseDraft 对非 hosted 草稿的既有处理同一条
        // 不变量，两个入口（新鲜响应/草稿恢复）对称执行（G2-r1 复审）。
        if (this.mode !== 'hosted-json') this.family.stripSignature(card);
        this.publish({ phase: 'completed', card: this.family.validateCard(outcome.cardKind, card), cardKind: outcome.cardKind, resultRestored: false, reasoning: outcome.reasoning ?? null, rawText: outcome.rawText, message: '生成完成，可保存到本地卡库。' });
      } else if (outcome.status === 'uncertain') {
        // uncertain 不落入 failed/cancelled：服务器是否已执行无从确认，
        // 提示语里必须包含「可能重复调用与费用」的警告，供再生成时复述。
        this.publish({ phase: 'uncertain', rawText: outcome.rawText, reasoning: null, message: outcome.message });
      } else {
        this.publish({ phase: controller.signal.aborted || outcome.status === 'cancelled' ? 'cancelled' : 'failed', rawText: outcome.rawText, reasoning: null, message: outcome.status === 'invalid-output' || outcome.status === 'failed' ? outcome.message : '生成未完成，已保留收到的正文。' });
      }
    } catch (error) {
      this.publish({ phase: controller.signal.aborted ? 'cancelled' : 'failed', rawText: error instanceof GenerationTransportError ? error.rawText : this.state.rawText, reasoning: null, message: error instanceof Error ? error.message : '生成失败。' });
    } finally {
      this.controller = null;
      if (!this.disposed) this.retryDraftSave();
    }
  }
  cancel(): void {
    this.controller?.abort();
    if (!this.state.draftSaved) this.retryDraftSave();
  }
  /**
   * 本地即时产出（「快速随机生成」）：不经任何模型通路，结果与 generate 完成相位
   * 一致——可保存到本地卡库、随草稿恢复、触发未保存确认。执行 provenance 记
   * `direct-local`（纯本机产出，无远端参与者）。
   */
  applyLocalResult(card: GenerationResultCardData, cardKind: TCardKind, discardUnsavedResult = false): void {
    if (this.disposed || this.controller || this.state.saving || this.state.pendingRestore) return;
    if (this.hasUnsavedResult() && !discardUnsavedResult) return;
    this.mode = 'direct-local';
    const normalized = clone(card);
    // 本机即时产出不可能经过 hosted 签名通路：混入的签名字段一律剥除
    //（与 parseDraft 对非 hosted 草稿的处理一致），防止伪造字段随保存落库。
    this.family.stripSignature(normalized);
    this.family.prepareLocalCard?.(normalized);
    this.publish({ phase: 'completed', card: this.family.validateCard(cardKind, normalized), cardKind, resultRestored: false, reasoning: null, rawText: '', message: '已在本机生成，可保存到本地卡库。', saveStatus: 'idle', saveError: null, draftSaved: false });
    this.retryDraftSave();
  }
  clearOutput(): void {
    if (this.disposed || this.isBusy() || this.state.pendingRestore) return;
    this.publish({ phase: 'idle', rawText: '', card: null, cardKind: this.family.defaultCardKind, resultRestored: false, reasoning: null, message: null, saveStatus: 'idle', saveError: null, draftSaved: false });
    this.retryDraftSave();
  }
  /**
   * 签名可信度唯一投影（G2-r1 复审收口）：签名字段是否存在是卡的事实
   * （`family.signatureFrom`），可信级别是通路的事实——只有本会话以
   * hosted-json 意图派发取得的新鲜响应才可记 official-signed；从可编辑
   * localStorage 草稿恢复、或经非签名通路混入的签名字段一律
   * signature-unverified（本机未验证）。结果标题标签与 saveResult 的
   * provenance 都经此取数，页面不得再各自解释签名字段。
   */
  private signatureDisposition(
    kind: TCardKind,
    card: GenerationResultCardData | null,
  ):
    | { kind: 'official-signed' | 'signature-unverified'; signature: string }
    | { kind: 'unsigned'; signature?: undefined } {
    const signature = card === null ? undefined : this.family.signatureFrom(kind, card);
    if (signature === undefined) return { kind: 'unsigned' };
    return {
      signature,
      kind: this.mode === 'hosted-json' && !this.state.resultRestored
        ? 'official-signed'
        : 'signature-unverified',
    };
  }
  /** 当前结果卡的签名可信度（生成结果标题/标签消费，与 saveResult 同源）。 */
  resultSignatureKind(): 'official-signed' | 'signature-unverified' | 'unsigned' {
    return this.signatureDisposition(this.state.cardKind, this.state.card).kind;
  }
  /**
   * 当前结果/在途生成所在的执行通路：generate 派发时同步记录、
   * 草稿恢复时按 output.mode 还原——「通路是否具备官方签名能力」等
   * 通路事实以它为唯一出处，页面不得按结果字段自行推断。
   */
  executionMode(): Mode {
    return this.mode;
  }
  async saveResult(): Promise<boolean> {
    if (this.disposed || this.state.saving || this.controller || this.state.phase !== 'completed' || !this.state.card) return false;
    const card = clone(this.state.card);
    const cardKind = this.state.cardKind;
    const mode = this.mode;
    this.publish({ saving: true, saveError: null });
    try {
      const data = this.family.validateCard(cardKind, card);
      const digest = await digestLocalCardPayloadV1(data);
      if (this.disposed) return false;
      const now = new Date().toISOString();
      const execution = modeExecutionProvenance(mode);
      // 签名归属走同一份投影：official-signed 仅当本会话 hosted-json 新鲜
      // 响应；其余携带签名字段的情形如实记 signature-unverified。
      const disposition = this.signatureDisposition(cardKind, data);
      const title = this.family.titleOf(cardKind, data);
      const record = LocalCardRecordV1Schema.parse({ id: deriveLocalDataCardIdV1(digest), schemaVersion: 1, storageLocation: 'local', cardType: this.family.cardTypeOf(cardKind), title, data, contentDigest: digest, provenance: disposition.signature !== undefined ? { kind: disposition.kind, signature: disposition.signature, execution } : { kind: 'unsigned', execution }, createdAt: now, updatedAt: now });
      const result = await this.dependencies.repository.putIfAbsent(record);
      if ('alreadyPresent' in result) {
        // existing-wins 保留墓碑；已去重不等于用户已有一份活动副本。
        const existing = await this.dependencies.repository.get(record.id);
        if (existing === null) throw new Error('已有记录不可用');
        if (existing.deletedAt !== undefined) {
          this.publish({ saveStatus: 'failed', saveError: '内容相同的数据卡在回收站中，请先到本地库恢复后再保存。生成结果仍保留。' });
          return false;
        }
      }
      this.publish({ saveStatus: 'written' in result ? 'saved' : 'already-present' });
      return !this.disposed;
    } catch { this.publish({ saveStatus: 'failed', saveError: '保存到本地卡库失败，生成结果仍保留。可以重试保存，无需重新生成。' }); return false; }
    finally { this.publish({ saving: false }); }
  }
  dispose(): void { if (!this.state.draftSaved) this.retryDraftSave(); this.disposed = true; this.controller?.abort(); this.listeners.clear(); }

  /* ── 草稿解析（公共件：version/output 校验；家族字段走 parseDraftFields） ── */

  private parseDraft(raw: string): StoredGenerationDraft<TDraft, TCardKind> {
    if (raw.length > MAX_DRAFT_CHARACTERS) throw new Error('草稿超过大小限制');
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.version !== 1) throw new Error('草稿版本不受支持或内容损坏');
    const fields = this.family.parseDraftFields(value);
    const draft: StoredGenerationDraft<TDraft, TCardKind> = { ...fields, version: 1 };
    if (typeof value.savedAt === 'number' && Number.isFinite(value.savedAt) && value.savedAt > 0) draft.savedAt = value.savedAt;
    if (value.output !== undefined) {
      const output = value.output;
      if (!object(output) || !EXECUTION_MODES.includes(output.mode as Mode) || typeof output.rawText !== 'string' || !STORED_PHASES.includes(String(output.phase))) throw new Error('草稿输出损坏');
      const cardKind = this.family.normalizeStoredCardKind(output.cardKind);
      const card = output.card === null ? null : this.family.validateCard(cardKind, output.card);
      // 签名只可能来自 hosted-json 通路；direct/流式草稿中混入的签名字段一律剥除。
      if (card && output.mode !== 'hosted-json') this.family.stripSignature(card);
      if ((output.phase === 'completed') !== (card !== null)) throw new Error('草稿结果状态不一致');
      draft.output = { mode: output.mode as Mode, cardKind, card, rawText: output.rawText, phase: output.phase as Exclude<Phase, 'generating'> };
    }
    return draft;
  }
}
