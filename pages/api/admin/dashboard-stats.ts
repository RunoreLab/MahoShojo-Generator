// pages/api/admin/dashboard-stats.ts

import {
  getDashboardStats,
  getDashboardStatsAccounts,
  getDashboardStatsActivity,
  getDashboardStatsArena,
  getDashboardStatsCore,
  getDashboardStatsGovernance,
  getDashboardStatsPvp,
  getDashboardStatsStorage,
  getDashboardStatsTags,
  type DashboardStatsSection,
} from '@/lib/database/admin';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

/**
 * @fileoverview API端点，用于获取后台管理仪表盘所需的统计数据。
 * @description
 * 这是一个简单的GET端点，它调用数据库层的 getDashboardStats 函数来汇总数据，
 * 并以JSON格式返回给前端。
 */
type HandlerDeps = {
  getDashboardStats: typeof getDashboardStats;
  getDashboardStatsCore: typeof getDashboardStatsCore;
  getDashboardStatsArena: typeof getDashboardStatsArena;
  getDashboardStatsActivity: typeof getDashboardStatsActivity;
  getDashboardStatsTags: typeof getDashboardStatsTags;
  getDashboardStatsStorage: typeof getDashboardStatsStorage;
  getDashboardStatsAccounts: typeof getDashboardStatsAccounts;
  getDashboardStatsPvp: typeof getDashboardStatsPvp;
  getDashboardStatsGovernance: typeof getDashboardStatsGovernance;
};

const defaultDeps: HandlerDeps = {
  getDashboardStats,
  getDashboardStatsCore,
  getDashboardStatsArena,
  getDashboardStatsActivity,
  getDashboardStatsTags,
  getDashboardStatsStorage,
  getDashboardStatsAccounts,
  getDashboardStatsPvp,
  getDashboardStatsGovernance,
};

const parseSection = (sectionRaw: string | null): DashboardStatsSection | 'all' => {
  if (
    sectionRaw === 'core' ||
    sectionRaw === 'arena' ||
    sectionRaw === 'tags' ||
    sectionRaw === 'storage' ||
    sectionRaw === 'activity' ||
    sectionRaw === 'accounts' ||
    sectionRaw === 'pvp' ||
    sectionRaw === 'governance'
  ) {
    return sectionRaw;
  }
  return 'all';
};

export const createAdminDashboardStatsHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: NextRequest): Promise<Response> => {
    if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
    }

    try {
      const url = new URL(req.url);
      const section = parseSection(url.searchParams.get('section'));

      const stats = await (async () => {
        if (section === 'core') return await (deps.getDashboardStatsCore ?? defaultDeps.getDashboardStatsCore)();
        if (section === 'arena') return await (deps.getDashboardStatsArena ?? defaultDeps.getDashboardStatsArena)();
        if (section === 'activity') {
          return await (deps.getDashboardStatsActivity ?? defaultDeps.getDashboardStatsActivity)();
        }
        if (section === 'tags') return await (deps.getDashboardStatsTags ?? defaultDeps.getDashboardStatsTags)();
        if (section === 'storage') {
          return await (deps.getDashboardStatsStorage ?? defaultDeps.getDashboardStatsStorage)();
        }
        if (section === 'accounts') {
          return await (deps.getDashboardStatsAccounts ?? defaultDeps.getDashboardStatsAccounts)();
        }
        if (section === 'pvp') return await (deps.getDashboardStatsPvp ?? defaultDeps.getDashboardStatsPvp)();
        if (section === 'governance') {
          return await (deps.getDashboardStatsGovernance ?? defaultDeps.getDashboardStatsGovernance)();
        }
        return await (deps.getDashboardStats ?? defaultDeps.getDashboardStats)();
      })();

      return new Response(JSON.stringify({ success: true, section, stats }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Admin API - 获取仪表盘统计数据失败:', error);
      return new Response(JSON.stringify({ success: false, error: '获取统计数据失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };

export default createAdminDashboardStatsHandler();
