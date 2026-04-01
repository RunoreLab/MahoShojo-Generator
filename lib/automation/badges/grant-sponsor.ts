import {
  listSponsorExcellentCandidates,
  listSponsorSlotCandidates,
} from '@/lib/database/badges-granting';
import { grantBadgeToUser, userHasBadge } from '@/lib/database/badges';
import { getReporterTierByBadgeId, type ReporterTierRule } from '@/scripts/badge/reporter-rules';

type CandidateSource = 'slotPositive' | 'excellentReporter';

type SponsorCandidate = {
  userId: number;
  username: string;
  slotCount: number;
  publicCards: number;
  sources: CandidateSource[];
};

type AutomationLogger = Pick<Console, 'log' | 'error'>;

type GrantSponsorDeps = {
  listSponsorSlotCandidates: (input: {
    excellentBadgeId: string;
    maxSlotCountWithExcellent: number;
  }) => Promise<Array<{ userId: number; username: string; slotCount: number }>>;
  listSponsorExcellentCandidates: (input: {
    minTotalLikes: number;
    minTotalFavorites: number;
    minTotalUsage: number;
    minSlotCountExclusive: number;
  }) => Promise<Array<{ userId: number; username: string; slotCount: number; publicCards: number }>>;
  userHasBadge: (userId: number, badgeId: string) => Promise<boolean>;
  grantBadgeToUser: (userId: number, badgeId: string) => Promise<boolean>;
};

export type GrantSponsorRunOptions = {
  dryRun?: boolean;
  logger?: AutomationLogger;
  verbose?: boolean;
};

export type GrantSponsorSummary = {
  totalCandidates: number;
  slotOnly: number;
  excellentOnly: number;
  bothSources: number;
  badgeGranted: number;
  skippedHasBadge: number;
  errors: number;
  dryRun: boolean;
};

export type GrantSponsorResult = {
  sponsorBadgeId: 'sponsor';
  excellentReporterRule: ReporterTierRule;
  summary: GrantSponsorSummary;
};

const EXCELLENT_REPORTER_TIER = (() => {
  const tier = getReporterTierByBadgeId('excellent_reporter');
  if (!tier) {
    throw new Error('缺少优秀记者档位配置：excellent_reporter');
  }
  return tier;
})();

const defaultLogger: AutomationLogger = {
  log: () => undefined,
  error: () => undefined,
};

const defaultGrantSponsorDeps: GrantSponsorDeps = {
  listSponsorSlotCandidates,
  listSponsorExcellentCandidates,
  userHasBadge,
  grantBadgeToUser,
};

const appendSource = (candidate: SponsorCandidate, source: CandidateSource): void => {
  if (!candidate.sources.includes(source)) {
    candidate.sources.push(source);
  }
};

const formatSources = (sources: CandidateSource[]): string =>
  sources
    .map((source) => {
      if (source === 'slotPositive') return '槽位大于 0';
      return `满足 excellent_reporter 标准且槽位大于 ${EXCELLENT_REPORTER_TIER.slotIncrement}`;
    })
    .join('、');

const collectCandidates = async (deps: GrantSponsorDeps): Promise<SponsorCandidate[]> => {
  const [slotUsers, excellentUsers] = await Promise.all([
    deps.listSponsorSlotCandidates({
      excellentBadgeId: EXCELLENT_REPORTER_TIER.badgeId,
      maxSlotCountWithExcellent: EXCELLENT_REPORTER_TIER.slotIncrement,
    }),
    deps.listSponsorExcellentCandidates({
      minTotalLikes: EXCELLENT_REPORTER_TIER.minTotalLikes,
      minTotalFavorites: EXCELLENT_REPORTER_TIER.minTotalFavorites,
      minTotalUsage: EXCELLENT_REPORTER_TIER.minTotalUsage,
      minSlotCountExclusive: EXCELLENT_REPORTER_TIER.slotIncrement,
    }),
  ]);

  const candidateMap = new Map<number, SponsorCandidate>();

  for (const user of slotUsers) {
    candidateMap.set(user.userId, {
      userId: user.userId,
      username: user.username,
      slotCount: user.slotCount,
      publicCards: 0,
      sources: ['slotPositive'],
    });
  }

  for (const user of excellentUsers) {
    const existing = candidateMap.get(user.userId);
    if (existing) {
      appendSource(existing, 'excellentReporter');
      existing.slotCount = user.slotCount;
      existing.publicCards = Math.max(existing.publicCards, user.publicCards);
      continue;
    }

    candidateMap.set(user.userId, {
      userId: user.userId,
      username: user.username,
      slotCount: user.slotCount,
      publicCards: user.publicCards,
      sources: ['excellentReporter'],
    });
  }

  return Array.from(candidateMap.values());
};

