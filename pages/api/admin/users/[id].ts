import { NextApiRequest, NextApiResponse } from 'next';
import { queryFromD1 } from '../../../../lib/database/core';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: '用户ID参数无效' });
  }

  const userId = parseInt(id, 10);
  if (isNaN(userId)) {
    return res.status(400).json({ error: '用户ID必须是数字' });
  }

  if (req.method === 'PUT') {
    // 更新用户信息
    try {
      const { is_banned, slot_count, prefix } = req.body;

      // 验证输入数据
      const updates: string[] = [];
      const params: any[] = [];

      if (is_banned !== undefined) {
        updates.push('is_banned = ?');
        params.push(is_banned || null);
      }

      if (slot_count !== undefined) {
        updates.push('slot_count = ?');
        params.push(slot_count ? parseInt(slot_count, 10) : null);
      }

      if (prefix !== undefined) {
        updates.push('prefix = ?');
        params.push(prefix || null);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: '没有要更新的字段' });
      }

      // 添加用户ID到参数
      params.push(userId);

      const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
      const result = await queryFromD1(query, params) as any;

      if (result.success) {
        // 获取更新后的用户信息
        const getUserQuery = 'SELECT * FROM users WHERE id = ?';
        const userResult = await queryFromD1(getUserQuery, [userId]) as any;
        
        if (userResult.success && userResult.result && userResult.result[0]?.results?.length > 0) {
          const updatedUser = userResult.result[0].results[0];
          res.status(200).json(updatedUser);
        } else {
          res.status(404).json({ error: '用户未找到' });
        }
      } else {
        res.status(500).json({ error: '更新用户信息失败' });
      }
    } catch (error) {
      console.error('更新用户信息失败:', error);
      res.status(500).json({ error: '更新用户信息失败' });
    }
  } else if (req.method === 'GET') {
    // 获取单个用户信息
    try {
      const query = 'SELECT * FROM users WHERE id = ?';
      const result = await queryFromD1(query, [userId]) as any;
      
      if (result.success && result.result && result.result[0]?.results?.length > 0) {
        const user = result.result[0].results[0];
        res.status(200).json(user);
      } else {
        res.status(404).json({ error: '用户未找到' });
      }
    } catch (error) {
      console.error('获取用户信息失败:', error);
      res.status(500).json({ error: '获取用户信息失败' });
    }
  } else {
    res.status(405).json({ error: '方法不被允许' });
  }
}