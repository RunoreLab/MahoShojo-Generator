import { NewsReport } from '@/components/BattleReportCard';
import { UserAIProviderConfig } from '@/components/AiProviderSelector';
import { Preset } from '@/pages/api/get-presets';
import { StatsData } from '@/pages/api/get-stats';
import { AdjudicatorEvent, AdjudicationResult, CharacterCurrentState } from '@/types/arena';

export const MAX_COMBATANTS = 10;
export const ARENA_STATE_PREF_KEY = 'arena-history-state-preferences-v1';

export type CombatantType = 'magical-girl' | 'canshou' | 'general-character';
export type BattleMode = 'classic' | 'kizuna' | 'daily' | 'scenario';
export type StoryLengthOption = 'default' | 'short' | 'standard' | 'detailed' | 'long';

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
}

export interface BattleSettings {
  readArenaHistory: boolean;
  readArenaHistoryLimit: number;
  isArenaHistoryUnlimited: boolean;
  writeArenaHistory: boolean;
  readCurrentState: boolean;
  writeCurrentState: boolean;
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
  battleMode: BattleMode;
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
  isMatching: 'character' | 'scenario' | null;
  loadingPreset: string | null;
  userProviderConfig: UserAIProviderConfig | null;
  stats: StatsData | null;

  setBattleMode: (mode: BattleMode) => void;
  setStoryLength: (length: StoryLengthOption) => void;
  setSelectedLevel: (level: string) => void;
  setSelectedLanguage: (language: string) => void;
  updateSettings: (settings: Partial<BattleSettings>) => void;

  addCombatant: (combatant: Combatant) => void;
  removeCombatant: (identifier: string) => void;
  setCombatants: (combatants: Combatant[]) => void;
  clearCombatants: () => void;
  updateCombatantTeam: (filename: string, teamId: number) => void;

  setScenario: (scenario: ScenarioState) => void;
  clearScenario: () => void;

  setAdjudicationEvents: (events: AdjudicatorEvent[]) => void;
  setAdjudicationResults: (results: AdjudicationResult[] | null) => void;

  setNewsReport: (report: NewsReport | null) => void;
  setUpdatedCombatants: (list: UpdatedCombatantData[]) => void;

  setError: (message: string | null) => void;
  setIsGenerating: (state: boolean) => void;
  setIsMatching: (target: 'character' | 'scenario' | null) => void;
  setLoadingPreset: (filename: string | null) => void;
  setUserProviderConfig: (config: UserAIProviderConfig | null) => void;
  setStats: (stats: StatsData | null) => void;
}
