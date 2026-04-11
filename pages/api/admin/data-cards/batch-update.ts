// pages/api/admin/data-cards/batch-update.ts

import { sendDataCardModerationMessages } from '@/lib/admin/messages';
import { batchUpdateDataCards, getDataCardNotificationTargets } from '@/lib/database/admin';
import { getAuthUser, readJson, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'experimental-edge';

type HandlerDeps = {
  getAuthUser: typeof getAuthUser;
  getDb: () => any;
  batchUpdateDataCards: typeof batchUpdateDataCards;
  getDataCardNotificationTargets: typeof getDataCardNotificationTargets;
  sendDataCardModerationMessages: typeof sendDataCardModerationMessages;
};

const defaultDeps: HandlerDeps = {
  getAuthUser,
  getDb: () => null,
  batchUpdateDataCards,
  getDataCardNotificationTargets,
  sendDataCardModerationMessages,
};

const getDefaultDb = async () => {
  const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
  return getDrizzleDbFromRuntime();
};

export const createAdminDataCardsBatchUpdateHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'PUT') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
    }

    try {
      const auth = await (deps.getAuthUser ?? defaultDeps.getAuthUser)(req);
      const parsed = await readJson<Record<string, unknown>>(req);
      if ('response' in parsed) return parsed.response;

      const cardIds = Array.isArray(parsed.data?.cardIds)
        ? parsed.data.cardIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      const action = typeof parsed.data?.action === 'string' ? parsed.data.action : '';
      const value = parsed.data?.value;
      const messageOptions =
        parsed.data?.messageOptions && typeof parsed.data.messageOptions === 'object' && !Array.isArray(parsed.data.messageOptions)
          ? (parsed.data.messageOptions as Record<string, unknown>)
          : null;

      if (cardIds.length === 0 || !action) {
        return new Response(JSON.stringify({ success: false, error: '缺少必要参数: cardIds 和 action' }), { status: 400 });
      }

      const updates: { review_status?: 'approved' | 'rejected'; is_public?: 0 | 1 | -1; is_recommended?: 0 | 1 } = {};

      switch (action) {
        case 'approve':
          updates.review_status = 'approved';
          break;
        case 'reject':
          updates.review_status = 'rejected';
          break;
        case 'set_public_status':
          if (value === -1 || value === 0 || value === 1) {
            updates.is_public = value;
          } else {
            return new Response(JSON.stringify({ success: false, error: '无效的公开状态值' }), { status: 400 });
          }
          break;
        case 'set_recommended':
          if (value === 0 || value === 1) {
            updates.is_recommended = value;
          } else {
            return new Response(JSON.stringify({ success: false, error: '无效的推荐状态值' }), { status: 400 });
          }
          break;
        default:
          return new Response(JSON.stringify({ success: false, error: '无效的操作类型' }), { status: 400 });
      }

      const success = await (deps.batchUpdateDataCards ?? defaultDeps.batchUpdateDataCards)(cardIds, updates);
      if (!success) {
        throw new Error('数据库批量更新操作失败');
      }

      const shouldSendMessage = Boolean(messageOptions?.send);
      if (shouldSendMessage && (action === 'reject' || (action === 'set_public_status' && value === -1))) {
        const targets = await (deps.getDataCardNotificationTargets ?? defaultDeps.getDataCardNotificationTargets)(cardIds);
        await (deps.sendDataCardModerationMessages ?? defaultDeps.sendDataCardModerationMessages)({
          db: deps.getDb ? deps.getDb() : await getDefaultDb(),
          actorUserId: auth?.user.id ?? null,
          templateKey:
            action === 'reject' ? 'user.moderation.data_card_rejected' : 'user.moderation.data_card_banned',
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

      return new Response(JSON.stringify({ success: true, message: `成功更新 ${cardIds.length} 个项目` }), { status: 200 });
    } catch (error) {
      console.error('Admin API - 批量更新失败:', error);
      return new Response(JSON.stringify({ success: false, error: '批量更新操作失败' }), { status: 500 });
    }
  };

export default withPvpErrorBoundary(createAdminDataCardsBatchUpdateHandler());
