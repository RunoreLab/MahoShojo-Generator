#!/usr/bin/env bun

import { runGrantExcellentReporter } from '@/lib/automation/badges/grant-excellent-reporter';
import { getReporterTierByBadgeId } from './reporter-rules';

const EXCELLENT_REPORTER_TIER = (() => {
  const tier = getReporterTierByBadgeId('excellent_reporter');
  if (!tier) throw new Error('缺少优秀记者档位配置：excellent_reporter');
  return tier;
})();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log(
    `开始授予 ${EXCELLENT_REPORTER_TIER.badgeId} 徽章并增加槽位...${dryRun ? ' (dry-run 模式)' : ''}`
  );
  console.log(
    `规则：累计获赞 ≥${EXCELLENT_REPORTER_TIER.minTotalLikes}，累计被收藏 ≥${EXCELLENT_REPORTER_TIER.minTotalFavorites}，累计使用量 ≥${EXCELLENT_REPORTER_TIER.minTotalUsage}（仅统计公开且通过审查的数据卡）`
  );
  console.log(`奖励：授予徽章 + 槽位 +${EXCELLENT_REPORTER_TIER.slotIncrement}`);

  try {
    const result = await runGrantExcellentReporter({
      dryRun,
      logger: console,
      verbose: true,
    });
    const ratio =
      result.summary.totalPublicUsers > 0 ? result.summary.eligibleUsers / result.summary.totalPublicUsers : 0;
    console.log(`公开且通过审查的发卡用户：${result.summary.totalPublicUsers}`);
    console.log(`本轮符合优秀记者条件的用户：${result.summary.eligibleUsers}（占比 ${(ratio * 100).toFixed(1)}%）`);

    if (result.summary.eligibleUsers === 0) {
      console.log('没有符合条件的用户，脚本结束。');
      return;
    }

    console.log('处理完成。');
    console.table(result.summary);

    if (dryRun) {
      console.log('Dry-run 模式：未对数据库进行任何修改。');
    }
  } catch (error) {
    console.error('脚本执行失败:', error);
    process.exit(1);
  }
}

main();
