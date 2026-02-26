#!/usr/bin/env bun

import { loadEnvConfig } from '@next/env';

import { queryFromD1 } from '@/lib/database/core';

type CliOptions = {
  dryRun: boolean;
  batchSize: number;
  limit: number | null;
  startAfterId: string;
  verbose: boolean;
};

type AuthUserRow = {
  id: string;
  email: string | null;
  name: string | null;
};

type BusinessUserRow = {
  id: number;
  username: string;
  email: string;
};

type ExistingBusinessLinkRow = {
  auth_user_id: string;
  business_user_id: number;
};

type D1RowsResult<T> = {
  result?: Array<{ results?: T[] }>;
};

type Stats = {
  scanned: number;
  linked: number;
  wouldLink: number;
  matchedByEmail: number;
  matchedByUsername: number;
  skippedNoCandidate: number;
  skippedAmbiguous: number;
  skippedAlreadyLinkedBusiness: number;
  skippedInvalid: number;
  errors: number;
};

const readRows = <T,>(result: unknown): T[] => {
  const rows = (result as D1RowsResult<T>)?.result?.[0]?.results;
  return Array.isArray(rows) ? rows : [];
};

const hasD1Config = (): boolean => {
  return Boolean(process.env.D1_DATABASE_ID && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
};

const parseArgs = (argv: string[]) => {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
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
      i += 1;
      continue;
    }
    args.set(key, '1');
  }
  return args;
};

const parsePositiveInt = (value: string | undefined): number | null => {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
};

const parseBool = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value == null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
  return defaultValue;
};

