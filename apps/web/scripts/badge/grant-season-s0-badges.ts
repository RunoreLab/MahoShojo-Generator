#!/usr/bin/env -S pnpm exec tsx

/**
 * S0 赛季结算徽章：创建/同步定义，并为满足条件的用户发放
 *
 * 徽章：
 * - S0花牌：任意角色在严格排位达到「花牌」及以上段位
 * - S0历战：任意角色在自由排位对局数 > 100
 *
 * 用法：
 * - 预览（默认）：pnpm exec tsx scripts/badge/grant-season-s0-badges.ts
 * - 执行写入：pnpm exec tsx scripts/badge/grant-season-s0-badges.ts --apply
 *
 * 说明：
 * - 默认会从 .env / .env.local 读取 Cloudflare D1 配置（与 season-archive / season-soft-reset 脚本一致）
 * - 为避免误操作，未传入 --apply 时不会对数据库写入（仅打印统计与计划）
 */

import { loadEnvConfig } from '@next/env';

import { computeArenaBaseTier } from '@/lib/arena/tier';
import {
  countBadgesById,
  grantBadgeToUsersInChunks,
  insertBadgeDefinition,
  listRatedCharactersByQueue,
  listUserIdsHavingBadge,
  updateBadgeDefinition,
} from '@/lib/database/badges-granting';

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

const BADGES: BadgeUpsertDefinition[] = [
  {
    id: 'season_s0_hana',
    name: 'S0花牌',
    description: '在公测赛季（S0）中，任意角色严格排位达到「花牌」及以上段位。',
    iconJson: '{"type":"lucide","name":"Flower2"}',
    textColorJson: '{"type":"solid","value":"#FFFFFF"}',
    backgroundColorJson: '{"type":"gradient","value":"linear-gradient(135deg, #ec4899, #a855f7)"}',
    borderColorJson: '{"type":"solid","value":"#a855f7"}',
    rarity: 72,
    sortOrder: 31,
    isActive: true,
  },
  {
    id: 'season_s0_veteran',
    name: 'S0历战',
    description: '在公测赛季（S0）中，任意角色自由排位对局数超过 100 场。',
    iconJson: '{"type":"lucide","name":"Swords"}',
    textColorJson: '{"type":"solid","value":"#111827"}',
    backgroundColorJson: '{"type":"gradient","value":"linear-gradient(135deg, #fbbf24, #f97316)"}',
    borderColorJson: '{"type":"solid","value":"#f97316"}',
    rarity: 60,
    sortOrder: 30,
    isActive: true,
  },
];

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

const badgeExists = async (badgeId: string): Promise<boolean> => {
  return (await countBadgesById(badgeId)) > 0;
};

const insertBadge = async (def: BadgeUpsertDefinition): Promise<boolean> => {
  return insertBadgeDefinition({
    id: def.id,
    name: def.name,
    description: def.description,
    icon: def.iconJson,
    textColor: def.textColorJson,
    backgroundColor: def.backgroundColorJson,
    borderColor: def.borderColorJson ?? null,
    rarity: def.rarity,
    sortOrder: def.sortOrder,
    isActive: def.isActive,
  });
};

