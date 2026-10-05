import { assertAdminBatchSucceeded, type AdminDatabase, type AdminPreparedStatement } from './database';
import { AdminAuditTextError, assertSafeAuditText } from './audit-text';

export class AdminOperationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}

/** All authority fields are populated by the authenticated server adapter, not spread from a request body. */
export type AdminOperationContext = {
  actorPrincipalId: string;
  capability: string;
  action: string;
  authnContextSafeRef: string;
  requestId: string;
  reason: string;
  idempotencyKey: string;
  expectedVersion?: string;
  targetType: string;
  targetId: string;
  /** Used only for a canonical SHA-256 fingerprint; never persisted verbatim. */
  payload: unknown;
};

/** Server-compiled SQL only. The final WHERE/AND condition must be {{admin_guard}}. */
export type AdminGuardedStatement = {
  name: string;
  sql: string;
  bindings: readonly unknown[];
  /** Defaults to one for primary; optional for effects such as zero-or-many cleanup. */
  expectedChanges?: number;
};

export type AdminOperationPlan<T> = {
  primary: AdminGuardedStatement;
  effects?: readonly AdminGuardedStatement[];
  /** A minimal safe result DTO, not a database row or sensitive input. */
  result: T;
};

export type AdminOperationResult<T> = {
  operationId: string;
  status: 'succeeded' | 'conflict';
  result: T | null;
  replayed: boolean;
};

const canonicalJson = (value: unknown): string => {
  let nodes = 0;
  let characters = 0;
  const charge = (text: string): string => {
    characters += text.length;
    if (characters > 1_000_000) throw new AdminOperationError('ADMIN_OPERATION_PAYLOAD_TOO_LARGE', 400);
    return text;
  };
  const encode = (item: unknown, depth: number): string => {
    if (++nodes > 20_000 || depth > 32) throw new AdminOperationError('ADMIN_OPERATION_PAYLOAD_TOO_LARGE', 400);
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return charge(JSON.stringify(item));
    if (typeof item === 'number' && Number.isFinite(item)) return charge(JSON.stringify(item));
    if (Array.isArray(item)) {
      if (item.length > 20_000) throw new AdminOperationError('ADMIN_OPERATION_PAYLOAD_TOO_LARGE', 400);
      charge(' '.repeat(item.length + 2));
      return `[${item.map((entry) => encode(entry, depth + 1)).join(',')}]`;
    }
    if (typeof item === 'object' && item !== null && Object.getPrototypeOf(item) === Object.prototype) {
      const keys = Object.keys(item).sort();
      if (keys.length > 20_000) throw new AdminOperationError('ADMIN_OPERATION_PAYLOAD_TOO_LARGE', 400);
      charge(' '.repeat(keys.length * 2 + 2));
      return `{${keys.map((key) => `${charge(JSON.stringify(key))}:${encode((item as Record<string, unknown>)[key], depth + 1)}`).join(',')}}`;
    }
    throw new AdminOperationError('ADMIN_OPERATION_PAYLOAD_INVALID', 400);
  };
  return encode(value, 0);
};

