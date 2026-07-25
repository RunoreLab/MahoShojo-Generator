import { queryFromD1 } from '@/lib/database/core';
import { getAdminUserDetailsById } from '@/lib/database/admin';

export const runtime = 'edge';

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const getIdFromUrl = (url: string): string | null => {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((part) => part === 'users');
    if (idx === -1) return null;
    return parts[idx + 1] || null;
  } catch {
    return null;
  }
};

export default async function handler(req: Request): Promise<Response> {
  const id = getIdFromUrl(req.url);
  
  if (!id) {
    return jsonResponse({ error: '用户ID参数无效' }, 400);
  }

  const userId = Number.parseInt(id, 10);
  if (!Number.isFinite(userId)) {
    return jsonResponse({ error: '用户ID必须是数字' }, 400);
  }

  if (req.method === 'PUT') {
    // 更新用户信息
    try {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== 'object') {
        return jsonResponse({ error: '请求体解析失败' }, 400);
      }
      const { is_banned, slot_count, prefix } = body as Record<string, any>;

      // 验证输入数据
      const updates: string[] = [];
      const params: any[] = [];

      if (is_banned !== undefined) {
        updates.push('is_banned = ?');
        params.push(is_banned || null);
      }

      if (slot_count !== undefined) {
        updates.push('slot_count = ?');
        params.push(slot_count ? Number.parseInt(slot_count, 10) : null);
      }

      if (prefix !== undefined) {
        updates.push('prefix = ?');
        params.push(prefix || null);
      }

      if (updates.length === 0) {
        return jsonResponse({ error: '没有要更新的字段' }, 400);
      }

      // 添加用户ID到参数
      params.push(userId);

      const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
      const result = await queryFromD1(query, params) as any;

      if (result.success) {
        const updatedUser = await getAdminUserDetailsById(userId);
        if (updatedUser) return jsonResponse(updatedUser, 200);
        return jsonResponse({ error: '用户未找到' }, 404);
      }
      return jsonResponse({ error: '更新用户信息失败' }, 500);
    } catch (error) {
      console.error('更新用户信息失败:', error);
      return jsonResponse({ error: '更新用户信息失败' }, 500);
    }
  }

  if (req.method === 'GET') {
    // 获取单个用户信息
    try {
      const user = await getAdminUserDetailsById(userId);
      if (user) return jsonResponse(user, 200);
      return jsonResponse({ error: '用户未找到' }, 404);
    } catch (error) {
      console.error('获取用户信息失败:', error);
      return jsonResponse({ error: '获取用户信息失败' }, 500);
    }
  }

  return jsonResponse({ error: '方法不被允许' }, 405);
}
