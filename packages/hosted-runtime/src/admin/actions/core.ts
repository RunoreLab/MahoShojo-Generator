import { z } from 'zod';
import type { AdminDatabase } from '../database';
import { executeAdminOperation, type AdminOperationPlan } from '../operations';

export type AdminActionContext = { principalId: string; requestId: string; authnContextSafeRef: string };
export type AdminActionField = { name: string; label: string; type: 'text' | 'number' | 'boolean' | 'json'; required?: boolean };
export type AdminBusinessAction = {
  name: string; label: string; resource: string; capability: string; fields: AdminActionField[];
  execute(_db: AdminDatabase, _input: unknown, _context: AdminActionContext): Promise<unknown>;
};
export const commonInput = {
  reason: z.string().trim().min(1).max(1000),
  idempotencyKey: z.string().trim().min(1).max(128),
};
export const idInput = z.string().trim().min(1).max(128);
export const versionInput = z.string().min(1).max(256);
export const mutationInput = { ...commonInput, id: idInput, expectedVersion: versionInput };
export const fields = (entries: Array<[string, string, AdminActionField['type'], boolean?]>): AdminActionField[] =>
  entries.map(([name, label, type, required = true]) => ({ name, label, type, required }));

/** Fixed server-owned columns also used by read adapters to issue opaque revision tokens. */
export const ADMIN_ACTION_VERSIONS = {
  ratings: { table: 'arena_ratings', key: 'json_array(entity_type, entity_id, queue)', columns: ['entity_type', 'entity_id', 'queue', 'rating', 'games', 'wins', 'losses', 'draws', 'last_delta', 'last_applied_at', 'updated_at'] },
  messages: { table: 'site_messages', key: 'id', columns: ['id', 'message_type', 'template_key', 'payload_json', 'title_text', 'body_text', 'action_url', 'priority', 'expires_at', 'updated_at'] },
  'report-cases': { table: 'report_cases', key: 'id', columns: ['id', 'target_entity_type', 'target_entity_id', 'target_user_id', 'status', 'resolution_code', 'creator_notified_at', 'creator_notified_report_count', 'resolution_notified_at', 'resolution_notified_case_updated_at', 'closed_at', 'updated_at'] },
  'report-appeals': { table: 'report_appeals', key: 'id', columns: ['id', 'report_case_id', 'appellant_user_id', 'target_entity_id', 'target_entity_type', 'status', 'resolution_code', 'case_status_snapshot', 'case_resolution_code_snapshot', 'case_updated_at_snapshot', 'updated_at'] },
  'crowd-review': { table: 'crowd_review_rounds', key: 'id', columns: ['id', 'report_case_id', 'status', 'result_code', 'result_summary_json', 'updated_at'] },
  inspectors: { table: 'crowd_review_inspectors', key: 'user_id', columns: ['user_id', 'status', 'suspended_until', 'status_reason_code', 'status_reason_detail', 'updated_at'] },
  'data-cards': { table: 'data_cards', key: 'id', columns: ['id', 'user_id', 'type', 'name', 'description', 'data', 'is_public', 'public_since', 'review_status', 'is_recommended', 'updated_at', 'deleted_at'] },
  'data-card-updates': { table: 'data_card_updates', key: 'id', columns: ['id', 'data_card_id', 'user_id', 'name', 'description', 'data', 'updated_at'] },
  tags: { table: 'tags', key: 'id', columns: ['id', 'name', 'description', 'category', 'scope', 'is_active', 'updated_at'] },
  'tag-aliases': { table: 'tag_aliases', key: 'alias', columns: ['alias', 'tag_id', 'created_at'] },
  users: { table: 'users', key: 'id', columns: ['id', 'is_banned', 'is_review_exempt', 'slot_count', 'prefix', 'updated_at'] },
  badges: { table: 'badges', key: 'id', columns: ['id', 'name', 'description', 'icon', 'text_color', 'background_color', 'border_color', 'rarity', 'sort_order', 'is_active', 'created_at'] },
  'redemption-codes': { table: 'redemption_codes', key: 'rowid', columns: ['rowid', 'code', 'slot_count', 'created_at'] },
} as const;
export type AdminVersionResource = keyof typeof ADMIN_ACTION_VERSIONS;
export async function adminActionVersion(resource: AdminVersionResource, row: Record<string, unknown>): Promise<string> {
  const serialized = JSON.stringify(ADMIN_ACTION_VERSIONS[resource].columns.map((name) => row[name] ?? null));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function snapshot(db: AdminDatabase, resource: AdminVersionResource, id: string, expectedVersion: string) {
  const definition = ADMIN_ACTION_VERSIONS[resource];
  const row = await db.prepare(`SELECT ${definition.columns.join(',')} FROM ${definition.table} WHERE ${definition.key}=?`).bind(id).first<Record<string, unknown>>();
  // Comparing the full observed values inside the batch closes the read-to-write gap, including same-second legacy writes.
  return { row, where: `${definition.key}=? AND ?=?${row ? definition.columns.map((name) => ` AND ${name} IS ?`).join('') : ''}`,
    bindings: [id, expectedVersion, row ? await adminActionVersion(resource, row) : null, ...(row ? definition.columns.map((name) => row[name] ?? null) : [])] };
}

type Common = { reason: string; idempotencyKey: string; expectedVersion?: string };
export function defineAction<T extends Common>(
  metadata: Omit<AdminBusinessAction, 'execute'>,
  schema: z.ZodType<T>,
  compile: (_db: AdminDatabase, _input: T, _context: AdminActionContext) => Promise<{ targetId: string; plan: AdminOperationPlan<Record<string, unknown>> }>,
): AdminBusinessAction {
  return { ...metadata, async execute(db, raw, context) {
    const input = schema.parse(raw);
    const compiled = await compile(db, input, context);
    return executeAdminOperation(db, {
      actorPrincipalId: context.principalId, requestId: context.requestId, authnContextSafeRef: context.authnContextSafeRef,
      capability: metadata.capability, action: metadata.name, targetType: metadata.resource, targetId: compiled.targetId,
      reason: input.reason, idempotencyKey: input.idempotencyKey, expectedVersion: input.expectedVersion, payload: input,
    }, compiled.plan);
  } };
}
