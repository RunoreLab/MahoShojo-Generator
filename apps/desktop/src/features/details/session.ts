import type { AIReasoningEnvelope } from '@mahoshojo/contracts/ai-reasoning';
import { deriveLocalDataCardIdV1, digestLocalCardPayloadV1 } from '@mahoshojo/local-library/digest';
import { LocalCardRecordV1Schema, type LocalCardExecutionProvenance } from '@mahoshojo/local-library/record';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';
import {
  DetailsGenerationError,
  executeDetailsGeneration,
  normalizeMagicalGirlDetailsResultCard,
  type DetailsGenerationInput,
  type DetailsGenerationIntent,
  type DetailsResultCardData,
  type DetailsResultCardKind,
} from './generation';

export const DETAILS_DRAFT_KEY = 'mahoshojo.desktop.details.draft.v1';
const MAX_DRAFT_CHARACTERS = 4 * 1024 * 1024;
const STREAM_DRAFT_SAVE_INTERVAL_MS = 1000;
export interface DetailsDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface DetailsDraft { answers: Record<string, string>; language: string }
type Card = DetailsResultCardData;
type CardKind = DetailsResultCardKind;
type Mode = DetailsGenerationIntent['mode'];
type Phase = 'idle' | 'generating' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
export interface DetailsSessionState {
  draft: DetailsDraft;
  pendingRestore: boolean;
  draftError: string | null;
  draftSaved: boolean;
  phase: Phase;
  rawText: string;
  card: Card | null;
  cardKind: CardKind;
  /** 当前卡来自可编辑 localStorage 草稿恢复（而非本次会话的新响应），签名可信度要降级表述。 */
  resultRestored: boolean;
  reasoning: AIReasoningEnvelope | null;
  message: string | null;
  saving: boolean;
  saveStatus: 'idle' | 'saved' | 'already-present' | 'failed';
  saveError: string | null;
}
interface StoredDraft extends DetailsDraft {
  version: 1;
  // `cardKind` 在 D5.1a 引入；缺省按 'magical-girl' 解析（此前只有一种卡）。
  output?: { mode: Mode; cardKind?: CardKind; card: Card | null; rawText: string; phase: Exclude<Phase, 'generating'> };
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const EXECUTION_MODES: readonly Mode[] = ['direct-local', 'direct-remote', 'hosted-stream', 'hosted-json'];
const isAnswerList = (value: unknown): boolean =>
  Array.isArray(value) && value.every((answer) => object(answer) && typeof answer.question === 'string' && typeof answer.answer === 'string');
const validateCard = (kind: CardKind, value: unknown): Card => {
  if (kind === 'general') {
    if (!object(value) || typeof value.name !== 'string' || typeof value.content !== 'string') throw new Error('角色卡损坏');
    if (value.userAnswers !== undefined && !isAnswerList(value.userAnswers)) throw new Error('角色卡无问卷记录');
    return { ...value };
  }
  const card = normalizeMagicalGirlDetailsResultCard(value);
  if (!isAnswerList(card.userAnswers)) throw new Error('角色卡无问卷记录');
  return card;
};
const parseDraft = (raw: string): StoredDraft => {
  if (raw.length > MAX_DRAFT_CHARACTERS) throw new Error('草稿超过大小限制');
  const value: unknown = JSON.parse(raw);
  if (!object(value) || value.version !== 1 || !object(value.answers) || typeof value.language !== 'string' || !Object.values(value.answers).every((answer) => typeof answer === 'string')) throw new Error('草稿版本不受支持或内容损坏');
  const draft: StoredDraft = { version: 1, answers: value.answers as Record<string, string>, language: value.language };
  if (value.output !== undefined) {
    const output = value.output;
    if (!object(output) || !EXECUTION_MODES.includes(output.mode as Mode) || typeof output.rawText !== 'string' || !['idle', 'completed', 'failed', 'cancelled', 'uncertain'].includes(String(output.phase))) throw new Error('草稿输出损坏');
    const cardKind: CardKind = output.cardKind === 'general' ? 'general' : 'magical-girl';
    const card = output.card === null ? null : validateCard(cardKind, output.card);
    // 签名只可能来自 hosted 非流式通路；direct/流式草稿中混入的 signature 一律剥除。
    if (card && output.mode !== 'hosted-json' && 'signature' in card) delete card.signature;
    if ((output.phase === 'completed') !== (card !== null)) throw new Error('草稿结果状态不一致');
    draft.output = { mode: output.mode as Mode, cardKind, card, rawText: output.rawText, phase: output.phase as Exclude<Phase, 'generating'> };
  }
  return draft;
};
/** 执行模式 → 本地卡库 provenance execution（hosted 两通路统一记 'hosted'）。 */
const modeExecutionProvenance = (mode: Mode): LocalCardExecutionProvenance =>
  mode === 'hosted-stream' || mode === 'hosted-json' ? 'hosted' : mode;

/** 单个页面生命周期中的意图所有者；同步上锁，异步完成后才释放。 */
export class DetailsSession {
  private state: DetailsSessionState;
  private listeners = new Set<() => void>();
  private pending: StoredDraft | null = null;
  private blocked = false;
  private disposed = false;
  private controller: AbortController | null = null;
  private mode: Mode = 'direct-local';
  private draftSaveTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly dependencies: {
    storage: DetailsDraftStorage;
    repository: CardRepository;
    initialDraft: DetailsDraft;
    execute?: typeof executeDetailsGeneration;
    requestId?: () => string;
  }) {
    this.state = { draft: clone(dependencies.initialDraft), pendingRestore: false, draftError: null, draftSaved: true, phase: 'idle', rawText: '', card: null, cardKind: 'magical-girl', resultRestored: false, reasoning: null, message: null, saving: false, saveStatus: 'idle', saveError: null };
    try {
      const raw = dependencies.storage.getItem(DETAILS_DRAFT_KEY);
      if (raw !== null) { this.pending = parseDraft(raw); this.state.pendingRestore = true; }
    } catch {
      this.blocked = true;
      this.state.draftSaved = false;
      this.state.draftError = '无法读取草稿，可能已损坏或版本不受支持。确认清除前不会覆盖原数据。';
    }
  }
  getSnapshot = (): DetailsSessionState => this.state;
  isBusy = (): boolean => this.controller !== null || this.state.saving;
  hasUnsavedResult = (): boolean => this.state.card !== null && this.state.saveStatus !== 'saved' && this.state.saveStatus !== 'already-present';
  /** Corrupt or future-version storage is preserved until the user explicitly clears it. */
  isDraftBlocked = (): boolean => this.blocked;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(patch: Partial<DetailsSessionState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  updateDraft(draft: DetailsDraft): void {
    if (this.disposed || this.blocked || this.state.pendingRestore || this.controller || this.state.saving) return;
    this.publish({ draft: clone(draft), draftSaved: false });
    this.retryDraftSave();
  }
  restoreDraft(): void {
    if (this.disposed || !this.pending) return;
    const saved = this.pending;
    this.pending = null;
    if (saved.output) this.mode = saved.output.mode;
    this.publish({ draft: { answers: clone(saved.answers), language: saved.language }, pendingRestore: false, draftSaved: true, phase: saved.output?.phase ?? 'idle', card: saved.output?.card ?? null, cardKind: saved.output?.card ? saved.output.cardKind ?? 'magical-girl' : 'magical-girl', resultRestored: saved.output?.card != null, reasoning: null, rawText: saved.output?.rawText ?? '', message: saved.output?.phase === 'uncertain' ? '已恢复草稿；上次生成的服务器执行结果未能确认，不会自动重新生成。' : saved.output ? '已恢复草稿；不会自动重新生成。' : null });
  }
  discardDraft(): void {
    if (this.disposed || this.controller || this.state.saving) return;
    try {
      this.dependencies.storage.removeItem(DETAILS_DRAFT_KEY);
      this.pending = null;
      this.blocked = false;
      this.publish({ draft: clone(this.dependencies.initialDraft), pendingRestore: false, draftError: null, draftSaved: true, phase: 'idle', rawText: '', card: null, cardKind: 'magical-girl', resultRestored: false, reasoning: null, message: null, saveStatus: 'idle', saveError: null });
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
    const stored: StoredDraft = { version: 1, ...draft, output: { mode: this.mode, cardKind, card, rawText, phase: storedPhase } };
    try {
      const raw = JSON.stringify(stored);
      if (raw.length > MAX_DRAFT_CHARACTERS) throw new Error('草稿超过大小限制');
      this.dependencies.storage.setItem(DETAILS_DRAFT_KEY, raw);
      this.publish({ draftSaved: true, draftError: null });
    } catch { this.publish({ draftSaved: false, draftError: '草稿写入失败，当前内容仅保留在此页面。请重试保存草稿。' }); }
  }
  private scheduleDraftSave(): void {
    // 固定窗口合并，不随 delta 重置计时，持续输出也会定期落盘。
    if (this.draftSaveTimer !== null) return;
    this.draftSaveTimer = setTimeout(() => this.retryDraftSave(), STREAM_DRAFT_SAVE_INTERVAL_MS);
  }
  async generate(options: DesktopAiExecutionOptions, input: DetailsGenerationInput, intent: Omit<DetailsGenerationIntent, 'requestId'>, discardUnsavedResult = false): Promise<void> {
    if (this.disposed || this.controller || this.state.saving || this.blocked || this.state.pendingRestore) return;
    if (this.hasUnsavedResult() && !discardUnsavedResult) return;
    const controller = new AbortController();
    this.controller = controller;
    this.mode = intent.mode;
    this.publish({ phase: 'generating', card: null, cardKind: 'magical-girl', resultRestored: false, reasoning: null, rawText: '', message: null, saveStatus: 'idle', saveError: null, draftSaved: false });
    this.retryDraftSave();
    try {
      const outcome = await (this.dependencies.execute ?? executeDetailsGeneration)(options, clone(input), { ...intent, requestId: (this.dependencies.requestId ?? (() => crypto.randomUUID()))() }, controller.signal, (text: string) => {
        if (this.disposed || controller.signal.aborted) return;
        this.publish({ rawText: text, draftSaved: false });
        this.scheduleDraftSave();
      });
      if (this.disposed) return;
      if (outcome.status === 'completed' && !controller.signal.aborted) {
        this.publish({ phase: 'completed', card: validateCard(outcome.cardKind, outcome.card), cardKind: outcome.cardKind, resultRestored: false, reasoning: outcome.reasoning ?? null, rawText: outcome.rawText, message: '生成完成，可保存到本地卡库。' });
      } else if (outcome.status === 'uncertain') {
        // uncertain 不落入 failed/cancelled：服务器是否已执行无从确认，
        // 提示语里必须包含「可能重复调用与费用」的警告，供再生成时复述。
        this.publish({ phase: 'uncertain', rawText: outcome.rawText, reasoning: null, message: outcome.message });
      } else {
        this.publish({ phase: controller.signal.aborted || outcome.status === 'cancelled' ? 'cancelled' : 'failed', rawText: outcome.rawText, reasoning: null, message: outcome.status === 'invalid-output' || outcome.status === 'failed' ? outcome.message : '生成未完成，已保留收到的正文。' });
      }
    } catch (error) {
      this.publish({ phase: controller.signal.aborted ? 'cancelled' : 'failed', rawText: error instanceof DetailsGenerationError ? error.rawText : this.state.rawText, reasoning: null, message: error instanceof Error ? error.message : '生成失败。' });
    } finally {
      this.controller = null;
      if (!this.disposed) this.retryDraftSave();
    }
  }
  cancel(): void {
    this.controller?.abort();
    if (!this.state.draftSaved) this.retryDraftSave();
  }
  clearOutput(): void {
    if (this.disposed || this.isBusy() || this.blocked || this.state.pendingRestore) return;
    this.publish({ phase: 'idle', rawText: '', card: null, cardKind: 'magical-girl', resultRestored: false, reasoning: null, message: null, saveStatus: 'idle', saveError: null, draftSaved: false });
    this.retryDraftSave();
  }
  async saveResult(): Promise<boolean> {
    if (this.disposed || this.state.saving || this.controller || this.state.phase !== 'completed' || !this.state.card) return false;
    const card = clone(this.state.card);
    const cardKind = this.state.cardKind;
    const mode = this.mode;
    this.publish({ saving: true, saveError: null });
    try {
      const data = validateCard(cardKind, card);
      const digest = await digestLocalCardPayloadV1(data);
      if (this.disposed) return false;
      const now = new Date().toISOString();
      const execution = modeExecutionProvenance(mode);
      const signature = cardKind === 'magical-girl' && mode === 'hosted-json' && typeof data.signature === 'string' && data.signature.trim()
        ? data.signature
        : undefined;
      const title = cardKind === 'general'
        ? (typeof data.name === 'string' && data.name.trim() ? data.name.trim() : '未命名角色')
        : (typeof data.codename === 'string' && data.codename.trim() ? data.codename.trim() : '未命名魔法少女');
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
}
