import type { NextRequest } from 'next/server';

import {
  getAdminUserAccountDetailById,
  getAdminUserAccountDetailByUsername,
  listAdminUserAccounts,
  type AdminUserAccountListFilters,
} from '@/lib/database/admin-user-accounts';

export const runtime = 'edge';

const parseIntParam = (value: string | null, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseOptionalIntParam = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseOptionalDateParam = (value: string | null): string | undefined => {
  if (!value) return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
};

const parseActivity = (value: string | null): AdminUserAccountListFilters['activity'] => {
  if (value === '24h' || value === '7d' || value === '30d' || value === 'tracked' || value === 'untracked') {
    return value;
  }
  return undefined;
};

const parseStatus = (value: string | null): AdminUserAccountListFilters['status'] => {
  if (value === 'normal' || value === 'banned' || value === 'exempt') return value;
  return undefined;
};

const parseAuthState = (value: string | null): AdminUserAccountListFilters['authState'] => {
  if (
    value === 'linked' ||
    value === 'unlinked' ||
    value === 'legacyOnly' ||
    value === 'passwordMissing' ||
    value === 'emailUnverified' ||
    value === 'migrationReady'
  ) {
    return value;
  }
  return undefined;
};

const parseSortBy = (value: string | null): AdminUserAccountListFilters['sortBy'] => {
  if (value === 'createdAt' || value === 'lastLoginAt' || value === 'lastActiveAt' || value === 'latestAuthEventAt') {
    return value;
  }
  return undefined;
};

const parseSortOrder = (value: string | null): AdminUserAccountListFilters['sortOrder'] => {
  return value === 'asc' ? 'asc' : value === 'desc' ? 'desc' : undefined;
};

export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(req.url);
    const userId = parseIntParam(url.searchParams.get('userId'), 0);
    const username = (url.searchParams.get('username') ?? '').trim();

    if (userId > 0) {
      const detail = await getAdminUserAccountDetailById(userId);
      if (!detail) {
        return new Response(JSON.stringify({ success: false, error: '用户未找到' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, detail }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (username) {
      const detail = await getAdminUserAccountDetailByUsername(username);
      if (!detail) {
        return new Response(JSON.stringify({ success: false, error: '用户未找到' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, detail }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const filters: AdminUserAccountListFilters = {
      page: parseIntParam(url.searchParams.get('page'), 1),
      limit: parseIntParam(url.searchParams.get('limit'), 20),
      search: (url.searchParams.get('search') ?? '').trim() || undefined,
      regDateStart: parseOptionalDateParam(url.searchParams.get('regDateStart')),
      regDateEnd: parseOptionalDateParam(url.searchParams.get('regDateEnd')),
      loginDateStart: parseOptionalDateParam(url.searchParams.get('loginDateStart')),
      loginDateEnd: parseOptionalDateParam(url.searchParams.get('loginDateEnd')),
      activeDateStart: parseOptionalDateParam(url.searchParams.get('activeDateStart')),
      activeDateEnd: parseOptionalDateParam(url.searchParams.get('activeDateEnd')),
      activity: parseActivity(url.searchParams.get('activity')),
      status: parseStatus(url.searchParams.get('status')),
      authState: parseAuthState(url.searchParams.get('authState')),
      minPublicCards: parseOptionalIntParam(url.searchParams.get('minPublicCards')),
      maxPublicCards: parseOptionalIntParam(url.searchParams.get('maxPublicCards')),
      minBannedCards: parseOptionalIntParam(url.searchParams.get('minBannedCards')),
      maxBannedCards: parseOptionalIntParam(url.searchParams.get('maxBannedCards')),
      sortBy: parseSortBy(url.searchParams.get('sortBy')),
      sortOrder: parseSortOrder(url.searchParams.get('sortOrder')),
    };

    const result = await listAdminUserAccounts(filters);
    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Admin API] 获取用户与账号数据失败:', error);
    return new Response(JSON.stringify({ success: false, error: '获取用户与账号数据失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
