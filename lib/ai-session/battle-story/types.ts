import type { AiSessionListOptions, AiSessionProviderMode } from '@/lib/ai-session/types';

export type BattleStorySourceMode = 'classic' | 'kizuna' | 'daily' | 'scenario';
export type BattleStoryLengthOption = 'default' | 'short' | 'standard' | 'detailed' | 'long';
export type BattleStoryGenerationMode = 'stream';
export type BattleStorySessionAction = 'start' | 'continue' | 'branch' | 'rewrite';
export type BattleStoryChapterStatus = 'active' | 'superseded';

export type BattleStorySessionSettings = {
  readArenaHistory: boolean;
  writeArenaHistory: boolean;
  readCurrentState: boolean;
  writeCurrentState: boolean;
  readNarrativeHistory: boolean;
  writeNarrativeHistory: boolean;
};

export type BattleStoryQuestionnaireSeed = {
  id: string;
  title: string;
  kind: 'magical-girl' | 'canshou';
  useLore?: boolean;
  loreMarkdown?: string;
};

export type BattleStorySessionSeed = {
  combatants: unknown[];
  scenario?: Record<string, unknown> | null;
  auxScenarios?: Record<string, unknown>[];
  questionnaires?: BattleStoryQuestionnaireSeed[];
  settings: BattleStorySessionSettings;
};

export type BattleStorySessionSource = {
  mode: BattleStorySourceMode;
  language: string;
  storyLength: BattleStoryLengthOption;
  generationMode: BattleStoryGenerationMode;
  providerMode?: AiSessionProviderMode;
  providerId?: string;
  modelId?: string;
};

export type BattleStorySummaryMeta = {
  coveredUntilChapterIndex: number;
  coveredChapterIds: string[];
  refreshedAt: number;
  mode: 'ai' | 'deterministic-fallback';
};

export type BattleStorySessionBranchOf = {
  sessionId: string;
  chapterId: string;
};

export type BattleStorySessionRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: BattleStorySessionSource;
  seed: BattleStorySessionSeed;
  workingCombatants: unknown[];
  sessionSummary?: string;
  summaryMeta?: BattleStorySummaryMeta;
  lastChapterId?: string | null;
  lastChapterInputCombatants?: unknown[];
  chapterCount: number;
  branchOf?: BattleStorySessionBranchOf;
  archivedAt?: number;
};

export type BattleStoryImpactDigestItem = {
  characterName: string;
  impact?: string;
  currentStateSummary?: string;
};

export type BattleStoryDeterministicDigest = {
  chapterTitle: string;
  winner?: string;
  officialConclusion?: string;
  bodyExcerpt?: string;
  impactDigest?: BattleStoryImpactDigestItem[];
};

export type BattleStoryChapterRecord = {
  id: string;
  sessionId: string;
  index: number;
  action: BattleStorySessionAction;
  status: BattleStoryChapterStatus;
  sourceChapterId?: string | null;
  supersededByChapterId?: string | null;
  generationId?: string | null;
  title: string;
  markdown: string;
  reportJson: Record<string, unknown>;
  deterministicDigest: BattleStoryDeterministicDigest;
  createdAt: number;
};

export type BattleStorySessionListOptions = AiSessionListOptions & {
  includeArchived?: boolean;
  branchSessionId?: string;
};

export type BattleStoryChapterListOptions = AiSessionListOptions & {
  includeSuperseded?: boolean;
};

export type BattleStoryPromptSectionKey =
  | 'seed'
  | 'current-state'
  | 'session-summary'
  | 'recent-window'
  | 'user-guidance';

export type BattleStoryPromptSection = {
  key: BattleStoryPromptSectionKey;
  title: string;
  text: string;
};

export type BattleStoryPromptWindowItem = {
  chapterId: string;
  chapterIndex: number;
  title: string;
  mode: 'full' | 'digest';
  text: string;
  truncated: boolean;
};

export type BattleStoryPromptChapterInput = {
  id: string;
  index: number;
  title?: string;
  markdown: string;
  deterministicDigest?: BattleStoryDeterministicDigest;
};

export type BattleStoryPromptContextInput = {
  source?: Partial<BattleStorySessionSource>;
  seed?: BattleStorySessionSeed | null;
  workingCombatants?: unknown[];
  sessionSummary?: string;
  recentChapters?: BattleStoryPromptChapterInput[];
  userGuidance?: string;
  maxRecentChapters?: number;
  maxFullChapterChars?: number;
  maxUserGuidanceChars?: number;
};

export type BattleStoryPromptContextResult = {
  normalizedUserGuidance: string;
  recentWindow: BattleStoryPromptWindowItem[];
  sections: BattleStoryPromptSection[];
  promptText: string;
};
