import type { Action, Row, SavedOperation } from './ui-model';
import { api, operationFingerprint, outcomeState, savedOperations, saveOperation } from './ui-model';
import { AdminAiReviewTargetSchema, type AdminAiReviewContext, type AdminAiReviewResult, type AdminAiReviewTarget } from '@mahoshojo/contracts/admin';

export type ReviewContext = AdminAiReviewContext;
export type ReviewResult = AdminAiReviewResult;
export function reviewTarget(resource: string, row: Row): AdminAiReviewTarget {
  if (typeof row.id !== 'string' || typeof row.expectedVersion !== 'string') throw new Error('目标缺少版本，请重新读取详情。');
  if (resource === 'data-card-updates') {
    if (typeof row.data_card_id !== 'string' || typeof row.cardVersion !== 'string') throw new Error('待审更新缺少当前卡片版本。');
    return AdminAiReviewTargetSchema.parse({ kind: 'update', id: row.id, expectedVersion: row.expectedVersion, cardId: row.data_card_id, cardVersion: row.cardVersion });
  }
  return AdminAiReviewTargetSchema.parse({ kind: 'card', id: row.id, expectedVersion: row.expectedVersion });
}
export function reviewContextMatches(context: ReviewContext, row: Row | undefined): boolean {
  return Boolean(row && row.id === context.targetId && row.expectedVersion === context.expectedVersion
    && (context.kind === 'card' || (row.data_card_id === context.cardId && row.cardVersion === context.cardVersion)));
}
export function initialReviewDecision(suggestion: string, context: ReviewContext | undefined, row: Row | undefined): string {
  return suggestion === 'approved' && context && !context.coverage.contentTruncated && !context.coverage.contentParseError
    && reviewContextMatches(context, row) ? 'approved' : '';
}
export function decisionItem(context: ReviewContext, row: Row, decision: string): Row {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('请选择人工审核决定。');
  const target = reviewTarget(context.kind === 'update' ? 'data-card-updates' : 'data-cards', row);
  return { id: target.id, expectedVersion: target.expectedVersion, ...(target.kind === 'update' ? { cardId: target.cardId, cardVersion: target.cardVersion } : {}), decision };
}
/** Credentials are a separate ephemeral argument, never part of the saved intent or fingerprint. */
export async function submitReviewOperation(principalId: string, action: Pick<Action, 'name' | 'label'>, payload: Row,
  ephemeralKey?: string, newAiAttempt = false): Promise<{ outcome: Row; record: SavedOperation }> {
  if ('apiKey' in payload) throw new Error('凭据不能进入持久操作范围。');
  if (ephemeralKey && JSON.stringify(payload).includes(JSON.stringify(ephemeralKey).slice(1, -1))) throw new Error('密钥只能填写在 API Key 栏。');
  const fingerprint = await operationFingerprint(action.name, payload);
  const prior = [...savedOperations(principalId)].reverse().filter(item => item.fingerprint === fingerprint)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (prior) {
    if (!newAiAttempt || action.name !== 'ai.review') throw new Error('相同操作已有提交记录，请先在“操作恢复与查询”中核实，避免重复执行。');
    const operation = await api('operation?idempotencyKey=' + encodeURIComponent(prior.key));
    const jobs = await api('jobs');
    const job = jobs.items.find((item: Row) => item.id === operation.result?.jobId);
    if (!job || !['succeeded', 'failed'].includes(String(job.status))) throw new Error('上次作业尚未确认完成或调用结果不确定，不能创建相同范围的新请求。');
  }
  const record: SavedOperation = { key: crypto.randomUUID(), fingerprint, action: action.name, label: action.label,
    createdAt: new Date().toISOString(), state: 'unknown' };
  saveOperation(principalId, record);
  const outcome = await api('actions/' + action.name, { method: 'POST', signal: AbortSignal.timeout(65_000),
    headers: { 'Content-Type': 'application/json', 'X-Mahoshojo-Admin-CSRF': '1' },
    body: JSON.stringify({ ...payload, idempotencyKey: record.key, ...(ephemeralKey ? { apiKey: ephemeralKey } : {}) }) });
  const updated = { ...record, state: outcomeState(outcome) }; saveOperation(principalId, updated);
  return { outcome, record: updated };
}
