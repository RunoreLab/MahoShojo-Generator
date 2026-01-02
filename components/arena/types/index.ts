import type { NewsReport } from '@/components/BattleReportCard';
import type { UserAIProviderConfig } from '@/components/AiProviderSelector';
import type { Preset } from '@/pages/api/get-presets';
import type { StatsData } from '@/pages/api/get-stats';
import type { AdjudicatorEvent, AdjudicationResult, CharacterCurrentState } from '@/types/arena';

export const MAX_COMBATANTS = 10;
export const MAX_AUX_SCENARIOS = 10;
export const ARENA_STATE_PREF_KEY = 'arena-history-state-preferences-v1';

export type CombatantType = 'magical-girl' | 'canshou' | 'general-character';
export type BattleMode = 'classic' | 'kizuna' | 'daily' | 'scenario';
export type StoryLengthOption = 'default' | 'short' | 'standard' | 'detailed' | 'long';
export type GenerationMode = 'non-stream' | 'stream';

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
  writeNarrativeHistory: boolean;
  userGuidance: string;
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
}

export interface BattleStoreState {
  combatants: Combatant[];
  scenario: ScenarioState;
  auxScenarios: AuxiliaryScenarioState[];
  battleMode: BattleMode;
  generationMode: GenerationMode;
  isStreaming: boolean;
  streamingMarkdown: string | null;
  streamReporterInfo: NewsReport['reporterInfo'] | null;
  streamUserGuidance: string | null;
  streamAiUsage: NewsReport['aiUsage'] | null;
  streamAiModel: string | null;
  streamNarrativeHistoryReadCount: number | null;
  storyLength: StoryLengthOption;
  selectedLevel: string;
  selectedLanguage: string;
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
  setIsStreaming: (state: boolean) => void;
  setStreamingMarkdown: (markdown: string | null) => void;
  setStreamReporterInfo: (info: NewsReport['reporterInfo'] | null) => void;
  setStreamUserGuidance: (guidance: string | null) => void;
  setStreamAiUsage: (usage: NewsReport['aiUsage'] | null) => void;
  setStreamAiModel: (model: string | null) => void;
  setStreamNarrativeHistoryReadCount: (count: number | null) => void;
  setStoryLength: (length: StoryLengthOption) => void;
  setSelectedLevel: (level: string) => void;
  setSelectedLanguage: (language: string) => void;
  updateSettings: (settings: Partial<BattleSettings>) => void;

  addCombatant: (combatant: Combatant) => void;
  removeCombatant: (identifier: string) => void;
  setCombatants: (combatants: Combatant[]) => void;
  moveCombatant: (fromIndex: number, toIndex: number) => void;
  clearCombatants: () => void;
  updateCombatantTeam: (filename: string, teamId: number) => void;

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
}
