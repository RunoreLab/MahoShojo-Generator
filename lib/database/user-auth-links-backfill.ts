type UnlinkedAuthUserRow = {
  id: string;
  email: string | null;
  name: string | null;
};

type BackfillBusinessUserRow = {
  id: number;
  username: string;
  email: string;
};

type ExistingBusinessLinkRow = {
  auth_user_id: string;
  business_user_id: number;
};

type UserAuthLinksBackfillRepoBundle = {
  db: unknown;
  listUnlinkedAuthUsers: (
    db: unknown,
    input: { afterId: string; limit: number },
  ) => Promise<UnlinkedAuthUserRow[]>;
  listBusinessUsersByEmailInsensitive: (
    db: unknown,
    email: string,
    limit?: number,
  ) => Promise<BackfillBusinessUserRow[]>;
  listBusinessUsersByUsernameInsensitive: (
    db: unknown,
    username: string,
    limit?: number,
  ) => Promise<BackfillBusinessUserRow[]>;
  getUserAuthLinkByBusinessUserId: (db: unknown, businessUserId: number) => Promise<any | null>;
  upsertUserAuthLink: (
    db: unknown,
    input: { authUserId: string; businessUserId: number },
  ) => Promise<any | null>;
};

const readUserAuthLinksBackfillRepoBundle = async (): Promise<UserAuthLinksBackfillRepoBundle | null> => {
  try {
    const [{ getDrizzleDbFromRuntime }, backfillRepo, userAuthLinksRepo] = await Promise.all([
      import('@/lib/db/drizzle'),
      import('@/lib/db/repositories/user-auth-links-backfill'),
      import('@/lib/db/repositories/user-auth-links'),
    ]);

    const db = getDrizzleDbFromRuntime();
    if (!db) return null;

    return {
      db,
      listUnlinkedAuthUsers:
        backfillRepo.listUnlinkedAuthUsers as UserAuthLinksBackfillRepoBundle['listUnlinkedAuthUsers'],
      listBusinessUsersByEmailInsensitive:
        backfillRepo.listBusinessUsersByEmailInsensitive as UserAuthLinksBackfillRepoBundle['listBusinessUsersByEmailInsensitive'],
      listBusinessUsersByUsernameInsensitive:
        backfillRepo.listBusinessUsersByUsernameInsensitive as UserAuthLinksBackfillRepoBundle['listBusinessUsersByUsernameInsensitive'],
      getUserAuthLinkByBusinessUserId:
        userAuthLinksRepo.getUserAuthLinkByBusinessUserId as UserAuthLinksBackfillRepoBundle['getUserAuthLinkByBusinessUserId'],
      upsertUserAuthLink:
        userAuthLinksRepo.upsertUserAuthLink as UserAuthLinksBackfillRepoBundle['upsertUserAuthLink'],
    };
  } catch {
    return null;
  }
};

const requireUserAuthLinksBackfillRepoBundle = async (): Promise<UserAuthLinksBackfillRepoBundle> => {
  const bundle = await readUserAuthLinksBackfillRepoBundle();
  if (bundle) return bundle;
  throw new Error('未检测到可用的 D1 连接，请检查 Cloudflare D1 配置或运行时绑定');
};

const toExistingLinkRow = (row: any): ExistingBusinessLinkRow | null => {
  if (!row || typeof row !== 'object') return null;
  const authUserId = typeof row.authUserId === 'string' ? row.authUserId : null;
  const businessUserId =
    typeof row.businessUserId === 'number' && Number.isFinite(row.businessUserId)
      ? Math.trunc(row.businessUserId)
      : null;
  if (!authUserId || !businessUserId) return null;
  return {
    auth_user_id: authUserId,
    business_user_id: businessUserId,
  };
};

export async function listUnlinkedAuthUsers(afterId: string, limit: number): Promise<UnlinkedAuthUserRow[]> {
  const bundle = await requireUserAuthLinksBackfillRepoBundle();
  return bundle.listUnlinkedAuthUsers(bundle.db, { afterId, limit });
}

export async function listBusinessUsersByEmailInsensitive(
  email: string,
  limit: number = 2,
): Promise<BackfillBusinessUserRow[]> {
  const bundle = await requireUserAuthLinksBackfillRepoBundle();
  return bundle.listBusinessUsersByEmailInsensitive(bundle.db, email, limit);
}

export async function listBusinessUsersByUsernameInsensitive(
  username: string,
  limit: number = 2,
): Promise<BackfillBusinessUserRow[]> {
  const bundle = await requireUserAuthLinksBackfillRepoBundle();
  return bundle.listBusinessUsersByUsernameInsensitive(bundle.db, username, limit);
}

export async function getExistingLinkByBusinessUserId(
  businessUserId: number,
): Promise<ExistingBusinessLinkRow | null> {
  const bundle = await requireUserAuthLinksBackfillRepoBundle();
  const row = await bundle.getUserAuthLinkByBusinessUserId(bundle.db, businessUserId);
  return toExistingLinkRow(row);
}

export async function upsertUserAuthLink(authUserId: string, businessUserId: number): Promise<void> {
  const bundle = await requireUserAuthLinksBackfillRepoBundle();
  await bundle.upsertUserAuthLink(bundle.db, { authUserId, businessUserId });
}

