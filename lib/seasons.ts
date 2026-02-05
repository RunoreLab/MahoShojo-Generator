import { normalizeScenarioPresetFilename } from '@/lib/scenario-presets';

export type SeasonStatus = 'current' | 'history';

export type SeasonBattleMode = 'classic' | 'kizuna' | 'daily' | 'scenario';

export type SeasonSpecialRules = {
  /**
   * 指定赛季排位要求使用的模式。
   * - 未填写：默认仍按严格排位的经典模式规则处理。
   */
  mode?: SeasonBattleMode;
  /**
   * 指定赛季排位要求使用的故事引导（会与严格排位计分校验联动）。
   * - 空字符串/未填写：表示不要求，严格排位默认要求“无故事引导”。
   */
  storyGuidance?: string;
  /**
   * 指定赛季排位要求使用的预设情景文件名（仅在 mode='scenario' 下生效）。
   * 支持省略 .json 扩展名（会自动补齐并校验存在性）。
   */
  scenarioPresetFilename?: string;
};

export type SeasonStrictRules = {
  mode: SeasonBattleMode;
  storyGuidance: string;
  scenarioPresetFilename: string | null;
};

export type SeasonMeta = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  status: SeasonStatus;
  description: string;
  specialRules?: SeasonSpecialRules | null;
  archivedAt?: string | null;
};

export type SeasonsConfig = {
  schemaVersion: 1;
  seasons: SeasonMeta[];
};

export type SeasonArchiveEntityRef = {
  entityType: 'data_card' | 'preset';
  entityId: string;
};

export type SeasonArchiveQueueSnapshot = {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  ratingUpdatedAt: string | null;
  /**
   * v2 历史归档曾在队列快照里写入 `rank/tier`（用于直接渲染 Top/Bottom）。
   * v3 起不再把“榜单视图”当作归档必需数据，这两个字段会在前端按当前口径计算。
   */
  rank?: number;
  tier?: string;
};

export type SeasonArchiveEntity = {
  entityType: 'data_card' | 'preset';
  entityId: string;
  displayName: string;
  authorName?: string | null;
  authorId?: number | null;
  likeCount?: number | null;
  favoriteCount?: number | null;
  usageCount?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  description?: string | null;
  techScore: number | null;
  techLevel: string | null;
  isNative: boolean | null;
  tagIds: string[];
  queues: {
    strict?: SeasonArchiveQueueSnapshot | null;
    free?: SeasonArchiveQueueSnapshot | null;
  };
};

export type SeasonArchiveLeaderboard = {
  queue: 'strict' | 'free';
  total: number;
  top: SeasonArchiveEntityRef[];
  bottom: SeasonArchiveEntityRef[];
};

export type SeasonArchiveSnapshotPolicy =
  | {
      mode: 'top_bottom';
      top: number;
      bottom: number;
    }
  | {
      mode: 'full';
    };

export type SeasonArchiveV2 = {
  schemaVersion: 2;
  generatedAt: string;
  season: Pick<SeasonMeta, 'id' | 'name' | 'startsAt' | 'endsAt' | 'description' | 'specialRules'>;
  entities: SeasonArchiveEntity[];
  leaderboards: {
    strict: SeasonArchiveLeaderboard;
    free: SeasonArchiveLeaderboard;
  };
};

export type SeasonArchiveV3 = {
  schemaVersion: 3;
  generatedAt: string;
  season: Pick<SeasonMeta, 'id' | 'name' | 'startsAt' | 'endsAt' | 'description' | 'specialRules'>;
  /**
   * 赛季结算快照策略（用于解释“为什么历史榜单不是全量”）。
   */
  snapshotPolicy: SeasonArchiveSnapshotPolicy;
  /**
   * 全榜可上榜实体总数（按 strict/free 分别统计），用于 UI 文案解释与比例感知。
   */
  totalEligible: {
    strict: number;
    free: number;
  };
  /**
   * 实体快照（facts）：仅保存角色事实数据；榜单视图在前端按当前口径计算。
   */
  entities: SeasonArchiveEntity[];
};

export type SeasonArchive = SeasonArchiveV2 | SeasonArchiveV3;

const normalizeSeasonBattleMode = (value: unknown): SeasonBattleMode | null => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  if (raw === 'classic' || raw === 'kizuna' || raw === 'daily' || raw === 'scenario') return raw;
  return null;
};

const normalizeSeasonStoryGuidance = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 200);
};

const normalizeSeasonScenarioPresetFilename = (mode: SeasonBattleMode, value: unknown): string | null => {
  if (mode !== 'scenario') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return normalizeScenarioPresetFilename(trimmed);
  } catch {
    return null;
  }
};

export const deriveSeasonStrictRules = (season: SeasonMeta | null | undefined): SeasonStrictRules => {
  const special = season?.specialRules && typeof season.specialRules === 'object' ? season.specialRules : null;
  const mode = normalizeSeasonBattleMode(special?.mode) ?? 'classic';
  const storyGuidance = normalizeSeasonStoryGuidance(special?.storyGuidance);
  const scenarioPresetFilename = normalizeSeasonScenarioPresetFilename(mode, special?.scenarioPresetFilename);
  return { mode, storyGuidance, scenarioPresetFilename };
};

export const isSafeSeasonId = (value: string): boolean => {
  if (typeof value !== 'string') return false;
  const id = value.trim();
  if (!id) return false;
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(id);
};

export const getCurrentSeason = (config: SeasonsConfig | null | undefined): SeasonMeta | null => {
  const seasons = config?.seasons;
  if (!Array.isArray(seasons)) return null;
  return seasons.find((s) => s.status === 'current') ?? null;
};

export const formatSeasonTitle = (season: Pick<SeasonMeta, 'id' | 'name'>): string => {
  const name = typeof season.name === 'string' ? season.name.trim() : '';
  const id = typeof season.id === 'string' ? season.id.trim() : '';
  if (!name) return id;
  if (!id) return name;
  if (name.includes(id)) return name;
  return `${name}（${id}）`;
};

export const formatYmdSlash = (ymd: string): string => {
  const trimmed = typeof ymd === 'string' ? ymd.trim() : '';
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed.replace(/-/g, '/');
  return trimmed;
};

export const seasonArchiveUrl = (seasonId: string): string => {
  return `/data/seasons/archive_${encodeURIComponent(seasonId)}.json`;
};
