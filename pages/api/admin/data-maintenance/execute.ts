import type { NextRequest } from 'next/server';

import { getUserByAuthKey } from '@/lib/d1';
import {
  appendAdminDataCleanupJobLog,
  completeAdminDataCleanupJob,
  createAdminDataCleanupJob,
  executeAdminDataCleanup,
  failAdminDataCleanupJob,
  previewAdminDataCleanup,
} from '@/lib/database/admin-data-maintenance';

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

    const plan = {
      target: body.target,
      scope: body.scope,
      actions: body.actions,
    };

    const preview = await previewAdminDataCleanup(plan);
    const planHash = typeof body.planHash === 'string' ? body.planHash.trim() : '';
    if (!planHash || planHash !== preview.planHash) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'planHash 不匹配，请先重新预览。',
          previewPlanHash: preview.planHash,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    let createdByUserId: number | null = null;
    try {
      const authHeader = req.headers.get('authorization') ?? '';
      if (authHeader.startsWith('Bearer ')) {
        const authKey = authHeader.substring('Bearer '.length).trim();
        if (authKey) {
          const user = await getUserByAuthKey(authKey);
          if (user && typeof user.id === 'number' && Number.isFinite(user.id)) {
            createdByUserId = Math.floor(user.id);
          }
        }
      }
    } catch {
      createdByUserId = null;
    }

    const precheckWarnings: string[] = [];
    let jobId: string | null = null;
    const createdJob = await createAdminDataCleanupJob({
      plan,
      planHash: preview.planHash,
      preview,
      createdByUserId,
    });
    if (createdJob.ok && createdJob.jobId) {
      jobId = createdJob.jobId;
    } else if (createdJob.warning) {
      precheckWarnings.push(createdJob.warning);
    }

    let result: Awaited<ReturnType<typeof executeAdminDataCleanup>>;
    try {
      result = await executeAdminDataCleanup({
        plan,
        planHash: preview.planHash,
        maxRows: body.maxRows,
        batchSize: body.batchSize,
        confirmText: body.confirmText,
        onBatchCompleted: jobId
          ? async (progress) => {
              await appendAdminDataCleanupJobLog(jobId as string, progress);
            }
          : undefined,
      });
    } catch (error) {
      if (jobId) {
        const message = error instanceof Error ? error.message : String(error || '执行失败');
        await failAdminDataCleanupJob(jobId, message);
      }
      throw error;
    }

    if (jobId) {
      await completeAdminDataCleanupJob(jobId, result);
    }

    return new Response(JSON.stringify({ success: true, jobId, precheckWarnings, result }), {
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
