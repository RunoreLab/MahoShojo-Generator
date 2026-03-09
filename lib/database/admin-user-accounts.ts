import { queryFromD1 } from './core';

export type AdminUserAccountListFilters = {
  page?: number;
  limit?: number;
  search?: string;
  activity?: '24h' | '7d' | '30d' | 'tracked' | 'untracked';
  status?: 'normal' | 'banned' | 'exempt';
  authState?: 'linked' | 'unlinked' | 'legacyOnly' | 'passwordMissing' | 'emailUnverified' | 'migrationReady';
  sortBy?: 'createdAt' | 'lastLoginAt' | 'lastActiveAt' | 'latestAuthEventAt';
  sortOrder?: 'asc' | 'desc';
};

export type AdminAuthAuditEvent = {
  id: string;
  eventType: string;
  authSource: string;
  identifierType: string | null;
  resultCode: string;
  resultMessage: string | null;
  createdAt: string | null;
};

export type AdminUserAccountSummary = {
  totalUsers: number;
  bannedUsers: number;
  reviewExemptUsers: number;
  linkedUsers: number;
  unlinkedUsers: number;
  legacyOnlyUsers: number;
  migrationReadyUsers: number;
  linkedWithoutPasswordUsers: number;
  emailUnverifiedUsers: number;
  authSuccess24h: number;
  authFailure24h: number;
  authSuccess7d: number;
  authFailure7d: number;
};

export type AdminUserAccountListItem = {
  id: number;
  username: string;
  businessEmail: string;
  createdAt: string | null;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  isBanned: boolean;
  banReason: string | null;
  isReviewExempt: boolean;
  slotCount: number | null;
  prefix: string | null;
  totalCards: number;
  publicCards: number;
  bannedCards: number;
  rejectedCards: number;
  auth: {
    hasAuthLink: boolean;
    authUserId: string | null;
    authEmail: string | null;
    authEmailVerified: boolean;
    hasPassword: boolean;
    legacyOnly: boolean;
    migrationRequired: boolean;
    authEmailMatchesBusinessEmail: boolean;
    latestAuthSource: string | null;
    latestAuthEventAt: string | null;
    authFailures24h: number;
    authFailures7d: number;
    authSuccess24h: number;
  };
};

export type AdminUserAccountDetail = {
  user: AdminUserAccountListItem;
  auth: {
    lastPasswordSetAt: string | null;
    lastPasswordChangeAt: string | null;
    lastEmailChangeAt: string | null;
    lastPasswordResetRequestedAt: string | null;
    lastMailRateLimitedAt: string | null;
  };
  audit: {
    totalEvents: number;
    successEvents: number;
    failureEvents: number;
    totalEvents24h: number;
    failureEvents24h: number;
    totalEvents7d: number;
    failureEvents7d: number;
  };
  recentAuditEvents: AdminAuthAuditEvent[];
};

type D1Row = Record<string, unknown>;

const readRows = (result: unknown): D1Row[] => {
  const rows = (result as { result?: Array<{ results?: D1Row[] }> })?.result?.[0]?.results;
  return Array.isArray(rows) ? rows : [];
};

const readFirstRow = (result: unknown): D1Row => readRows(result)[0] ?? {};

const readInt = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return 0;
};

const readNullableInt = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return null;
};

const readString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
};

const readNullableString = (value: unknown): string | null => {
  const normalized = readString(value).trim();
  return normalized ? normalized : null;
};

const readBool = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed !== 0;
  }
  return false;
};

const toIsoFromEpochSeconds = (value: unknown): string | null => {
  const seconds = readNullableInt(value);
  if (seconds === null || seconds < 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const normalizePage = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value as number));
};

const normalizeLimit = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(value as number)));
};

const normalizeSortBy = (value: string | undefined): NonNullable<AdminUserAccountListFilters['sortBy']> => {
  if (value === 'lastLoginAt') return 'lastLoginAt';
  if (value === 'lastActiveAt') return 'lastActiveAt';
  if (value === 'latestAuthEventAt') return 'latestAuthEventAt';
  return 'createdAt';
};

const normalizeSortOrder = (value: string | undefined): NonNullable<AdminUserAccountListFilters['sortOrder']> => {
  return value === 'asc' ? 'asc' : 'desc';
};

