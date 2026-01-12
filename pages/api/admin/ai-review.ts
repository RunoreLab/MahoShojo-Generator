// pages/api/admin/ai-review.ts

import { getReviewTargetsForAiReview } from '@/lib/database/admin';
import { generateWithAI } from '@/lib/ai';
import { getLogger } from '@/lib/logger';
import { z } from 'zod';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';
const log = getLogger('api-ai-review');

// 1. 定义 AI 期望返回的 JSON 对象的 Zod Schema
const AiReviewSuggestionSchema = z.object({
  id: z.string().describe("对应待审查目标的唯一ID（由前端生成并透传，可能包含 card:/update: 前缀）。"),
  suggestion: z.enum(['approved', 'rejected']).describe("审查建议：'approved' (通过) 或 'rejected' (拒绝)"),
  reason: z.string().describe("做出该建议的简短理由（不超过50字）。如果建议通过，理由可以是'内容合规'。"),
});

// 2. 定义 AI 期望返回的整个数组的 Schema
const AiReviewResponseSchema = z.object({
  reviews: z.array(AiReviewSuggestionSchema),
});
// 从 Zod schema 推断出单个审查建议的 TypeScript 类型
type AiReviewSuggestion = z.infer<typeof AiReviewSuggestionSchema>;

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

    // 5. 构建发送给 AI 的 Prompt
    const promptBuilder = (cards: typeof reviewTargets): string => {
      const cardContents = cards.map(card => `
        {
          "id": "${card.id}",
          "name": "${card.name}",
          "description": "${card.description}",
          "data": ${card.data}
        }
      `).join(',\n');
      
      return `
        这里有一批用户提交的数据卡内容（JSON格式），请你对每一个进行内容安全审查。
        审查标准：是否包含任何违背公序良俗、涉及或影射政治、现实、脏话、性、色情、暴力、仇恨言论、歧视、犯罪、争议性的内容。
        请严格按照提供的JSON Schema格式返回你的审查建议。
        
        待审查的数据卡列表如下:
        [
          ${cardContents}
        ]
      `;
    };

    // 6. 配置并调用 AI 生成函数
    const generationConfig: any = {
      systemPrompt: "你是一个经验丰富的内容审查员，负责确保用户生成内容的合规性。你的回答必须精确、简洁，并严格遵守JSON格式。",
      temperature: 0.1,
      promptBuilder: () => promptBuilder(reviewTargets),
      // Zod 类型与 SDK 泛型定义存在版本不匹配，这里强制断言以保证类型安全由运行时校验负责
      schema: AiReviewResponseSchema as any,
      taskName: "AI内容辅助审查",
      modelOverride: normalizedModelOverride, // 允许前端传递模型名称（default 表示不覆盖）
      maxOutputTokens: 4096,
    };

    const aiResult: any = await generateWithAI({}, generationConfig);

// 7. 将数据库信息与AI结果合并，返回给前端更完整的数据
    const fullReviews = aiResult.reviews.map((review: AiReviewSuggestion) => {
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
