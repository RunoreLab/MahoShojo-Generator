import { NextApiRequest, NextApiResponse } from 'next';
import { queryFromD1 } from '../../../../lib/database/core';
import { reviewDataCardUpdate } from '@/lib/database/admin';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: '角色卡ID参数无效' });
  }

  if (req.method === 'PUT') {
    // 更新角色卡信息
    try {
      const { name, description, is_public, update_action, update_id } = req.body;

      // 如果是审核更新记录
      if (update_action && update_id) {
        const ok = await reviewDataCardUpdate(update_id, update_action === 'approve' ? 'approve' : 'reject');
        if (!ok) {
          return res.status(400).json({ error: '处理更新记录失败' });
        }
        return res.status(200).json({ success: true });
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
        return res.status(400).json({ error: '没有要更新的字段' });
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
          res.status(200).json(updatedCard);
        } else {
          res.status(404).json({ error: '角色卡未找到' });
        }
      } else {
        res.status(404).json({ error: '角色卡未找到或无权限更新' });
      }
    } catch (error) {
      console.error('更新角色卡信息失败:', error);
      res.status(500).json({ error: '更新角色卡信息失败' });
    }
  } else if (req.method === 'GET') {
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
        res.status(200).json(card);
      } else {
        res.status(404).json({ error: '角色卡未找到' });
      }
    } catch (error) {
      console.error('获取角色卡信息失败:', error);
      res.status(500).json({ error: '获取角色卡信息失败' });
    }
  } else if (req.method === 'DELETE') {
    // 删除角色卡（管理员功能）
    try {
      const result = await queryFromD1(
        'DELETE FROM data_cards WHERE id = ?',
        [id]
      ) as any;
      
      if (result.success && result.result && result.result[0]?.meta?.changes > 0) {
        res.status(200).json({ success: true, message: '角色卡删除成功' });
      } else {
        res.status(404).json({ error: '角色卡未找到' });
      }
    } catch (error) {
      console.error('删除角色卡失败:', error);
      res.status(500).json({ error: '删除角色卡失败' });
    }
  } else {
    res.status(405).json({ error: '方法不被允许' });
  }
}
