#!/usr/bin/env bun

/**
 * 记者类徽章定义同步脚本
 *
 * 功能：
 * - 更新/创建：优秀记者、热门记者、资深记者、王牌记者、首席记者 等徽章定义
 *
 * 使用：
 * - bun run scripts/badge/upsert-reporter-badges.ts
 * - bun run scripts/badge/upsert-reporter-badges.ts --dry-run
 */

import { queryFromD1 } from '@/lib/database/core';
import { REPORTER_BADGE_DEFINITIONS } from './reporter-rules';

const LEGACY_DUPLICATE_BADGE_ID = 'great_journalist';

async function badgeExists(id: string): Promise<boolean> {
  const res = await queryFromD1('SELECT COUNT(*) as count FROM badges WHERE id = ?', [id]);
  const row = (res as any).result?.[0]?.results?.[0];
  return Number(row?.count ?? 0) > 0;
}

async function insertBadge(def: (typeof REPORTER_BADGE_DEFINITIONS)[number]): Promise<boolean> {
  const res = await queryFromD1(
    `INSERT INTO badges (
      id,
      name,
      description,
      icon,
      text_color,
      background_color,
      border_color,
      rarity,
      sort_order,
      is_active
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

  return Boolean((res as any).success);
}

async function updateBadge(def: (typeof REPORTER_BADGE_DEFINITIONS)[number]): Promise<boolean> {
  const res = await queryFromD1(
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

  return Boolean((res as any).success);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('📰 记者类徽章定义同步');
  console.log(`模式: ${dryRun ? 'dry-run（仅预览）' : '执行（写入数据库）'}`);
  console.log(`徽章数量: ${REPORTER_BADGE_DEFINITIONS.length}`);
  console.log('');

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let legacyDeactivated = 0;
  let errors = 0;

  for (const def of REPORTER_BADGE_DEFINITIONS) {
    try {
      const exists = await badgeExists(def.id);

      if (dryRun) {
        console.log(`[dry-run] ${exists ? '更新' : '新增'}徽章：${def.id}（${def.name}）`);
        skipped += 1;
        continue;
      }

      if (exists) {
        const ok = await updateBadge(def);
        if (ok) {
          console.log(`✅ 更新徽章：${def.id}（${def.name}）`);
          updated += 1;
        } else {
          console.log(`❌ 更新失败：${def.id}（${def.name}）`);
          errors += 1;
        }
        continue;
      }

      const ok = await insertBadge(def);
      if (ok) {
        console.log(`✅ 新增徽章：${def.id}（${def.name}）`);
        inserted += 1;
      } else {
        console.log(`❌ 新增失败：${def.id}（${def.name}）`);
        errors += 1;
      }
    } catch (error) {
      console.error(`❌ 处理徽章 ${def.id} 时出错:`, error);
      errors += 1;
    }
  }

  try {
    const legacyExists = await badgeExists(LEGACY_DUPLICATE_BADGE_ID);
    if (legacyExists) {
      if (dryRun) {
        console.log(`[dry-run] 将停用历史重复徽章：${LEGACY_DUPLICATE_BADGE_ID}`);
      } else {
        const res = await queryFromD1(
          `UPDATE badges SET name = ?, description = ?, is_active = 0 WHERE id = ?`,
          ['优秀记者（停用）', '历史重复徽章（已停用），请使用 excellent_reporter。', LEGACY_DUPLICATE_BADGE_ID],
        );
        if ((res as any).success) {
          console.log(`✅ 已停用历史重复徽章：${LEGACY_DUPLICATE_BADGE_ID}`);
          legacyDeactivated += 1;
        } else {
          console.log(`❌ 停用失败：${LEGACY_DUPLICATE_BADGE_ID}`);
          errors += 1;
        }
      }
    }
  } catch (error) {
    console.error(`❌ 处理历史重复徽章 ${LEGACY_DUPLICATE_BADGE_ID} 时出错:`, error);
    errors += 1;
  }

  console.log('');
  console.log('━'.repeat(60));
  console.log('📊 同步统计');
  console.log(`新增: ${inserted}`);
  console.log(`更新: ${updated}`);
  console.log(`预览: ${skipped}`);
  console.log(`停用历史重复徽章: ${legacyDeactivated}`);
  console.log(`错误: ${errors}`);

  if (errors > 0) {
    process.exitCode = 1;
  }
}

main();
