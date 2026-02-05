import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { loadEnvConfig } from '@next/env';

import type { SeasonArchive, SeasonArchiveItem, SeasonsConfig, SeasonMeta } from '../lib/seasons';
import { formatSeasonTitle, isSafeSeasonId } from '../lib/seasons';
import { applyQueenTier, computeArenaBaseTier, queryArenaPublicQueenEntity } from '../lib/arena/tier';

type Queue = 'strict' | 'free';

type QueryFromD1 = (sql: string, params?: unknown[]) => Promise<unknown>;

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

const readRows = <T>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
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

const buildLeaderboardBaseSql = (queue: Queue) => {
  const strictPublicSinceClause =
    queue === 'strict'
      ? `AND (
        dc.public_since IS NULL
        OR dc.public_since <= datetime('now', '-3 days')
        OR (
          dc.created_at IS NOT NULL
          AND dc.public_since IS NOT NULL
          AND ABS(strftime('%s', dc.public_since) - strftime('%s', dc.created_at)) <= 600
        )
      )`
      : '';

  const whereSql = `WHERE ar.queue = ?
    AND (
      ar.entity_type = 'preset'
      OR (
        dc.id IS NOT NULL
        AND dc.type = 'character'
        AND dc.is_public = 1
        AND dc.review_status = 'approved'
        AND dc.deleted_at IS NULL
        ${strictPublicSinceClause}
      )
    )`;

  const selectSql = `
    SELECT
      ar.entity_type as entityType,
      ar.entity_id as entityId,
      ar.rating as rating,
      ar.games as games,
      ar.wins as wins,
      ar.losses as losses,
      ar.draws as draws,
      MAX(ar.updated_at) as ratingUpdatedAt,
      MAX(dc.name) as dataCardName,
      MAX(dc.description) as dataCardDescription,
      MAX(dc.user_id) as authorId,
      MAX(u.username) as authorName,
      MAX(dc.usage_count) as usageCount,
      MAX(dc.like_count) as likeCount,
      MAX(dc.favorite_count) as favoriteCount,
      MAX(dc.created_at) as dataCardCreatedAt,
      MAX(dc.updated_at) as dataCardUpdatedAt,
      MAX(dcm.tech_score) as techScore,
      MAX(dcm.tech_level) as techLevel,
      MAX(dcm.is_native) as isNative,
      group_concat(DISTINCT dct.tag_id) as tagIds
    FROM arena_ratings ar
    LEFT JOIN data_cards dc
      ON ar.entity_type = 'data_card' AND dc.id = ar.entity_id
    LEFT JOIN users u
      ON dc.user_id = u.id
    LEFT JOIN data_card_metrics dcm
      ON ar.entity_type = 'data_card' AND dcm.data_card_id = ar.entity_id
    LEFT JOIN data_card_tags dct
      ON ar.entity_type = 'data_card' AND dct.data_card_id = ar.entity_id
    ${whereSql}
    GROUP BY ar.entity_type, ar.entity_id, ar.queue
  `;

  const countSql = `
    SELECT COUNT(*) as count
    FROM (
      SELECT ar.entity_type, ar.entity_id
      FROM arena_ratings ar
      LEFT JOIN data_cards dc
        ON ar.entity_type = 'data_card' AND dc.id = ar.entity_id
      ${whereSql}
      GROUP BY ar.entity_type, ar.entity_id, ar.queue
    ) t;
  `;

  return { whereSql, selectSql, countSql };
};

const queryLeaderboardCount = async (queryFromD1: QueryFromD1, queue: Queue): Promise<number> => {
  const { countSql } = buildLeaderboardBaseSql(queue);
  const result = await queryFromD1(countSql, [queue]);
  const row = readRows<{ count: number }>(result)[0];
  return typeof row?.count === 'number' && Number.isFinite(row.count) ? Math.max(0, Math.floor(row.count)) : 0;
};

const queryLeaderboardRows = async (
  queryFromD1: QueryFromD1,
  queue: Queue,
  orderBy: string,
  limit: number,
): Promise<LeaderboardRow[]> => {
  const { selectSql } = buildLeaderboardBaseSql(queue);
  const sql = `${selectSql}\n${orderBy}\nLIMIT ?;`;
  const result = await queryFromD1(sql, [queue, limit]);
  return readRows<LeaderboardRow>(result);
};

