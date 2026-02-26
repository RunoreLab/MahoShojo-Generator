import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { loadEnvConfig } from '@next/env';

import {
  countSeasonArchiveEligibleRows,
  listSeasonArchiveLeaderboardRows,
} from '@/lib/database/season-archive';
import type {
  SeasonArchiveEntity,
  SeasonArchiveEntityRef,
  SeasonArchiveQueueSnapshot,
  SeasonArchiveSnapshotPolicy,
  SeasonArchiveV3,
  SeasonsConfig,
  SeasonMeta,
} from '../lib/seasons';
import { formatSeasonTitle, isSafeSeasonId } from '../lib/seasons';

type Queue = 'strict' | 'free';

type LeaderboardRow = {
  entityType: 'data_card' | 'preset';
  entityId: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  ratingUpdatedAt: string | null;
  dataCardName: string | null;
  dataCardDescription: string | null;
  authorName: string | null;
  authorId: number | null;
  usageCount: number | null;
  likeCount: number | null;
  favoriteCount: number | null;
  dataCardCreatedAt: string | null;
  dataCardUpdatedAt: string | null;
  techScore: number | null;
  techLevel: string | null;
  isNative: number | null;
  tagIds: string | null;
};

const hasD1Config = (): boolean => {
  return Boolean(process.env.D1_DATABASE_ID && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
};

const readJson = <T>(path: string): T => {
  const text = readFileSync(path, 'utf-8');
  return JSON.parse(text) as T;
};

const writeJson = (path: string, data: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
};

const parseArgs = (argv: string[]) => {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, rawValue] = token.split('=', 2);
    if (rawValue != null) {
      args.set(key, rawValue);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      i++;
      continue;
    }
    args.set(key, '1');
  }
  return args;
};

const pickSeasonToArchive = (config: SeasonsConfig, seasonIdArg: string | null): SeasonMeta => {
  const seasons = Array.isArray(config.seasons) ? config.seasons : [];
  if (seasonIdArg) {
    const found = seasons.find((s) => s.id === seasonIdArg);
    if (!found) throw new Error(`找不到赛季：${seasonIdArg}`);
    return found;
  }
  const current = seasons.find((s) => s.status === 'current');
  if (!current) throw new Error('未找到当前赛季（status=current），请用 --season-id 指定');
  return current;
};

const listCurrentSeasons = (config: SeasonsConfig): SeasonMeta[] => {
  const seasons = Array.isArray(config.seasons) ? config.seasons : [];
  return seasons.filter((s) => s?.status === 'current');
};

const formatSeasonIdList = (seasons: SeasonMeta[]): string => {
  return seasons
    .map((s) => (typeof s?.id === 'string' ? s.id.trim() : ''))
    .filter(Boolean)
    .join(', ');
};

const buildEntityKey = (ref: SeasonArchiveEntityRef): string => `${ref.entityType}:${ref.entityId}`;

const normalizeTagIds = (raw: string | null): string[] => {
  if (!raw) return [];
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return Array.from(new Set(ids)).sort();
};

const clampString = (value: string | null, maxLength: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength);
};

