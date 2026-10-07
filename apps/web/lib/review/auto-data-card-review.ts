import { config } from '@/lib/config';
import type { AppDrizzleDb } from '@/lib/db/drizzle';
import {
  applyPendingCardUpdateIfUnchanged,
  approvePendingPublicCardIfUnchanged,
  countPendingPublicCardsByUserId,
  countPendingPublicCardUpdatesByUserId,
  deletePendingCardUpdateIfUnchanged,
  insertAutoReviewDecision,
  listLatestPendingPublicCardsByUserId,
  listLatestPendingPublicCardUpdatesByUserId,
  rejectPendingPublicCardIfUnchanged,
  type AutoReviewDecisionInsert,
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
  type AutoReviewRunResult,
  type AutoReviewUncertainPolicy,
  type ReviewTarget,
  type ReviewVerdict,
} from '@mahoshojo/hosted-runtime/auto-review';
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

async function applyApprovedPublicCardUpdate(
  db: AppDrizzleDb,
  userId: number,
  update: PendingDataCardUpdateReviewRow,
): Promise<boolean> {
  if (!update.dataCardId || !update.data) return false;
  const applied = await applyPendingCardUpdateIfUnchanged(db, userId, update);
  if (!applied) return false;

  const metricsPromise = computeAndUpsertMetrics(db, update.dataCardId, update.data);
  const resetStrictPromise =
    update.type === 'character'
      ? resetStrictArenaRatingForDataCard(update.dataCardId)
      : Promise.resolve();
  await Promise.all([metricsPromise, resetStrictPromise]);
  return true;
}

/* ── 引擎通路（无 legacy 回退：未按新模式配置即视为无可用 AI 审查） ────────── */

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

const sha256Hex = async (text: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
};

/** 裁决证据用内容指纹：审核观测的 (name, description, data, type)——与模型实际输入字段一致。 */
const contentHashOf = (snap: { name: string; description: string | null; data: string; type: ReviewTarget['type'] }) =>
  sha256Hex(JSON.stringify([snap.name, snap.description, snap.data, snap.type]));

const modelOf = (run: AutoReviewRunResult): string | null => {
  const m = run.outcome.details?.model;
  return typeof m === 'string' ? m : null;
};

