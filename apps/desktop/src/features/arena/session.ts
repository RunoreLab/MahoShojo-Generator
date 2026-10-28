import { normalizeArenaRepairDraft, prepareAndApplyArenaCombatantRepair } from '@mahoshojo/ai-core/arena-combatant-repair';
import { precheckArenaBattleReportForRepair } from '@mahoshojo/ai-core/arena-repair-meta';
import { materializeArenaRandomCombatants, isArenaRandomCombatantPlaceholder } from '@mahoshojo/domain/arena-random-combatants';
import { isArenaRealCombatant, requireArenaRealCombatants, type ArenaDraftCombatant } from './roster-types';
import { readArenaReportPresentationSnapshot, snapshotDesktopArenaReport } from './report-presentation';
import { parseArenaFailureDiagnostic, type ArenaFailureDiagnostic, type ArenaFailureStage } from './failure-diagnostic';
import { ArenaHostedBridgeError } from '../../platform/arena-hosted-bridge';
import { clearDesktopArenaSource, projectDesktopArenaCombatant } from './strict-source';
import { createArenaHostedNativeSettle } from '../../platform/arena-hosted-settle';
import { buildNarrativeDraftArchive, createNarrativeDraftCandidate,
  NarrativeDraftCompletionSchema, parseNarrativeDraftArchive, type NarrativeDraft, type NarrativeDraftCompletion } from '@mahoshojo/domain/narrative-drafts';
import { createNarrativeDraftController, createNarrativeDraftRepository, type NarrativeDraftStoragePort } from '@mahoshojo/domain/narrative-draft-storage';
import { applyArenaReconciliationUpdates, buildArenaReconciliationRetryPayload, projectArenaReconciliationCombatants } from '@mahoshojo/domain/arena-reconciliation';
import { reconcileArenaHosted } from '../../platform/arena-reconciliation-bridge';
import type { LocalCardProvenance } from '@mahoshojo/local-library/record';
import { projectArenaCompanionReportForView } from './hosted-json';
import type { DesktopArenaHostedAnyRecoveryPointer as DesktopArenaHostedRecoveryPointer } from '@mahoshojo/contracts/desktop-arena-hosted-json';
import { parseBattleReportRenderSnapshotV1, type BattleReportRenderSnapshotV1 } from '@mahoshojo/contracts';
import { WebPackageRefSchema, WebPackagePromptProjectionSchema } from '@mahoshojo/contracts/web-package';
import { ARENA_WEB_PACKAGE_META_ABSENT_MESSAGE, buildArenaGenerationInputSnapshot, toBattleReportMarkdown, type ArenaBattleReport } from '@mahoshojo/ai-core/arena-generation';
import { ARENA_CANONICAL_CAPABILITIES, ARENA_CANONICAL_RESOURCE_LIMITS, evaluateArenaBasicGenerationReadiness } from '@mahoshojo/contracts/arena-capabilities';
import { countBattleStoryCommitJsonBytes } from '@mahoshojo/domain/arena-story-commit';
import { validateArenaAiInputJson } from '@mahoshojo/contracts/ai-execution';
import { MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES } from '@mahoshojo/contracts/desktop-ipc';
import { SafeJsonValueSchema } from '@mahoshojo/contracts/json-value';
import { getArenaPostBattleWorldLineIndices } from '@mahoshojo/domain/arena-post-battle';
import { projectUnsignedArenaPostBattleCandidates, type ArenaUnsignedPostBattleCandidates } from '@mahoshojo/domain/arena-post-battle-candidates';
import { resolveAdjudicationEvents } from '@mahoshojo/domain/arena-adjudication';
import { isLegacyAdjudicatorFormat } from '@mahoshojo/domain/arena-character-validator';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import { buildArenaQuestionnaireRequest } from '@mahoshojo/domain/arena-questionnaire-request';
import { appendNarrativeHistoryEntry, type NarrativeHistorySort } from '@mahoshojo/domain/narrative-history-operations';
import { DesktopArenaHostedGenerationIdSchema, type DesktopArenaHostedActor } from '@mahoshojo/contracts/desktop-arena-hosted';
import { DesktopArenaHostedRecovery } from './hosted-recovery';
import { ARENA_HOSTED_DETACH, ARENA_HOSTED_USER_STOP, executeArenaHosted, resumeArenaHosted, parseArenaHostedDetails, type ArenaHostedContext, type ArenaHostedDetails, type ArenaHostedIntent, type ArenaHostedOutcome } from './hosted';
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
import { executeArenaDirect, type ArenaDirectHostContext, type ArenaDirectInput, type ArenaDirectIntent, type ArenaDirectOutcome, type ArenaDirectPartial } from './direct';

