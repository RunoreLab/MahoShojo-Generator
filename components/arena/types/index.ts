import type { NewsReport } from '@/components/BattleReportCard';
import type { UserAIProviderConfig } from '@/components/AiProviderSelector';
import type { Preset } from '@/lib/presets';
import type { StatsData } from '@/pages/api/get-stats';
import type { AdjudicatorEvent, AdjudicationResult, CharacterCurrentState } from '@/types/arena';
import type { NormalizedStreamUpdateMeta } from '@/lib/arena/stream-meta';
import type { QuestionnaireDefinition } from '@/lib/questionnaires';
import type { AIReasoningEnvelope } from '@/types/ai-reasoning';

/** 参战角色上限；为 null 代表不限制数量。 */
export const MAX_COMBATANTS: number | null = null;
export const MAX_AUX_SCENARIOS = 10;
export const ARENA_STATE_PREF_KEY = 'arena-history-state-preferences-v1';

export const hasCombatantLimit = (limit: number | null = MAX_COMBATANTS): limit is number =>
  typeof limit === 'number' && Number.isFinite(limit) && limit > 0;

export const isCombatantLimitReached = (count: number, limit: number | null = MAX_COMBATANTS): boolean =>
  hasCombatantLimit(limit) && count >= limit;

export const formatCombatantCount = (count: number, limit: number | null = MAX_COMBATANTS): string =>
  hasCombatantLimit(limit) ? `${count}/${limit}` : `${count}/无限制`;

export type CombatantType = 'magical-girl' | 'canshou' | 'general-character';
export type BattleMode = 'classic' | 'kizuna' | 'daily' | 'scenario';
export type StoryLengthOption = 'default' | 'short' | 'standard' | 'detailed' | 'long';
export type GenerationMode = 'non-stream' | 'stream';
export type StreamTransportMode = 'sse' | 'plain-stream';
export type BattleReportCardWidthMode = 'auto' | 'manual';

export type QuestionnaireSelectionSource = 'preset' | 'upload' | 'database';

export type QuestionnaireSelection = {
  source: QuestionnaireSelectionSource;
  questionnaire: QuestionnaireDefinition;
  dataCardId?: string;
  dataCardName?: string;
  dataCardAuthor?: string;
  selectionId?: string;
  useLore?: boolean;
};

export type StreamUpdateMetaDebug = {
  source: 'sse' | 'inline';
  parseOk: boolean;
  error?: string | null;
  raw?: string | null;
  rawTruncated?: boolean;
  meta?: NormalizedStreamUpdateMeta | null;
};

export interface BattleTeam {
  id: number;
  /** 分队名称（会传递给 AI）。 */
  name: string;
  /** 是否在列表中折叠。 */
  isCollapsed: boolean;
}

export interface UpdatedCombatantData {
  codename?: string;
  name?: string;
  arena_history: any;
  signature?: string;
  current_state?: CharacterCurrentState | null;
  [key: string]: any;
}

export interface CombatantData {
  type: CombatantType;
  data: any;
  filename: string;
  isValid: boolean;
  isPreset: boolean;
  isNonStandard?: boolean;
  wasCorrected?: boolean;
  teamId?: number;
  /** 用户对该角色的行动/想法引导（可选，最多 100 字）。 */
  characterGuidance?: string;
  sourceDataCardId?: string;
  sourceDataCardDescription?: string;
  sourceDataCardCreatedAt?: string;
  sourceDataCardUpdatedAt?: string;
  sourceDataCardName?: string;
  sourceIsPublic?: boolean;
  sourceAuthor?: string;
  sourceDataCardUsageCount?: number;
  sourceDataCardLikeCount?: number;
  sourceDataCardFavoriteCount?: number;
}

export interface RandomCombatantPlaceholder {
  type: 'random-magical-girl' | 'random-canshou';
  id: string;
  filename: string;
  teamId?: number;
}

export type Combatant = CombatantData | RandomCombatantPlaceholder;

export interface ScenarioState {
  content: Record<string, unknown> | null;
  fileName: string | null;
  isNative: boolean;
  sourceDataCardId?: string;
  sourceDataCardDescription?: string;
  sourceDataCardCreatedAt?: string;
  sourceDataCardUpdatedAt?: string;
  sourceDataCardName?: string;
  sourceIsPublic?: boolean;
  sourceAuthor?: string;
  sourceDataCardUsageCount?: number;
  sourceDataCardLikeCount?: number;
  sourceDataCardFavoriteCount?: number;
}

export type AuxiliaryScenarioState = Omit<ScenarioState, 'content'> & {
  id: string;
  content: Record<string, unknown>;
};

export interface BattleSettings {
  readArenaHistory: boolean;
  readArenaHistoryLimit: number;
  isArenaHistoryUnlimited: boolean;
  writeArenaHistory: boolean;
  readCurrentState: boolean;
  writeCurrentState: boolean;
  readNarrativeHistory: boolean;
  readNarrativeHistoryLimit: number;
  isNarrativeHistoryUnlimited: boolean;
  writeNarrativeHistory: boolean;
  streamTransport: StreamTransportMode;
  userGuidance: string;
  battleReportCardWidthMode?: BattleReportCardWidthMode;
  battleReportCardWidthPx?: number;
}

export interface LanguageOption {
  code: string;
  name: string;
}

export interface PresetCollections {
  magicalGirl: Preset[];
  canshou: Preset[];
}

export interface BattleApiResponse {
  report: NewsReport;
  updatedCombatants: UpdatedCombatantData[];
  adjudicationResults?: AdjudicationResult[];
  /** 本次战报生成记录 ID（用于排位结算查询等增强功能）。 */
  generationId?: string;
  /** AI 原始 impacts（用于战报插图提示词，来源必须为本次 AI 输出）。 */
  impacts?: BattleAiImpact[];
}

