import { queryFromD1 } from '../../../../lib/database/core';
import { reviewDataCardUpdate } from '@/lib/database/admin';

export const runtime = 'edge';

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const getIdFromUrl = (url: string): string | null => {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((part) => part === 'data-cards');
    if (idx === -1) return null;
    return parts[idx + 1] || null;
  } catch {
    return null;
  }
};

export default async function handler(req: Request): Promise<Response> {
  const id = getIdFromUrl(req.url);

  if (!id) {
    return jsonResponse({ error: '角色卡ID参数无效' }, 400);
  }

  if (req.method === 'PUT') {
    // 更新角色卡信息
    try {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== 'object') {
        return jsonResponse({ error: '请求体解析失败' }, 400);
      }
      const { name, description, is_public, update_action, update_id } = body as Record<string, any>;

      // 如果是审核更新记录
      if (update_action && update_id) {
        const ok = await reviewDataCardUpdate(update_id, update_action === 'approve' ? 'approve' : 'reject');
        if (!ok) {
          return jsonResponse({ error: '处理更新记录失败' }, 400);
        }
        return jsonResponse({ success: true }, 200);
      }

      // 验证输入数据
      const updates: string[] = [];
      const params: any[] = [];

      if (name !== undefined) {
        updates.push('name = ?');
        params.push(name);
      }

      if (description !== undefined) {
        updates.push('description = ?');
        params.push(description);
      }

      if (is_public !== undefined) {
        updates.push('is_public = ?');
        params.push(is_public);
      }

      if (updates.length === 0) {
        return jsonResponse({ error: '没有要更新的字段' }, 400);
      }

      // 添加更新时间
      updates.push('updated_at = CURRENT_TIMESTAMP');

      // 添加角色卡ID到参数
      params.push(id);

      const query = `UPDATE data_cards SET ${updates.join(', ')} WHERE id = ?`;
      const result = await queryFromD1(query, params) as any;

      if (result.success && result.result && result.result[0]?.meta?.changes > 0) {
        // 获取更新后的角色卡信息
        const getCardQuery = `
          SELECT dc.*, u.username 
          FROM data_cards dc 
          JOIN users u ON dc.user_id = u.id 
          WHERE dc.id = ?
        `;
        const cardResult = await queryFromD1(getCardQuery, [id]) as any;
        
        if (cardResult.success && cardResult.result && cardResult.result[0]?.results?.length > 0) {
          const updatedCard = cardResult.result[0].results[0];
          return jsonResponse(updatedCard, 200);
        }
        return jsonResponse({ error: '角色卡未找到' }, 404);
      }
      return jsonResponse({ error: '角色卡未找到或无权限更新' }, 404);
    } catch (error) {
      console.error('更新角色卡信息失败:', error);
      return jsonResponse({ error: '更新角色卡信息失败' }, 500);
    }
  }

  if (req.method === 'GET') {
    // 获取单个角色卡信息
    try {
      const query = `
        SELECT dc.*, u.username 
        FROM data_cards dc 
        JOIN users u ON dc.user_id = u.id 
        WHERE dc.id = ?
      `;
      const result = await queryFromD1(query, [id]) as any;
      
      if (result.success && result.result && result.result[0]?.results?.length > 0) {
        const card = result.result[0].results[0];
        return jsonResponse(card, 200);
      }
      return jsonResponse({ error: '角色卡未找到' }, 404);
    } catch (error) {
      console.error('获取角色卡信息失败:', error);
      return jsonResponse({ error: '获取角色卡信息失败' }, 500);
    }
  }

  if (req.method === 'DELETE') {
    // 删除角色卡（管理员功能）
    try {
      const result = await queryFromD1(
        'DELETE FROM data_cards WHERE id = ?',
        [id]
      ) as any;
      
      if (result.success && result.result && result.result[0]?.meta?.changes > 0) {
        return jsonResponse({ success: true, message: '角色卡删除成功' }, 200);
      }
      return jsonResponse({ error: '角色卡未找到' }, 404);
    } catch (error) {
      console.error('删除角色卡失败:', error);
      return jsonResponse({ error: '删除角色卡失败' }, 500);
    }
  }

  return jsonResponse({ error: '方法不被允许' }, 405);
}