export const ARENA_DRAFT_KEY = 'mahoshojo.desktop.arena.battle.draft.v1';
export const ADVANCED_ARENA_DRAFT_KEY = 'mahoshojo.desktop.arena.advanced.draft.v1';
export type DesktopArenaProduct = 'battle' | 'arena';
const MAX_DRAFT_CHARACTERS = 4 * 1024 * 1024;
const clone = <T,>(value: T): T => structuredClone(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export type ArenaAuxiliaryScenario = ArenaDirectInput['auxScenarios'][number] & { id?: string; fileName?: string | null; isPreset?: boolean; adjudicationSourceKey?: string; cardLibrarySelectionId?: string };
export type ArenaHistoryOriginal = { id: string; name: string; text: string; importedAt: string };
export type ArenaDraft = Omit<ArenaDirectInput, 'auxScenarios' | 'combatants' | 'scenario'> & { combatants: readonly ArenaDraftCombatant[]; scenario: ArenaDirectInput['scenario'] & { isPreset?: boolean }; generationMode: 'stream' | 'non-stream'; historyReferences: ArenaDirectInput['narrativeHistoryEntries']; auxScenarios: readonly ArenaAuxiliaryScenario[]; selectedQuestionnaires?: QuestionnaireSelection[]; historyOriginals?: ArenaHistoryOriginal[]; historySort?: NarrativeHistorySort; historyUpdatedAt?: string | null; narrativeDrafts?: readonly NarrativeDraft[] };
const withoutNarrativeDrafts = (draft: ArenaDraft): ArenaDraft => { const next = { ...draft }; delete next.narrativeDrafts; return next; };
export const createInitialArenaDraft = (): ArenaDraft & { combatants: readonly ArenaDirectInput['combatants'][number][] } => ({
  combatants: [], teams: [], battleMode: 'classic', reportFormat: 'markdown', arenaFreeRankingEnabled: false,
  scenario: { content: null, fileName: null }, scenarioDisplayName: null, auxScenarios: [], materials: [],
  selectedLanguage: 'zh-CN', storyLength: 'default', customStoryLength: '', generationMode: 'non-stream',
  settings: { userGuidance: '', readArenaHistory: true, readArenaHistoryLimit: 10, isArenaHistoryUnlimited: false, writeArenaHistory: true,
    readCurrentState: true, writeCurrentState: true, readNarrativeHistory: false, readNarrativeHistoryLimit: 10,
    isNarrativeHistoryUnlimited: false, writeNarrativeHistory: false },
  narrativeHistoryEntries: [], historyReferences: [], adjudicationEvents: [],
});
export type ArenaCharacterSaveSelection = { readonly generationId: string; readonly combatantIndex: number; readonly data: Record<string, unknown> };
export type ArenaSessionPhase = 'idle' | 'generating' | 'completed' | 'failed' | 'cancelled';
export interface ArenaSessionState extends ArenaDirectPartial {
  draft: ArenaDraft; generation: { input: ArenaDraft; intent: ArenaDirectIntent | ArenaHostedIntent; scopeKey: string; startedAt: string; adjudicationResults: AdjudicationResult[]; profileId: string; providerTarget: DesktopAiExecutionOptions['providerTarget'] } | null; phase: ArenaSessionPhase; activeGenerationMode: ArenaDraft['generationMode'] | null; report: ArenaBattleReport | null;
  hosted: ArenaHostedDetails | null; hostedGenerationId: string | null;
  failureDiagnostic?: ArenaFailureDiagnostic | null;
  /** Explicit edited derivatives, never original generation candidates. */
  repairs?: { scopeKey: string; generationId: string; items: readonly { combatantIndex: number; data: Record<string, unknown> }[] } | null;
  roleUpdates: { status: 'idle' | 'updating' | 'completed' | 'unavailable' | 'restored'; message: string | null;
    items: readonly { combatantIndex: number; data: Record<string, unknown>; isNative: boolean }[] };
  resultFormat: 'markdown' | 'web'; renderSnapshot: BattleReportRenderSnapshotV1 | null;
  repairing?: boolean;
  pendingRestore: boolean; draftSaved: boolean; draftError: string | null; message: string | null;
  saving: boolean; importing: boolean; saveStatus: 'idle' | 'saved' | 'failed'; saveError: string | null;
  candidates: ArenaUnsignedPostBattleCandidates | null; restored: boolean;
  narrativeDraftCandidate: NarrativeDraft | null; narrativeDraftStatus: 'idle' | 'available' | 'stored' | 'memory-only';
}
export const validateArenaDraft = (value: unknown, product: DesktopArenaProduct = 'battle'): ArenaDraft => {
  if (!record(value) || !SafeJsonValueSchema.safeParse(value).success || (value.reportFormat !== 'markdown' && value.reportFormat !== 'web') || value.arenaFreeRankingEnabled !== false
    || typeof value.battleMode !== 'string' || !['classic', 'kizuna', 'daily', 'scenario'].includes(value.battleMode) || typeof value.generationMode !== 'string' || !['stream', 'non-stream'].includes(value.generationMode)
    || !Array.isArray(value.combatants) || !Array.isArray(value.teams) || !Array.isArray(value.materials) || !Array.isArray(value.auxScenarios)
    || !Array.isArray(value.historyReferences) || !Array.isArray(value.adjudicationEvents) || !Array.isArray(value.narrativeHistoryEntries)
    || !record(value.scenario) || !(value.scenario.content === null || record(value.scenario.content))
    || !(value.scenario.isPreset === undefined || typeof value.scenario.isPreset === 'boolean')
    || !(value.scenario.fileName === null || typeof value.scenario.fileName === 'string') || !(value.scenarioDisplayName === null || typeof value.scenarioDisplayName === 'string')
    || !record(value.settings) || typeof value.selectedLanguage !== 'string' || typeof value.storyLength !== 'string' || !['default', 'short', 'standard', 'detailed', 'long'].includes(value.storyLength)
    || (value.customStoryLength !== undefined && typeof value.customStoryLength !== 'string')
    || typeof value.settings.userGuidance !== 'string'
    || !['readArenaHistory', 'writeArenaHistory', 'isArenaHistoryUnlimited', 'readCurrentState', 'writeCurrentState', 'readNarrativeHistory', 'writeNarrativeHistory', 'isNarrativeHistoryUnlimited'].every((key) => typeof (value.settings as Record<string, unknown>)[key] === 'boolean')
    || !['readArenaHistoryLimit', 'readNarrativeHistoryLimit'].every((key) => typeof (value.settings as Record<string, unknown>)[key] === 'number' && Number.isInteger((value.settings as Record<string, unknown>)[key]) && Number((value.settings as Record<string, unknown>)[key]) >= 1)) throw new Error('Arena 草稿格式不受支持');
  const draft = value as unknown as ArenaDraft;
  if (draft.webPackageRef != null) WebPackageRefSchema.parse(draft.webPackageRef);
  if (draft.webPackagePromptProjection !== undefined) WebPackagePromptProjectionSchema.parse(draft.webPackagePromptProjection);
  if (product === 'arena' && !draft.adjudicationEvents.every((event) => AdjudicatorEventSchema.safeParse(event).success)) throw new Error('Arena 判定编辑草稿不合法');
  if (draft.selectedQuestionnaires !== undefined) parseDesktopLoreSelections(draft.selectedQuestionnaires);
  if ((draft.historyOriginals !== undefined && (!Array.isArray(draft.historyOriginals) || !draft.historyOriginals.every((item) => record(item) && (['id', 'name', 'text', 'importedAt'] as const).every((key) => typeof item[key] === 'string'))))
    || (draft.historySort !== undefined && !['prompt_order', 'updated_desc', 'updated_asc', 'created_desc', 'created_asc'].includes(draft.historySort))
    || (draft.historyUpdatedAt !== undefined && draft.historyUpdatedAt !== null && typeof draft.historyUpdatedAt !== 'string')) throw new Error('Arena 历史编辑草稿不合法');
  if (draft.combatants.length > ARENA_CANONICAL_CAPABILITIES.maxCombatants || draft.auxScenarios.length + draft.materials.length > ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity
    || !draft.combatants.every((item) => isArenaRandomCombatantPlaceholder(item) ? Object.keys(item).every(key => ['type', 'id', 'filename', 'teamId'].includes(key)) && item.id.trim().length > 0 && item.id.length <= 200 && item.filename.length > 0 && (item.teamId === undefined || Number.isSafeInteger(item.teamId) && item.teamId > 0) : record(item) && record(item.data) && typeof item.type === 'string' && ['magical-girl', 'canshou', 'general-character'].includes(item.type) && typeof item.filename === 'string' && typeof item.isValid === 'boolean' && typeof item.isPreset === 'boolean'
      && (item.cardLibrarySelectionId === undefined || typeof item.cardLibrarySelectionId === 'string' && /^(cloud|local|cache):.+$/.test(item.cardLibrarySelectionId))
      && (item.desktopSource === undefined || item.desktopSource === 'online' || item.desktopSource === 'preset')
      && (item.teamId === undefined || (Number.isSafeInteger(item.teamId) && item.teamId > 0)) && (item.characterGuidance === undefined || typeof item.characterGuidance === 'string'))
    || !draft.teams.every((team) => record(team) && Number.isSafeInteger(team.id) && team.id > 0 && typeof team.name === 'string')
    || !draft.materials.every((item) => record(item) && (item.cardLibrarySelectionId === undefined || typeof item.cardLibrarySelectionId === 'string' && /^(cloud|local|cache):.+$/.test(item.cardLibrarySelectionId)) && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.sourceType === 'string' && typeof item.sourceKind === 'string' && ['wantu-card', 'mahoshojo-data-card', 'raw-json'].includes(item.sourceKind) && Object.prototype.hasOwnProperty.call(item, 'content') && (item.fileName === null || typeof item.fileName === 'string'))
    || !draft.auxScenarios.every((item) => record(item) && (item.cardLibrarySelectionId === undefined || typeof item.cardLibrarySelectionId === 'string' && /^(cloud|local|cache):.+$/.test(item.cardLibrarySelectionId)) && record(item.content) && (item.id === undefined || typeof item.id === 'string') && (item.fileName === undefined || item.fileName === null || typeof item.fileName === 'string') && (item.adjudicationSourceKey === undefined || typeof item.adjudicationSourceKey === 'string') && (item.isPreset === undefined || typeof item.isPreset === 'boolean'))) throw new Error('Arena 草稿资源不合法');
  NarrativeHistorySchema.parse({ templateId: 'narrative-history', version: 1, updatedAt: '', entries: draft.narrativeHistoryEntries });
  NarrativeHistorySchema.parse({ templateId: 'narrative-history', version: 1, updatedAt: '', entries: draft.historyReferences });
  if (draft.narrativeDrafts !== undefined && !parseNarrativeDraftArchive(buildNarrativeDraftArchive(draft.narrativeDrafts))) throw new Error('未完成叙事草稿不合法');
  return { ...clone(draft), ...(draft.selectedQuestionnaires !== undefined ? { selectedQuestionnaires: parseDesktopLoreSelections(draft.selectedQuestionnaires) } : {}) };
};
export const inheritedArenaAdjudication = (draft: ArenaDraft, product: DesktopArenaProduct = 'battle') => {
  // Advanced imports maintain editable, source-marked events. Never re-add deleted/edited source events at dispatch.
  if (product === 'arena') return { events: [...draft.adjudicationEvents], skippedLegacy: 0 };
  const sources = [...draft.combatants.filter(isArenaRealCombatant).map((item) => item.data), ...(draft.battleMode === 'scenario' && draft.scenario.content ? [draft.scenario.content] : [])];
  const events = [...draft.adjudicationEvents]; let skippedLegacy = 0;
  for (const source of sources) {
    if (!record(source) || !Array.isArray(source.adjudicationEvents)) continue;
    if (isLegacyAdjudicatorFormat(source.adjudicationEvents)) { skippedLegacy += source.adjudicationEvents.length; continue; }
    events.push(...source.adjudicationEvents);
  }
  return { events, skippedLegacy };
};
/** Picker row identities stay in the local draft, outside model/server inputs. */
const projectArenaLibraryMaterial = (value: unknown): unknown => {
  if (!record(value)) return value;
  const { cardLibrarySelectionId: _selectionId, ...material } = value;
  return material;
};
export const buildDesktopArenaInput = (draft: ArenaDraft, product: DesktopArenaProduct = 'battle'): ArenaDirectInput => ({ ...withoutNarrativeDrafts(draft), combatants: requireArenaRealCombatants(draft.combatants).map(projectDesktopArenaCombatant), materials: draft.materials.map(projectArenaLibraryMaterial), scenario: { ...draft.scenario, fileName: draft.scenario.isPreset === true ? draft.scenario.fileName : null }, ...(draft.selectedQuestionnaires ? buildArenaQuestionnaireRequest(draft.selectedQuestionnaires) : {}), adjudicationEvents: inheritedArenaAdjudication(draft, product).events, narrativeHistoryEntries: [...draft.historyReferences, ...draft.narrativeHistoryEntries] });
export const arenaReferenceCount = (draft: ArenaDraft): number => { const input = buildArenaGenerationInputSnapshot(buildDesktopArenaInput({ ...draft, combatants: draft.combatants.filter(isArenaRealCombatant) })); return (input.materials?.length ?? 0) + (input.auxScenarios?.length ?? 0) + (input.questionnaires?.length ?? 0) + (input.narrativeHistory?.length ?? 0); };
export const arenaReadinessMessage = (draft: ArenaDraft, product: DesktopArenaProduct = 'battle', editorPreview = false): string | null => {
  if (!editorPreview && draft.combatants.some(item => !isArenaRealCombatant(item))) return '随机角色尚未生成。';
  const issue = evaluateArenaBasicGenerationReadiness({ battleMode: draft.battleMode, combatantCount: draft.combatants.length, hasScenario: !!draft.scenario.content })[0];
  if (issue?.code === 'GENERATION_SCENARIO_REQUIRED') return '请先选择主情景。';
  if (issue) return `当前模式至少需要 ${ARENA_CANONICAL_CAPABILITIES.minCombatantsByMode[draft.battleMode]} 位角色。`;
  const payload = buildArenaGenerationInputSnapshot(buildDesktopArenaInput(editorPreview ? { ...draft, combatants: draft.combatants.filter(isArenaRealCombatant) } : draft, product));
  try { countBattleStoryCommitJsonBytes(payload, ARENA_CANONICAL_RESOURCE_LIMITS.requestBodyBytes); } catch { return '输入超过 Arena 资源上限或格式不受支持；请调整输入，内容不会被截断。'; }
  if (!(editorPreview && draft.combatants.some(item => !isArenaRealCombatant(item))) && !validateArenaAiInputJson(JSON.stringify(payload))) return '输入超过 Arena 资源上限或格式不受支持；请调整输入，内容不会被截断。';
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
  private pending: { draft: ArenaDraft; exportDraft: ArenaDraft; output?: Record<string, unknown> } | null = null;
  private draftBlocked = false;
  private dirty = false;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private hostedResultScope: string | null = null;
  private roleController: AbortController | null = null;
  private repairing = false;
  private roleContext: { pointer: DesktopArenaHostedRecoveryPointer; generationId: string; scope: string; epoch: number } | null = null;
  private roleCandidates: { scopeKey: string; generationId: string; occurredAt: string; items: readonly { combatantIndex: number; data: Record<string, unknown>; provenance: LocalCardProvenance }[] } | null = null;
  private resultMode: ArenaDirectIntent['mode'] | 'hosted' | undefined;
  private completedNarrativeRequestId: string | null = null;
  readonly narrativeDrafts: ReturnType<typeof createNarrativeDraftController>;
  private narrativeDraftUnsubscribe: (() => void) | null = null;
  private legacyNarrativeRaw: string | null = null;
  private legacyNarrativeReadBlocked = false;
  private legacyNarrativeSourceKey: string;
  private get legacyNarrativeKey() { return `${this.draftKey}.narrative-legacy.v1`; }
  readonly hostedRecovery: DesktopArenaHostedRecovery;
  private get draftKey() { return this.dependencies.product === 'arena' ? ADVANCED_ARENA_DRAFT_KEY : ARENA_DRAFT_KEY; }
  constructor(private readonly dependencies: { product?: DesktopArenaProduct; repository: CardRepository; storage: GenerationDraftStorage; execute?: typeof executeArenaDirect; executeHosted?: typeof executeArenaHosted; resumeHosted?: typeof resumeArenaHosted; hostedTestPorts?: Pick<ArenaHostedContext, 'createChannel' | 'wait' | 'maxReconnectAttempts'>; resolveWebPackage?: ArenaDirectHostContext['resolveWebPackage']; requestId?: () => string; now?: () => string; random?: () => number; materializeRandomCombatants?: typeof materializeArenaRandomCombatants }) {
    this.legacyNarrativeSourceKey = this.legacyNarrativeKey;
    this.narrativeDrafts = createNarrativeDraftController(createNarrativeDraftRepository(dependencies.storage as NarrativeDraftStoragePort, `mahoshojo.desktop.arena.${dependencies.product ?? 'battle'}.narrative-drafts`));
    this.hostedRecovery = new DesktopArenaHostedRecovery(dependencies.storage, dependencies.product ?? 'battle');
    this.state = { repairs: null, roleUpdates: { status: 'idle', message: null, items: [] }, hosted: null, hostedGenerationId: null, draft: createInitialArenaDraft(), generation: null, rawText: '', markdown: '', reasoning: '', phase: 'idle', activeGenerationMode: null, report: null, resultFormat: 'markdown', renderSnapshot: null, pendingRestore: false,
      draftSaved: true, draftError: null, message: null, saving: false, importing: false, saveStatus: 'idle', saveError: null, candidates: null, restored: false,
      narrativeDraftCandidate: null, narrativeDraftStatus: 'idle' };
    let originalRaw: string | null = null;
    try {
      const raw = dependencies.storage.getItem(this.draftKey); originalRaw = raw;
      if (raw !== null) {
        if (raw.length > MAX_DRAFT_CHARACTERS) throw new Error('oversize');
        const saved: unknown = JSON.parse(raw);
        if (record(saved) && record(saved.draft) && Object.prototype.hasOwnProperty.call(saved.draft, 'narrativeDrafts')) {
          this.legacyNarrativeRaw = raw; this.legacyNarrativeSourceKey = this.draftKey;
        }
        if (!record(saved) || (saved.version !== 1 && saved.version !== 2)) throw new Error('version');
        const draft = validateArenaDraft(saved.draft, this.dependencies.product);
        if (saved.version === 1 && draft.combatants.some(item => !isArenaRealCombatant(item))) throw new Error('version');
        if (saved.output !== undefined && (!record(saved.output) || typeof saved.output.phase !== 'string' || !['idle', 'completed', 'failed', 'cancelled'].includes(saved.output.phase)
          || (saved.output.completedRequestId !== undefined && (typeof saved.output.completedRequestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(saved.output.completedRequestId)))
          || (saved.output.executionMode !== undefined && saved.output.executionMode !== 'direct-local' && saved.output.executionMode !== 'direct-remote' && saved.output.executionMode !== 'hosted')
          || (saved.output.generationMode !== undefined && saved.output.generationMode !== null && saved.output.generationMode !== 'stream' && saved.output.generationMode !== 'non-stream')
          || (saved.output.reportFormat !== undefined && saved.output.reportFormat !== 'markdown' && saved.output.reportFormat !== 'web')
          || (saved.output.renderSnapshot !== undefined && saved.output.renderSnapshot !== null && (parseBattleReportRenderSnapshotV1(saved.output.renderSnapshot)?.reportFormat !== 'web' || saved.output.reportFormat !== 'web'))
          || !['rawText', 'markdown', 'reasoning'].every((key) => typeof (saved.output as Record<string, unknown>)[key] === 'string'))) throw new Error('output');
        if (record(saved.output)) { parseArenaHostedDetails(saved.output.hosted); if (saved.output.hostedGenerationId != null) DesktopArenaHostedGenerationIdSchema.parse(saved.output.hostedGenerationId); }
        if (draft.narrativeDrafts?.length) { this.legacyNarrativeRaw = raw; this.legacyNarrativeSourceKey = this.draftKey; }
        const restoredDraft = { ...draft }; delete restoredDraft.narrativeDrafts;
        this.pending = { draft: restoredDraft, exportDraft: saved.draft as ArenaDraft, output: saved.output as Record<string, unknown> | undefined };
        this.state.pendingRestore = true;
      }
    } catch {
      this.legacyNarrativeRaw = originalRaw; this.legacyNarrativeReadBlocked = originalRaw === null;
      this.legacyNarrativeSourceKey = this.draftKey;
      this.draftBlocked = true; this.state.draftSaved = false; this.state.draftError = '旧草稿无法读取，原数据已保留。可在内存继续创作并完整导出，清除旧草稿前不会覆盖。';
    }
    this.narrativeDraftUnsubscribe = this.narrativeDrafts.subscribe((archive) => {
      const next = { ...this.state.draft };
      if (archive.drafts.length) next.narrativeDrafts = archive.drafts; else delete next.narrativeDrafts;
      this.publish({ draft: next, narrativeDraftCandidate: archive.candidate, narrativeDraftStatus: archive.status });
    });
  }
  setNarrativeDraftScope(scope: string | null) { this.narrativeDrafts.setScope(scope); }
  loadLegacyNarrativeDrafts() { return this.narrativeDrafts.loadLegacyDrafts(this.legacyNarrativeSourceKey); }
  private preserveLegacyNarrativeDrafts() {
    if (this.legacyNarrativeReadBlocked) throw new Error('legacy-read-unavailable');
    if (this.legacyNarrativeRaw === null) return;
    const previous = this.dependencies.storage.getItem(this.legacyNarrativeKey);
    if (previous !== null && previous !== this.legacyNarrativeRaw) throw new Error('legacy-conflict');
    if (previous === null) this.dependencies.storage.setItem(this.legacyNarrativeKey, this.legacyNarrativeRaw);
    if (this.dependencies.storage.getItem(this.legacyNarrativeKey) !== this.legacyNarrativeRaw) throw new Error('legacy-copy-failed');
    this.legacyNarrativeSourceKey = this.legacyNarrativeKey;
    if (this.narrativeDrafts.getState().legacy !== null) this.narrativeDrafts.loadLegacyDrafts(this.legacyNarrativeSourceKey);
  }
  /** 用户确认后一次物化；任何异常均不安装半成品，失败重试沿已安装正文。 */
  materializeRandomPlaceholders(expected: ArenaDraft): ArenaDraft {
    if (this.disposed || this.isBusy() || this.state.pendingRestore || this.state.draft !== expected) throw new Error('当前草稿已经变化，请重新确认。');
    const placeholders = expected.combatants.filter(isArenaRandomCombatantPlaceholder);
    if (!placeholders.length) return expected;
    const generated = (this.dependencies.materializeRandomCombatants ?? materializeArenaRandomCombatants)(placeholders);
    const next = validateArenaDraft({ ...expected, combatants: [...expected.combatants.filter(isArenaRealCombatant), ...generated] }, this.dependencies.product);
    const error = arenaReadinessMessage(next, this.dependencies.product); if (error) throw new Error(error);
    this.updateDraft(next);
    return this.state.draft;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  isBusy = () => this.repairing || !!this.roleController || !!this.controller || !!this.importController || this.state.saving;
  hasUnsavedDraft = () => this.dirty && !this.state.draftSaved || this.narrativeDrafts.getState().hasUnsavedAcrossScopes;
  private publish(patch: Partial<ArenaSessionState>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener()); }
  private current(scope: string, epoch: number) { return !this.disposed && this.scopeKey === scope && this.epoch === epoch; }
  setScope(scopeKey: string) {
    if (scopeKey === this.scopeKey) return;
    const wasGenerating = !!this.controller && this.state.phase === 'generating'; this.roleController?.abort(); this.roleContext = null; this.roleCandidates = null; this.hostedResultScope = null; this.clearHostedSoftTimeout();
    this.scopeKey = scopeKey; this.epoch += 1; this.controller?.abort(ARENA_HOSTED_DETACH); this.importController?.abort();
    this.narrativeDrafts.clearCandidate();
    this.publish({ roleUpdates: { ...this.state.roleUpdates, status: 'restored', message: '账号或 AI 配置已变更；原角色更新不再具有当前会话保存资格。' }, candidates: null, ...(wasGenerating ? { phase: 'cancelled' as const, report: null, message: this.resultMode === 'hosted' ? '账号或 AI 配置已变更，已停止本机订阅；服务器仍可能运行，请显式恢复原请求。' : '账号或 AI 配置已变更，原生成已取消，收到的原文仍可导出。' } : {}) });
  }
  updateDraft(draft: ArenaDraft) {
    if (this.disposed || this.isBusy() || this.state.pendingRestore) return;
    const validated = validateArenaDraft(withoutNarrativeDrafts(draft), this.dependencies.product);
    if (this.state.draft.narrativeDrafts) validated.narrativeDrafts = this.state.draft.narrativeDrafts; else delete validated.narrativeDrafts;
    this.dirty = true;
    this.publish({ draft: validated, draftSaved: false, saveStatus: 'idle', saveError: null }); this.retryDraftSave();
  }
  async importInput(load: (signal: AbortSignal) => Promise<(draft: ArenaDraft) => ArenaDraft>): Promise<void> {
    if (this.disposed || this.isBusy() || this.state.pendingRestore) throw new Error('请先完成当前操作。');
    const scope = this.scopeKey, epoch = this.epoch, controller = new AbortController();
    this.importController = controller; this.publish({ importing: true });
    try { const apply = await load(controller.signal); if (!this.current(scope, epoch) || controller.signal.aborted) throw new Error('选择已失效，请重试。');
      const draft = validateArenaDraft(withoutNarrativeDrafts(apply(clone(this.state.draft))), this.dependencies.product);
      if (this.state.draft.narrativeDrafts) draft.narrativeDrafts = this.state.draft.narrativeDrafts;
      this.dirty = true; this.publish({ draft, draftSaved: false, saveStatus: 'idle', saveError: null }); this.retryDraftSave();
    } finally { if (this.importController === controller) this.importController = null; this.publish({ importing: false }); }
  }
  restoreDraft() {
    if (!this.pending || this.isBusy()) return;
    const saved = this.pending; this.pending = null; this.hostedResultScope = null; this.roleContext = null; this.roleCandidates = null;
    this.completedNarrativeRequestId = typeof saved.output?.completedRequestId === 'string' ? saved.output.completedRequestId : null;
    this.resultMode = saved.output?.executionMode === 'hosted' ? 'hosted' : saved.output?.executionMode === 'direct-remote' ? 'direct-remote' : saved.output?.executionMode === 'direct-local' ? 'direct-local' : undefined;
    const hosted = parseArenaHostedDetails(saved.output?.hosted, typeof saved.output?.hostedGenerationId === 'string' ? saved.output.hostedGenerationId : null);
    this.publish({ repairs: null, failureDiagnostic: parseArenaFailureDiagnostic(saved.output?.failureDiagnostic), roleUpdates: { status: 'restored', message: '本机草稿中的签名字段未经本机验证；恢复不会自动同步角色。', items: [] }, hosted, hostedGenerationId: typeof saved.output?.hostedGenerationId === 'string' ? saved.output.hostedGenerationId : null, draft: { ...saved.draft, ...(this.narrativeDrafts.getState().drafts.length ? { narrativeDrafts: this.narrativeDrafts.getState().drafts } : {}), scenario: { ...saved.draft.scenario, isPreset: false }, combatants: saved.draft.combatants.map(item => isArenaRealCombatant(item) ? { ...clearDesktopArenaSource(item), isValid: false } : item) }, pendingRestore: false, restored: true, generation: null, draftSaved: true,
      rawText: String(saved.output?.rawText ?? ''), markdown: String(saved.output?.markdown ?? ''), reasoning: String(saved.output?.reasoning ?? ''),
      presentation: readArenaReportPresentationSnapshot(saved.output?.presentation),
      resultFormat: saved.output?.reportFormat === 'web' ? 'web' : 'markdown', renderSnapshot: parseBattleReportRenderSnapshotV1(saved.output?.renderSnapshot),
      activeGenerationMode: saved.output?.generationMode === 'stream' ? 'stream' : 'non-stream', phase: saved.output?.phase as ArenaSessionPhase ?? 'idle', report: hosted?.companion ? projectArenaCompanionReportForView(hosted.companion) : null, candidates: null,
      message: '已恢复本机草稿与原文，不会自动重新生成或写入本地库。' });
  }
  discardDraft() {
    if (this.isBusy()) return;
    try { this.preserveLegacyNarrativeDrafts(); this.roleContext = null; this.roleCandidates = null; this.dependencies.storage.removeItem(this.draftKey); this.pending = null; this.draftBlocked = false; this.dirty = false; this.completedNarrativeRequestId = null;
      this.narrativeDrafts.clearCandidate();
      this.publish({ presentation: null, failureDiagnostic: null, repairs: null, roleUpdates: { status: 'idle', message: null, items: [] }, hosted: null, hostedGenerationId: null, draft: { ...createInitialArenaDraft(), ...(this.narrativeDrafts.getState().drafts.length ? { narrativeDrafts: this.narrativeDrafts.getState().drafts } : {}) }, generation: null, pendingRestore: false, draftSaved: true, draftError: null, rawText: '', markdown: '', reasoning: '', report: null, resultFormat: 'markdown', renderSnapshot: null, phase: 'idle', candidates: null, message: null, saveError: null, saveStatus: 'idle', narrativeDraftCandidate: null, narrativeDraftStatus: 'idle' });
    } catch { this.publish({ draftError: '清除失败，旧草稿仍受保护。' }); }
  }
  retryDraftSave() {
    if (this.draftTimer) clearTimeout(this.draftTimer); this.draftTimer = null;
    if (this.disposed || this.draftBlocked || this.state.pendingRestore) return;
    try { this.preserveLegacyNarrativeDrafts(); const { draft, rawText, markdown, reasoning, phase } = this.state;
      const inputDraft = { ...draft }; delete inputDraft.narrativeDrafts;
      const raw = JSON.stringify({ version: inputDraft.combatants.every(isArenaRealCombatant) ? 1 : 2, draft: inputDraft, output: { rawText, markdown, reasoning, presentation: snapshotDesktopArenaReport(this.state) ?? undefined, failureDiagnostic: parseArenaFailureDiagnostic(this.state.failureDiagnostic), hosted: this.state.hosted, hostedGenerationId: this.state.hostedGenerationId, reportFormat: this.state.resultFormat, renderSnapshot: this.state.renderSnapshot, executionMode: this.resultMode, generationMode: this.state.activeGenerationMode, phase: phase === 'generating' ? 'cancelled' : phase,
        ...(this.completedNarrativeRequestId ? { completedRequestId: this.completedNarrativeRequestId } : {}) } });
      if (raw.length > MAX_DRAFT_CHARACTERS) throw new Error('limit');
      this.dependencies.storage.setItem(this.draftKey, raw); this.publish({ draftSaved: true, draftError: null });
    } catch { this.publish({ draftSaved: false, draftError: '页面草稿保存失败、旧数据保护或超过 4 MiB 字符上限。完整内容保留在内存，请导出后再离开。' }); }
  }
  private offerNarrativeDraft(requestId: string, source: NarrativeDraft['source'], acceptedText: string,
    completion: NarrativeDraftCompletion | null, input: ArenaDraft | undefined, scope: string, epoch: number, archiveScope: string | null, automatic: boolean) {
    const candidate = createNarrativeDraftCandidate({ requestId, source, acceptedText, completion,
      createdAt: this.state.draft.narrativeDrafts?.find(item => item.requestId === requestId)?.createdAt
        ?? this.state.generation?.startedAt ?? (this.dependencies.now ?? (() => new Date().toISOString()))(),
      reportFormat: input?.reportFormat ?? this.state.resultFormat, generationMode: input?.generationMode ?? this.state.activeGenerationMode ?? '',
      current: this.current(scope, epoch), cancelled: this.controller?.signal.aborted === true,
      completed: this.completedNarrativeRequestId === requestId || this.state.draft.narrativeHistoryEntries.some(item => item.id === `arena-generation:${requestId}`),
    });
    if (!candidate) return;
    this.narrativeDrafts.offerDraft(candidate, automatic, archiveScope);
  }
  saveNarrativeDraft(): boolean {
    if (this.disposed || this.state.phase !== 'failed' || this.state.pendingRestore) return false;
    return this.narrativeDrafts.saveCandidate().ok;
  }
  exportNarrativeDrafts(): string { return JSON.stringify(buildNarrativeDraftArchive(this.narrativeDrafts.getState().drafts), null, 2); }
  private markNarrativeCompleted(requestId: string, archiveScope: string | null) {
    this.completedNarrativeRequestId = requestId;
    this.narrativeDrafts.completeRequest(requestId, archiveScope);
  }
  async generate(options: DesktopAiExecutionOptions, input: ArenaDraft, intent: Omit<ArenaDirectIntent, 'requestId'>): Promise<void> {
    if (this.disposed || this.isBusy() || this.state.pendingRestore || !this.scopeKey) return;
    const error = arenaReadinessMessage(input, this.dependencies.product); if (error) { this.publish({ message: error }); return; }
    const controller = new AbortController(), scope = this.scopeKey, epoch = this.epoch;
    const archiveScope = this.narrativeDrafts.getState().scope, automatic = this.narrativeDrafts.getState().autoRetain;
    this.narrativeDrafts.clearCandidate();
    this.controller = controller;
    const frozen = clone(withoutNarrativeDrafts(input)), requestId = (this.dependencies.requestId ?? (() => crypto.randomUUID()))();
    let adjudicationResults: AdjudicationResult[];
    try { adjudicationResults = resolveAdjudicationEvents(inheritedArenaAdjudication(frozen, this.dependencies.product).events, this.dependencies.random ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]! / 0x1_0000_0000)) as unknown as AdjudicationResult[]; }
    catch { this.controller = null; this.publish({ message: '本地随机判定失败，未开始生成。' }); return; }
    this.resultMode = intent.mode; this.dirty = true;
    this.roleContext = null; this.roleCandidates = null;
    this.publish({ presentation: null, failureDiagnostic: null, repairs: null, roleUpdates: { status: 'idle', message: null, items: [] }, hosted: null, hostedGenerationId: null, phase: 'generating', activeGenerationMode: intent.generationMode, generation: { input: frozen, intent: { ...clone(intent), requestId }, scopeKey: scope, adjudicationResults, startedAt: (this.dependencies.now ?? (() => new Date().toISOString()))(), profileId: options.profileId, providerTarget: options.providerTarget ? clone(options.providerTarget) : undefined }, report: null, resultFormat: frozen.reportFormat, renderSnapshot: null, rawText: '', markdown: '', reasoning: '', usage: undefined, candidates: null,
      message: null, restored: false, saveStatus: 'idle', saveError: null, draftSaved: false,
      narrativeDraftCandidate: null, narrativeDraftStatus: 'idle' }); this.retryDraftSave();
    try {
      const outcome = await (this.dependencies.execute ?? executeArenaDirect)(options, buildDesktopArenaInput(frozen, this.dependencies.product), { ...clone(intent), requestId },
        { scopeKey: scope, reporterInfo: { name: '记者', publication: '魔法少女速报' }, adjudicationResults, resolveWebPackage: this.dependencies.resolveWebPackage }, controller.signal, (partial) => {
          if (!this.current(scope, epoch) || controller.signal.aborted) return;
          this.publish({ ...partial, draftSaved: false });
          if (!this.draftTimer) this.draftTimer = setTimeout(() => this.retryDraftSave(), 1000);
        });
      if (!this.current(scope, epoch)) return;
      if (outcome.scopeKey !== scope || outcome.requestId !== requestId) throw new Error('生成结果身份不匹配。');
      if (controller.signal.aborted || outcome.status === 'cancelled') { this.publish({ phase: 'cancelled', message: '生成已取消，收到的原文仍可导出。' }); return; }
      this.publish({ rawText: outcome.rawText, markdown: outcome.markdown, reasoning: outcome.reasoning, usage: outcome.usage, presentation: outcome.presentation ?? null, draftSaved: false });
      if (outcome.status !== 'completed') {
        this.publish({ phase: 'failed', message: outcome.message, failureDiagnostic: parseArenaFailureDiagnostic(outcome.failureDiagnostic ?? { source: 'client', stage: 'native-stream', code: outcome.code }) });
        this.offerNarrativeDraft(requestId, intent.mode, outcome.rawText, outcome.draftCompletion ?? null, frozen, scope, epoch, archiveScope, automatic); return;
      }
      if (outcome.terminal?.status !== 'completed' || outcome.terminal.finishReason !== 'stop') throw new Error('战报未以正常终态完成，原文已保留。');
      this.markNarrativeCompleted(requestId, archiveScope);
      this.complete(frozen, outcome, (this.dependencies.now ?? (() => new Date().toISOString()))());
    } catch (cause) { if (this.current(scope, epoch)) this.publish({ phase: controller.signal.aborted ? 'cancelled' : 'failed', failureDiagnostic: controller.signal.aborted ? null : { source: 'client', stage: 'session', code: 'unclassified' }, message: cause instanceof Error ? cause.message : '生成失败，原文保留。' }); }
    finally { if (this.controller === controller) this.controller = null; if (!this.disposed) this.retryDraftSave(); }
  }
  async generateHosted(options: Pick<DesktopAiExecutionOptions, 'invoke'>, input: ArenaDraft,
    intent: Omit<ArenaHostedIntent, 'requestId'>, actor: DesktopArenaHostedActor, replaceRequestId?: string, repair?: import('./hosted-recovery').ArenaHostedRecoveryReplacement): Promise<void> {
    if (this.disposed || this.isBusy() || this.state.pendingRestore || !this.scopeKey) return;
    if (input.generationMode !== intent.generationMode) { this.publish({ message: '输出方式与已选执行方式不一致，请重新确认。' }); return; }
    const error = arenaReadinessMessage(input, this.dependencies.product); if (error) { this.publish({ message: error }); return; }
    const requestId = (this.dependencies.requestId ?? (() => crypto.randomUUID()))();
    await this.runHosted(options, { ...clone(intent), requestId }, clone(actor), clone(withoutNarrativeDrafts(input)), undefined, replaceRequestId, repair);
  }
  async restoreHosted(options: Pick<DesktopAiExecutionOptions, 'invoke'>, requestId: string): Promise<void> {
    if (this.disposed || this.isBusy() || this.state.pendingRestore || !this.scopeKey) return;
    const pointer = this.hostedRecovery.acceptRestore(requestId); if (!pointer) return;
    await this.runHosted(options, undefined, pointer.actor, undefined, pointer);
  }
  private async runHosted(options: Pick<DesktopAiExecutionOptions, 'invoke'>, intent: ArenaHostedIntent | undefined,
    actor: DesktopArenaHostedActor, frozen?: ArenaDraft, pointer?: DesktopArenaHostedRecoveryPointer, replaceRequestId?: string, repair?: import('./hosted-recovery').ArenaHostedRecoveryReplacement) {
    const scope = this.scopeKey, epoch = this.epoch, controller = new AbortController();
    const archiveScope = this.narrativeDrafts.getState().scope, automatic = this.narrativeDrafts.getState().autoRetain;
    this.narrativeDrafts.clearCandidate();
    this.roleContext = null; this.roleCandidates = null;
    this.controller = controller; this.resultMode = 'hosted'; this.hostedResultScope = scope; this.dirty = true;
    const requestId = intent?.requestId ?? pointer!.requestId;
    this.publish({ presentation: null, failureDiagnostic: null, repairs: null, roleUpdates: { status: 'idle', message: null, items: [] }, phase: 'generating', activeGenerationMode: intent?.generationMode ?? (pointer && pointer.version !== 1 ? pointer.delivery : 'stream'), hosted: null, hostedGenerationId: null,
      generation: frozen && intent ? { input: frozen, intent, scopeKey: scope, startedAt: (this.dependencies.now ?? (() => new Date().toISOString()))(), adjudicationResults: [], profileId: '', providerTarget: intent.presetConfig ? { kind: 'preset', providerId: intent.presetConfig.providerId } : { kind: 'system' } } : null,
      resultFormat: frozen?.reportFormat ?? pointer!.format, renderSnapshot: null, rawText: '', markdown: '', reasoning: '', report: null, usage: undefined,
      candidates: null, restored: Boolean(pointer), draftSaved: false, message: null, saveStatus: 'idle', saveError: null,
      narrativeDraftCandidate: null, narrativeDraftStatus: 'idle' });
    const context: ArenaHostedContext = { product: this.dependencies.product ?? 'battle', scopeKey: scope, actor,
      recovery: this.hostedRecovery, replaceRequestId, repair, resolveWebPackage: this.dependencies.resolveWebPackage,
      now: this.dependencies.now, ...this.dependencies.hostedTestPorts, isCurrent: () => this.current(scope, epoch) };
    const partial = (value: Parameters<NonNullable<Parameters<typeof executeArenaHosted>[5]>>[0]) => {
      if (!this.current(scope, epoch) || controller.signal.aborted) return;
      this.publish({ ...value, draftSaved: false }); if (!this.draftTimer) this.draftTimer = setTimeout(() => this.retryDraftSave(), 1000);
    };
    const native = createArenaHostedNativeSettle(options.invoke);
    const nativeOptions = { ...options, invoke: native.invoke };
    let failureStage: ArenaFailureStage = 'request';
    this.retryDraftSave();
    try {
      const outcome: ArenaHostedOutcome = pointer
        ? await (this.dependencies.resumeHosted ?? resumeArenaHosted)(nativeOptions, pointer, context, controller.signal, partial)
        : await (this.dependencies.executeHosted ?? executeArenaHosted)(nativeOptions, buildDesktopArenaInput(frozen!, this.dependencies.product), intent!, context, controller.signal, partial);
      if (!this.current(scope, epoch)) return;
      if (outcome.requestId !== requestId || outcome.scopeKey !== scope) throw new Error('服务器生成身份不匹配，未应用结果。');
      this.publish({ rawText: outcome.rawText, markdown: outcome.markdown, reasoning: outcome.reasoning, usage: outcome.usage,
        hosted: outcome.hosted, hostedGenerationId: outcome.generationId, draftSaved: false });
      if (controller.signal.aborted || outcome.status === 'cancelled') { this.publish({ phase: 'cancelled', message: outcome.status === 'cancelled' ? outcome.message : '停止状态尚未确认，请按原请求恢复。' }); return; }
      if (outcome.status !== 'completed') {
        this.publish({ phase: 'failed', message: outcome.message, failureDiagnostic: parseArenaFailureDiagnostic(outcome.hosted.failureDiagnostic) });
        const seal = await native.settleFailed(controller.signal);
        if (!this.current(scope, epoch)) return;
        if (controller.signal.aborted) { this.publish({ phase: 'cancelled' }); return; }
        const terminal = outcome.hosted.terminal;
        if (seal?.requestId === requestId && terminal?.data.status === 'failed' && terminal.data.code === seal.code) {
          const completion = NarrativeDraftCompletionSchema.safeParse({ kind: 'server-failed', code: seal.code });
          if (completion.success) this.offerNarrativeDraft(requestId, 'hosted', outcome.rawText, completion.data, frozen, scope, epoch, archiveScope, automatic);
        }
        return;
      }
      const streamCompleted = outcome.hosted.terminal?.event === 'done' && outcome.hosted.terminal.data.status === 'completed' && outcome.hosted.terminal.data.ok;
      const jsonCompleted = outcome.hosted.delivery === 'non-stream' && outcome.hosted.companionState === 'complete'
        && outcome.hosted.serverStatus === 'completed' && outcome.hosted.companion && 'report' in outcome.hosted.companion.body
        && outcome.hosted.companion.body.generationId === outcome.generationId;
      if (!streamCompleted && !jsonCompleted) throw new Error('服务器终态不合法。');
      // Channel delivery is not Native completion, including SSE recovery of an original JSON
      // task. Do not expose history/save/role authority until the final invoke has succeeded.
      failureStage = 'native-settle';
      const settled = await native.settle(controller.signal);
      if (!this.current(scope, epoch)) return;
      if (settled.status === 'aborted' || controller.signal.aborted) {
        this.publish({ phase: 'cancelled', message: '本机订阅已停止；服务器停止/完成状态尚需按原请求确认。' }); return;
      }
      if (settled.status === 'failed') throw settled.error;
      this.markNarrativeCompleted(requestId, archiveScope);
      this.publish({ phase: 'completed', report: outcome.report, renderSnapshot: outcome.renderSnapshot ?? null,
        message: outcome.hosted.validationMessage ?? '服务器生成完成。本地保存需单独操作。' });
      if (frozen?.settings.writeNarrativeHistory && outcome.canAppendHistory) this.appendHostedHistory();
      if (!this.current(scope, epoch) || controller.signal.aborted) return;
      const completedPointer = this.hostedRecovery.getSnapshot().pointer;
      const packageFallback = Boolean(completedPointer?.webPackageRef) && outcome.metaStatus === 'absent';
      if (!packageFallback && completedPointer?.requestId === requestId && outcome.generationId && completedPointer.version === 3
        && (completedPointer.writeArenaHistory || completedPointer.writeCurrentState)) {
        this.roleContext = { pointer: clone(completedPointer), generationId: outcome.generationId, scope, epoch };
        // Completion is already committed. A role-sync failure can never turn this report into a failure.
        if (this.controller === controller) this.controller = null;
        if (!pointer && outcome.hosted.outputValidation === 'valid') await this.retryHostedRoleUpdates(options);
        else this.publish({ repairs: null, roleUpdates: { status: 'idle', message: '本次报告已恢复；可显式重试服务器已生成的角色更新。', items: [] } });
      } else this.publish({ roleUpdates: { status: 'unavailable', message: packageFallback ? '缺少有效战报元数据，未应用角色历史或当前状态。Web 包仍可体验和导出。' : '本任务创建时未开启角色写入，保留原角色。', items: [] } });
    } catch (cause) { if (this.current(scope, epoch)) this.publish({ phase: controller.signal.aborted ? 'cancelled' : 'failed', failureDiagnostic: controller.signal.aborted ? null : parseArenaFailureDiagnostic({ source: 'server', stage: failureStage, code: cause instanceof ArenaHostedBridgeError ? cause.code : 'unclassified', ...(cause instanceof ArenaHostedBridgeError ? { dispatchState: cause.dispatchState } : {}) }), message: cause instanceof Error ? cause.message : '服务器连接未完成，可恢复原请求。' }); }
    finally { if (this.controller === controller) this.controller = null; if (this.current(scope, epoch)) this.retryDraftSave(); }
  }
  canRetryHostedRoleUpdates = () => this.state.repairs?.generationId !== this.state.hostedGenerationId && !!this.roleContext && this.current(this.roleContext.scope, this.roleContext.epoch)
    && this.state.phase === 'completed' && this.state.hosted?.outputValidation === 'valid' && this.state.hostedGenerationId === this.roleContext.generationId;
  hasHostedCharacterCopies = () => !!this.roleCandidates?.items.length && this.roleCandidates.scopeKey === this.scopeKey;
  async retryHostedRoleUpdates(options: Pick<DesktopAiExecutionOptions, 'invoke'>): Promise<void> {
    const context = this.roleContext;
    if (!context || !this.canRetryHostedRoleUpdates() || this.isBusy() || this.state.pendingRestore) return;
    const controller = new AbortController(); this.roleController = controller;
    if (this.state.draft.combatants.some(item => !isArenaRealCombatant(item))) { this.publish({ roleUpdates: { ...this.state.roleUpdates, message: '当前草稿包含尚未生成的随机角色，不能更新旧战报角色。' } }); this.roleController = null; return; }
    const submitted = clone(requireArenaRealCombatants(this.state.draft.combatants));
    const snapshot = JSON.stringify(projectArenaReconciliationCombatants(submitted));
    const isCurrent = () => this.current(context.scope, context.epoch) && this.roleContext === context
      && this.state.phase === 'completed' && this.state.hostedGenerationId === context.generationId && !controller.signal.aborted;
    this.publish({ roleUpdates: { ...this.state.roleUpdates, status: 'updating', message: null } });
    try {
      const payload = await buildArenaReconciliationRetryPayload(context.generationId, submitted);
      if (!isCurrent()) return;
      const response = await reconcileArenaHosted(options.invoke, { product: context.pointer.product, requestId: context.pointer.requestId, actor: context.pointer.actor }, payload,
        { signal: controller.signal, createChannel: this.dependencies.hostedTestPorts?.createChannel });
      if (!isCurrent()) return;
      if (JSON.stringify(projectArenaReconciliationCombatants(requireArenaRealCombatants(this.state.draft.combatants))) !== snapshot) throw new Error('角色更新上下文已变化，已丢弃过期的服务器响应。');
      if (!('success' in response)) throw new Error(response.error || '角色更新暂不可用，可按原任务重试。');
      const items = response.updatedCombatants;
      const projected = applyArenaReconciliationUpdates(requireArenaRealCombatants(this.state.draft.combatants), items);
      const occurredAt = (this.dependencies.now ?? (() => new Date().toISOString()))();
      if (items.length) this.roleCandidates = { scopeKey: context.scope, generationId: context.generationId, occurredAt, items: items.map(item => {
        const signature = typeof item.data.signature === 'string' && item.data.signature ? item.data.signature : null;
        return { combatantIndex: item.combatantIndex, data: clone(item.data), provenance: signature
          ? { kind: item.isNative ? 'official-signed' : 'signature-unverified', signature, execution: 'hosted' }
          : { kind: 'unsigned', execution: 'hosted' } };
      }) };
      const warnings = response.warnings.map(warning => warning.message).join('；');
      this.dirty = true;
      this.publish({ draft: { ...this.state.draft, combatants: projected.combatants.map((item, index) => items.some(update => update.combatantIndex === index) ? clearDesktopArenaSource(item) : item) }, draftSaved: false,
        roleUpdates: { status: 'completed', message: warnings ? `部分角色未能同步：${warnings}` : items.length ? '角色更新已应用；保存到本地库需单独操作。' : '本次没有新增角色更新。', items: items.length ? items : this.state.roleUpdates.items } });
    } catch (cause) {
      if (this.current(context.scope, context.epoch) && this.roleContext === context) this.publish({ roleUpdates: { ...this.state.roleUpdates, status: 'unavailable',
        message: controller.signal.aborted ? '本机角色同步已停止；报告与原卡仍保留，可按原任务重试。' : `${cause instanceof Error ? cause.message : '角色更新暂不可用。'} 报告与原卡仍保留，无需重新生成。` } });
    } finally {
      if (this.roleController === controller) this.roleController = null;
      if (this.current(context.scope, context.epoch)) this.retryDraftSave();
    }
  }
  /** Explicit recovered-report copy, or the original opted-in completion; never projects character effects. */
  canAppendHostedHistory = () => !this.disposed && this.hostedResultScope === this.scopeKey && this.state.phase === 'completed' && this.state.hosted?.outputValidation === 'valid' && !!this.state.hostedGenerationId;
  appendHostedHistory() {
    if (!this.canAppendHostedHistory()) return;
    const occurredAt = (this.dependencies.now ?? (() => new Date().toISOString()))();
    const projected = appendNarrativeHistoryEntry([...this.state.draft.narrativeHistoryEntries],
      { title: this.state.report?.headline ?? (this.state.resultFormat === 'web' ? 'Web 战报' : '恢复战报'), content: this.state.markdown, generationId: this.state.hostedGenerationId },
      { fallbackId: this.state.hostedGenerationId!, createdAt: occurredAt });
    if (!projected.appended || !projected.entry) return;
    const entries = projected.entries.map((entry) => entry === projected.entry ? { ...entry, hostedSource: {
      generationId: this.state.hostedGenerationId, metadataState: this.state.hosted!.metadataState, signedCharacterUpdates: false,
      ...(this.state.renderSnapshot ? { renderSnapshot: this.state.renderSnapshot } : {}) } } : entry);
    this.dirty = true;
    this.publish({ draft: { ...this.state.draft, narrativeHistoryEntries: entries, historyUpdatedAt: occurredAt }, draftSaved: false }); this.retryDraftSave();
  }
  private complete(input: ArenaDraft, outcome: Extract<ArenaDirectOutcome, { status: 'completed' }>, occurredAt: string) {
    const source = { combatants: requireArenaRealCombatants(input.combatants), report: outcome.report as unknown as Record<string, unknown>, impacts: outcome.impacts,
      userGuidance: input.settings.userGuidance, scenario: input.battleMode === 'scenario' ? input.scenario.content : null,
      writeArenaHistory: input.settings.writeArenaHistory && (input.reportFormat !== 'web' || outcome.metaStatus === 'valid'), writeCurrentState: input.settings.writeCurrentState && (input.reportFormat !== 'web' || outcome.metaStatus === 'valid'),
      writeNarrativeHistory: input.settings.writeNarrativeHistory,
      narrativeHistory: { entries: input.narrativeHistoryEntries, title: outcome.report.headline || (input.reportFormat === 'web' ? 'Web 战报' : ''), content: outcome.markdown } };
    const worldLineIds = Object.fromEntries(getArenaPostBattleWorldLineIndices({ ...source, generationId: outcome.requestId }).map((index) => [index, `${outcome.requestId}:${index}`]));
    const candidates = projectUnsignedArenaPostBattleCandidates(source, { scopeKey: outcome.scopeKey, requestId: outcome.requestId, generationId: outcome.requestId, occurredAt, worldLineIds });
    const effects = new Map(candidates.characterEffects.map((effect) => [effect.combatantIndex, effect.data]));
    const draft = { ...this.state.draft,
      combatants: this.state.draft.combatants.map((item, index) => effects.has(index) ? { ...clearDesktopArenaSource(item), data: effects.get(index)!, isValid: false, isPreset: false } : item),
      narrativeHistoryEntries: candidates.narrativeHistory?.entries ?? this.state.draft.narrativeHistoryEntries,
      ...(this.dependencies.product === 'arena' && candidates.narrativeHistory?.appended ? { historyUpdatedAt: occurredAt } : {}) };
    this.publish({ phase: 'completed', report: outcome.report, renderSnapshot: outcome.renderSnapshot ?? null, draft, candidates, message: input.reportFormat === 'web' && outcome.metaStatus !== 'valid' ? input.webPackageRef ? ARENA_WEB_PACKAGE_META_ABSENT_MESSAGE : '生成完成，未提供可用机器元数据，未应用角色效果。源码仍可保存和导出。' : '生成完成。工作副本已更新；保存到本地库需单独确认操作。' });
  }
  private clearHostedSoftTimeout() { if (this.state.hosted?.softTimeoutWarning) this.publish({ hosted: { ...this.state.hosted, softTimeoutWarning: null } }); }
  cancel() { this.roleController?.abort(); this.clearHostedSoftTimeout(); this.controller?.abort(this.resultMode === 'hosted' ? ARENA_HOSTED_USER_STOP : undefined); this.importController?.abort(); }
  detach() { this.roleController?.abort(); this.clearHostedSoftTimeout(); this.controller?.abort(ARENA_HOSTED_DETACH); this.importController?.abort(); }
  manualRepairGenerationId(): string | null {
    if (this.disposed || this.state.pendingRestore || this.state.phase !== 'completed' || !this.state.draft.combatants.length) return null;
    if (this.resultMode === 'hosted') return this.hostedResultScope === this.scopeKey && this.state.hosted?.outputValidation === 'valid' ? this.state.hostedGenerationId : null;
    return this.state.generation?.scopeKey === this.scopeKey ? this.state.candidates?.generationId ?? null : null;
  }
  async applyManualRepair(draftText: string, ports: {
    canApply: () => boolean;
    confirmTrustDowngrade: (names: readonly string[]) => boolean | Promise<boolean>;
    confirmCreateMissingEffects: () => boolean | Promise<boolean>;
  }): Promise<string> {
    const generationId = this.manualRepairGenerationId();
    if (!generationId || this.isBusy() || !ports.canApply()) throw new Error('当前结果不可修复，请先完成正在进行的操作。');
    if (!this.state.draft.combatants.every(isArenaRealCombatant)) throw new Error('当前名单含尚未生成的随机角色，不能应用旧战报修复；已有结果仍可下载或另存。');
    const scope = this.scopeKey, epoch = this.epoch, roster = requireArenaRealCombatants(this.state.draft.combatants), generation = this.state.generation;
    const reportMarkdown = this.state.markdown, structuredReport = this.state.report;
    const repairReportMarkdown = this.state.activeGenerationMode === 'non-stream' && this.state.resultFormat === 'markdown' && structuredReport
      ? toBattleReportMarkdown(structuredReport) : reportMarkdown;
    const mode = generation?.input.battleMode ?? this.state.presentation?.mode;
    const report = precheckArenaBattleReportForRepair(repairReportMarkdown, mode ?? '');
    if (!report.ok) throw new Error(report.error);
    const current = () => this.current(scope, epoch) && this.manualRepairGenerationId() === generationId
      && this.state.draft.combatants === roster && this.state.generation === generation && this.state.markdown === reportMarkdown && this.state.report === structuredReport && ports.canApply();
    this.repairing = true; this.publish({ repairing: true });
    try {
      const patches = await normalizeArenaRepairDraft({ draft: draftText, combatants: roster });
      if (!current()) throw new Error('角色或账号上下文已变化，本次修复未写入。');
      const result = await prepareAndApplyArenaCombatantRepair({ combatants: roster, generationId, patches,
        nowISO: (this.dependencies.now ?? (() => new Date().toISOString()))(),
        createHistoryEntry: mode ? { type: mode, title: report.parsed.headline, winner: report.parsed.winner,
          participants: roster.map(item => String(item.data.codename || item.data.name || '')),
          metadata: { non_native_data_involved: true, user_guidance: generation?.input.settings.userGuidance ?? null,
            scenario_title: generation?.input.scenarioDisplayName ?? null } } : undefined,
        // Desktop does not verify signatures; every actual edit is unsigned regardless of source hints.
        verifyNative: async () => false,
        confirmTrustDowngrade: names => current() && ports.confirmTrustDowngrade(names),
        confirmCreateMissingEffects: () => current() && ports.confirmCreateMissingEffects(),
      });
      if (!current()) throw new Error('角色或账号上下文已变化，本次修复未写入。');
      if (!result.ok) {
        if (!('issues' in result)) return '已取消，角色未修改。';
        throw new Error(result.issues.map(item => item.message).join('；'));
      }
      if (result.status === 'no-op') return '草稿内容与当前角色数据相同，未修改角色，也未改变其信任状态。';
      const changed = new Set(result.changedCombatantIndices);
      const combatants = result.combatants.map((item, index) => changed.has(index) ? clearDesktopArenaSource(item) : item);
      const items = new Map((this.state.repairs?.generationId === generationId ? this.state.repairs.items : []).map(item => [item.combatantIndex, item]));
      for (const index of changed) items.set(index, { combatantIndex: index, data: combatants[index]!.data });
      this.dirty = true;
      this.publish({ draft: { ...this.state.draft, combatants }, draftSaved: false,
        repairs: { scopeKey: scope, generationId, items: [...items.values()] }, saveStatus: 'idle', saveError: null });
      this.retryDraftSave();
      return `已应用 ${changed.size} 位角色的非原生修复。原卡未覆盖；请显式另存或下载修复副本。`;
    } finally { this.repairing = false; this.publish({ repairing: false }); }
  }
  canSaveRepairedCharacter = (selection?: ArenaCharacterSaveSelection) => {
    const repairs = this.state.repairs;
    return !this.disposed && !this.isBusy() && !this.state.pendingRestore && this.state.phase === 'completed'
      && !!repairs?.items.length && repairs.scopeKey === this.scopeKey && repairs.generationId === this.manualRepairGenerationId()
      && (!selection || selection.generationId === repairs.generationId && repairs.items.some(item => item.combatantIndex === selection.combatantIndex && item.data === selection.data));
  };
  async saveRepairedCharacters(selection?: ArenaCharacterSaveSelection): Promise<boolean> {
    if (!this.canSaveRepairedCharacter(selection)) return false;
    const repairs = this.state.repairs!, scope = this.scopeKey, epoch = this.epoch;
    const items = repairs.items.filter(item => !selection || item.combatantIndex === selection.combatantIndex);
    const current = () => this.current(scope, epoch) && this.state.repairs === repairs;
    this.publish({ saving: true, saveStatus: 'idle', saveError: null });
    try {
      for (const item of items) {
        const data = clone(item.data), digest = await digestLocalCardPayloadV1(data);
        if (!current()) return false;
        const now = (this.dependencies.now ?? (() => new Date().toISOString()))();
        const saved = LocalCardRecordV1Schema.parse({ id: deriveLocalDataCardIdV1(digest), schemaVersion: 1, storageLocation: 'local',
          cardType: 'character', title: String(data.codename || data.name || '修复角色'), data, contentDigest: digest,
          provenance: { kind: 'unsigned', execution: 'edited' }, createdAt: now, updatedAt: now });
        if (localLibraryRecordBytes(saved).byteLength > MAX_DESKTOP_LOCAL_CARD_DOCUMENT_BYTES) throw new Error('完整文档超过本地库单条 4 MiB 上限。');
        const outcome = await this.dependencies.repository.putIfAbsent(saved);
        if (!current()) return false;
        if ('alreadyPresent' in outcome) {
          const existing = await this.dependencies.repository.get(saved.id);
          if (!current()) return false;
          if (!existing || existing.deletedAt) throw new Error('相同内容位于回收站或暂不可读，请先到本地库检查。');
        }
      }
      this.publish({ saveStatus: 'saved' }); return true;
    } catch (cause) { if (current()) this.publish({ saveStatus: 'failed', saveError: `${cause instanceof Error ? cause.message : '保存失败。'} 修复副本仍可下载或重试保存。` }); return false; }
    finally { this.publish({ saving: false }); }
  }
  private resolveCharacterSave(selection: ArenaCharacterSaveSelection) {
    if (this.disposed || this.isBusy() || this.state.pendingRestore || this.state.phase !== 'completed') return null;
    if (this.resultMode === 'hosted') {
      const candidates = this.roleCandidates;
      if (!candidates || candidates.scopeKey !== this.scopeKey || candidates.generationId !== selection.generationId || this.state.hostedGenerationId !== selection.generationId) return null;
      const displayed = this.state.roleUpdates.items.find(item => item.combatantIndex === selection.combatantIndex);
      if (displayed?.data !== selection.data) return null;
      return candidates.items.find(item => item.combatantIndex === selection.combatantIndex) ?? null;
    }
    const candidates = this.state.candidates;
    if (!candidates || candidates.scopeKey !== this.scopeKey || candidates.generationId !== selection.generationId) return null;
    return candidates.characterEffects.find(item => item.combatantIndex === selection.combatantIndex && item.data === selection.data) ?? null;
  }
  canSaveCharacter = (selection: ArenaCharacterSaveSelection) => this.resolveCharacterSave(selection) !== null;
  saveCharacter(selection: ArenaCharacterSaveSelection): Promise<boolean> { return this.saveSelected('characters', selection); }
  save(kind: 'history' | 'characters'): Promise<boolean> { return this.saveSelected(kind); }
  private async saveSelected(kind: 'history' | 'characters', selection?: ArenaCharacterSaveSelection): Promise<boolean> {
    const selected = selection ? this.resolveCharacterSave(selection) : null;
    if (selection && !selected) return false;
    if (this.disposed || this.isBusy() || this.state.pendingRestore) return false;
    const scope = this.scopeKey, epoch = this.epoch, candidates = this.state.candidates, hostedCandidates = this.roleCandidates;
    if (kind === 'characters' && (!candidates || candidates.scopeKey !== scope) && (!hostedCandidates || hostedCandidates.scopeKey !== scope)) return false;
    const entries = clone([...this.state.draft.narrativeHistoryEntries]);
    if (kind === 'history' && !entries.length) return false;
    const occurredAt = kind === 'characters' ? (hostedCandidates ?? candidates)!.occurredAt : this.state.draft.historyUpdatedAt ?? entries.at(-1)!.updatedAt;
    // Both Arena routes can combine manual/imported/generated history; no single execution mode owns the card.
    const executionMode = kind === 'history' ? undefined : this.resultMode;
    const items = kind === 'history'
      ? [{ cardType: 'history' as const, title: 'Arena 叙事历史', data: { templateId: 'narrative-history', version: 1, title: 'Arena 叙事历史', updatedAt: occurredAt, entries } }]
      : hostedCandidates ? hostedCandidates.items.filter(item => !selected || item === selected).map(item => ({ cardType: 'character' as const, title: String(item.data.codename || item.data.name || '战后角色'), data: clone(item.data), provenance: item.provenance }))
      : candidates!.characterEffects.filter(effect => !selected || effect === selected).map((effect) => ({ cardType: 'character' as const, title: String(effect.data.codename || effect.data.name || '战后角色'), data: clone(effect.data) }));
    this.publish({ saving: true, saveStatus: 'idle', saveError: null });
    try {
      for (const item of items) {
        const digest = await digestLocalCardPayloadV1(item.data);
        if (!this.current(scope, epoch)) return false;
        const saved = LocalCardRecordV1Schema.parse({ id: deriveLocalDataCardIdV1(digest), schemaVersion: 1, storageLocation: 'local', ...item,
          contentDigest: digest, provenance: 'provenance' in item ? item.provenance : { kind: 'unsigned', ...(executionMode ? { execution: executionMode } : {}) }, createdAt: occurredAt, updatedAt: occurredAt });
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
  exportDocument() {
    // A backup must not depend on whether the page has restored its local draft yet.
    const pending = this.pending;
    const result = pending ? {
      phase: 'idle', rawText: '', markdown: '', reasoning: '', reportFormat: 'markdown', renderSnapshot: null,
      hosted: null, report: null, ...pending.output, failureDiagnostic: parseArenaFailureDiagnostic(pending.output?.failureDiagnostic),
    } : { phase: this.state.phase, repairs: this.state.repairs, presentation: snapshotDesktopArenaReport(this.state) ?? undefined, failureDiagnostic: parseArenaFailureDiagnostic(this.state.failureDiagnostic), roleUpdates: this.state.roleUpdates, hosted: this.state.hosted, hostedGenerationId: this.state.hostedGenerationId, reportFormat: this.state.resultFormat, renderSnapshot: this.state.renderSnapshot, rawText: this.state.rawText, markdown: this.state.markdown, reasoning: this.state.reasoning, report: this.state.report, usage: this.state.usage };
    return JSON.stringify({ version: (pending?.exportDraft ?? this.state.draft).combatants.every(isArenaRealCombatant) ? 1 : 2, product: this.dependencies.product ?? 'battle', hostedRecovery: this.hostedRecovery.getSnapshot(),
      draft: pending?.exportDraft ?? this.state.draft, generation: pending ? null : this.state.generation, result, candidates: pending ? null : this.state.candidates,
      // Only unreadable, protected originals need a separate raw backup; normal reports are not duplicated.
      ...(this.draftBlocked && this.legacyNarrativeRaw !== null ? { protectedLocalDraft: { format: 'arena-local-draft-raw', raw: this.legacyNarrativeRaw } } : {}),
    }, null, 2);
  }
  dispose() { if (this.dirty) this.retryDraftSave(); this.narrativeDraftUnsubscribe?.(); this.narrativeDraftUnsubscribe = null; this.disposed = true; this.epoch += 1; this.roleController?.abort(); this.controller?.abort(ARENA_HOSTED_DETACH); this.importController?.abort(); if (this.draftTimer) clearTimeout(this.draftTimer); this.listeners.clear(); }
}
