// pages/admin/index.tsx

import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FileText, Users, FileCheck, UserCog, Clock, UserPlus, FilePlus, AlertTriangle, ShieldOff, Award, Tags, BarChart3, Activity, HardDrive, Trophy, Cpu, BookOpen, Database } from 'lucide-react';

import { encyclopediaEntries } from '@/lib/encyclopedia';

/**
 * @fileoverview 后台管理系统的统一入口和数据仪表盘。
 * @description
 * 该页面现在具备以下功能：
 * 1. 在页面加载时，异步从新的API端点获取平台核心统计数据。
 * 2. 以信息卡片的形式直观展示这些数据，为管理员提供快速概览。
 * 3. 保留原有的四大管理模块入口，并优化了视觉样式。
 */

// 定义统计数据和单个统计卡片的类型
interface DashboardStats {
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
  d1NowUtc: string | null;
  d1NowLocal: string | null;
  d1PageCount: number | null;
  d1PageSize: number | null;
  d1FreelistCount: number | null;
  d1EstimatedFileBytes: number | null;
  d1EstimatedUsedBytes: number | null;

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
  largeObjectsBytesTotal: number;
  largeObjectsStoredBytesTotal: number;
  largeObjectsBattleReportOutputTotal: number;
  largeObjectsBattleReportOutputBytesTotal: number;
}

interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  note?: string;
}

// 统计卡片组件
const StatCard: React.FC<StatCardProps> = ({ title, value, icon: Icon, color, note }) => (
  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-between">
    <div>
      <p className="text-gray-500 text-sm font-medium mb-2">{title}</p>
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div>
          <p className="text-3xl font-bold text-gray-800">{value}</p>
        </div>
      </div>
    </div>
    {note && <p className="text-xs text-gray-400 mt-3">{note}</p>}
  </div>
);


