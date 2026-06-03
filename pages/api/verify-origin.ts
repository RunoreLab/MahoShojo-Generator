import { withPagesApiResponse } from '@/lib/pages-api-adapter';
// pages/api/verify-origin.ts
import { NextRequest } from 'next/server';
import { verifySignature } from '../../lib/signature'; // 导入我们的校验工具

async function handler(req: NextRequest) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const characterData = await req.json();
    
    // 调用校验函数
    const isValid = await verifySignature(characterData);
    
    // 返回校验结果
    return new Response(JSON.stringify({ isValid }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    // 如果请求体不是有效的JSON，或者发生其他错误，都视为校验失败
    console.error('校验API出错:', error);
    return new Response(JSON.stringify({ isValid: false, error: '无效的请求数据' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default withPagesApiResponse(handler);