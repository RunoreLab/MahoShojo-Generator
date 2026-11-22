import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { assertSafeAuditText } from '@mahoshojo/hosted-runtime/admin/audit-text';
import { assertAdminBatchSucceeded, type AdminDatabase } from '@mahoshojo/hosted-runtime/admin/database';
import { createD1HttpTransport, createHttpD1Client } from '@mahoshojo/hosted-runtime/d1-http-client';

type ReviewTarget = { id: string; reviewedHash: string };
export type ReviewPlan = {
  version: 1;
  accountId: string;
  databaseId: string;
  requestId: string;
  createdAt: string;
  reason: string;
  items: ReviewTarget[];
};
export type CardSnapshot = {
  id: string; user_id: number; type: string; name: string; description: string | null; data: string;
  is_public: number; public_since: string | null; review_status: string; is_recommended: number | null;
  updated_at: string | null; deleted_at: string | null;
};
type AuditRow = {
  id: string; operation_id: string | null; actor_principal_id: string | null; authn_context_safe_ref: string;
  capability: string; action: string; target_type: string; target_id: string; request_id: string;
  reason: string; expected_version: string; result: string; source_context_safe: string;
};
type Outcome = { id: string; status: 'success' | 'conflict'; replayed: boolean };

const ACTION = 'cards.review.control.approve';
const PLAN_ACTION = 'cards.review.control.plan';
const CAPABILITY = 'content.review.control';
const SOURCE = 'cloudflare-d1-control-tool';
const PLAN_SOURCE = 'cloudflare-d1-control-plan';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const ACCOUNT = /^[0-9a-f]{32}$/i;
const CARD_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const ACTOR = /^cf-(?:user|account)-token:[0-9a-f]{64}$/;
const MAX_ITEMS = 20;
const timeoutMs = 15_000;
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** A content fingerprint, not an authorization token or an assertion of human identity. */
export function hashReviewedCard(row: Pick<CardSnapshot, 'id' | 'name' | 'description' | 'data' | 'type' | 'updated_at'>): string {
  return digest(JSON.stringify([row.id, row.name, row.description, row.data, row.type, row.updated_at]));
}

