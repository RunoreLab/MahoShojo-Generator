import { queryFromD1 } from '@/lib/d1';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * 管理员单个徽章操作 API
 * GET - 获取指定徽章详情
 * PUT - 更新徽章信息
 * DELETE - 删除徽章
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (typeof id !== 'string') {
    return res.status(400).json({ error: '无效的徽章ID' });
  }

  if (req.method === 'GET') {
    try {
      const results = await queryFromD1(`
        SELECT
          id,
          name,
          description,
          icon,
          text_color as textColor,
          background_color as backgroundColor,
          border_color as borderColor,
          rarity,
          sort_order as sortOrder,
          is_active as isActive,
          created_at as createdAt
        FROM badges
        WHERE id = ?
      `, [id]) as any;

      const cards = results.success ? results.result[0]?.results || [] : [];
      const badge = cards.length > 0 ? cards[0] : null;

      if (!badge) {
        return res.status(404).json({ error: '徽章不存在' });
      }

      // 安全地解析 JSON 字段
      let icon, textColor, backgroundColor, borderColor;

      try {
        icon = typeof badge.icon === 'string' ? JSON.parse(badge.icon as string) : badge.icon;
      } catch {
        icon = { type: 'null', value: null };
      }

      try {
        textColor = typeof badge.textColor === 'string' ? JSON.parse(badge.textColor as string) : badge.textColor;
      } catch {
        textColor = { type: 'solid', value: '#000000' };
      }

      try {
        backgroundColor = typeof badge.backgroundColor === 'string' ? JSON.parse(badge.backgroundColor as string) : badge.backgroundColor;
      } catch {
        backgroundColor = { type: 'solid', value: '#FFFFFF' };
      }

      try {
        borderColor = badge.borderColor ? (typeof badge.borderColor === 'string' ? JSON.parse(badge.borderColor as string) : badge.borderColor) : undefined;
      } catch {
        borderColor = undefined;
      }

      const badgeData: any = {
        id: badge.id,
        name: badge.name,
        description: badge.description,
        icon,
        textColor,
        backgroundColor,
        borderColor,
        rarity: badge.rarity,
        sortOrder: badge.sortOrder,
        isActive: Boolean(badge.isActive),
        createdAt: badge.createdAt
      };

      return res.status(200).json({ success: true, badge: badgeData });
    } catch (error) {
      console.error('获取徽章详情失败:', error);
      return res.status(500).json({ error: '获取徽章详情失败' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const {
        name,
        description,
        icon,
        textColor,
        backgroundColor,
        borderColor,
        rarity,
        sortOrder,
        isActive
      } = req.body;

      // 检查徽章是否存在（PUT 方法）
      const existingQuery = await queryFromD1('SELECT id FROM badges WHERE id = ?', [id]) as any;
      const existingResults = existingQuery.success ? existingQuery.result[0]?.results || [] : [];
      if (!existingResults || existingResults.length === 0) {
        return res.status(404).json({ error: '徽章不存在' });
      }

      // 更新徽章
      await queryFromD1(`
        UPDATE badges SET
          name = ?,
          description = ?,
          icon = ?,
          text_color = ?,
          background_color = ?,
          border_color = ?,
          rarity = ?,
          sort_order = ?,
          is_active = ?
        WHERE id = ?
      `, [
        name,
        description || null,
        JSON.stringify(icon),
        JSON.stringify(textColor),
        JSON.stringify(backgroundColor),
        borderColor ? JSON.stringify(borderColor) : null,
        rarity,
        sortOrder,
        isActive ? 1 : 0,
        id
      ]);

      return res.status(200).json({ success: true, message: '徽章更新成功' });
    } catch (error) {
      console.error('更新徽章失败:', error);
      return res.status(500).json({ error: '更新徽章失败' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      // 检查徽章是否存在
      const existingQuery = await queryFromD1('SELECT id FROM badges WHERE id = ?', [id]) as any;
      const existingResults = existingQuery.success ? existingQuery.result[0]?.results || [] : [];
      if (!existingResults || existingResults.length === 0) {
        return res.status(404).json({ error: '徽章不存在' });
      }

      // 删除徽章（会级联删除 user_badges 中的关联记录）
      await queryFromD1('DELETE FROM badges WHERE id = ?', [id]);

      return res.status(200).json({ success: true, message: '徽章删除成功' });
    } catch (error) {
      console.error('删除徽章失败:', error);
      return res.status(500).json({ error: '删除徽章失败' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
