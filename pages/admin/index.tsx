// pages/admin/index.tsx

import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { FileText, Users, FileCheck, UserCog, Clock, UserPlus, FilePlus, AlertTriangle, ShieldOff } from 'lucide-react';

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
  serverTimeIso: string;
  d1NowUtc: string;
  d1NowLocal: string;
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
  // 定义存储统计数据和加载状态的state
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastServerTimeIso, setLastServerTimeIso] = useState<string | null>(null);
  const [lastD1NowLocal, setLastD1NowLocal] = useState<string | null>(null);

  // 在组件挂载时通过useEffect获取数据
  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/admin/dashboard-stats');
        if (!response.ok) {
          throw new Error('获取统计数据失败');
        }
        const data = await response.json();
        if (data.success) {
          setStats(data.stats);
          setLastServerTimeIso(data.stats?.serverTimeIso || null);
          setLastD1NowLocal(data.stats?.d1NowLocal || null);
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();

    // 为了让“服务器时间”与当日统计更接近实时，这里定时刷新一次（避免频繁请求）
    const timer = setInterval(fetchStats, 60_000);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const formatPercent = (rate: number) => `${(Math.max(0, Math.min(1, rate)) * 100).toFixed(1)}%`;
  const formatServerTime = (iso: string | null) => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return `${date.toISOString().replace('T', ' ').replace('Z', ' UTC')}`;
  };

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

          {/* 数据统计卡片区域 */}
          <div className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-700">平台概览</h2>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Clock className="w-4 h-4" />
                <span>
                  服务器时间：{formatServerTime(lastServerTimeIso)}
                  {lastD1NowLocal ? `（D1 local: ${lastD1NowLocal}）` : ''}
                </span>
              </div>
            </div>
            {loading ? (
              <div className="text-center p-8 bg-white rounded-lg shadow-sm">加载中...</div>
            ) : (
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
                  title="今日中断/失败率"
                  value={formatPercent(stats?.battleReportGenerationAbortFailRateToday ?? 0)}
                  icon={AlertTriangle}
                  color="bg-orange-500"
                  note="（中断+失败）/（生成总数）"
                />
                <StatCard title="违规档案总数" value={stats?.bannedDataCardsCount ?? 0} icon={AlertTriangle} color="bg-red-500" />
                <StatCard title="用户总数" value={stats?.totalUsers ?? 0} icon={Users} color="bg-teal-500" />
                <StatCard title="档案总数" value={stats?.totalDataCards ?? 0} icon={FileText} color="bg-indigo-500" />
                <StatCard title="封禁用户数" value={stats?.bannedUsersCount ?? 0} icon={ShieldOff} color="bg-gray-600" />
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
