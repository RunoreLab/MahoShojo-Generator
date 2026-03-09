type BadgeMaintenanceDefinitionInput = {
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

type BadgeMaintenanceUserWithPrefixRow = {
  id: number;
  username: string;
  prefix: string;
};

type BadgeMaintenanceActiveBadgeRow = {
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

type BadgeMaintenanceRepoBundle = {
  db: unknown;
  listExistingBadgeIds: (db: unknown, badgeIds: string[]) => Promise<string[]>;
  upsertBadgeDefinition: (db: unknown, input: BadgeMaintenanceDefinitionInput) => Promise<void>;
  listUsersWithPrefix: (db: unknown) => Promise<BadgeMaintenanceUserWithPrefixRow[]>;
  listActiveBadges: (db: unknown) => Promise<BadgeMaintenanceActiveBadgeRow[]>;
  hasUserBadge: (db: unknown, input: { userId: number; badgeId: string }) => Promise<boolean>;
  grantUserBadge: (
    db: unknown,
    input: { userId: number; badgeId: string; displayOrder: number; isEquipped: boolean },
  ) => Promise<void>;
};

const readBadgeMaintenanceRepoBundle = async (): Promise<BadgeMaintenanceRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, repo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/badges-maintenance'),
    ]);
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      listExistingBadgeIds: repo.listExistingBadgeIds as BadgeMaintenanceRepoBundle['listExistingBadgeIds'],
      upsertBadgeDefinition: repo.upsertBadgeDefinition as BadgeMaintenanceRepoBundle['upsertBadgeDefinition'],
      listUsersWithPrefix: repo.listUsersWithPrefix as BadgeMaintenanceRepoBundle['listUsersWithPrefix'],
      listActiveBadges: repo.listActiveBadges as BadgeMaintenanceRepoBundle['listActiveBadges'],
      hasUserBadge: repo.hasUserBadge as BadgeMaintenanceRepoBundle['hasUserBadge'],
      grantUserBadge: repo.grantUserBadge as BadgeMaintenanceRepoBundle['grantUserBadge'],
    };
  } catch {
    return null;
  }
};

const requireBadgeMaintenanceRepoBundle = async (): Promise<BadgeMaintenanceRepoBundle> => {
  const bundle = await readBadgeMaintenanceRepoBundle();
  if (bundle) return bundle;
  throw new Error('未检测到可用的 D1 连接，请检查 Cloudflare D1 配置或运行时绑定');
};

export async function listExistingBadgeIds(badgeIds: string[]): Promise<string[]> {
  const bundle = await requireBadgeMaintenanceRepoBundle();
  return bundle.listExistingBadgeIds(bundle.db, badgeIds);
}

export async function upsertBadgeDefinition(input: BadgeMaintenanceDefinitionInput): Promise<void> {
  const bundle = await requireBadgeMaintenanceRepoBundle();
  await bundle.upsertBadgeDefinition(bundle.db, input);
}

export async function listUsersWithPrefix(): Promise<BadgeMaintenanceUserWithPrefixRow[]> {
  const bundle = await requireBadgeMaintenanceRepoBundle();
  return bundle.listUsersWithPrefix(bundle.db);
}

export async function listActiveBadges(): Promise<BadgeMaintenanceActiveBadgeRow[]> {
  const bundle = await requireBadgeMaintenanceRepoBundle();
  return bundle.listActiveBadges(bundle.db);
}

export async function hasUserBadge(input: { userId: number; badgeId: string }): Promise<boolean> {
  const bundle = await requireBadgeMaintenanceRepoBundle();
  return bundle.hasUserBadge(bundle.db, input);
}

export async function grantUserBadge(input: {
  userId: number;
  badgeId: string;
  displayOrder: number;
  isEquipped: boolean;
}): Promise<void> {
  const bundle = await requireBadgeMaintenanceRepoBundle();
  await bundle.grantUserBadge(bundle.db, input);
}
