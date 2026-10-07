import type { AIReasoningEnvelope } from '@mahoshojo/contracts/ai-reasoning';
import {
  normalizeQuestionnaireDefinition,
  type QuestionnaireKind,
} from '@mahoshojo/domain/questionnaire-definition';
import {
  normalizeStoredQuestionnaireSelection,
  questionnaireSelectionScopeId,
  resolveQuestionnaireSelectionNativeAllowedFallback,
  type QuestionnaireSelection,
} from '@mahoshojo/domain/questionnaire-selection';
import { deriveLocalDataCardIdV1, digestLocalCardPayloadV1 } from '@mahoshojo/local-library/digest';
import { LocalCardRecordV1Schema, type LocalCardExecutionProvenance } from '@mahoshojo/local-library/record';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';
import {
  QuestionnaireGenerationError,
  type QuestionnaireCardKind,
  type QuestionnaireExecutionMode,
  type QuestionnaireGenerationInput,
  type QuestionnaireGenerationIntent,
  type QuestionnaireGenerationOutcome,
  type QuestionnaireResultCardData,
} from './generation';

const MAX_DRAFT_CHARACTERS = 4 * 1024 * 1024;
const STREAM_DRAFT_SAVE_INTERVAL_MS = 1000;

export interface QuestionnaireDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 问卷页草稿（D5.1-G1 泛化）：回答、语言、选择集、保存方式偏好与「设定说明」
 * 抽屉状态。`/details` 与 `/canshou` 同形，仅存储键不同。
 */
export interface QuestionnaireDraft {
  answers: Record<string, string>;
  language: string;
  /** 多问卷选择集（含 Lore 开关与来源元数据；与 Web 草稿 `questionnaireSelections` 同口径）。 */
  questionnaireSelections?: QuestionnaireSelection[];
  /** 「允许同时回答多份问卷」偏好（与 Web 草稿 `allowMultipleQuestionnaires` 同口径）。 */
  allowMultipleQuestionnaires?: boolean;
  /** 保存方式偏好（与 Web 草稿字段同名；缺省由页面按终端推导）。 */
  imageSaveMode?: 'download' | 'modal';
  jsonSaveMode?: 'download' | 'text';
  /** 「设定说明」抽屉展开状态。 */
  showDetails?: boolean;
}

/** 问卷草稿的默认语言——页面 `initialDraft` 与设置页首写共用同一口径。 */
export const QUESTIONNAIRE_DRAFT_DEFAULT_LANGUAGE = 'zh-CN';

/**
 * 「首写合法文档」工厂（D5.1-S1-r1）：设置页对空草稿键做字段级写入前，
 * 必须先建立一份能过 `parseDraft` 的空壳——`version`/`answers`/`language`
 * 是草稿协议必填面；只写偏好键的裸对象会被判成损坏草稿并触发数据保护
 * （`isDraftBlocked`）。产物不含用户内容，`isResidueDraft` 判真——页面
 * 下次打开静默应用并照常恢复其中残留的偏好字段，不弹「恢复草稿」门禁。
 */
export const createEmptyQuestionnaireDraftDocument = (): Record<string, unknown> => ({
  version: 1,
  answers: {},
  language: QUESTIONNAIRE_DRAFT_DEFAULT_LANGUAGE,
});

/**
 * 问卷会话家族描述符：草稿键、内置问卷身份、结构化卡的归一化与标题映射。
 * 其余语义（草稿闸门、取消、uncertain 投影、保存 provenance）家族间一致。
 */
export interface QuestionnaireSessionFamily<
  TStructuredKind extends string = string,
  TIntent extends QuestionnaireGenerationIntent = QuestionnaireGenerationIntent,
> {
  /** 草稿 localStorage 键。 */
  draftKey: string;
  /** 内置问卷 canonical id——残余草稿判定用。 */
  builtinQuestionnaireId: string;
  /** 草稿 selection 归一化时未声明 kind 的兜底。 */
  draftFallbackKind: QuestionnaireKind;
  /** 结构化卡 kind 标识与保存到本地卡库时的标题字段/兜底标题。 */
  structuredCardKind: TStructuredKind;
  structuredTitleField: string;
  structuredTitleFallback: string;
  /** hosted JSON 结果卡归一化（schema 校验 + 透传字段）。 */
  normalizeStructuredCard(value: unknown): QuestionnaireResultCardData;
  /** 缺省生成执行器（家族绑定的 execute 包装；测试可经 `execute` 依赖注入替身）。 */
  executeGeneration: QuestionnaireExecutor<TIntent, TStructuredKind>;
}

