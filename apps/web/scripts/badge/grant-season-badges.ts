#!/usr/bin/env -S pnpm exec tsx

/**
 * 赛季结算徽章：创建/同步定义，并为满足条件的用户发放
 *
 * 徽章：
 * - {seasonId}花牌：任意角色在严格排位达到「花牌」及以上段位
 * - {seasonId}历战：任意角色在自由排位对局数 > 100
 *
 * 用法：
 * - 预览：pnpm exec tsx scripts/badge/grant-season-badges.ts --season-id S1 --season-name 启航赛季
 * - 执行：pnpm exec tsx scripts/badge/grant-season-badges.ts --season-id S1 --season-name 启航赛季 --apply
 */

import { loadEnvConfig } from '@next/env';

import { computeArenaBaseTier } from '@/lib/arena/tier';
import { queryFromD1 } from '@/lib/database/core';

type BadgeUpsertDefinition = {
  id: string;
  name: string;
  description: string;
  iconJson: string;
  textColorJson: string;
  backgroundColorJson: string;
  borderColorJson?: string | null;
  rarity: number;
  sortOrder: number;
  isActive: boolean;
};

type RatedCharacterRow = {
  userId: number;
  username: string;
  dataCardId: string;
  cardName: string;
  isPublic: number | boolean | null;
  reviewStatus: string | null;
  deletedAt: string | null;
  rating: number;
  games: number;
};

const readRows = <T,>(result: unknown): T[] => {
  const rows = (result as any)?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as T[]) : [];
};

const readChanges = (result: unknown): number => {
  const changes = (result as any)?.result?.[0]?.meta?.changes;
  return typeof changes === 'number' && Number.isFinite(changes) ? Math.max(0, Math.floor(changes)) : 0;
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

const requireNonEmptyArg = (value: string | undefined, label: string): string => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new Error(`缺少参数：${label}`);
  return trimmed;
};

const toBadgeSeasonSlug = (seasonId: string): string => seasonId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');

const buildBadgeDefinitions = (seasonId: string, seasonName: string): BadgeUpsertDefinition[] => {
  const slug = toBadgeSeasonSlug(seasonId);
  return [
    {
      id: `season_${slug}_hana`,
      name: `${seasonId}花牌`,
      description: `在${seasonName}（${seasonId}）中，任意角色严格排位达到「花牌」及以上段位。`,
      iconJson: '{"type":"lucide","name":"Flower2"}',
      textColorJson: '{"type":"solid","value":"#FFFFFF"}',
      backgroundColorJson: '{"type":"gradient","value":"linear-gradient(135deg, #ec4899, #a855f7)"}',
      borderColorJson: '{"type":"solid","value":"#a855f7"}',
      rarity: 72,
      sortOrder: 31,
      isActive: true,
    },
    {
      id: `season_${slug}_veteran`,
      name: `${seasonId}历战`,
      description: `在${seasonName}（${seasonId}）中，任意角色自由排位对局数超过 100 场。`,
      iconJson: '{"type":"lucide","name":"Swords"}',
      textColorJson: '{"type":"solid","value":"#111827"}',
      backgroundColorJson: '{"type":"gradient","value":"linear-gradient(135deg, #fbbf24, #f97316)"}',
      borderColorJson: '{"type":"solid","value":"#f97316"}',
      rarity: 60,
      sortOrder: 30,
      isActive: true,
    },
  ];
};

const badgeExists = async (badgeId: string): Promise<boolean> => {
  const result = await queryFromD1('SELECT COUNT(*) as count FROM badges WHERE id = ?', [badgeId]);
  const row = readRows<{ count: number }>(result)[0];
  return Number(row?.count ?? 0) > 0;
};

