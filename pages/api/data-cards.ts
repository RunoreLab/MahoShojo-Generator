import { 
  getUserByAuthKey, 
  createDataCardWithAuthor, 
  getUserDataCards, 
  updateDataCard, 
  deleteDataCard,
  getUserDataCardCapacity
} from '@/lib/d1';
import { config } from '@/lib/config';
import { quickCheck } from '@/lib/sensitive-word-filter';

export const runtime = 'edge';

// 辅助函数：从请求头获取用户认证信息
async function getUserFromAuth(req: Request): Promise<{ id: number; username: string } | null> {
  const authHeader = req.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const authKey = authHeader.substring(7);
  const user = await getUserByAuthKey(authKey);
  
  return user;
}

export default async function handler(req: Request): Promise<Response> {
  // 验证用户身份
  const user = await getUserFromAuth(req);
  if (!user) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const userId = user.id;

  switch (req.method) {
    case 'GET':
      // 获取用户的所有数据卡
      try {
        const url = new URL(req.url);
        const search = url.searchParams.get('search'); // 搜索关键词
        const sortBy = url.searchParams.get('sortBy') as 'likes' | 'usage' | 'created_at' | null; // 排序方式
        
        const cards = await getUserDataCards(userId, search || undefined, sortBy || undefined);
        return new Response(JSON.stringify({ success: true, cards }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Get cards error:', error);
        return new Response(JSON.stringify({ error: '获取数据卡失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

    case 'POST':
      // 创建新数据卡
      try {
        const { type, name, description, data, isPublic } = await req.json();

        if (!type || !name || !data) {
          return new Response(JSON.stringify({ error: '缺少必要参数' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (type !== 'character' && type !== 'scenario') {
          return new Response(JSON.stringify({ error: '无效的数据卡类型' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 敏感词检查
        const textToCheck = `${name} ${description || ''} ${JSON.stringify(data)}`;
        const sensitiveWordResult = await quickCheck(textToCheck);
        
        if (sensitiveWordResult.hasSensitiveWords) {
          return new Response(JSON.stringify({ 
            error: 'SENSITIVE_WORD_DETECTED',
            redirect: '/arrested'
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 检查用户数据卡数量限制
        const existingCards = await getUserDataCards(userId);
        const userCapacity = await getUserDataCardCapacity(userId, config.DEFAULT_DATA_CARD_CAPACITY);
        if (existingCards.length >= userCapacity) {
          return new Response(JSON.stringify({ 
            error: `数据卡数量已达上限（${userCapacity}个），请删除部分数据卡后再试` 
          }), {
            status: 429, // Too Many Requests
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const result = await createDataCardWithAuthor(
          userId,
          user.username,
          type,
          name,
          description || '',
          JSON.stringify(data),
          isPublic || false
        );

        if (!result.success) {
          return new Response(JSON.stringify({ 
            error: result.error || '创建数据卡失败' 
          }), {
            status: result.error?.includes('同名') ? 409 : 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ 
          success: true, 
          id: result.id,
          message: '数据卡创建成功' 
        }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Create card error:', error);
        return new Response(JSON.stringify({ error: '创建数据卡失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

    case 'PUT':
      // 更新数据卡
      try {
        const { id, name, description, isPublic } = await req.json();

        if (!id) {
          return new Response(JSON.stringify({ error: '缺少数据卡ID' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 敏感词检查
        const textToCheck = `${name || ''} ${description || ''}`;
        const sensitiveWordResult = await quickCheck(textToCheck);
        
        if (sensitiveWordResult.hasSensitiveWords) {
          return new Response(JSON.stringify({ 
            error: 'SENSITIVE_WORD_DETECTED',
            redirect: '/arrested'
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const success = await updateDataCard(id, userId, name, description, isPublic);

        if (!success) {
          return new Response(JSON.stringify({ error: '数据卡不存在或无权访问' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, message: '数据卡更新成功' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Update card error:', error);
        return new Response(JSON.stringify({ error: '更新数据卡失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

    case 'DELETE':
      // 删除数据卡
      try {
        const url = new URL(req.url);
        const id = url.searchParams.get('id');

        if (!id) {
          return new Response(JSON.stringify({ error: '缺少数据卡ID' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const success = await deleteDataCard(id, userId);

        if (!success) {
          return new Response(JSON.stringify({ error: '数据卡不存在或无权访问' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({ success: true, message: '数据卡删除成功' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Delete card error:', error);
        return new Response(JSON.stringify({ error: '删除数据卡失败' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

    default:
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
  }
}