import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import { Search } from 'lucide-react';

import type { ActivityFilter, AuthStateFilter, FilterState, SortBy, SortOrder, StatusFilter } from '@/components/admin/user-account/shared';

type AdminUserAccountFiltersProps = {
  draftFilters: FilterState;
  setDraftFilters: Dispatch<SetStateAction<FilterState>>;
  applyFilters: () => Promise<void>;
  clearFilters: () => Promise<void>;
  updateActivityFilter: (value: ActivityFilter) => void;
  updateActiveDateFilter: (key: 'activeDateStart' | 'activeDateEnd', value: string) => void;
  pushRoute: (nextFilters: FilterState, nextPage: number, nextUsername?: string) => Promise<void>;
};

export function AdminUserAccountFilters(props: AdminUserAccountFiltersProps) {
  const { draftFilters, setDraftFilters, applyFilters, clearFilters, updateActivityFilter, updateActiveDateFilter, pushRoute } = props;

  const handleSearchEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') void applyFilters();
  };

  return (
    <div className="mb-5 rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm backdrop-blur">
      <div className="grid gap-3 lg:grid-cols-6">
        <label className="lg:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-600">搜索</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={draftFilters.search}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, search: event.target.value }))}
              onKeyDown={handleSearchEnter}
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
        <button type="button" onClick={() => void applyFilters()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          应用筛选
        </button>
        <button type="button" onClick={() => void clearFilters()} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          重置
        </button>
      </div>
    </div>
  );
}