export interface BattleAiImpact {
  characterName: string;
  impact?: string;
  currentStateSummary?: string;
}

export interface BattleStoreState {
  combatants: Combatant[];
  teams: BattleTeam[];
  scenario: ScenarioState;
  auxScenarios: AuxiliaryScenarioState[];
  selectedQuestionnaires: QuestionnaireSelection[];
  battleMode: BattleMode;
  generationMode: GenerationMode;
  /** 是否启用“自由排位”计分（默认关闭；仅影响 free 队列）。 */
  arenaFreeRankingEnabled: boolean;
  isStreaming: boolean;
  streamingMarkdown: string | null;
  streamReporterInfo: NewsReport['reporterInfo'] | null;
  streamUserGuidance: string | null;
  streamCharacterGuidances: NonNullable<NewsReport['characterGuidances']> | null;
  streamAiUsage: NewsReport['aiUsage'] | null;
  streamAiModel: string | null;
  streamNarrativeHistoryReadCount: number | null;
  streamReasoning: AIReasoningEnvelope | null;
  streamUpdateMetaDebug: StreamUpdateMetaDebug | null;
  latestAiImpacts: BattleAiImpact[] | null;
  storyLength: StoryLengthOption;
  customStoryLength: string;
  selectedLanguage: string;
  /** 最近一次生成战报的 generationId（用于排位结算展示）。 */
  lastGenerationId: string | null;
  settings: BattleSettings;
  adjudicationEvents: AdjudicatorEvent[];
  adjudicationResults: AdjudicationResult[] | null;
  newsReport: NewsReport | null;
  updatedCombatants: UpdatedCombatantData[];
  error: string | null;
  isGenerating: boolean;
  isRedoingUpdates: boolean;
  isMatching: 'character' | 'scenario' | null;
  loadingPreset: string | null;
  userProviderConfig: UserAIProviderConfig | null;
  stats: StatsData | null;

  setBattleMode: (mode: BattleMode) => void;
  setGenerationMode: (mode: GenerationMode) => void;
  setArenaFreeRankingEnabled: (enabled: boolean) => void;
  setIsStreaming: (state: boolean) => void;
  setStreamingMarkdown: (markdown: string | null) => void;
  setStreamReporterInfo: (info: NewsReport['reporterInfo'] | null) => void;
  setStreamUserGuidance: (guidance: string | null) => void;
  setStreamCharacterGuidances: (guidances: NonNullable<NewsReport['characterGuidances']> | null) => void;
  setStreamAiUsage: (usage: NewsReport['aiUsage'] | null) => void;
  setStreamAiModel: (model: string | null) => void;
  setStreamNarrativeHistoryReadCount: (count: number | null) => void;
  setStreamReasoning: (reasoning: AIReasoningEnvelope | null) => void;
  setStreamUpdateMetaDebug: (debug: StreamUpdateMetaDebug | null) => void;
  setLatestAiImpacts: (impacts: BattleAiImpact[] | null) => void;
  setStoryLength: (length: StoryLengthOption) => void;
  setCustomStoryLength: (length: string) => void;
  setSelectedLanguage: (language: string) => void;
  setLastGenerationId: (generationId: string | null) => void;
  updateSettings: (settings: Partial<BattleSettings>) => void;

  addCombatant: (combatant: Combatant) => void;
  removeCombatant: (identifier: string) => void;
  setCombatants: (combatants: Combatant[]) => void;
  moveCombatant: (fromIndex: number, toIndex: number) => void;
  clearCombatants: () => void;
  /** 调整角色所属分队；teamId 为 null/0 代表未分队。identifier 支持角色 filename 或占位符 id。 */
  updateCombatantTeam: (identifier: string, teamId: number | null) => void;
  updateCombatantCharacterGuidance: (filename: string, guidance: string) => void;

  /** 新建分队并返回分队 id。 */
  addTeam: (name?: string) => number;
  removeTeam: (teamId: number) => void;
  renameTeam: (teamId: number, name: string) => void;
  toggleTeamCollapsed: (teamId: number) => void;

  setScenario: (scenario: ScenarioState) => void;
  clearScenario: () => void;

  addAuxScenario: (scenario: AuxiliaryScenarioState) => void;
  removeAuxScenario: (id: string) => void;
  moveAuxScenario: (fromIndex: number, toIndex: number) => void;
  clearAuxScenarios: () => void;
  setAuxScenarios: (scenarios: AuxiliaryScenarioState[]) => void;

  setAdjudicationEvents: (events: AdjudicatorEvent[]) => void;
  setAdjudicationResults: (results: AdjudicationResult[] | null) => void;

  setNewsReport: (report: NewsReport | null) => void;
  setUpdatedCombatants: (list: UpdatedCombatantData[]) => void;

  setError: (message: string | null) => void;
  setIsGenerating: (state: boolean) => void;
  setIsRedoingUpdates: (state: boolean) => void;
  setIsMatching: (target: 'character' | 'scenario' | null) => void;
  setLoadingPreset: (filename: string | null) => void;
  setUserProviderConfig: (config: UserAIProviderConfig | null) => void;
  setStats: (stats: StatsData | null) => void;

  addQuestionnaireSelection: (selection: QuestionnaireSelection) => void;
  removeQuestionnaireSelection: (selectionId: string) => void;
  setQuestionnaireSelections: (selections: QuestionnaireSelection[]) => void;
  toggleQuestionnaireSelectionLore: (selectionId: string, enabled: boolean) => void;
}
