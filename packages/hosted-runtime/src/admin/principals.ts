import { assertAdminBatchSucceeded, type AdminDatabase } from './database';
import { AdminAuditTextError, assertSafeAuditText } from './audit-text';

export type AdminExternalIdentity = { issuer: string; subject: string; kind: 'human' | 'service' };
export type PersistedAdminPrincipal = {
  id: string;
  externalIdentity: AdminExternalIdentity;
  status: 'active' | 'disabled';
  capabilities: readonly string[];
};

const validateIdentity = (identity: AdminExternalIdentity): void => {
  if (!identity.issuer || !identity.subject || !['human', 'service'].includes(identity.kind)
    || identity.issuer.length > 2048 || identity.subject.length > 2048) {
    throw new Error('ADMIN_PRINCIPAL_INVALID');
  }
};

const validateCapabilities = (value: unknown, allowed: readonly string[]): string[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100
    || value.some((item) => typeof item !== 'string' || !allowed.includes(item))
    || new Set(value).size !== value.length) throw new Error('ADMIN_PRINCIPAL_INVALID');
  return [...value].sort();
};

/** Must be called after cryptographic Access verification, for every request. */
export const resolveAdminPrincipal = async (
  db: AdminDatabase,
  identity: AdminExternalIdentity,
  allowedCapabilities: readonly string[],
): Promise<PersistedAdminPrincipal | null> => {
  validateIdentity(identity);
  const row = await db.prepare(`SELECT id, status, capabilities_json FROM admin_principals
    WHERE issuer=? AND subject=? AND kind=? LIMIT 1`)
    .bind(identity.issuer, identity.subject, identity.kind)
    .first<{ id: string; status: string; capabilities_json: string }>();
  if (!row) return null;
  if (!row.id || !['active', 'disabled'].includes(row.status)) throw new Error('ADMIN_PRINCIPAL_INVALID');
  let capabilities: string[];
  try { capabilities = validateCapabilities(JSON.parse(row.capabilities_json), allowedCapabilities); }
  catch { throw new Error('ADMIN_PRINCIPAL_INVALID'); }
  return {
    id: row.id, externalIdentity: { ...identity }, status: row.status as 'active' | 'disabled',
    capabilities: Object.freeze(capabilities),
  };
};

type PrincipalToolContext = {
  id: string;
  requestId: string;
  reason: string;
  /** Non-secret reference to the authenticated Cloudflare account control session. */
  operatorSafeRef: string;
};

const validateToolContext = (context: PrincipalToolContext): void => {
  try { assertSafeAuditText(context.reason); }
  catch (error) {
    throw new Error(error instanceof AdminAuditTextError && error.code === 'ADMIN_AUDIT_TEXT_UNSAFE'
      ? 'ADMIN_PRINCIPAL_TOOL_REASON_UNSAFE' : 'ADMIN_PRINCIPAL_TOOL_CONTEXT_INVALID');
  }
  try {
    for (const value of [context.id, context.requestId, context.operatorSafeRef]) assertSafeAuditText(value);
  } catch { throw new Error('ADMIN_PRINCIPAL_TOOL_CONTEXT_INVALID'); }
};

/** Control-tool-only; callers must obtain verifiedIdentity from a verified Access JWT, never decode-only. */
export const bootstrapAdminPrincipal = async (
  db: AdminDatabase,
  input: PrincipalToolContext & {
    verifiedIdentity: AdminExternalIdentity;
    capabilities: readonly string[];
    allowedCapabilities: readonly string[];
  },
): Promise<void> => {
  validateToolContext(input);
  validateIdentity(input.verifiedIdentity);
  const capabilities = validateCapabilities(input.capabilities, input.allowedCapabilities);
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  assertAdminBatchSucceeded(await db.batch([
    db.prepare(`INSERT INTO admin_principals
      (id,issuer,subject,kind,status,capabilities_json,created_at,updated_at) VALUES (?,?,?,?,'active',?,?,?)`)
      .bind(input.id, input.verifiedIdentity.issuer, input.verifiedIdentity.subject, input.verifiedIdentity.kind, JSON.stringify(capabilities), now, now),
    db.prepare(`INSERT INTO admin_audit_events
      (id,actor_principal_id,authn_context_safe_ref,capability,action,target_type,target_id,request_id,reason,result,source_context_safe,created_at)
      VALUES (?,NULL,?,'admin.principals.manage','admin.principal.bootstrap','admin-principal',?,?,?,'success','control-tool',?)`)
      .bind(auditId, input.operatorSafeRef, input.id, input.requestId, input.reason, now),
    db.prepare(`UPDATE admin_principals SET status=CASE WHEN EXISTS
      (SELECT 1 FROM admin_audit_events WHERE id=?) THEN status ELSE 'audit-missing' END WHERE id=?`)
      .bind(auditId, input.id),
  ]));
};