const formatActivitySinceIso = (days: number): string => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const buildWhereClause = (filters: AdminUserAccountListFilters): { whereSql: string; params: Array<string | number> } => {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.search?.trim()) {
    const normalizedSearch = filters.search.trim();
    const searchTerm = `%${normalizedSearch}%`;
    const numericId = /^\d+$/.test(normalizedSearch) ? Number.parseInt(normalizedSearch, 10) : null;

    if (typeof numericId === 'number' && Number.isFinite(numericId)) {
      clauses.push('(u.id = ? OR u.username LIKE ? OR u.email LIKE ? OR COALESCE(bau.email, \'\') LIKE ? OR COALESCE(ual.auth_user_id, \'\') LIKE ?)');
      params.push(numericId, searchTerm, searchTerm, searchTerm, searchTerm);
    } else {
      clauses.push('(u.username LIKE ? OR u.email LIKE ? OR COALESCE(bau.email, \'\') LIKE ? OR COALESCE(ual.auth_user_id, \'\') LIKE ?)');
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }
  }

  if (filters.status === 'banned') {
    clauses.push("(u.is_banned IS NOT NULL AND u.is_banned != '')");
  } else if (filters.status === 'exempt') {
    clauses.push('u.is_review_exempt = 1');
  } else if (filters.status === 'normal') {
    clauses.push("((u.is_banned IS NULL OR u.is_banned = '') AND u.is_review_exempt = 0)");
  }

  if (filters.activity === 'tracked') {
    clauses.push('ula.user_id IS NOT NULL');
  } else if (filters.activity === 'untracked') {
    clauses.push('ula.user_id IS NULL');
  } else if (filters.activity === '24h') {
    clauses.push('ula.last_seen_at >= ?');
    params.push(formatActivitySinceIso(1));
  } else if (filters.activity === '7d') {
    clauses.push('ula.last_seen_at >= ?');
    params.push(formatActivitySinceIso(7));
  } else if (filters.activity === '30d') {
    clauses.push('ula.last_seen_at >= ?');
    params.push(formatActivitySinceIso(30));
  }

  if (filters.authState === 'linked') {
    clauses.push('ual.auth_user_id IS NOT NULL');
  } else if (filters.authState === 'unlinked') {
    clauses.push('ual.auth_user_id IS NULL');
  } else if (filters.authState === 'legacyOnly') {
    clauses.push('(ual.auth_user_id IS NULL OR COALESCE(acc.has_password, 0) = 0)');
  } else if (filters.authState === 'passwordMissing') {
    clauses.push('(ual.auth_user_id IS NOT NULL AND COALESCE(acc.has_password, 0) = 0)');
  } else if (filters.authState === 'emailUnverified') {
    clauses.push('(ual.auth_user_id IS NOT NULL AND COALESCE(bau.email_verified, 0) = 0)');
  } else if (filters.authState === 'migrationReady') {
    clauses.push('(ual.auth_user_id IS NOT NULL AND COALESCE(acc.has_password, 0) = 1 AND COALESCE(bau.email_verified, 0) = 1)');
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
};

const buildSharedFromSql = (): string => `
  FROM users u
  LEFT JOIN (
    SELECT
      user_id,
      COUNT(*) AS total_cards,
      COALESCE(SUM(CASE WHEN is_public = 1 THEN 1 ELSE 0 END), 0) AS public_cards,
      COALESCE(SUM(CASE WHEN is_public = -1 THEN 1 ELSE 0 END), 0) AS banned_cards,
      COALESCE(SUM(CASE WHEN review_status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_cards
    FROM data_cards
    GROUP BY user_id
  ) card_stats ON card_stats.user_id = u.id
  LEFT JOIN user_last_activity ula ON ula.user_id = u.id
  LEFT JOIN user_auth_links ual ON ual.business_user_id = u.id
  LEFT JOIN ba_user bau ON bau.id = ual.auth_user_id
  LEFT JOIN (
    SELECT
      user_id,
      MAX(CASE WHEN password IS NOT NULL AND trim(password) != '' THEN 1 ELSE 0 END) AS has_password
    FROM ba_account
    GROUP BY user_id
  ) acc ON acc.user_id = ual.auth_user_id
`;

