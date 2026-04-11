// pages/api/admin/data-card-updates/batch-review.ts

import { sendDataCardModerationMessages } from '@/lib/admin/messages';
import { getDataCardUpdateNotificationTargets, reviewDataCardUpdate } from '@/lib/database/admin';
import { getAuthUser, readJson, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

type HandlerDeps = {
  getAuthUser: typeof getAuthUser;
  getDb: () => any;
  reviewDataCardUpdate: typeof reviewDataCardUpdate;
  getDataCardUpdateNotificationTargets: typeof getDataCardUpdateNotificationTargets;
  sendDataCardModerationMessages: typeof sendDataCardModerationMessages;
};

const defaultDeps: HandlerDeps = {
  getAuthUser,
  getDb: () => null,
  reviewDataCardUpdate,
  getDataCardUpdateNotificationTargets,
  sendDataCardModerationMessages,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

export const createAdminDataCardUpdatesBatchReviewHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'PUT') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
    }

    try {
      const auth = await (deps.getAuthUser ?? defaultDeps.getAuthUser)(req);
      const parsed = await readJson<Record<string, unknown>>(req);
      if ('response' in parsed) return parsed.response;

      const updateIds = Array.isArray(parsed.data?.updateIds)
        ? parsed.data.updateIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      const action = parsed.data?.action;
      const messageOptions =
        parsed.data?.messageOptions && typeof parsed.data.messageOptions === 'object' && !Array.isArray(parsed.data.messageOptions)
          ? (parsed.data.messageOptions as Record<string, unknown>)
          : null;

      if (updateIds.length === 0) {
        return new Response(JSON.stringify({ success: false, error: '缺少必要参数: updateIds' }), { status: 400 });
      }

      if (action !== 'approve' && action !== 'reject') {
        return new Response(JSON.stringify({ success: false, error: '无效的操作类型' }), { status: 400 });
      }

      const failedIds: string[] = [];
      for (const updateId of updateIds) {
        const ok = await (deps.reviewDataCardUpdate ?? defaultDeps.reviewDataCardUpdate)(updateId, action);
        if (!ok) failedIds.push(updateId);
      }

      if (action === 'reject' && Boolean(messageOptions?.send)) {
        const successfulIds = updateIds.filter((updateId) => !failedIds.includes(updateId));
        if (successfulIds.length > 0) {
          const targets = await (deps.getDataCardUpdateNotificationTargets ?? defaultDeps.getDataCardUpdateNotificationTargets)(successfulIds);
          await (deps.sendDataCardModerationMessages ?? defaultDeps.sendDataCardModerationMessages)({
            db: deps.getDb ? deps.getDb() : await getDefaultDb(),
            actorUserId: auth?.user.id ?? null,
            templateKey: 'user.moderation.data_card_rejected',
            targets,
            defaultReason:
              typeof messageOptions?.defaultReason === 'string' ? messageOptions.defaultReason : null,
            reasonByTargetKey:
              messageOptions?.reasonByTargetKey &&
              typeof messageOptions.reasonByTargetKey === 'object' &&
              !Array.isArray(messageOptions.reasonByTargetKey)
                ? (messageOptions.reasonByTargetKey as Record<string, string>)
                : undefined,
          });
        }
      }

      const success = failedIds.length === 0;
      return new Response(JSON.stringify({
        success,
        processed: updateIds.length,
        failedIds,
      }), {
        status: success ? 200 : 207,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Admin API - 批量审核更新失败:', error);
      return new Response(JSON.stringify({ success: false, error: '批量审核更新失败' }), { status: 500 });
    }
  };

export default withPvpErrorBoundary(createAdminDataCardUpdatesBatchReviewHandler());
