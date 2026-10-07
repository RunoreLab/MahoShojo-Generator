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
  rejectPendingPublicCardsByIds,
  type PendingDataCardUpdateReviewRow,
} from '@/lib/db/repositories/data-card-review';
import { getBusinessUserById } from '@/lib/db/repositories/business-users';
import { createUserMessage } from '@/lib/db/repositories/messages';
import { getDataCardUpdatedAtById } from '@/lib/db/repositories/data-cards-write';
import { getLogger } from '@/lib/logger';
import { resetStrictArenaRatingForDataCard } from '@/lib/database/arena-ratings';
import { computeTechIndex } from '@/lib/metrics/techIndex';
import { upsertDataCardMetrics } from '@/lib/database/data-card-metrics';
import { verifySignature } from '@/lib/signature';
import {
  resolveUncertainAction,
  type AutoReviewEngine,
  type AutoReviewPolicy,
  type AutoReviewUncertainPolicy,
  type ReviewTarget,
  type ReviewVerdict,
} from '@mahoshojo/hosted-runtime/auto-review';
import {
  buildDataCardAiReviewPrompt,
  DATA_CARD_AI_REVIEW_SYSTEM_PROMPT,
  DataCardAiReviewResponseSchema,
  type DataCardAiReviewResponse,
} from '@/lib/review/data-card-ai-review';
import { getAutoReviewEngine } from '@/lib/review/auto-review-engine';

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

/* ── legacy 通路（AI_REVIEW_PROVIDERS_CONFIG 未配置时的兼容兜底） ─────────── */

