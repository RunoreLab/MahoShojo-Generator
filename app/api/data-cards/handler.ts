import { OnlineDataCardTypeSchema } from '@mahoshojo/contracts/data-cards';
import { normalizeOnlineDataCardVisibilityCompat } from '@/lib/data-card-visibility';
import { getRequestUrl } from '@/lib/request-url';
import { 
  createDataCardWithAuthor, 
  getUserDataCards, 
  updateDataCard, 
  deleteDataCard,
  pruneUserRecycleBin,
  upsertDataCardUpdate,
  getDataCardById,
  getUserUsedSlots,
  updateDataCardContentByIdAndUser as updateDataCardContentByIdAndUserLegacy,
} from '@/lib/database/data-cards';
import { getUserDataCardCapacity } from '@/lib/database/users';
import { requireAuthUser } from '@/lib/auth/server';
import { config as appConfig } from '@/lib/config';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { getDrizzleDbFromRuntime, type AppDrizzleDb } from '@/lib/db/drizzle';
import {
  getDataCardUpdatedAtById,
  updateDataCardContentByIdAndUser as updateDataCardContentByIdAndUserOrm,
} from '@/lib/db/repositories/data-cards-write';
import { formatKilobytes, getUtf8ByteLength, MAX_DATA_CARD_BYTES } from '@/lib/data-card-size';
import { computeTechIndex } from '@/lib/metrics/techIndex';
import { verifySignature } from '@/lib/signature';
import { upsertDataCardMetrics } from '@/lib/database/data-card-metrics';
import { resetStrictArenaRatingForDataCard } from '@/lib/database/arena-ratings';
import {
  autoReviewLatestPendingPublicDataCardsForUser,
  autoReviewLatestPendingPublicDataCardUpdatesForUser
} from '@/lib/review/auto-data-card-review';

async function getDataCardUpdatedAt(db: AppDrizzleDb | null, dataCardId: string): Promise<string | null> {
  if (!db) return null;
  try {
    return await getDataCardUpdatedAtById(db, dataCardId);
  } catch (error) {
    console.error('读取 data_cards.updated_at 失败:', error);
    return null;
  }
}

async function computeAndUpsertMetrics(
  db: AppDrizzleDb | null,
  dataCardId: string,
  dataJsonString: string,
): Promise<void> {
  try {
    const jsonValue = JSON.parse(dataJsonString) as unknown;
    const tech = computeTechIndex(jsonValue);

    const hasSignatureKey = Boolean(process.env.SIGNATURE_SECRET_KEY);
    const isNative = hasSignatureKey ? await verifySignature(jsonValue as any) : null;

    const updatedAt = await getDataCardUpdatedAt(db, dataCardId);
    if (!updatedAt) return;

    await upsertDataCardMetrics({
      dataCardId,
      techScore: tech.techScore,
      techLevel: tech.techLevel,
      isNative,
      dataCardUpdatedAt: updatedAt,
      detailsJson: {
        raw: tech.raw,
        derived: tech.derived,
        components: tech.components,
        notes: tech.notes,
      },
    });
  } catch (error) {
    console.warn('更新 data_card_metrics 失败（非阻塞）:', error);
  }
}