const AdminHomePage: React.FC = () => {
  const router = useRouter();
  // 定义存储统计数据和加载状态的state
  type DashboardSection = 'core' | 'arena' | 'activity' | 'tags' | 'storage';
  type SectionStatus = 'idle' | 'loading' | 'loaded' | 'error';

  const [stats, setStats] = useState<Partial<DashboardStats>>({});
  const [sectionStatus, setSectionStatus] = useState<Record<DashboardSection, SectionStatus>>({
    core: 'idle',
    arena: 'idle',
    activity: 'idle',
    tags: 'idle',
    storage: 'idle',
  });
  const [sectionError, setSectionError] = useState<Record<DashboardSection, string | null>>({
    core: null,
    arena: null,
    activity: null,
    tags: null,
    storage: null,
  });

  const [loading, setLoading] = useState(true); // 仅首屏核心统计
  const [refreshing, setRefreshing] = useState(false); // 仅核心统计的定时刷新提示
  const hasLoadedRef = useRef(false);
  const controllersRef = useRef<Record<DashboardSection, AbortController | null>>({
    core: null,
    arena: null,
    activity: null,
    tags: null,
    storage: null,
  });
  const [lastServerTimeIso, setLastServerTimeIso] = useState<string | null>(null);
  const [lastD1NowLocal, setLastD1NowLocal] = useState<string | null>(null);

  const [quickJumpTarget, setQuickJumpTarget] = useState<'user' | 'dataCard' | 'battleReport'>('user');
  const [quickJumpValue, setQuickJumpValue] = useState('');
  const [quickJumpError, setQuickJumpError] = useState<string | null>(null);

  // 在组件挂载时通过useEffect获取数据
  useEffect(() => {
    const abortInFlight = (section: DashboardSection) => {
      controllersRef.current[section]?.abort();
      controllersRef.current[section] = null;
    };

    const fetchSection = async (section: DashboardSection) => {
      abortInFlight(section);
      const controller = new AbortController();
      controllersRef.current[section] = controller;

      const isInitialCore = section === 'core' && !hasLoadedRef.current;
      setSectionStatus((prev) => ({ ...prev, [section]: 'loading' }));
      setSectionError((prev) => ({ ...prev, [section]: null }));
      if (section === 'core') {
        if (isInitialCore) setLoading(true);
        else setRefreshing(true);
      }

      try {
        const response = await fetch(`/api/admin/dashboard-stats?section=${encodeURIComponent(section)}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error('获取统计数据失败');
        }
        const data = await response.json();
        if (data.success) {
          const partial = (data.stats ?? {}) as Partial<DashboardStats>;
          setStats((prev) => ({ ...prev, ...partial }));
          if (section === 'core') {
            setLastServerTimeIso(typeof partial.serverTimeIso === 'string' ? partial.serverTimeIso : null);
            setLastD1NowLocal(typeof partial.d1NowLocal === 'string' ? partial.d1NowLocal : null);
          }
          setSectionStatus((prev) => ({ ...prev, [section]: 'loaded' }));
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.error(error);
        setSectionStatus((prev) => ({ ...prev, [section]: 'error' }));
        setSectionError((prev) => ({ ...prev, [section]: error instanceof Error ? error.message : '未知错误' }));
      } finally {
        if (controllersRef.current[section] === controller) {
          controllersRef.current[section] = null;
        }
        if (section === 'core') {
          if (isInitialCore) {
            hasLoadedRef.current = true;
            setLoading(false);
          }
          setRefreshing(false);
        }
      }
    };

    void fetchSection('core');
    void fetchSection('arena');
    void fetchSection('activity');
    void fetchSection('tags');
    const storageDelayTimer = setTimeout(() => void fetchSection('storage'), 1_200);

    // 为了让"服务器时间"与当日统计更接近实时，这里定时刷新（避免频繁请求）
    const coreTimer = setInterval(() => void fetchSection('core'), 60_000);
    const arenaTimer = setInterval(() => void fetchSection('arena'), 60_000);
    const activityTimer = setInterval(() => void fetchSection('activity'), 10 * 60_000);
    const tagsTimer = setInterval(() => void fetchSection('tags'), 5 * 60_000);
    const storageTimer = setInterval(() => void fetchSection('storage'), 10 * 60_000);

    return () => {
      clearTimeout(storageDelayTimer);
      clearInterval(coreTimer);
      clearInterval(arenaTimer);
      clearInterval(activityTimer);
      clearInterval(tagsTimer);
      clearInterval(storageTimer);
      abortInFlight('core');
      abortInFlight('arena');
      abortInFlight('activity');
      abortInFlight('tags');
      abortInFlight('storage');
    };
  }, []);

  const formatPercent = (rate: number) => `${(Math.max(0, Math.min(1, rate)) * 100).toFixed(1)}%`;
  const formatServerTime = (iso: string | null) => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return `${date.toISOString().replace('T', ' ').replace('Z', ' UTC')}`;
  };
  const formatBytes = (bytes: number | null | undefined) => {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = bytes;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
      v /= 1024;
      u += 1;
    }
    return `${v.toFixed(u === 0 ? 0 : 2)} ${units[u]}`;
  };

  const handleQuickJump = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = quickJumpValue.trim();
    if (!value) {
      setQuickJumpError('请输入要跳转的目标。');
      return;
    }

    setQuickJumpError(null);

    if (quickJumpTarget === 'user') {
      await router.push({ pathname: '/admin/user-dashboard', query: { search: value } });
      return;
    }

    if (quickJumpTarget === 'dataCard') {
      await router.push({ pathname: '/admin/character-management', query: { id: value } });
      return;
    }

    await router.push({ pathname: '/admin/battle-report-generations', query: { id: value } });
  };

  const arenaReady = sectionStatus.arena === 'loaded';
  const activityReady = sectionStatus.activity === 'loaded';
  const tagsReady = sectionStatus.tags === 'loaded';
  const storageReady = sectionStatus.storage === 'loaded';

  const leaderboardEligibleValue = arenaReady
    ? `${stats.leaderboardEligibleStrictDataCardTotal ?? 0} / ${stats.leaderboardEligibleFreeDataCardTotal ?? 0}`
    : sectionStatus.arena === 'error'
      ? '—'
      : '加载中…';

  const publicApprovedCharacterCards = tagsReady ? (stats.publicApprovedCharacterCardsTotal ?? 0) : null;
  const publicApprovedCharacterMetrics = tagsReady ? (stats.publicApprovedCharacterMetricsTotal ?? 0) : null;
  const publicTechCoverageRate =
    typeof publicApprovedCharacterCards === 'number' && publicApprovedCharacterCards > 0 && typeof publicApprovedCharacterMetrics === 'number'
      ? publicApprovedCharacterMetrics / publicApprovedCharacterCards
      : 0;
  const publicTechCoverageValue = tagsReady
    ? formatPercent(publicTechCoverageRate)
    : sectionStatus.tags === 'error'
      ? '—'
      : '加载中…';

  const activityTrackingOk = activityReady ? Boolean(stats.activityTrackingOk) : false;
  const activeUsers24hValue = activityReady
    ? activityTrackingOk
      ? (stats.activeUsers24h ?? 0)
      : '未启用'
    : sectionStatus.activity === 'error'
      ? '—'
      : '加载中…';
  const activeUsers7dValue = activityReady
    ? activityTrackingOk
      ? (stats.activeUsers7d ?? 0)
      : '未启用'
    : sectionStatus.activity === 'error'
      ? '—'
      : '加载中…';
  const activeUsers7dRate =
    activityReady && activityTrackingOk && typeof stats.activeUsers7d === 'number' && typeof stats.totalUsers === 'number' && stats.totalUsers > 0
      ? stats.activeUsers7d / stats.totalUsers
      : 0;

  return (
    <>
      <Head>
        <title>管理后台 - MahoShojo Generator</title>
      </Head>
      <div className="min-h-screen bg-gray-100 p-4 sm:p-6 md:p-8">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-10">
            <h1 className="text-4xl font-bold text-gray-800 tracking-tight">MahoShojo Generator</h1>
            <p className="text-lg text-gray-500 mt-2">管理仪表盘</p>
          </div>

          <div className="mb-10 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-gray-800">快捷跳转</h2>
                <p className="text-xs text-gray-500">支持用户（ID/用户名/邮箱）、数据卡 ID、战报 ID。</p>
              </div>
              <form onSubmit={handleQuickJump} className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <label className="sr-only" htmlFor="quick-jump-target">
                  跳转类型
                </label>
                <select
                  id="quick-jump-target"
                  value={quickJumpTarget}
                  onChange={(e) => setQuickJumpTarget(e.target.value as typeof quickJumpTarget)}
                  className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm focus:border-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-200"
                >
                  <option value="user">用户</option>
                  <option value="dataCard">数据卡</option>
                  <option value="battleReport">战报</option>
                </select>

                <label className="sr-only" htmlFor="quick-jump-value">
                  跳转目标
                </label>
                <input
                  id="quick-jump-value"
                  value={quickJumpValue}
                  onChange={(e) => setQuickJumpValue(e.target.value)}
                  placeholder={quickJumpTarget === 'user' ? '例如：123 / alice / alice@example.com' : '粘贴 ID...'}
                  className="h-9 w-full min-w-[16rem] flex-1 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm placeholder:text-gray-400 focus:border-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-200 sm:w-72"
                />

                <button type="submit" className="admin-button-sm h-9 justify-center bg-gray-900 text-white hover:bg-gray-800">
                  跳转
                </button>
              </form>
            </div>
            {quickJumpError ? <p className="mt-2 text-xs text-red-600">{quickJumpError}</p> : null}
          </div>

          {/* 数据统计卡片区域 */}
          <div className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-700">平台概览</h2>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Clock className="w-4 h-4" />
                <span>
                  服务器时间：{formatServerTime(lastServerTimeIso)}
                  {lastD1NowLocal ? `（D1 local: ${lastD1NowLocal}）` : ''}
                  {refreshing ? '（刷新中...）' : ''}
                </span>
              </div>
            </div>
            {loading ? (
              <div className="text-center p-8 bg-white rounded-lg shadow-sm">加载中...</div>
            ) : (
              <div className="space-y-8">
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
                  <StatCard title="待审查内容" value={stats?.pendingReviewCount ?? 0} icon={Clock} color="bg-yellow-500" note="需要管理员尽快处理" />
                  <StatCard title="今日新增用户" value={stats?.newUsersToday ?? 0} icon={UserPlus} color="bg-green-500" />
                  <StatCard title="今日新增档案" value={stats?.newDataCardsToday ?? 0} icon={FilePlus} color="bg-blue-500" />
                  <StatCard
                    title="今日战报生成"
                    value={stats?.battleReportGenerationsToday ?? 0}
                    icon={FileText}
                    color="bg-purple-600"
                    note={`中断/失败：${stats?.battleReportGenerationsAbortFailToday ?? 0}（${formatPercent(stats?.battleReportGenerationAbortFailRateToday ?? 0)}）`}
                  />
                  <StatCard
                    title="活跃用户（24h）"
                    value={activeUsers24hValue}
                    icon={Activity}
                    color="bg-fuchsia-600"
                    note={activityTrackingOk ? '口径：已登录用户（touch）' : '需要执行 D1 schema 迁移：user_last_activity'}
                  />
                  <StatCard
                    title="活跃用户（7d）"
                    value={activeUsers7dValue}
                    icon={Users}
                    color="bg-violet-600"
                    note={activityTrackingOk ? `占比：${formatPercent(activeUsers7dRate)}（基于用户总数）` : '需要执行 D1 schema 迁移：user_last_activity'}
                  />
                  <StatCard title="违规档案总数" value={stats?.bannedDataCardsCount ?? 0} icon={AlertTriangle} color="bg-red-500" />
                  <StatCard title="用户总数" value={stats?.totalUsers ?? 0} icon={Users} color="bg-teal-500" />
                  <StatCard title="档案总数" value={stats?.totalDataCards ?? 0} icon={FileText} color="bg-indigo-500" />
                  <StatCard title="封禁用户数" value={stats?.bannedUsersCount ?? 0} icon={ShieldOff} color="bg-gray-600" />
                </div>

                <div>
                  <h3 className="mb-4 text-lg font-semibold text-gray-700">排位与排行榜</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
                    <StatCard
                      title="排位记录（严格）"
                      value={arenaReady ? (stats.arenaRatingsStrictTotal ?? 0) : sectionStatus.arena === 'error' ? '—' : '加载中…'}
                      icon={BarChart3}
                      color="bg-sky-600"
                      note="arena_ratings / strict"
                    />
                    <StatCard
                      title="排位记录（自由）"
                      value={arenaReady ? (stats.arenaRatingsFreeTotal ?? 0) : sectionStatus.arena === 'error' ? '—' : '加载中…'}
                      icon={BarChart3}
                      color="bg-cyan-600"
                      note="arena_ratings / free"
                    />
                    <StatCard
                      title="待处理结算事件"
                      value={arenaReady ? (stats.arenaRatingEventsPendingTotal ?? 0) : sectionStatus.arena === 'error' ? '—' : '加载中…'}
                      icon={Clock}
                      color="bg-amber-600"
                      note="arena_rating_events / pending"
                    />
                    <StatCard
                      title="今日结算事件"
                      value={arenaReady ? (stats.arenaRatingEventsTodayTotal ?? 0) : sectionStatus.arena === 'error' ? '—' : '加载中…'}
                      icon={Activity}
                      color="bg-rose-600"
                      note={
                        arenaReady
                          ? `应用：${stats.arenaRatingEventsAppliedTodayTotal ?? 0} · 跳过：${stats.arenaRatingEventsSkippedTodayTotal ?? 0} · 失败：${stats.arenaRatingEventsFailedTodayTotal ?? 0}`
                          : sectionStatus.arena === 'error'
                            ? sectionError.arena || '加载失败'
                            : '加载中…'
                      }
                    />
                    <StatCard title="公共榜候选（角色卡）" value={leaderboardEligibleValue} icon={Trophy} color="bg-yellow-600" note="严格 / 自由（公开+已审核+未删除）" />
                  </div>
                </div>

                <div>
                  <h3 className="mb-4 text-lg font-semibold text-gray-700">技术值 · 标签 · 百科</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
                    <StatCard
                      title="技术值覆盖（公共榜）"
                      value={publicTechCoverageValue}
                      icon={Cpu}
                      color="bg-violet-600"
                      note={
                        tagsReady
                          ? `已计算：${publicApprovedCharacterMetrics ?? 0} / ${publicApprovedCharacterCards ?? 0}`
                          : sectionStatus.tags === 'error'
                            ? sectionError.tags || '加载失败'
                            : '加载中…'
                      }
                    />
                    <StatCard
                      title="可用标签"
                      value={tagsReady ? (stats.activeTagsTotal ?? 0) : sectionStatus.tags === 'error' ? '—' : '加载中…'}
                      icon={Tags}
                      color="bg-slate-700"
                      note="tags.is_active=1"
                    />
                    <StatCard
                      title="标签别名"
                      value={tagsReady ? (stats.tagAliasesTotal ?? 0) : sectionStatus.tags === 'error' ? '—' : '加载中…'}
                      icon={Tags}
                      color="bg-slate-600"
                      note="tag_aliases"
                    />
                    <StatCard
                      title="标签绑定"
                      value={tagsReady ? (stats.dataCardTagsTotal ?? 0) : sectionStatus.tags === 'error' ? '—' : '加载中…'}
                      icon={Tags}
                      color="bg-slate-500"
                      note="data_card_tags"
                    />
                    <StatCard title="百科条目" value={encyclopediaEntries.length} icon={BookOpen} color="bg-indigo-700" note="public/encyclopedia/*.md" />
                  </div>
                </div>

                <div>
                  <h3 className="mb-4 text-lg font-semibold text-gray-700">存储与大对象</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
                    <StatCard
                      title="R2 索引占用（估算）"
                      value={
                        storageReady
                          ? formatBytes(stats.largeObjectsStoredBytesTotal ?? null)
                          : sectionStatus.storage === 'error'
                            ? '—'
                            : sectionStatus.storage === 'idle'
                              ? '稍后加载'
                              : '加载中…'
                      }
                      icon={HardDrive}
                      color="bg-emerald-700"
                      note={
                        storageReady
                          ? `large_objects：${stats.largeObjectsTotal ?? 0} 条 · 战报正文：${stats.largeObjectsBattleReportOutputTotal ?? 0} 条`
                          : sectionStatus.storage === 'error'
                            ? sectionError.storage || '加载失败'
                            : sectionStatus.storage === 'idle'
                              ? '存储统计会在首屏后延迟加载'
                              : '加载中…'
                      }
                    />
                    <StatCard
                      title="战报正文体积（原始）"
                      value={
                        storageReady
                          ? formatBytes(stats.largeObjectsBattleReportOutputBytesTotal ?? null)
                          : sectionStatus.storage === 'error'
                            ? '—'
                            : sectionStatus.storage === 'idle'
                              ? '稍后加载'
                              : '加载中…'
                      }
                      icon={FileText}
                      color="bg-emerald-600"
                      note="kind=battle_report_generation_output（未压缩估算）"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* 管理模块入口 */}
          <div>
            <h2 className="text-xl font-semibold text-gray-700 mb-4">管理工具</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Link href="/admin/content-management" legacyBehavior>
                <a className="admin-card bg-purple-50 border-purple-200 hover:border-purple-400">
                  <div className="flex items-center text-purple-700 mb-3">
                    <FileCheck className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">内容管理</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    使用高级筛选、批量操作和AI辅助工具，对所有用户创建的角色与情景数据卡进行审查和管理。
                  </p>
                </a>
              </Link>

              <Link href="/admin/user-dashboard" legacyBehavior>
                <a className="admin-card bg-blue-50 border-blue-200 hover:border-blue-400">
                  <div className="flex items-center text-blue-700 mb-3">
                    <UserCog className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">用户状态</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    使用高级筛选和批量操作工具，管理所有平台用户的状态与权限。
                  </p>
                </a>
              </Link>

              <Link href="/admin/character-management" legacyBehavior>
                <a className="admin-card bg-pink-50 border-pink-200 hover:border-pink-400">
                  <div className="flex items-center text-pink-700 mb-3">
                    <FileText className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">角色管理</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    快速查看和编辑单个角色或情景数据卡的基础信息，例如名称、描述和公开状态。
                  </p>
                </a>
              </Link>

              <Link href="/admin/user-management" legacyBehavior>
                <a className="admin-card bg-teal-50 border-teal-200 hover:border-teal-400">
                  <div className="flex items-center text-teal-700 mb-3">
                    <Users className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">用户管理</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    快速查看和编辑单个用户的基本信息，例如封禁状态、数据卡槽位和特殊头衔。
                  </p>
                </a>
              </Link>

              <Link href="/admin/user-analytics" legacyBehavior>
                <a className="admin-card bg-indigo-50 border-indigo-200 hover:border-indigo-400">
                  <div className="flex items-center text-indigo-700 mb-3">
                    <BarChart3 className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">用户统计分析</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    查看活跃覆盖、生成频次分层与高频用户占比，支持 active7d / tracked / all 多口径切换。
                  </p>
                </a>
              </Link>

              <Link href="/admin/badge-management" legacyBehavior>
                <a className="admin-card bg-amber-50 border-amber-200 hover:border-amber-400">
                  <div className="flex items-center text-amber-700 mb-3">
                    <Award className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">徽章管理</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    创建、编辑和删除徽章，为用户授予或撤销徽章，设计徽章样式和属性。
                  </p>
                </a>
              </Link>

              <Link href="/admin/tag-management" legacyBehavior>
                <a className="admin-card bg-slate-50 border-slate-200 hover:border-slate-400">
                  <div className="flex items-center text-slate-700 mb-3">
                    <Tags className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">标签库管理</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    管理 tags / tag_aliases：新增、编辑、停用标签，以及维护同义词别名。
                  </p>
                </a>
              </Link>

              <Link href="/admin/battle-report-generations" legacyBehavior>
                <a className="admin-card bg-orange-50 border-orange-200 hover:border-orange-400">
                  <div className="flex items-center text-orange-700 mb-3">
                    <FileText className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">战报生成记录</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    浏览、筛选、检索并导出战报生成记录，快速跳转到相关用户与角色卡的管理页面。
                  </p>
                </a>
              </Link>

              <Link href="/admin/arena-ratings" legacyBehavior>
                <a className="admin-card bg-sky-50 border-sky-200 hover:border-sky-400">
                  <div className="flex items-center text-sky-700 mb-3">
                    <BarChart3 className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">排位运维</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    浏览并筛选 arena_ratings（strict/free），支持批量重置排位分，联动查看数据卡与技术值。
                  </p>
                </a>
              </Link>

              <Link href="/admin/arena-rating-events" legacyBehavior>
                <a className="admin-card bg-rose-50 border-rose-200 hover:border-rose-400">
                  <div className="flex items-center text-rose-700 mb-3">
                    <Activity className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">排位事件审计</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    检索 arena_rating_events：查看每次结算的 before/delta/after、跳过原因与关联战报。
                  </p>
                </a>
              </Link>

              <Link href="/admin/large-objects" legacyBehavior>
                <a className="admin-card bg-emerald-50 border-emerald-200 hover:border-emerald-400">
                  <div className="flex items-center text-emerald-700 mb-3">
                    <HardDrive className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">大对象管理</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    管理 large_objects 与 R2：筛选/检索大对象索引，生成下载链接，并支持清理索引与对象。
                  </p>
                </a>
              </Link>

              <Link href="/admin/data-maintenance" legacyBehavior>
                <a className="admin-card bg-violet-50 border-violet-200 hover:border-violet-400">
                  <div className="flex items-center text-violet-700 mb-3">
                    <Database className="w-8 h-8" />
                    <h2 className="text-xl font-semibold ml-3">数据库清理</h2>
                  </div>
                  <p className="text-gray-600 text-sm">
                    按范围与字段预览并执行清理：支持截断、设空/默认、整行删除，适合战报/PVP/排位历史数据瘦身。
                  </p>
                </a>
              </Link>
            </div>
            
            <div className="text-center mt-10">
                <Link href="/" legacyBehavior>
                    <a className="text-sm text-gray-500 hover:text-purple-600 hover:underline">
                        返回应用首页
                    </a>
                </Link>
            </div>
          </div>
        </div>
      </div>
      <style jsx>{`
        .admin-card {
          display: block;
          padding: 1.5rem;
          border-radius: 0.75rem;
          border-width: 1px;
          transition: all 0.3s ease-in-out;
          transform: translateY(0);
        }
        .admin-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        }
      `}</style>
    </>
  );
};

export default AdminHomePage;
