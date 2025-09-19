// pages/api/admin/dashboard-stats.ts

import { getDashboardStats } from '@/lib/database/admin';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

/**
 * @fileoverview API端点，用于获取后台管理仪表盘所需的统计数据。
 * @description
 * 这是一个简单的GET端点，它调用数据库层的 getDashboardStats 函数来汇总数据，
 * 并以JSON格式返回给前端。
 */
export default async function handler(req: NextRequest) {
  // 仅允许GET请求
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  // 此阶段暂不进行严格的管理员身份验证

  try {
    // 调用我们刚刚创建的数据库函数
    const stats = await getDashboardStats();
    
    // 成功获取数据后，返回200 OK响应
    return new Response(JSON.stringify({ success: true, stats }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Admin API - 获取仪表盘统计数据失败:', error);
    return new Response(JSON.stringify({ success: false, error: '获取统计数据失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}