async function handler(req: Request): Promise<Response> {
  const auth = await requireAuthUser(req);
  if ('response' in auth) return auth.response;
  const user = auth.user;
  const db = getDrizzleDbFromRuntime();

  const userId = user.id;

  const makePayloadTooLargeResponse = (sizeBytes: number) =>
    new Response(
      JSON.stringify({
        error: `数据卡内容过大，最大允许 ${MAX_DATA_CARD_BYTES / 1024}KB，当前大小 ${formatKilobytes(sizeBytes)}KB`
      }),
      {
        status: 413, // Payload Too Large
        headers: { 'Content-Type': 'application/json' }
      }
    );

  switch (req.method) {
    case 'GET':
      // 获取用户的所有数据卡
      try {
        const url = getRequestUrl(req);
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
        const isAdmin = user.is_admin === 1;

        if (!type || !name || !data) {
          return new Response(JSON.stringify({ error: '缺少必要参数' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const typeResult = OnlineDataCardTypeSchema.safeParse(type);
        if (!typeResult.success) {
          return new Response(JSON.stringify({ error: '无效的数据卡类型' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        const cardType = typeResult.data;
        const normalizedPublic = isPublic == null
          ? 0
          : normalizeOnlineDataCardVisibilityCompat(isPublic);
        if (normalizedPublic === null) {
          return new Response(JSON.stringify({ error: '无效的数据卡可见性' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 检查数据卡内容大小（写入数据库前，按 UTF-8 字节数计）
        let dataString: string;
        let dataWithAuthorString: string;
        try {
          const isPlainObject = (value: unknown): value is Record<string, unknown> =>
            typeof value === 'object' && value !== null && !Array.isArray(value);
          const sanitizedPayload =
            cardType === 'questionnaire' && !isAdmin && isPlainObject(data)
              ? { ...data, nativeAllowed: false }
              : data;

          dataString = JSON.stringify(sanitizedPayload);
          dataWithAuthorString = JSON.stringify({ ...(JSON.parse(dataString) as any), _author: user.username, _authorId: userId });
        } catch {
          return new Response(JSON.stringify({ error: 'data 无法序列化为 JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const dataSize = getUtf8ByteLength(dataWithAuthorString);
        if (dataSize > MAX_DATA_CARD_BYTES) return makePayloadTooLargeResponse(dataSize);

        // 敏感词检查
        const textToCheck = `${name} ${description || ''} ${dataWithAuthorString}`;
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
        const userCapacity = await getUserDataCardCapacity(userId, appConfig.DEFAULT_DATA_CARD_CAPACITY);
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
          cardType,
          name,
          description || '',
          dataWithAuthorString,
          normalizedPublic,
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

        if (result.id) {
          const tasks: Promise<unknown>[] = [computeAndUpsertMetrics(db, result.id, dataWithAuthorString)];
          const shouldAutoReview =
            appConfig.DATA_CARD_AUTO_REVIEW?.enabled && normalizedPublic === 1 && reviewStatus === 'pending';
          if (shouldAutoReview) {
            tasks.push(autoReviewLatestPendingPublicDataCardsForUser(userId));
          }

          const combined = Promise.all(tasks).then(() => undefined);
          const executionContext = (req as any).context;
          if (executionContext?.waitUntil) {
            executionContext.waitUntil(combined);
          } else {
            await combined;
          }
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

        const normalizedPublicInput = isPublic === undefined
          ? undefined
          : isPublic === null
            ? 0
            : normalizeOnlineDataCardVisibilityCompat(isPublic);
        if (normalizedPublicInput === null) {
          return new Response(JSON.stringify({ error: '无效的数据卡可见性' }), {
            status: 400,
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

        let dataString: string | null = null;
        const dataChanged = data !== undefined;
        if (dataChanged) {
          const isPlainObject = (value: unknown): value is Record<string, unknown> =>
            typeof value === 'object' && value !== null && !Array.isArray(value);

          const preservedNativeAllowed = (() => {
            if (currentCard.type !== 'questionnaire') return null;
            if (isAdmin) return null;
            if (typeof currentCard.data !== 'string') return null;
            try {
              const parsed = JSON.parse(currentCard.data) as any;
              return typeof parsed?.nativeAllowed === 'boolean' ? parsed.nativeAllowed : null;
            } catch {
              return null;
            }
          })();

          const nextPayload =
            currentCard.type === 'questionnaire' && !isAdmin && isPlainObject(data)
              ? { ...data, nativeAllowed: preservedNativeAllowed === true }
              : data;

          try {
            dataString = JSON.stringify(nextPayload);
          } catch {
            return new Response(JSON.stringify({ error: 'data 无法序列化为 JSON' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          const dataSizeBytes = getUtf8ByteLength(dataString);
          if (dataSizeBytes > MAX_DATA_CARD_BYTES) return makePayloadTooLargeResponse(dataSizeBytes);
        }

        // 敏感词检查：标题+描述+（可选）数据
        const textToCheck = `${name || ''} ${description || ''} ${dataString ?? ''}`;
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

        const normalizedPublicAfter =
          normalizedPublicInput === undefined
            ? Number(currentCard.is_public) === 1
              ? 1
              : 0
            : normalizedPublicInput;
        const shouldAutoReview =
          appConfig.DATA_CARD_AUTO_REVIEW?.enabled &&
          !isExempt &&
          !isAdmin &&
          normalizedPublicAfter === 1 &&
          currentCard.review_status === 'pending';

        // 如果不需要审核（pending/rejected 或 豁免 / 管理员），直接更新主表
        if (isPendingOrRejected || isExempt || isAdmin) {
          const success = await updateDataCard(
            id,
            userId,
            name ?? currentCard.name,
            description ?? currentCard.description,
            normalizedPublicInput,
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
            if (db) {
              await updateDataCardContentByIdAndUserOrm(db, id, userId, dataString!);
            } else {
              const updatedByLegacy = await updateDataCardContentByIdAndUserLegacy(id, userId, dataString!);
              if (!updatedByLegacy) {
                return new Response(JSON.stringify({ error: '数据卡不存在或无权访问' }), {
                  status: 404,
                  headers: { 'Content-Type': 'application/json' }
                });
              }
            }

            const metricsPromise = computeAndUpsertMetrics(db, id, dataString!);
            const resetStrictPromise =
              currentCard.type === 'character'
                ? resetStrictArenaRatingForDataCard(id)
                : Promise.resolve();
            const combined = Promise.all([
              metricsPromise,
              resetStrictPromise,
              shouldAutoReview ? autoReviewLatestPendingPublicDataCardsForUser(userId) : Promise.resolve(),
            ]).then(() => undefined);
            const executionContext = (req as any).context;
            if (executionContext?.waitUntil) {
              executionContext.waitUntil(combined);
            } else {
              await combined;
            }
          }

          if (!dataChanged && shouldAutoReview) {
            const executionContext = (req as any).context;
            const autoReviewPromise = autoReviewLatestPendingPublicDataCardsForUser(userId).then(() => undefined);
            if (executionContext?.waitUntil) {
              executionContext.waitUntil(autoReviewPromise);
            } else {
              await autoReviewPromise;
            }
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
            data: dataString!
          };
          const ok = await upsertDataCardUpdate(id, userId, payload);
          if (!ok) {
            return new Response(JSON.stringify({ error: '提交更新失败' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          const shouldAutoReviewUpdate =
            appConfig.DATA_CARD_AUTO_REVIEW?.enabled && Number(currentCard.is_public) === 1;
          if (shouldAutoReviewUpdate) {
            const executionContext = (req as any).context;
            const autoReviewPromise = autoReviewLatestPendingPublicDataCardUpdatesForUser(userId).then(() => undefined);
            if (executionContext?.waitUntil) {
              executionContext.waitUntil(autoReviewPromise);
            } else {
              await autoReviewPromise;
            }
          }

          return new Response(JSON.stringify({ success: true, pendingReview: true, message: '更新已提交，待审核' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 仅修改元信息（名称、描述、公开状态），直接更新主表
        const success = await updateDataCard(
          id,
          userId,
          name ?? currentCard.name,
          description ?? currentCard.description,
          normalizedPublicInput,
        );
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
        const url = getRequestUrl(req);
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

        await pruneUserRecycleBin(userId, appConfig.RECYCLE_BIN_LIMIT);

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

export const appRouteHandler = handler;
export default appRouteHandler;
