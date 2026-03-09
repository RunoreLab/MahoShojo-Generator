type BadgeDefinitionInput = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string | null;
  rarity: number;
  sortOrder: number;
  isActive: boolean;
};

type ReporterTotalsRow = {
  userId: number;
  username: string;
  publicCards: number;
  totalLikes: number;
  totalFavorites: number;
  totalUsage: number;
};

type SponsorSlotCandidateRow = {
  userId: number;
  username: string;
  slotCount: number;
};

type SponsorExcellentCandidateRow = {
  userId: number;
  username: string;
  slotCount: number;
  publicCards: number;
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

type BatchGrantResult = {
  inserted: number;
  errors: number;
};

type BadgeGrantingRepoBundle = {
  db: unknown;
  countBadgesById: (db: unknown, badgeId: string) => Promise<number>;
  insertBadgeDefinition: (db: unknown, input: BadgeDefinitionInput) => Promise<boolean>;
  updateBadgeDefinition: (db: unknown, input: BadgeDefinitionInput) => Promise<boolean>;
  updateBadgeBasicStatus: (
    db: unknown,
    input: { id: string; name: string; description: string | null; isActive: boolean },
  ) => Promise<boolean>;
  countUsersWithPublicApprovedCards: (db: unknown) => Promise<number>;
  listUsersWithPublicApprovedCardTotals: (db: unknown) => Promise<ReporterTotalsRow[]>;
  listEligibleReporterUsers: (
    db: unknown,
    input: { minTotalLikes: number; minTotalFavorites: number; minTotalUsage: number },
  ) => Promise<ReporterTotalsRow[]>;
  getUserSlotCountById: (db: unknown, userId: number) => Promise<number>;
  listSponsorSlotCandidates: (
    db: unknown,
    input: { excellentBadgeId: string; maxSlotCountWithExcellent: number },
  ) => Promise<SponsorSlotCandidateRow[]>;
  listSponsorExcellentCandidates: (
    db: unknown,
    input: {
      minTotalLikes: number;
      minTotalFavorites: number;
      minTotalUsage: number;
      minSlotCountExclusive: number;
    },
  ) => Promise<SponsorExcellentCandidateRow[]>;
  listRatedCharactersByQueue: (db: unknown, queue: 'strict' | 'free') => Promise<RatedCharacterRow[]>;
  listUserIdsHavingBadge: (db: unknown, badgeId: string) => Promise<number[]>;
  grantBadgeToUsersInChunks: (
    db: unknown,
    input: { badgeId: string; userIds: number[]; chunkSize?: number },
  ) => Promise<BatchGrantResult>;
};

const readBadgeGrantingRepoBundle = async (): Promise<BadgeGrantingRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/badges-granting'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      countBadgesById: repo.countBadgesById as BadgeGrantingRepoBundle['countBadgesById'],
      insertBadgeDefinition: repo.insertBadgeDefinition as BadgeGrantingRepoBundle['insertBadgeDefinition'],
      updateBadgeDefinition: repo.updateBadgeDefinition as BadgeGrantingRepoBundle['updateBadgeDefinition'],
      updateBadgeBasicStatus: repo.updateBadgeBasicStatus as BadgeGrantingRepoBundle['updateBadgeBasicStatus'],
      countUsersWithPublicApprovedCards:
        repo.countUsersWithPublicApprovedCards as BadgeGrantingRepoBundle['countUsersWithPublicApprovedCards'],
      listUsersWithPublicApprovedCardTotals:
        repo.listUsersWithPublicApprovedCardTotals as BadgeGrantingRepoBundle['listUsersWithPublicApprovedCardTotals'],
      listEligibleReporterUsers:
        repo.listEligibleReporterUsers as BadgeGrantingRepoBundle['listEligibleReporterUsers'],
      getUserSlotCountById: repo.getUserSlotCountById as BadgeGrantingRepoBundle['getUserSlotCountById'],
      listSponsorSlotCandidates:
        repo.listSponsorSlotCandidates as BadgeGrantingRepoBundle['listSponsorSlotCandidates'],
      listSponsorExcellentCandidates:
        repo.listSponsorExcellentCandidates as BadgeGrantingRepoBundle['listSponsorExcellentCandidates'],
      listRatedCharactersByQueue:
        repo.listRatedCharactersByQueue as BadgeGrantingRepoBundle['listRatedCharactersByQueue'],
      listUserIdsHavingBadge: repo.listUserIdsHavingBadge as BadgeGrantingRepoBundle['listUserIdsHavingBadge'],
      grantBadgeToUsersInChunks:
        repo.grantBadgeToUsersInChunks as BadgeGrantingRepoBundle['grantBadgeToUsersInChunks'],
    };
  } catch {
    return null;
  }
};

