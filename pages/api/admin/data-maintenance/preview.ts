import type { NextRequest } from 'next/server';

import { getAdminDataCleanupTargetSchemas, previewAdminDataCleanup } from '@/lib/database/admin-data-maintenance';

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
  if (req.method === 'GET') {
    return new Response(
      JSON.stringify({
        success: true,
        schemas: getAdminDataCleanupTargetSchemas(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      target?: unknown;
      scope?: unknown;
      actions?: unknown;
    };

    const preview = await previewAdminDataCleanup({
      target: body.target,
      scope: body.scope,
      actions: body.actions,
    });

    return new Response(JSON.stringify({ success: true, preview }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin data-maintenance preview 失败:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : '预览失败',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