async function generateAiReviewWithModelFallbacks(targets: ReviewTarget[]): Promise<{
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

/** legacy：只产出 approve 集合（reject 的旧语义=留 pending）。 */
const legacyReviewTargets = async (
  targets: ReviewTarget[],
): Promise<{ approvedIds: Set<string>; usedModel: string | null }> => {
  const ai = await generateAiReviewWithModelFallbacks(targets);
  const suggestionById = new Map(ai.result.reviews.map((review) => [review.id, review]));
  return {
    approvedIds: new Set(
      targets.filter((t) => suggestionById.get(t.id)?.suggestion === 'approved').map((t) => t.id),
    ),
    usedModel: ai.usedModel,
  };
};

/* ── 引擎通路 ────────────────────────────────────────────────────────────── */

type CardAction = 'approve' | 'reject' | 'pending';

const actionForOutcome = (
  verdict: ReviewVerdict,
  onUncertain: AutoReviewUncertainPolicy,
  isReviewExempt: boolean,
): CardAction =>
  verdict === 'approve'
    ? 'approve'
    : verdict === 'reject'
      ? 'reject'
      : resolveUncertainAction(onUncertain, isReviewExempt);

const notifyAutoReject = async (
  db: AppDrizzleDb,
  input: { userId: number; cardId: string; cardName: string; reason?: string },
): Promise<void> => {
  try {
    await createUserMessage(db, {
      recipientUserId: input.userId,
      actorUserId: null,
      channel: 'system',
      messageType: 'moderation',
      templateKey: 'user.moderation.data_card_rejected',
      payloadJson: JSON.stringify({
        dataCardId: input.cardId,
        dataCardName: input.cardName,
        reason: input.reason ?? '自动安全审查检测到疑似违规内容。如属误判，请修改后重新公开或联系管理员。',
        autoReview: true,
      }),
      titleText: null,
      bodyText: null,
      actionUrl: `/character-manager?dataCardId=${encodeURIComponent(input.cardId)}`,
      sourceEntityType: 'data_card',
      sourceEntityId: input.cardId,
      priority: 'high',
      expiresAt: null,
      now: new Date().toISOString(),
    });
  } catch (error) {
    log.warn('自动拒绝通知发送失败（非阻塞）', { cardId: input.cardId, error });
  }
};

const readIsReviewExempt = async (db: AppDrizzleDb, userId: number): Promise<boolean> => {
  try {
    const user = await getBusinessUserById(db, userId);
    return user?.isReviewExempt === true;
  } catch {
    return false;
  }
};

export type AutoReviewResult = {
  ok: boolean;
  reviewedCount: number;
  approvedCount: number;
  rejectedCount: number;
  heldCount: number;
  approvedIds: string[];
  rejectedIds: string[];
  usedBackend: string | null;
  reason?: string;
};

/** 可注入依赖（测试用）；缺省走生产装配。 */
export type AutoReviewDeps = {
  db?: AppDrizzleDb;
  engine?: AutoReviewEngine | null;
  policy?: AutoReviewPolicy;
};

const emptyResult = (reason: string, ok = false): AutoReviewResult => ({
  ok,
  reviewedCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
  heldCount: 0,
  approvedIds: [],
  rejectedIds: [],
  usedBackend: null,
  reason,
});

const resolveReviewConfig = (deps?: AutoReviewDeps) => {
  const autoReviewConfig = config.DATA_CARD_AUTO_REVIEW;
  if (!autoReviewConfig?.enabled && !deps) return null;
  return autoReviewConfig ?? { lookbackPendingCount: 0, batch: { enabled: false, threshold: 1 } };
};

const resolveRuntime = async (deps?: AutoReviewDeps) => {
  const db = deps?.db ?? (await readDbOrNull());
  if (!db) return null;
  if (deps?.engine !== undefined || deps?.policy !== undefined) {
    const fallback = deps?.engine === undefined || deps?.policy === undefined ? getAutoReviewEngine() : null;
    return { db, engine: deps?.engine ?? fallback?.engine ?? null, policy: deps?.policy ?? fallback?.policy ?? null };
  }
  const { engine, policy } = getAutoReviewEngine();
  return { db, engine, policy };
};

export async function autoReviewLatestPendingPublicDataCardsForUser(
  userId: number,
  deps?: AutoReviewDeps,
): Promise<AutoReviewResult> {
  const autoReviewConfig = resolveReviewConfig(deps);
  if (!autoReviewConfig) return emptyResult('disabled');

  const runtime = await resolveRuntime(deps);
  if (!runtime || !runtime.policy) return emptyResult('db-unavailable');
  const { db, engine, policy } = runtime;

  const pendingCount = await countPendingPublicCardsByUserId(db, userId);
  if (autoReviewConfig.batch?.enabled) {
    const threshold = Math.max(1, Math.trunc(autoReviewConfig.batch.threshold ?? 1));
    if (pendingCount < threshold) {
      return emptyResult(`batch-waiting:${pendingCount}/${threshold}`);
    }
  }

  const isReviewExempt = await readIsReviewExempt(db, userId);
  if (isReviewExempt && policy.exemptUserPolicy === 'skip') {
    return emptyResult('exempt-skip', true);
  }

  const lookback = Math.max(0, Math.trunc(autoReviewConfig.lookbackPendingCount ?? 0));
  const limit = autoReviewConfig.batch?.enabled
    ? Math.max(1, Math.trunc(autoReviewConfig.batch.threshold ?? 1))
    : Math.max(1, lookback + 1);

  const pendingCards = await listLatestPendingPublicCardsByUserId(db, userId, limit);
  if (pendingCards.length === 0) {
    return { ...emptyResult('no-pending', true) };
  }

  const targets: ReviewTarget[] = pendingCards.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    data: row.data,
  }));

  const result: AutoReviewResult = {
    ok: true,
    reviewedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    heldCount: 0,
    approvedIds: [],
    rejectedIds: [],
    usedBackend: null,
  };

  if (!engine) {
    // 未配置新后端：回退 legacy generateWithAI 通路（只判 approve，其余留 pending）。
    try {
      const legacy = await legacyReviewTargets(targets);
      const approvedIds = targets.filter((t) => legacy.approvedIds.has(t.id)).map((t) => t.id);
      result.approvedCount = await approvePendingPublicCardsByIds(db, userId, approvedIds);
      result.approvedIds = approvedIds;
      result.heldCount = targets.length - approvedIds.length;
      result.reviewedCount = targets.length;
      result.usedBackend = legacy.usedModel ?? 'legacy-llm';
      log.info('自动审查（legacy 通路）完成', { userId, reviewed: targets.length, approvedCount: result.approvedCount });
      return result;
    } catch (error) {
      log.error('自动审查失败（降级为保持 pending）', { userId, error });
      return { ...emptyResult(error instanceof Error ? error.message : 'AI审查失败') };
    }
  }

  for (const target of targets) {
    result.reviewedCount += 1;
    const run = await engine.review(target);
    result.usedBackend = run.backendId;
    const action = actionForOutcome(run.outcome.verdict, policy.onUncertain, isReviewExempt);
    if (action === 'approve') {
      const n = await approvePendingPublicCardsByIds(db, userId, [target.id]);
      if (n > 0) {
        result.approvedCount += n;
        result.approvedIds.push(target.id);
      } else {
        result.heldCount += 1;
      }
    } else if (action === 'reject') {
      const n = await rejectPendingPublicCardsByIds(db, userId, [target.id]);
      if (n > 0) {
        result.rejectedCount += n;
        result.rejectedIds.push(target.id);
        if (policy.notifyOnAutoReject) {
          await notifyAutoReject(db, { userId, cardId: target.id, cardName: target.name, reason: run.outcome.reason });
        }
      } else {
        result.heldCount += 1;
      }
    } else {
      result.heldCount += 1;
    }
    log.info('自动审查单卡裁决', {
      userId,
      cardId: target.id,
      verdict: run.outcome.verdict,
      action,
      score: run.outcome.score,
      category: run.outcome.category,
      backend: run.backendId,
      latencyMs: run.latencyMs,
    });
  }

  log.info('自动审查批次完成', {
    userId,
    reviewed: result.reviewedCount,
    approved: result.approvedCount,
    rejected: result.rejectedCount,
    held: result.heldCount,
  });
  return result;
}

