import { 
  getUserByAuthKey, 
  createDataCardWithAuthor, 
  getUserDataCards, 
  updateDataCard, 
  deleteDataCard,
  getUserDataCardCapacity,
  pruneUserRecycleBin,
  upsertDataCardUpdate,
  getDataCardUpdate,
  deleteDataCardUpdate,
  getDataCardById,
  getUserUsedSlots
} from '@/lib/d1';
import { config } from '@/lib/config';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { isHotCard } from '@/lib/constants';
import { queryFromD1 } from '@/lib/d1';

export const runtime = 'edge';

// [v0.4.2] 扩展 User 类型以包含新字段
interface AuthenticatedUser {
  id: number;
  username: string;
  is_review_exempt: number; // 0 or 1
  is_admin: number; // 0 or 1
}

// 辅助函数：从请求头获取用户认证信息
async function getUserFromAuth(req: Request): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const authKey = authHeader.substring(7);
  // getUserByAuthKey 返回 user 表的所有字段，所以这里能直接获取到 is_review_exempt
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
        const sortBy = url.searchParams.get('sortBy') as 'likes' | 'usage' | 'favorites' | 'created_at' | null; // 排序方式
        
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

        // 检查数据卡内容大小 (32KB 限制)
        const dataString = JSON.stringify(data);
        const dataSize = new TextEncoder().encode(dataString).length;
        const maxSize = 150 * 1024; // 150KB
        
        if (dataSize > maxSize) {
          return new Response(JSON.stringify({ 
            error: `数据卡内容过大，最大允许 ${maxSize / 1024}KB，当前大小 ${(dataSize / 1024).toFixed(1)}KB` 
          }), {
            status: 413, // Payload Too Large
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 敏感词检查
        const textToCheck = `${name} ${description || ''} ${dataString}`;
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

        // 检查用户数据卡数量限制（热门卡不占槽）
        const usedSlots = await getUserUsedSlots(userId);
        const userCapacity = await getUserDataCardCapacity(userId, config.DEFAULT_DATA_CARD_CAPACITY);
        if (usedSlots >= userCapacity) {
          return new Response(JSON.stringify({ 
            error: `数据卡数量已达上限（${userCapacity}个），请删除部分数据卡后再试` 
          }), {
            status: 429, // Too Many Requests
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // [v0.4.2 核心逻辑] 根据用户豁免状态决定审查状态
        const reviewStatus = user.is_review_exempt === 1 ? 'approved' : 'pending';

        const result = await createDataCardWithAuthor(
          userId,
          user.username,
          type,
          name,
          description || '',
          dataString,
          isPublic ?? 0,
          reviewStatus // 传入新的审查状态
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

    case 'PUT': {
      try {
        const { id, name, description, isPublic, data } = await req.json();

        if (!id) {
          return new Response(JSON.stringify({ error: '缺少数据卡ID' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 敏感词检查：标题+描述+（可选）数据
        const textToCheck = `${name || ''} ${description || ''} ${data ? JSON.stringify(data) : ''}`;
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

        // 读取当前卡片
        const currentCard = await getDataCardById(id, false);
        if (!currentCard || currentCard.user_id !== userId) {
          return new Response(JSON.stringify({ error: '数据卡不存在或无权访问' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const isExempt = user.is_review_exempt === 1;
        const isAdmin = user.is_admin === 1;
        const isPendingOrRejected = currentCard.review_status !== 'approved';
        const dataChanged = data !== undefined;

        // 如果不需要审核（pending/rejected 或 豁免 / 管理员），直接更新主表
        if (isPendingOrRejected || isExempt || isAdmin) {
          const success = await updateDataCard(
            id,
            userId,
            name ?? currentCard.name,
            description ?? currentCard.description,
            isPublic,
            currentCard.review_status
          );

          if (!success) {
            return new Response(JSON.stringify({ error: '数据卡不存在或无权访问' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          // 如果带 data，一并更新
          if (dataChanged) {
            const dataString = JSON.stringify(data);
            await queryFromD1(
              'UPDATE data_cards SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
              [dataString, id, userId]
            );
          }

          return new Response(JSON.stringify({ success: true, message: '数据卡更新成功' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 普通用户更新已审核卡片：内容变更需要进入待审核表
        if (dataChanged) {
          const payload = {
            name: name ?? currentCard.name,
            description: description ?? currentCard.description,
            data: JSON.stringify(data)
          };
          const ok = await upsertDataCardUpdate(id, userId, payload);
          if (!ok) {
            return new Response(JSON.stringify({ error: '提交更新失败' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return new Response(JSON.stringify({ success: true, pendingReview: true, message: '更新已提交，待审核' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 仅修改元信息（名称、描述、公开状态），直接更新主表
        const success = await updateDataCard(id, userId, name ?? currentCard.name, description ?? currentCard.description, isPublic);
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

        await pruneUserRecycleBin(userId, config.RECYCLE_BIN_LIMIT);

        return new Response(JSON.stringify({ success: true, message: '数据卡已移入回收站' }), {
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
