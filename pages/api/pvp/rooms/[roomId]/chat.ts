import {
  createPvpRoomChatMessage,
  getLatestPvpRoomChatMessageBySender,
  getPvpRoomById,
  getPvpRoomChatMessages,
  getPvpRoomMembers,
} from '@/lib/d1';
import { parsePvpRoomInternalState } from '@/lib/pvp/bot/room';
import { validateAndBuildPvpChatMessage, normalizePvpChatSendBody } from '@/lib/pvp/chat';
import { getRoomIdFromRequestUrl } from '@/lib/pvp/route';
import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';

export const runtime = 'edge';

const parseAfterId = (url: string): number | null => {
  try {
    const u = new URL(url);
    const raw = u.searchParams.get('afterId');
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const id = Math.floor(n);
    return id > 0 ? id : null;
  } catch {
    return null;
  }
};

async function chatHandler(req: Request): Promise<Response> {
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const roomId = getRoomIdFromRequestUrl(req.url);
  if (!roomId) return json({ error: '缺少 roomId' }, { status: 400 });

  const room = await getPvpRoomById(roomId);
  if (!room) return json({ error: '房间不存在' }, { status: 404 });

  const members = await getPvpRoomMembers(roomId);
  const me = members.find((m) => m.user_id === auth.user.id) ?? null;
  if (!me) return json({ error: '无权访问该房间' }, { status: 403 });

  if (req.method === 'GET') {
    const afterId = parseAfterId(req.url);
    const messages = await getPvpRoomChatMessages({ roomId, afterId, limit: 50 });
    return json({
      success: true,
      messages: messages.map((m) => ({
        id: m.id,
        createdAt: m.created_at,
        sender: {
          userId: m.sender_user_id,
          username: m.sender_username,
          prefix: m.sender_prefix,
          role: m.sender_role,
        },
        renderedText: m.rendered_text,
        stickerId: m.sticker_id,
        emoji: m.emoji_text,
      })),
    });
  }

  if (req.method === 'POST') {
    const parsed = parsePvpRoomInternalState(room.rules_json);
    if ('error' in parsed) return json({ error: parsed.error }, { status: 500 });
    const rules = parsed.internal.rules;

    if (me.role === 'spectator' && rules.allowSpectatorChat !== true) {
      return json({ error: '房主已关闭观众聊天', code: 'SPECTATOR_CHAT_DISABLED' }, { status: 403 });
    }

    const last = await getLatestPvpRoomChatMessageBySender({ roomId, userId: auth.user.id });
    if (last?.created_at) {
      const lastMs = Date.parse(last.created_at);
      if (Number.isFinite(lastMs) && Date.now() - lastMs < 1200) {
        return json({ error: '发送太频繁，请稍后再试', code: 'RATE_LIMITED' }, { status: 429 });
      }
    }

    const body = await readJson(req);
    if ('response' in body) return body.response;

    const normalizedBody = normalizePvpChatSendBody(body.data);
    const built = validateAndBuildPvpChatMessage(normalizedBody);
    if (!built.ok) return json({ error: built.error, code: built.code }, { status: 400 });

    const messageId = await createPvpRoomChatMessage({
      roomId,
      senderUserId: auth.user.id,
      senderRole: me.role,
      senderUsername: auth.user.username,
      senderPrefix: auth.user.prefix,
      contentJson: built.value.contentJson,
      renderedText: built.value.renderedText,
      stickerId: built.value.stickerId,
      emojiText: built.value.emoji,
    });

    if (!messageId) return json({ error: '发送失败', code: 'INSERT_FAILED' }, { status: 500 });

    return json({ success: true, messageId });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
}

export default withPvpErrorBoundary(chatHandler);

