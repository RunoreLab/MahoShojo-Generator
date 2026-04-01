#!/usr/bin/env bun

import { runGrantSponsor } from '@/lib/automation/badges/grant-sponsor';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log(`开始授予 sponsor 徽章${dryRun ? ' (dry-run 模式)' : ''}...`);

  try {
    const result = await runGrantSponsor({
      dryRun,
      logger: console,
      verbose: true,
    });
    console.log(`共找到 ${result.summary.totalCandidates} 位候选用户。`);

    if (result.summary.totalCandidates === 0) {
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