export const createGrantSponsorRunner =
  (overrides: Partial<GrantSponsorDeps> = {}) =>
  async (options: GrantSponsorRunOptions = {}): Promise<GrantSponsorResult> => {
    const deps: GrantSponsorDeps = {
      ...defaultGrantSponsorDeps,
      ...overrides,
    };
    const dryRun = options.dryRun === true;
    const logger = options.logger ?? defaultLogger;
    const verbose = options.verbose === true;
    const candidates = await collectCandidates(deps);

    const summary: GrantSponsorSummary = {
      totalCandidates: candidates.length,
      slotOnly: 0,
      excellentOnly: 0,
      bothSources: 0,
      badgeGranted: 0,
      skippedHasBadge: 0,
      errors: 0,
      dryRun,
    };

    for (const candidate of candidates) {
      const hasSlotSource = candidate.sources.includes('slotPositive');
      const hasExcellentSource = candidate.sources.includes('excellentReporter');

      if (hasSlotSource && hasExcellentSource) {
        summary.bothSources += 1;
      } else if (hasSlotSource) {
        summary.slotOnly += 1;
      } else {
        summary.excellentOnly += 1;
      }

      try {
        const alreadyHasBadge = await deps.userHasBadge(candidate.userId, 'sponsor');
        if (alreadyHasBadge) {
          summary.skippedHasBadge += 1;
          if (verbose) {
            logger.log(
              `${dryRun ? '[dry-run] ' : ''}用户 ${candidate.username} (ID: ${candidate.userId}) 已拥有 sponsor 徽章，来源：${formatSources(candidate.sources)}`,
            );
          }
          continue;
        }

        if (dryRun) {
          summary.badgeGranted += 1;
          if (verbose) {
            logger.log(
              `[dry-run] 用户 ${candidate.username} (ID: ${candidate.userId}) 将被授予 sponsor 徽章，来源：${formatSources(candidate.sources)}`,
            );
          }
          continue;
        }

        const granted = await deps.grantBadgeToUser(candidate.userId, 'sponsor');
        if (!granted) {
          summary.errors += 1;
          logger.error(
            `用户 ${candidate.username} (ID: ${candidate.userId}) 授予 sponsor 徽章失败，来源：${formatSources(candidate.sources)}`,
          );
          continue;
        }

        summary.badgeGranted += 1;

        if (verbose) {
          const extraInfo =
            candidate.sources.includes('excellentReporter') && candidate.publicCards > 0
              ? `，公开且通过审查的卡片数量：${candidate.publicCards}`
              : '';
          logger.log(
            `用户 ${candidate.username} (ID: ${candidate.userId}) 已成功授予 sponsor 徽章，来源：${formatSources(candidate.sources)}${extraInfo}`,
          );
        }
      } catch (error) {
        summary.errors += 1;
        logger.error(
          `处理用户 ${candidate.username} (ID: ${candidate.userId}) 时出错，来源：${formatSources(candidate.sources)}:`,
          error,
        );
      }
    }

    return {
      sponsorBadgeId: 'sponsor',
      excellentReporterRule: EXCELLENT_REPORTER_TIER,
      summary,
    };
  };

export const runGrantSponsor = createGrantSponsorRunner();