const mapListRow = (row: D1Row): AdminUserAccountListItem => ({
  id: readInt(row.id),
  username: readString(row.username),
  businessEmail: readString(row.business_email),
  createdAt: readNullableString(row.created_at),
  lastLoginAt: readNullableString(row.last_login_at),
  lastActiveAt: readNullableString(row.last_active_at),
  isBanned: Boolean(readNullableString(row.is_banned)),
  banReason: readNullableString(row.is_banned),
  isReviewExempt: readBool(row.is_review_exempt),
  slotCount: readNullableInt(row.slot_count),
  prefix: readNullableString(row.prefix),
  totalCards: readInt(row.total_cards),
  publicCards: readInt(row.public_cards),
  bannedCards: readInt(row.banned_cards),
  rejectedCards: readInt(row.rejected_cards),
  auth: {
    hasAuthLink: readBool(row.has_auth_link),
    authUserId: readNullableString(row.auth_user_id),
    authEmail: readNullableString(row.auth_email),
    authEmailVerified: readBool(row.auth_email_verified),
    hasPassword: readBool(row.has_password),
    legacyOnly: readBool(row.legacy_only),
    migrationRequired: readBool(row.migration_required),
    authEmailMatchesBusinessEmail: readBool(row.auth_email_matches_business_email),
    latestAuthSource: readNullableString(row.latest_auth_source),
    latestAuthEventAt: toIsoFromEpochSeconds(row.latest_auth_event_at_epoch),
    authFailures24h: readInt(row.auth_failures_24h),
    authFailures7d: readInt(row.auth_failures_7d),
    authSuccess24h: readInt(row.auth_success_24h),
  },
});

const mapAuditLogRow = (row: D1Row): AdminAuthAuditEvent => ({
  id: readString(row.id),
  eventType: readString(row.event_type),
  authSource: readString(row.auth_source),
  identifierType: readNullableString(row.identifier_type),
  resultCode: readString(row.result_code),
  resultMessage: readNullableString(row.result_message),
  createdAt: toIsoFromEpochSeconds(row.created_at),
});

export const listAdminUserAccounts = async (
  filters: AdminUserAccountListFilters,
): Promise<{ users: AdminUserAccountListItem[]; total: number; page: number; limit: number; summary: AdminUserAccountSummary }> => {
  const page = normalizePage(filters.page, 1);
  const limit = normalizeLimit(filters.limit, 20);
  const offset = (page - 1) * limit;
  const sortBy = normalizeSortBy(filters.sortBy);
  const sortOrder = normalizeSortOrder(filters.sortOrder).toUpperCase();
  const since24hEpoch = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const since7dEpoch = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const { whereSql, params } = buildWhereClause(filters);

  const orderSql = (() => {
    if (sortBy === 'lastLoginAt') return `u.last_login_at ${sortOrder}, u.created_at DESC`;
    if (sortBy === 'lastActiveAt') return `COALESCE(ula.last_seen_at, '') ${sortOrder}, u.created_at DESC`;
    if (sortBy === 'latestAuthEventAt') return `latest_auth_event_at_epoch ${sortOrder}, u.created_at DESC`;
    return `u.created_at ${sortOrder}, u.id DESC`;
  })();

  const fromSql = buildSharedFromSql();

  const listSql = `
    SELECT
      u.id,
      u.username,
      u.email AS business_email,
      u.created_at,
      u.last_login_at,
      u.is_banned,
      u.is_review_exempt,
      u.slot_count,
      u.prefix,
      ula.last_seen_at AS last_active_at,
      COALESCE(card_stats.total_cards, 0) AS total_cards,
      COALESCE(card_stats.public_cards, 0) AS public_cards,
      COALESCE(card_stats.banned_cards, 0) AS banned_cards,
      COALESCE(card_stats.rejected_cards, 0) AS rejected_cards,
      ual.auth_user_id,
      CASE WHEN ual.auth_user_id IS NOT NULL THEN 1 ELSE 0 END AS has_auth_link,
      bau.email AS auth_email,
      COALESCE(bau.email_verified, 0) AS auth_email_verified,
      COALESCE(acc.has_password, 0) AS has_password,
      CASE WHEN ual.auth_user_id IS NULL OR COALESCE(acc.has_password, 0) = 0 THEN 1 ELSE 0 END AS legacy_only,
      CASE WHEN ual.auth_user_id IS NULL OR COALESCE(acc.has_password, 0) = 0 THEN 1 ELSE 0 END AS migration_required,
      CASE
        WHEN bau.email IS NOT NULL AND lower(bau.email) = lower(u.email) THEN 1
        ELSE 0
      END AS auth_email_matches_business_email,
      (
        SELECT aal.auth_source
        FROM auth_audit_logs aal
        WHERE aal.business_user_id = u.id
        ORDER BY aal.created_at DESC, aal.id DESC
        LIMIT 1
      ) AS latest_auth_source,
      (
        SELECT aal.created_at
        FROM auth_audit_logs aal
        WHERE aal.business_user_id = u.id
        ORDER BY aal.created_at DESC, aal.id DESC
        LIMIT 1
      ) AS latest_auth_event_at_epoch,
      (
        SELECT COUNT(1)
        FROM auth_audit_logs aal
        WHERE aal.business_user_id = u.id
          AND aal.result_code != 'SUCCESS'
          AND aal.created_at >= ?
      ) AS auth_failures_24h,
      (
        SELECT COUNT(1)
        FROM auth_audit_logs aal
        WHERE aal.business_user_id = u.id
          AND aal.result_code != 'SUCCESS'
          AND aal.created_at >= ?
      ) AS auth_failures_7d,
      (
        SELECT COUNT(1)
        FROM auth_audit_logs aal
        WHERE aal.business_user_id = u.id
          AND aal.result_code = 'SUCCESS'
          AND aal.created_at >= ?
      ) AS auth_success_24h
    ${fromSql}
    ${whereSql}
    ORDER BY ${orderSql}
    LIMIT ? OFFSET ?;
  `;

  const countSql = `
    SELECT COUNT(1) AS total
    ${fromSql}
    ${whereSql};
  `;

  const listParams = [since24hEpoch, since7dEpoch, since24hEpoch, ...params, limit, offset];
  const countParams = [...params];

  const [listResult, countResult, summary] = await Promise.all([
    queryFromD1(listSql, listParams),
    queryFromD1(countSql, countParams),
    getAdminUserAccountSummary(),
  ]);

  return {
    users: readRows(listResult).map(mapListRow),
    total: readInt(readFirstRow(countResult).total),
    page,
    limit,
    summary,
  };
};