const buildItems = async (
  rows: LeaderboardRow[],
  options: { rankBase: number; queen: Awaited<ReturnType<typeof queryArenaPublicQueenEntity>> | null },
): Promise<SeasonArchiveItem[]> => {
  const { PRESET_LIST } = await import('../lib/presets');
  const presetNameByFilename = new Map(PRESET_LIST.map((preset) => [preset.filename, preset.name]));

  return rows.map((row, index) => {
    const rating = typeof row.rating === 'number' ? row.rating : 0;
    const games = typeof row.games === 'number' ? row.games : 0;
    const baseTier = computeArenaBaseTier(rating, games);
    const isQueen = options.queen?.entityType === row.entityType && options.queen?.entityId === row.entityId;
    const tier = applyQueenTier(baseTier, isQueen);

    const displayName = row.entityType === 'preset'
      ? (presetNameByFilename.get(row.entityId) ?? row.entityId)
      : (row.dataCardName ?? row.entityId);

    const tagIds = row.tagIds
      ? row.tagIds.split(',').map((id) => id.trim()).filter(Boolean)
      : [];

    return {
      rank: options.rankBase + index,
      entityType: row.entityType,
      entityId: row.entityId,
      displayName,
      authorName:
        row.entityType === 'data_card' && typeof row.authorName === 'string' && row.authorName.trim()
          ? row.authorName.trim()
          : null,
      authorId: row.entityType === 'data_card' && typeof row.authorId === 'number' && Number.isFinite(row.authorId) ? row.authorId : null,
      likeCount: row.entityType === 'data_card' && typeof row.likeCount === 'number' && Number.isFinite(row.likeCount) ? row.likeCount : null,
      favoriteCount:
        row.entityType === 'data_card' && typeof row.favoriteCount === 'number' && Number.isFinite(row.favoriteCount) ? row.favoriteCount : null,
      usageCount: row.entityType === 'data_card' && typeof row.usageCount === 'number' && Number.isFinite(row.usageCount) ? row.usageCount : null,
      createdAt: row.entityType === 'data_card' && typeof row.dataCardCreatedAt === 'string' ? row.dataCardCreatedAt : null,
      updatedAt: row.entityType === 'data_card' && typeof row.dataCardUpdatedAt === 'string' ? row.dataCardUpdatedAt : null,
      ratingUpdatedAt: typeof row.ratingUpdatedAt === 'string' ? row.ratingUpdatedAt : null,
      description:
        row.entityType === 'data_card' && typeof row.dataCardDescription === 'string' ? row.dataCardDescription : null,
      rating,
      games,
      wins: typeof row.wins === 'number' ? row.wins : 0,
      losses: typeof row.losses === 'number' ? row.losses : 0,
      draws: typeof row.draws === 'number' ? row.draws : 0,
      tier,
      techScore: typeof row.techScore === 'number' ? row.techScore : null,
      techLevel: typeof row.techLevel === 'string' ? row.techLevel : null,
      isNative: row.isNative === 1 ? true : row.isNative === 0 ? false : null,
      tagIds,
    };
  });
};

const archiveQueue = async (queryFromD1: QueryFromD1, queue: Queue) => {
  const total = await queryLeaderboardCount(queryFromD1, queue);
  const queen = await queryArenaPublicQueenEntity(queryFromD1, queue).catch((error) => {
    console.warn('[season-archive] 读取女王段位失败（降级为无女王）:', error);
    return null;
  });
  const topRows = await queryLeaderboardRows(
    queryFromD1,
    queue,
    'ORDER BY ar.rating DESC, ar.games DESC, ar.updated_at DESC, ar.entity_type ASC, ar.entity_id ASC',
    100,
  );
  const bottomRowsRaw = await queryLeaderboardRows(
    queryFromD1,
    queue,
    'ORDER BY ar.rating ASC, ar.games DESC, ar.updated_at DESC, ar.entity_type ASC, ar.entity_id ASC',
    50,
  );
  const bottomRows = bottomRowsRaw.slice().reverse();

  const top = await buildItems(topRows, { rankBase: 1, queen });
  const bottomRankBase = Math.max(1, total - bottomRows.length + 1);
  const bottom = await buildItems(bottomRows, { rankBase: bottomRankBase, queen });

  return { total, top, bottom };
};

const main = async () => {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.has('--help') || args.has('-h')) {
    console.log(`[season-archive]
用法：
  bun tsx scripts/season-archive.ts [--season-id <id>] [--force] [--require-db] [--snapshot-only]

说明：
  - 默认归档当前赛季（status=current）
  - 默认会把该赛季在 public/config/seasons.json 中标记为 status=history（可用 --snapshot-only 仅生成快照）
  - 生成 public/data/seasons/archive_<season_id>.json
  - 快照范围：Top 100 + Bottom 50（按排位分）
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

  let archive: SeasonArchive = {
    schemaVersion: 1,
    generatedAt,
    season: {
      id: target.id,
      name: target.name,
      startsAt: target.startsAt,
      endsAt: target.endsAt,
      description: target.description,
      ...(target.specialRules ? { specialRules: target.specialRules } : {}),
    },
    leaderboards: {
      strict: { queue: 'strict', total: 0, top: [], bottom: [] },
      free: { queue: 'free', total: 0, top: [], bottom: [] },
    },
  };

  if (!hasD1Config()) {
    if (requireDb) throw new Error('缺少 D1 配置（CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID）');
    console.warn('[season-archive] 未检测到 D1 配置，将生成空的归档文件（仅用于本地/CI 验证）。');
  } else {
    const { queryFromD1 } = await import('../lib/d1');
    const strict = await archiveQueue(queryFromD1, 'strict');
    const free = await archiveQueue(queryFromD1, 'free');
    archive = {
      ...archive,
      leaderboards: {
        strict: { queue: 'strict', total: strict.total, top: strict.top, bottom: strict.bottom },
        free: { queue: 'free', total: free.total, top: free.top, bottom: free.bottom },
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

  console.log(`[season-archive] 完成：${formatSeasonTitle(target)} -> 已归档（status=history）`);
};

main().catch((error) => {
  console.error('[season-archive] 失败:', error);
  process.exitCode = 1;
});