export async function autoReviewLatestPendingPublicDataCardUpdatesForUser(
  userId: number,
  deps?: AutoReviewDeps,
): Promise<AutoReviewResult> {
  const autoReviewConfig = resolveReviewConfig(deps);
  if (!autoReviewConfig) return emptyResult('disabled');

  const runtime = await resolveRuntime(deps);
  if (!runtime || !runtime.policy) return emptyResult('db-unavailable');
  const { db, engine, policy } = runtime;

  const pendingCount = await countPendingPublicCardUpdatesByUserId(db, userId);
  if (autoReviewConfig.batch?.enabled) {
    const threshold = Math.max(1, Math.trunc(autoReviewConfig.batch.threshold ?? 1));
    if (pendingCount < threshold) {
      return emptyResult(`batch-waiting:${pendingCount}/${threshold}`);
    }
  }

  const isReviewExempt = await readIsReviewExempt(db, userId);
  if (isReviewExempt && policy.exemptUserPolicy === 'skip') {
    return emptyResult('exempt-skip', true);
  }

  const lookback = Math.max(0, Math.trunc(autoReviewConfig.lookbackPendingCount ?? 0));
  const limit = autoReviewConfig.batch?.enabled
    ? Math.max(1, Math.trunc(autoReviewConfig.batch.threshold ?? 1))
    : Math.max(1, lookback + 1);

  const pendingUpdates = await listLatestPendingPublicCardUpdatesByUserId(db, userId, limit);
  if (pendingUpdates.length === 0) {
    return emptyResult('no-pending', true);
  }

  const targets: Array<ReviewTarget & { updateRow: PendingDataCardUpdateReviewRow }> = pendingUpdates.map((row) => ({
    id: row.dataCardId,
    name: row.name,
    description: row.description ?? '',
    data: row.data,
    updateRow: row,
  }));

  const result: AutoReviewResult = {
    ok: true,
    reviewedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    heldCount: 0,
    approvedIds: [],
    rejectedIds: [],
    usedBackend: null,
  };

  if (!engine) {
    try {
      const legacy = await legacyReviewTargets(targets);
      const approvedUpdates = pendingUpdates.filter((row) => legacy.approvedIds.has(row.dataCardId));
      const appliedIds = await applyApprovedPublicCardUpdates(db, userId, approvedUpdates);
      result.approvedCount = appliedIds.length;
      result.approvedIds = appliedIds;
      result.heldCount = targets.length - appliedIds.length;
      result.reviewedCount = targets.length;
      result.usedBackend = legacy.usedModel ?? 'legacy-llm';
      log.info('更新自动审查（legacy 通路）完成', { userId, reviewed: targets.length, approvedCount: appliedIds.length });
      return result;
    } catch (error) {
      log.error('更新自动审查失败（降级为保持 pending）', { userId, error });
      return { ...emptyResult(error instanceof Error ? error.message : 'AI审查失败') };
    }
  }

  for (const target of targets) {
    result.reviewedCount += 1;
    const run = await engine.review(target);
    result.usedBackend = run.backendId;
    const action = actionForOutcome(run.outcome.verdict, policy.onUncertain, isReviewExempt);
    if (action === 'approve') {
      const applied = await applyApprovedPublicCardUpdates(db, userId, [target.updateRow]);
      if (applied.length > 0) {
        result.approvedCount += applied.length;
        result.approvedIds.push(target.id);
      } else {
        result.heldCount += 1;
      }
    } else if (action === 'reject') {
      // 更新拒绝 = 丢弃待审行（与人工拒绝一致）+ 通知；线上版本不动。
      await deletePendingCardUpdateByDataCardId(db, target.id);
      result.rejectedCount += 1;
      result.rejectedIds.push(target.id);
      if (policy.notifyOnAutoReject) {
        await notifyAutoReject(db, { userId, cardId: target.id, cardName: target.name, reason: run.outcome.reason });
      }
    } else {
      result.heldCount += 1;
    }
    log.info('更新自动审查单卡裁决', {
      userId,
      cardId: target.id,
      verdict: run.outcome.verdict,
      action,
      score: run.outcome.score,
      category: run.outcome.category,
      backend: run.backendId,
      latencyMs: run.latencyMs,
    });
  }

  log.info('更新自动审查批次完成', {
    userId,
    reviewed: result.reviewedCount,
    approved: result.approvedCount,
    rejected: result.rejectedCount,
    held: result.heldCount,
  });
  return result;
}
