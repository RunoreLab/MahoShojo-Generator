import type { NextRequest } from 'next/server';

import { executeAdminDataCleanup } from '@/lib/database/admin-data-maintenance';

export const runtime = 'edge';

export default async function handler(req: NextRequest) {
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
      planHash?: unknown;
      maxRows?: unknown;
      batchSize?: unknown;
      confirmText?: unknown;
    };

    const result = await executeAdminDataCleanup({
      plan: {
        target: body.target,
        scope: body.scope,
        actions: body.actions,
      },
      planHash: body.planHash,
      maxRows: body.maxRows,
      batchSize: body.batchSize,
      confirmText: body.confirmText,
    });

    return new Response(JSON.stringify({ success: true, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin data-maintenance execute 失败:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : '执行失败',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