const insertBadge = async (def: BadgeUpsertDefinition): Promise<boolean> => {
  const result = await queryFromD1(
    `INSERT INTO badges (
      id, name, description, icon, text_color, background_color, border_color, rarity, sort_order, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      def.id,
      def.name,
      def.description,
      def.iconJson,
      def.textColorJson,
      def.backgroundColorJson,
      def.borderColorJson ?? null,
      def.rarity,
      def.sortOrder,
      def.isActive ? 1 : 0,
    ],
  );
  return Boolean((result as any)?.success);
};

const updateBadge = async (def: BadgeUpsertDefinition): Promise<boolean> => {
  const result = await queryFromD1(
    `UPDATE badges SET
      name = ?,
      description = ?,
      icon = ?,
      text_color = ?,
      background_color = ?,
      border_color = ?,
      rarity = ?,
      sort_order = ?,
      is_active = ?
    WHERE id = ?`,
    [
      def.name,
      def.description,
      def.iconJson,
      def.textColorJson,
      def.backgroundColorJson,
      def.borderColorJson ?? null,
      def.rarity,
      def.sortOrder,
      def.isActive ? 1 : 0,
      def.id,
    ],
  );
  return Boolean((result as any)?.success);
};

const isPublicApprovedCharacter = (row: RatedCharacterRow): boolean => {
  const isPublic = row.isPublic === 1 || row.isPublic === true;
  return Boolean(isPublic && row.reviewStatus === 'approved' && !row.deletedAt);
};

const listUserSamples = (userIds: number[], usernamesById: Map<number, string>, max = 20): string => {
  const limited = userIds.slice(0, max);
  const parts = limited.map((id) => {
    const name = usernamesById.get(id) ?? '';
    return name ? `${name}(${id})` : String(id);
  });
  const suffix = userIds.length > max ? ` …（共 ${userIds.length}）` : `（共 ${userIds.length}）`;
  return parts.join('、') + suffix;
};

const loadUsersHavingBadge = async (badgeId: string): Promise<Set<number>> => {
  const result = await queryFromD1(`SELECT user_id AS userId FROM user_badges WHERE badge_id = ?`, [badgeId]);
  return new Set(readRows<{ userId: number }>(result).map((row) => row.userId));
};

const grantBadgeBatch = async (badgeId: string, userIds: number[]): Promise<{ inserted: number; errors: number }> => {
  let inserted = 0;
  let errors = 0;
  for (let index = 0; index < userIds.length; index += 40) {
    const batch = userIds.slice(index, index + 40);
    if (batch.length === 0) continue;
    const placeholders = batch.map(() => '(?, ?)').join(', ');
    const params: unknown[] = [];
    batch.forEach((userId) => {
      params.push(userId, badgeId);
    });
    try {
      const result = await queryFromD1(
        `INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES ${placeholders}`,
        params,
      );
      inserted += readChanges(result);
    } catch (error) {
      errors += batch.length;
      console.error(`❌ 批量授予徽章失败：${badgeId}（batch size=${batch.length}）`, error);
    }
  }
  return { inserted, errors };
};

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.has('--help') || args.has('-h')) {
    console.log(`[grant-season-badges]
用法：
  pnpm exec tsx scripts/badge/grant-season-badges.ts --season-id S1 --season-name 启航赛季 [--apply]

说明：
  - 默认 dry-run，仅预览将要创建的徽章定义与发放名单
  - 徽章规则固定为：
    1) 严格排位达到花牌及以上 -> {seasonId}花牌
    2) 自由排位对局数 > 100 -> {seasonId}历战