const ensureEntity = (
  entityByKey: Map<string, SeasonArchiveEntity>,
  payload: {
    ref: SeasonArchiveEntityRef;
    displayName: string;
    description: string | null;
    authorName: string | null;
    authorId: number | null;
    usageCount: number | null;
    likeCount: number | null;
    favoriteCount: number | null;
    createdAt: string | null;
    updatedAt: string | null;
    techScore: number | null;
    techLevel: string | null;
    isNative: boolean | null;
    tagIds: string[];
  },
): SeasonArchiveEntity => {
  const key = buildEntityKey(payload.ref);
  const existing = entityByKey.get(key);
  if (!existing) {
    const entity: SeasonArchiveEntity = {
      entityType: payload.ref.entityType,
      entityId: payload.ref.entityId,
      displayName: payload.displayName,
      techScore: payload.techScore,
      techLevel: payload.techLevel,
      isNative: payload.isNative,
      tagIds: payload.tagIds,
      queues: {},
    };

    if (payload.description) entity.description = payload.description;
    if (payload.authorName) entity.authorName = payload.authorName;
    if (payload.authorId != null) entity.authorId = payload.authorId;
    if (payload.usageCount != null) entity.usageCount = payload.usageCount;
    if (payload.likeCount != null) entity.likeCount = payload.likeCount;
    if (payload.favoriteCount != null) entity.favoriteCount = payload.favoriteCount;
    if (payload.createdAt) entity.createdAt = payload.createdAt;
    if (payload.updatedAt) entity.updatedAt = payload.updatedAt;

    entityByKey.set(key, entity);
    return entity;
  }

  if (!existing.displayName && payload.displayName) existing.displayName = payload.displayName;
  if (!existing.description && payload.description) existing.description = payload.description;
  if (!existing.authorName && payload.authorName) existing.authorName = payload.authorName;
  if (existing.authorId == null && payload.authorId != null) existing.authorId = payload.authorId;
  if (existing.usageCount == null && payload.usageCount != null) existing.usageCount = payload.usageCount;
  if (existing.likeCount == null && payload.likeCount != null) existing.likeCount = payload.likeCount;
  if (existing.favoriteCount == null && payload.favoriteCount != null) existing.favoriteCount = payload.favoriteCount;
  if (!existing.createdAt && payload.createdAt) existing.createdAt = payload.createdAt;
  if (!existing.updatedAt && payload.updatedAt) existing.updatedAt = payload.updatedAt;

  if (existing.techScore == null && payload.techScore != null) existing.techScore = payload.techScore;
  if (existing.techLevel == null && payload.techLevel != null) existing.techLevel = payload.techLevel;
  if (existing.isNative == null && payload.isNative != null) existing.isNative = payload.isNative;

  if (payload.tagIds.length > 0) {
    const next = new Set(existing.tagIds);
    payload.tagIds.forEach((id) => next.add(id));
    existing.tagIds = Array.from(next).sort();
  }

  return existing;
};

const buildQueueSnapshot = (
  row: LeaderboardRow,
): SeasonArchiveQueueSnapshot => {
  const rating = typeof row.rating === 'number' ? row.rating : 0;
  const games = typeof row.games === 'number' ? row.games : 0;

  return {
    rating,
    games,
    wins: typeof row.wins === 'number' ? row.wins : 0,
    losses: typeof row.losses === 'number' ? row.losses : 0,
    draws: typeof row.draws === 'number' ? row.draws : 0,
    ratingUpdatedAt: typeof row.ratingUpdatedAt === 'string' ? row.ratingUpdatedAt : null,
  };
};

const ingestRows = async (
  rows: LeaderboardRow[],
  options: {
    queue: Queue;
    entityByKey: Map<string, SeasonArchiveEntity>;
    presetNameByFilename: Map<string, string>;
  },
): Promise<void> => {
  rows.forEach((row) => {
    const ref: SeasonArchiveEntityRef = {
      entityType: row.entityType === 'preset' ? 'preset' : 'data_card',
      entityId: typeof row.entityId === 'string' ? row.entityId : '',
    };

    const displayName = ref.entityType === 'preset'
      ? (options.presetNameByFilename.get(ref.entityId) ?? ref.entityId)
      : (typeof row.dataCardName === 'string' && row.dataCardName.trim() ? row.dataCardName.trim() : ref.entityId);

    const tagIds = normalizeTagIds(row.tagIds);

    const isNative = row.isNative === 1 ? true : row.isNative === 0 ? false : null;

    const entity = ensureEntity(options.entityByKey, {
      ref,
      displayName: clampString(displayName, 120) ?? ref.entityId,
      description: clampString(ref.entityType === 'data_card' ? row.dataCardDescription : null, 800),
      authorName: clampString(ref.entityType === 'data_card' ? row.authorName : null, 80),
      authorId: ref.entityType === 'data_card' && typeof row.authorId === 'number' && Number.isFinite(row.authorId) ? row.authorId : null,
      usageCount: ref.entityType === 'data_card' && typeof row.usageCount === 'number' && Number.isFinite(row.usageCount) ? row.usageCount : null,
      likeCount: ref.entityType === 'data_card' && typeof row.likeCount === 'number' && Number.isFinite(row.likeCount) ? row.likeCount : null,
      favoriteCount: ref.entityType === 'data_card' && typeof row.favoriteCount === 'number' && Number.isFinite(row.favoriteCount) ? row.favoriteCount : null,
      createdAt: ref.entityType === 'data_card' ? clampString(row.dataCardCreatedAt, 40) : null,
      updatedAt: ref.entityType === 'data_card' ? clampString(row.dataCardUpdatedAt, 40) : null,
      techScore: typeof row.techScore === 'number' && Number.isFinite(row.techScore) ? row.techScore : null,
      techLevel: typeof row.techLevel === 'string' && row.techLevel.trim() ? row.techLevel.trim() : null,
      isNative,
      tagIds,
    });

    const snapshot = buildQueueSnapshot(row);
    entity.queues[options.queue] = snapshot;
  });
};

