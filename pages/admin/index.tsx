import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Activity,
  BarChart3,
  BookOpen,
  Clock,
  Database,
  FileCheck,
  FileText,
  HardDrive,
  ShieldAlert,
  ShieldCheck,
  Tags,
  Trophy,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react';

import { encyclopediaEntries } from '@/lib/encyclopedia';

type DashboardSection = 'core' | 'activity' | 'accounts' | 'arena' | 'pvp' | 'tags' | 'storage';
type SectionStatus = 'idle' | 'loading' | 'loaded' | 'error';

type DashboardStats = {
  totalUsers: number;
  totalDataCards: number;
  pendingReviewCount: number;
  bannedUsersCount: number;
  bannedDataCardsCount: number;
  newUsersToday: number;
  newDataCardsToday: number;
  battleReportGenerationsToday: number;
  battleReportGenerationsAbortFailToday: number;
  battleReportGenerationAbortFailRateToday: number;
  activeUsers24h: number;
  activeUsers7d: number;
  activityTrackingOk: boolean;
  serverTimeIso: string;
  d1NowLocal: string | null;

  arenaRatingsStrictTotal: number;
  arenaRatingsFreeTotal: number;
  arenaRatingEventsPendingTotal: number;
  arenaRatingEventsTodayTotal: number;
  arenaRatingEventsAppliedTodayTotal: number;
  arenaRatingEventsSkippedTodayTotal: number;
  arenaRatingEventsFailedTodayTotal: number;
  leaderboardEligibleStrictDataCardTotal: number;
  leaderboardEligibleFreeDataCardTotal: number;

  dataCardMetricsTotal: number;
  publicApprovedCharacterCardsTotal: number;
  publicApprovedCharacterMetricsTotal: number;
  activeTagsTotal: number;
  tagAliasesTotal: number;
  dataCardTagsTotal: number;

  largeObjectsTotal: number;
  largeObjectsStoredBytesTotal: number;
  largeObjectsBattleReportOutputTotal: number;
  largeObjectsBattleReportOutputBytesTotal: number;

  authLinkedUsersCount: number;
  legacyOnlyUsersCount: number;
  authEmailUnverifiedUsersCount: number;
  authSuccess24h: number;
  authFailure24h: number;

  pvpOpenRoomsTotal: number;
  pvpActiveRoomsTotal: number;
  pvpStalledRoomsTotal: number;
  pvpActiveMatchesTotal: number;
  pvpMatches7dTotal: number;
};

function StatCard(props: {
  title: string;
  value: string | number;
  note?: string;
  icon: React.ElementType;
  color: string;
}) {
  const { title, value, note, icon: Icon, color } = props;
  return (
    <div className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-sm backdrop-blur">
      <div className="mb-3 flex items-center gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-full ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-600">{title}</p>
          <p className="text-2xl font-semibold text-slate-900">{value}</p>
        </div>
      </div>
      {note ? <p className="text-xs leading-5 text-slate-500">{note}</p> : null}
    </div>
  );
}

