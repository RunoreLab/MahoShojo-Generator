import { NextApiRequest, NextApiResponse } from 'next';
import { queryFromD1 } from '../../../lib/database/core';
import { getUserByUsername } from '../../../lib/database/users';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { page = '1', limit = '20', search = '', username } = req.query;

    // 如果提供了username参数，返回单个用户详情
    if (username && typeof username === 'string') {
      try {
        const user = await getUserByUsername(username);
        
        if (!user) {
          return res.status(404).json({ error: '用户未找到' });
        }

        return res.status(200).json(user);
      } catch (error) {
        console.error('获取用户详情失败:', error);
        return res.status(500).json({ error: '获取用户详情失败' });
      }
    }

    // 否则返回用户列表
    try {
      const pageNum = parseInt(page as string, 10);
      const limitNum = parseInt(limit as string, 10);
      const offset = (pageNum - 1) * limitNum;

      let query = `
        SELECT 
          id, username, email, auth_key, created_at, last_login_at, 
          is_banned, slot_count, registration_ip, prefix
        FROM users
      `;
      const params: any[] = [];

      // 如果有搜索条件，添加WHERE子句
      if (search) {
        query += ` WHERE username LIKE ? OR email LIKE ?`;
        params.push(`%${search}%`, `%${search}%`);
      }

      // 添加排序和分页
      query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(limitNum, offset);

      // 获取用户数据
      const result = await queryFromD1(query, params) as any;

      let users = [];
      if (result.success && result.result && result.result[0]?.results) {
        users = result.result[0].results;
      }

      // 获取总数用于分页
      let countQuery = 'SELECT COUNT(*) as total FROM users';
      const countParams: any[] = [];
      
      if (search) {
        countQuery += ` WHERE username LIKE ? OR email LIKE ?`;
        countParams.push(`%${search}%`, `%${search}%`);
      }

      const countResult = await queryFromD1(countQuery, countParams) as any;
      let total = 0;
      
      if (countResult.success && countResult.result && countResult.result[0]?.results?.length > 0) {
        total = countResult.result[0].results[0].total;
      }

      const totalPages = Math.ceil(total / limitNum);

      res.status(200).json({
        users,
        currentPage: pageNum,
        totalPages,
        total,
        limit: limitNum
      });

    } catch (error) {
      console.error('获取用户列表失败:', error);
      res.status(500).json({ error: '获取用户列表失败' });
    }
  } else {
    res.status(405).json({ error: '方法不被允许' });
  }
}