import { AdminQuerySchema, AdminResourceSchema, type AdminQuery, type AdminReadResponse, type AdminRecord, type AdminResource } from '@mahoshojo/contracts/admin';
import { ADMIN_READ_DEFINITIONS } from './read-definitions';
import type { AdminQueryResult } from './database';
import { ADMIN_ACTION_VERSIONS, adminActionVersion, type AdminVersionResource } from './actions/core';

/** A deliberately read-only subset of native D1; no process environment or cached binding. */
export interface AdminReadStatement {
  bind(..._values: unknown[]): AdminReadStatement;
  all<T = Record<string, unknown>>(): Promise<AdminQueryResult<T>>;
}
export interface AdminReadDatabase { prepare(_sql: string): AdminReadStatement }

export class AdminReadInputError extends Error {
  constructor(message: string) { super(message); this.name = 'AdminReadInputError'; }
}

const signature = (resource: AdminResource, query: AdminQuery): string => JSON.stringify([resource, query.q ?? null, query.status ?? null, query.visibility ?? null, query.userId ?? null]);
function decodeCursor(cursor: string, resource: AdminResource, query: AdminQuery): string | number {
  try {
    const decoded: unknown = JSON.parse(decodeURIComponent(cursor));
    if (!Array.isArray(decoded) || decoded.length !== 3 || decoded[0] !== 1 || decoded[1] !== signature(resource, query)
      || !['string', 'number'].includes(typeof decoded[2]) || (typeof decoded[2] === 'number' && !Number.isSafeInteger(decoded[2]))) throw new Error();
    return decoded[2] as string | number;
  } catch { throw new AdminReadInputError('Invalid cursor for this resource or filter'); }
}

const project = (row: Record<string, unknown>, names: string[]): AdminRecord => Object.fromEntries(names.map((name) => {
  const value = row[name];
  if (value !== undefined && value !== null && typeof value !== 'string' && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) throw new Error('ADMIN_INVALID_READ_RESULT');
  return [name, value ?? null];
}));

async function rows(db: AdminReadDatabase, sql: string, values: unknown[]): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(sql).bind(...values).all<Record<string, unknown>>();
  if (!result.success || !Array.isArray(result.results)) throw new Error('ADMIN_DATABASE_UNAVAILABLE');
  return result.results;
}

