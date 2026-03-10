import React, { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Activity,
  AlertTriangle,
  Clock,
  KeyRound,
  MailCheck,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';

type AuthStateFilter = 'linked' | 'unlinked' | 'legacyOnly' | 'passwordMissing' | 'emailUnverified' | 'migrationReady' | '';
type ActivityFilter = '24h' | '7d' | '30d' | 'tracked' | 'untracked' | '';
type StatusFilter = 'normal' | 'banned' | 'exempt' | '';
type SortBy = 'createdAt' | 'lastLoginAt' | 'lastActiveAt' | 'latestAuthEventAt';
type SortOrder = 'asc' | 'desc';
type DetailTab = 'basic' | 'auth' | 'migration' | 'audit' | 'activity';

type UserAccountSummary = {
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

type UserAccountListItem = {
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

type AuditEvent = {
  id: string;
  eventType: string;
  authSource: string;
  identifierType: string | null;
  resultCode: string;
  resultMessage: string | null;
  createdAt: string | null;
};

type UserAccountDetail = {
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

type ListResponse =
  | {
      success: true;
      users: UserAccountListItem[];
      total: number;
      page: number;
      limit: number;
      summary: UserAccountSummary;
    }
  | { success: false; error?: string };

type DetailResponse =
  | { success: true; detail: UserAccountDetail }
  | { success: false; error?: string };

type FilterState = {
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

type EditorState = {
  slotCount: string;
  prefix: string;
  banReason: string;
};

const DEFAULT_FILTERS: FilterState = {
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

const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

const formatNumber = (value: number): string => value.toLocaleString('zh-CN');

const assignTrimmedQueryValue = (query: Record<string, string>, key: string, value: string) => {
  const normalized = value.trim();
  if (normalized) {
    query[key] = normalized;
  }
};

function SummaryCard(props: {
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

function StatusPill(props: { tone: 'gray' | 'red' | 'amber' | 'green' | 'blue'; children: React.ReactNode }) {
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

export function AdminUserAccountPage() {
  const router = useRouter();
  const listAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);

  const [draftFilters, setDraftFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [users, setUsers] = useState<UserAccountListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<UserAccountSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [detail, setDetail] = useState<UserAccountDetail | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('basic');
  const [editor, setEditor] = useState<EditorState>({ slotCount: '', prefix: '', banReason: '' });
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const selectedUser = detail?.user ?? users.find((item) => item.id === selectedUserId) ?? null;

  const summaryCards = useMemo(
    () =>
      summary
        ? [
            {
              title: 'Legacy Only 用户',
              value: formatNumber(summary.legacyOnlyUsers),
              note: `已建链可用 ${formatNumber(summary.linkedUsers)}，迁移完成 ${formatNumber(summary.migrationReadyUsers)}`,
              icon: ShieldAlert,
              color: 'bg-rose-600',
            },
            {
              title: '邮箱未验证',
              value: formatNumber(summary.emailUnverifiedUsers),
              note: `已建链未设密 ${formatNumber(summary.linkedWithoutPasswordUsers)}`,
              icon: MailCheck,
              color: 'bg-amber-500',
            },
            {
              title: 'Auth 成功事件（24h）',
              value: formatNumber(summary.authSuccess24h),
              note: `近 7 天 ${formatNumber(summary.authSuccess7d)} 次`,
              icon: ShieldCheck,
              color: 'bg-emerald-600',
            },
            {
              title: 'Auth 失败事件（24h）',
              value: formatNumber(summary.authFailure24h),
              note: `近 7 天 ${formatNumber(summary.authFailure7d)} 次`,
              icon: AlertTriangle,
              color: 'bg-orange-600',
            },
            {
              title: '封禁 / 审查豁免',
              value: `${formatNumber(summary.bannedUsers)} / ${formatNumber(summary.reviewExemptUsers)}`,
              note: `总用户 ${formatNumber(summary.totalUsers)}`,
              icon: Users,
              color: 'bg-slate-700',
            },
          ]
        : [],
    [summary],
  );

  const buildQuery = (nextFilters: FilterState, nextPage: number, nextUsername?: string) => {
    const query: Record<string, string> = {};
    assignTrimmedQueryValue(query, 'search', nextFilters.search);
    if (nextFilters.status) query.status = nextFilters.status;
    if (nextFilters.activity) query.activity = nextFilters.activity;
    if (nextFilters.authState) query.authState = nextFilters.authState;
    assignTrimmedQueryValue(query, 'regDateStart', nextFilters.regDateStart);
    assignTrimmedQueryValue(query, 'regDateEnd', nextFilters.regDateEnd);
    assignTrimmedQueryValue(query, 'loginDateStart', nextFilters.loginDateStart);
    assignTrimmedQueryValue(query, 'loginDateEnd', nextFilters.loginDateEnd);
    assignTrimmedQueryValue(query, 'activeDateStart', nextFilters.activeDateStart);
    assignTrimmedQueryValue(query, 'activeDateEnd', nextFilters.activeDateEnd);
    assignTrimmedQueryValue(query, 'minPublicCards', nextFilters.minPublicCards);
    assignTrimmedQueryValue(query, 'maxPublicCards', nextFilters.maxPublicCards);
    assignTrimmedQueryValue(query, 'minBannedCards', nextFilters.minBannedCards);
    assignTrimmedQueryValue(query, 'maxBannedCards', nextFilters.maxBannedCards);
    if (nextFilters.sortBy !== DEFAULT_FILTERS.sortBy) query.sortBy = nextFilters.sortBy;
    if (nextFilters.sortOrder !== DEFAULT_FILTERS.sortOrder) query.sortOrder = nextFilters.sortOrder;
    if (nextPage > 1) query.page = String(nextPage);
    if (nextUsername) query.username = nextUsername;
    return query;
  };

  const buildListParams = (nextFilters: FilterState, nextPage: number) => {
    const params = new URLSearchParams();
    params.set('page', String(nextPage));
    params.set('limit', String(limit));
    if (nextFilters.status) params.set('status', nextFilters.status);
    if (nextFilters.activity) params.set('activity', nextFilters.activity);
    if (nextFilters.authState) params.set('authState', nextFilters.authState);
    if (nextFilters.sortBy) params.set('sortBy', nextFilters.sortBy);
    if (nextFilters.sortOrder) params.set('sortOrder', nextFilters.sortOrder);

    const assignParam = (key: string, value: string) => {
      const normalized = value.trim();
      if (normalized) {
        params.set(key, normalized);
      }
    };

    assignParam('search', nextFilters.search);
    assignParam('regDateStart', nextFilters.regDateStart);
    assignParam('regDateEnd', nextFilters.regDateEnd);
    assignParam('loginDateStart', nextFilters.loginDateStart);
    assignParam('loginDateEnd', nextFilters.loginDateEnd);
    assignParam('activeDateStart', nextFilters.activeDateStart);
    assignParam('activeDateEnd', nextFilters.activeDateEnd);
    assignParam('minPublicCards', nextFilters.minPublicCards);
    assignParam('maxPublicCards', nextFilters.maxPublicCards);
    assignParam('minBannedCards', nextFilters.minBannedCards);
    assignParam('maxBannedCards', nextFilters.maxBannedCards);

    return params;
  };

  const loadList = async (nextFilters: FilterState, nextPage: number) => {
    setListLoading(true);
    setError(null);
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;

    try {
      const params = buildListParams(nextFilters, nextPage);

      const response = await fetch(`/api/admin/user-accounts?${params.toString()}`, { signal: controller.signal });
      const json = (await response.json()) as ListResponse;
      if (!response.ok || json.success !== true) {
        throw new Error(json.success === false ? json.error || '读取用户列表失败' : '读取用户列表失败');
      }

      setUsers(json.users);
      setTotal(json.total);
      setSummary(json.summary);
      setSelectedIds(new Set());
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : '读取用户列表失败');
    } finally {
      if (!controller.signal.aborted) {
        setListLoading(false);
      }
    }
  };

  const loadDetail = async (input: { userId?: number; username?: string }, options?: { tab?: DetailTab }) => {
    const params = new URLSearchParams();
    if (input.userId) params.set('userId', String(input.userId));
    if (input.username) params.set('username', input.username);
    if (!params.toString()) return;

    setDetailLoading(true);
    setDetailError(null);
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;

    try {
      const response = await fetch(`/api/admin/user-accounts?${params.toString()}`, { signal: controller.signal });
      const json = (await response.json()) as DetailResponse;
      if (!response.ok || json.success !== true) {
        throw new Error(json.success === false ? json.error || '读取用户详情失败' : '读取用户详情失败');
      }

      setDetail(json.detail);
      setSelectedUserId(json.detail.user.id);
      setDetailTab(options?.tab ?? detailTab);
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setDetailError(loadError instanceof Error ? loadError.message : '读取用户详情失败');
    } finally {
      if (!controller.signal.aborted) {
        setDetailLoading(false);
      }
    }
  };

  const syncFromRoute = async () => {
    const nextFilters: FilterState = {
      search: typeof router.query.search === 'string' ? router.query.search : '',
      status: typeof router.query.status === 'string' ? (router.query.status as StatusFilter) : '',
      activity: typeof router.query.activity === 'string' ? (router.query.activity as ActivityFilter) : '',
      authState: typeof router.query.authState === 'string' ? (router.query.authState as AuthStateFilter) : '',
      regDateStart: typeof router.query.regDateStart === 'string' ? router.query.regDateStart : '',
      regDateEnd: typeof router.query.regDateEnd === 'string' ? router.query.regDateEnd : '',
      loginDateStart: typeof router.query.loginDateStart === 'string' ? router.query.loginDateStart : '',
      loginDateEnd: typeof router.query.loginDateEnd === 'string' ? router.query.loginDateEnd : '',
      activeDateStart: typeof router.query.activeDateStart === 'string' ? router.query.activeDateStart : '',
      activeDateEnd: typeof router.query.activeDateEnd === 'string' ? router.query.activeDateEnd : '',
      minPublicCards: typeof router.query.minPublicCards === 'string' ? router.query.minPublicCards : '',
      maxPublicCards: typeof router.query.maxPublicCards === 'string' ? router.query.maxPublicCards : '',
      minBannedCards: typeof router.query.minBannedCards === 'string' ? router.query.minBannedCards : '',
      maxBannedCards: typeof router.query.maxBannedCards === 'string' ? router.query.maxBannedCards : '',
      sortBy: typeof router.query.sortBy === 'string' ? (router.query.sortBy as SortBy) : DEFAULT_FILTERS.sortBy,
      sortOrder: typeof router.query.sortOrder === 'string' ? (router.query.sortOrder as SortOrder) : DEFAULT_FILTERS.sortOrder,
    };
    const nextPage = typeof router.query.page === 'string' ? Math.max(1, Number.parseInt(router.query.page, 10) || 1) : 1;
    const username = typeof router.query.username === 'string' ? router.query.username.trim() : '';

    setFilters(nextFilters);
    setDraftFilters(nextFilters);
    setPage(nextPage);

    await loadList(nextFilters, nextPage);

    if (username) {
      await loadDetail({ username }, { tab: 'auth' });
      return;
    }

    if (selectedUserId) {
      await loadDetail({ userId: selectedUserId });
    }
  };

  useEffect(() => {
    if (!router.isReady) return;
    void syncFromRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.query]);

  useEffect(() => {
    if (!detail) return;
    setEditor({
      slotCount: detail.user.slotCount === null ? '' : String(detail.user.slotCount),
      prefix: detail.user.prefix ?? '',
      banReason: detail.user.banReason ?? '',
    });
  }, [detail]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    return () => {
      listAbortRef.current?.abort();
      detailAbortRef.current?.abort();
    };
  }, []);

  const pushRoute = async (nextFilters: FilterState, nextPage: number, nextUsername?: string) => {
    await router.push(
      {
        pathname: router.pathname,
        query: buildQuery(nextFilters, nextPage, nextUsername),
      },
      undefined,
      { shallow: true },
    );
  };

  const applyFilters = async () => {
    await pushRoute(draftFilters, 1);
  };

  const clearFilters = async () => {
    setDraftFilters(DEFAULT_FILTERS);
    await pushRoute(DEFAULT_FILTERS, 1);
  };

  const updateActivityFilter = (value: ActivityFilter) => {
    setDraftFilters((prev) => ({
      ...prev,
      activity: value,
      activeDateStart: value ? '' : prev.activeDateStart,
      activeDateEnd: value ? '' : prev.activeDateEnd,
    }));
  };

  const updateActiveDateFilter = (key: 'activeDateStart' | 'activeDateEnd', value: string) => {
    setDraftFilters((prev) => ({
      ...prev,
      [key]: value,
      activity: value ? '' : prev.activity,
    }));
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(users.map((item) => item.id)) : new Set());
  };

  const handleToggleSelected = (userId: number) => {
    const next = new Set(selectedIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setSelectedIds(next);
  };

  const handleOpenUser = async (userId: number) => {
    await loadDetail({ userId });
  };

  const runBatchAction = async (action: 'set_exempt' | 'remove_exempt' | 'ban' | 'unban', userIds?: number[]) => {
    const targetIds = userIds ?? Array.from(selectedIds);
    if (targetIds.length <= 0) return;

    let value: string | undefined;
    if (action === 'ban') {
      const promptResult = window.prompt(`请输入封禁 ${targetIds.length} 名用户的原因，可留空使用默认原因：`, '');
      if (promptResult === null) return;
      value = promptResult;
    }

    setBatchLoading(true);
    try {
      const response = await fetch('/api/admin/users/batch-update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: targetIds, action, value }),
      });
      const json = (await response.json()) as { success?: boolean; error?: string };
      if (!response.ok || !json.success) {
        throw new Error(json.error || '批量更新失败');
      }

      setMessage(`已更新 ${targetIds.length} 名用户`);
      await loadList(filters, page);
      if (selectedUserId && targetIds.includes(selectedUserId)) {
        await loadDetail({ userId: selectedUserId });
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '批量更新失败');
    } finally {
      setBatchLoading(false);
    }
  };

  const saveCurrentUser = async () => {
    if (!detail) return;
    setSaving(true);
    setDetailError(null);

    try {
      const response = await fetch(`/api/admin/users/${detail.user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot_count: editor.slotCount.trim() ? Number.parseInt(editor.slotCount, 10) : null,
          prefix: editor.prefix.trim() || null,
          is_banned: editor.banReason.trim() || null,
        }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error || '保存失败');
      }

      setMessage(`已保存用户 ${detail.user.username}`);
      await loadList(filters, page);
      await loadDetail({ userId: detail.user.id });
    } catch (saveError) {
      setDetailError(saveError instanceof Error ? saveError.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Head>
        <title>用户与账号 - Admin</title>
      </Head>

      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_36%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link href="/admin" className="text-sm text-sky-700 hover:underline">
                ← 返回管理后台主页
              </Link>
              <h1 className="mt-3 text-3xl font-semibold text-slate-900">用户与账号</h1>
              <p className="mt-1 text-sm text-slate-600">
                统一查看业务用户、Auth 建链、迁移状态与安全审计。当前 Auth 失败计数口径为审计事件失败，不等同于纯登录失败。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/admin/user-analytics"
                className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-sky-700 shadow-sm hover:bg-sky-50"
              >
                查看用户统计分析
              </Link>
              <button
                type="button"
                onClick={() => void syncFromRoute()}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                disabled={listLoading || detailLoading}
              >
                <RefreshCw className={`h-4 w-4 ${listLoading || detailLoading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>
          </div>

          {message ? (
            <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </div>
          ) : null}

          {summary ? (
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              {summaryCards.map((card) => (
                <SummaryCard key={card.title} {...card} />
              ))}
            </div>
          ) : null}

          <div className="mb-5 rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur">
            <div className="grid gap-3 lg:grid-cols-6">
              <label className="lg:col-span-2">
                <span className="mb-1 block text-xs font-medium text-slate-600">搜索</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={draftFilters.search}
                    onChange={(event) => setDraftFilters((prev) => ({ ...prev, search: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void applyFilters();
                    }}
                    placeholder="用户名 / 邮箱 / Auth 用户 ID / 用户 ID"
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 shadow-sm outline-none ring-sky-200 transition focus:border-sky-300 focus:ring-2"
                  />
                </div>
              </label>

              <label>
                <span className="mb-1 block text-xs font-medium text-slate-600">业务状态</span>
                <select
                  value={draftFilters.status}
                  onChange={(event) => setDraftFilters((prev) => ({ ...prev, status: event.target.value as StatusFilter }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                >
                  <option value="">全部</option>
                  <option value="normal">正常</option>
                  <option value="banned">已封禁</option>
                  <option value="exempt">审查豁免</option>
                </select>
              </label>

              <label>
                <span className="mb-1 block text-xs font-medium text-slate-600">活跃口径</span>
                <select
                  value={draftFilters.activity}
                  onChange={(event) => updateActivityFilter(event.target.value as ActivityFilter)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                >
                  <option value="">全部</option>
                  <option value="24h">24 小时活跃</option>
                  <option value="7d">7 天活跃</option>
                  <option value="30d">30 天活跃</option>
                  <option value="tracked">有活跃记录</option>
                  <option value="untracked">无活跃记录</option>
                </select>
              </label>

              <label>
                <span className="mb-1 block text-xs font-medium text-slate-600">迁移 / Auth</span>
                <select
                  value={draftFilters.authState}
                  onChange={(event) => setDraftFilters((prev) => ({ ...prev, authState: event.target.value as AuthStateFilter }))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                >
                  <option value="">全部</option>
                  <option value="legacyOnly">Legacy Only</option>
                  <option value="linked">已建链</option>
                  <option value="unlinked">未建链</option>
                  <option value="passwordMissing">已建链未设密</option>
                  <option value="emailUnverified">邮箱未验证</option>
                  <option value="migrationReady">迁移完成</option>
                </select>
              </label>

              <label>
                <span className="mb-1 block text-xs font-medium text-slate-600">排序</span>
                <select
                  value={`${draftFilters.sortBy}:${draftFilters.sortOrder}`}
                  onChange={(event) => {
                    const [sortBy, sortOrder] = event.target.value.split(':') as [SortBy, SortOrder];
                    setDraftFilters((prev) => ({ ...prev, sortBy, sortOrder }));
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                >
                  <option value="createdAt:desc">注册时间 新→旧</option>
                  <option value="createdAt:asc">注册时间 旧→新</option>
                  <option value="lastLoginAt:desc">最近登录 新→旧</option>
                  <option value="lastActiveAt:desc">最近活跃 新→旧</option>
                  <option value="latestAuthEventAt:desc">最近 Auth 审计 新→旧</option>
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label>
                <span className="mb-1 block text-xs font-medium text-slate-600">公开卡片数范围</span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={draftFilters.minPublicCards}
                    onChange={(event) => setDraftFilters((prev) => ({ ...prev, minPublicCards: event.target.value }))}
                    placeholder="最少"
                    className="w-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                  />
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={draftFilters.maxPublicCards}
                    onChange={(event) => setDraftFilters((prev) => ({ ...prev, maxPublicCards: event.target.value }))}
                    placeholder="最多"
                    className="w-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                  />
                </div>
              </label>

              <div>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">封禁卡片数范围</span>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={draftFilters.minBannedCards}
                      onChange={(event) => setDraftFilters((prev) => ({ ...prev, minBannedCards: event.target.value }))}
                      placeholder="最少"
                      className="w-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                    />
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={draftFilters.maxBannedCards}
                      onChange={(event) => setDraftFilters((prev) => ({ ...prev, maxBannedCards: event.target.value }))}
                      placeholder="最多"
                      className="w-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                    />
                  </div>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const nextFilters = { ...draftFilters, minBannedCards: '', maxBannedCards: '0' };
                    setDraftFilters(nextFilters);
                    void pushRoute(nextFilters, 1);
                  }}
                  className="mt-1 text-xs font-medium text-sky-700 hover:underline"
                >
                  快速筛选：无封禁卡
                </button>
              </div>

              <label>
                <span className="mb-1 block text-xs font-medium text-slate-600">注册时间范围</span>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={draftFilters.regDateStart}
                    onChange={(event) => setDraftFilters((prev) => ({ ...prev, regDateStart: event.target.value }))}
                    className="w-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                  />
                  <input
                    type="date"
                    value={draftFilters.regDateEnd}
                    onChange={(event) => setDraftFilters((prev) => ({ ...prev, regDateEnd: event.target.value }))}
                    className="w-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                  />
                </div>
              </label>

              <label>
                <span className="mb-1 block text-xs font-medium text-slate-600">最近登录范围</span>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={draftFilters.loginDateStart}
                    onChange={(event) => setDraftFilters((prev) => ({ ...prev, loginDateStart: event.target.value }))}
                    className="w-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                  />
                  <input
                    type="date"
                    value={draftFilters.loginDateEnd}
                    onChange={(event) => setDraftFilters((prev) => ({ ...prev, loginDateEnd: event.target.value }))}
                    className="w-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                  />
                </div>
              </label>

              <div>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">最近活跃范围</span>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={draftFilters.activeDateStart}
                      onChange={(event) => updateActiveDateFilter('activeDateStart', event.target.value)}
                      className="w-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                    />
                    <input
                      type="date"
                      value={draftFilters.activeDateEnd}
                      onChange={(event) => updateActiveDateFilter('activeDateEnd', event.target.value)}
                      className="w-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                    />
                  </div>
                </label>
                <p className="mt-1 text-xs text-slate-500">设置活跃日期范围后，会自动清空上方“活跃口径”快捷筛选。</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void applyFilters()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                应用筛选
              </button>
              <button
                type="button"
                onClick={() => void clearFilters()}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                重置
              </button>
            </div>
          </div>

          {error ? (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">用户列表</h2>
                    <p className="text-xs text-slate-500">
                      共 {formatNumber(total)} 名用户，当前第 {page} / {totalPages} 页
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void runBatchAction('set_exempt')}
                      disabled={selectedIds.size === 0 || batchLoading}
                      className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      设为豁免
                    </button>
                    <button
                      type="button"
                      onClick={() => void runBatchAction('remove_exempt')}
                      disabled={selectedIds.size === 0 || batchLoading}
                      className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      取消豁免
                    </button>
                    <button
                      type="button"
                      onClick={() => void runBatchAction('ban')}
                      disabled={selectedIds.size === 0 || batchLoading}
                      className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      批量封禁
                    </button>
                    <button
                      type="button"
                      onClick={() => void runBatchAction('unban')}
                      disabled={selectedIds.size === 0 || batchLoading}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      批量解封
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={users.length > 0 && selectedIds.size === users.length}
                            onChange={(event) => handleSelectAll(event.target.checked)}
                          />
                        </th>
                        <th className="px-4 py-3">用户</th>
                        <th className="px-4 py-3">Auth</th>
                        <th className="px-4 py-3">卡片</th>
                        <th className="px-4 py-3">最近活动</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {listLoading ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                            正在读取用户列表…
                          </td>
                        </tr>
                      ) : users.length <= 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                            没有匹配的用户
                          </td>
                        </tr>
                      ) : (
                        users.map((user) => {
                          const active = selectedUserId === user.id;
                          return (
                            <tr
                              key={user.id}
                              className={`cursor-pointer transition hover:bg-sky-50 ${active ? 'bg-sky-50/80' : 'bg-white'}`}
                              onClick={() => void handleOpenUser(user.id)}
                            >
                              <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(user.id)}
                                  onChange={() => handleToggleSelected(user.id)}
                                />
                              </td>
                              <td className="px-4 py-3 align-top">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-slate-900">{user.username}</span>
                                  <span className="text-xs text-slate-400">#{user.id}</span>
                                  {user.isBanned ? <StatusPill tone="red">已封禁</StatusPill> : null}
                                  {user.isReviewExempt ? <StatusPill tone="amber">审查豁免</StatusPill> : null}
                                  {user.auth.legacyOnly ? <StatusPill tone="red">Legacy Only</StatusPill> : <StatusPill tone="green">已迁移</StatusPill>}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">{user.businessEmail}</div>
                                {user.auth.authEmail && user.auth.authEmail !== user.businessEmail ? (
                                  <div className="mt-1 text-xs text-amber-700">Auth 邮箱：{user.auth.authEmail}</div>
                                ) : null}
                              </td>
                              <td className="px-4 py-3 align-top">
                                <div className="flex flex-wrap gap-1.5">
                                  {user.auth.hasAuthLink ? <StatusPill tone="blue">已建链</StatusPill> : <StatusPill tone="gray">未建链</StatusPill>}
                                  {user.auth.hasPassword ? <StatusPill tone="green">已设密</StatusPill> : <StatusPill tone="amber">未设密</StatusPill>}
                                  {user.auth.authEmailVerified ? <StatusPill tone="green">邮箱已验</StatusPill> : <StatusPill tone="amber">邮箱未验</StatusPill>}
                                </div>
                                <div className="mt-2 text-xs text-slate-500">
                                  最近来源：{user.auth.latestAuthSource ?? '—'}
                                  <br />
                                  24h 成功 / 失败：{formatNumber(user.auth.authSuccess24h)} / {formatNumber(user.auth.authFailures24h)}
                                </div>
                              </td>
                              <td className="px-4 py-3 align-top text-xs text-slate-600">
                                <div>总计 {formatNumber(user.totalCards)}</div>
                                <div>公开 {formatNumber(user.publicCards)}</div>
                                <div>封禁 {formatNumber(user.bannedCards)}</div>
                                <div>驳回 {formatNumber(user.rejectedCards)}</div>
                              </td>
                              <td className="px-4 py-3 align-top text-xs text-slate-600">
                                <div>注册：{formatDateTime(user.createdAt)}</div>
                                <div>登录：{formatDateTime(user.lastLoginAt)}</div>
                                <div>活跃：{formatDateTime(user.lastActiveAt)}</div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-slate-500">已选中 {selectedIds.size} 名用户</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => void pushRoute(filters, page - 1)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => void pushRoute(filters, page + 1)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">用户详情</h2>
                  <p className="text-xs text-slate-500">
                    基础信息、认证状态、迁移判断与安全审计集中在同一面板。
                  </p>
                </div>
                {selectedUser ? (
                  <button
                    type="button"
                    onClick={() => void loadDetail({ userId: selectedUser.id })}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${detailLoading ? 'animate-spin' : ''}`} />
                    刷新详情
                  </button>
                ) : null}
              </div>

              {detailError ? (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {detailError}
                </div>
              ) : null}

              {!selectedUser ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  从左侧列表选择一名用户，或通过主页快捷跳转带 `search` / `username` 参数打开。
                </div>
              ) : detailLoading && !detail ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  正在读取详情…
                </div>
              ) : detail ? (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    {(['basic', 'auth', 'migration', 'audit', 'activity'] as DetailTab[]).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setDetailTab(tab)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          detailTab === tab
                            ? 'bg-slate-900 text-white'
                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {tab === 'basic'
                          ? '基本信息'
                          : tab === 'auth'
                            ? '认证状态'
                            : tab === 'migration'
                              ? '迁移状态'
                              : tab === 'audit'
                                ? '安全审计'
                                : '活跃与创作'}
                      </button>
                    ))}
                  </div>

                  <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-900">{detail.user.username}</h3>
                      <span className="text-xs text-slate-400">#{detail.user.id}</span>
                      {detail.user.isBanned ? <StatusPill tone="red">已封禁</StatusPill> : <StatusPill tone="green">正常</StatusPill>}
                      {detail.user.isReviewExempt ? <StatusPill tone="amber">审查豁免</StatusPill> : null}
                      {detail.user.auth.migrationRequired ? <StatusPill tone="red">待迁移</StatusPill> : <StatusPill tone="green">迁移完成</StatusPill>}
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{detail.user.businessEmail}</p>
                  </div>

                  {detailTab === 'basic' ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 p-4">
                          <h4 className="mb-3 text-sm font-semibold text-slate-900">可编辑业务字段</h4>
                          <div className="space-y-3">
                            <label className="block text-sm text-slate-700">
                              <span className="mb-1 block text-xs font-medium text-slate-500">槽位数量</span>
                              <input
                                value={editor.slotCount}
                                onChange={(event) => setEditor((prev) => ({ ...prev, slotCount: event.target.value }))}
                                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                                placeholder="为空表示 NULL"
                              />
                            </label>
                            <label className="block text-sm text-slate-700">
                              <span className="mb-1 block text-xs font-medium text-slate-500">前缀</span>
                              <input
                                value={editor.prefix}
                                onChange={(event) => setEditor((prev) => ({ ...prev, prefix: event.target.value }))}
                                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                                placeholder="例如：魔法评审官"
                              />
                            </label>
                            <label className="block text-sm text-slate-700">
                              <span className="mb-1 block text-xs font-medium text-slate-500">封禁原因</span>
                              <textarea
                                value={editor.banReason}
                                onChange={(event) => setEditor((prev) => ({ ...prev, banReason: event.target.value }))}
                                className="h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                                placeholder="留空表示解封"
                              />
                            </label>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void saveCurrentUser()}
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                              >
                                <Save className="h-4 w-4" />
                                保存业务字段
                              </button>
                              <button
                                type="button"
                                onClick={() => void runBatchAction(detail.user.isReviewExempt ? 'remove_exempt' : 'set_exempt', [detail.user.id])}
                                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700"
                              >
                                {detail.user.isReviewExempt ? '取消审查豁免' : '设为审查豁免'}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 p-4">
                          <h4 className="mb-3 text-sm font-semibold text-slate-900">创作概览</h4>
                          <div className="grid grid-cols-2 gap-3">
                            <SummaryCard title="总卡片" value={formatNumber(detail.user.totalCards)} icon={Users} color="bg-sky-600" />
                            <SummaryCard title="公开卡片" value={formatNumber(detail.user.publicCards)} icon={Users} color="bg-emerald-600" />
                            <SummaryCard title="封禁卡片" value={formatNumber(detail.user.bannedCards)} icon={AlertTriangle} color="bg-rose-600" />
                            <SummaryCard title="驳回卡片" value={formatNumber(detail.user.rejectedCards)} icon={AlertTriangle} color="bg-amber-600" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {detailTab === 'auth' ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 p-4">
                        <h4 className="mb-3 text-sm font-semibold text-slate-900">认证映射</h4>
                        <dl className="space-y-2 text-sm text-slate-700">
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">Auth 用户 ID</dt>
                            <dd className="text-right">{detail.user.auth.authUserId ?? '—'}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">Auth 邮箱</dt>
                            <dd className="text-right">{detail.user.auth.authEmail ?? '—'}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">业务 / Auth 邮箱一致</dt>
                            <dd className="text-right">{detail.user.auth.authEmailMatchesBusinessEmail ? '是' : '否'}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">最近认证来源</dt>
                            <dd className="text-right">{detail.user.auth.latestAuthSource ?? '—'}</dd>
                          </div>
                        </dl>
                      </div>

                      <div className="rounded-2xl border border-slate-200 p-4">
                        <h4 className="mb-3 text-sm font-semibold text-slate-900">认证健康度</h4>
                        <div className="flex flex-wrap gap-2">
                          {detail.user.auth.hasAuthLink ? <StatusPill tone="blue">已建链</StatusPill> : <StatusPill tone="red">未建链</StatusPill>}
                          {detail.user.auth.hasPassword ? <StatusPill tone="green">已设密</StatusPill> : <StatusPill tone="amber">未设密</StatusPill>}
                          {detail.user.auth.authEmailVerified ? <StatusPill tone="green">邮箱已验证</StatusPill> : <StatusPill tone="amber">邮箱未验证</StatusPill>}
                          {detail.user.auth.legacyOnly ? <StatusPill tone="red">Legacy Only</StatusPill> : <StatusPill tone="green">可用 Better Auth</StatusPill>}
                        </div>
                        <dl className="mt-4 space-y-2 text-sm text-slate-700">
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">最近 Auth 事件</dt>
                            <dd className="text-right">{formatDateTime(detail.user.auth.latestAuthEventAt)}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">24h 成功 / 失败</dt>
                            <dd className="text-right">
                              {formatNumber(detail.user.auth.authSuccess24h)} / {formatNumber(detail.user.auth.authFailures24h)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">7d 失败事件</dt>
                            <dd className="text-right">{formatNumber(detail.user.auth.authFailures7d)}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  ) : null}

                  {detailTab === 'migration' ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 p-4">
                        <h4 className="mb-3 text-sm font-semibold text-slate-900">迁移判定</h4>
                        <div className="space-y-3 text-sm text-slate-700">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="font-medium text-slate-900">
                              {detail.user.auth.migrationRequired ? '该用户仍处于待迁移状态' : '该用户已满足当前迁移条件'}
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              当前口径：未建链或未设置密码视为迁移未完成；邮箱验证单独展示，不阻断 legacyOnly 判断。
                            </p>
                          </div>
                          <div className="flex items-start gap-3">
                            <KeyRound className="mt-0.5 h-4 w-4 text-slate-400" />
                            <div>
                              建链：{detail.user.auth.hasAuthLink ? '已完成' : '缺失'}
                              <br />
                              密码：{detail.user.auth.hasPassword ? '已设置' : '未设置'}
                              <br />
                              验邮：{detail.user.auth.authEmailVerified ? '已验证' : '未验证'}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 p-4">
                        <h4 className="mb-3 text-sm font-semibold text-slate-900">关键时间点</h4>
                        <dl className="space-y-2 text-sm text-slate-700">
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">最近设密成功</dt>
                            <dd className="text-right">{formatDateTime(detail.auth.lastPasswordSetAt)}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">最近改密成功</dt>
                            <dd className="text-right">{formatDateTime(detail.auth.lastPasswordChangeAt)}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">最近改绑邮箱成功</dt>
                            <dd className="text-right">{formatDateTime(detail.auth.lastEmailChangeAt)}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">最近重置密码申请</dt>
                            <dd className="text-right">{formatDateTime(detail.auth.lastPasswordResetRequestedAt)}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">最近邮件频控命中</dt>
                            <dd className="text-right">{formatDateTime(detail.auth.lastMailRateLimitedAt)}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  ) : null}

                  {detailTab === 'audit' ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-4">
                        <SummaryCard title="审计总事件" value={formatNumber(detail.audit.totalEvents)} icon={Activity} color="bg-slate-700" />
                        <SummaryCard title="成功事件" value={formatNumber(detail.audit.successEvents)} icon={ShieldCheck} color="bg-emerald-600" />
                        <SummaryCard title="失败事件" value={formatNumber(detail.audit.failureEvents)} icon={AlertTriangle} color="bg-rose-600" />
                        <SummaryCard
                          title="24h / 7d 失败"
                          value={`${formatNumber(detail.audit.failureEvents24h)} / ${formatNumber(detail.audit.failureEvents7d)}`}
                          icon={Clock}
                          color="bg-orange-600"
                        />
                      </div>

                      <div className="rounded-2xl border border-slate-200">
                        <div className="border-b border-slate-200 px-4 py-3">
                          <h4 className="text-sm font-semibold text-slate-900">最近 25 条审计事件</h4>
                        </div>
                        <div className="max-h-[420px] overflow-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-4 py-3">时间</th>
                                <th className="px-4 py-3">事件</th>
                                <th className="px-4 py-3">来源</th>
                                <th className="px-4 py-3">结果</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {detail.recentAuditEvents.length <= 0 ? (
                                <tr>
                                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                                    暂无审计事件
                                  </td>
                                </tr>
                              ) : (
                                detail.recentAuditEvents.map((event) => (
                                  <tr key={event.id}>
                                    <td className="px-4 py-3 align-top text-xs text-slate-500">{formatDateTime(event.createdAt)}</td>
                                    <td className="px-4 py-3 align-top">
                                      <div className="font-medium text-slate-900">{event.eventType}</div>
                                      <div className="mt-1 text-xs text-slate-500">{event.identifierType ?? '未标注 identifierType'}</div>
                                    </td>
                                    <td className="px-4 py-3 align-top text-xs text-slate-600">{event.authSource}</td>
                                    <td className="px-4 py-3 align-top">
                                      <div className="font-medium text-slate-900">{event.resultCode}</div>
                                      {event.resultMessage ? <div className="mt-1 text-xs text-slate-500">{event.resultMessage}</div> : null}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {detailTab === 'activity' ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 p-4">
                        <h4 className="mb-3 text-sm font-semibold text-slate-900">时间轴</h4>
                        <dl className="space-y-2 text-sm text-slate-700">
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">注册时间</dt>
                            <dd className="text-right">{formatDateTime(detail.user.createdAt)}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">最近登录</dt>
                            <dd className="text-right">{formatDateTime(detail.user.lastLoginAt)}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">最近活跃</dt>
                            <dd className="text-right">{formatDateTime(detail.user.lastActiveAt)}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt className="text-slate-500">最近 Auth 审计</dt>
                            <dd className="text-right">{formatDateTime(detail.user.auth.latestAuthEventAt)}</dd>
                          </div>
                        </dl>
                      </div>

                      <div className="rounded-2xl border border-slate-200 p-4">
                        <h4 className="mb-3 text-sm font-semibold text-slate-900">账号健康度</h4>
                        <div className="space-y-3 text-sm text-slate-700">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            最近 24 小时 Auth 成功 {formatNumber(detail.user.auth.authSuccess24h)} 次，失败{' '}
                            {formatNumber(detail.user.auth.authFailures24h)} 次。
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            最近 7 天 Auth 失败 {formatNumber(detail.user.auth.authFailures7d)} 次。若这里异常升高，再结合安全审计标签页查看失败原因。
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
