import { z } from 'zod';
import { ANALYTICS_ESTIMATE_NOTE, adminAggregateRows, collectAdminAnalyticsSnapshot, readAdminAvailability } from '../analytics';
import { AdminOperationError, executeAdminOperation } from '../operations';
import { commonInput, fields, type AdminBusinessAction } from './core';
import type { AdminDatabase } from '../database';

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => !Number.isNaN(Date.parse(`${value}T00:05:00.000Z`)) && new Date(`${value}T00:05:00.000Z`).toISOString().slice(0, 10) === value);
const snapshotInput = z.object({ ...commonInput, dryRun: z.boolean().default(true), backfillDays: z.number().int().min(0).max(30).default(0),
  includeCurrent: z.boolean().default(true), metricDate: dateKey.optional(), expectedVersion: z.string().min(1).max(64).optional() }).strict();
const refreshInput = z.object({ ...commonInput, expectedVersion: z.string().min(1).max(64).optional() }).strict();
const cleanupTarget = z.tuple([z.string().datetime(), z.string().min(1).max(200), z.string().min(1).max(200), z.string().max(64)]);
const cleanupInput = z.object({ ...commonInput, cutoff: z.string().datetime(), dryRun: z.boolean().default(true), targets: z.array(cleanupTarget).min(1).max(100).optional() }).strict();

