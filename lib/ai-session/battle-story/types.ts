import type { NormalizedStreamUpdateMeta } from '@/lib/arena/stream-meta';
import type { AiSessionListOptions, AiSessionProviderMode } from '@/lib/ai-session/types';
import type { AIReasoningEnvelope } from '@/types/ai-reasoning';
import type { AdjudicationResult } from '@/types/arena';

export type BattleStorySourceMode = 'classic' | 'kizuna' | 'daily' | 'scenario';
export type BattleStoryLengthOption = 'default' | 'short' | 'standard' | 'detailed' | 'long';
export type BattleStoryGenerationMode = 'stream';
export type BattleStorySessionAction = 'start' | 'continue' | 'branch' | 'rewrite';
export type BattleStoryChapterStatus = 'active' | 'superseded';
export type BattleStoryChapterPlanSource = 'user' | 'scenario';

export type BattleStorySessionSettings = {
  readArenaHistory: boolean;
  readArenaHistoryLimit?: number;
  isArenaHistoryUnlimited?: boolean;
  writeArenaHistory: boolean;
  readCurrentState: boolean;
  writeCurrentState: boolean;
  readNarrativeHistory: boolean;
  readNarrativeHistoryLimit?: number;
  isNarrativeHistoryUnlimited?: boolean;
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

export type BattleStoryChapterPlan = {
  totalChapters: number;
  source: BattleStoryChapterPlanSource;
  locked: boolean;
};

export type BattleStoryChapterPlanLimit = Pick<BattleStoryChapterPlan, 'totalChapters'>;

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
  chapterPlan?: BattleStoryChapterPlan;
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

export type BattleStoryReporterInfo = {
  name: string;
  publication: string;
};

export type BattleStoryCharacterGuidance = {
  characterName: string;
  guidance: string;
};

export type BattleStoryAiUsage = {
  promptTokens?: number | null;
  reasoningTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  cachedTokens?: number | null;
  [key: string]: unknown;
};

export type BattleStoryStreamUpdateMetaDebug = {
  source: 'sse' | 'inline';
  parseOk: boolean;
  error?: string | null;
  raw?: string | null;
  rawTruncated?: boolean;
  meta?: NormalizedStreamUpdateMeta | null;
};

export type BattleStoryChapterCardSnapshot = {
  reporterInfo?: BattleStoryReporterInfo | null;
  userGuidance?: string | null;
  characterGuidances?: BattleStoryCharacterGuidance[] | null;
  adjudicationResults?: AdjudicationResult[] | null;
  aiUsage?: BattleStoryAiUsage | null;
  aiModel?: string | null;
  narrativeHistoryReadCount?: number | null;
  aiReasoning?: AIReasoningEnvelope | null;
  streamUpdateMetaDebug?: BattleStoryStreamUpdateMetaDebug | null;
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
  cardSnapshot?: BattleStoryChapterCardSnapshot;
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
  | 'chapter-plan'
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
  chapterPlan?: BattleStoryChapterPlan | BattleStoryChapterPlanLimit | null;
  chapterIndex?: number;
  workingCombatants?: unknown[];
  sessionSummary?: string;
  recentChapters?: BattleStoryPromptChapterInput[];
  userGuidance?: string;
  maxRecentChapters?: number;
  maxFullChapterChars?: number;
  maxUserGuidanceChars?: number;
};

export type BattleStoryPromptContextResult = {
  chapterPlanState?: BattleStoryPromptChapterPlanState | null;
  normalizedUserGuidance: string;
  recentWindow: BattleStoryPromptWindowItem[];
  sections: BattleStoryPromptSection[];
  promptText: string;
};

export type BattleStoryPromptChapterPlanState = {
  totalChapters: number;
  currentChapterIndex: number;
  isFinalChapter: boolean;
  remainingChaptersIncludingCurrent: number;
  remainingChaptersAfterCurrent: number;
  positionLabel: string;
};
