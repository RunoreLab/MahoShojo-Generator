import { RepairQuestionnaireDataCardTypeRequestSchema } from '@mahoshojo/contracts/data-cards';
import { requireAuthUser } from '@/lib/auth/server';
import {
  getDataCardById,
  repairQuestionnaireDataCardType,
} from '@/lib/database/data-cards';
import { removeStrictArenaRatingForDataCard } from '@/lib/database/arena-ratings';
import { isQuestionnairePayload } from '@/lib/questionnaire-data-card';

const jsonResponse = (body: Record<string, unknown>, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const handler = async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;

  const parsedBody = RepairQuestionnaireDataCardTypeRequestSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsedBody.success) {
    return jsonResponse({ error: '缺少有效的数据卡ID' }, 400);
  }

  const { id } = parsedBody.data;
  const currentCard = await getDataCardById(id, false);
  if (!currentCard || currentCard.user_id !== auth.user.id) {
    return jsonResponse({ error: '数据卡不存在或无权访问' }, 404);
  }

  if (currentCard.type === 'questionnaire') {
    return jsonResponse({ success: true, repaired: false, message: '数据卡类型已经是问卷' }, 200);
  }

  if (currentCard.type !== 'character') {
    return jsonResponse({ error: '仅支持修复被误标为角色的问卷数据卡' }, 409);
  }

  if (!isQuestionnairePayload(currentCard.data)) {
    return jsonResponse({ error: '数据卡内容不是有效问卷，无法修复类型' }, 400);
  }

  const repaired = await repairQuestionnaireDataCardType(id, auth.user.id);
  if (!repaired) {
    return jsonResponse({ error: '数据卡类型修复失败，请刷新后重试' }, 500);
  }

  await removeStrictArenaRatingForDataCard(id);
  return jsonResponse({ success: true, repaired: true, message: '问卷数据卡类型已恢复' }, 200);
};

export default handler;
export { handler };