export const getAdminUserAccountSummary = async (): Promise<AdminUserAccountSummary> => {
  const since24hEpoch = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const since7dEpoch = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

  const summarySql = `
    SELECT
      COUNT(1) AS total_users,
      COALESCE(SUM(CASE WHEN u.is_banned IS NOT NULL AND u.is_banned != '' THEN 1 ELSE 0 END), 0) AS banned_users,
      COALESCE(SUM(CASE WHEN u.is_review_exempt = 1 THEN 1 ELSE 0 END), 0) AS review_exempt_users,
      COALESCE(SUM(CASE WHEN ual.auth_user_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS linked_users,
      COALESCE(SUM(CASE WHEN ual.auth_user_id IS NULL THEN 1 ELSE 0 END), 0) AS unlinked_users,
      COALESCE(SUM(CASE WHEN ual.auth_user_id IS NULL OR COALESCE(acc.has_password, 0) = 0 THEN 1 ELSE 0 END), 0) AS legacy_only_users,
      COALESCE(SUM(CASE WHEN ual.auth_user_id IS NOT NULL AND COALESCE(acc.has_password, 0) = 0 THEN 1 ELSE 0 END), 0) AS linked_without_password_users,
      COALESCE(SUM(CASE WHEN ual.auth_user_id IS NOT NULL AND COALESCE(bau.email_verified, 0) = 0 THEN 1 ELSE 0 END), 0) AS email_unverified_users,
      COALESCE(SUM(CASE WHEN ual.auth_user_id IS NOT NULL AND COALESCE(acc.has_password, 0) = 1 AND COALESCE(bau.email_verified, 0) = 1 THEN 1 ELSE 0 END), 0) AS migration_ready_users
    ${buildSharedFromSql()};
  `;

  const auditSql = `
    SELECT
      COALESCE(SUM(CASE WHEN result_code = 'SUCCESS' AND created_at >= ? THEN 1 ELSE 0 END), 0) AS auth_success_24h,
      COALESCE(SUM(CASE WHEN result_code != 'SUCCESS' AND created_at >= ? THEN 1 ELSE 0 END), 0) AS auth_failure_24h,
      COALESCE(SUM(CASE WHEN result_code = 'SUCCESS' AND created_at >= ? THEN 1 ELSE 0 END), 0) AS auth_success_7d,
      COALESCE(SUM(CASE WHEN result_code != 'SUCCESS' AND created_at >= ? THEN 1 ELSE 0 END), 0) AS auth_failure_7d
    FROM auth_audit_logs;
  `;

  const [summaryResult, auditResult] = await Promise.all([
    queryFromD1(summarySql),
    queryFromD1(auditSql, [since24hEpoch, since24hEpoch, since7dEpoch, since7dEpoch]),
  ]);

  const summaryRow = readFirstRow(summaryResult);
  const auditRow = readFirstRow(auditResult);

  return {
    totalUsers: readInt(summaryRow.total_users),
    bannedUsers: readInt(summaryRow.banned_users),
    reviewExemptUsers: readInt(summaryRow.review_exempt_users),
    linkedUsers: readInt(summaryRow.linked_users),
    unlinkedUsers: readInt(summaryRow.unlinked_users),
    legacyOnlyUsers: readInt(summaryRow.legacy_only_users),
    migrationReadyUsers: readInt(summaryRow.migration_ready_users),
    linkedWithoutPasswordUsers: readInt(summaryRow.linked_without_password_users),
    emailUnverifiedUsers: readInt(summaryRow.email_unverified_users),
    authSuccess24h: readInt(auditRow.auth_success_24h),
    authFailure24h: readInt(auditRow.auth_failure_24h),
    authSuccess7d: readInt(auditRow.auth_success_7d),
    authFailure7d: readInt(auditRow.auth_failure_7d),
  };
};