type Card = QuestionnaireResultCardData;
type Mode = QuestionnaireExecutionMode;
type Phase = 'idle' | 'generating' | 'completed' | 'failed' | 'cancelled' | 'uncertain';

export interface QuestionnaireSessionState<TStructuredKind extends string = string> {
  draft: QuestionnaireDraft;
  pendingRestore: boolean;
  draftError: string | null;
  draftSaved: boolean;
  phase: Phase;
  rawText: string;
  card: Card | null;
  cardKind: QuestionnaireCardKind<TStructuredKind>;
  /** 当前卡来自可编辑 localStorage 草稿恢复（而非本次会话的新响应），签名可信度要降级表述。 */
  resultRestored: boolean;
  reasoning: AIReasoningEnvelope | null;
  message: string | null;
  saving: boolean;
  saveStatus: 'idle' | 'saved' | 'already-present' | 'failed';
  saveError: string | null;
}

interface StoredDraft<TStructuredKind extends string = string> extends QuestionnaireDraft {
  version: 1;
  // `cardKind` 在 D5.1a 引入；缺省按家族结构化 kind 解析（此前只有一种卡）。
  output?: {
    mode: Mode;
    cardKind?: QuestionnaireCardKind<TStructuredKind>;
    card: Card | null;
    rawText: string;
    phase: Exclude<Phase, 'generating'>;
  };
}

export type QuestionnaireExecutor<
  TIntent extends QuestionnaireGenerationIntent = QuestionnaireGenerationIntent,
  TStructuredKind extends string = string,
> = (
  options: DesktopAiExecutionOptions,
  input: QuestionnaireGenerationInput,
  intent: TIntent,
  signal: AbortSignal,
  onPartialText?: (text: string) => void,
) => Promise<QuestionnaireGenerationOutcome<TStructuredKind>>;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const EXECUTION_MODES: readonly Mode[] = ['direct-local', 'direct-remote', 'hosted-stream', 'hosted-json'];
const isAnswerList = (value: unknown): boolean =>
  Array.isArray(value) && value.every((answer) => object(answer) && typeof answer.question === 'string' && typeof answer.answer === 'string');

/** 执行模式 → 本地卡库 provenance execution（hosted 两通路统一记 'hosted'）。 */
const modeExecutionProvenance = (mode: Mode): LocalCardExecutionProvenance =>
  mode === 'hosted-stream' || mode === 'hosted-json' ? 'hosted' : mode;

/**
 * 单个页面生命周期中的意图所有者；同步上锁，异步完成后才释放。
 * `/details` 与 `/canshou` 共用（D5.1-G1），家族差异由 `family` 注入。
 */
export class QuestionnaireGenerationSession<
  TStructuredKind extends string = string,
  TIntent extends QuestionnaireGenerationIntent = QuestionnaireGenerationIntent,
