import { createBattleStoryReadFence, type BattleStoryReadToken } from '@mahoshojo/ui-web/arena-story-session-read';
import { ARENA_CANONICAL_RESOURCE_LIMITS, ARENA_CANONICAL_CAPABILITIES, evaluateArenaBasicGenerationReadiness } from '@mahoshojo/contracts/arena-capabilities';
import {
  StorySessionHeadSchema, StorySourceSchema,
  type StoryChapterDocument, type StoryChapterHead, type StoryChapterPage, type StorySessionHead, type StorySessionPage,
} from '@mahoshojo/contracts/desktop-arena-story';
import {
  type BattleStoryChapterPlan, type BattleStoryPromptWindowItem,
  isBattleStoryChapterPlanLimitReached,
} from '@mahoshojo/domain/arena-battle-story-session';
import { BattleStoryArenaSeedSchema, type BattleStoryArenaRequestInput } from '@mahoshojo/domain/arena-battle-story-request';
import { countBattleStoryCommitJsonBytes, BattleStoryCommitByteLimitError, freezeBattleStoryCommit, type BattleStorySaveEvidence } from '@mahoshojo/domain/arena-story-commit';
import { resolveAdjudicationEvents } from '@mahoshojo/domain/arena-adjudication';
import { AdjudicatorEventSchema } from '@mahoshojo/domain/data-card-schemas';
import type { AdjudicationResult } from '@mahoshojo/domain/arena-types';
import type { DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';
import {
  listStorySessions, listStoryChapters, readSelectedStoryChapter, readStoryContinueState,
  prepareStoryStorageCommit, savePreparedStoryCommit, queryStoryCommitReceipt, StorySaveError,
  type PreparedStoryCommit, type StoryNativePort,
} from '../../platform/arena-story-storage';
import { executeArenaDirect, type ArenaDirectIntent, type ArenaDirectPartial } from './direct';
import { createInitialArenaDraft, type ArenaDraft, type DesktopArenaProduct } from './session';
import { captureDesktopStorySeed, completeDesktopStoryRecords, type StorySessionSnapshot } from './story-snapshot';

export type StoryExecutionTarget = { options: DesktopAiExecutionOptions; intent: Omit<ArenaDirectIntent, 'requestId' | 'generationMode'> };
/** Host resolves the CURRENT selected target and credentials. Stored source is display only. */
export type PrepareStoryExecution = (run: (target: StoryExecutionTarget) => Promise<void>) => Promise<void>;
export type StoryChapterSelection =
  | { status: 'unloaded' }
  | { status: 'loading'; sessionId: string; chapterId: string }
  | { status: 'error'; sessionId: string; chapterId: string; message: string }
  | { status: 'loaded'; sessionId: string; chapterId: string; chapter: StoryChapterDocument };
export type StoryExportProgress = { phase: 'counting' | 'writing'; bytes: number };
export type StoryExportResult = { absolutePath: string; byteLength: number };
export type DesktopStoryState = {
  sessions: StorySessionHead[]; sessionCursor: StorySessionPage['nextCursor']; listLoading: boolean; listError: string | null;
  active: StorySessionHead | null; chapters: StoryChapterHead[]; chapterCursor: StoryChapterPage['nextCursor']; chaptersLoading: boolean; chaptersError: string | null;
  selected: StoryChapterSelection;
  phase: 'idle' | 'preparing' | 'generating' | 'completed' | 'cancelled' | 'failed';
  result: ArenaDirectPartial | null; resultChapterIndex: number | null; resultSaved: boolean;
  saving: boolean; pending: { title: string; evidence: BattleStorySaveEvidence; retryable: boolean; tooLarge: boolean } | null;
  savedUnread: StorySessionHead | null; message: string | null;
  exporting: boolean; exportProgress: StoryExportProgress | null; exportResult: StoryExportResult | null; exportError: string | null;
};
type PendingCommit = { prepared: PreparedStoryCommit; selection: BattleStoryReadToken; evidence: BattleStorySaveEvidence };
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : '操作未完成，请保留现有内容后重试。';
const emptyState = (): DesktopStoryState => ({
  sessions: [], sessionCursor: null, listLoading: false, listError: null,
  active: null, chapters: [], chapterCursor: null, chaptersLoading: false, chaptersError: null, selected: { status: 'unloaded' },
  phase: 'idle', result: null, resultChapterIndex: null, resultSaved: false, saving: false, pending: null,
  savedUnread: null, message: null, exporting: false, exportProgress: null, exportResult: null, exportError: null,
});

/** Device-owned story state. Credential/account changes cancel execution, never discard
 * pending prose or hide persisted stories. No single-shot draft is read after capture. */
export class DesktopArenaStorySession {
  private state = emptyState();
  private listeners = new Set<() => void>();
  private disposed = false;
  private fence = createBattleStoryReadFence<'list' | 'session' | 'chapters' | 'chapter'>();
  private readController: AbortController | null = null;
  private runController: AbortController | null = null;
  private exportController: AbortController | null = null;
  private pending: PendingCommit | null = null;
  private executionScope = '';
  private executionEpoch = 0;
  constructor(private readonly dependencies: {
    port: StoryNativePort; execute?: typeof executeArenaDirect; id?: () => string; now?: () => number; random?: () => number;
    prepareCommit?: typeof prepareStoryStorageCommit;
    exportMarkdown: (head: StorySessionHead, signal: AbortSignal, onProgress: (value: StoryExportProgress) => void) => Promise<StoryExportResult>;
  }) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(patch: Partial<DesktopStoryState>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  private id = () => (this.dependencies.id ?? (() => crypto.randomUUID()))();
  private now = () => (this.dependencies.now ?? Date.now)();
  isBusy = () => Boolean(this.runController) || this.state.saving || this.state.exporting;
  hasUnsavedResult = () => !!this.state.pending || (!!this.state.result && !this.state.resultSaved && !!(this.state.result.rawText || this.state.result.reasoning));
  setExecutionScope(scope: string) {
    if (scope === this.executionScope) return;
    this.executionScope = scope; this.executionEpoch += 1;
    // The last accepted partial and any completed save candidate remain device-owned.
    this.runController?.abort();
  }
  async refreshSessions(more = false) {
    if (this.disposed || (more && (this.state.listLoading || !this.state.sessionCursor))) return;
    const token = this.fence.begin('list'); if (!token) return;
    const cursor = more ? this.state.sessionCursor : null;
    this.publish({ listLoading: true, listError: null });
    try {
      const page = await listStorySessions(this.dependencies.port, cursor);
      if (!token.isCurrent()) return;
      const rows = more ? [...this.state.sessions, ...page.rows] : page.rows;
      if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('会话目录已变化，请刷新目录。');
      if (page.nextCursor && cursor && page.nextCursor.id === cursor.id && page.nextCursor.updatedAt === cursor.updatedAt) throw new Error('会话目录未前进');
      this.publish({ sessions: rows, sessionCursor: page.nextCursor });
    } catch (cause) { if (token.isCurrent()) this.publish({ listError: errorText(cause) }); }
    finally { if (token.isCurrent()) this.publish({ listLoading: false }); }
  }
  async initialize() {
    const selection = this.fence.capture('session');
    await this.refreshSessions();
    if (selection.isCurrent() && !this.state.active && this.state.sessions[0]) await this.selectSession(this.state.sessions[0]);
  }
  async selectSession(head: StorySessionHead) {
    if (this.disposed) return;
    const valid = StorySessionHeadSchema.parse(head);
    const token = this.fence.begin('session'); if (!token) return;
    this.fence.begin('chapter'); this.fence.begin('chapters'); this.readController?.abort();
    this.publish({ active: valid, chapters: [], chapterCursor: null, chaptersError: null, chaptersLoading: true, selected: { status: 'unloaded' } });
    // Metadata/seed/checkpoints are NOT hydrated just to open a directory.
    await Promise.all([this.loadChapters(valid, token, false), this.selectChapter(valid.lastChapterId)]);
  }
  private async loadChapters(head: StorySessionHead, selection: BattleStoryReadToken, more: boolean) {
    const token = this.fence.begin('chapters'); if (!token) return;
    const cursor = more ? this.state.chapterCursor : null;
    this.publish({ chaptersLoading: true, chaptersError: null });
    try {
      const page = await listStoryChapters(this.dependencies.port, head, cursor);
      if (!selection.isCurrent() || !token.isCurrent()) return;
      const rows = more ? [...this.state.chapters, ...page.rows] : page.rows;
      if (new Set(rows.map((row) => row.id)).size !== rows.length || rows.some((row, index) => row.index !== index + 1)) throw new Error('章节目录序列已变化，请重新读取会话。');
      this.publish({ chapters: rows, chapterCursor: page.nextCursor });
    } catch (cause) { if (selection.isCurrent() && token.isCurrent()) this.publish({ chaptersError: errorText(cause) }); }
    finally { if (selection.isCurrent() && token.isCurrent()) this.publish({ chaptersLoading: false }); }
  }
  async loadMoreChapters() {
    if (!this.state.active || !this.state.chapterCursor || this.state.chaptersLoading) return;
    await this.loadChapters(this.state.active, this.fence.capture('session'), true);
  }
  async selectChapter(chapterId: string) {
    const head = this.state.active; if (this.disposed || !head) return;
    const selection = this.fence.capture('session'), token = this.fence.begin('chapter'); if (!token) return;
    this.readController?.abort(); const controller = new AbortController(); this.readController = controller;
    this.publish({ selected: { status: 'loading', sessionId: head.id, chapterId } });
    try {
      const chapter = await readSelectedStoryChapter(this.dependencies.port, head, chapterId, controller.signal);
      if (selection.isCurrent() && token.isCurrent() && !controller.signal.aborted) this.publish({ selected: { status: 'loaded', sessionId: head.id, chapterId, chapter } });
    } catch (cause) {
      if (selection.isCurrent() && token.isCurrent() && !controller.signal.aborted) this.publish({ selected: { status: 'error', sessionId: head.id, chapterId, message: errorText(cause) } });
    } finally { if (this.readController === controller) this.readController = null; }
  }
  private beginGeneration() {
    if (this.disposed || this.isBusy() || this.hasUnsavedResult() || !this.executionScope) return null;
    const controller = new AbortController(); this.runController = controller;
    this.publish({ phase: 'preparing', result: null, resultChapterIndex: null, resultSaved: false, message: null, savedUnread: null });
    const sessionSelection = this.fence.capture('session'), chapterSelection = this.fence.capture('chapter');
    const selection: BattleStoryReadToken = { isCurrent: () => sessionSelection.isCurrent() && chapterSelection.isCurrent(), isInScope: () => sessionSelection.isInScope() && chapterSelection.isInScope() };
    return { controller, epoch: this.executionEpoch, selection };
  }
  async start(input: { draft: ArenaDraft; product: DesktopArenaProduct; chapterPlan?: BattleStoryChapterPlan }, prepare: PrepareStoryExecution) {
    const issue = evaluateArenaBasicGenerationReadiness({ battleMode: input.draft.battleMode, combatantCount: input.draft.combatants.length, hasScenario: !!input.draft.scenario.content })[0];
    if (issue) { this.publish({ message: issue.code === 'GENERATION_SCENARIO_REQUIRED' ? '请先选择主情景。' : `当前模式至少需要 ${ARENA_CANONICAL_CAPABILITIES.minCombatantsByMode[input.draft.battleMode]} 位角色。` }); return; }
    const run = this.beginGeneration(); if (!run) return;
    try {
      // Own one bounded snapshot before credential preparation; page edits cannot redirect it.
      const seed = captureDesktopStorySeed(input.draft, input.product);
      countBattleStoryCommitJsonBytes(seed, ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes);
      const ownedSeed = freezeBattleStoryCommit(structuredClone(seed));
      const source = StorySourceSchema.parse({ mode: input.draft.battleMode, language: input.draft.selectedLanguage,
        storyLength: input.draft.storyLength, customStoryLength: input.draft.customStoryLength, generationMode: 'stream' });
      const now = this.now();
      const session: StorySessionSnapshot = { id: this.id(), title: '未命名连续战报', createdAt: now, updatedAt: now,
        source, seed: ownedSeed, workingCombatants: ownedSeed.combatants, chapterCount: 0,
        ...(input.chapterPlan ? { chapterPlan: structuredClone(input.chapterPlan) } : {}) };
      const userGuidance = input.draft.settings.userGuidance;
      await this.generateChapter({ session, workingCombatants: ownedSeed.combatants, action: 'start', expectedRevision: 0,
        recentWindow: [], userGuidance, ...run }, prepare);
    } catch (cause) { this.generationFailure(cause, run.controller); }
    finally { if (this.runController === run.controller) { this.runController = null; this.publish({}); } }
  }
  async continue(userGuidance: string, prepare: PrepareStoryExecution) {
    const head = this.state.active;
    if (!head) return;
    if (isBattleStoryChapterPlanLimitReached({ chapterPlan: head.chapterPlan, completedChapterCount: head.chapterCount })) {
      this.publish({ message: '本故事已完成显式章节计划。未设置计划的故事没有总章节数上限。' }); return;
    }
    const run = this.beginGeneration(); if (!run) return;
    try {
      const value = await readStoryContinueState(this.dependencies.port, head, run.controller.signal);
      if (run.controller.signal.aborted || run.epoch !== this.executionEpoch) { this.generationFailure(new Error('生成准备已取消'), run.controller); return; }
      const source = StorySourceSchema.parse(value.session.source);
      const seed = BattleStoryArenaSeedSchema.parse({ ...value.seed, mode: source.mode, language: source.language, storyLength: source.storyLength, customStoryLength: source.customStoryLength });
      const summaryMeta = value.session.summaryMeta;
      if (summaryMeta !== undefined && (!summaryMeta || typeof summaryMeta !== 'object' || !('coveredChapterIds' in summaryMeta) || !Array.isArray(summaryMeta.coveredChapterIds) || summaryMeta.coveredChapterIds.some((id: unknown) => typeof id !== 'string') || !('coveredUntilChapterIndex' in summaryMeta) || summaryMeta.coveredUntilChapterIndex !== head.chapterCount || !('mode' in summaryMeta) || summaryMeta.mode !== 'deterministic-fallback' || !('refreshedAt' in summaryMeta) || !Number.isSafeInteger(summaryMeta.refreshedAt))) throw new Error('会话摘要覆盖记录无效，请保留故事并导出。');
      const session: StorySessionSnapshot = { ...value.session, source, seed, workingCombatants: value.checkpoint.combatants, summaryMeta: summaryMeta as StorySessionSnapshot['summaryMeta'] };
      // The shared request builder validates all seed semantics before any model dispatch.
      await this.generateChapter({ session, workingCombatants: value.checkpoint.combatants, action: 'continue', expectedRevision: head.revision,
        lastInputCheckpointId: value.checkpoint.id, recentWindow: value.recentWindow, userGuidance, ...run }, prepare);
    } catch (cause) { this.generationFailure(cause, run.controller); }
    finally { if (this.runController === run.controller) { this.runController = null; this.publish({}); } }
  }
  private generationFailure(cause: unknown, controller: AbortController) {
    if (this.disposed || this.runController !== controller) return;
    this.publish({ phase: controller.signal.aborted ? 'cancelled' : 'failed', message: controller.signal.aborted ? '已停止，本次未提交章节。收到的原文仍保留，可导出。' : errorText(cause) });
  }
  private async generateChapter(input: {
    session: StorySessionSnapshot; workingCombatants: unknown[]; action: 'start' | 'continue'; expectedRevision: number;
    lastInputCheckpointId?: string; recentWindow: BattleStoryPromptWindowItem[]; userGuidance: string;
    controller: AbortController; epoch: number; selection: BattleStoryReadToken;
  }, prepare: PrepareStoryExecution) {
    const { controller, session } = input;
    const requestId = this.id(), operationId = this.id(), checkpointId = this.id(), initialCheckpointId = input.action === 'start' ? this.id() : undefined;
    const chapterIndex = session.chapterCount + 1;
    const story: BattleStoryArenaRequestInput = freezeBattleStoryCommit({
      action: input.action, chapterIndex, ...(session.lastChapterId ? { sourceChapterId: session.lastChapterId } : {}),
      chapterPlan: session.chapterPlan, seed: { ...session.seed, mode: session.source.mode, language: session.source.language,
        storyLength: session.source.storyLength, customStoryLength: session.source.customStoryLength },
      chapterContext: { workingCombatants: input.workingCombatants, sessionSummary: session.sessionSummary, recentWindow: input.recentWindow },
      userGuidance: input.userGuidance,
    });
    let dispatched = false;
    await prepare(async ({ options, intent }) => {
      if (this.disposed || controller.signal.aborted || input.epoch !== this.executionEpoch) return;
      if (dispatched) throw new Error('本章已提交一次生成请求，不能自动重复。');
      dispatched = true;
      if (intent.mode !== 'direct-local' && intent.mode !== 'direct-remote') throw new Error('连续故事目前仅支持客户端 Direct。');
      const source = StorySourceSchema.parse({ ...session.source, providerMode: intent.mode,
        providerId: options.providerTarget?.kind === 'preset' ? options.providerTarget.providerId : options.profileId, modelId: intent.modelId });
      const events = AdjudicatorEventSchema.array().parse(story.seed.adjudicationEvents ?? []);
      const adjudicationResults = resolveAdjudicationEvents(events, this.dependencies.random ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]! / 0x1_0000_0000)) as unknown as AdjudicationResult[];
      this.publish({ phase: 'generating', resultChapterIndex: chapterIndex, result: { rawText: '', markdown: '', reasoning: '' } });
      const scopeKey = `desktop-story:${session.id}:${requestId}`;
      const outcome = await (this.dependencies.execute ?? executeArenaDirect)(options, createInitialArenaDraft(), { ...intent, requestId, generationMode: 'stream' },
        { scopeKey, reporterInfo: { name: '记者', publication: '魔法少女速报' }, adjudicationResults, story }, controller.signal,
        (partial) => { if (!this.disposed && this.runController === controller && !controller.signal.aborted) this.publish({ result: partial }); });
      if (this.disposed || this.runController !== controller) return;
      if (outcome.requestId !== requestId || outcome.scopeKey !== scopeKey) throw new Error('生成结果身份不匹配，未保存章节。');
      this.publish({ result: { rawText: outcome.rawText, markdown: outcome.markdown, reasoning: outcome.reasoning, usage: outcome.usage } });
      if (controller.signal.aborted || input.epoch !== this.executionEpoch || outcome.status !== 'completed') {
        this.publish({ phase: controller.signal.aborted || outcome.status === 'cancelled' ? 'cancelled' : 'failed', message: `${'message' in outcome ? `${outcome.message} ` : ''}本次未完成有效章节，未写入故事。收到的原文仍保留，可导出。` }); return;
      }
      // Retain completed text BEFORE projection, schema validation or storage budget checks.
      this.publish({ phase: 'completed', pending: { title: outcome.report.headline, evidence: 'not-written', retryable: false, tooLarge: false }, message: '生成完成，正在准备本地保存。' });
      try {
        const records = completeDesktopStoryRecords({ ...input, chapterIndex, operationId, checkpointId, initialCheckpointId,
          now: this.now(), source, outcome, adjudicationResults });
        const prepared = await (this.dependencies.prepareCommit ?? prepareStoryStorageCommit)({ ...records,
          expectedRevision: input.expectedRevision, expectedLastChapterId: session.lastChapterId ?? null,
          lastInputCheckpointId: input.lastInputCheckpointId });
        if (this.disposed) return;
        this.pending = { prepared, selection: input.selection, evidence: 'not-written' };
        this.publish({ pending: { title: records.chapter.title, evidence: 'not-written', retryable: true, tooLarge: false } });
        await this.savePending();
      } catch (cause) {
        if (this.disposed) return;
        const tooLarge = cause instanceof BattleStoryCommitByteLimitError;
        this.publish({ pending: { title: outcome.report.headline, evidence: 'not-written', retryable: false, tooLarge },
          message: tooLarge ? '生成完成，未保存到会话：完整章节超出本次保存预算。原文只保留在当前窗口，请先导出；重新调用模型不能修复保存限制。' : `生成完成，未保存到会话：${errorText(cause)} 原文仍保留，请导出。` });
      }
    });
    if (!dispatched && !this.disposed) this.publish({ phase: 'cancelled', message: '生成准备已取消，未调用模型。' });
  }
  async savePending() {
    const pending = this.pending;
    if (this.disposed || !pending || this.state.saving) return;
    this.publish({ saving: true, message: pending.evidence === 'unknown' ? '正在查询原保存操作…' : '正在保存完整章节…' });
    try {
      const receipt = pending.evidence === 'unknown'
        ? await queryStoryCommitReceipt(this.dependencies.port, pending.prepared)
        : await savePreparedStoryCommit(this.dependencies.port, pending.prepared, pending.evidence);
      if (!receipt) throw new StorySaveError('尚无可核对的原操作回执，保存状态仍待确认。请保留原文或导出。', 'unknown');
      const stored = pending.prepared.parts.find((part) => part.kind === 'session')!.prepared.value as Record<string, unknown>;
      const head = StorySessionHeadSchema.parse(Object.fromEntries(['id','revision','titlePreview','titleTruncated','mode','chapterPlan','createdAt','updatedAt','chapterCount','lastChapterId'].filter((key) => stored[key] !== undefined).map((key) => [key, stored[key]])));
      this.pending = null;
      this.publish({ pending: null, resultSaved: true, savedUnread: head, message: '完整章节已保存到本机故事。' });
      await this.refreshSessions();
      if (pending.selection.isCurrent()) {
        await this.selectSession(head);
        if (this.state.selected.status === 'loaded' && this.state.selected.chapterId === receipt.chapterId) this.publish({ savedUnread: null });
      } else if (this.state.active?.id === head.id) {
        // A manual old-chapter choice wins, while the same story's head can advance.
        // The immutable selected chapter keeps its real identity and content.
        this.publish({ active: head });
        await this.loadChapters(head, this.fence.capture('session'), false);
      }
    } catch (cause) {
      if (cause instanceof StorySaveError && cause.evidence === 'unknown') pending.evidence = 'unknown';
      this.publish({ pending: this.state.pending ? { ...this.state.pending, evidence: pending.evidence } : null, message: errorText(cause) });
    } finally { this.publish({ saving: false }); }
  }
  async readSavedResult() { if (this.state.savedUnread) { const head = this.state.savedUnread; await this.selectSession(head); if (this.state.selected.status === 'loaded' && this.state.selected.chapterId === head.lastChapterId) this.publish({ savedUnread: null }); } }
  discardResult() { if (this.isBusy()) return; this.pending = null; this.publish({ result: null, pending: null, phase: 'idle', resultSaved: false, resultChapterIndex: null, message: null }); }
  cancel() { this.runController?.abort(); }
  async exportSelectedStory() {
    const head = this.state.active;
    if (this.disposed || !head || this.isBusy()) return;
    const controller = new AbortController(); this.exportController = controller;
    this.publish({ exporting: true, exportProgress: null, exportResult: null, exportError: null });
    try {
      const result = await this.dependencies.exportMarkdown(head, controller.signal, (progress) => { if (!controller.signal.aborted && !this.disposed) this.publish({ exportProgress: progress }); });
      // A resolved sink result proves end published a complete, verified file, even if
      // cancellation raced the final receipt. Never hide that known success.
      this.publish({ exportResult: result });
    } catch (cause) { this.publish({ exportError: controller.signal.aborted ? '导出已取消，未发布不完整文件。' : errorText(cause) }); }
    finally { if (this.exportController === controller) this.exportController = null; this.publish({ exporting: false }); }
  }
  cancelExport() { this.exportController?.abort(); }
  detach() { this.cancel(); this.cancelExport(); this.readController?.abort(); }
  dispose() { this.detach(); this.disposed = true; this.fence.dispose(); this.listeners.clear(); }
}
