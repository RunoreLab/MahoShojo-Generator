export type MagicTeaPartyCardSource = 'local' | 'cloud' | 'public' | 'tavern' | 'random' | 'preset';

export type MagicTeaPartyRoleTemplate = 'magical-girl' | 'canshou' | 'general';

export type MagicTeaPartyRole = {
  id: string;
  name: string;
  template?: MagicTeaPartyRoleTemplate;
  templateId?: string;
  dataCardId?: string;
  source: MagicTeaPartyCardSource;
  isNative?: boolean;
  signature?: string;
  card: Record<string, unknown>;
  notes?: string;
  asPlayer?: boolean;
  avatarUrl?: string;
  origin?: {
    fileName?: string;
    importedAt?: number;
    url?: string;
  };
};

export type MagicTeaPartyScenario = {
  id: string;
  title: string;
  presetId?: string;
  templateId?: string;
  dataCardId?: string;
  source: MagicTeaPartyCardSource;
  isNative?: boolean;
  signature?: string;
  card: Record<string, unknown>;
  notes?: string;
  origin?: {
    fileName?: string;
    importedAt?: number;
    url?: string;
  };
};

export type MagicTeaPartyOutputSegment =
  | { type: 'narration'; text: string }
  | { type: 'dialogue'; speakerId: string; speakerName?: string; text: string }
  | { type: 'choices'; items: { id: string; text: string }[] };

export type MagicTeaPartyOutputPlanMode = 'off' | 'auto' | 'on';

export type MagicTeaPartyOutputPlan = {
  choices: MagicTeaPartyOutputPlanMode;
  summary: MagicTeaPartyOutputPlanMode;
  updates: MagicTeaPartyOutputPlanMode;
};

export type MagicTeaPartyOutputSummary = {
  text: string;
  sections?: Record<string, string>;
};

export type MagicTeaPartyNotice = {
  type: 'notice';
  level: 'info' | 'warning' | 'error';
  code?: string;
  message: string;
  meta?: Record<string, unknown>;
};

export type MagicTeaPartyMessage = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  segments?: MagicTeaPartyOutputSegment[];
  status?: 'streaming' | 'done' | 'error' | 'blocked';
  createdAt: number;
  speakerId?: string;
  choices?: { id: string; text: string }[];
  tachieId?: string;
  sourceMessageId?: string;
  revisionOf?: string;
  safety?: {
    status: 'ok' | 'blocked' | 'masked' | 'truncated';
    blockedBy?: 'input' | 'output' | 'server';
    blockedAt?: number;
    action?: 'redirect' | 'soft-block';
  };
  truncatedAt?: number;
  error?: { code: string; message: string };
  meta?: Record<string, unknown>;
};

export type MagicTeaPartyHistoryMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type MagicTeaPartyTachieAsset = {
  id: string;
  sessionId: string;
  kind?: 'tachie' | 'illustration';
  roleId?: string;
  anchorMessageId?: string;
  cacheKey: string;
  fragmentHash: string;
  styleId: string;
  providerId?: string;
  modelId?: string;
  width?: number;
  height?: number;
  prompt?: string;
  imageUrl?: string;
  seed?: number;
  auditStatus?: number;
  generateUuid?: string;
  createdAt: number;
  lastUsedAt: number;
  expireAt?: number;
  blobRef?: string;
  blobSize?: number;
};

export type MagicTeaPartySession = {
  id: string;
  title: string;
  titleMeta?: {
    source: 'auto' | 'manual';
    generatedAt?: number;
    providerId?: string;
    modelId?: string;
    reason?: 'first-message' | 'manual-edit' | 'import';
  };
  createdAt: number;
  updatedAt: number;
  pinnedAt?: number;
  pinnedOrder?: number;
  roles: MagicTeaPartyRole[];
  scenario?: MagicTeaPartyScenario;
  auxScenarios?: MagicTeaPartyScenario[];
  playerRoleId?: string | null;
  summary?: string;
  summarySections?: Record<string, string>;
  summaryMeta?: {
    updatedAt: number;
    fromMessageId?: string;
    toMessageId?: string;
    tokenCount?: number;
  };
  forkedFrom?: { sessionId: string; messageId: string; createdAt: number };
  branchLabel?: string;
  protocolShadow?: {
    updatedAt: number;
    messageRange?: { fromMessageId: string; toMessageId: string; count: number };
    drafts: MagicTeaPartyUpdateDraft[];
    source?: 'stream' | 'manual';
  };
  updateSnapshot?: MagicTeaPartyUpdateSnapshot;
  lastChoices?: { id: string; text: string }[];
  draft?: string;
  settings: {
    providerId: string;
    modelId: string;
    temperature?: number;
    maxContextMessages?: number;
    contextWindowTokens?: number;
    responseReserveTokens?: number;
    summaryTriggerRatio?: number;
    summaryMaxTokens?: number;
    summaryMinGapMessages?: number;
    enableChoices?: boolean;
    choiceCount?: number;
    outputFormat?: 'jsonl' | 'markdown';
    outputPlan?: MagicTeaPartyOutputPlan;
    updateApplyMode?: 'auto' | 'confirm' | 'draft';
    language?: 'zh-CN' | 'ja-JP' | 'en-US';
    userDisplayName?: string;
    enableSummary?: boolean;
    presetId?: string;
    worldbookPresetId?: string;
    readArenaHistory?: boolean;
    readArenaHistoryLimit?: number;
    isArenaHistoryUnlimited?: boolean;
    readCurrentState?: boolean;
    writeArenaHistory?: boolean;
    writeCurrentState?: boolean;
  };
};

export type MagicTeaPartyChoiceCount =
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16;

export type MagicTeaPartyPreferences = {
  outputFormat: 'jsonl' | 'markdown';
  outputPlan: MagicTeaPartyOutputPlan;
  enableChoices: boolean;
  choiceCount: MagicTeaPartyChoiceCount;
  language: 'zh-CN' | 'ja-JP' | 'en-US';
  userDisplayName: string;
  lastPresetId?: string;
  lastWorldbookPresetId?: string;
  enableSummary: boolean;
  updateApplyMode: 'auto' | 'confirm' | 'draft';
  readArenaHistory: boolean;
  readArenaHistoryLimit: number;
  isArenaHistoryUnlimited: boolean;
  readCurrentState: boolean;
  writeArenaHistory: boolean;
  writeCurrentState: boolean;
  tachieCacheMaxPerSession: number;
  tachieCacheMaxGlobal: number;
  tachieCacheMaxBytes: number;
  presetCharacterPanelCollapsed: boolean;
  presetScenarioPanelCollapsed: boolean;
  sessionRetentionDays: number;
  maxSessions: number;
};

export type MagicTeaPartyUpdateDraft = {
  roleId?: string;
  characterName: string;
  impact?: string;
  currentStateSummary?: string;
  hasWinner?: boolean;
  winner?: string;
  meta?: {
    sessionId?: string;
    summaryId?: string;
    messageRange?: { fromMessageId: string; toMessageId: string; count: number };
    generatedAt?: number;
  };
};

export type MagicTeaPartyUpdateSnapshot = {
  id: string;
  createdAt: number;
  mode: 'auto' | 'confirm';
  messageRange?: { fromMessageId: string; toMessageId: string; count: number };
  drafts: MagicTeaPartyUpdateDraft[];
  rolesBefore: MagicTeaPartyRole[];
  rolesAfter: MagicTeaPartyRole[];
  revertedAt?: number;
};
