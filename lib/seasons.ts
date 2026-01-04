export type SeasonStatus = 'current' | 'history';

export type SeasonMeta = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  status: SeasonStatus;
  description: string;
  archivedAt?: string | null;
};

export type SeasonsConfig = {
  schemaVersion: 1;
  seasons: SeasonMeta[];
};

export type SeasonArchiveLeaderboard = {
  queue: 'strict' | 'free';
  total: number;
  top: SeasonArchiveItem[];
  bottom: SeasonArchiveItem[];
};

export type SeasonArchiveItem = {
  rank: number;
  entityType: 'data_card' | 'preset';
  entityId: string;
  displayName: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  tier: string;
  techScore: number | null;
  techLevel: string | null;
  isNative: boolean | null;
  tagIds: string[];
};

export type SeasonArchive = {
  schemaVersion: 1;
  generatedAt: string;
  season: Pick<SeasonMeta, 'id' | 'name' | 'startsAt' | 'endsAt' | 'description'>;
  leaderboards: {
    strict: SeasonArchiveLeaderboard;
    free: SeasonArchiveLeaderboard;
  };
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