export async function readAdminResource(db: AdminReadDatabase, resource: AdminResource, input: AdminQuery): Promise<AdminReadResponse> {
  AdminResourceSchema.parse(resource);
  const query = AdminQuerySchema.parse(input);
  if (query.id && query.cursor) throw new AdminReadInputError('Detail does not accept cursor');
  if (resource === 'dashboard') {
    if (query.id || query.cursor || query.q || query.status || query.visibility !== undefined || query.userId !== undefined) throw new AdminReadInputError('Dashboard does not accept filters');
    const counts = {
      users: '(SELECT count(*) FROM users)', cards: '(SELECT count(*) FROM data_cards WHERE deleted_at IS NULL)',
      pending_cards: "(SELECT count(*) FROM data_cards WHERE review_status = 'pending' AND deleted_at IS NULL)",
      open_cases: "(SELECT count(*) FROM report_cases WHERE status IN ('open', 'under_review'))",
      authentication_events: '(SELECT count(*) FROM auth_audit_logs)',
      reset_requests: '(SELECT count(*) FROM auth_password_reset_tokens)',
      verifications: '(SELECT count(*) FROM ba_verification)', account_links: '(SELECT count(*) FROM user_auth_links)',
    };
    const result = await rows(db, `SELECT ${Object.entries(counts).map(([key, expression]) => `${expression} AS ${key}`).join(', ')}`, []);
    if (result.length !== 1) throw new Error('ADMIN_INVALID_READ_RESULT');
    return { items: result.map((row) => project(row, Object.keys(counts))), nextCursor: null };
  }
  const definition = ADMIN_READ_DEFINITIONS[resource];
  if (!definition) throw new AdminReadInputError('Unknown resource');
  const clauses: string[] = definition.where ? [definition.where] : [];
  const values: unknown[] = [];
  if (query.id) { clauses.push(`${definition.key} = ?`); values.push(query.id); }
  if (query.cursor) { clauses.push(`${definition.key} < ?`); values.push(decodeCursor(query.cursor, resource, query)); }
  if (query.q) {
    if (!definition.search) throw new AdminReadInputError('Search is not supported for this resource');
    clauses.push(`${definition.search} LIKE ? ESCAPE '\\'`);
    values.push(`%${query.q.replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (query.status) {
    if (!definition.status || !definition.statuses?.includes(query.status)) throw new AdminReadInputError('Invalid status for this resource');
    clauses.push(`${definition.status} = ?`); values.push(query.status);
  }
  if (query.visibility !== undefined) {
    if (resource !== 'data-cards') throw new AdminReadInputError('Visibility is only supported for data cards');
    clauses.push('CAST(is_public AS INTEGER) = ?'); values.push(query.visibility);
  }
  if (query.userId !== undefined) {
    if (!definition.user) throw new AdminReadInputError('User filter is not supported for this resource');
    clauses.push(`${definition.user} = ?`); values.push(query.userId);
  }
  const projection = { ...definition.fields, ...(query.id ? definition.detail : {}) };
  const versionResource = query.id && resource in ADMIN_ACTION_VERSIONS ? resource as AdminVersionResource : null;
  const versionColumns = versionResource ? ADMIN_ACTION_VERSIONS[versionResource].columns : [];
  const privateProjection = versionColumns.map((name,index)=>`${name} AS __version_${index}`);
  const sql = `SELECT ${[...Object.entries(projection).map(([name, expression]) => `${expression} AS ${name}`),...privateProjection].join(', ')} FROM ${definition.table}${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY ${definition.key} DESC LIMIT ?`;
  const limit = query.id ? 1 : query.limit;
  const result = await rows(db, sql, [...values, query.id ? 1 : limit + 1]);
  const items = result.slice(0, limit).map((row) => project(row, Object.keys(projection)));
  if (versionResource && items.length) {
    items[0].expectedVersion = await adminActionVersion(versionResource,Object.fromEntries(versionColumns.map((name,index)=>[name,result[0]['__version_'+index]])));
  }
  if (resource === 'data-cards' && items.some((item) => ![-1, 0, 1].includes(item.is_public as number))) throw new Error('ADMIN_INVALID_READ_RESULT');
  if (query.id && items.length && resource === 'pvp-rooms') items[0].expectedVersion=items[0].version;
  if (query.id && items.length && resource === 'data-cards') items[0].tags=JSON.stringify(await rows(db,'SELECT t.id,t.name,t.scope FROM data_card_tags c JOIN tags t ON t.id=c.tag_id WHERE c.data_card_id=? ORDER BY t.scope,t.id LIMIT 100',[query.id]));
  if (query.id && items.length && resource === 'data-card-updates') {
    const definition = ADMIN_ACTION_VERSIONS['data-cards'];
    const cards = await rows(db, `SELECT ${definition.columns.join(',')} FROM data_cards WHERE id=? LIMIT 1`, [items[0].data_card_id]);
    items[0].cardId = items[0].data_card_id;
    items[0].cardVersion = cards[0] ? await adminActionVersion('data-cards', cards[0]) : null;
    items[0].currentCard = cards[0] ? JSON.stringify(project(cards[0],['id','name','description','data','review_status','is_public'])) : null;
    items[0].updateVersion = items[0].expectedVersion;
  }
  if (query.id && items.length && resource === 'users') {
    items[0].badges = JSON.stringify(await rows(db, 'SELECT id AS assignmentId,badge_id,obtained_at AS obtainedAt FROM user_badges WHERE user_id=? ORDER BY id LIMIT 100', [query.id]));
  }
  if (query.id && items.length && ['report-cases','report-appeals','crowd-review'].includes(resource)) {
    const caseId=resource==='report-cases'?query.id:String(items[0].report_case_id);
    const version=ADMIN_ACTION_VERSIONS['report-cases'];
    const cases=await rows(db,`SELECT ${version.columns.join(',')} FROM report_cases WHERE id=?`,[caseId]);
    if(cases[0]){items[0].expectedCaseVersion=await adminActionVersion('report-cases',cases[0]);items[0].currentCase=JSON.stringify(cases[0]);}
    const reports=await rows(db,'SELECT id,reporter_user_id,reason_code,details,status,created_at FROM reports WHERE case_id=? ORDER BY created_at DESC LIMIT 101',[caseId]);
    items[0].reports=JSON.stringify(reports.slice(0,100));items[0].reportsHasMore=reports.length>100;
    if(resource==='report-appeals')items[0].references=JSON.stringify(await rows(db,'SELECT reference_type,reference_id,label_snapshot,url_snapshot,note FROM report_appeal_references WHERE appeal_id=? ORDER BY sort_order LIMIT 100',[query.id]));
    if(resource==='crowd-review')items[0].assignments=JSON.stringify(await rows(db,'SELECT id,inspector_user_id,status,decision,decision_note,completed_at FROM crowd_review_assignments WHERE crowd_review_round_id=? ORDER BY assigned_at DESC LIMIT 100',[query.id]));
  }
  const last = items.at(-1)?.id;
  if (result.length > limit && typeof last !== 'string' && typeof last !== 'number') throw new Error('ADMIN_INVALID_READ_RESULT');
  return { items, nextCursor: result.length > limit ? encodeURIComponent(JSON.stringify([1, signature(resource, query), last])) : null };
}
