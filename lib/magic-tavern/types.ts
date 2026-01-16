export type MagicTavernCardSource = 'local' | 'cloud' | 'public' | 'tavern' | 'random' | 'preset';

export type MagicTavernRoleTemplate = 'magical-girl' | 'canshou' | 'general';

export type MagicTavernRole = {
  id: string;
  name: string;
  template?: MagicTavernRoleTemplate;
  templateId?: string;
  dataCardId?: string;
  source: MagicTavernCardSource;
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

export type MagicTavernScenario = {
  id: string;
  title: string;
  presetId?: string;
  templateId?: string;
  dataCardId?: string;
  source: MagicTavernCardSource;
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

export type MagicTavernOutputSegment =
  | { type: 'narration'; text: string }
  | { type: 'dialogue'; speakerId: string; speakerName?: string; text: string }
  | { type: 'choices'; items: { id: string; text: string }[] };

export type MagicTavernMessage = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  segments?: MagicTavernOutputSegment[];
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

export type MagicTavernTachieAsset = {
  id: string;
  sessionId: string;
  kind?: 'tachie' | 'illustration';
  roleId?: string;
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
};

export type MagicTavernSession = {
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
  roles: MagicTavernRole[];
  scenario?: MagicTavernScenario;
  auxScenarios?: MagicTavernScenario[];
  playerRoleId?: string | null;
  summary?: string;
  summaryMeta?: {
    updatedAt: number;
    fromMessageId?: string;
    toMessageId?: string;
    tokenCount?: number;
  };
  forkedFrom?: { sessionId: string; messageId: string; createdAt: number };
  branchLabel?: string;
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
    language?: 'zh-CN' | 'ja-JP' | 'en-US';
    userDisplayName?: string;
    enableSummary?: boolean;
    presetId?: string;
    worldbookPresetId?: string;
  };
};

export type MagicTavernPreferences = {
  outputFormat: 'jsonl' | 'markdown';
  enableChoices: boolean;
  choiceCount: 2 | 3 | 4;
  language: 'zh-CN' | 'ja-JP' | 'en-US';
  userDisplayName: string;
  lastPresetId?: string;
  lastWorldbookPresetId?: string;
};