const fingerprint = async (context: AdminOperationContext): Promise<string> => {
  const canonical = canonicalJson({ action: context.action, capability: context.capability, targetType: context.targetType,
    targetId: context.targetId, reason: context.reason, expectedVersion: context.expectedVersion ?? null, payload: context.payload });
  if (canonical.length > 1_000_000) throw new AdminOperationError('ADMIN_OPERATION_PAYLOAD_TOO_LARGE', 400);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const validateContext = (context: AdminOperationContext): void => {
  try { assertSafeAuditText(context.reason); }
  catch (error) {
    throw new AdminOperationError(error instanceof AdminAuditTextError && error.code === 'ADMIN_AUDIT_TEXT_UNSAFE'
      ? 'ADMIN_OPERATION_REASON_UNSAFE' : 'ADMIN_OPERATION_CONTEXT_INVALID', 400);
  }
  try {
    for (const value of [context.actorPrincipalId, context.capability, context.action, context.authnContextSafeRef,
      context.requestId, context.idempotencyKey, context.targetType, context.targetId]) assertSafeAuditText(value);
    if (context.expectedVersion !== undefined) assertSafeAuditText(context.expectedVersion, 256);
  } catch {
    throw new AdminOperationError('ADMIN_OPERATION_CONTEXT_INVALID', 400);
  }
};

const validateStatement = (statement: AdminGuardedStatement): void => {
  if (!/^[a-z][a-z0-9.-]{0,100}$/u.test(statement.name)
    || !/^(?:UPDATE|INSERT|DELETE)\b/iu.test(statement.sql.trim())
    || !/\b(?:WHERE|AND)\s+\{\{admin_guard\}\}\s*;?\s*$/iu.test(statement.sql)
    || statement.sql.split('{{admin_guard}}').length !== 2) throw new Error('ADMIN_STATEMENT_GUARD_REQUIRED');
  if (statement.expectedChanges !== undefined && (!Number.isInteger(statement.expectedChanges) || statement.expectedChanges < 1 || statement.expectedChanges > 100)) {
    throw new Error('ADMIN_STATEMENT_EXPECTED_CHANGES_INVALID');
  }
};

const guarded = (db: AdminDatabase, statement: AdminGuardedStatement, operationId: string, state: string): AdminPreparedStatement =>
  db.prepare(statement.sql.replace('{{admin_guard}}', "EXISTS (SELECT 1 FROM admin_operations WHERE id=? AND status=?)"))
    .bind(...statement.bindings, operationId, state);

type OperationRow = { id: string; payload_hash: string; status: string; result_json: string | null };

/** The operation UUID is a fresh transaction guard. D1 batch is the transaction, not this JS function. */
export const executeAdminOperation = async <T>(
  db: AdminDatabase, context: AdminOperationContext, plan: AdminOperationPlan<T>,
): Promise<AdminOperationResult<T>> => {
  validateContext(context);
  const compiled = [plan.primary, ...(plan.effects ?? [])];
  if (compiled.length > 50 || new Set(compiled.map((statement) => statement.name)).size !== compiled.length) {
    throw new Error('ADMIN_OPERATION_PLAN_INVALID');
  }
  compiled.forEach(validateStatement);
  const safeResultJson = canonicalJson(plan.result);
  if (safeResultJson.length > 64_000) throw new Error('ADMIN_OPERATION_RESULT_TOO_LARGE');
  const payloadHash = await fingerprint(context);
  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  // Authorization is repeated inside the transaction, closing the revoke-vs-write gap.
  const statements = [db.prepare(`INSERT INTO admin_operations
    (id,actor_principal_id,action,capability,request_id,idempotency_key,payload_hash,reason,expected_version,target_type,target_id,status,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,'pending',?,? WHERE EXISTS (
      SELECT 1 FROM admin_principals p WHERE p.id=? AND p.status='active'
      AND EXISTS (SELECT 1 FROM json_each(p.capabilities_json) c WHERE c.type='text' AND c.value=?))
    ON CONFLICT(actor_principal_id,idempotency_key) DO NOTHING`)
    .bind(operationId, context.actorPrincipalId, context.action, context.capability, context.requestId, context.idempotencyKey,
      payloadHash, context.reason, context.expectedVersion ?? null, context.targetType, context.targetId, now, now,
      context.actorPrincipalId, context.capability),
  guarded(db, plan.primary, operationId, 'pending'),
  // changes() must immediately follow primary. A wider-than-declared update violates CHECK and rolls everything back.
  db.prepare(`UPDATE admin_operations SET status=CASE WHEN changes()=? THEN 'applied'
    WHEN changes()=0 THEN 'conflict' ELSE 'invalid-row-count' END WHERE id=? AND status='pending'`)
    .bind(plan.primary.expectedChanges ?? 1, operationId)];
  for (const effect of plan.effects ?? []) {
    statements.push(guarded(db, effect, operationId, 'applied'));
    if (effect.expectedChanges !== undefined) {
      statements.push(db.prepare(`UPDATE admin_operations SET status=CASE WHEN changes()=? THEN 'applied'
        ELSE 'invalid-row-count' END WHERE id=? AND status='applied'`).bind(effect.expectedChanges, operationId));
    }
  }
  const auditId = crypto.randomUUID();
  statements.push(
    db.prepare(`INSERT INTO admin_audit_events
      (id,operation_id,actor_principal_id,authn_context_safe_ref,capability,action,target_type,target_id,request_id,reason,expected_version,result,error_code_safe,source_context_safe,created_at)
      SELECT ?,id,actor_principal_id,?,capability,action,target_type,target_id,request_id,reason,expected_version,
      CASE WHEN status='applied' THEN 'success' ELSE 'conflict' END,
      CASE WHEN status='conflict' THEN 'ADMIN_VERSION_CONFLICT' ELSE NULL END,'admin-worker',?
      FROM admin_operations WHERE id=? AND status IN ('applied','conflict')`)
      .bind(auditId, context.authnContextSafeRef, now, operationId),
    // Detect even a silently ignored audit insert before committing protected effects.
    db.prepare(`UPDATE admin_operations SET status=CASE WHEN EXISTS
      (SELECT 1 FROM admin_audit_events WHERE id=? AND operation_id=?) THEN status ELSE 'audit-missing' END
      WHERE id=? AND status IN ('applied','conflict')`).bind(auditId, operationId, operationId),
    db.prepare("UPDATE admin_operations SET status='succeeded', result_json=?, updated_at=? WHERE id=? AND status='applied'")
      .bind(safeResultJson, now, operationId),
  );
  assertAdminBatchSucceeded(await db.batch(statements));
  const row = await db.prepare(`SELECT o.id,o.payload_hash,o.status,o.result_json FROM admin_operations o
    JOIN admin_principals p ON p.id=o.actor_principal_id
    WHERE o.actor_principal_id=? AND o.idempotency_key=? AND p.status='active'
      AND EXISTS (SELECT 1 FROM json_each(p.capabilities_json) c WHERE c.type='text' AND c.value=?)`)
    .bind(context.actorPrincipalId, context.idempotencyKey, context.capability).first<OperationRow>();
  if (!row) throw new AdminOperationError('ADMIN_OPERATION_DENIED', 403);
  if (row.payload_hash !== payloadHash) throw new AdminOperationError('ADMIN_IDEMPOTENCY_CONFLICT', 409);
  if (row.status !== 'succeeded' && row.status !== 'conflict') throw new Error('ADMIN_OPERATION_STATE_INVALID');
  return { operationId: row.id, status: row.status, result: row.result_json === null ? null : JSON.parse(row.result_json) as T, replayed: row.id !== operationId };
};