const requireBadgeGrantingRepoBundle = async (): Promise<BadgeGrantingRepoBundle> => {
  const bundle = await readBadgeGrantingRepoBundle();
  if (bundle) return bundle;
  throw new Error('未检测到可用的 D1 连接，请检查 Cloudflare D1 配置或运行时绑定');
};

export async function countBadgesById(badgeId: string): Promise<number> {
  const bundle = await requireBadgeGrantingRepoBundle();
  return bundle.countBadgesById(bundle.db, badgeId);
}

export async function insertBadgeDefinition(input: BadgeDefinitionInput): Promise<boolean> {
  const bundle = await requireBadgeGrantingRepoBundle();
  return bundle.insertBadgeDefinition(bundle.db, input);
}

export async function updateBadgeDefinition(input: BadgeDefinitionInput): Promise<boolean> {
  const bundle = await requireBadgeGrantingRepoBundle();
  return bundle.updateBadgeDefinition(bundle.db, input);
}

export async function updateBadgeBasicStatus(input: {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}): Promise<boolean> {
  const bundle = await requireBadgeGrantingRepoBundle();
  return bundle.updateBadgeBasicStatus(bundle.db, input);
}

export async function countUsersWithPublicApprovedCards(): Promise<number> {
  const bundle = await requireBadgeGrantingRepoBundle();
  return bundle.countUsersWithPublicApprovedCards(bundle.db);
}

export async function listUsersWithPublicApprovedCardTotals(): Promise<ReporterTotalsRow[]> {
  const bundle = await requireBadgeGrantingRepoBundle();
  return bundle.listUsersWithPublicApprovedCardTotals(bundle.db);
}

export async function listEligibleReporterUsers(input: {
  minTotalLikes: number;
  minTotalFavorites: number;
  minTotalUsage: number;
}): Promise<ReporterTotalsRow[]> {
  const bundle = await requireBadgeGrantingRepoBundle();
  return bundle.listEligibleReporterUsers(bundle.db, input);
}

export async function getUserSlotCountById(userId: number): Promise<number> {
  const bundle = await requireBadgeGrantingRepoBundle();
  return bundle.getUserSlotCountById(bundle.db, userId);
}

export async function listSponsorSlotCandidates(input: {
  excellentBadgeId: string;
  maxSlotCountWithExcellent: number;
}): Promise<SponsorSlotCandidateRow[]> {
  const bundle = await requireBadgeGrantingRepoBundle();
  return bundle.listSponsorSlotCandidates(bundle.db, input);
}

export async function listSponsorExcellentCandidates(input: {
  minTotalLikes: number;
  minTotalFavorites: number;
  minTotalUsage: number;
  minSlotCountExclusive: number;
}): Promise<SponsorExcellentCandidateRow[]> {
  const bundle = await requireBadgeGrantingRepoBundle();
  return bundle.listSponsorExcellentCandidates(bundle.db, input);
}

export async function listRatedCharactersByQueue(queue: 'strict' | 'free'): Promise<RatedCharacterRow[]> {
  const bundle = await requireBadgeGrantingRepoBundle();
  return bundle.listRatedCharactersByQueue(bundle.db, queue);
}

export async function listUserIdsHavingBadge(badgeId: string): Promise<number[]> {
  const bundle = await requireBadgeGrantingRepoBundle();
  return bundle.listUserIdsHavingBadge(bundle.db, badgeId);
}

export async function grantBadgeToUsersInChunks(input: {
  badgeId: string;
  userIds: number[];
  chunkSize?: number;
}): Promise<BatchGrantResult> {
  const bundle = await requireBadgeGrantingRepoBundle();
  return bundle.grantBadgeToUsersInChunks(bundle.db, input);
}