/** Control-tool-only recovery/revocation path. No browser route should expose this function. */
export const revokeAdminPrincipal = async (db: AdminDatabase, input: PrincipalToolContext): Promise<void> => {
  validateToolContext(input);
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  assertAdminBatchSucceeded(await db.batch([
    db.prepare("UPDATE admin_principals SET status='disabled', updated_at=? WHERE id=?").bind(now, input.id),
    db.prepare(`INSERT INTO admin_audit_events
      (id,actor_principal_id,authn_context_safe_ref,capability,action,target_type,target_id,request_id,reason,result,error_code_safe,source_context_safe,created_at)
      SELECT ?,NULL,?,'admin.principals.manage','admin.principal.revoke','admin-principal',?,?,?,
      CASE WHEN changes()=1 THEN 'success' ELSE 'denied' END,
      CASE WHEN changes()=1 THEN NULL ELSE 'ADMIN_PRINCIPAL_MISSING' END,'control-tool',?`)
      .bind(auditId, input.operatorSafeRef, input.id, input.requestId, input.reason, now),
    db.prepare(`UPDATE admin_principals SET status=CASE WHEN EXISTS
      (SELECT 1 FROM admin_audit_events WHERE id=?) THEN status ELSE 'audit-missing' END WHERE id=?`)
      .bind(auditId, input.id),
  ]));
};

/** Controlled recovery of the same verified human identity. Never inserts or replaces a principal. */
export const restoreAdminPrincipal = async (
  db: AdminDatabase,
  input: PrincipalToolContext & {
    verifiedIdentity: AdminExternalIdentity;
    capabilities: readonly string[];
    allowedCapabilities: readonly string[];
  },
): Promise<void> => {
  validateToolContext(input);
  validateIdentity(input.verifiedIdentity);
  if (input.verifiedIdentity.kind !== 'human') throw new Error('ADMIN_PRINCIPAL_RESTORE_DENIED');
  const capabilities = validateCapabilities(input.capabilities, input.allowedCapabilities);
  const now = new Date().toISOString(), auditId = crypto.randomUUID();
  assertAdminBatchSucceeded(await db.batch([
    db.prepare(`UPDATE admin_principals SET status='active',capabilities_json=?,updated_at=?
      WHERE id=? AND status='disabled' AND issuer=? AND subject=? AND kind='human'`)
      .bind(JSON.stringify(capabilities), now, input.id, input.verifiedIdentity.issuer, input.verifiedIdentity.subject),
    db.prepare(`INSERT INTO admin_audit_events
      (id,actor_principal_id,authn_context_safe_ref,capability,action,target_type,target_id,request_id,reason,result,error_code_safe,source_context_safe,created_at)
      SELECT ?,NULL,?,'admin.principals.manage','admin.principal.restore','admin-principal',?,?,?,
      CASE WHEN changes()=1 THEN 'success' ELSE 'denied' END,
      CASE WHEN changes()=1 THEN NULL ELSE 'ADMIN_PRINCIPAL_RESTORE_DENIED' END,'control-tool',?`)
      .bind(auditId, input.operatorSafeRef, input.id, input.requestId, input.reason, now),
    db.prepare(`UPDATE admin_principals SET status=CASE WHEN EXISTS
      (SELECT 1 FROM admin_audit_events WHERE id=?) THEN status ELSE 'audit-missing' END WHERE id=?`)
      .bind(auditId, input.id),
  ]));
  const outcome = await db.prepare('SELECT result FROM admin_audit_events WHERE id=?').bind(auditId).first<{result: string}>();
  if (outcome?.result !== 'success') throw new Error('ADMIN_PRINCIPAL_RESTORE_DENIED');
};