const getUserAccountDetailBaseSql = (): string => `
  SELECT
    u.id,
    u.username,
    u.email AS business_email,
    u.created_at,
    u.last_login_at,
    u.is_banned,
    u.is_review_exempt,
    u.slot_count,
    u.prefix,
    ula.last_seen_at AS last_active_at,
    COALESCE(card_stats.total_cards, 0) AS total_cards,
    COALESCE(card_stats.public_cards, 0) AS public_cards,
    COALESCE(card_stats.banned_cards, 0) AS banned_cards,
    COALESCE(card_stats.rejected_cards, 0) AS rejected_cards,
    ual.auth_user_id,
    CASE WHEN ual.auth_user_id IS NOT NULL THEN 1 ELSE 0 END AS has_auth_link,
    bau.email AS auth_email,
    COALESCE(bau.email_verified, 0) AS auth_email_verified,
    COALESCE(acc.has_password, 0) AS has_password,
    CASE WHEN ual.auth_user_id IS NULL OR COALESCE(acc.has_password, 0) = 0 THEN 1 ELSE 0 END AS legacy_only,
    CASE WHEN ual.auth_user_id IS NULL OR COALESCE(acc.has_password, 0) = 0 THEN 1 ELSE 0 END AS migration_required,
    CASE
      WHEN bau.email IS NOT NULL AND lower(bau.email) = lower(u.email) THEN 1
      ELSE 0
    END AS auth_email_matches_business_email,
    (
      SELECT aal.auth_source
      FROM auth_audit_logs aal
      WHERE aal.business_user_id = u.id
      ORDER BY aal.created_at DESC, aal.id DESC
      LIMIT 1
    ) AS latest_auth_source,
    (
      SELECT aal.created_at
      FROM auth_audit_logs aal
      WHERE aal.business_user_id = u.id
      ORDER BY aal.created_at DESC, aal.id DESC
      LIMIT 1
    ) AS latest_auth_event_at_epoch,
    (
      SELECT COUNT(1)
      FROM auth_audit_logs aal
      WHERE aal.business_user_id = u.id
        AND aal.result_code != 'SUCCESS'
        AND aal.created_at >= ?
    ) AS auth_failures_24h,
    (
      SELECT COUNT(1)
      FROM auth_audit_logs aal
      WHERE aal.business_user_id = u.id
        AND aal.result_code != 'SUCCESS'
        AND aal.created_at >= ?
    ) AS auth_failures_7d,
    (
      SELECT COUNT(1)
      FROM auth_audit_logs aal
      WHERE aal.business_user_id = u.id
        AND aal.result_code = 'SUCCESS'
        AND aal.created_at >= ?
    ) AS auth_success_24h,
    (
      SELECT aal.created_at
      FROM auth_audit_logs aal
      WHERE aal.business_user_id = u.id
        AND aal.event_type = 'password_set'
        AND aal.result_code = 'SUCCESS'
      ORDER BY aal.created_at DESC, aal.id DESC
      LIMIT 1
    ) AS last_password_set_epoch,
    (
      SELECT aal.created_at
      FROM auth_audit_logs aal
      WHERE aal.business_user_id = u.id
        AND aal.event_type = 'password_change'
        AND aal.result_code = 'SUCCESS'
      ORDER BY aal.created_at DESC, aal.id DESC
      LIMIT 1
    ) AS last_password_change_epoch,
    (
      SELECT aal.created_at
      FROM auth_audit_logs aal
      WHERE aal.business_user_id = u.id
        AND aal.event_type = 'email_change'
        AND aal.result_code = 'SUCCESS'
      ORDER BY aal.created_at DESC, aal.id DESC
      LIMIT 1
    ) AS last_email_change_epoch,
    (
      SELECT t.created_at
      FROM auth_password_reset_tokens t
      WHERE t.user_id = u.id
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 1
    ) AS last_password_reset_requested_epoch,
    (
      SELECT aal.created_at
      FROM auth_audit_logs aal
      WHERE aal.business_user_id = u.id
        AND aal.result_code = 'RATE_LIMITED'
      ORDER BY aal.created_at DESC, aal.id DESC
      LIMIT 1
    ) AS last_mail_rate_limited_epoch
  ${buildSharedFromSql()}
`;

