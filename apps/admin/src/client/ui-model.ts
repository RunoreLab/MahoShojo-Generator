export type Row = Record<string, unknown>;
export type ActionField = { name: string; label: string; type: string; required?: boolean };
export type Action = { name: string; label: string; resource: string; fields: ActionField[]; itemFields?: ActionField[] };
export function batchItemAction(action: Action, actions: Action[]): Action | undefined {
  if (!action.name.endsWith('.batch')) return undefined;
  const name = action.name.slice(0, -6);
  return action.itemFields ? { ...action, name, fields: action.itemFields, itemFields: undefined } : actions.find(item => item.name === name);
}
export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number) { super(ERRORS[code] ?? `请求未完成（${status}）。请先查询操作状态。`); }
}
const ERRORS: Record<string, string> = {
  ADMIN_UNAUTHORIZED: '登录已过期，请重新登录。', ADMIN_FORBIDDEN: '你没有执行此操作的权限。',
  ADMIN_UNAVAILABLE: '数据服务暂时不可用。', ADMIN_QUERY_INVALID: '筛选条件不正确。',
  ADMIN_OPERATION_NOT_FOUND: '尚未查到操作记录；这不代表请求一定未执行。',
  ADMIN_CONFLICT: '记录已变更，请重新读取详情。', ADMIN_VERSION_CONFLICT: '记录版本已变更。',
  ADMIN_IDEMPOTENCY_CONFLICT: '同一操作键的请求内容不同，服务器已拒绝覆盖。',
  ADMIN_ACTION_DISABLED: '此操作尚未启用。', ADMIN_INPUT_INVALID: '操作参数不符合要求。',
  ADMIN_AI_SELECTION_UNAVAILABLE: '所选渠道或模型当前不可用，请重新选择。',
  ADMIN_AI_SECRET_IN_INTENT: '密钥只能填写在 API Key 栏，不能出现在理由或其他字段中。',
  ADMIN_AI_RESULT_UNAVAILABLE: '审核结果不可用，可能尚未完成、已过期或权限已撤销。',
};
export async function api(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(path.startsWith('/') ? path : '/api/admin/v1/' + path, {
    ...init, credentials: 'same-origin', cache: 'no-store', signal: init?.signal ?? AbortSignal.timeout(30_000),
  });
  const data = await response.json().catch(() => { throw new ApiError('ADMIN_UNAVAILABLE', response.status); });
  if (!response.ok) throw new ApiError(data.error ?? 'ADMIN_UNAVAILABLE', response.status);
  return data;
}
export function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}
export function textValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}
export function cleanQuery(input: URLSearchParams, allowed?: string[]): URLSearchParams {
  return new URLSearchParams([...input].filter(([key, value]) => value.trim() && (!allowed || allowed.includes(key))));
}
export const isVersion = (name: string) => /version$/i.test(name) || name === 'expectedUpdatedAt';
const aliases: Record<string, string> = {
  slotCount: 'slot_count', textColor: 'text_color', backgroundColor: 'background_color', borderColor: 'border_color',
  expectedUpdatedAt: 'updated_at',
  sortOrder: 'sort_order', isActive: 'is_active', recommended: 'is_recommended', exempt: 'is_review_exempt',
  tagId: 'tag_id', cardId: 'data_card_id', metricDate: 'metric_date', userId: 'user_id', obtainedAt: 'obtained_at',
};
export function fieldValue(action: Action, field: ActionField, selected: Row | null): unknown {
  const creating = /\.create$|\.generate$/.test(action.name);
  const row = creating ? null : selected;
  if (field.name === 'items' && action.name.endsWith('.batch')) return row?.batchItems;
  if (field.name === 'dryRun' || field.name === 'includeCurrent') return true;
  if (field.name === 'banned') return Boolean(row?.is_banned);
  if (field.name === 'nativeAllowed') return (parseJson(row?.data) as Row | null)?.nativeAllowed ?? false;
  if (field.name === 'expectedVersion' && action.name === 'analytics.snapshot') return row?.updated_at;
  if (field.name === 'targets' && action.name === 'ai.review' && row?.expectedVersion) return [{ kind: action.resource === 'data-card-updates' ? 'update' : 'card', id: String(row.id), expectedVersion: row.expectedVersion }];
  if (field.name === 'ids' && action.name === 'jobs.export') return row?.exportIds ?? (row?.id !== undefined ? [String(row.id)] : undefined);
  if (field.name === 'target' && action.name === 'jobs.export') return action.resource;
  if (field.name === 'visibility') return row?.is_public;
  const value = row?.[field.name] ?? row?.[aliases[field.name]];
  if (field.type === 'boolean' && value !== undefined && value !== null) return value === true || value === 1;
  if (field.type === 'json' && value !== undefined) return parseJson(value);
  if (field.name === 'slotCount' && row && value == null) return 0;
  if (['prefix', 'description'].includes(field.name) && row && value == null) return '';
  return value;
}
export function parseFields(action: Action, form: FormData): Row {
  const payload: Row = {};
  for (const field of action.fields) {
    const raw = String(form.get(field.name) ?? '');
    if (raw === '' && !['prefix', 'description'].includes(field.name)) {
      if (field.required) throw new Error(`请填写${field.label}。`);
      continue;
    }
    if (field.type === 'json') { try { payload[field.name] = JSON.parse(raw); } catch { throw new Error(`${field.label}必须是有效 JSON。`); } }
    else if (field.type === 'number') { const value = Number(raw); if (!Number.isFinite(value)) throw new Error(`${field.label}必须是有效数字。`); payload[field.name] = value; }
    else if (field.type === 'boolean') payload[field.name] = raw === 'true';
    else payload[field.name] = raw;
  }
  payload.reason = String(form.get('reason') ?? '').trim();
  if (!payload.reason) throw new Error('请填写操作理由。');
  return payload;
}
export type SavedOperation = { key: string; fingerprint: string; action: string; label: string; createdAt: string; state: string };
const storageKey = (principal: string) => 'mahoshojo.admin.operations.v1:' + principal;
export function savedOperations(principal: string): SavedOperation[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(principal)) ?? '[]');
    return Array.isArray(raw) ? raw.filter(x => x && typeof x.key === 'string' && x.key.length <= 128 && typeof x.fingerprint === 'string' && typeof x.action === 'string' && typeof x.label === 'string' && typeof x.createdAt === 'string' && typeof x.state === 'string').slice(-100) : [];
  } catch { return []; }
}
export function saveOperation(principal: string, operation: SavedOperation) {
  const records = savedOperations(principal);
  const index = records.findIndex(record => record.key === operation.key);
  if (index < 0) records.push(operation); else records[index] = operation;
  localStorage.setItem(storageKey(principal), JSON.stringify(records.slice(-100)));
  window.dispatchEvent(new Event('admin-operations-changed'));
}
export async function operationFingerprint(action: string, payload: Row): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([action, payload])));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}
export function outcomeState(outcome: any): string {
  if (outcome?.dryRun === true) return 'preview';
  if (outcome?.status === 'batch') {
    const items = outcome.items ?? outcome.operations;
    return Array.isArray(items) && items.length > 0 && items.every((item: Row) => item.status === 'succeeded') ? 'succeeded' : 'partial';
  }
  if (Array.isArray(outcome?.results)) return outcome.results.some((item: Row) => item.status !== 'succeeded') ? 'partial' : 'succeeded';
  return outcome?.status ?? 'succeeded';
}
export const statusLabels: Record<string, string> = {
  preview: '预览完成，未写入', succeeded: '操作成功', conflict: '版本冲突，冲突目标未修改', partial: '部分操作有结果，请逐项核对；不能视为全部完成',
  pending: '等待结果', queued: '已入队', running: '处理中', uncertain: '结果不确定，禁止自动重放',
  failed: '执行失败', cancelled: '已取消', unknown: '尚未确认结果',
};
