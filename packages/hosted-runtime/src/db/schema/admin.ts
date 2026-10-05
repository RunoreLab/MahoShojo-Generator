import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const adminPrincipals = sqliteTable('admin_principals', {
 id: text('id').primaryKey(), issuer:text('issuer').notNull(),subject:text('subject').notNull(),kind:text('kind').notNull(),
 status:text('status').notNull().default('active'),capabilitiesJson:text('capabilities_json').notNull(),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('admin_principals_identity_idx').on(t.issuer,t.subject,t.kind),
 check('admin_principal_kind',sql`${t.kind} IN ('human','service')`),check('admin_principal_status',sql`${t.status} IN ('active','disabled')`),
 check('admin_principal_capabilities',sql`json_valid(${t.capabilitiesJson}) AND json_type(${t.capabilitiesJson})='array'`)]);
export const adminOperations=sqliteTable('admin_operations',{
 id:text('id').primaryKey(),actorPrincipalId:text('actor_principal_id').notNull().references(()=>adminPrincipals.id),
 action:text('action').notNull(),capability:text('capability').notNull(),requestId:text('request_id').notNull(),
 idempotencyKey:text('idempotency_key').notNull(),payloadHash:text('payload_hash').notNull(),reason:text('reason').notNull(),
 expectedVersion:text('expected_version'),targetType:text('target_type').notNull(),targetId:text('target_id').notNull(),
 status:text('status').notNull(),resultJson:text('result_json'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('admin_operations_idempotency_idx').on(t.actorPrincipalId,t.idempotencyKey),
 check('admin_operation_status',sql`${t.status} IN ('pending','applied','succeeded','conflict')`),
 check('admin_operation_result',sql`${t.resultJson} IS NULL OR json_valid(${t.resultJson})`)]);
export const adminAuditEvents=sqliteTable('admin_audit_events',{
 id:text('id').primaryKey(),operationId:text('operation_id').references(()=>adminOperations.id),
 actorPrincipalId:text('actor_principal_id').references(()=>adminPrincipals.id),authnContextSafeRef:text('authn_context_safe_ref').notNull(),
 capability:text('capability').notNull(),action:text('action').notNull(),targetType:text('target_type').notNull(),
 targetId:text('target_id').notNull(),requestId:text('request_id').notNull(),reason:text('reason').notNull(),
 expectedVersion:text('expected_version'),result:text('result').notNull(),errorCodeSafe:text('error_code_safe'),
 sourceContextSafe:text('source_context_safe').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('admin_audit_events_retention_idx').on(t.createdAt),index('admin_audit_events_operation_idx').on(t.operationId),
 check('admin_audit_result',sql`${t.result} IN ('success','denied','conflict','failed')`)]);
export const adminJobs=sqliteTable('admin_jobs',{
 id:text('id').primaryKey(),operationId:text('operation_id').notNull().references(()=>adminOperations.id),
 actorPrincipalId:text('actor_principal_id').notNull().references(()=>adminPrincipals.id),
 capability:text('capability').notNull(),kind:text('kind').notNull(),scopeJson:text('scope_json').notNull(),
 status:text('status').notNull(),cursorJson:text('cursor_json'),processedCount:integer('processed_count').notNull().default(0),
 attempts:integer('attempts').notNull().default(0),leaseToken:text('lease_token'),leaseExpiresAt:text('lease_expires_at'),
 nextAttemptAt:text('next_attempt_at').notNull(),resultRef:text('result_ref'),resultExpiresAt:text('result_expires_at'),
 errorCodeSafe:text('error_code_safe'),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[index('admin_jobs_retry_idx').on(t.status,t.nextAttemptAt),
 check('admin_job_status',sql`${t.status} IN ('queued','running','succeeded','failed','cancelled','uncertain')`),check('admin_job_scope',sql`json_valid(${t.scopeJson})`)]);

export const adminObjectTombstones=sqliteTable('admin_object_tombstones',{
 r2Key:text('r2_key').primaryKey().notNull(),jobId:text('job_id').notNull().references(()=>adminJobs.id),
 largeObjectId:text('large_object_id').notNull(),createdAt:text('created_at').notNull(),
});
