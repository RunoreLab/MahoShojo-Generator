import { queryFromD1 } from '@/lib/d1';

export const runtime = 'edge';

/**
 * 管理员徽章管理 API
 * GET - 获取所有徽章列表
 * POST - 创建新徽章
 */
export default async function handler(req: Request): Promise<Response> {
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
        ORDER BY sort_order ASC, rarity DESC, created_at DESC
      `, []) as any;

      const cards = results.success ? results.result[0]?.results || [] : [];

      const badges = cards.map((row: any) => {
        // 安全地解析 JSON 字段
        let icon, textColor, backgroundColor, borderColor;

        try {
          icon = typeof row.icon === 'string' ? JSON.parse(row.icon) : row.icon;
        } catch {
          icon = { type: 'null', value: null };
        }

        try {
          textColor = typeof row.textColor === 'string' ? JSON.parse(row.textColor) : row.textColor;
        } catch {
          textColor = { type: 'solid', value: '#000000' };
        }

        try {
          backgroundColor = typeof row.backgroundColor === 'string' ? JSON.parse(row.backgroundColor) : row.backgroundColor;
        } catch {
          backgroundColor = { type: 'solid', value: '#FFFFFF' };
        }

        try {
          borderColor = row.borderColor ? (typeof row.borderColor === 'string' ? JSON.parse(row.borderColor) : row.borderColor) : undefined;
        } catch {
          borderColor = undefined;
        }

        return {
          id: row.id,
          name: row.name,
          description: row.description,
          icon,
          textColor,
          backgroundColor,
          borderColor,
          rarity: row.rarity,
          sortOrder: row.sortOrder,
          isActive: Boolean(row.isActive),
          createdAt: row.createdAt
        };
      });

      return new Response(JSON.stringify({ success: true, badges }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('获取徽章列表失败:', error);
      return new Response(JSON.stringify({ error: '获取徽章列表失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const {
        id,
        name,
        description,
        icon,
        textColor,
        backgroundColor,
        borderColor,
        rarity = 0,
        sortOrder = 0,
        isActive = true
      } = body;

      // 验证必填字段
      if (!id || !name || !icon || !textColor || !backgroundColor) {
        return new Response(
          JSON.stringify({ error: '缺少必填字段' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 检查ID是否已存在
      const existingQuery = await queryFromD1('SELECT id FROM badges WHERE id = ?', [id]) as any;
      const existing = existingQuery.success ? existingQuery.result[0]?.results || [] : [];
      if (existing && existing.length > 0) {
        return new Response(
          JSON.stringify({ error: '徽章ID已存在' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 插入新徽章
      await queryFromD1(`
        INSERT INTO badges (
          id, name, description, icon, text_color, background_color,
          border_color, rarity, sort_order, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        name,
        description || null,
        JSON.stringify(icon),
        JSON.stringify(textColor),
        JSON.stringify(backgroundColor),
        borderColor ? JSON.stringify(borderColor) : null,
        rarity,
        sortOrder,
        isActive ? 1 : 0
      ]);

      return new Response(
        JSON.stringify({ success: true, message: '徽章创建成功', badgeId: id }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('创建徽章失败:', error);
      return new Response(JSON.stringify({ error: '创建徽章失败' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' }
  });
}