export function validateReviewPlan(value: unknown, expected: { accountId: string; databaseId: string }): ReviewPlan {
  if (!isObject(value) || !exactKeys(value, ['version', 'accountId', 'databaseId', 'requestId', 'createdAt', 'reason', 'items'])
    || value.version !== 1 || typeof value.accountId !== 'string' || !ACCOUNT.test(value.accountId)
    || typeof value.databaseId !== 'string' || !UUID.test(value.databaseId)
    || value.accountId.toLowerCase() !== expected.accountId.toLowerCase()
    || value.databaseId.toLowerCase() !== expected.databaseId.toLowerCase()
    || typeof value.requestId !== 'string' || !UUID.test(value.requestId)
    || typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt)
    || typeof value.reason !== 'string' || value.reason !== value.reason.trim()
    || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > MAX_ITEMS) {
    throw new Error('CONTROL_PLAN_INVALID');
  }
  const created = Date.parse(value.createdAt);
  if (!Number.isFinite(created) || new Date(created).toISOString() !== value.createdAt
    || created > Date.now() + 300_000 || created < Date.now() - 7 * 24 * 60 * 60 * 1000) throw new Error('CONTROL_PLAN_INVALID');
  try { assertSafeAuditText(value.reason, 1000); } catch { throw new Error('CONTROL_PLAN_INVALID'); }
  const items: ReviewTarget[] = value.items.map(item => {
    if (!isObject(item) || !exactKeys(item, ['id', 'reviewedHash']) || typeof item.id !== 'string'
      || !CARD_ID.test(item.id) || typeof item.reviewedHash !== 'string' || !HASH.test(item.reviewedHash)) {
      throw new Error('CONTROL_PLAN_INVALID');
    }
    return { id: item.id, reviewedHash: item.reviewedHash };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('CONTROL_PLAN_INVALID');
  return { version: 1, accountId: value.accountId.toLowerCase(), databaseId: value.databaseId.toLowerCase(),
    requestId: value.requestId.toLowerCase(), createdAt: value.createdAt, reason: value.reason, items };
}

const auditId = (plan: ReviewPlan, item: ReviewTarget): string =>
  digest(JSON.stringify(['public-card-control-v1', plan.accountId, plan.databaseId, plan.requestId, item.id]));
const planId = (plan: ReviewPlan): string =>
  digest(JSON.stringify(['public-card-control-plan-v1', plan.accountId, plan.databaseId, plan.requestId]));
const planHash = (plan: ReviewPlan): string => digest(JSON.stringify([
  plan.version, plan.accountId, plan.databaseId, plan.requestId, plan.createdAt, plan.reason,
  plan.items.map(item => [item.id, item.reviewedHash]),
]));

async function readCard(db: AdminDatabase, id: string): Promise<CardSnapshot | null> {
  const row = await db.prepare(`SELECT id,user_id,type,name,description,data,is_public,public_since,review_status,is_recommended,updated_at,deleted_at
    FROM data_cards WHERE id=?`).bind(id).first<CardSnapshot>();
  if (!row) return null;
  if (typeof row.id !== 'string' || typeof row.user_id !== 'number' || typeof row.type !== 'string'
    || typeof row.name !== 'string' || typeof row.data !== 'string' || typeof row.review_status !== 'string'
    || typeof row.is_public !== 'number' || (row.is_recommended !== null && typeof row.is_recommended !== 'number')
    || [row.description, row.public_since, row.updated_at, row.deleted_at].some(v => v !== null && typeof v !== 'string')) {
    throw new Error('CONTROL_CARD_INVALID');
  }
  return row;
}

/** Read the complete candidate for an operator to inspect; never put it in an audit record. */
export async function inspectReviewCard(db: AdminDatabase, id: string) {
  if (!CARD_ID.test(id)) throw new Error('CONTROL_ARGUMENTS_INVALID');
  const row = await readCard(db, id);
  if (!row || row.is_public !== 1 || row.review_status !== 'pending' || row.deleted_at !== null) {
    throw new Error('CONTROL_CARD_NOT_PENDING');
  }
  return { id: row.id, name: row.name, description: row.description, type: row.type,
    data: row.data, updated_at: row.updated_at, reviewedHash: hashReviewedCard(row) };
}

async function readAudit(db: AdminDatabase, id: string): Promise<AuditRow | null> {
  return db.prepare(`SELECT id,operation_id,actor_principal_id,authn_context_safe_ref,capability,action,target_type,target_id,
    request_id,reason,expected_version,result,source_context_safe FROM admin_audit_events WHERE id=?`)
    .bind(id).first<AuditRow>();
}

function priorOutcome(audit: AuditRow, plan: ReviewPlan, item: ReviewTarget, actorRef: string): Outcome {
  if (audit.id !== auditId(plan, item) || audit.operation_id !== null || audit.actor_principal_id !== null
    || audit.authn_context_safe_ref !== actorRef || audit.capability !== CAPABILITY || audit.action !== ACTION
    || audit.target_type !== 'data-cards' || audit.target_id !== item.id || audit.request_id !== plan.requestId
    || audit.reason !== plan.reason || audit.expected_version !== item.reviewedHash || audit.source_context_safe !== SOURCE
    || !['success', 'conflict'].includes(audit.result)) throw new Error('CONTROL_IDEMPOTENCY_CONFLICT');
  return { id: item.id, status: audit.result as Outcome['status'], replayed: true };
}

function assertPlanAnchor(audit: AuditRow, plan: ReviewPlan, actorRef: string): void {
  if (audit.id !== planId(plan) || audit.operation_id !== null || audit.actor_principal_id !== null
    || audit.authn_context_safe_ref !== actorRef || audit.capability !== CAPABILITY || audit.action !== PLAN_ACTION
    || audit.target_type !== 'data-card-review-plan' || audit.target_id !== plan.requestId || audit.request_id !== plan.requestId
    || audit.reason !== plan.reason || audit.expected_version !== planHash(plan) || audit.source_context_safe !== PLAN_SOURCE
    || audit.result !== 'success') throw new Error('CONTROL_IDEMPOTENCY_CONFLICT');
}

const planGuard = `EXISTS (SELECT 1 FROM admin_audit_events WHERE id=? AND operation_id IS NULL AND actor_principal_id IS NULL
  AND authn_context_safe_ref=? AND capability=? AND action=? AND target_type='data-card-review-plan' AND target_id=?
  AND request_id=? AND reason=? AND expected_version=? AND result='success' AND source_context_safe=?)`;
const planGuardBindings = (plan: ReviewPlan, actorRef: string): string[] => [
  planId(plan), actorRef, CAPABILITY, PLAN_ACTION, plan.requestId, plan.requestId, plan.reason, planHash(plan), PLAN_SOURCE,
];

/** Freeze the complete ordered intent under the request ID before any card can be changed. */
async function ensurePlanAnchor(db: AdminDatabase, plan: ReviewPlan, actorRef: string): Promise<void> {
  const id = planId(plan);
  let anchor = await readAudit(db, id);
  if (anchor) { assertPlanAnchor(anchor, plan, actorRef); return; }
  try {
    const result = await db.prepare(`INSERT INTO admin_audit_events
      (id,operation_id,actor_principal_id,authn_context_safe_ref,capability,action,target_type,target_id,request_id,reason,
       expected_version,result,error_code_safe,source_context_safe,created_at)
      SELECT ?,NULL,NULL,?,?,?,'data-card-review-plan',?,?,?,?, 'success',NULL,?,?
      WHERE NOT EXISTS (SELECT 1 FROM admin_audit_events WHERE id=?)`)
      .bind(id, actorRef, CAPABILITY, PLAN_ACTION, plan.requestId, plan.requestId, plan.reason, planHash(plan),
        PLAN_SOURCE, new Date().toISOString(), id).run();
    if (!result.success) throw new Error('CONTROL_OUTCOME_UNCERTAIN');
  } catch {
    anchor = await readAudit(db, id).catch(() => null);
    if (!anchor) throw new Error('CONTROL_OUTCOME_UNCERTAIN');
    assertPlanAnchor(anchor, plan, actorRef);
    return;
  }
  anchor = await readAudit(db, id);
  if (!anchor) throw new Error('CONTROL_OUTCOME_UNCERTAIN');
  assertPlanAnchor(anchor, plan, actorRef);
}

function assertTarget(plan: ReviewPlan, item: ReviewTarget, actorRef: string): void {
  if (!ACTOR.test(actorRef)) throw new Error('CONTROL_IDENTITY_INVALID');
  if (!plan.items.some(target => target.id === item.id && target.reviewedHash === item.reviewedHash)) {
    throw new Error('CONTROL_PLAN_INVALID');
  }
}

export async function previewReviewItem(db: AdminDatabase, plan: ReviewPlan, item: ReviewTarget, actorRef: string) {
  assertTarget(plan, item, actorRef);
  const anchor = await readAudit(db, planId(plan));
  if (anchor) assertPlanAnchor(anchor, plan, actorRef);
  const prior = await readAudit(db, auditId(plan, item));
  if (prior) return priorOutcome(prior, plan, item, actorRef);
  const row = await readCard(db, item.id);
  return { id: item.id, status: row && row.is_public === 1 && row.review_status === 'pending'
    && row.deleted_at === null && hashReviewedCard(row) === item.reviewedHash ? 'ready' : 'conflict', replayed: false };
}

/** The caller supplies a native transactional batch, or the repository's single D1 HTTP client. */
export async function executeReviewItem(db: AdminDatabase, plan: ReviewPlan, item: ReviewTarget, actorRef: string): Promise<Outcome> {
  assertTarget(plan, item, actorRef);
  await ensurePlanAnchor(db, plan, actorRef);
  const eventId = auditId(plan, item);
  const prior = await readAudit(db, eventId);
  if (prior) return priorOutcome(prior, plan, item, actorRef);
  const row = await readCard(db, item.id);
  const matches = row !== null && hashReviewedCard(row) === item.reviewedHash;
  const now = new Date().toISOString();
  const snapshot = row ?? { user_id: null, type: null, name: null, description: null, data: null,
    is_public: null, public_since: null, review_status: null, is_recommended: null, updated_at: null, deleted_at: null };
  const statements = [
    db.prepare(`UPDATE data_cards SET review_status='approved',updated_at=?
      WHERE id=? AND ?=1 AND is_public=1 AND review_status='pending' AND deleted_at IS NULL
      AND user_id IS ? AND type IS ? AND name IS ? AND description IS ? AND data IS ? AND is_public IS ?
      AND public_since IS ? AND review_status IS ? AND is_recommended IS ? AND updated_at IS ? AND deleted_at IS ?
      AND NOT EXISTS (SELECT 1 FROM admin_audit_events WHERE id=?) AND ${planGuard}`)
      .bind(now, item.id, Number(matches), snapshot.user_id, snapshot.type, snapshot.name, snapshot.description,
        snapshot.data, snapshot.is_public, snapshot.public_since, snapshot.review_status, snapshot.is_recommended,
        snapshot.updated_at, snapshot.deleted_at, eventId, ...planGuardBindings(plan, actorRef)),
    // changes() reads the immediately preceding UPDATE. An impossible row count violates the result CHECK.
    db.prepare(`INSERT INTO admin_audit_events
      (id,operation_id,actor_principal_id,authn_context_safe_ref,capability,action,target_type,target_id,request_id,reason,
       expected_version,result,error_code_safe,source_context_safe,created_at)
      SELECT ?,NULL,NULL,?,?,?,'data-cards',?,?,?,?,
        CASE WHEN changes()=1 THEN 'success' WHEN changes()=0 THEN 'conflict' ELSE 'invalid-row-count' END,
        CASE WHEN changes()=0 THEN 'CONTROL_VERSION_CONFLICT' ELSE NULL END,?,?
      WHERE NOT EXISTS (SELECT 1 FROM admin_audit_events WHERE id=?) AND ${planGuard}`)
      .bind(eventId, actorRef, CAPABILITY, ACTION, item.id, plan.requestId, plan.reason, item.reviewedHash, SOURCE, now, eventId,
        ...planGuardBindings(plan, actorRef)),
    // name is NOT NULL in the canonical schema; review_status is allowed to be nullable.
    // If an audit insert was silently ignored, this fails and rolls back any preceding card mutation.
    db.prepare(`UPDATE data_cards SET name=NULL WHERE id=? AND NOT EXISTS
      (SELECT 1 FROM admin_audit_events WHERE id=? AND operation_id IS NULL AND actor_principal_id IS NULL
       AND authn_context_safe_ref=? AND capability=? AND action=? AND target_type='data-cards' AND target_id=?
       AND request_id=? AND reason=? AND expected_version=? AND source_context_safe=?)`)
      .bind(item.id, eventId, actorRef, CAPABILITY, ACTION, item.id, plan.requestId, plan.reason, item.reviewedHash, SOURCE),
  ];
  let inserted = false;
  try {
    const results = await db.batch(statements);
    if (results.length !== statements.length) throw new Error('CONTROL_BATCH_INVALID');
    assertAdminBatchSucceeded(results);
    const changes = results[1]?.meta?.changes;
    if (changes !== 0 && changes !== 1) throw new Error('CONTROL_BATCH_INVALID');
    inserted = changes === 1;
  } catch {
    // Never redispatch an ambiguous write with a new key. A persisted audit is the receipt.
    const recovered = await readAudit(db, eventId).catch(() => null);
    if (recovered) return priorOutcome(recovered, plan, item, actorRef);
    throw new Error('CONTROL_OUTCOME_UNCERTAIN');
  }
  const receipt = await readAudit(db, eventId);
  if (!receipt) throw new Error('CONTROL_OUTCOME_UNCERTAIN');
  return { ...priorOutcome(receipt, plan, item, actorRef), replayed: !inserted };
}

/** Verify the credential itself; this does not claim it identifies a particular human. */
export async function verifyControlIdentity(accountId: string, token: string, fetcher = globalThis.fetch): Promise<string> {
  if (!ACCOUNT.test(accountId) || !token.trim()) throw new Error('CONTROL_IDENTITY_INVALID');
  for (const [kind, path] of [
    ['user', '/user/tokens/verify'],
    ['account', `/accounts/${accountId}/tokens/verify`],
  ] as const) {
    let response: Response;
    try {
      response = await fetcher(`https://api.cloudflare.com/client/v4${path}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { throw new Error('CONTROL_IDENTITY_UNAVAILABLE'); }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); continue; }
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error('CONTROL_IDENTITY_UNAVAILABLE'); }
    if (!isObject(body) || body.success !== true || !isObject(body.result)
      || body.result.status !== 'active' || typeof body.result.id !== 'string'
      || !/^[0-9a-f]{32}$/i.test(body.result.id)) throw new Error('CONTROL_IDENTITY_INVALID');
    return `cf-${kind}-token:${digest(JSON.stringify([accountId.toLowerCase(), kind, body.result.id.toLowerCase()]))}`;
  }
  throw new Error('CONTROL_IDENTITY_UNAVAILABLE');
}

async function runCli(argv: string[]): Promise<void> {
  const mode = argv[0];
  const inspecting = mode === 'inspect' && argv[1] === '--id' && argv.length === 3 && CARD_ID.test(argv[2] ?? '');
  const planned = (mode === 'preview' || mode === 'apply') && argv[1] === '--plan' && Boolean(argv[2])
    && (mode === 'preview' ? argv.length === 3 : argv.length === 4 && argv[3] === '--confirm-remote');
  if (!inspecting && !planned) {
    throw new Error('CONTROL_ARGUMENTS_INVALID');
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
  const databaseId = process.env.D1_DATABASE_ID?.trim() ?? '';
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
  if (!ACCOUNT.test(accountId) || !UUID.test(databaseId) || !token) throw new Error('CONTROL_CONFIGURATION_INVALID');
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;
  const db = createHttpD1Client(createD1HttpTransport({ kind: 'cloudflare-api', queryUrl: `${base}/query`,
    rawUrl: `${base}/raw`, apiToken: token })) as AdminDatabase;
  if (inspecting) {
    await verifyControlIdentity(accountId, token);
    console.log(JSON.stringify(await inspectReviewCard(db, argv[2]), null, 2));
    return;
  }
  const raw = await readFile(argv[2], 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > 64_000) throw new Error('CONTROL_PLAN_INVALID');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('CONTROL_PLAN_INVALID'); }
  const plan = validateReviewPlan(parsed, { accountId, databaseId });
  const actorRef = await verifyControlIdentity(accountId, token);
  console.log(JSON.stringify({ mode, requestId: plan.requestId, actorRef, total: plan.items.length }));
  const outcomes = [];
  for (const item of plan.items) {
    const outcome = mode === 'preview' ? await previewReviewItem(db, plan, item, actorRef)
      : await executeReviewItem(db, plan, item, actorRef);
    outcomes.push(outcome);
    console.log(JSON.stringify({ outcome }));
    // Do not continue after a conflict: the remainder requires an explicit renewed review.
    if (mode === 'apply' && outcome.status === 'conflict') break;
  }
  if (outcomes.some(outcome => outcome.status === 'conflict')) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).catch(error => {
    // Neither third-party response bodies nor arbitrary exception text may reach the console.
    const code = error instanceof Error && /^CONTROL_[A-Z_]+$/.test(error.message) ? error.message : 'CONTROL_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
