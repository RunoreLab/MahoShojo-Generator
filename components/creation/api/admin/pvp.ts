import type { NextRequest } from 'next/server';

import {
  executeAdminPvpAction,
  exportAdminPvpData,
  getAdminPvpDashboardData,
  type AdminPvpAction,
  type AdminPvpExportScope,
  type AdminPvpMatchListFilters,
  type AdminPvpRoomListFilters,
} from '@/lib/database/admin-pvp';

export const runtime = 'edge';

const parsePositiveInt = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
};

const parseOptionalExpectedVersion = (value: unknown): number | null | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(raw)) return null;
  return Math.floor(raw);
};

const readRoomFilters = (searchParams: URLSearchParams): AdminPvpRoomListFilters => ({
  page: parsePositiveInt(searchParams.get('roomPage')),
  limit: parsePositiveInt(searchParams.get('roomLimit')),
  search: searchParams.get('roomSearch') || undefined,
  status:
    searchParams.get('roomStatus') === 'open' || searchParams.get('roomStatus') === 'closed'
      ? (searchParams.get('roomStatus') as 'open' | 'closed')
      : 'all',
  phase: searchParams.get('roomPhase') || 'all',
  stalledOnly: searchParams.get('roomStalledOnly') === '1',
});

const readMatchFilters = (searchParams: URLSearchParams): AdminPvpMatchListFilters => ({
  page: parsePositiveInt(searchParams.get('matchPage')),
  limit: parsePositiveInt(searchParams.get('matchLimit')),
  search: searchParams.get('matchSearch') || undefined,
  status:
    searchParams.get('matchStatus') === 'active' ||
    searchParams.get('matchStatus') === 'completed' ||
    searchParams.get('matchStatus') === 'aborted'
      ? (searchParams.get('matchStatus') as 'active' | 'completed' | 'aborted')
      : 'all',
  roomId: searchParams.get('matchRoomId') || undefined,
  userId: parsePositiveInt(searchParams.get('matchUserId')),
});

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const isExportScope = (value: string | null): value is AdminPvpExportScope =>
  value === 'rooms' || value === 'matches' || value === 'roomChats' || value === 'roomRounds';

const readAction = async (req: NextRequest): Promise<AdminPvpAction> => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  const roomId = typeof body.roomId === 'string' ? body.roomId.trim() : '';

  if (!roomId) {
    throw new Error('缺少 roomId');
  }

  const expectedVersion = parseOptionalExpectedVersion(body.expectedVersion);
  if (expectedVersion === null) {
    throw new Error('expectedVersion 非法');
  }

  if (action === 'forcePending') {
    const kind =
      body.kind === 'submit' || body.kind === 'choose' || body.kind === 'confirm'
        ? (body.kind as 'submit' | 'choose' | 'confirm')
        : undefined;
    return {
      action,
      roomId,
      expectedVersion,
      kind,
      request: req,
    };
  }

  if (action === 'recoverResolving') {
    return { action, roomId, expectedVersion };
  }

  if (action === 'restartRoom') {
    return { action, roomId, expectedVersion };
  }

  if (action === 'closeRoom') {
    const cleanupMode =
      body.cleanupMode === 'preserve' || body.cleanupMode === 'ephemeral' || body.cleanupMode === 'runtime'
        ? (body.cleanupMode as 'preserve' | 'runtime' | 'ephemeral')
        : 'runtime';
    return { action, roomId, expectedVersion, cleanupMode };
  }

  if (action === 'clearRoomEphemeral') {
    return { action, roomId };
  }

  throw new Error('不支持的 action');
};

export default async function handler(req: NextRequest): Promise<Response> {
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const format = url.searchParams.get('format');
      const roomFilters = readRoomFilters(url.searchParams);
      const matchFilters = readMatchFilters(url.searchParams);
      const roomId = url.searchParams.get('roomId');
      const matchId = url.searchParams.get('matchId');

      if (format === 'csv') {
        const scope = url.searchParams.get('scope');
        if (!isExportScope(scope)) {
          return json({ success: false, error: 'scope 非法，必须为 rooms / matches / roomChats / roomRounds' }, 400);
        }
        const exportResult = await exportAdminPvpData({
          scope,
          roomFilters,
          matchFilters,
          roomId,
          maxRows: parsePositiveInt(url.searchParams.get('maxRows')),
        });
        return new Response(exportResult.body, {
          status: 200,
          headers: {
            'Content-Type': exportResult.contentType,
            'Content-Disposition': `attachment; filename="${exportResult.filename}"`,
            'Cache-Control': 'no-store',
          },
        });
      }

      const data = await getAdminPvpDashboardData({
        roomFilters,
        matchFilters,
        roomId,
        matchId,
      });

      return json({ success: true, ...data });
    }

    if (req.method === 'POST') {
      const action = await readAction(req);
      const result = await executeAdminPvpAction(action);
      return json({ success: true, result });
    }

    return json({ success: false, error: 'Method Not Allowed' }, 405);
  } catch (error) {
    console.error('[Admin API] PVP 管理台请求失败:', error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'PVP 管理台请求失败',
      },
      500,
    );
  }
}