export const ADMIN_ANALYTICS_ACTIONS: AdminBusinessAction[] = [{
  name: 'analytics.snapshot', label: '日快照与缺日回填', resource: 'analytics', capability: 'analytics.write',
  fields: fields([['dryRun', '仅预览（不写入）', 'boolean', false], ['backfillDays', '回填过去天数（最多30）', 'number', false], ['includeCurrent', '包含今日', 'boolean', false], ['metricDate', '指定UTC日期（可选）', 'text', false], ['expectedVersion', '重采指定日期的旧updated_at（可选）', 'text', false]]),
  async execute(db, raw, context) {
    const input = snapshotInput.parse(raw);
    if ((!input.includeCurrent && !input.backfillDays && !input.metricDate) || (input.expectedVersion && !input.metricDate)) throw new AdminOperationError('ADMIN_SNAPSHOT_SCOPE_REQUIRED', 400);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (input.metricDate && input.metricDate > today) throw new AdminOperationError('ADMIN_SNAPSHOT_FUTURE_DATE', 400);
    const dates = Array.from({ length: input.backfillDays }, (_, index) => new Date(now.getTime() - (index + 1) * 86_400_000).toISOString().slice(0, 10));
    if (input.metricDate) dates.push(input.metricDate); else if (input.includeCurrent) dates.push(today);
    const uniqueDates = [...new Set(dates)].sort();
    const existing = await adminAggregateRows<{ metric_date: string }>(db, `SELECT metric_date FROM admin_user_analytics_daily WHERE metric_date IN (${uniqueDates.map(() => '?').join(',')})`, uniqueDates);
    const known = new Set(existing.map((row) => row.metric_date));
    const prior = input.dryRun ? [] : await adminAggregateRows<{ target_id: string; status: string; result_json: string | null }>(db,
      "SELECT target_id,status,result_json FROM admin_operations WHERE actor_principal_id=? AND action='analytics.snapshot' AND substr(idempotency_key,1,?)=? LIMIT 32", [context.principalId, input.idempotencyKey.length + 1, `${input.idempotencyKey}:`]);
    const scopeBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ ...input, dryRun: false, dates: uniqueDates })));
    const scopeHash = Array.from(new Uint8Array(scopeBytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (prior.some((operation) => operation.status !== 'succeeded' || !operation.result_json || JSON.parse(operation.result_json).scopeHash !== scopeHash)) {
      throw new AdminOperationError('ADMIN_IDEMPOTENCY_CONFLICT', 409);
    }
    const candidates = uniqueDates.filter((date) => !known.has(date) || prior.some((operation) => operation.target_id === date) || (date === input.metricDate && input.expectedVersion));
    if (input.dryRun) return { dryRun: true, missingDates: candidates, skippedDates: uniqueDates.filter((date) => !candidates.includes(date)), approximateWindowMetrics: candidates.some((date) => date < today), estimateNote: ANALYTICS_ESTIMATE_NOTE };
    const results = [];
    for (const date of candidates) {
      const snapshot = await collectAdminAnalyticsSnapshot(db, date === today && !input.metricDate ? now : new Date(`${date}T00:05:00.000Z`));
      // Collection time is the CAS revision; the historical observation date must not reuse a revision.
      snapshot.created_at = now.toISOString();
      snapshot.updated_at = now.toISOString();
      const entries = Object.entries(snapshot);
      const updating = Boolean(date === input.metricDate && input.expectedVersion);
      const columns = entries.filter(([name]) => name !== 'metric_date' && name !== 'created_at');
      const result = await executeAdminOperation(db, { actorPrincipalId: context.principalId, requestId: context.requestId, authnContextSafeRef: context.authnContextSafeRef,
        capability: 'analytics.write', action: 'analytics.snapshot', targetType: 'analytics', targetId: date, reason: input.reason,
        idempotencyKey: `${input.idempotencyKey}:${date}`, expectedVersion: updating ? input.expectedVersion : undefined,
        payload: { metricDate: date, expectedVersion: updating ? input.expectedVersion : null } }, {
        primary: updating ? { name: 'replace-snapshot', sql: `UPDATE admin_user_analytics_daily SET ${columns.map(([name]) => `${name}=?`).join(',')} WHERE metric_date=? AND updated_at=? AND {{admin_guard}}`, bindings: [...columns.map(([, value]) => value), date, input.expectedVersion] }
          : { name: 'insert-snapshot', sql: `INSERT INTO admin_user_analytics_daily (${entries.map(([name]) => name).join(',')}) SELECT ${entries.map(() => '?').join(',')} WHERE NOT EXISTS (SELECT 1 FROM admin_user_analytics_daily WHERE metric_date=?) AND {{admin_guard}}`, bindings: [...entries.map(([, value]) => value), date] },
        result: { metricDate: date, approximateWindowMetrics: date < today, scopeHash },
      });
      results.push(result);
    }
    return { dryRun: false, results, skippedDates: uniqueDates.filter((date) => !candidates.includes(date)), approximateWindowMetrics: candidates.some((date) => date < today), estimateNote: ANALYTICS_ESTIMATE_NOTE };
  },
}, {
  name: 'ai-availability.refresh-snapshot', label: '刷新渠道可用性快照', resource: 'ai-availability', capability: 'ai-availability.write',
  fields: fields([['expectedVersion', '当前快照updated_at（首次创建留空）', 'text', false]]),
  async execute(db, raw, context) {
    const input = refreshInput.parse(raw);
    const availability = await readAdminAvailability(db);
    const payload = JSON.stringify(availability.snapshot);
    return executeAdminOperation(db, { actorPrincipalId: context.principalId, requestId: context.requestId, authnContextSafeRef: context.authnContextSafeRef,
      capability: 'ai-availability.write', action: 'ai-availability.refresh-snapshot', targetType: 'ai-availability', targetId: 'default', reason: input.reason,
      idempotencyKey: input.idempotencyKey, expectedVersion: input.expectedVersion, payload: input }, {
      primary: input.expectedVersion ? { name: 'refresh-snapshot', sql: "UPDATE ai_channel_availability_snapshot SET payload_json=?,updated_at=?,source_bucket_max=? WHERE id='default' AND updated_at=? AND {{admin_guard}}",
        bindings: [payload, availability.snapshot.generatedAt, availability.summary.latest_bucket, input.expectedVersion] }
        : { name: 'create-snapshot', sql: "INSERT INTO ai_channel_availability_snapshot (id,payload_json,updated_at,source_bucket_max) SELECT 'default',?,?,? WHERE NOT EXISTS (SELECT 1 FROM ai_channel_availability_snapshot WHERE id='default') AND {{admin_guard}}",
          bindings: [payload, availability.snapshot.generatedAt, availability.summary.latest_bucket] },
      result: { generatedAt: availability.snapshot.generatedAt, entryCount: availability.snapshot.entries.length },
    });
  },
}, {
  name: 'ai-availability.cleanup', label: '预览或清理过期渠道桶（每次最多100）', resource: 'ai-availability', capability: 'ai-availability.write',
  fields: fields([['cutoff', '截止UTC时间（至少保留48小时）', 'text'], ['dryRun', '仅预览', 'boolean', false], ['targets', '预览返回的targets', 'json', false]]),
  async execute(db, raw, context) {
    const input = cleanupInput.parse(raw);
    if (Date.parse(input.cutoff) > Date.now() - 2 * 86_400_000) throw new AdminOperationError('ADMIN_AVAILABILITY_RETENTION_REQUIRED', 400);
    if (input.dryRun) {
      const result = await adminAggregateRows<{ bucket_start: string; provider_id: string; model_id: string; updated_at: string }>(db,
        'SELECT bucket_start,provider_id,model_id,updated_at FROM ai_channel_availability_buckets WHERE bucket_start<? ORDER BY bucket_start,provider_id,model_id LIMIT 101', [input.cutoff]);
      return { dryRun: true, cutoff: input.cutoff, targets: result.slice(0, 100).map((row) => [row.bucket_start, row.provider_id, row.model_id, row.updated_at]), hasMore: result.length > 100 };
    }
    if (!input.targets || new Set(input.targets.map((target) => JSON.stringify(target.slice(0, 3)))).size !== input.targets.length || input.targets.some(([bucket]) => bucket >= input.cutoff)) throw new AdminOperationError('ADMIN_CLEANUP_PREVIEW_REQUIRED', 400);
    return executeAdminOperation(db, { actorPrincipalId: context.principalId, requestId: context.requestId, authnContextSafeRef: context.authnContextSafeRef,
      capability: 'ai-availability.write', action: 'ai-availability.cleanup', targetType: 'ai-availability', targetId: input.cutoff, reason: input.reason,
      idempotencyKey: input.idempotencyKey, payload: input }, {
      primary: { name: 'delete-expired-buckets', sql: `DELETE FROM ai_channel_availability_buckets WHERE bucket_start<? AND EXISTS (SELECT 1 FROM json_each(?) target WHERE bucket_start=json_extract(target.value,'$[0]') AND provider_id=json_extract(target.value,'$[1]') AND model_id=json_extract(target.value,'$[2]') AND updated_at=json_extract(target.value,'$[3]')) AND {{admin_guard}}`,
        bindings: [input.cutoff, JSON.stringify(input.targets)], expectedChanges: input.targets.length }, result: { deletedRows: input.targets.length, cutoff: input.cutoff },
    });
  },
}];