const updateBadge = async (def: BadgeUpsertDefinition): Promise<boolean> => {
  return updateBadgeDefinition({
    id: def.id,
    name: def.name,
    description: def.description,
    icon: def.iconJson,
    textColor: def.textColorJson,
    backgroundColor: def.backgroundColorJson,
    borderColor: def.borderColorJson ?? null,
    rarity: def.rarity,
    sortOrder: def.sortOrder,
    isActive: def.isActive,
  });
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

const loadStrictRatedCharacters = async (): Promise<RatedCharacterRow[]> => {
  return listRatedCharactersByQueue('strict');
};

const loadFreeRatedCharacters = async (): Promise<RatedCharacterRow[]> => {
  return listRatedCharactersByQueue('free');
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
  const set = new Set<number>();
  const rows = await listUserIdsHavingBadge(badgeId);
  rows.forEach((id) => set.add(id));
  return set;
};

const grantBadgeBatch = async (badgeId: string, userIds: number[]): Promise<{ inserted: number; errors: number }> => {
  const result = await grantBadgeToUsersInChunks({
    badgeId,
    userIds,
    chunkSize: 40,
  });
  return { inserted: result.inserted, errors: result.errors };
};

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  const apply = args.has('--apply') || args.has('--yes') || args.has('-y');
  const dryRun = !apply;

  console.log('🏅 S0 赛季结算徽章发放');
  console.log(`模式: ${dryRun ? 'dry-run（仅预览）' : '执行（写入数据库）'}`);
  console.log(`徽章: ${BADGES.map((b) => `${b.id}（${b.name}）`).join(' / ')}`);
  console.log('');

  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

  // 1) 同步徽章定义
  let badgeInserted = 0;
  let badgeUpdated = 0;
  let badgePreviewed = 0;
  let badgeErrors = 0;

  for (const def of BADGES) {
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

  // 2) 计算候选用户
  const [strictRows, freeRows] = await Promise.all([loadStrictRatedCharacters(), loadFreeRatedCharacters()]);

  const usernamesById = new Map<number, string>();
  strictRows.forEach((r) => usernamesById.set(r.userId, r.username));
  freeRows.forEach((r) => usernamesById.set(r.userId, r.username));

  const flowerUserIdsSet = new Set<number>();
  for (const row of strictRows) {
    if (!row.userId) continue;
    if (!isPublicApprovedCharacter(row)) continue;
    const tier = computeArenaBaseTier(row.rating, row.games);
    if (tier === '花牌' || tier === '权杖') {
      flowerUserIdsSet.add(row.userId);
    }
  }

  const veteranUserIdsSet = new Set<number>();
  for (const row of freeRows) {
    if (!row.userId) continue;
    if (row.deletedAt) continue;
    if (row.games > 100) {
      veteranUserIdsSet.add(row.userId);
    }
  }

  const flowerUserIds = Array.from(flowerUserIdsSet).sort((a, b) => a - b);
  const veteranUserIds = Array.from(veteranUserIdsSet).sort((a, b) => a - b);

  console.log(`📌 S0花牌 候选用户：${listUserSamples(flowerUserIds, usernamesById)}`);
  console.log(`📌 S0历战 候选用户：${listUserSamples(veteranUserIds, usernamesById)}`);
  console.log('');

  // 3) 发放徽章
  const [hanaHasSet, veteranHasSet] = await Promise.all([
    loadUsersHavingBadge('season_s0_hana'),
    loadUsersHavingBadge('season_s0_veteran'),
  ]);

  const hanaAlreadyCount = flowerUserIds.filter((id) => hanaHasSet.has(id)).length;
  const veteranAlreadyCount = veteranUserIds.filter((id) => veteranHasSet.has(id)).length;

  const hanaToGrant = flowerUserIds.filter((id) => !hanaHasSet.has(id));
  const veteranToGrant = veteranUserIds.filter((id) => !veteranHasSet.has(id));

  console.log(`🧾 S0花牌：候选 ${flowerUserIds.length} / 已拥有 ${hanaAlreadyCount} / 待发放 ${hanaToGrant.length}`);
  console.log(`🧾 S0历战：候选 ${veteranUserIds.length} / 已拥有 ${veteranAlreadyCount} / 待发放 ${veteranToGrant.length}`);
  console.log('');

  const summary = {
    dryRun,
    badges: {
      [BADGES[0].id]: { eligibleUsers: flowerUserIds.length, granted: 0, skippedHasBadge: 0, errors: 0 },
      [BADGES[1].id]: { eligibleUsers: veteranUserIds.length, granted: 0, skippedHasBadge: 0, errors: 0 },
    } as Record<string, { eligibleUsers: number; granted: number; skippedHasBadge: number; errors: number }>,
    badgeDefinition: {
      inserted: badgeInserted,
      updated: badgeUpdated,
      previewed: badgePreviewed,
      errors: badgeErrors,
    },
  };

  summary.badges['season_s0_hana'].skippedHasBadge = flowerUserIds.length - hanaToGrant.length;
  summary.badges['season_s0_veteran'].skippedHasBadge = veteranUserIds.length - veteranToGrant.length;

  if (dryRun) {
    hanaToGrant.slice(0, 40).forEach((userId) => {
      console.log(`[dry-run] 将授予徽章：season_s0_hana -> 用户 ${usernamesById.get(userId) ?? '-'}(${userId})`);
    });
    if (hanaToGrant.length > 40) console.log(`[dry-run] season_s0_hana 省略显示 ${hanaToGrant.length - 40} 个用户`);

    veteranToGrant.slice(0, 40).forEach((userId) => {
      console.log(`[dry-run] 将授予徽章：season_s0_veteran -> 用户 ${usernamesById.get(userId) ?? '-'}(${userId})`);
    });
    if (veteranToGrant.length > 40) console.log(`[dry-run] season_s0_veteran 省略显示 ${veteranToGrant.length - 40} 个用户`);

    summary.badges['season_s0_hana'].granted = hanaToGrant.length;
    summary.badges['season_s0_veteran'].granted = veteranToGrant.length;
  } else {
    const hanaResult = await grantBadgeBatch('season_s0_hana', hanaToGrant);
    const veteranResult = await grantBadgeBatch('season_s0_veteran', veteranToGrant);
    summary.badges['season_s0_hana'].granted = hanaResult.inserted;
    summary.badges['season_s0_hana'].errors = hanaResult.errors;
    summary.badges['season_s0_veteran'].granted = veteranResult.inserted;
    summary.badges['season_s0_veteran'].errors = veteranResult.errors;
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log('📊 发放统计');
  console.table(summary);

  if (summary.badgeDefinition.errors > 0) {
    process.exitCode = 1;
  }
  if (Object.values(summary.badges).some((b) => b.errors > 0)) {
    process.exitCode = 1;
  }
  if (dryRun) {
    console.log('Dry-run 模式：未对数据库进行任何修改。');
    console.log('如需执行写入，请运行：pnpm exec tsx scripts/badge/grant-season-s0-badges.ts --apply');
  }
}

main();
