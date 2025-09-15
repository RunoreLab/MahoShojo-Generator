import { incrementDataCardLike, incrementDataCardUsage } from '@/lib/d1';

export const runtime = 'edge';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { cardId, type } = await req.json();
    
    if (!cardId || !type || !['like', 'usage'].includes(type)) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '无效的参数' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (type === 'like') {
      await incrementDataCardLike(cardId);
    } else if (type === 'usage') {
      await incrementDataCardUsage(cardId);
    }

    return new Response(JSON.stringify({
      success: true
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Increment data card stats error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: '操作失败' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}