/** Explicit deployment-time delegation from an existing human principal; never a synthetic Access identity. */
export async function runScheduledAdminAnalyticsSnapshot(db:AdminDatabase,principalId:string|undefined){
 if(!principalId)return {ran:false,reason:'not-configured'};
 if(principalId.length>128||principalId.trim()!==principalId||/[\u0000-\u001f\u007f]/.test(principalId))throw new Error('ADMIN_ANALYTICS_PRINCIPAL_INVALID');
 const principal=await db.prepare("SELECT id FROM admin_principals WHERE id=? AND kind='human' AND status='active' AND EXISTS (SELECT 1 FROM json_each(capabilities_json) c WHERE c.value='analytics.write')").bind(principalId).first();
 if(!principal)return {ran:false,reason:'delegation-inactive'};
 const now=new Date();
 if(now.getUTCHours()===0&&now.getUTCMinutes()<5)return {ran:false,reason:'before-daily-window'};
 const dates=Array.from({length:8},(_,index)=>new Date(now.getTime()-index*86400000).toISOString().slice(0,10));
 const saved=await adminAggregateRows<{metric_date:string}>(db,`SELECT metric_date FROM admin_user_analytics_daily WHERE metric_date IN (${dates.map(()=>'?').join(',')})`,dates);
 const known=new Set(saved.map(row=>row.metric_date));const date=dates.find(item=>!known.has(item));
 if(!date)return {ran:false,reason:'up-to-date'};
 const action=ADMIN_ANALYTICS_ACTIONS.find(item=>item.name==='analytics.snapshot')!;
 await action.execute(db,{dryRun:false,backfillDays:0,includeCurrent:date===dates[0],...(date===dates[0]?{}:{metricDate:date}),
  reason:'部署配置中指定的人类管理员委托：每日自动快照与七日缺日补齐',idempotencyKey:`scheduled-analytics:${date}`},
 {principalId,requestId:crypto.randomUUID(),authnContextSafeRef:`scheduled-delegation:${principalId}`});
 return {ran:true,metricDate:date,approximateWindowMetrics:date!==dates[0]};
}
