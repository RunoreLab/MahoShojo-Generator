import { generateWithAI } from '@/lib/ai';
import { config } from '@/lib/config';
import { queryFromD1 } from '@/lib/d1';
import { getLogger } from '@/lib/logger';
import {
  buildDataCardAiReviewPrompt,
  DATA_CARD_AI_REVIEW_SYSTEM_PROMPT,
  DataCardAiReviewResponseSchema,
  type DataCardAiReviewResponse,
  type DataCardAiReviewTarget,
} from '@/lib/review/data-card-ai-review';

const log = getLogger('auto-data-card-review');

type PendingDataCardRow = {
  id: string;
  name: string;
  description: string | null;
  data: string;
};

const readInt = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Math.trunc(Number(value));
  return 0;
};

async function countPendingPublicCards(userId: number): Promise<number> {
  const result = (await queryFromD1(
    `SELECT COUNT(1) AS count
     FROM data_cards
     WHERE user_id = ?
       AND is_public = 1
       AND review_status = 'pending'
       AND deleted_at IS NULL`,
    [userId],
  )) as any;
  const row = result?.result?.[0]?.results?.[0];
  return readInt(row?.count);
}

async function getLatestPendingPublicCards(userId: number, limit: number): Promise<PendingDataCardRow[]> {
  if (limit <= 0) return [];
  const result = (await queryFromD1(
    `SELECT id, name, description, data
     FROM data_cards
     WHERE user_id = ?
       AND is_public = 1
       AND review_status = 'pending'
       AND deleted_at IS NULL
     ORDER BY updated_at DESC
     LIMIT ?`,
    [userId, limit],
  )) as any;
  const rows = result?.result?.[0]?.results;
  return Array.isArray(rows) ? (rows as PendingDataCardRow[]) : [];
}

async function approvePendingPublicCards(userId: number, cardIds: string[]): Promise<number> {
  const uniqueIds = Array.from(new Set(cardIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return 0;

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const sql = `
    UPDATE data_cards
    SET review_status = 'approved', updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
      AND id IN (${placeholders})
      AND is_public = 1
      AND review_status = 'pending'
      AND deleted_at IS NULL
  `;

  const result = (await queryFromD1(sql, [userId, ...uniqueIds])) as any;
  const changes = result?.result?.[0]?.meta?.changes;
  return readInt(changes);
}

async function generateAiReviewWithModelFallbacks(targets: DataCardAiReviewTarget[]): Promise<{
  result: DataCardAiReviewResponse;
  usedModel: string | null;
}> {
  const fallbackModels = Array.isArray(config.DATA_CARD_AUTO_REVIEW?.modelFallbacks)
    ? config.DATA_CARD_AUTO_REVIEW.modelFallbacks.filter((m) => typeof m === 'string' && m.trim())
    : [];

  const baseConfig = {
    systemPrompt: DATA_CARD_AI_REVIEW_SYSTEM_PROMPT,
    temperature: 0.1,
    promptBuilder: buildDataCardAiReviewPrompt,
    schema: DataCardAiReviewResponseSchema as any,
    taskName: '数据卡自动审查',
  } as const;

  if (fallbackModels.length === 0) {
    const result = (await generateWithAI(targets, baseConfig as any)) as any;
    return { result, usedModel: null };
  }

  let lastError: unknown = null;
  for (const modelOverride of fallbackModels) {
    try {
      const result = (await generateWithAI(targets, { ...(baseConfig as any), modelOverride }, undefined)) as any;
      return { result, usedModel: modelOverride };
    } catch (error) {
      lastError = error;
      log.warn('自动审查模型调用失败，将尝试下一备选', { modelOverride, error });
    }
  }

  throw lastError ?? new Error('所有自动审查模型均失败');
}

export type AutoReviewResult = {
  ok: boolean;
  reviewedCount: number;
  approvedCount: number;
  approvedIds: string[];
  usedModel: string | null;
  reason?: string;
};

export async function autoReviewLatestPendingPublicDataCardsForUser(userId: number): Promise<AutoReviewResult> {
  const autoReviewConfig = config.DATA_CARD_AUTO_REVIEW;
  if (!autoReviewConfig?.enabled) {
    return { ok: false, reviewedCount: 0, approvedCount: 0, approvedIds: [], usedModel: null, reason: 'disabled' };
  }

  const pendingCount = await countPendingPublicCards(userId);
  if (autoReviewConfig.batch?.enabled) {
    const threshold = Math.max(1, Math.trunc(autoReviewConfig.batch.threshold ?? 1));
    if (pendingCount < threshold) {
      return {
        ok: false,
        reviewedCount: 0,
        approvedCount: 0,
        approvedIds: [],
        usedModel: null,
        reason: `batch-waiting:${pendingCount}/${threshold}`,
      };
    }
  }

  const lookback = Math.max(0, Math.trunc(autoReviewConfig.lookbackPendingCount ?? 0));
  const limit = autoReviewConfig.batch?.enabled
    ? Math.max(1, Math.trunc(autoReviewConfig.batch.threshold ?? 1))
    : Math.max(1, lookback + 1);

  const pendingCards = await getLatestPendingPublicCards(userId, limit);
  if (pendingCards.length === 0) {
    return { ok: true, reviewedCount: 0, approvedCount: 0, approvedIds: [], usedModel: null, reason: 'no-pending' };
  }

  const targets: DataCardAiReviewTarget[] = pendingCards.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    data: row.data,
  }));

  let ai: { result: DataCardAiReviewResponse; usedModel: string | null };
  try {
    ai = await generateAiReviewWithModelFallbacks(targets);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI审查失败';
    log.error('自动审查失败（降级为保持 pending）', { userId, error });
    return { ok: false, reviewedCount: targets.length, approvedCount: 0, approvedIds: [], usedModel: null, reason: message };
  }

  const suggestionById = new Map(ai.result.reviews.map((review) => [review.id, review]));
  const approvedIds = targets
    .filter((target) => suggestionById.get(target.id)?.suggestion === 'approved')
    .map((target) => target.id);

  const approvedCount = await approvePendingPublicCards(userId, approvedIds);
  if (approvedIds.length > 0) {
    log.info('自动审查通过并已更新状态', { userId, reviewed: targets.length, approvedIds, approvedCount, usedModel: ai.usedModel });
  } else {
    log.info('自动审查未通过（保持 pending 等待人工）', { userId, reviewed: targets.length, usedModel: ai.usedModel });
  }

  return {
    ok: true,
    reviewedCount: targets.length,
    approvedCount,
    approvedIds,
    usedModel: ai.usedModel,
  };
}