/** 裁决审计写入：失败只记日志，不阻塞主流程。 */
const recordDecision = async (
  db: AppDrizzleDb,
  row: Omit<AutoReviewDecisionInsert, 'contentHash'> & { contentHash: Promise<string> },
): Promise<void> => {
  try {
    await insertAutoReviewDecision(db, { ...row, contentHash: await row.contentHash });
  } catch (error) {
    log.warn('审查裁决审计写入失败（非阻塞）', { dataCardId: row.dataCardId, error });
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
    // 显式传入的 null 语义=无引擎，不能用 ?? 吞掉后回退到真实装配。
    const fallback = deps?.engine === undefined || deps?.policy === undefined ? getAutoReviewEngine() : null;
    const engine = deps?.engine !== undefined ? deps.engine : fallback?.engine ?? null;
    const policy = deps?.policy !== undefined ? deps.policy : fallback?.policy ?? null;
    return { db, engine, policy };
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

  // 无可用新引擎：留 pending，不回退旧审查通路。
  if (!engine) {
    log.warn('自动审查引擎不可用（未配置有效后端），卡片保持 pending', { userId, pending: pendingCards.length });
    return { ...emptyResult('engine-unavailable', true), heldCount: pendingCards.length };
  }

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

  for (const row of pendingCards) {
    result.reviewedCount += 1;
    const target: ReviewTarget = {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      data: row.data,
      type: row.type,
    };
    const base = {
      userId,
      targetKind: 'card' as const,
      dataCardId: row.id,
      updateId: null,
      contentHash: contentHashOf(row),
      reviewedUpdatedAt: row.updatedAt,
    };
    let run: AutoReviewRunResult;
    try {
      run = await engine.review(target);
    } catch (error) {
      result.heldCount += 1;
      log.warn('自动审查引擎执行异常（单卡保持 pending）', { userId, cardId: row.id, error });
      continue;
    }
    result.usedBackend = run.backendId;
    const action = actionForOutcome(run.outcome.verdict, policy.onUncertain, isReviewExempt);
    const coverage = run.inputCoverage;
    let applied = false;
    if (action === 'approve') {
      applied = await approvePendingPublicCardIfUnchanged(db, userId, row);
      if (applied) {
        result.approvedCount += 1;
        result.approvedIds.push(target.id);
      } else {
        result.heldCount += 1;
      }
    } else if (action === 'reject') {
      applied = await rejectPendingPublicCardIfUnchanged(db, userId, row);
      if (applied) {
        result.rejectedCount += 1;
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
    await recordDecision(db, {
      ...base,
      backendId: run.backendId,
      backendKind: run.kind,
      model: modelOf(run),
      verdict: run.outcome.verdict,
      action,
      applied,
      score: run.outcome.score,
      category: run.outcome.category ?? null,
      reason: run.outcome.reason ?? null,
      inputTruncated: coverage.truncated,
      inputParseError: coverage.parseError,
      latencyMs: run.latencyMs,
      attemptedBackends: run.attempted,
      details: run.outcome.details ?? null,
    });
    log.info('自动审查单卡裁决', {
      userId,
      cardId: target.id,
      verdict: run.outcome.verdict,
      action,
      applied,
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

  if (!engine) {
    log.warn('自动审查引擎不可用（未配置有效后端），更新保持 pending', { userId, pending: pendingUpdates.length });
    return { ...emptyResult('engine-unavailable', true), heldCount: pendingUpdates.length };
  }

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

  for (const row of pendingUpdates) {
    result.reviewedCount += 1;
    const target: ReviewTarget = {
      id: row.dataCardId,
      name: row.name,
      description: row.description ?? '',
      data: row.data,
      type: row.type,
    };
    const base = {
      userId,
      targetKind: 'update' as const,
      dataCardId: row.dataCardId,
      updateId: row.updateId,
      contentHash: contentHashOf(row),
      reviewedUpdatedAt: row.updatedAt,
    };
    let run: AutoReviewRunResult;
    try {
      run = await engine.review(target);
    } catch (error) {
      result.heldCount += 1;
      log.warn('更新自动审查引擎执行异常（单条更新保持 pending）', { userId, cardId: row.dataCardId, error });
      continue;
    }
    result.usedBackend = run.backendId;
    const action = actionForOutcome(run.outcome.verdict, policy.onUncertain, isReviewExempt);
    const coverage = run.inputCoverage;
    let applied = false;
    if (action === 'approve') {
      applied = await applyApprovedPublicCardUpdate(db, userId, row);
      if (applied) {
        result.approvedCount += 1;
        result.approvedIds.push(target.id);
      } else {
        result.heldCount += 1;
      }
    } else if (action === 'reject') {
      // 更新拒绝 = 丢弃该待审行（与人工拒绝一致）+ 通知；快照守卫确保不误删顶替的 U2，线上版本不动。
      applied = await deletePendingCardUpdateIfUnchanged(db, userId, row);
      if (applied) {
        result.rejectedCount += 1;
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
    await recordDecision(db, {
      ...base,
      backendId: run.backendId,
      backendKind: run.kind,
      model: modelOf(run),
      verdict: run.outcome.verdict,
      action,
      applied,
      score: run.outcome.score,
      category: run.outcome.category ?? null,
      reason: run.outcome.reason ?? null,
      inputTruncated: coverage.truncated,
      inputParseError: coverage.parseError,
      latencyMs: run.latencyMs,
      attemptedBackends: run.attempted,
      details: run.outcome.details ?? null,
    });
    log.info('更新自动审查单卡裁决', {
      userId,
      cardId: target.id,
      verdict: run.outcome.verdict,
      action,
      applied,
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
