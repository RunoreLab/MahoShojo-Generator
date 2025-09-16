import { NextApiRequest, NextApiResponse } from 'next';
import { queryFromD1 } from '../../../lib/database/core';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { page = '1', limit = '20', search = '', id, type, status } = req.query;

    // 如果提供了id参数，返回单个角色卡详情
    if (id && typeof id === 'string') {
      try {
        const result = await queryFromD1(
          `SELECT dc.*, u.username 
           FROM data_cards dc 
           JOIN users u ON dc.user_id = u.id 
           WHERE dc.id = ?`,
          [id]
        ) as any;
        
        if (result.success && result.result && result.result[0]?.results?.length > 0) {
          return res.status(200).json(result.result[0].results[0]);
        } else {
          return res.status(404).json({ error: '角色卡未找到' });
        }
      } catch (error) {
        console.error('获取角色卡详情失败:', error);
        return res.status(500).json({ error: '获取角色卡详情失败' });
      }
    }

    // 否则返回角色卡列表
    try {
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 20);
      const offset = (pageNum - 1) * limitNum;

      let query = `
        SELECT 
          dc.id, dc.user_id, dc.type, dc.name, dc.description, 
          dc.is_public, dc.usage_count, dc.like_count, 
          dc.created_at, dc.updated_at, u.username
        FROM data_cards dc 
        JOIN users u ON dc.user_id = u.id
        WHERE 1=1
      `;
      const params: any[] = [];

      // 搜索条件
      if (search) {
        query += ` AND (dc.name LIKE ? OR dc.description LIKE ? OR u.username LIKE ?)`;
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      // 类型过滤
      if (type && type !== 'all') {
        query += ` AND dc.type = ?`;
        params.push(type);
      }

      // 状态过滤
      if (status && status !== 'all') {
        if (status === 'public') {
          query += ` AND dc.is_public = 1`;
        } else if (status === 'private') {
          query += ` AND dc.is_public = 0`;
        } else if (status === 'banned') {
          query += ` AND dc.is_public = -1`;
        }
      }

      // 添加排序和分页
      query += ` ORDER BY dc.updated_at DESC LIMIT ? OFFSET ?`;
      params.push(limitNum, offset);

      // 获取角色卡数据
      const result = await queryFromD1(query, params) as any;

      let cards = [];
      if (result.success && result.result && result.result[0]?.results) {
        cards = result.result[0].results;
      }

      // 获取总数用于分页
      let countQuery = `
        SELECT COUNT(*) as total 
        FROM data_cards dc 
        JOIN users u ON dc.user_id = u.id
        WHERE 1=1
      `;
      const countParams: any[] = [];
      
      // 添加相同的搜索和过滤条件
      if (search) {
        countQuery += ` AND (dc.name LIKE ? OR dc.description LIKE ? OR u.username LIKE ?)`;
        countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
      }

      if (type && type !== 'all') {
        countQuery += ` AND dc.type = ?`;
        countParams.push(type);
      }

      if (status && status !== 'all') {
        if (status === 'public') {
          countQuery += ` AND dc.is_public = 1`;
        } else if (status === 'private') {
          countQuery += ` AND dc.is_public = 0`;
        } else if (status === 'banned') {
          countQuery += ` AND dc.is_public = -1`;
        }
      }

      const countResult = await queryFromD1(countQuery, countParams) as any;
      let total = 0;
      
      if (countResult.success && countResult.result && countResult.result[0]?.results?.length > 0) {
        total = countResult.result[0].results[0].total;
      }

      const totalPages = Math.ceil(total / limitNum);

      res.status(200).json({
        cards,
        currentPage: pageNum,
        totalPages,
        total,
        limit: limitNum
      });

    } catch (error) {
      console.error('获取角色卡列表失败:', error);
      res.status(500).json({ error: '获取角色卡列表失败' });
    }
  } else {
    res.status(405).json({ error: '方法不被允许' });
  }
}