import React from 'react';

export type AuthStateFilter = 'linked' | 'unlinked' | 'legacyOnly' | 'passwordMissing' | 'emailUnverified' | 'migrationReady' | '';
export type ActivityFilter = '24h' | '7d' | '30d' | 'tracked' | 'untracked' | '';
export type StatusFilter = 'normal' | 'banned' | 'exempt' | '';
export type SortBy = 'createdAt' | 'lastLoginAt' | 'lastActiveAt' | 'latestAuthEventAt';
export type SortOrder = 'asc' | 'desc';
export type DetailTab = 'basic' | 'auth' | 'migration' | 'audit' | 'activity';

export type UserAccountSummary = {
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

export type UserAccountListItem = {
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

export type AuditEvent = {
  id: string;
  eventType: string;
  authSource: string;
  identifierType: string | null;
  resultCode: string;
  resultMessage: string | null;
  createdAt: string | null;
};

export type UserAccountDetail = {
  user: UserAccountListItem;
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
  recentAuditEvents: AuditEvent[];
};

export type ListResponse =
  | {
      success: true;
      users: UserAccountListItem[];
      total: number;
      page: number;
      limit: number;
      summary: UserAccountSummary;
    }
  | { success: false; error?: string };

export type DetailResponse =
  | { success: true; detail: UserAccountDetail }
  | { success: false; error?: string };

export type FilterState = {
  search: string;
  status: StatusFilter;
  activity: ActivityFilter;
  authState: AuthStateFilter;
  regDateStart: string;
  regDateEnd: string;
  loginDateStart: string;
  loginDateEnd: string;
  activeDateStart: string;
  activeDateEnd: string;
  minPublicCards: string;
  maxPublicCards: string;
  minBannedCards: string;
  maxBannedCards: string;
  sortBy: SortBy;
  sortOrder: SortOrder;
};

export type EditorState = {
  slotCount: string;
  prefix: string;
  banReason: string;
};

export const DEFAULT_FILTERS: FilterState = {
  search: '',
  status: '',
  activity: '',
  authState: '',
  regDateStart: '',
  regDateEnd: '',
  loginDateStart: '',
  loginDateEnd: '',
  activeDateStart: '',
  activeDateEnd: '',
  minPublicCards: '',
  maxPublicCards: '',
  minBannedCards: '',
  maxBannedCards: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
};

export const DETAIL_TABS: DetailTab[] = ['basic', 'auth', 'migration', 'audit', 'activity'];

export const getDetailTabLabel = (tab: DetailTab): string =>
  tab === 'basic' ? '基本信息' : tab === 'auth' ? '认证状态' : tab === 'migration' ? '迁移状态' : tab === 'audit' ? '安全审计' : '活跃与创作';

export const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

export const formatNumber = (value: number): string => value.toLocaleString('zh-CN');

export const assignTrimmedQueryValue = (query: Record<string, string>, key: string, value: string) => {
  const normalized = value.trim();
  if (normalized) {
    query[key] = normalized;
  }
};

export function SummaryCard(props: {
  title: string;
  value: string;
  note?: string;
  icon: React.ElementType;
  color: string;
}) {
  const { title, value, note, icon: Icon, color } = props;
  return (
    <div className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur">
      <div className="mb-3 flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <p className="text-sm font-medium text-gray-600">{title}</p>
      </div>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      {note ? <p className="mt-2 text-xs text-gray-500">{note}</p> : null}
    </div>
  );
}

export function StatusPill(props: { tone: 'gray' | 'red' | 'amber' | 'green' | 'blue'; children: React.ReactNode }) {
  const className =
    props.tone === 'red'
      ? 'border-red-200 bg-red-50 text-red-700'
      : props.tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : props.tone === 'green'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : props.tone === 'blue'
            ? 'border-sky-200 bg-sky-50 text-sky-700'
            : 'border-gray-200 bg-gray-50 text-gray-700';
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>{props.children}</span>;
}
