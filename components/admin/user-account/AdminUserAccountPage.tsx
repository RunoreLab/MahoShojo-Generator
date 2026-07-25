import React, { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { usePagesRouterCompat as useRouter } from '@/lib/admin/pages-router-compat';
import { AlertTriangle, MailCheck, RefreshCw, ShieldAlert, ShieldCheck, Users } from 'lucide-react';

import { AdminUserAccountDetailPanel } from '@/components/admin/user-account/AdminUserAccountDetailPanel';
import { AdminUserAccountFilters } from '@/components/admin/user-account/AdminUserAccountFilters';
import { AdminUserAccountUserTable } from '@/components/admin/user-account/AdminUserAccountUserTable';
import {
  DEFAULT_FILTERS,
  type ActivityFilter,
  type AuthStateFilter,
  type DetailResponse,
  type DetailTab,
  type EditorState,
  type FilterState,
  type ListResponse,
  type SortBy,
  type SortOrder,
  type StatusFilter,
  type UserAccountDetail,
  type UserAccountListItem,
  type UserAccountSummary,
  SummaryCard,
  assignTrimmedQueryValue,
  formatNumber,
} from '@/components/admin/user-account/shared';

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
              <p className="mt-1 text-sm text-slate-600">统一查看业务用户、Auth 建链、迁移状态与安全审计。当前 Auth 失败计数口径为审计事件失败，不等同于纯登录失败。</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/admin/user-analytics" className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-sky-700 shadow-sm hover:bg-sky-50">
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

          {message ? <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

          {summary ? (
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              {summaryCards.map((card) => (
                <SummaryCard key={card.title} {...card} />
              ))}
            </div>
          ) : null}

          <AdminUserAccountFilters
            draftFilters={draftFilters}
            setDraftFilters={setDraftFilters}
            applyFilters={applyFilters}
            clearFilters={clearFilters}
            updateActivityFilter={updateActivityFilter}
            updateActiveDateFilter={updateActiveDateFilter}
            pushRoute={pushRoute}
          />

          {error ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
            <div className="space-y-4">
              <AdminUserAccountUserTable
                total={total}
                page={page}
                totalPages={totalPages}
                users={users}
                selectedIds={selectedIds}
                selectedUserId={selectedUserId}
                listLoading={listLoading}
                batchLoading={batchLoading}
                filters={filters}
                handleSelectAll={handleSelectAll}
                handleToggleSelected={handleToggleSelected}
                handleOpenUser={handleOpenUser}
                runBatchAction={runBatchAction}
                pushRoute={pushRoute}
              />
            </div>

            <AdminUserAccountDetailPanel
              selectedUser={selectedUser}
              detail={detail}
              detailLoading={detailLoading}
              detailError={detailError}
              detailTab={detailTab}
              setDetailTab={setDetailTab}
              editor={editor}
              setEditor={setEditor}
              saving={saving}
              loadDetail={loadDetail}
              runBatchAction={runBatchAction}
              saveCurrentUser={saveCurrentUser}
            />
          </div>
        </div>
      </div>
    </>
  );
}
