import { buildUnsignedMagicalGirlDetailsCard, MAGICAL_GIRL_DETAILS_SCHEMA, type MagicalGirlDetailsGenerationInput } from '@mahoshojo/ai-core/magical-girl-details-generation';
import { deriveLocalDataCardIdV1, digestLocalCardPayloadV1 } from '@mahoshojo/local-library/digest';
import { LocalCardRecordV1Schema } from '@mahoshojo/local-library/record';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';
import { DetailsGenerationError, executeDetailsGeneration, type DetailsGenerationIntent } from './generation';

export const DETAILS_DRAFT_KEY = 'mahoshojo.desktop.details.draft.v1';
const MAX_DRAFT_CHARACTERS = 4 * 1024 * 1024;
const STREAM_DRAFT_SAVE_INTERVAL_MS = 1000;
export interface DetailsDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface DetailsDraft { answers: Record<string, string>; language: string }
type Card = ReturnType<typeof buildUnsignedMagicalGirlDetailsCard>;
type Mode = DetailsGenerationIntent['mode'];
type Phase = 'idle' | 'generating' | 'completed' | 'failed' | 'cancelled';
export interface DetailsSessionState {
  draft: DetailsDraft;
  pendingRestore: boolean;
  draftError: string | null;
  draftSaved: boolean;
  phase: Phase;
  rawText: string;
  card: Card | null;
  message: string | null;
  saving: boolean;
  saveStatus: 'idle' | 'saved' | 'already-present' | 'failed';
  saveError: string | null;
}
interface StoredDraft extends DetailsDraft {
  version: 1;
  output?: { mode: Mode; card: Card | null; rawText: string; phase: Exclude<Phase, 'generating'> };
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validateCard = (value: unknown): Card => {
  if (!object(value) || !Array.isArray(value.userAnswers)) throw new Error('角色卡无问卷记录');
  const answers = value.userAnswers.map((answer: unknown) => {
    if (!object(answer) || typeof answer.question !== 'string' || typeof answer.answer !== 'string') throw new Error('问卷记录损坏');
    return { question: answer.question, answer: answer.answer, ...(typeof answer.questionId === 'string' ? { questionId: answer.questionId } : {}) };
  });
  return buildUnsignedMagicalGirlDetailsCard(MAGICAL_GIRL_DETAILS_SCHEMA.parse(value), answers);
};
const parseDraft = (raw: string): StoredDraft => {
  if (raw.length > MAX_DRAFT_CHARACTERS) throw new Error('草稿超过大小限制');
  const value: unknown = JSON.parse(raw);
  if (!object(value) || value.version !== 1 || !object(value.answers) || typeof value.language !== 'string' || !Object.values(value.answers).every((answer) => typeof answer === 'string')) throw new Error('草稿版本不受支持或内容损坏');
  const draft: StoredDraft = { version: 1, answers: value.answers as Record<string, string>, language: value.language };
  if (value.output !== undefined) {
    const output = value.output;
    if (!object(output) || (output.mode !== 'direct-local' && output.mode !== 'direct-remote') || typeof output.rawText !== 'string' || !['idle', 'completed', 'failed', 'cancelled'].includes(String(output.phase))) throw new Error('草稿输出损坏');
    const card = output.card === null ? null : validateCard(output.card);
    if ((output.phase === 'completed') !== (card !== null)) throw new Error('草稿结果状态不一致');
    draft.output = { mode: output.mode, card, rawText: output.rawText, phase: output.phase as Exclude<Phase, 'generating'> };
  }
  return draft;
};

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
    this.state = { draft: clone(dependencies.initialDraft), pendingRestore: false, draftError: null, draftSaved: true, phase: 'idle', rawText: '', card: null, message: null, saving: false, saveStatus: 'idle', saveError: null };
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
    this.publish({ draft: { answers: clone(saved.answers), language: saved.language }, pendingRestore: false, draftSaved: true, phase: saved.output?.phase ?? 'idle', card: saved.output?.card ?? null, rawText: saved.output?.rawText ?? '', message: saved.output ? '已恢复草稿；不会自动重新生成。' : null });
  }
  discardDraft(): void {
    if (this.disposed || this.controller || this.state.saving) return;
    try {
      this.dependencies.storage.removeItem(DETAILS_DRAFT_KEY);
      this.pending = null;
      this.blocked = false;
      this.publish({ draft: clone(this.dependencies.initialDraft), pendingRestore: false, draftError: null, draftSaved: true, phase: 'idle', rawText: '', card: null, message: null, saveStatus: 'idle', saveError: null });
    } catch { this.publish({ draftError: '清除草稿失败，原草稿保护仍生效。', draftSaved: false }); }
  }
  retryDraftSave(): void {
    if (this.draftSaveTimer !== null) clearTimeout(this.draftSaveTimer);
    this.draftSaveTimer = null;
    if (this.disposed || this.blocked || this.state.pendingRestore) return;
    const { draft, card, rawText, phase } = this.state;
    const stored: StoredDraft = { version: 1, ...draft, output: { mode: this.mode, card, rawText, phase: phase === 'generating' ? 'cancelled' : phase } };
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
  async generate(options: DesktopAiExecutionOptions, input: MagicalGirlDetailsGenerationInput, intent: Omit<DetailsGenerationIntent, 'requestId'>, discardUnsavedResult = false): Promise<void> {
    if (this.disposed || this.controller || this.state.saving || this.blocked || this.state.pendingRestore) return;
    if (this.hasUnsavedResult() && !discardUnsavedResult) return;
    const controller = new AbortController();
    this.controller = controller;
    this.mode = intent.mode;
    this.publish({ phase: 'generating', card: null, rawText: '', message: null, saveStatus: 'idle', saveError: null, draftSaved: false });
    this.retryDraftSave();
    try {
      const outcome = await (this.dependencies.execute ?? executeDetailsGeneration)(options, clone(input), { ...intent, requestId: (this.dependencies.requestId ?? (() => crypto.randomUUID()))() }, controller.signal, (text: string) => {
        if (this.disposed || controller.signal.aborted) return;
        this.publish({ rawText: text, draftSaved: false });
        this.scheduleDraftSave();
      });
      if (this.disposed) return;
      if (outcome.status === 'completed' && !controller.signal.aborted) {
        this.publish({ phase: 'completed', card: validateCard(outcome.card), rawText: outcome.result.output.text ?? '', message: '生成完成，可保存到本地卡库。' });
      } else {
        this.publish({ phase: controller.signal.aborted || outcome.status === 'cancelled' ? 'cancelled' : 'failed', rawText: outcome.status === 'completed' ? outcome.result.output.text ?? '' : outcome.rawText, message: outcome.status === 'invalid-output' ? outcome.message : '生成未完成，已保留收到的正文。' });
      }
    } catch (error) {
      this.publish({ phase: controller.signal.aborted ? 'cancelled' : 'failed', rawText: error instanceof DetailsGenerationError ? error.rawText : this.state.rawText, message: error instanceof Error ? error.message : '生成失败。' });
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
    this.publish({ phase: 'idle', rawText: '', card: null, message: null, saveStatus: 'idle', saveError: null, draftSaved: false });
    this.retryDraftSave();
  }
  async saveResult(): Promise<boolean> {
    if (this.disposed || this.state.saving || this.controller || this.state.phase !== 'completed' || !this.state.card) return false;
    const card = clone(this.state.card);
    const mode = this.mode;
    this.publish({ saving: true, saveError: null });
    try {
      const data = validateCard(card);
      const digest = await digestLocalCardPayloadV1(data);
      if (this.disposed) return false;
      const now = new Date().toISOString();
      const record = LocalCardRecordV1Schema.parse({ id: deriveLocalDataCardIdV1(digest), schemaVersion: 1, storageLocation: 'local', cardType: 'character', title: data.codename.trim() || '未命名魔法少女', data, contentDigest: digest, provenance: { kind: 'unsigned', execution: mode }, createdAt: now, updatedAt: now });
      const result = await this.dependencies.repository.putIfAbsent(record);
      this.publish({ saveStatus: 'written' in result ? 'saved' : 'already-present' });
      return !this.disposed;
    } catch { this.publish({ saveStatus: 'failed', saveError: '保存到本地卡库失败，生成结果仍保留。可以重试保存，无需重新生成。' }); return false; }
    finally { this.publish({ saving: false }); }
  }
  dispose(): void { if (!this.state.draftSaved) this.retryDraftSave(); this.disposed = true; this.controller?.abort(); this.listeners.clear(); }
}