const archiveQueue = async (
  queue: Queue,
  options: {
    snapshotPolicy: SeasonArchiveSnapshotPolicy;
    entityByKey: Map<string, SeasonArchiveEntity>;
    presetNameByFilename: Map<string, string>;
  },
): Promise<{ totalEligible: number }> => {
  const total = await countSeasonArchiveEligibleRows(queue);

  if (options.snapshotPolicy.mode === 'full') {
    const pageSize = 1_000;
    for (let offset = 0; offset < total; offset += pageSize) {
      const rows = await listSeasonArchiveLeaderboardRows({
        queue,
        sort: 'rating_desc',
        limit: Math.min(pageSize, total - offset),
        offset,
      });
      if (rows.length === 0) break;
      await ingestRows(rows, {
        queue,
        entityByKey: options.entityByKey,
        presetNameByFilename: options.presetNameByFilename,
      });
      if (rows.length < pageSize) break;
    }
    return { totalEligible: total };
  }

  const top = Math.max(0, Math.floor(options.snapshotPolicy.top));
  const bottom = Math.max(0, Math.floor(options.snapshotPolicy.bottom));

  const topRows = top > 0
    ? await listSeasonArchiveLeaderboardRows({
        queue,
        sort: 'rating_desc',
        limit: top,
      })
    : [];

  const bottomRows = bottom > 0
    ? await listSeasonArchiveLeaderboardRows({
        queue,
        sort: 'rating_asc',
        limit: bottom,
      })
    : [];

  await ingestRows(topRows, {
    queue,
    entityByKey: options.entityByKey,
    presetNameByFilename: options.presetNameByFilename,
  });
  await ingestRows(bottomRows, {
    queue,
    entityByKey: options.entityByKey,
    presetNameByFilename: options.presetNameByFilename,
  });

  return { totalEligible: total };
};