> {
  private state: QuestionnaireSessionState<TStructuredKind>;
  private listeners = new Set<() => void>();
  private pending: StoredDraft<TStructuredKind> | null = null;
  private blocked = false;
  private disposed = false;
  private controller: AbortController | null = null;
  private mode: Mode = 'direct-local';
  private draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly family: QuestionnaireSessionFamily<TStructuredKind, TIntent>,
    private readonly dependencies: {
      storage: QuestionnaireDraftStorage;
      repository: CardRepository;
      initialDraft: QuestionnaireDraft;
      execute?: QuestionnaireExecutor<TIntent, TStructuredKind>;
      requestId?: () => string;
    },
  ) {
    this.state = { draft: clone(dependencies.initialDraft), pendingRestore: false, draftError: null, draftSaved: true, phase: 'idle', rawText: '', card: null, cardKind: family.structuredCardKind, resultRestored: false, reasoning: null, message: null, saving: false, saveStatus: 'idle', saveError: null };
    try {
      const raw = dependencies.storage.getItem(family.draftKey);
      if (raw !== null) {
        const saved = this.parseDraft(raw);
        // 残余草稿（空壳自动写回）直接应用，不占用「恢复/清除」门禁。
        if (this.isResidueDraft(saved)) this.applyRestoredDraft(saved, false);
        else { this.pending = saved; this.state.pendingRestore = true; }
      }
    } catch {
      this.blocked = true;
      this.state.draftSaved = false;
      this.state.draftError = '无法读取草稿，可能已损坏或版本不受支持。确认清除前不会覆盖原数据。';
    }
  }
  getSnapshot = (): QuestionnaireSessionState<TStructuredKind> => this.state;
  isBusy = (): boolean => this.controller !== null || this.state.saving;
  hasUnsavedResult = (): boolean => this.state.card !== null && this.state.saveStatus !== 'saved' && this.state.saveStatus !== 'already-present';
  /** Corrupt or future-version storage is preserved until the user explicitly clears it. */
  isDraftBlocked = (): boolean => this.blocked;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<QuestionnaireSessionState<TStructuredKind>>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  updateDraft(draft: QuestionnaireDraft): void {
    if (this.disposed || this.blocked || this.state.pendingRestore || this.controller || this.state.saving) return;
    this.publish({ draft: clone(draft), draftSaved: false });
    this.retryDraftSave();
  }
  restoreDraft(): void {
    if (this.disposed || !this.pending) return;
    const saved = this.pending;
    this.pending = null;
    this.applyRestoredDraft(saved, true);
  }
  /**
   * 应用一份已解析草稿。`announce` 控制「已恢复草稿」提示：显式点按「恢复草稿」
   * 时如实播报；构造期的残余草稿静默应用，不制造提示噪声。
   */
  private applyRestoredDraft(saved: StoredDraft<TStructuredKind>, announce: boolean): void {
    if (saved.output) this.mode = saved.output.mode;
    const restoredDraft: QuestionnaireDraft = {
      answers: clone(saved.answers),
      language: saved.language,
      ...(saved.questionnaireSelections?.length ? { questionnaireSelections: clone(saved.questionnaireSelections) } : {}),
      ...(saved.allowMultipleQuestionnaires ? { allowMultipleQuestionnaires: true } : {}),
      ...(saved.imageSaveMode ? { imageSaveMode: saved.imageSaveMode } : {}),
      ...(saved.jsonSaveMode ? { jsonSaveMode: saved.jsonSaveMode } : {}),
      ...(saved.showDetails ? { showDetails: true } : {}),
    };
    this.publish({ draft: restoredDraft, pendingRestore: false, draftSaved: true, phase: saved.output?.phase ?? 'idle', card: saved.output?.card ?? null, cardKind: saved.output?.card ? saved.output.cardKind ?? this.family.structuredCardKind : this.family.structuredCardKind, resultRestored: saved.output?.card != null, reasoning: null, rawText: saved.output?.rawText ?? '', message: !announce ? null : saved.output?.phase === 'uncertain' ? '已恢复草稿；上次生成的服务器执行结果未能确认，不会自动重新生成。' : saved.output ? '已恢复草稿；不会自动重新生成。' : null });
  }
  discardDraft(): void {
    if (this.disposed || this.controller || this.state.saving) return;
    try {
      this.dependencies.storage.removeItem(this.family.draftKey);
      this.pending = null;
      this.blocked = false;
      this.publish({ draft: clone(this.dependencies.initialDraft), pendingRestore: false, draftError: null, draftSaved: true, phase: 'idle', rawText: '', card: null, cardKind: this.family.structuredCardKind, resultRestored: false, reasoning: null, message: null, saveStatus: 'idle', saveError: null });
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
    const stored: StoredDraft<TStructuredKind> = { version: 1, ...draft, output: { mode: this.mode, cardKind, card, rawText, phase: storedPhase } };
    try {
      const raw = JSON.stringify(stored);
      if (raw.length > MAX_DRAFT_CHARACTERS) throw new Error('草稿超过大小限制');
      this.dependencies.storage.setItem(this.family.draftKey, raw);
      this.publish({ draftSaved: true, draftError: null });
    } catch { this.publish({ draftSaved: false, draftError: '草稿写入失败，当前内容仅保留在此页面。请重试保存草稿。' }); }
  }
  private scheduleDraftSave(): void {
    // 固定窗口合并，不随 delta 重置计时，持续输出也会定期落盘。
    if (this.draftSaveTimer !== null) return;
    this.draftSaveTimer = setTimeout(() => this.retryDraftSave(), STREAM_DRAFT_SAVE_INTERVAL_MS);
  }
  async generate(
    options: DesktopAiExecutionOptions,
    input: QuestionnaireGenerationInput,
    intent: Omit<TIntent, 'requestId'>,
    discardUnsavedResult = false,
  ): Promise<void> {
    if (this.disposed || this.controller || this.state.saving || this.blocked || this.state.pendingRestore) return;
    if (this.hasUnsavedResult() && !discardUnsavedResult) return;
    const controller = new AbortController();
    this.controller = controller;
    this.mode = intent.mode;
    this.publish({ phase: 'generating', card: null, cardKind: this.family.structuredCardKind, resultRestored: false, reasoning: null, rawText: '', message: null, saveStatus: 'idle', saveError: null, draftSaved: false });
    this.retryDraftSave();
    try {
      const execute = this.dependencies.execute ?? this.family.executeGeneration;
      const outcome = await execute(options, clone(input), { ...intent, requestId: (this.dependencies.requestId ?? (() => crypto.randomUUID()))() } as TIntent, controller.signal, (text: string) => {
        if (this.disposed || controller.signal.aborted) return;
        this.publish({ rawText: text, draftSaved: false });
        this.scheduleDraftSave();
      });
      if (this.disposed) return;
      if (outcome.status === 'completed' && !controller.signal.aborted) {
        this.publish({ phase: 'completed', card: this.validateCard(outcome.cardKind, outcome.card), cardKind: outcome.cardKind, resultRestored: false, reasoning: outcome.reasoning ?? null, rawText: outcome.rawText, message: '生成完成，可保存到本地卡库。' });
      } else if (outcome.status === 'uncertain') {
        // uncertain 不落入 failed/cancelled：服务器是否已执行无从确认，
        // 提示语里必须包含「可能重复调用与费用」的警告，供再生成时复述。
        this.publish({ phase: 'uncertain', rawText: outcome.rawText, reasoning: null, message: outcome.message });
      } else {
        this.publish({ phase: controller.signal.aborted || outcome.status === 'cancelled' ? 'cancelled' : 'failed', rawText: outcome.rawText, reasoning: null, message: outcome.status === 'invalid-output' || outcome.status === 'failed' ? outcome.message : '生成未完成，已保留收到的正文。' });
      }
    } catch (error) {
      this.publish({ phase: controller.signal.aborted ? 'cancelled' : 'failed', rawText: error instanceof QuestionnaireGenerationError ? error.rawText : this.state.rawText, reasoning: null, message: error instanceof Error ? error.message : '生成失败。' });
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
  applyLocalResult(card: Card, cardKind: QuestionnaireCardKind<TStructuredKind>, discardUnsavedResult = false): void {
    if (this.disposed || this.controller || this.state.saving || this.blocked || this.state.pendingRestore) return;
    if (this.hasUnsavedResult() && !discardUnsavedResult) return;
    this.mode = 'direct-local';
    const normalized = clone(card);
    // 本机即时产出不可能经过 hosted 签名通路：混入的 signature 一律剥除
    //（与 parseDraft 对非 hosted 草稿的处理一致），防止伪造字段随保存落库。
    delete normalized.signature;
    // 本机产物没有逐题问卷记录：缺省归一为与 generate() 完成路径同形的空列表
    //（`compactQuestionnaireAnswerItems([])`），与 validateCard 的口径一致。
    if (normalized.userAnswers === undefined) normalized.userAnswers = [];
    this.publish({ phase: 'completed', card: this.validateCard(cardKind, normalized), cardKind, resultRestored: false, reasoning: null, rawText: '', message: '已在本机生成，可保存到本地卡库。', saveStatus: 'idle', saveError: null, draftSaved: false });
    this.retryDraftSave();
  }
  clearOutput(): void {
    if (this.disposed || this.isBusy() || this.blocked || this.state.pendingRestore) return;
    this.publish({ phase: 'idle', rawText: '', card: null, cardKind: this.family.structuredCardKind, resultRestored: false, reasoning: null, message: null, saveStatus: 'idle', saveError: null, draftSaved: false });
    this.retryDraftSave();
  }
  async saveResult(): Promise<boolean> {
    if (this.disposed || this.state.saving || this.controller || this.state.phase !== 'completed' || !this.state.card) return false;
    const card = clone(this.state.card);
    const cardKind = this.state.cardKind;
    const mode = this.mode;
    this.publish({ saving: true, saveError: null });
    try {
      const data = this.validateCard(cardKind, card);
      const digest = await digestLocalCardPayloadV1(data);
      if (this.disposed) return false;
      const now = new Date().toISOString();
      const execution = modeExecutionProvenance(mode);
      const signature = cardKind === this.family.structuredCardKind && mode === 'hosted-json' && typeof data.signature === 'string' && data.signature.trim()
        ? data.signature
        : undefined;
      const title = cardKind === 'general'
        ? (typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '未命名角色')
        : (typeof data[this.family.structuredTitleField] === 'string' && (data[this.family.structuredTitleField] as string).trim() ? (data[this.family.structuredTitleField] as string).trim() : this.family.structuredTitleFallback);
      // 签名字段只如实记录来源：新鲜 hosted 响应 → official-signed；
      // 从可编辑 localStorage 草稿恢复的签名卡 → signature-unverified（本机未验证）。
      const record = LocalCardRecordV1Schema.parse({ id: deriveLocalDataCardIdV1(digest), schemaVersion: 1, storageLocation: 'local', cardType: 'character', title, data, contentDigest: digest, provenance: signature ? { kind: this.state.resultRestored ? 'signature-unverified' : 'official-signed', signature, execution } : { kind: 'unsigned', execution }, createdAt: now, updatedAt: now });
      const result = await this.dependencies.repository.putIfAbsent(record);
      this.publish({ saveStatus: 'written' in result ? 'saved' : 'already-present' });
      return !this.disposed;
    } catch { this.publish({ saveStatus: 'failed', saveError: '保存到本地卡库失败，生成结果仍保留。可以重试保存，无需重新生成。' }); return false; }
    finally { this.publish({ saving: false }); }
  }
  dispose(): void { if (!this.state.draftSaved) this.retryDraftSave(); this.disposed = true; this.controller?.abort(); this.listeners.clear(); }

  /* ── 草稿解析（实例方法：归一化依赖家族参数） ─────────────────────── */

  private validateCard(kind: QuestionnaireCardKind<TStructuredKind>, value: unknown): Card {
    if (kind === 'general') {
      if (!object(value) || typeof value.name !== 'string' || typeof value.content !== 'string') throw new Error('角色卡损坏');
      if (value.userAnswers !== undefined && !isAnswerList(value.userAnswers)) throw new Error('角色卡无问卷记录');
      return { ...value };
    }
    const card = this.family.normalizeStructuredCard(value);
    if (!isAnswerList(card.userAnswers)) throw new Error('角色卡无问卷记录');
    return card;
  }

  private parseDraft(raw: string): StoredDraft<TStructuredKind> {
    if (raw.length > MAX_DRAFT_CHARACTERS) throw new Error('草稿超过大小限制');
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.version !== 1 || !object(value.answers) || typeof value.language !== 'string' || !Object.values(value.answers).every((answer) => typeof answer === 'string')) throw new Error('草稿版本不受支持或内容损坏');
    const draft: StoredDraft<TStructuredKind> = { version: 1, answers: value.answers as Record<string, string>, language: value.language };
    // 选择集逐条经共源归一化：损坏条目丢弃而不是让整个草稿报废（D5.1-P2）。
    const seenScopes = new Set<string>();
    const questionnaireSelections = (Array.isArray(value.questionnaireSelections) ? value.questionnaireSelections : [])
      .map((entry) => normalizeStoredQuestionnaireSelection(entry, {
        normalize: normalizeQuestionnaireDefinition,
        resolveFallback: (rawQuestionnaire, source) => {
          const record = rawQuestionnaire && typeof rawQuestionnaire === 'object'
            ? rawQuestionnaire as Record<string, unknown>
            : {};
          return {
            // 已声明的 kind 优先于兜底（normalize 口径一致），缺省按本家族。
            fallbackKind: record.kind === 'canshou' || record.kind === 'magical-girl' ? record.kind : this.family.draftFallbackKind,
            fallbackId: typeof record.id === 'string' ? record.id : 'questionnaire',
            fallbackTitle: typeof record.title === 'string' ? record.title : '未命名问卷',
            nativeAllowed: resolveQuestionnaireSelectionNativeAllowedFallback(source, rawQuestionnaire),
          };
        },
      }))
      .filter((selection): selection is QuestionnaireSelection => selection !== null)
      // 篡改的草稿可以把本地副本（wire 'upload'）内嵌 questionnaire.nativeAllowed 写成 true：
      // 归一化优先采纳声明值，这里与卡库选择器对本地卡的强制口径保持一致（D5.1-P2-r1）。
      .map((selection) => selection.source === 'upload'
        ? { ...selection, questionnaire: { ...selection.questionnaire, nativeAllowed: false } }
        : selection)
      // 同一作用域的重复选择会让两份问卷的答案键互相覆盖——保留第一条，丢弃其余。
      .filter((selection) => {
        const scope = questionnaireSelectionScopeId(selection);
        if (seenScopes.has(scope)) return false;
        seenScopes.add(scope);
        return true;
      });
    if (questionnaireSelections.length) draft.questionnaireSelections = questionnaireSelections;
    if (value.allowMultipleQuestionnaires === true) draft.allowMultipleQuestionnaires = true;
    if (value.imageSaveMode === 'download' || value.imageSaveMode === 'modal') draft.imageSaveMode = value.imageSaveMode;
    if (value.jsonSaveMode === 'download' || value.jsonSaveMode === 'text') draft.jsonSaveMode = value.jsonSaveMode;
    if (value.showDetails === true) draft.showDetails = true;
    if (value.output !== undefined) {
      const output = value.output;
      if (!object(output) || !EXECUTION_MODES.includes(output.mode as Mode) || typeof output.rawText !== 'string' || !['idle', 'completed', 'failed', 'cancelled', 'uncertain'].includes(String(output.phase))) throw new Error('草稿输出损坏');
      const cardKind = output.cardKind === 'general' ? 'general' as const : this.family.structuredCardKind;
      const card = output.card === null ? null : this.validateCard(cardKind, output.card);
      // 签名只可能来自 hosted 非流式通路；direct/流式草稿中混入的 signature 一律剥除。
      if (card && output.mode !== 'hosted-json' && 'signature' in card) delete card.signature;
      if ((output.phase === 'completed') !== (card !== null)) throw new Error('草稿结果状态不一致');
      draft.output = { mode: output.mode as Mode, cardKind, card, rawText: output.rawText, phase: output.phase as Exclude<Phase, 'generating'> };
    }
    return draft;
  }

  /**
   * 「残余草稿」：自动写回的空壳——没有非空回答、没有生成结果或中断正文、
   * 选择集恰为默认内置问卷。它由「进页面即注入默认选择并落盘」产生，不携带
   * 任何用户内容；对这类草稿弹「发现上次草稿」属于噪声。这类草稿直接静默应用，
   * 而不是走 pending 门禁（D5.1-P2-r1）。注意判定只看用户内容——残留的偏好字段
   * （语言/保存方式等）仍照常恢复。
   */
  private isResidueDraft(draft: StoredDraft<TStructuredKind>): boolean {
    if (Object.values(draft.answers).some((answer) => answer.trim() !== '')) return false;
    const output = draft.output;
    if (output !== undefined && (output.phase !== 'idle' || output.card !== null || output.rawText !== '')) return false;
    const selections = draft.questionnaireSelections ?? [];
    return selections.length <= 1
      && selections.every(
        (selection) => selection.source === 'preset' && selection.questionnaire.id === this.family.builtinQuestionnaireId,
      );
  }
}
