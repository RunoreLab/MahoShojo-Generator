#!/usr/bin/env -S pnpm exec tsx

import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

import { loadEnvConfig } from '@next/env';

import { computeArenaBaseTier, getArenaTierRank, type ArenaTier } from '@/lib/arena/tier';
import { queryFromD1 } from '@/lib/database/core';

const SEASON_ID = 'S2';
const SEASON_NAME = '闪耀赛季';
const DEFAULT_BACKUP_PATH = String.raw`G:\12-编程与IT\MahoShojo-Generator数据\mahoshojo_backup_20260703_114300.sql`;
const DEFAULT_ARCHIVE_PATH = 'public/data/seasons/archive_S2.json';

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
  isPublic: number | null;
  reviewStatus: string | null;
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
  parsed: Record<string, number>;
};

type CandidateSummary = {
  hana: number[];
  queen: number[];
  veteran: number[];
};

type ArchiveEntity = {
  entityType?: unknown;
  authorId?: unknown;
  authorName?: unknown;
  queues?: {
    strict?: {
      rating?: unknown;
      games?: unknown;
      seasonPeakTier?: unknown;
    };
    free?: {
      games?: unknown;
    };
  };
};

const BADGE_DEFINITIONS: BadgeDefinition[] = [
  {
    id: 'season_s2_hana',
    name: 'S2花牌',
    description: `在${SEASON_NAME}（${SEASON_ID}）中，任意角色严格排位达到「花牌」及以上段位。`,
    icon: '{"type":"lucide","name":"Flower2"}',
    textColor: '{"type":"solid","value":"#FFFFFF"}',
    backgroundColor: '{"type":"gradient","value":"linear-gradient(135deg, #ec4899, #a855f7)"}',
    borderColor: '{"type":"solid","value":"#a855f7"}',
    rarity: 72,
    sortOrder: 31,
  },
  {
    id: 'season_s2_queen',
    name: 'S2女王',
    description: `在${SEASON_NAME}（${SEASON_ID}）中，任意角色严格排位曾达到过「女王」段位。`,
    icon: '{"type":"lucide","name":"Crown"}',
    textColor: '{"type":"solid","value":"#FFFFFF"}',
    backgroundColor: '{"type":"gradient","value":"linear-gradient(135deg, #facc15, #eab308, #ca8a04)"}',
    borderColor: '{"type":"solid","value":"#ca8a04"}',
    rarity: 95,
    sortOrder: 32,
  },
  {
    id: 'season_s2_veteran',
    name: 'S2历战',
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

const parseArgs = (argv: string[]) => {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
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

const parseInsertLine = (line: string): { table: string; columns: string[]; row: Map<string, unknown> } | null => {
  const match = line.match(/^INSERT INTO "([^"]+)" \(([^)]*)\) VALUES\((.*)\);$/);
  if (!match) return null;

  const columns = match[2].split(',').map((column) => column.trim().replace(/^"|"$/g, ''));
  const values = parseSqlValues(match[3]);
  const row = new Map<string, unknown>();
  columns.forEach((column, index) => row.set(column, values[index]));
  return { table: match[1], columns, row };
};

const loadBackupSnapshot = async (backupPath: string): Promise<BackupSnapshot> => {
  const users = new Map<number, string>();
  const dataCards = new Map<string, BackupDataCard>();
  const ratings: BackupArenaRating[] = [];
  const parsed = { users: 0, data_cards: 0, arena_ratings: 0 };
  const input = createReadStream(backupPath, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line.startsWith('INSERT INTO "users"') && !line.startsWith('INSERT INTO "data_cards"') && !line.startsWith('INSERT INTO "arena_ratings"')) {
      continue;
    }

    const insert = parseInsertLine(line);
    if (!insert) continue;

    if (insert.table === 'users') {
      const id = toInt(insert.row.get('id'), 0);
      if (id > 0) users.set(id, String(insert.row.get('username') ?? ''));
      parsed.users += 1;
      continue;
    }

    if (insert.table === 'data_cards') {
      const id = String(insert.row.get('id') ?? '');
      if (id) {
        dataCards.set(id, {
          id,
          userId: toInt(insert.row.get('user_id'), 0),
          type: String(insert.row.get('type') ?? ''),
          name: String(insert.row.get('name') ?? ''),
          isPublic: insert.row.get('is_public') == null ? null : toInt(insert.row.get('is_public')),
          reviewStatus: toNullableString(insert.row.get('review_status')),
          deletedAt: toNullableString(insert.row.get('deleted_at')),
        });
      }
      parsed.data_cards += 1;
      continue;
    }

    if (insert.table === 'arena_ratings') {
      ratings.push({
        entityType: String(insert.row.get('entity_type') ?? ''),
        entityId: String(insert.row.get('entity_id') ?? ''),
        queue: String(insert.row.get('queue') ?? ''),
        rating: toInt(insert.row.get('rating'), 0),
        games: Math.max(0, toInt(insert.row.get('games'), 0)),
        seasonPeakTier: toNullableString(insert.row.get('season_peak_tier')),
      });
      parsed.arena_ratings += 1;
    }
  }

  return { users, dataCards, ratings, parsed };
};

const loadArchiveCandidates = (archivePath: string): { candidates: CandidateSummary; users: Map<number, string> } => {
  const raw = JSON.parse(readFileSync(archivePath, 'utf8')) as { entities?: ArchiveEntity[] };
  const users = new Map<number, string>();
  const hana = new Set<number>();
  const queen = new Set<number>();
  const veteran = new Set<number>();
  const hanaRank = getArenaTierRank('花牌');
  const queenRank = getArenaTierRank('女王');

  for (const entity of raw.entities ?? []) {
    if (entity.entityType !== 'data_card') continue;
    const userId = toInt(entity.authorId, 0);
    if (userId <= 0) continue;
    users.set(userId, String(entity.authorName ?? ''));

    const strict = entity.queues?.strict;
    if (strict) {
      const currentTier = computeArenaBaseTier(toInt(strict.rating, 0), Math.max(0, toInt(strict.games, 0)));
      if (getArenaTierRank(currentTier) >= hanaRank) hana.add(userId);

      const peakTier = typeof strict.seasonPeakTier === 'string' ? strict.seasonPeakTier.trim() : '';
      if (getArenaTierRank(peakTier as ArenaTier) >= queenRank) queen.add(userId);

      if (Math.max(0, toInt(strict.games, 0)) > 100) veteran.add(userId);
    }

    const free = entity.queues?.free;
    if (free && Math.max(0, toInt(free.games, 0)) > 100) veteran.add(userId);
  }

  return {
    users,
    candidates: {
      hana: Array.from(hana).sort((a, b) => a - b),
      queen: Array.from(queen).sort((a, b) => a - b),
      veteran: Array.from(veteran).sort((a, b) => a - b),
    },
  };
};

const isEligibleCharacter = (card: BackupDataCard | undefined): card is BackupDataCard =>
  Boolean(card && card.userId > 0 && card.type === 'character' && !card.deletedAt);

const computeCandidates = (snapshot: BackupSnapshot): CandidateSummary => {
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

const listUserSamples = (userIds: number[], usernamesById: Map<number, string>, max = 30): string => {
  const samples = userIds.slice(0, max).map((id) => {
    const name = usernamesById.get(id);
    return name ? `${name}(${id})` : String(id);
  });
  return `${samples.join('、')}${userIds.length > max ? ` ……（共 ${userIds.length}）` : `（共 ${userIds.length}）`}`;
};

const diffIds = (left: number[], right: number[]): number[] => {
  const rightSet = new Set(right);
  return left.filter((id) => !rightSet.has(id));
};

const logCandidateDiff = (label: string, archiveIds: number[], backupIds: number[]) => {
  const archiveOnly = diffIds(archiveIds, backupIds);
  const backupOnly = diffIds(backupIds, archiveIds);
  if (archiveOnly.length === 0 && backupOnly.length === 0) {
    console.log(`✅ ${label}：归档与备份候选一致`);
    return;
  }
  console.log(`⚠️ ${label}：归档与备份候选不一致`);
  console.log(`  仅归档: ${JSON.stringify(archiveOnly)}`);
  console.log(`  仅备份: ${JSON.stringify(backupOnly)}`);
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

const upsertBadgeDefinition = async (def: BadgeDefinition, dryRun: boolean): Promise<'insert' | 'update' | 'preview'> => {
  const countResult = await queryFromD1('SELECT COUNT(*) AS count FROM badges WHERE id = ?', [def.id]);
  const exists = Number(readRows<{ count: number }>(countResult)[0]?.count ?? 0) > 0;

  if (dryRun) {
    console.log(`[dry-run] 将${exists ? '更新' : '新增'}徽章定义：${def.id}（${def.name}）`);
    return 'preview';
  }

  if (exists) {
    await queryFromD1(
      `UPDATE badges SET
        name = ?,
        description = ?,
        icon = ?,
        text_color = ?,
        background_color = ?,
        border_color = ?,
        rarity = ?,
        sort_order = ?,
        is_active = 1
      WHERE id = ?`,
      [def.name, def.description, def.icon, def.textColor, def.backgroundColor, def.borderColor, def.rarity, def.sortOrder, def.id],
    );
    return 'update';
  }

  await queryFromD1(
    `INSERT INTO badges (
      id, name, description, icon, text_color, background_color, border_color, rarity, sort_order, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [def.id, def.name, def.description, def.icon, def.textColor, def.backgroundColor, def.borderColor, def.rarity, def.sortOrder],
  );
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
  const existingRows = readRows<{ badgeId: string; count: number }>(countResult);
  console.table(existingRows);

  if (dryRun) {
    return existingRows.reduce((sum, row) => sum + toInt(row.count), 0);
  }

  const deleteResult = await queryFromD1(`DELETE FROM user_badges WHERE badge_id IN (${placeholders})`, BADGE_IDS);
  return readChanges(deleteResult);
};

const grantBadgeBatch = async (badgeId: string, userIds: number[], dryRun: boolean): Promise<number> => {
  if (dryRun) {
    console.log(`[dry-run] 将授予 ${badgeId}: ${JSON.stringify(userIds)}`);
    return userIds.length;
  }

  let inserted = 0;
  for (let index = 0; index < userIds.length; index += 40) {
    const chunk = userIds.slice(index, index + 40);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '(?, ?)').join(', ');
    const params: unknown[] = [];
    chunk.forEach((userId) => params.push(userId, badgeId));
    const result = await queryFromD1(`INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES ${placeholders}`, params);
    inserted += readChanges(result);
  }
  return inserted;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !(args.has('--apply') || args.has('--yes') || args.has('-y'));
  const backupPath = args.get('--backup') ?? args.get('--backup-path') ?? DEFAULT_BACKUP_PATH;
  const archivePath = resolve(args.get('--archive') ?? args.get('--archive-path') ?? DEFAULT_ARCHIVE_PATH);

  console.log(`🏅 S2 赛季结算徽章在线发放`);
  console.log(`模式: ${dryRun ? 'dry-run（仅预览）' : '执行（先回收线上已有 S2 徽章，再写入线上 D1）'}`);
  console.log(`备份: ${backupPath}`);
  console.log(`归档: ${archivePath}`);
  console.log('------------------------------------------------------------');

  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

  console.log('📥 正在从备份 SQL 流式读取 S2 排位数据...');
  const snapshot = await loadBackupSnapshot(backupPath);
  console.log(`✅ 已读取备份：users=${snapshot.parsed.users}, data_cards=${snapshot.parsed.data_cards}, arena_ratings=${snapshot.parsed.arena_ratings}`);

  const backupCandidates = computeCandidates(snapshot);
  const archive = loadArchiveCandidates(archivePath);
  const candidates = archive.candidates;

  console.log('🔎 归档与备份候选差异复核：');
  logCandidateDiff('S2花牌', candidates.hana, backupCandidates.hana);
  logCandidateDiff('S2女王', candidates.queen, backupCandidates.queen);
  logCandidateDiff('S2历战', candidates.veteran, backupCandidates.veteran);
  console.log('');
  console.log(`📌 S2花牌 候选用户（以归档为准）：${listUserSamples(candidates.hana, archive.users)}`);
  console.log(`📌 S2女王 候选用户（以归档为准）：${listUserSamples(candidates.queen, archive.users)}`);
  console.log(`📌 S2历战 候选用户（以归档为准）：${listUserSamples(candidates.veteran, archive.users)}`);
  console.log('------------------------------------------------------------');

  const allCandidateIds = Array.from(new Set([...candidates.hana, ...candidates.queen, ...candidates.veteran])).sort((a, b) => a - b);
  const existingOnlineUsers = await queryExistingOnlineUsers(allCandidateIds);
  const missingOnlineUsers = allCandidateIds.filter((id) => !existingOnlineUsers.has(id));
  if (missingOnlineUsers.length > 0) {
    console.log(`⚠️ 以下备份候选用户在线上 users 表不存在，发放时会跳过：${JSON.stringify(missingOnlineUsers)}`);
  }

  const validCandidates: CandidateSummary = {
    hana: candidates.hana.filter((id) => existingOnlineUsers.has(id)),
    queen: candidates.queen.filter((id) => existingOnlineUsers.has(id)),
    veteran: candidates.veteran.filter((id) => existingOnlineUsers.has(id)),
  };
  console.log(`🧾 线上有效候选：S2花牌=${validCandidates.hana.length}, S2女王=${validCandidates.queen.length}, S2历战=${validCandidates.veteran.length}`);
  console.log('------------------------------------------------------------');

  console.log('🧹 回收线上已有 S2 徽章授予记录：');
  const revoked = await revokeExistingSeasonBadges(dryRun);
  console.log(`${dryRun ? '[dry-run] 将回收' : '已回收'} ${revoked} 条 user_badges 记录`);

  let insertedDefinitions = 0;
  let updatedDefinitions = 0;
  for (const def of BADGE_DEFINITIONS) {
    const action = await upsertBadgeDefinition(def, dryRun);
    if (action === 'insert') insertedDefinitions += 1;
    if (action === 'update') updatedDefinitions += 1;
  }

  const granted = {
    season_s2_hana: await grantBadgeBatch('season_s2_hana', validCandidates.hana, dryRun),
    season_s2_queen: await grantBadgeBatch('season_s2_queen', validCandidates.queen, dryRun),
    season_s2_veteran: await grantBadgeBatch('season_s2_veteran', validCandidates.veteran, dryRun),
  };

  console.log('------------------------------------------------------------');
  console.log('📊 发放统计');
  console.table({
    dryRun,
    revokedExistingUserBadges: revoked,
    insertedDefinitions,
    updatedDefinitions,
    candidatesFromArchive: {
      season_s2_hana: candidates.hana.length,
      season_s2_queen: candidates.queen.length,
      season_s2_veteran: candidates.veteran.length,
    },
    validOnlineCandidates: {
      season_s2_hana: validCandidates.hana.length,
      season_s2_queen: validCandidates.queen.length,
      season_s2_veteran: validCandidates.veteran.length,
    },
    granted,
  });
}

main().catch((error) => {
  console.error('❌ S2 徽章发放脚本执行异常:', error);
  process.exit(1);
});
