import {
  countUsersWithPublicApprovedCards as countUsersWithPublicApprovedCardsFromRepo,
  getUserSlotCountById,
  listEligibleReporterUsers,
} from '@/lib/database/badges-granting';
import { grantBadgeToUser, userHasBadge } from '@/lib/database/badges';
import { increaseUserSlotCount } from '@/lib/database/users';
import { getReporterTierByBadgeId, type ReporterTierRule } from '@/scripts/badge/reporter-rules';

type EligibleUser = {
  userId: number;
  username: string;
  publicCards: number;
  totalLikes: number;
  totalFavorites: number;
  totalUsage: number;
};

type AutomationLogger = Pick<Console, 'log' | 'error'>;

type GrantExcellentReporterDeps = {
  countUsersWithPublicApprovedCards: () => Promise<number>;
  listEligibleReporterUsers: (input: {
    minTotalLikes: number;
    minTotalFavorites: number;
    minTotalUsage: number;
  }) => Promise<Array<{ userId: number; username: string; publicCards: number; totalLikes: number; totalFavorites: number; totalUsage: number }>>;
  getUserSlotCountById: (userId: number) => Promise<number>;
  userHasBadge: (userId: number, badgeId: string) => Promise<boolean>;
  grantBadgeToUser: (userId: number, badgeId: string) => Promise<boolean>;
  increaseUserSlotCount: (userId: number, increaseBy: number) => Promise<boolean>;
};

export type GrantExcellentReporterRunOptions = {
  dryRun?: boolean;
  logger?: AutomationLogger;
  verbose?: boolean;
};

export type GrantExcellentReporterSummary = {
  totalPublicUsers: number;
  eligibleUsers: number;
  badgeGranted: number;
  slotIncreased: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
};

export type GrantExcellentReporterResult = {
  rule: ReporterTierRule;
  summary: GrantExcellentReporterSummary;
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

const defaultGrantExcellentReporterDeps: GrantExcellentReporterDeps = {
  countUsersWithPublicApprovedCards: countUsersWithPublicApprovedCardsFromRepo,
  listEligibleReporterUsers,
  getUserSlotCountById,
  userHasBadge,
  grantBadgeToUser,
  increaseUserSlotCount,
};

const findEligibleUsers = async (deps: GrantExcellentReporterDeps): Promise<EligibleUser[]> => {
  const rows = await deps.listEligibleReporterUsers({
    minTotalLikes: EXCELLENT_REPORTER_TIER.minTotalLikes,
    minTotalFavorites: EXCELLENT_REPORTER_TIER.minTotalFavorites,
    minTotalUsage: EXCELLENT_REPORTER_TIER.minTotalUsage,
  });

  return rows.map((row) => ({
    userId: row.userId,
    username: row.username,
    publicCards: row.publicCards,
    totalLikes: row.totalLikes,
    totalFavorites: row.totalFavorites,
    totalUsage: row.totalUsage,
  }));
};

export const createGrantExcellentReporterRunner =
  (overrides: Partial<GrantExcellentReporterDeps> = {}) =>
  async (options: GrantExcellentReporterRunOptions = {}): Promise<GrantExcellentReporterResult> => {
    const deps: GrantExcellentReporterDeps = {
      ...defaultGrantExcellentReporterDeps,
      ...overrides,
    };
    const dryRun = options.dryRun === true;
    const logger = options.logger ?? defaultLogger;
    const verbose = options.verbose === true;

    const totalPublicUsers = await deps.countUsersWithPublicApprovedCards();
    const eligibleUsers = await findEligibleUsers(deps);
    const summary: GrantExcellentReporterSummary = {
      totalPublicUsers,
      eligibleUsers: eligibleUsers.length,
      badgeGranted: 0,
      slotIncreased: 0,
      skipped: 0,
      errors: 0,
      dryRun,
    };

    for (const user of eligibleUsers) {
      try {
        const alreadyHasBadge = await deps.userHasBadge(user.userId, EXCELLENT_REPORTER_TIER.badgeId);
        const beforeSlot = await deps.getUserSlotCountById(user.userId);

        if (dryRun) {
          if (alreadyHasBadge) {
            summary.skipped += 1;
            if (verbose) {
              logger.log(`[dry-run] 用户 ${user.username} (ID: ${user.userId}) 已拥有徽章，跳过授予和槽位增加`);
            }
          } else {
            summary.badgeGranted += 1;
            summary.slotIncreased += 1;
            if (verbose) {
              logger.log(
                `[dry-run] 用户 ${user.username} (ID: ${user.userId}) 将被授予徽章，槽位 ${beforeSlot} -> ${
                  beforeSlot + EXCELLENT_REPORTER_TIER.slotIncrement
                }`,
              );
            }
          }
          continue;
        }

        if (alreadyHasBadge) {
          summary.skipped += 1;
          if (verbose) {
            logger.log(`用户 ${user.username} (ID: ${user.userId}) 已拥有徽章，跳过授予和槽位变更`);
          }
          continue;
        }

        const granted = await deps.grantBadgeToUser(user.userId, EXCELLENT_REPORTER_TIER.badgeId);
        if (!granted) {
          summary.errors += 1;
          logger.error(`授予用户 ${user.username} (ID: ${user.userId}) 徽章失败，已跳过槽位增加`);
          continue;
        }

        summary.badgeGranted += 1;

        const increased = await deps.increaseUserSlotCount(user.userId, EXCELLENT_REPORTER_TIER.slotIncrement);
        if (!increased) {
          summary.errors += 1;
          logger.error(`用户 ${user.username} (ID: ${user.userId}) 槽位增加失败`);
          continue;
        }

        summary.slotIncreased += 1;

        if (verbose) {
          const afterSlot = await deps.getUserSlotCountById(user.userId);
          logger.log(`用户 ${user.username} (ID: ${user.userId}) 已处理：授予徽章，槽位 ${beforeSlot} -> ${afterSlot}`);
        }
      } catch (error) {
        summary.errors += 1;
        logger.error(`处理用户 ${user.username} (ID: ${user.userId}) 时出错:`, error);
      }
    }

    return {
      rule: EXCELLENT_REPORTER_TIER,
      summary,
    };
  };

export const runGrantExcellentReporter = createGrantExcellentReporterRunner();
