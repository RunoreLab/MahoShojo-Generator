import type { FilterState, UserAccountListItem } from '@/components/admin/user-account/shared';
import { StatusPill, formatDateTime, formatNumber } from '@/components/admin/user-account/shared';

type AdminUserAccountUserTableProps = {
  total: number;
  page: number;
  totalPages: number;
  users: UserAccountListItem[];
  selectedIds: Set<number>;
  selectedUserId: number | null;
  listLoading: boolean;
  batchLoading: boolean;
  filters: FilterState;
  handleSelectAll: (checked: boolean) => void;
  handleToggleSelected: (userId: number) => void;
  handleOpenUser: (userId: number) => Promise<void>;
  runBatchAction: (action: 'set_exempt' | 'remove_exempt' | 'ban' | 'unban', userIds?: number[]) => Promise<void>;
  pushRoute: (nextFilters: FilterState, nextPage: number, nextUsername?: string) => Promise<void>;
};

export function AdminUserAccountUserTable(props: AdminUserAccountUserTableProps) {
  const {
    total,
    page,
    totalPages,
    users,
    selectedIds,
    selectedUserId,
    listLoading,
    batchLoading,
    filters,
    handleSelectAll,
    handleToggleSelected,
    handleOpenUser,
    runBatchAction,
    pushRoute,
  } = props;

  return (
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
                <input type="checkbox" checked={users.length > 0 && selectedIds.size === users.length} onChange={(event) => handleSelectAll(event.target.checked)} />
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
                      <input type="checkbox" checked={selectedIds.has(user.id)} onChange={() => handleToggleSelected(user.id)} />
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
                      {user.auth.authEmail && user.auth.authEmail !== user.businessEmail ? <div className="mt-1 text-xs text-amber-700">Auth 邮箱：{user.auth.authEmail}</div> : null}
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
  );
}
