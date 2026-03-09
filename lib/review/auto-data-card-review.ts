import { generateWithAI } from '@/lib/ai';
import { config } from '@/lib/config';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  applyPendingPublicCardUpdateByUserId,
  approvePendingPublicCardsByIds,
  countPendingPublicCardsByUserId,
  countPendingPublicCardUpdatesByUserId,
  deletePendingCardUpdateByDataCardId,
  listLatestPendingPublicCardsByUserId,
  listLatestPendingPublicCardUpdatesByUserId,
  type PendingDataCardUpdateReviewRow,
} from '@/lib/db/repositories/data-card-review';
import { getDataCardUpdatedAtById } from '@/lib/db/repositories/data-cards-write';
import { getLogger } from '@/lib/logger';
import { resetStrictArenaRatingForDataCard } from '@/lib/database/arena-ratings';
import { computeTechIndex } from '@/lib/metrics/techIndex';
import { upsertDataCardMetrics } from '@/lib/database/data-card-metrics';
import { verifySignature } from '@/lib/signature';
import {
  buildDataCardAiReviewPrompt,
  DATA_CARD_AI_REVIEW_SYSTEM_PROMPT,
  DataCardAiReviewResponseSchema,
  type DataCardAiReviewResponse,
  type DataCardAiReviewTarget,
} from '@/lib/review/data-card-ai-review';

const log = getLogger('auto-data-card-review');

const readDbOrNull = async (): Promise<AppDrizzleDb | null> => {
  try {
    const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
    const db = getDrizzleDbFromRuntime();
    if (!db) return null;
    return db;
  } catch {
    return null;
  }
};

async function computeAndUpsertMetrics(
  db: AppDrizzleDb,
  dataCardId: string,
  dataJsonString: string,
): Promise<void> {
  try {
    const jsonValue = JSON.parse(dataJsonString) as unknown;
    const tech = computeTechIndex(jsonValue);

    const hasSignatureKey = Boolean(process.env.SIGNATURE_SECRET_KEY);
    const isNative = hasSignatureKey ? await verifySignature(jsonValue as any) : null;

    const updatedAt = await getDataCardUpdatedAtById(db, dataCardId);
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

async function applyApprovedPublicCardUpdates(
  db: AppDrizzleDb,
  userId: number,
  updates: PendingDataCardUpdateReviewRow[],
): Promise<string[]> {
  const appliedIds: string[] = [];

  for (const update of updates) {
    if (!update.dataCardId || !update.data) continue;
    const updated = await applyPendingPublicCardUpdateByUserId(db, userId, {
      dataCardId: update.dataCardId,
      name: update.name,
      description: update.description,
      data: update.data,
    });
    if (!updated) continue;

    await deletePendingCardUpdateByDataCardId(db, update.dataCardId);
    const metricsPromise = computeAndUpsertMetrics(db, update.dataCardId, update.data);
    const resetStrictPromise =
      update.type === 'character'
        ? resetStrictArenaRatingForDataCard(update.dataCardId)
        : Promise.resolve();
    await Promise.all([metricsPromise, resetStrictPromise]);
    appliedIds.push(update.dataCardId);
  }

  return appliedIds;
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

  const db = await readDbOrNull();
  if (!db) {
    return { ok: false, reviewedCount: 0, approvedCount: 0, approvedIds: [], usedModel: null, reason: 'db-unavailable' };
  }

  const pendingCount = await countPendingPublicCardsByUserId(db, userId);
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

  const pendingCards = await listLatestPendingPublicCardsByUserId(db, userId, limit);
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

  const approvedCount = await approvePendingPublicCardsByIds(db, userId, approvedIds);
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

export async function autoReviewLatestPendingPublicDataCardUpdatesForUser(userId: number): Promise<AutoReviewResult> {
  const autoReviewConfig = config.DATA_CARD_AUTO_REVIEW;
  if (!autoReviewConfig?.enabled) {
    return { ok: false, reviewedCount: 0, approvedCount: 0, approvedIds: [], usedModel: null, reason: 'disabled' };
  }

  const db = await readDbOrNull();
  if (!db) {
    return { ok: false, reviewedCount: 0, approvedCount: 0, approvedIds: [], usedModel: null, reason: 'db-unavailable' };
  }

  const pendingCount = await countPendingPublicCardUpdatesByUserId(db, userId);
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

  const pendingUpdates = await listLatestPendingPublicCardUpdatesByUserId(db, userId, limit);
  if (pendingUpdates.length === 0) {
    return { ok: true, reviewedCount: 0, approvedCount: 0, approvedIds: [], usedModel: null, reason: 'no-pending' };
  }

  const targets: DataCardAiReviewTarget[] = pendingUpdates.map((row) => ({
    id: row.dataCardId,
    name: row.name,
    description: row.description ?? '',
    data: row.data,
  }));

  let ai: { result: DataCardAiReviewResponse; usedModel: string | null };
  try {
    ai = await generateAiReviewWithModelFallbacks(targets);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI审查失败';
    log.error('更新自动审查失败（降级为保持 pending）', { userId, error });
    return { ok: false, reviewedCount: targets.length, approvedCount: 0, approvedIds: [], usedModel: null, reason: message };
  }

  const suggestionById = new Map(ai.result.reviews.map((review) => [review.id, review]));
  const approvedIds = targets
    .filter((target) => suggestionById.get(target.id)?.suggestion === 'approved')
    .map((target) => target.id);

  const approvedUpdates = pendingUpdates.filter((row) => approvedIds.includes(row.dataCardId));
  const appliedIds = await applyApprovedPublicCardUpdates(db, userId, approvedUpdates);
  if (appliedIds.length > 0) {
    log.info('更新自动审查通过并已应用更新', { userId, reviewed: targets.length, approvedIds: appliedIds, usedModel: ai.usedModel });
  } else {
    log.info('更新自动审查未通过（保持 pending 等待人工）', { userId, reviewed: targets.length, usedModel: ai.usedModel });
  }

  return {
    ok: true,
    reviewedCount: targets.length,
    approvedCount: appliedIds.length,
    approvedIds: appliedIds,
    usedModel: ai.usedModel,
  };
}

