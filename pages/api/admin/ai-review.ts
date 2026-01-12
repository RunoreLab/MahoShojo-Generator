// pages/api/admin/ai-review.ts

import { getReviewTargetsForAiReview } from '@/lib/database/admin';
import { generateWithAI } from '@/lib/ai';
import { getLogger } from '@/lib/logger';
import type { NextRequest } from 'next/server';
import {
  buildDataCardAiReviewPrompt,
  DATA_CARD_AI_REVIEW_SYSTEM_PROMPT,
  DataCardAiReviewResponseSchema,
  type DataCardAiReviewSuggestion,
} from '@/lib/review/data-card-ai-review';

export const runtime = 'edge';
const log = getLogger('api-ai-review');

// 3. 定义 API 的 Handler
export default async function handler(req: NextRequest) {
  // 暂不进行管理员身份验证
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { cardIds, model, targets } = await req.json();
    const normalizedModelOverride =
      typeof model === 'string' && model.trim() && model.trim() !== 'default' ? model.trim() : undefined;

    const normalizedTargets: { kind: 'card' | 'update'; id: string; targetId: string }[] = [];
    if (Array.isArray(targets) && targets.length > 0) {
      for (const target of targets) {
        if (!target || (target.kind !== 'card' && target.kind !== 'update') || typeof target.id !== 'string' || typeof target.targetId !== 'string') {
          return new Response(JSON.stringify({ success: false, error: 'targets 参数格式无效' }), { status: 400 });
        }
        normalizedTargets.push({ kind: target.kind, id: target.id, targetId: target.targetId });
      }
    } else if (Array.isArray(cardIds) && cardIds.length > 0) {
      for (const id of cardIds) {
        if (typeof id !== 'string') continue;
        normalizedTargets.push({ kind: 'card', id, targetId: id });
      }
    } else {
      return new Response(JSON.stringify({ success: false, error: '缺少 targets 或 cardIds 参数' }), { status: 400 });
    }

    // 4. 从数据库获取待审查目标的详细内容
    const reviewTargets = await getReviewTargetsForAiReview(normalizedTargets);
    if (reviewTargets.length === 0) {
      return new Response(JSON.stringify({ success: true, reviews: [] }), { status: 200 });
    }

    // 6. 配置并调用 AI 生成函数
    const generationConfig: any = {
      systemPrompt: DATA_CARD_AI_REVIEW_SYSTEM_PROMPT,
      temperature: 0.1,
      promptBuilder: buildDataCardAiReviewPrompt,
      // Zod 类型与 SDK 泛型定义存在版本不匹配，这里强制断言以保证类型安全由运行时校验负责
      schema: DataCardAiReviewResponseSchema as any,
      taskName: "AI内容辅助审查",
      modelOverride: normalizedModelOverride, // 允许前端传递模型名称（default 表示不覆盖）
      maxOutputTokens: 4096,
    };

    const aiResult: any = await generateWithAI(reviewTargets, generationConfig);

// 7. 将数据库信息与AI结果合并，返回给前端更完整的数据
    const fullReviews = aiResult.reviews.map((review: DataCardAiReviewSuggestion) => {
        const originalCard = reviewTargets.find(c => c.id === review.id);
        return {
            ...review,
            name: originalCard?.name || '未知卡片',
        };
    });

    return new Response(JSON.stringify({ success: true, reviews: fullReviews }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    log.error('AI辅助审查失败:', { error });
    const message = error instanceof Error ? error.message : 'AI审查时发生未知错误';
    return new Response(JSON.stringify({ success: false, error: message }), { status: 500 });
  }
}
