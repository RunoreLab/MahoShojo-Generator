#!/usr/bin/env -S pnpm exec tsx

/**
 * S3 赛季结算徽章：从本地 D1 SQL 备份计算候选，再按需写入线上 D1。
 *
 * 用法：
 *   pnpm exec tsx scripts/badge/grant-season-s3-badges.ts --backup <path>
 *   pnpm exec tsx scripts/badge/grant-season-s3-badges.ts --analysis-db <sqlite-path>
 *   pnpm exec tsx scripts/badge/grant-season-s3-badges.ts --backup <path> --apply
 *
 * 规则：
 * - S3花牌：任意角色严格排位达到「花牌」及以上；
 * - S3女王：任意角色本赛季最高显示段位曾达到「女王」；
 * - S3历战：任意角色严格或自由排位对局数超过 100 场。
 *
 * 不传 --apply 时只读取本地备份并查询线上用户/已有徽章，不执行线上写入。
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import Database from 'better-sqlite3';
import { loadEnvConfig } from '@next/env';

import { computeArenaBaseTier, getArenaTierRank, type ArenaTier } from '@/lib/arena/tier';
import { queryFromD1 } from '@/lib/database/core';

const SEASON_ID = 'S3';
const SEASON_NAME = '八角笼赛季';

type BadgeDefinition = {
  id: string;
  name: string;
  description: string;
  icon: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string;
  rarity: number;
  sortOrder: number;
};

type BackupDataCard = {
  id: string;
  userId: number;
  type: string;
  name: string;
  deletedAt: string | null;
};

type BackupArenaRating = {
  entityType: string;
  entityId: string;
  queue: string;
  rating: number;
  games: number;
  seasonPeakTier: string | null;
};

type BackupSnapshot = {
  users: Map<number, string>;
  dataCards: Map<string, BackupDataCard>;
  ratings: BackupArenaRating[];
  parsed: {
    users: number;
    dataCards: number;
    arenaRatings: number;
  };
};

type CandidateSummary = {
  hana: number[];
  queen: number[];
  veteran: number[];
};

const BADGE_DEFINITIONS: BadgeDefinition[] = [
  {
    id: 'season_s3_hana',
    name: 'S3花牌',
    description: `在${SEASON_NAME}（${SEASON_ID}）中，任意角色严格排位达到「花牌」及以上段位。`,
    icon: '{"type":"lucide","name":"Flower2"}',
    textColor: '{"type":"solid","value":"#FFFFFF"}',
    backgroundColor: '{"type":"gradient","value":"linear-gradient(135deg, #ec4899, #a855f7)"}',
    borderColor: '{"type":"solid","value":"#a855f7"}',
    rarity: 72,
    sortOrder: 31,
  },
  {
    id: 'season_s3_queen',
    name: 'S3女王',
    description: `在${SEASON_NAME}（${SEASON_ID}）中，任意角色严格排位曾达到过「女王」段位。`,
    icon: '{"type":"lucide","name":"Crown"}',
    textColor: '{"type":"solid","value":"#FFFFFF"}',
    backgroundColor: '{"type":"gradient","value":"linear-gradient(135deg, #facc15, #eab308, #ca8a04)"}',
    borderColor: '{"type":"solid","value":"#ca8a04"}',
    rarity: 95,
    sortOrder: 32,
  },
  {
    id: 'season_s3_veteran',
    name: 'S3历战',
    description: `在${SEASON_NAME}（${SEASON_ID}）中，任意角色排位对局数超过 100 场。`,
    icon: '{"type":"lucide","name":"Swords"}',
    textColor: '{"type":"solid","value":"#111827"}',
    backgroundColor: '{"type":"gradient","value":"linear-gradient(135deg, #fbbf24, #f97316)"}',
    borderColor: '{"type":"solid","value":"#f97316"}',
    rarity: 60,
    sortOrder: 30,
  },
];

const BADGE_IDS = BADGE_DEFINITIONS.map((badge) => badge.id);

const parseArgs = (argv: string[]): Map<string, string> => {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) continue;
    const [key, inlineValue] = token.split('=', 2);
    if (inlineValue != null) {
      args.set(key, inlineValue);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args.set(key, next);
      index += 1;
      continue;
    }
    args.set(key, '1');
  }
  return args;
};

const readRows = <T,>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const readChanges = (result: unknown): number => {
  const changes = (result as any)?.result?.[0]?.meta?.changes;
  return typeof changes === 'number' && Number.isFinite(changes) ? Math.max(0, Math.floor(changes)) : 0;
};

const toInt = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
};

const toNullableString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const parseSqlLiteral = (raw: string): unknown => {
  const value = raw.trim();
  if (value.toUpperCase() === 'NULL') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
};

const parseSqlValues = (raw: string): unknown[] => {
  const values: unknown[] = [];
  let current = '';
  let inString = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (char === "'") {
        if (raw[index + 1] === "'") {
          current += "'";
          index += 1;
        } else {
          inString = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      continue;
    }
    if (char === ',') {
      values.push(parseSqlLiteral(current));
      current = '';
      continue;
    }
    current += char;
  }

  values.push(parseSqlLiteral(current));
  return values;
};

const parseInsertLine = (line: string): { table: string; row: Map<string, unknown> } | null => {
  const match = line.match(/^INSERT INTO "([^"]+)" \(([^)]*)\) VALUES\((.*)\);$/);
  if (!match) return null;

  const columns = match[2].split(',').map((column) => column.trim().replace(/^"|"$/g, ''));
  const values = parseSqlValues(match[3]);
  const row = new Map<string, unknown>();
  columns.forEach((column, index) => row.set(column, values[index]));
  return { table: match[1], row };
};

const loadBackupSnapshot = async (backupPaths: string[]): Promise<BackupSnapshot> => {
  const users = new Map<number, string>();
  const dataCards = new Map<string, BackupDataCard>();
  const ratings: BackupArenaRating[] = [];
  const parsed = { users: 0, dataCards: 0, arenaRatings: 0 };
  for (const backupPath of backupPaths) {
    const input = createReadStream(backupPath, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
    const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.startsWith('INSERT INTO "users"') && !line.startsWith('INSERT INTO "data_cards"') && !line.startsWith('INSERT INTO "arena_ratings"')) {
      continue;
    }

    const insert = parseInsertLine(line);
    if (!insert) continue;

    if (insert.table === 'users') {
      const id = toInt(insert.row.get('id'));
      if (id > 0) users.set(id, String(insert.row.get('username') ?? ''));
      parsed.users += 1;
      continue;
    }

    if (insert.table === 'data_cards') {
      const id = String(insert.row.get('id') ?? '');
      if (id) {
        dataCards.set(id, {
          id,
          userId: toInt(insert.row.get('user_id')),
          type: String(insert.row.get('type') ?? ''),
          name: String(insert.row.get('name') ?? ''),
          deletedAt: toNullableString(insert.row.get('deleted_at')),
        });
      }
      parsed.dataCards += 1;
      continue;
    }

    ratings.push({
      entityType: String(insert.row.get('entity_type') ?? ''),
      entityId: String(insert.row.get('entity_id') ?? ''),
      queue: String(insert.row.get('queue') ?? ''),
      rating: toInt(insert.row.get('rating')),
      games: Math.max(0, toInt(insert.row.get('games'))),
      seasonPeakTier: toNullableString(insert.row.get('season_peak_tier')),
    });
      parsed.arenaRatings += 1;
    }
  }

  return { users, dataCards, ratings, parsed };
};

const loadAnalysisSnapshot = (analysisDbPath: string): BackupSnapshot => {
  type UserRow = { id: number; username: string | null };
  type DataCardRow = { id: string; user_id: number; type: string; name: string; deleted_at: string | null };
  type RatingRow = {
    entity_type: string;
    entity_id: string;
    queue: string;
    rating: number;
    games: number;
    season_peak_tier: string | null;
  };

  const db = new Database(analysisDbPath, { readonly: true, fileMustExist: true });
  try {
    const userRows = db.prepare('SELECT id, username FROM users').all() as UserRow[];
    const dataCardRows = db
      .prepare('SELECT id, user_id, type, name, deleted_at FROM data_cards')
      .all() as DataCardRow[];
    const ratingRows = db
      .prepare(
        `SELECT entity_type, entity_id, queue, rating, games, season_peak_tier
         FROM arena_ratings`,
      )
      .all() as RatingRow[];

    return {
      users: new Map(userRows.map((row) => [toInt(row.id), String(row.username ?? '')])),
      dataCards: new Map(
        dataCardRows.map((row) => [
          row.id,
          {
            id: row.id,
            userId: toInt(row.user_id),
            type: String(row.type ?? ''),
            name: String(row.name ?? ''),
            deletedAt: toNullableString(row.deleted_at),
          },
        ]),
      ),
      ratings: ratingRows.map((row) => ({
        entityType: String(row.entity_type ?? ''),
        entityId: String(row.entity_id ?? ''),
        queue: String(row.queue ?? ''),
        rating: toInt(row.rating),
        games: Math.max(0, toInt(row.games)),
        seasonPeakTier: toNullableString(row.season_peak_tier),
      })),
      parsed: {
        users: userRows.length,
        dataCards: dataCardRows.length,
        arenaRatings: ratingRows.length,
      },
    };
  } finally {
    db.close();
  }
};

const isEligibleCharacter = (card: BackupDataCard | undefined): card is BackupDataCard =>
  Boolean(card && card.userId > 0 && card.type === 'character' && !card.deletedAt);

const buildCandidates = (snapshot: BackupSnapshot): CandidateSummary => {
  const hana = new Set<number>();
  const queen = new Set<number>();
  const veteran = new Set<number>();
  const hanaRank = getArenaTierRank('花牌');
  const queenRank = getArenaTierRank('女王');

  for (const rating of snapshot.ratings) {
    if (rating.entityType !== 'data_card') continue;
    const card = snapshot.dataCards.get(rating.entityId);
    if (!isEligibleCharacter(card)) continue;

    if (rating.queue === 'strict') {
      const currentTier = computeArenaBaseTier(rating.rating, rating.games);
      if (getArenaTierRank(currentTier) >= hanaRank) hana.add(card.userId);

      const peakTier = rating.seasonPeakTier?.trim() as ArenaTier | undefined;
      if (peakTier && getArenaTierRank(peakTier) >= queenRank) queen.add(card.userId);
    }

    if ((rating.queue === 'strict' || rating.queue === 'free') && rating.games > 100) {
      veteran.add(card.userId);
    }
  }

  return {
    hana: Array.from(hana).sort((a, b) => a - b),
    queen: Array.from(queen).sort((a, b) => a - b),
    veteran: Array.from(veteran).sort((a, b) => a - b),
  };
};

const listUserSamples = (userIds: number[], users: Map<number, string>, max = 20): string => {
  const samples = userIds.slice(0, max).map((id) => {
    const username = users.get(id);
    return username ? `${username}(${id})` : String(id);
  });
  return `${samples.join('、')}${userIds.length > max ? ` ……（共 ${userIds.length}）` : `（共 ${userIds.length}）`}`;
};

const queryExistingOnlineUsers = async (userIds: number[]): Promise<Set<number>> => {
  const existing = new Set<number>();
  for (let index = 0; index < userIds.length; index += 80) {
    const chunk = userIds.slice(index, index + 80);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await queryFromD1(`SELECT id FROM users WHERE id IN (${placeholders})`, chunk);
    readRows<{ id: number }>(result).forEach((row) => existing.add(toInt(row.id)));
  }
  return existing;
};

const upsertBadgeDefinition = async (definition: BadgeDefinition, dryRun: boolean): Promise<'insert' | 'update' | 'preview'> => {
  const countResult = await queryFromD1('SELECT COUNT(*) AS count FROM badges WHERE id = ?', [definition.id]);
  const exists = Number(readRows<{ count: number }>(countResult)[0]?.count ?? 0) > 0;
  if (dryRun) return 'preview';

  if (exists) {
    const result = await queryFromD1(
      `UPDATE badges SET
        name = ?, description = ?, icon = ?, text_color = ?, background_color = ?, border_color = ?,
        rarity = ?, sort_order = ?, is_active = 1
       WHERE id = ?`,
      [
        definition.name,
        definition.description,
        definition.icon,
        definition.textColor,
        definition.backgroundColor,
        definition.borderColor,
        definition.rarity,
        definition.sortOrder,
        definition.id,
      ],
    );
    if (!(result as any)?.success) throw new Error(`更新徽章定义失败：${definition.id}`);
    return 'update';
  }

  const result = await queryFromD1(
    `INSERT INTO badges (
      id, name, description, icon, text_color, background_color, border_color, rarity, sort_order, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      definition.id,
      definition.name,
      definition.description,
      definition.icon,
      definition.textColor,
      definition.backgroundColor,
      definition.borderColor,
      definition.rarity,
      definition.sortOrder,
    ],
  );
  if (!(result as any)?.success) throw new Error(`新增徽章定义失败：${definition.id}`);
  return 'insert';
};

const revokeExistingSeasonBadges = async (dryRun: boolean): Promise<number> => {
  const placeholders = BADGE_IDS.map(() => '?').join(', ');
  const countResult = await queryFromD1(
    `SELECT badge_id AS badgeId, COUNT(*) AS count
     FROM user_badges
     WHERE badge_id IN (${placeholders})
     GROUP BY badge_id`,
    BADGE_IDS,
  );
  const existing = readRows<{ count: number }>(countResult).reduce((sum, row) => sum + toInt(row.count), 0);
  if (dryRun) return existing;

  const result = await queryFromD1(`DELETE FROM user_badges WHERE badge_id IN (${placeholders})`, BADGE_IDS);
  return readChanges(result);
};

const grantBadgeBatch = async (badgeId: string, userIds: number[], dryRun: boolean): Promise<{ inserted: number; errors: number }> => {
  if (dryRun) return { inserted: userIds.length, errors: 0 };

  let inserted = 0;
  let errors = 0;
  for (let index = 0; index < userIds.length; index += 40) {
    const chunk = userIds.slice(index, index + 40);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '(?, ?)').join(', ');
    const params: unknown[] = [];
    chunk.forEach((userId) => params.push(userId, badgeId));
    try {
      const result = await queryFromD1(
        `INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES ${placeholders}`,
        params,
      );
      inserted += readChanges(result);
    } catch (error) {
      errors += chunk.length;
      console.error(`❌ 批量授予徽章失败：${badgeId}（batch size=${chunk.length}）`, error);
    }
  }
  return { inserted, errors };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    console.log(`[grant-season-s3-badges]
用法：
  pnpm exec tsx scripts/badge/grant-season-s3-badges.ts --backup <path> [--apply]
  pnpm exec tsx scripts/badge/grant-season-s3-badges.ts --analysis-db <sqlite-path> [--apply]

说明：
  - 默认 dry-run，仅读取本地结算数据并预览线上变更；
  - --apply 会先回收线上已有 S3 徽章授予记录，再按本地结算数据候选重发；
  - 候选规则：strict 花牌及以上、strict 赛季最高段位女王、任意排位对局数 > 100。
`);
    return;
  }

  const backupPath = args.get('--backup') ?? args.get('--backup-path');
  const analysisDbPath = args.get('--analysis-db') ?? args.get('--analysis-database');
  if (backupPath && analysisDbPath) throw new Error('不能同时传入 --backup 与 --analysis-db');
  if (!backupPath && !analysisDbPath) throw new Error('缺少参数：--backup <sql-file> 或 --analysis-db <sqlite-path>');

  const sourcePath = backupPath ?? analysisDbPath!;
  const sourceStat = await stat(sourcePath).catch(() => null);
  if (!sourceStat?.isFile() || sourceStat.size <= 0) throw new Error(`本地数据源不存在或为空：${sourcePath}`);
  const backupPaths = backupPath ? [backupPath] : [];

  const dryRun = !(args.has('--apply') || args.has('--yes') || args.has('-y'));
  console.log(`🏅 ${SEASON_ID} 赛季结算徽章发放`);
  console.log(`模式: ${dryRun ? 'dry-run（本地计算 + 线上只读）' : '执行（本地计算 + 线上写入）'}`);
  console.log(`本地数据源: ${sourcePath}`);
  console.log('------------------------------------------------------------');

  console.log('📥 正在从本地结算数据读取候选数据...');
  const snapshot = analysisDbPath ? loadAnalysisSnapshot(analysisDbPath) : await loadBackupSnapshot(backupPaths);
  console.log(`✅ 已读取本地数据：users=${snapshot.parsed.users}, data_cards=${snapshot.parsed.dataCards}, arena_ratings=${snapshot.parsed.arenaRatings}`);

  const candidates = buildCandidates(snapshot);
  console.log(`📌 ${SEASON_ID}花牌 候选用户：${listUserSamples(candidates.hana, snapshot.users)}`);
  console.log(`📌 ${SEASON_ID}女王 候选用户：${listUserSamples(candidates.queen, snapshot.users)}`);
  console.log(`📌 ${SEASON_ID}历战 候选用户：${listUserSamples(candidates.veteran, snapshot.users)}`);
  console.log('------------------------------------------------------------');

  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
  const allCandidateIds = Array.from(new Set([...candidates.hana, ...candidates.queen, ...candidates.veteran])).sort((a, b) => a - b);
  const existingOnlineUsers = await queryExistingOnlineUsers(allCandidateIds);
  const missingOnlineUsers = allCandidateIds.filter((id) => !existingOnlineUsers.has(id));
  if (missingOnlineUsers.length > 0) {
    console.log(`⚠️ 以下备份候选用户在线上不存在，发放时会跳过：${JSON.stringify(missingOnlineUsers)}`);
  }

  const validCandidates = {
    hana: candidates.hana.filter((id) => existingOnlineUsers.has(id)),
    queen: candidates.queen.filter((id) => existingOnlineUsers.has(id)),
    veteran: candidates.veteran.filter((id) => existingOnlineUsers.has(id)),
  };
  console.log(`🧾 线上有效候选：${SEASON_ID}花牌=${validCandidates.hana.length}, ${SEASON_ID}女王=${validCandidates.queen.length}, ${SEASON_ID}历战=${validCandidates.veteran.length}`);

  let insertedDefinitions = 0;
  let updatedDefinitions = 0;
  for (const definition of BADGE_DEFINITIONS) {
    const action = await upsertBadgeDefinition(definition, dryRun);
    if (action === 'insert') insertedDefinitions += 1;
    if (action === 'update') updatedDefinitions += 1;
    console.log(`${dryRun ? '[dry-run]' : '✅'} ${action === 'insert' ? '新增' : action === 'update' ? '更新' : '预览'}徽章定义：${definition.id}（${definition.name}）`);
  }

  const revokedExisting = await revokeExistingSeasonBadges(dryRun);
  console.log(`${dryRun ? '[dry-run] 将回收' : '已回收'} ${revokedExisting} 条既有 S3 user_badges 记录`);

  const granted = {
    season_s3_hana: await grantBadgeBatch('season_s3_hana', validCandidates.hana, dryRun),
    season_s3_queen: await grantBadgeBatch('season_s3_queen', validCandidates.queen, dryRun),
    season_s3_veteran: await grantBadgeBatch('season_s3_veteran', validCandidates.veteran, dryRun),
  };

  console.log('------------------------------------------------------------');
  console.log('📊 发放统计');
  console.table({
    dryRun,
    revokedExistingUserBadges: revokedExisting,
    insertedDefinitions,
    updatedDefinitions,
    candidatesFromBackup: {
      season_s3_hana: candidates.hana.length,
      season_s3_queen: candidates.queen.length,
      season_s3_veteran: candidates.veteran.length,
    },
    validOnlineCandidates: {
      season_s3_hana: validCandidates.hana.length,
      season_s3_queen: validCandidates.queen.length,
      season_s3_veteran: validCandidates.veteran.length,
    },
    granted,
  });

  if (Object.values(granted).some((item) => item.errors > 0)) process.exitCode = 1;
};

main().catch((error) => {
  console.error(`❌ ${SEASON_ID} 徽章发放脚本执行异常:`, error);
  process.exitCode = 1;
});