const getAdminUserAccountDetailByCondition = async (
  conditionSql: string,
  params: Array<string | number>,
): Promise<AdminUserAccountDetail | null> => {
  const since24hEpoch = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const since7dEpoch = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

  const detailSql = `
    ${getUserAccountDetailBaseSql()}
    WHERE ${conditionSql}
    LIMIT 1;
  `;

  const detailResult = await queryFromD1(detailSql, [since24hEpoch, since7dEpoch, since24hEpoch, ...params]);
  const row = readFirstRow(detailResult);
  if (!row.id) return null;

  const user = mapListRow(row);

  const auditSummarySql = `
    SELECT
      COUNT(1) AS total_events,
      COALESCE(SUM(CASE WHEN result_code = 'SUCCESS' THEN 1 ELSE 0 END), 0) AS success_events,
      COALESCE(SUM(CASE WHEN result_code != 'SUCCESS' THEN 1 ELSE 0 END), 0) AS failure_events,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS total_events_24h,
      COALESCE(SUM(CASE WHEN result_code != 'SUCCESS' AND created_at >= ? THEN 1 ELSE 0 END), 0) AS failure_events_24h,
      COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS total_events_7d,
      COALESCE(SUM(CASE WHEN result_code != 'SUCCESS' AND created_at >= ? THEN 1 ELSE 0 END), 0) AS failure_events_7d
    FROM auth_audit_logs
    WHERE business_user_id = ?;
  `;

  const auditLogsSql = `
    SELECT
      id,
      event_type,
      auth_source,
      identifier_type,
      result_code,
      result_message,
      created_at
    FROM auth_audit_logs
    WHERE business_user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 25;
  `;

  const [auditSummaryResult, auditLogResult] = await Promise.all([
    queryFromD1(auditSummarySql, [since24hEpoch, since24hEpoch, since7dEpoch, since7dEpoch, user.id]),
    queryFromD1(auditLogsSql, [user.id]),
  ]);

  const auditSummaryRow = readFirstRow(auditSummaryResult);

  return {
    user,
    auth: {
      lastPasswordSetAt: toIsoFromEpochSeconds(row.last_password_set_epoch),
      lastPasswordChangeAt: toIsoFromEpochSeconds(row.last_password_change_epoch),
      lastEmailChangeAt: toIsoFromEpochSeconds(row.last_email_change_epoch),
      lastPasswordResetRequestedAt: toIsoFromEpochSeconds(row.last_password_reset_requested_epoch),
      lastMailRateLimitedAt: toIsoFromEpochSeconds(row.last_mail_rate_limited_epoch),
    },
    audit: {
      totalEvents: readInt(auditSummaryRow.total_events),
      successEvents: readInt(auditSummaryRow.success_events),
      failureEvents: readInt(auditSummaryRow.failure_events),
      totalEvents24h: readInt(auditSummaryRow.total_events_24h),
      failureEvents24h: readInt(auditSummaryRow.failure_events_24h),
      totalEvents7d: readInt(auditSummaryRow.total_events_7d),
      failureEvents7d: readInt(auditSummaryRow.failure_events_7d),
    },
    recentAuditEvents: readRows(auditLogResult).map(mapAuditLogRow),
  };
};

export const getAdminUserAccountDetailById = async (userId: number): Promise<AdminUserAccountDetail | null> => {
  const safeUserId = Number.isFinite(userId) ? Math.floor(userId) : 0;
  if (safeUserId <= 0) return null;
  return getAdminUserAccountDetailByCondition('u.id = ?', [safeUserId]);
};

export const getAdminUserAccountDetailByUsername = async (username: string): Promise<AdminUserAccountDetail | null> => {
  const safeUsername = typeof username === 'string' ? username.trim() : '';
  if (!safeUsername) return null;
  return getAdminUserAccountDetailByCondition('u.username = ?', [safeUsername]);
};