const main = async () => {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.has('--help') || args.has('-h')) {
    console.log(`[season-archive]
用法：
  bun tsx scripts/season-archive.ts [--season-id <id>] [--force] [--require-db] [--snapshot-only] [--top <n>] [--bottom <n>] [--full]

说明：
  - 默认归档当前赛季（status=current）
  - 会校验 public/config/seasons.json 中 status=current 必须且仅有 1 个（除非 --force 或 --snapshot-only）
  - 默认会把该赛季在 public/config/seasons.json 中标记为 status=history（可用 --snapshot-only 仅生成快照）
  - 生成 public/data/seasons/archive_<season_id>.json
  - 快照范围：默认 Top 100 + Bottom 50（按排位分）；可用 --top/--bottom 调整；可用 --full 生成全量实体快照
`);
    return;
  }

  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

  const seasonsPath = resolve(process.cwd(), 'public', 'config', 'seasons.json');
  const seasons = readJson<SeasonsConfig>(seasonsPath);
  if (seasons?.schemaVersion !== 1) {
    throw new Error('seasons.json schemaVersion 不受支持（仅支持 1）');
  }

  const seasonIdArg = args.get('--season-id') ?? args.get('--seasonId') ?? null;
  const force = args.has('--force');
  const requireDb = args.has('--require-db') || args.has('--requireDb');
  const snapshotOnly = args.has('--snapshot-only') || args.has('--snapshotOnly') || args.has('--snapshot');
  const full = args.has('--full');

  const currentSeasons = listCurrentSeasons(seasons);
  if (currentSeasons.length !== 1) {
    const hint = currentSeasons.length > 0 ? `（当前标记为 current：${formatSeasonIdList(currentSeasons)}）` : '（当前没有任何 current）';
    const message = `public/config/seasons.json 配置异常：status=current 数量=${currentSeasons.length}，期望为 1。${hint}`;
    if (!force && !snapshotOnly) {
      throw new Error(`${message}\n请先修复 seasons.json 后再归档；或使用 --snapshot-only 仅生成快照；或使用 --force 强制执行。`);
    }
    console.warn(`[season-archive] 警告：${message}`);
  }

  const topArg = args.get('--top');
  const bottomArg = args.get('--bottom');
  const parsedTop = topArg == null ? null : Number(topArg);
  const parsedBottom = bottomArg == null ? null : Number(bottomArg);
  const top = parsedTop != null && Number.isFinite(parsedTop) && parsedTop >= 0 ? Math.floor(parsedTop) : 100;
  const bottom = parsedBottom != null && Number.isFinite(parsedBottom) && parsedBottom >= 0 ? Math.floor(parsedBottom) : 50;

  const snapshotPolicy: SeasonArchiveSnapshotPolicy = full ? { mode: 'full' } : { mode: 'top_bottom', top, bottom };

  const target = pickSeasonToArchive(seasons, seasonIdArg);
  if (!isSafeSeasonId(target.id)) {
    throw new Error(`赛季 ID 不安全（仅允许字母数字/下划线/短横线，且长度 <= 32）：${target.id}`);
  }

  if (!force && !snapshotOnly) {
    if (!target.endsAt) {
      throw new Error(`赛季未设置结束时间 endsAt，无法归档：${formatSeasonTitle(target)}（可用 --force 覆盖）`);
    }
  }

  const generatedAt = new Date().toISOString();

  let archive: SeasonArchiveV3 = {
    schemaVersion: 3,
    generatedAt,
    season: {
      id: target.id,
      name: target.name,
      startsAt: target.startsAt,
      endsAt: target.endsAt,
      description: target.description,
      ...(target.specialRules ? { specialRules: target.specialRules } : {}),
    },
    snapshotPolicy,
    totalEligible: { strict: 0, free: 0 },
    entities: [],
  };

  if (!hasD1Config()) {
    if (requireDb) throw new Error('缺少 D1 配置（CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID）');
    console.warn('[season-archive] 未检测到 D1 配置，将生成空的归档文件（仅用于本地/CI 验证）。');
  } else {
    const { PRESET_LIST } = await import('../lib/presets');
    const presetNameByFilename = new Map(PRESET_LIST.map((preset) => [preset.filename, preset.name]));
    const entityByKey = new Map<string, SeasonArchiveEntity>();
    const strict = await archiveQueue('strict', {
      snapshotPolicy,
      entityByKey,
      presetNameByFilename,
    });
    const free = await archiveQueue('free', {
      snapshotPolicy,
      entityByKey,
      presetNameByFilename,
    });

    const entities = Array.from(entityByKey.values());
    entities.sort((a, b) => {
      if (a.entityType !== b.entityType) return a.entityType.localeCompare(b.entityType);
      return a.entityId.localeCompare(b.entityId);
    });
    archive = {
      ...archive,
      entities,
      totalEligible: {
        strict: strict.totalEligible,
        free: free.totalEligible,
      },
    };
  }

  const archivePath = resolve(process.cwd(), 'public', 'data', 'seasons', `archive_${target.id}.json`);
  writeJson(archivePath, archive);

  console.log(`[season-archive] 写入：${archivePath}`);

  if (snapshotOnly) {
    console.log(`[season-archive] 完成：${formatSeasonTitle(target)} -> 已生成快照（未修改 seasons.json 赛季状态）`);
    return;
  }

  const updatedSeasons: SeasonsConfig = {
    ...seasons,
    seasons: seasons.seasons.map((s) => {
      if (s.id !== target.id) return s;
      return {
        ...s,
        status: 'history',
        archivedAt: generatedAt,
      };
    }),
  };

  writeJson(seasonsPath, updatedSeasons);

  const nextCurrent = listCurrentSeasons(updatedSeasons);
  if (nextCurrent.length !== 1) {
    const hint = nextCurrent.length > 0 ? `（当前标记为 current：${formatSeasonIdList(nextCurrent)}）` : '（归档后没有任何 current）';
    console.warn(`[season-archive] 强提醒：归档完成后 seasons.json 的 status=current 数量=${nextCurrent.length}，期望为 1。${hint}`);
    console.warn('[season-archive] 强提醒：请尽快在 public/config/seasons.json 中创建/切换新赛季（确保仅 1 个 current），并重新部署静态资源。');
  }

  console.log(`[season-archive] 完成：${formatSeasonTitle(target)} -> 已归档（status=history）`);
};

main().catch((error) => {
  console.error('[season-archive] 失败:', error);
  process.exitCode = 1;
});