const parseOptions = (argv: string[]): CliOptions => {
  const args = parseArgs(argv);
  const dryRunFromWriteFlag = args.has('--write') ? false : true;
  return {
    dryRun: parseBool(args.get('--dry-run'), dryRunFromWriteFlag),
    batchSize: parsePositiveInt(args.get('--batch')) ?? 200,
    limit: parsePositiveInt(args.get('--limit')),
    startAfterId: (args.get('--start-after') ?? '').trim(),
    verbose: parseBool(args.get('--verbose'), false),
  };
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeEmail = (value: unknown): string | null => {
  const email = toNonEmptyString(value);
  if (!email) return null;
  return email.toLowerCase();
};

const normalizeUsername = (value: unknown): string | null => {
  const username = toNonEmptyString(value);
  if (!username) return null;
  return username;
};

const fetchUnlinkedAuthUsers = async (afterId: string, batchSize: number): Promise<AuthUserRow[]> => {
  const result = await queryFromD1(
    `
      SELECT u.id, u.email, u.name
      FROM ba_user u
      LEFT JOIN user_auth_links l ON l.auth_user_id = u.id
      WHERE l.id IS NULL
        AND u.id > ?
      ORDER BY u.id ASC
      LIMIT ?
    `,
    [afterId, batchSize],
  );

  return readRows<AuthUserRow>(result);
};

const findBusinessUsersByEmail = async (email: string): Promise<BusinessUserRow[]> => {
  const result = await queryFromD1(
    `
      SELECT id, username, email
      FROM users
      WHERE lower(email) = lower(?)
      ORDER BY id ASC
      LIMIT 2
    `,
    [email],
  );
  return readRows<BusinessUserRow>(result);
};

const findBusinessUsersByUsername = async (username: string): Promise<BusinessUserRow[]> => {
  const result = await queryFromD1(
    `
      SELECT id, username, email
      FROM users
      WHERE lower(username) = lower(?)
      ORDER BY id ASC
      LIMIT 2
    `,
    [username],
  );
  return readRows<BusinessUserRow>(result);
};

const getExistingLinkByBusinessUserId = async (businessUserId: number): Promise<ExistingBusinessLinkRow | null> => {
  const result = await queryFromD1(
    `
      SELECT auth_user_id, business_user_id
      FROM user_auth_links
      WHERE business_user_id = ?
      LIMIT 1
    `,
    [businessUserId],
  );

  const rows = readRows<ExistingBusinessLinkRow>(result);
  return rows[0] ?? null;
};

const upsertUserAuthLink = async (authUserId: string, businessUserId: number): Promise<void> => {
  await queryFromD1(
    `
      INSERT INTO user_auth_links (auth_user_id, business_user_id, created_at, updated_at)
      VALUES (?, ?, unixepoch(), unixepoch())
      ON CONFLICT(auth_user_id) DO UPDATE SET
        business_user_id = excluded.business_user_id,
        updated_at = unixepoch()
    `,
    [authUserId, businessUserId],
  );
};

const logVerbose = (enabled: boolean, message: string, data?: unknown) => {
  if (!enabled) return;
  if (data === undefined) {
    console.log(message);
    return;
  }
  console.log(message, data);
};

const initStats = (): Stats => ({
  scanned: 0,
  linked: 0,
  wouldLink: 0,
  matchedByEmail: 0,
  matchedByUsername: 0,
  skippedNoCandidate: 0,
  skippedAmbiguous: 0,
  skippedAlreadyLinkedBusiness: 0,
  skippedInvalid: 0,
  errors: 0,
});

async function main() {
  loadEnvConfig(process.cwd(), true);

  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
回填 user_auth_links（email 优先，username 兜底）

用法：
  bun scripts/backfill-user-auth-links.ts [options]

Options：
  --write                  写入数据库（默认 dry-run）
  --dry-run <bool>         显式指定 dry-run（true/false）
  --batch <n>              每批处理数量（默认 200）
  --limit <n>              最多处理 n 个未建链 auth 用户
  --start-after <authId>   仅处理 auth_user_id > 指定值（断点续跑）
  --verbose                输出详细跳过原因
`);
    return;
  }

  if (!hasD1Config()) {
    throw new Error('缺少 Cloudflare D1 配置：CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID');
  }

  const options = parseOptions(argv);
  const stats = initStats();
  let cursor = options.startAfterId;

  console.log('[backfill-user-auth-links] 开始执行...');
  console.log(
    JSON.stringify(
      {
        dryRun: options.dryRun,
        batchSize: options.batchSize,
        limit: options.limit ?? 'unlimited',
        startAfterId: options.startAfterId || '(none)',
        verbose: options.verbose,
      },
      null,
      2,
    ),
  );

  while (true) {
    const remaining = options.limit == null ? options.batchSize : Math.max(0, options.limit - stats.scanned);
    if (remaining === 0) break;

    const batchSize = Math.min(options.batchSize, remaining);
    const authUsers = await fetchUnlinkedAuthUsers(cursor, batchSize);
    if (authUsers.length === 0) break;

    for (const authUser of authUsers) {
      stats.scanned += 1;
      cursor = authUser.id;

      const authUserId = toNonEmptyString(authUser.id);
      const email = normalizeEmail(authUser.email);
      const username = normalizeUsername(authUser.name);

      if (!authUserId || (!email && !username)) {
        stats.skippedInvalid += 1;
        logVerbose(options.verbose, '[skip-invalid]', { authUserId: authUser.id, email: authUser.email, name: authUser.name });
        continue;
      }

      let selected: BusinessUserRow | null = null;
      let matchedBy: 'email' | 'username' | null = null;

      if (email) {
        const emailCandidates = await findBusinessUsersByEmail(email);
        if (emailCandidates.length > 1) {
          stats.skippedAmbiguous += 1;
          logVerbose(options.verbose, '[skip-ambiguous-email]', { authUserId, email, candidates: emailCandidates.map((c) => c.id) });
          continue;
        }
        if (emailCandidates.length === 1) {
          selected = emailCandidates[0] ?? null;
          matchedBy = 'email';
        }
      }

      if (!selected && username) {
        const usernameCandidates = await findBusinessUsersByUsername(username);
        if (usernameCandidates.length > 1) {
          stats.skippedAmbiguous += 1;
          logVerbose(options.verbose, '[skip-ambiguous-username]', {
            authUserId,
            username,
            candidates: usernameCandidates.map((c) => c.id),
          });
          continue;
        }
        if (usernameCandidates.length === 1) {
          selected = usernameCandidates[0] ?? null;
          matchedBy = 'username';
        }
      }

      if (!selected || !matchedBy) {
        stats.skippedNoCandidate += 1;
        logVerbose(options.verbose, '[skip-no-candidate]', { authUserId, email, username });
        continue;
      }

      const existingLink = await getExistingLinkByBusinessUserId(selected.id);
      if (existingLink && existingLink.auth_user_id !== authUserId) {
        stats.skippedAlreadyLinkedBusiness += 1;
        logVerbose(options.verbose, '[skip-business-already-linked]', {
          authUserId,
          matchedBusinessUserId: selected.id,
          existingAuthUserId: existingLink.auth_user_id,
        });
        continue;
      }

      if (matchedBy === 'email') {
        stats.matchedByEmail += 1;
      } else {
        stats.matchedByUsername += 1;
      }

      if (options.dryRun) {
        stats.wouldLink += 1;
        logVerbose(options.verbose, '[dry-run-link]', { authUserId, businessUserId: selected.id, matchedBy });
        continue;
      }

      try {
        await upsertUserAuthLink(authUserId, selected.id);
        stats.linked += 1;
        logVerbose(options.verbose, '[linked]', { authUserId, businessUserId: selected.id, matchedBy });
      } catch (error) {
        stats.errors += 1;
        console.error('[backfill-user-auth-links] 建链失败:', {
          authUserId,
          businessUserId: selected.id,
          matchedBy,
          error,
        });
      }
    }

    if (options.limit != null && stats.scanned >= options.limit) {
      break;
    }
  }

  console.log('[backfill-user-auth-links] 执行结束');
  console.log(
    JSON.stringify(
      {
        ...stats,
        mode: options.dryRun ? 'dry-run' : 'write',
        finalCursor: cursor || null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[backfill-user-auth-links] 执行失败:', error);
  process.exitCode = 1;
});
