#!/usr/bin/env -S pnpm exec tsx

import {
  listSponsorExcellentCandidates,
  listSponsorSlotCandidates,
} from '@/lib/database/badges-granting';
import { grantBadgeToUser, userHasBadge } from '@/lib/database/badges';
import { getReporterTierByBadgeId } from './reporter-rules';

type CandidateSource = 'slot_positive' | 'excellent_reporter';

const EXCELLENT_REPORTER_TIER = (() => {
  const tier = getReporterTierByBadgeId('excellent_reporter');
  if (!tier) throw new Error('缺少优秀记者档位配置：excellent_reporter');
  return tier;
})();

interface SlotCandidate {
  user_id: number;
  username: string;
  slot_count: number;
}

interface ExcellentCandidate extends SlotCandidate {
  public_cards: number;
}

interface SponsorCandidate {
  userId: number;
  username: string;
  slotCount: number;
  publicCards: number;
  sources: CandidateSource[];
}

function appendSource(candidate: SponsorCandidate, source: CandidateSource) {
  if (!candidate.sources.includes(source)) {
    candidate.sources.push(source);
  }
}

function formatSources(sources: CandidateSource[]): string {
  return sources
    .map(source => {
      if (source === 'slot_positive') return '槽位大于 0';
      return `满足 excellent_reporter 标准且槽位大于 ${EXCELLENT_REPORTER_TIER.slotIncrement}`;
    })
    .join('、');
}

async function findUsersWithSlot(): Promise<SlotCandidate[]> {
  const rows = await listSponsorSlotCandidates({
    excellentBadgeId: EXCELLENT_REPORTER_TIER.badgeId,
    maxSlotCountWithExcellent: EXCELLENT_REPORTER_TIER.slotIncrement,
  });

  return rows.map((row) => ({
    user_id: row.userId,
    username: row.username,
    slot_count: row.slotCount,
  }));
}

async function findExcellentReporterUsers(): Promise<ExcellentCandidate[]> {
  const rows = await listSponsorExcellentCandidates({
    minTotalLikes: EXCELLENT_REPORTER_TIER.minTotalLikes,
    minTotalFavorites: EXCELLENT_REPORTER_TIER.minTotalFavorites,
    minTotalUsage: EXCELLENT_REPORTER_TIER.minTotalUsage,
    minSlotCountExclusive: EXCELLENT_REPORTER_TIER.slotIncrement,
  });

  return rows.map((row) => ({
    user_id: row.userId,
    username: row.username,
    slot_count: row.slotCount,
    public_cards: row.publicCards,
  }));
}

async function collectCandidates(): Promise<SponsorCandidate[]> {
  const slotUsers = await findUsersWithSlot();
  const excellentUsers = await findExcellentReporterUsers();
  const candidateMap = new Map<number, SponsorCandidate>();

  for (const user of slotUsers) {
    candidateMap.set(user.user_id, {
      userId: user.user_id,
      username: user.username,
      slotCount: user.slot_count,
      publicCards: 0,
      sources: ['slot_positive']
    });
  }

  for (const user of excellentUsers) {
    const existing = candidateMap.get(user.user_id);
    if (existing) {
      appendSource(existing, 'excellent_reporter');
      existing.slotCount = user.slot_count;
      existing.publicCards = Math.max(existing.publicCards, user.public_cards);
    } else {
      candidateMap.set(user.user_id, {
        userId: user.user_id,
        username: user.username,
        slotCount: user.slot_count,
        publicCards: user.public_cards,
        sources: ['excellent_reporter']
      });
    }
  }

  return Array.from(candidateMap.values());
}

interface ProcessSummary {
  totalCandidates: number;
  slotOnly: number;
  excellentOnly: number;
  bothSources: number;
  badgeGranted: number;
  skippedHasBadge: number;
  errors: number;
  dryRun: boolean;
}

async function processCandidates(candidates: SponsorCandidate[], dryRun: boolean): Promise<ProcessSummary> {
  const summary: ProcessSummary = {
    totalCandidates: candidates.length,
    slotOnly: 0,
    excellentOnly: 0,
    bothSources: 0,
    badgeGranted: 0,
    skippedHasBadge: 0,
    errors: 0,
    dryRun
  };

  for (const candidate of candidates) {
    const hasSlotSource = candidate.sources.includes('slot_positive');
    const hasExcellentSource = candidate.sources.includes('excellent_reporter');

    if (hasSlotSource && hasExcellentSource) {
      summary.bothSources += 1;
    } else if (hasSlotSource) {
      summary.slotOnly += 1;
    } else {
      summary.excellentOnly += 1;
    }

    try {
      const alreadyHasBadge = await userHasBadge(candidate.userId, 'sponsor');

      if (alreadyHasBadge) {
        summary.skippedHasBadge += 1;
        console.log(
          `${dryRun ? '[dry-run] ' : ''}用户 ${candidate.username} (ID: ${candidate.userId}) 已拥有 sponsor 徽章，来源：${formatSources(candidate.sources)}`
        );
        continue;
      }

      if (dryRun) {
        summary.badgeGranted += 1;
        console.log(
          `[dry-run] 用户 ${candidate.username} (ID: ${candidate.userId}) 将被授予 sponsor 徽章，来源：${formatSources(candidate.sources)}`
        );
        continue;
      }

      const granted = await grantBadgeToUser(candidate.userId, 'sponsor');
      if (granted) {
        summary.badgeGranted += 1;
        const extraInfo =
          candidate.sources.includes('excellent_reporter') && candidate.publicCards > 0
            ? `，公开且通过审查的卡片数量：${candidate.publicCards}`
            : '';
        console.log(
          `用户 ${candidate.username} (ID: ${candidate.userId}) 已成功授予 sponsor 徽章，来源：${formatSources(candidate.sources)}${extraInfo}`
        );
      } else {
        summary.errors += 1;
        console.error(
          `用户 ${candidate.username} (ID: ${candidate.userId}) 授予 sponsor 徽章失败，来源：${formatSources(candidate.sources)}`
        );
      }
    } catch (error) {
      summary.errors += 1;
      console.error(
        `处理用户 ${candidate.username} (ID: ${candidate.userId}) 时出错，来源：${formatSources(candidate.sources)}:`,
        error
      );
    }
  }

  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log(`开始授予 sponsor 徽章${dryRun ? ' (dry-run 模式)' : ''}...`);

  try {
    const candidates = await collectCandidates();
    console.log(`共找到 ${candidates.length} 位候选用户。`);

    if (candidates.length === 0) {
      console.log('没有符合条件的用户，脚本结束。');
      return;
    }

    const summary = await processCandidates(candidates, dryRun);

    console.log('处理完成。');
    console.table(summary);

    if (dryRun) {
      console.log('Dry-run 模式：未对数据库进行任何修改。');
    }
  } catch (error) {
    console.error('脚本执行失败:', error);
    process.exit(1);
  }
}

main();