`);
    return;
  }

  const seasonId = requireNonEmptyArg(args.get('--season-id') ?? args.get('--seasonId'), '--season-id');
  const seasonName = requireNonEmptyArg(args.get('--season-name') ?? args.get('--seasonName'), '--season-name');
  const badges = buildBadgeDefinitions(seasonId, seasonName);

  const apply = args.has('--apply') || args.has('--yes') || args.has('-y');
  const dryRun = !apply;

  console.log(`🏅 ${seasonId} 赛季结算徽章发放`);
  console.log(`模式: ${dryRun ? 'dry-run（仅预览）' : '执行（写入数据库）'}`);
  console.log(`徽章: ${badges.map((b) => `${b.id}（${b.name}）`).join(' / ')}`);
  console.log('');

  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

  let badgeInserted = 0;
  let badgeUpdated = 0;
  let badgePreviewed = 0;
  let badgeErrors = 0;

  for (const def of badges) {
    try {
      const exists = await badgeExists(def.id);
      if (dryRun) {
        console.log(`[dry-run] ${exists ? '更新' : '新增'}徽章定义：${def.id}（${def.name}）`);
        badgePreviewed += 1;
        continue;
      }

      const ok = exists ? await updateBadge(def) : await insertBadge(def);
      if (ok) {
        console.log(`✅ ${exists ? '更新' : '新增'}徽章定义：${def.id}（${def.name}）`);
        if (exists) badgeUpdated += 1;
        else badgeInserted += 1;
      } else {
        console.log(`❌ ${exists ? '更新' : '新增'}徽章定义失败：${def.id}（${def.name}）`);
        badgeErrors += 1;
      }
    } catch (error) {
      console.error(`❌ 处理徽章定义 ${def.id} 时出错:`, error);
      badgeErrors += 1;
    }
  }

  console.log('');

  const [strictRows, freeRows] = await Promise.all([
    queryFromD1(
      `SELECT
        dc.user_id AS userId,
        u.username AS username,
        dc.id AS dataCardId,
        dc.name AS cardName,
        dc.is_public AS isPublic,
        dc.review_status AS reviewStatus,
        dc.deleted_at AS deletedAt,
        ar.rating AS rating,
        ar.games AS games
      FROM arena_ratings ar
      JOIN data_cards dc ON dc.id = ar.entity_id
      JOIN users u ON u.id = dc.user_id
      WHERE ar.queue = 'strict'
        AND ar.entity_type = 'data_card'
        AND dc.type = 'character'`,
      [],
    ),
    queryFromD1(
      `SELECT
        dc.user_id AS userId,
        u.username AS username,
        dc.id AS dataCardId,
        dc.name AS cardName,
        dc.is_public AS isPublic,
        dc.review_status AS reviewStatus,
        dc.deleted_at AS deletedAt,
        ar.rating AS rating,
        ar.games AS games
      FROM arena_ratings ar
      JOIN data_cards dc ON dc.id = ar.entity_id
      JOIN users u ON u.id = dc.user_id
      WHERE ar.queue = 'free'
        AND ar.entity_type = 'data_card'
        AND dc.type = 'character'`,
      [],
    ),
  ]);
  const strictRowsTyped = readRows<RatedCharacterRow>(strictRows);
  const freeRowsTyped = readRows<RatedCharacterRow>(freeRows);
  const usernamesById = new Map<number, string>();
  strictRowsTyped.forEach((row) => usernamesById.set(row.userId, row.username));
  freeRowsTyped.forEach((row) => usernamesById.set(row.userId, row.username));

  const hanaUserIds = Array.from(
    new Set(
      strictRowsTyped
        .filter((row) => row.userId && isPublicApprovedCharacter(row) && ['花牌', '权杖'].includes(computeArenaBaseTier(row.rating, row.games)))
        .map((row) => row.userId),
    ),
  ).sort((a, b) => a - b);

  const veteranUserIds = Array.from(
    new Set(
      freeRowsTyped
        .filter((row) => row.userId && !row.deletedAt && row.games > 100)
        .map((row) => row.userId),
    ),
  ).sort((a, b) => a - b);

  console.log(`📌 ${seasonId}花牌 候选用户：${listUserSamples(hanaUserIds, usernamesById)}`);
  console.log(`📌 ${seasonId}历战 候选用户：${listUserSamples(veteranUserIds, usernamesById)}`);
  console.log('');

  const hanaBadgeId = badges[0].id;
  const veteranBadgeId = badges[1].id;
  const [hanaHasSet, veteranHasSet] = await Promise.all([
    loadUsersHavingBadge(hanaBadgeId),
    loadUsersHavingBadge(veteranBadgeId),
  ]);

  const hanaToGrant = hanaUserIds.filter((id) => !hanaHasSet.has(id));
  const veteranToGrant = veteranUserIds.filter((id) => !veteranHasSet.has(id));

  console.log(`🧾 ${seasonId}花牌：候选 ${hanaUserIds.length} / 已拥有 ${hanaUserIds.length - hanaToGrant.length} / 待发放 ${hanaToGrant.length}`);
  console.log(`🧾 ${seasonId}历战：候选 ${veteranUserIds.length} / 已拥有 ${veteranUserIds.length - veteranToGrant.length} / 待发放 ${veteranToGrant.length}`);
  console.log('');

  const summary = {
    dryRun,
    badges: {
      [hanaBadgeId]: { eligibleUsers: hanaUserIds.length, granted: 0, skippedHasBadge: hanaUserIds.length - hanaToGrant.length, errors: 0 },
      [veteranBadgeId]: {
        eligibleUsers: veteranUserIds.length,
        granted: 0,
        skippedHasBadge: veteranUserIds.length - veteranToGrant.length,
        errors: 0,
      },
    } as Record<string, { eligibleUsers: number; granted: number; skippedHasBadge: number; errors: number }>,
    badgeDefinition: {
      inserted: badgeInserted,
      updated: badgeUpdated,
      previewed: badgePreviewed,
      errors: badgeErrors,
    },
  };

  if (dryRun) {
    hanaToGrant.slice(0, 40).forEach((userId) => {
      console.log(`[dry-run] 将授予徽章：${hanaBadgeId} -> 用户 ${usernamesById.get(userId) ?? '-'}(${userId})`);
    });
    if (hanaToGrant.length > 40) console.log(`[dry-run] ${hanaBadgeId} 省略显示 ${hanaToGrant.length - 40} 个用户`);

    veteranToGrant.slice(0, 40).forEach((userId) => {
      console.log(`[dry-run] 将授予徽章：${veteranBadgeId} -> 用户 ${usernamesById.get(userId) ?? '-'}(${userId})`);
    });
    if (veteranToGrant.length > 40) console.log(`[dry-run] ${veteranBadgeId} 省略显示 ${veteranToGrant.length - 40} 个用户`);

    summary.badges[hanaBadgeId].granted = hanaToGrant.length;
    summary.badges[veteranBadgeId].granted = veteranToGrant.length;
  } else {
    const [hanaResult, veteranResult] = await Promise.all([
      grantBadgeBatch(hanaBadgeId, hanaToGrant),
      grantBadgeBatch(veteranBadgeId, veteranToGrant),
    ]);
    summary.badges[hanaBadgeId].granted = hanaResult.inserted;
    summary.badges[hanaBadgeId].errors = hanaResult.errors;
    summary.badges[veteranBadgeId].granted = veteranResult.inserted;
    summary.badges[veteranBadgeId].errors = veteranResult.errors;
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log('📊 发放统计');
  console.table(summary);

  if (summary.badgeDefinition.errors > 0) process.exitCode = 1;
  if (Object.values(summary.badges).some((item) => item.errors > 0)) process.exitCode = 1;
}

main();