function ModuleCard(props: { href: string; title: string; description: string; tone: string; icon: React.ElementType; badge?: string }) {
  const { href, title, description, tone, icon: Icon, badge } = props;
  return (
    <Link href={href} className={`group block rounded-2xl border ${tone} bg-white/85 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white transition group-hover:scale-105">
            <Icon className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        </div>
        {badge ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500">{badge}</span> : null}
      </div>
      <p className="text-sm leading-6 text-slate-600">{description}</p>
    </Link>
  );
}

const formatPercent = (value: number): string => `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;

const formatServerTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};

const formatBytes = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let current = value;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
};

export default function AdminHomePage() {
  const router = useRouter();
  const controllersRef = useRef<Record<DashboardSection, AbortController | null>>({
    core: null,
    activity: null,
    accounts: null,
    arena: null,
    pvp: null,
    tags: null,
    storage: null,
  });

  const [stats, setStats] = useState<Partial<DashboardStats>>({});
  const [sectionStatus, setSectionStatus] = useState<Record<DashboardSection, SectionStatus>>({
    core: 'idle',
    activity: 'idle',
    accounts: 'idle',
    arena: 'idle',
    pvp: 'idle',
    tags: 'idle',
    storage: 'idle',
  });
  const [sectionError, setSectionError] = useState<Record<DashboardSection, string | null>>({
    core: null,
    activity: null,
    accounts: null,
    arena: null,
    pvp: null,
    tags: null,
    storage: null,
  });
  const [loading, setLoading] = useState(true);
  const [quickJumpTarget, setQuickJumpTarget] = useState<'user' | 'dataCard' | 'battleReport'>('user');
  const [quickJumpValue, setQuickJumpValue] = useState('');
  const [quickJumpError, setQuickJumpError] = useState<string | null>(null);

  useEffect(() => {
    const abort = (section: DashboardSection) => {
      controllersRef.current[section]?.abort();
      controllersRef.current[section] = null;
    };

    const loadSection = async (section: DashboardSection, initial = false) => {
      abort(section);
      const controller = new AbortController();
      controllersRef.current[section] = controller;
      setSectionStatus((prev) => ({ ...prev, [section]: 'loading' }));
      setSectionError((prev) => ({ ...prev, [section]: null }));

      try {
        const response = await fetch(`/api/admin/dashboard-stats?section=${section}`, {
          signal: controller.signal,
        });
        const json = (await response.json()) as { success?: boolean; stats?: Partial<DashboardStats>; error?: string };
        if (!response.ok || !json.success) {
          throw new Error(json.error || `读取 ${section} 统计失败`);
        }
        setStats((prev) => ({ ...prev, ...(json.stats ?? {}) }));
        setSectionStatus((prev) => ({ ...prev, [section]: 'loaded' }));
      } catch (error) {
        if (controller.signal.aborted) return;
        setSectionStatus((prev) => ({ ...prev, [section]: 'error' }));
        setSectionError((prev) => ({ ...prev, [section]: error instanceof Error ? error.message : '未知错误' }));
      } finally {
        if (controllersRef.current[section] === controller) {
          controllersRef.current[section] = null;
        }
        if (section === 'core' && initial) {
          setLoading(false);
        }
      }
    };

    void loadSection('core', true);
    void loadSection('activity');
    void loadSection('accounts');
    void loadSection('arena');
    void loadSection('pvp');
    void loadSection('tags');
    const storageTimer = window.setTimeout(() => void loadSection('storage'), 1000);

    const coreTimer = window.setInterval(() => void loadSection('core'), 60_000);
    const accountsTimer = window.setInterval(() => void loadSection('accounts'), 2 * 60_000);
    const arenaTimer = window.setInterval(() => void loadSection('arena'), 2 * 60_000);
    const pvpTimer = window.setInterval(() => void loadSection('pvp'), 90_000);
    const activityTimer = window.setInterval(() => void loadSection('activity'), 5 * 60_000);
    const tagsTimer = window.setInterval(() => void loadSection('tags'), 5 * 60_000);
    const storageRefreshTimer = window.setInterval(() => void loadSection('storage'), 10 * 60_000);
    const controllerMap = controllersRef.current;

    return () => {
      window.clearTimeout(storageTimer);
      window.clearInterval(coreTimer);
      window.clearInterval(accountsTimer);
      window.clearInterval(arenaTimer);
      window.clearInterval(pvpTimer);
      window.clearInterval(activityTimer);
      window.clearInterval(tagsTimer);
      window.clearInterval(storageRefreshTimer);
      (Object.keys(controllerMap) as DashboardSection[]).forEach(abort);
    };
  }, []);

  const handleQuickJump = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = quickJumpValue.trim();
    if (!value) {
      setQuickJumpError('请输入要跳转的目标。');
      return;
    }

    setQuickJumpError(null);
    if (quickJumpTarget === 'user') {
      await router.push({ pathname: '/admin/users', query: { search: value } });
      return;
    }
    if (quickJumpTarget === 'dataCard') {
      await router.push({ pathname: '/admin/character-management', query: { id: value } });
      return;
    }
    await router.push({ pathname: '/admin/battle-report-generations', query: { id: value } });
  };

  const activityCoverage =
    typeof stats.activeUsers7d === 'number' && typeof stats.totalUsers === 'number' && stats.totalUsers > 0
      ? stats.activeUsers7d / stats.totalUsers
      : 0;

  const moduleGroups = [
    {
      title: '用户与账号',
      items: [
        {
          href: '/admin/users',
          title: '用户与账号',
          description: '统一查看业务用户、Better Auth 建链、迁移状态、邮件验证与 Auth 安全审计。',
          tone: 'border-sky-200 hover:border-sky-300',
          icon: UserCog,
          badge: '新结构',
        },
        {
          href: '/admin/user-analytics',
          title: '用户统计分析',
          description: '查看用户规模、高频分层、留存与活跃构成；趋势与导出会在该页持续演进。',
          tone: 'border-indigo-200 hover:border-indigo-300',
          icon: BarChart3,
        },
        {
          href: '/admin/badge-management',
          title: '徽章管理',
          description: '创建徽章、授予与撤销用户徽章，维护平台身份与荣誉体系。',
          tone: 'border-amber-200 hover:border-amber-300',
          icon: Trophy,
        },
      ],
    },
    {
      title: '内容与审核',
      items: [
        {
          href: '/admin/content-management',
          title: '内容管理',
          description: '审核数据卡、批量操作、AI 审查与待审核更新处理。',
          tone: 'border-purple-200 hover:border-purple-300',
          icon: FileCheck,
        },
        {
          href: '/admin/character-management',
          title: '角色管理',
          description: '快速查看和编辑单个数据卡，处理具体内容问题。',
          tone: 'border-pink-200 hover:border-pink-300',
          icon: FileText,
        },
        {
          href: '/admin/tag-management',
          title: '标签库管理',
          description: '维护 tags、tag_aliases 与标签绑定关系。',
          tone: 'border-slate-200 hover:border-slate-300',
          icon: Tags,
        },
      ],
    },
    {
      title: '竞技场与排位',
      items: [
        {
          href: '/admin/arena-ratings',
          title: '排位运维',
          description: '查看 strict / free 排位记录，处理积分、榜单与资格问题。',
          tone: 'border-cyan-200 hover:border-cyan-300',
          icon: Trophy,
        },
        {
          href: '/admin/arena-rating-events',
          title: '排位事件审计',
          description: '检索 arena_rating_events，查看 before / delta / after 与 skip_reason。',
          tone: 'border-rose-200 hover:border-rose-300',
          icon: Activity,
        },
        {
          href: '/admin/battle-report-generations',
          title: '战报生成记录',
          description: '跟踪战报生成、失败、中断与对象落库情况。',
          tone: 'border-orange-200 hover:border-orange-300',
          icon: FileText,
        },
      ],
    },
    {
      title: 'PVP / 存储 / 运维',
      items: [
        {
          href: '/admin/pvp',
          title: 'PVP 只读后台',
          description: '查看活跃房间、最近对局与卡死房间信号，当前版本不提供房间干预。',
          tone: 'border-emerald-200 hover:border-emerald-300',
          icon: ShieldCheck,
          badge: '只读',
        },
        {
          href: '/admin/large-objects',
          title: '大对象管理',
          description: '管理 large_objects / R2 索引，当前仍以战报正文对象为主。',
          tone: 'border-teal-200 hover:border-teal-300',
          icon: HardDrive,
        },
        {
          href: '/admin/data-maintenance',
          title: '数据库清理',
          description: '按表与任务清理历史数据，为战报、PVP、排位与扩展子域做瘦身。',
          tone: 'border-violet-200 hover:border-violet-300',
          icon: Database,
        },
      ],
    },
  ];

  return (
    <>
      <Head>
        <title>管理后台 - MahoShojo Generator</title>
      </Head>

      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.12),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] p-4 sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.22em] text-sky-700">Admin Console</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-900">MahoShojo Generator</h1>
              <p className="mt-2 text-sm text-slate-600">
                后台首页已按领域重组为用户与账号、内容与审核、竞技场与排位、PVP、存储与资产、运维与清理。
              </p>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/90 px-4 py-3 text-sm text-slate-600 shadow-sm backdrop-blur">
              服务器时间：{formatServerTime(stats.serverTimeIso)}
              {stats.d1NowLocal ? <span className="block text-xs text-slate-500">D1 local: {stats.d1NowLocal}</span> : null}
            </div>
          </div>

          <div className="mb-8 rounded-2xl border border-white/70 bg-white/90 p-5 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">快捷跳转</h2>
                <p className="mt-1 text-xs text-slate-500">支持用户（ID / 用户名 / 邮箱）、数据卡 ID、战报 ID。</p>
              </div>
              <form onSubmit={handleQuickJump} className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                <select
                  value={quickJumpTarget}
                  onChange={(event) => setQuickJumpTarget(event.target.value as typeof quickJumpTarget)}
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm"
                >
                  <option value="user">用户</option>
                  <option value="dataCard">数据卡</option>
                  <option value="battleReport">战报</option>
                </select>
                <input
                  value={quickJumpValue}
                  onChange={(event) => setQuickJumpValue(event.target.value)}
                  placeholder={quickJumpTarget === 'user' ? '例如：123 / alice / alice@example.com' : '请输入对象 ID'}
                  className="h-10 min-w-[18rem] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm"
                />
                <button type="submit" className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800">
                  跳转
                </button>
              </form>
            </div>
            {quickJumpError ? <p className="mt-2 text-xs text-red-600">{quickJumpError}</p> : null}
          </div>

          <div className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">平台概览</h2>
              {loading ? <span className="text-xs text-slate-500">正在加载核心统计…</span> : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <StatCard
                title="待审查内容"
                value={loading ? '加载中…' : String(stats.pendingReviewCount ?? 0)}
                note="包含待审卡片与待审核更新"
                icon={Clock}
                color="bg-amber-500"
              />
              <StatCard
                title="今日新增用户"
                value={loading ? '加载中…' : String(stats.newUsersToday ?? 0)}
                note={`用户总数 ${stats.totalUsers ?? 0}`}
                icon={UserPlus}
                color="bg-emerald-600"
              />
              <StatCard
                title="活跃用户（7d）"
                value={stats.activityTrackingOk ? String(stats.activeUsers7d ?? 0) : '未启用'}
                note={stats.activityTrackingOk ? `覆盖率 ${formatPercent(activityCoverage)}` : '需要 user_last_activity 支撑'}
                icon={Users}
                color="bg-violet-600"
              />
              <StatCard
                title="今日战报生成"
                value={String(stats.battleReportGenerationsToday ?? 0)}
                note={`中断/失败 ${stats.battleReportGenerationsAbortFailToday ?? 0}（${formatPercent(stats.battleReportGenerationAbortFailRateToday ?? 0)}）`}
                icon={FileText}
                color="bg-fuchsia-600"
              />
              <StatCard
                title="公共榜技术值覆盖"
                value={
                  typeof stats.publicApprovedCharacterCardsTotal === 'number' && stats.publicApprovedCharacterCardsTotal > 0
                    ? formatPercent((stats.publicApprovedCharacterMetricsTotal ?? 0) / stats.publicApprovedCharacterCardsTotal)
                    : '—'
                }
                note={`标签 ${stats.activeTagsTotal ?? 0} · 百科 ${encyclopediaEntries.length}`}
                icon={BookOpen}
                color="bg-indigo-600"
              />
            </div>
          </div>

          <div className="mb-8 grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-sm backdrop-blur">
              <h3 className="mb-4 text-lg font-semibold text-slate-900">账号迁移</h3>
              <div className="space-y-3">
                <StatCard title="Legacy Only" value={String(stats.legacyOnlyUsersCount ?? 0)} icon={ShieldAlert} color="bg-rose-600" />
                <StatCard title="已建链用户" value={String(stats.authLinkedUsersCount ?? 0)} icon={ShieldCheck} color="bg-sky-600" />
                <StatCard title="邮箱未验证" value={String(stats.authEmailUnverifiedUsersCount ?? 0)} icon={Users} color="bg-amber-600" />
                <StatCard
                  title="Auth 24h 成功 / 失败"
                  value={`${stats.authSuccess24h ?? 0} / ${stats.authFailure24h ?? 0}`}
                  note="当前口径为 auth_audit_logs 审计事件"
                  icon={Activity}
                  color="bg-slate-700"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-sm backdrop-blur">
              <h3 className="mb-4 text-lg font-semibold text-slate-900">竞技场与排位</h3>
              <div className="space-y-3">
                <StatCard title="严格 / 自由排位" value={`${stats.arenaRatingsStrictTotal ?? 0} / ${stats.arenaRatingsFreeTotal ?? 0}`} icon={Trophy} color="bg-cyan-600" />
                <StatCard title="待处理结算事件" value={String(stats.arenaRatingEventsPendingTotal ?? 0)} icon={Clock} color="bg-amber-600" />
                <StatCard
                  title="今日结算事件"
                  value={String(stats.arenaRatingEventsTodayTotal ?? 0)}
                  note={`应用 ${stats.arenaRatingEventsAppliedTodayTotal ?? 0} · 跳过 ${stats.arenaRatingEventsSkippedTodayTotal ?? 0} · 失败 ${stats.arenaRatingEventsFailedTodayTotal ?? 0}`}
                  icon={Activity}
                  color="bg-rose-600"
                />
                <StatCard
                  title="公共榜候选（角色卡）"
                  value={`${stats.leaderboardEligibleStrictDataCardTotal ?? 0} / ${stats.leaderboardEligibleFreeDataCardTotal ?? 0}`}
                  note="严格 / 自由"
                  icon={BarChart3}
                  color="bg-sky-700"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-sm backdrop-blur">
              <h3 className="mb-4 text-lg font-semibold text-slate-900">PVP 运行时</h3>
              <div className="space-y-3">
                <StatCard title="开放房间" value={String(stats.pvpOpenRoomsTotal ?? 0)} icon={Users} color="bg-emerald-600" />
                <StatCard title="活跃房间" value={String(stats.pvpActiveRoomsTotal ?? 0)} icon={ShieldCheck} color="bg-teal-600" />
                <StatCard title="进行中对局" value={String(stats.pvpActiveMatchesTotal ?? 0)} icon={Activity} color="bg-slate-700" />
                <StatCard
                  title="卡住房间信号"
                  value={String(stats.pvpStalledRoomsTotal ?? 0)}
                  note={`近 7 天对局 ${stats.pvpMatches7dTotal ?? 0}`}
                  icon={ShieldAlert}
                  color="bg-orange-600"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-white/70 bg-white/90 p-5 shadow-sm backdrop-blur">
              <h3 className="mb-4 text-lg font-semibold text-slate-900">存储与对象</h3>
              <div className="space-y-3">
                <StatCard title="large_objects 索引数" value={String(stats.largeObjectsTotal ?? 0)} icon={HardDrive} color="bg-emerald-700" />
                <StatCard
                  title="R2 索引占用"
                  value={formatBytes(stats.largeObjectsStoredBytesTotal)}
                  note={`战报正文对象 ${stats.largeObjectsBattleReportOutputTotal ?? 0} 条`}
                  icon={Database}
                  color="bg-emerald-600"
                />
                <StatCard
                  title="战报正文原始体积"
                  value={formatBytes(stats.largeObjectsBattleReportOutputBytesTotal)}
                  icon={FileText}
                  color="bg-cyan-700"
                />
                <StatCard
                  title="标签 / 绑定 / 别名"
                  value={`${stats.activeTagsTotal ?? 0} / ${stats.dataCardTagsTotal ?? 0} / ${stats.tagAliasesTotal ?? 0}`}
                  icon={Tags}
                  color="bg-slate-700"
                />
              </div>
            </div>
          </div>

          <div className="space-y-8">
            {moduleGroups.map((group) => (
              <section key={group.title}>
                <h2 className="mb-4 text-xl font-semibold text-slate-900">{group.title}</h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {group.items.map((item) => (
                    <ModuleCard key={item.href} {...item} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {(Object.values(sectionStatus) as SectionStatus[]).some((status) => status === 'error') ? (
            <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              部分统计读取失败：
              {(['accounts', 'arena', 'pvp', 'tags', 'storage', 'activity', 'core'] as DashboardSection[])
                .filter((section) => sectionStatus[section] === 'error')
                .map((section) => `${section}(${sectionError[section] || '未知错误'})`)
                .join('；')}
            </div>
          ) : null}

          <div className="mt-10 text-center">
            <Link href="/" className="text-sm text-slate-500 hover:text-sky-700 hover:underline">
              返回应用首页
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
