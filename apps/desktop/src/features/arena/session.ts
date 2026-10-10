import { buildArenaGenerationInputSnapshot, type ArenaBattleReport } from '@mahoshojo/ai-core/arena-generation';
import { ARENA_CANONICAL_CAPABILITIES, evaluateArenaBasicGenerationReadiness } from '@mahoshojo/contracts/arena-capabilities';
import { validateArenaAiInputJson } from '@mahoshojo/contracts/ai-execution';
import { MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { SafeJsonValueSchema } from '@mahoshojo/contracts/json-value';
import { getArenaPostBattleWorldLineIndices } from '@mahoshojo/domain/arena-post-battle';
import { projectUnsignedArenaPostBattleCandidates, type ArenaUnsignedPostBattleCandidates } from '@mahoshojo/domain/arena-post-battle-candidates';
import { resolveAdjudicationEvents } from '@mahoshojo/domain/arena-adjudication';
import { isLegacyAdjudicatorFormat } from '@mahoshojo/domain/arena-character-validator';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import { buildArenaQuestionnaireRequest } from '@mahoshojo/domain/arena-questionnaire-request';
import type { NarrativeHistorySort } from '@mahoshojo/domain/narrative-history-operations';
import { parseDesktopLoreSelections } from '../questionnaire/lore-source';
import type { AdjudicationResult } from '@mahoshojo/domain/arena-types';
import { AdjudicatorEventSchema } from '@mahoshojo/domain/data-card-schemas';
import { NarrativeHistorySchema } from '@mahoshojo/domain/narrative-history';
import { localLibraryRecordBytes } from '@mahoshojo/local-library/archive-export';
import { deriveLocalDataCardIdV1, digestLocalCardPayloadV1 } from '@mahoshojo/local-library/digest';
import { LocalCardRecordV1Schema } from '@mahoshojo/local-library/record';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { GenerationDraftStorage } from '../generation/session';
import type { DesktopAiExecutionOptions } from '../../platform/desktop-ai-execution';
import { executeArenaDirect, type ArenaDirectInput, type ArenaDirectIntent, type ArenaDirectOutcome, type ArenaDirectPartial } from './direct';

export const ARENA_DRAFT_KEY = 'mahoshojo.desktop.arena.battle.draft.v1';
export const ADVANCED_ARENA_DRAFT_KEY = 'mahoshojo.desktop.arena.advanced.draft.v1';
export type DesktopArenaProduct = 'battle' | 'arena';
const MAX_DRAFT_CHARACTERS = 4 * 1024 * 1024;
const clone = <T,>(value: T): T => structuredClone(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export type ArenaAuxiliaryScenario = ArenaDirectInput['auxScenarios'][number] & { id?: string; fileName?: string | null; isPreset?: boolean; adjudicationSourceKey?: string };
export type ArenaHistoryOriginal = { id: string; name: string; text: string; importedAt: string };
export type ArenaDraft = Omit<ArenaDirectInput, 'auxScenarios'> & { generationMode: 'stream' | 'non-stream'; historyReferences: ArenaDirectInput['narrativeHistoryEntries']; auxScenarios: readonly ArenaAuxiliaryScenario[]; selectedQuestionnaires?: QuestionnaireSelection[]; historyOriginals?: ArenaHistoryOriginal[]; historySort?: NarrativeHistorySort; historyUpdatedAt?: string | null };
export const createInitialArenaDraft = (): ArenaDraft => ({
  combatants: [], teams: [], battleMode: 'classic', reportFormat: 'markdown', arenaFreeRankingEnabled: false,
  scenario: { content: null, fileName: null }, scenarioDisplayName: null, auxScenarios: [], materials: [],
  selectedLanguage: 'zh-CN', storyLength: 'default', customStoryLength: '', generationMode: 'non-stream',
  settings: { userGuidance: '', readArenaHistory: true, readArenaHistoryLimit: 10, isArenaHistoryUnlimited: false, writeArenaHistory: true,
    readCurrentState: true, writeCurrentState: true, readNarrativeHistory: false, readNarrativeHistoryLimit: 10,
    isNarrativeHistoryUnlimited: false, writeNarrativeHistory: false },
  narrativeHistoryEntries: [], historyReferences: [], adjudicationEvents: [],
});
export type ArenaSessionPhase = 'idle' | 'generating' | 'completed' | 'failed' | 'cancelled';
export interface ArenaSessionState extends ArenaDirectPartial {
  draft: ArenaDraft; generation: { input: ArenaDraft; intent: ArenaDirectIntent; scopeKey: string; startedAt: string; adjudicationResults: AdjudicationResult[]; profileId: string; providerTarget: DesktopAiExecutionOptions['providerTarget'] } | null; phase: ArenaSessionPhase; activeGenerationMode: ArenaDraft['generationMode'] | null; report: ArenaBattleReport | null;
  pendingRestore: boolean; draftSaved: boolean; draftError: string | null; message: string | null;
  saving: boolean; importing: boolean; saveStatus: 'idle' | 'saved' | 'failed'; saveError: string | null;
  candidates: ArenaUnsignedPostBattleCandidates | null; restored: boolean;
}
export const validateArenaDraft = (value: unknown, product: DesktopArenaProduct = 'battle'): ArenaDraft => {
  if (!record(value) || !SafeJsonValueSchema.safeParse(value).success || value.reportFormat !== 'markdown' || value.arenaFreeRankingEnabled !== false
    || typeof value.battleMode !== 'string' || !['classic', 'kizuna', 'daily', 'scenario'].includes(value.battleMode) || typeof value.generationMode !== 'string' || !['stream', 'non-stream'].includes(value.generationMode)
    || !Array.isArray(value.combatants) || !Array.isArray(value.teams) || !Array.isArray(value.materials) || !Array.isArray(value.auxScenarios)
    || !Array.isArray(value.historyReferences) || !Array.isArray(value.adjudicationEvents) || !Array.isArray(value.narrativeHistoryEntries)
    || !record(value.scenario) || !(value.scenario.content === null || record(value.scenario.content))
    || !(value.scenario.fileName === null || typeof value.scenario.fileName === 'string') || !(value.scenarioDisplayName === null || typeof value.scenarioDisplayName === 'string')
    || !record(value.settings) || typeof value.selectedLanguage !== 'string' || typeof value.storyLength !== 'string' || !['default', 'short', 'standard', 'detailed', 'long'].includes(value.storyLength)
    || (value.customStoryLength !== undefined && typeof value.customStoryLength !== 'string')
    || typeof value.settings.userGuidance !== 'string'
    || !['readArenaHistory', 'writeArenaHistory', 'isArenaHistoryUnlimited', 'readCurrentState', 'writeCurrentState', 'readNarrativeHistory', 'writeNarrativeHistory', 'isNarrativeHistoryUnlimited'].every((key) => typeof (value.settings as Record<string, unknown>)[key] === 'boolean')
    || !['readArenaHistoryLimit', 'readNarrativeHistoryLimit'].every((key) => typeof (value.settings as Record<string, unknown>)[key] === 'number' && Number.isInteger((value.settings as Record<string, unknown>)[key]) && Number((value.settings as Record<string, unknown>)[key]) >= 1)) throw new Error('Arena 草稿格式不受支持');
  const draft = value as unknown as ArenaDraft;
  if (product === 'arena' && !draft.adjudicationEvents.every((event) => AdjudicatorEventSchema.safeParse(event).success)) throw new Error('Arena 判定编辑草稿不合法');
  if (draft.selectedQuestionnaires !== undefined) parseDesktopLoreSelections(draft.selectedQuestionnaires);
  if ((draft.historyOriginals !== undefined && (!Array.isArray(draft.historyOriginals) || !draft.historyOriginals.every((item) => record(item) && (['id', 'name', 'text', 'importedAt'] as const).every((key) => typeof item[key] === 'string'))))
    || (draft.historySort !== undefined && !['prompt_order', 'updated_desc', 'updated_asc', 'created_desc', 'created_asc'].includes(draft.historySort))
    || (draft.historyUpdatedAt !== undefined && draft.historyUpdatedAt !== null && typeof draft.historyUpdatedAt !== 'string')) throw new Error('Arena 历史编辑草稿不合法');
  if (draft.combatants.length > ARENA_CANONICAL_CAPABILITIES.maxCombatants || draft.auxScenarios.length + draft.materials.length > ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity
    || !draft.combatants.every((item) => record(item) && record(item.data) && typeof item.type === 'string' && ['magical-girl', 'canshou', 'general-character'].includes(item.type) && typeof item.filename === 'string' && typeof item.isValid === 'boolean' && typeof item.isPreset === 'boolean'
      && (item.teamId === undefined || (Number.isSafeInteger(item.teamId) && item.teamId > 0)) && (item.characterGuidance === undefined || typeof item.characterGuidance === 'string'))
    || !draft.teams.every((team) => record(team) && Number.isSafeInteger(team.id) && team.id > 0 && typeof team.name === 'string')
    || !draft.materials.every((item) => record(item) && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.sourceType === 'string' && typeof item.sourceKind === 'string' && ['wantu-card', 'mahoshojo-data-card', 'raw-json'].includes(item.sourceKind) && Object.prototype.hasOwnProperty.call(item, 'content') && (item.fileName === null || typeof item.fileName === 'string'))
    || !draft.auxScenarios.every((item) => record(item) && record(item.content) && (item.id === undefined || typeof item.id === 'string') && (item.fileName === undefined || item.fileName === null || typeof item.fileName === 'string') && (item.adjudicationSourceKey === undefined || typeof item.adjudicationSourceKey === 'string') && (item.isPreset === undefined || typeof item.isPreset === 'boolean'))) throw new Error('Arena 草稿资源不合法');
  NarrativeHistorySchema.parse({ templateId: 'narrative-history', version: 1, updatedAt: '', entries: draft.narrativeHistoryEntries });
  NarrativeHistorySchema.parse({ templateId: 'narrative-history', version: 1, updatedAt: '', entries: draft.historyReferences });
  return { ...clone(draft), ...(draft.selectedQuestionnaires !== undefined ? { selectedQuestionnaires: parseDesktopLoreSelections(draft.selectedQuestionnaires) } : {}) };
};
export const inheritedArenaAdjudication = (draft: ArenaDraft, product: DesktopArenaProduct = 'battle') => {
  // Advanced imports maintain editable, source-marked events. Never re-add deleted/edited source events at dispatch.
  if (product === 'arena') return { events: [...draft.adjudicationEvents], skippedLegacy: 0 };
  const sources = [...draft.combatants.map((item) => item.data), ...(draft.battleMode === 'scenario' && draft.scenario.content ? [draft.scenario.content] : [])];
  const events = [...draft.adjudicationEvents]; let skippedLegacy = 0;
  for (const source of sources) {
    if (!record(source) || !Array.isArray(source.adjudicationEvents)) continue;
    if (isLegacyAdjudicatorFormat(source.adjudicationEvents)) { skippedLegacy += source.adjudicationEvents.length; continue; }
    events.push(...source.adjudicationEvents);
  }
  return { events, skippedLegacy };
};
export const buildDesktopArenaInput = (draft: ArenaDraft, product: DesktopArenaProduct = 'battle'): ArenaDirectInput => ({ ...draft, ...(draft.selectedQuestionnaires ? buildArenaQuestionnaireRequest(draft.selectedQuestionnaires) : {}), adjudicationEvents: inheritedArenaAdjudication(draft, product).events, narrativeHistoryEntries: [...draft.historyReferences, ...draft.narrativeHistoryEntries] });
export const arenaReferenceCount = (draft: ArenaDraft): number => { const input = buildArenaGenerationInputSnapshot(buildDesktopArenaInput(draft)); return (input.materials?.length ?? 0) + (input.auxScenarios?.length ?? 0) + (input.questionnaires?.length ?? 0) + (input.narrativeHistory?.length ?? 0); };
export const arenaReadinessMessage = (draft: ArenaDraft, product: DesktopArenaProduct = 'battle'): string | null => {
  const issue = evaluateArenaBasicGenerationReadiness({ battleMode: draft.battleMode, combatantCount: draft.combatants.length, hasScenario: !!draft.scenario.content })[0];
  if (issue?.code === 'GENERATION_SCENARIO_REQUIRED') return '请先选择主情景。';
  if (issue) return `当前模式至少需要 ${ARENA_CANONICAL_CAPABILITIES.minCombatantsByMode[draft.battleMode]} 位角色。`;
  if (!validateArenaAiInputJson(JSON.stringify(buildArenaGenerationInputSnapshot(buildDesktopArenaInput(draft, product))))) return '输入超过 Arena 资源上限或格式不受支持；请调整输入，内容不会被截断。';
  return null;
};

/** Independent Arena owner: no fake card family/Hosted route and no automatic library writes. */
export class DesktopArenaSession {
  private state: ArenaSessionState;
  private scopeKey = '';
  private epoch = 0;
  private disposed = false;
  private controller: AbortController | null = null;
  private importController: AbortController | null = null;
  private pending: { draft: ArenaDraft; output?: Record<string, unknown> } | null = null;
  private draftBlocked = false;
  private dirty = false;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private resultMode: ArenaDirectIntent['mode'] | undefined;
  private get draftKey() { return this.dependencies.product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY; }
  constructor(private readonly dependencies: { product?: DesktopArenaProduct; repository: CardRepository; storage: GenerationDraftStorage; execute?: typeof executeArenaDirect; requestId?: () => string; now?: () => string; random?: () => number }) {
    this.state = { draft: createInitialArenaDraft(), generation: null, rawText: '', markdown: '', reasoning: '', phase: 'idle', activeGenerationMode: null, report: null, pendingRestore: false,
      draftSaved: true, draftError: null, message: null, saving: false, importing: false, saveStatus: 'idle', saveError: null, candidates: null, restored: false };
    try {
      const raw = dependencies.storage.getItem(this.draftKey);
      if (raw !== null) {
        if (raw.length > MAX_DRAFT_CHARACTERS) throw new Error('oversize');
        const saved: unknown = JSON.parse(raw);
        if (!record(saved) || saved.version !== 1) throw new Error('version');
        const draft = validateArenaDraft(saved.draft, this.dependencies.product);
        if (saved.output !== undefined && (!record(saved.output) || typeof saved.output.phase !== 'string' || !['idle', 'completed', 'failed', 'cancelled'].includes(saved.output.phase)
          || (saved.output.executionMode !== undefined && saved.output.executionMode !== 'direct-local' && saved.output.executionMode !== 'direct-remote')
          || (saved.output.generationMode !== undefined && saved.output.generationMode !== null && saved.output.generationMode !== 'stream' && saved.output.generationMode !== 'non-stream')
          || !['rawText', 'markdown', 'reasoning'].every((key) => typeof (saved.output as Record<string, unknown>)[key] === 'string'))) throw new Error('output');
        this.pending = { draft, output: saved.output as Record<string, unknown> | undefined };
        this.state.pendingRestore = true;
      }
    } catch { this.draftBlocked = true; this.state.draftSaved = false; this.state.draftError = '旧草稿无法读取，原数据已保留。可在内存继续创作并完整导出，清除旧草稿前不会覆盖。'; }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  isBusy = () => !!this.controller || !!this.importController || this.state.saving;
  hasUnsavedDraft = () => this.dirty && !this.state.draftSaved;
  private publish(patch: Partial<ArenaSessionState>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
  private current(scope: string, epoch: number) { return !this.disposed && this.scopeKey === scope && this.epoch === epoch; }
  setScope(scopeKey: string) {
    if (scopeKey === this.scopeKey) return;
    const wasGenerating = !!this.controller;
    this.scopeKey = scopeKey; this.epoch += 1; this.controller?.abort(); this.importController?.abort();
    this.publish({ candidates: null, ...(wasGenerating ? { phase: 'cancelled' as const, report: null, message: '账号或 AI 配置已变更，原生成已取消，收到的原文仍可导出。' } : {}) });
  }
  updateDraft(draft: ArenaDraft) {
    if (this.disposed || this.isBusy() || this.state.pendingRestore) return;
    const validated = validateArenaDraft(draft, this.dependencies.product); this.dirty = true;
    this.publish({ draft: validated, draftSaved: false, ...(this.dependencies.product === 'arena' ? { saveStatus: 'idle' as const, saveError: null } : {}) }); this.retryDraftSave();
  }
  async importInput(load: (signal: AbortSignal) => Promise<(draft: ArenaDraft) => ArenaDraft>): Promise<void> {
    if (this.disposed || this.isBusy() || this.state.pendingRestore) throw new Error('请先完成当前操作。');
    const scope = this.scopeKey, epoch = this.epoch, controller = new AbortController();
    this.importController = controller; this.publish({ importing: true });
    try { const apply = await load(controller.signal); if (!this.current(scope, epoch) || controller.signal.aborted) throw new Error('选择已失效，请重试。');
      const draft = validateArenaDraft(apply(clone(this.state.draft)), this.dependencies.product); this.dirty = true; this.publish({ draft, draftSaved: false, ...(this.dependencies.product === 'arena' ? { saveStatus: 'idle' as const, saveError: null } : {}) }); this.retryDraftSave();
    } finally { if (this.importController === controller) this.importController = null; this.publish({ importing: false }); }
  }
  restoreDraft() {
    if (!this.pending || this.isBusy()) return;
    const saved = this.pending; this.pending = null;
    this.resultMode = saved.output?.executionMode === 'direct-remote' ? 'direct-remote' : saved.output?.executionMode === 'direct-local' ? 'direct-local' : undefined;
    this.publish({ draft: saved.draft, pendingRestore: false, restored: true, generation: null, draftSaved: true,
      rawText: String(saved.output?.rawText ?? ''), markdown: String(saved.output?.markdown ?? ''), reasoning: String(saved.output?.reasoning ?? ''),
      activeGenerationMode: saved.output?.generationMode === 'stream' ? 'stream' : 'non-stream', phase: saved.output?.phase as ArenaSessionPhase ?? 'idle', report: null, candidates: null,
      message: '已恢复本机草稿与原文，不会自动重新生成或写入本地库。' });
  }
  discardDraft() {
    if (this.isBusy()) return;
    try { this.dependencies.storage.removeItem(this.draftKey); this.pending = null; this.draftBlocked = false; this.dirty = false;
      this.publish({ draft: createInitialArenaDraft(), generation: null, pendingRestore: false, draftSaved: true, draftError: null, rawText: '', markdown: '', reasoning: '', report: null, phase: 'idle', candidates: null, message: null, saveError: null, saveStatus: 'idle' });
    } catch { this.publish({ draftError: '清除失败，旧草稿仍受保护。' }); }
  }
  retryDraftSave() {
    if (this.draftTimer) clearTimeout(this.draftTimer); this.draftTimer = null;
    if (this.disposed || this.draftBlocked || this.state.pendingRestore) return;
    try { const { draft, rawText, markdown, reasoning, phase } = this.state;
      const raw = JSON.stringify({ version: 1, draft, output: { rawText, markdown, reasoning, executionMode: this.resultMode, generationMode: this.state.activeGenerationMode, phase: phase === 'generating' ? 'cancelled' : phase } });
      if (raw.length > MAX_DRAFT_CHARACTERS) throw new Error('limit');
      this.dependencies.storage.setItem(this.draftKey, raw); this.publish({ draftSaved: true, draftError: null });
    } catch { this.publish({ draftSaved: false, draftError: '草稿保存失败或超过 4 MiB 字符上限。完整内容保留在内存，请导出后再离开。' }); }
  }
  async generate(options: DesktopAiExecutionOptions, input: ArenaDraft, intent: Omit<ArenaDirectIntent, 'requestId'>): Promise<void> {
    if (this.disposed || this.isBusy() || this.state.pendingRestore || !this.scopeKey) return;
    const error = arenaReadinessMessage(input, this.dependencies.product); if (error) { this.publish({ message: error }); return; }
    const controller = new AbortController(), scope = this.scopeKey, epoch = this.epoch;
    this.controller = controller;
    const frozen = clone(input), requestId = (this.dependencies.requestId ?? (() => crypto.randomUUID()))();
    let adjudicationResults: AdjudicationResult[];
    try { adjudicationResults = resolveAdjudicationEvents(inheritedArenaAdjudication(frozen, this.dependencies.product).events, this.dependencies.random ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]! / 0x1_0000_0000)) as unknown as AdjudicationResult[]; }
    catch { this.controller = null; this.publish({ message: '本地随机判定失败，未开始生成。' }); return; }
    this.resultMode = intent.mode; this.dirty = true;
    this.publish({ phase: 'generating', activeGenerationMode: intent.generationMode, generation: { input: frozen, intent: { ...clone(intent), requestId }, scopeKey: scope, adjudicationResults, startedAt: (this.dependencies.now ?? (() => new Date().toISOString()))(), profileId: options.profileId, providerTarget: options.providerTarget ? clone(options.providerTarget) : undefined }, report: null, rawText: '', markdown: '', reasoning: '', usage: undefined, candidates: null,
      message: null, restored: false, saveStatus: 'idle', saveError: null, draftSaved: false }); this.retryDraftSave();
    try {
      const outcome = await (this.dependencies.execute ?? executeArenaDirect)(options, buildDesktopArenaInput(frozen, this.dependencies.product), { ...clone(intent), requestId },
        { scopeKey: scope, reporterInfo: { name: '记者', publication: '魔法少女速报' }, adjudicationResults }, controller.signal, (partial) => {
          if (!this.current(scope, epoch) || controller.signal.aborted) return;
          this.publish({ ...partial, draftSaved: false });
          if (!this.draftTimer) this.draftTimer = setTimeout(() => this.retryDraftSave(), 1000);
        });
      if (!this.current(scope, epoch)) return;
      if (controller.signal.aborted || outcome.status === 'cancelled') { this.publish({ phase: 'cancelled', message: '生成已取消，收到的原文仍可导出。' }); return; }
      this.publish({ rawText: outcome.rawText, markdown: outcome.markdown, reasoning: outcome.reasoning, usage: outcome.usage, draftSaved: false });
      if (outcome.status !== 'completed') { this.publish({ phase: 'failed', message: outcome.message }); return; }
      if (outcome.terminal?.status !== 'completed' || outcome.terminal.finishReason !== 'stop') throw new Error('战报未以正常终态完成，原文已保留。');
      if (outcome.scopeKey !== scope || outcome.requestId !== requestId) throw new Error('生成结果身份不匹配。');
      this.complete(frozen, outcome, (this.dependencies.now ?? (() => new Date().toISOString()))());
    } catch (cause) { if (this.current(scope, epoch)) this.publish({ phase: controller.signal.aborted ? 'cancelled' : 'failed', message: cause instanceof Error ? cause.message : '生成失败，原文保留。' }); }
    finally { if (this.controller === controller) this.controller = null; if (!this.disposed) this.retryDraftSave(); }
  }
  private complete(input: ArenaDraft, outcome: Extract<ArenaDirectOutcome, { status: 'completed' }>, occurredAt: string) {
    const source = { combatants: input.combatants, report: outcome.report as unknown as Record<string, unknown>, impacts: outcome.impacts,
      userGuidance: input.settings.userGuidance, scenario: input.battleMode === 'scenario' ? input.scenario.content : null,
      writeArenaHistory: input.settings.writeArenaHistory, writeCurrentState: input.settings.writeCurrentState,
      writeNarrativeHistory: input.settings.writeNarrativeHistory,
      narrativeHistory: { entries: input.narrativeHistoryEntries, title: outcome.report.headline, content: outcome.markdown } };
    const worldLineIds = Object.fromEntries(getArenaPostBattleWorldLineIndices({ ...source, generationId: outcome.requestId }).map((index) => [index, `${outcome.requestId}:${index}`]));
    const candidates = projectUnsignedArenaPostBattleCandidates(source, { scopeKey: outcome.scopeKey, requestId: outcome.requestId, generationId: outcome.requestId, occurredAt, worldLineIds });
    const effects = new Map(candidates.characterEffects.map((effect) => [effect.combatantIndex, effect.data]));
    const draft = { ...this.state.draft,
      combatants: this.state.draft.combatants.map((item, index) => effects.has(index) ? { ...item, data: effects.get(index)!, isValid: false, isPreset: false } : item),
      narrativeHistoryEntries: candidates.narrativeHistory?.entries ?? this.state.draft.narrativeHistoryEntries,
      ...(this.dependencies.product === 'arena' && candidates.narrativeHistory?.appended ? { historyUpdatedAt: occurredAt } : {}) };
    this.publish({ phase: 'completed', report: outcome.report, draft, candidates, message: '生成完成。工作副本已更新；保存到本地库需单独确认操作。' });
  }
  cancel() { this.controller?.abort(); this.importController?.abort(); }
  async save(kind: 'history' | 'characters'): Promise<boolean> {
    if (this.disposed || this.isBusy() || this.state.pendingRestore) return false;
    const scope = this.scopeKey, epoch = this.epoch, candidates = this.state.candidates;
    if (kind === 'characters' && (!candidates || candidates.scopeKey !== scope)) return false;
    const entries = clone([...this.state.draft.narrativeHistoryEntries]);
    if (kind === 'history' && !entries.length) return false;
    const occurredAt = kind === 'characters' ? candidates!.occurredAt : this.state.draft.historyUpdatedAt ?? entries.at(-1)!.updatedAt;
    // Advanced history can combine manual/imported/generated entries; no single execution mode owns the card.
    const executionMode = kind === 'history' && this.dependencies.product === 'arena' ? undefined : this.resultMode;
    const items = kind === 'history'
      ? [{ cardType: 'history' as const, title: 'Arena 叙事历史', data: { templateId: 'narrative-history', version: 1, title: 'Arena 叙事历史', updatedAt: occurredAt, entries } }]
      : candidates!.characterEffects.map((effect) => ({ cardType: 'character' as const, title: String(effect.data.codename || effect.data.name || '战后角色'), data: clone(effect.data) }));
    this.publish({ saving: true, saveStatus: 'idle', saveError: null });
    try {
      for (const item of items) {
        const digest = await digestLocalCardPayloadV1(item.data);
        if (!this.current(scope, epoch)) return false;
        const saved = LocalCardRecordV1Schema.parse({ id: deriveLocalDataCardIdV1(digest), schemaVersion: 1, storageLocation: 'local', ...item,
          contentDigest: digest, provenance: { kind: 'unsigned', ...(executionMode ? { execution: executionMode } : {}) }, createdAt: occurredAt, updatedAt: occurredAt });
        if (localLibraryRecordBytes(saved).byteLength > MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES) throw new Error('完整文档超过本地库单条 4 MiB 上限。');
        const result = await this.dependencies.repository.putIfAbsent(saved);
        if (!this.current(scope, epoch)) return false;
        if ('alreadyPresent' in result) { const existing = await this.dependencies.repository.get(saved.id); if (!this.current(scope, epoch)) return false; if (!existing || existing.deletedAt) throw new Error('相同内容位于回收站，请到本地库显式恢复。'); }
      }
      if (!this.current(scope, epoch)) return false;
      this.publish({ saveStatus: 'saved' }); return true;
    } catch (cause) { if (this.current(scope, epoch)) this.publish({ saveStatus: 'failed', saveError: `${cause instanceof Error ? cause.message : '保存失败。'} 完整原文仍在内存，可导出或重试，无需重新生成。` }); return false; }
    finally { this.publish({ saving: false }); }
  }
  exportDocument() { return JSON.stringify({ version: 1, product: this.dependencies.product ?? 'battle', draft: this.state.draft, generation: this.state.generation, result: { phase: this.state.phase, rawText: this.state.rawText, markdown: this.state.markdown, reasoning: this.state.reasoning, report: this.state.report, usage: this.state.usage }, candidates: this.state.candidates }, null, 2); }
  dispose() { if (this.dirty) this.retryDraftSave(); this.disposed = true; this.epoch += 1; this.controller?.abort(); this.importController?.abort(); if (this.draftTimer) clearTimeout(this.draftTimer); this.listeners.clear(); }
}
