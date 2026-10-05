import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN_MODERATION_ACTIONS } from '../src/admin/actions/moderation';
import { adminActionVersion, type AdminVersionResource } from '../src/admin/actions/core';
import { adminManagementFixture } from './admin-management-fixture';
import { applyAutomaticCrowdResolution, notifyResolvedReportCase } from '../src/admin/moderation/notifications';

const closers: Array<() => void> = [];
afterEach(() => closers.splice(0).forEach((close) => close()));
const setup = async () => {
  const f = await adminManagementFixture(['reports.write', 'appeals.write', 'crowd-review.write', 'inspectors.write']);
  closers.push(() => f.sqlite.close());
  f.sqlite.exec("PRAGMA foreign_keys=ON");
  f.sqlite.exec("INSERT INTO users(id,username,email,auth_key) VALUES (1,'one','one@example.test','one'),(2,'two','two@example.test','two')");
  f.sqlite.exec("INSERT INTO data_cards(id,user_id,type,name,data,is_public,review_status) VALUES ('card',1,'character','卡片','{}',1,'approved')");
  f.sqlite.exec("INSERT INTO report_cases(id,target_entity_type,target_entity_id,target_user_id,status,latest_reported_at,updated_at) VALUES ('case','data_card','card',1,'under_review','2026-01-01','2026-01-01')");
  f.sqlite.exec("INSERT INTO crowd_review_rounds(id,report_case_id,status,opened_at,deadline_at,min_valid_votes,updated_at) VALUES ('round','case','active','2026-01-01','2027-01-01',3,'2026-01-01')");
  f.sqlite.exec("INSERT INTO crowd_review_assignments(id,crowd_review_round_id,inspector_user_id,status,assigned_at,expires_at) VALUES ('assignment','round',2,'assigned','2026-01-01','2027-01-01')");
  const version = async (resource: AdminVersionResource, table: string, id: string) => adminActionVersion(resource, f.sqlite.prepare(`SELECT * FROM ${table} WHERE ${resource === 'inspectors' ? 'user_id' : 'id'}=?`).get(id)!);
  return { ...f, version };
};
const action = (name: string) => ADMIN_MODERATION_ACTIONS.find((entry) => entry.name === name)!;
const common = { reason: '人工复核', idempotencyKey: 'request' };

describe('Admin governance atomic decisions', () => {
  it('resolves a report with card enforcement, round fencing and exactly one author message', async () => {
    const f = await setup();
    const input = { ...common, id: 'case', expectedVersion: await f.version('report-cases', 'report_cases', 'case'), nextStatus: 'resolved', resolutionCode: 'confirmed_violation' };
    expect(await action('reports.decide').execute(f.db, input, f.context)).toMatchObject({ status: 'succeeded' });
    await action('reports.decide').execute(f.db, input, f.context);
    expect(f.sqlite.prepare('SELECT is_public,review_status,public_since FROM data_cards').get()).toEqual({ is_public: -1, review_status: 'rejected', public_since: null });
    expect(f.sqlite.prepare('SELECT status FROM crowd_review_rounds').get()?.status).toBe('cancelled');
    expect(f.sqlite.prepare('SELECT status FROM crowd_review_assignments').get()?.status).toBe('revoked');
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM user_messages').get()?.n).toBe(1);
    expect(String(f.sqlite.prepare('SELECT payload_json FROM user_messages').get()?.payload_json)).not.toContain(common.reason);
    expect(f.sqlite.prepare('SELECT resolution_notified_case_updated_at,updated_at FROM report_cases').get()).toMatchObject({ resolution_notified_case_updated_at: f.sqlite.prepare('SELECT updated_at FROM report_cases').get()?.updated_at });
  });

  it('leaves case, card, assignments and messages unchanged when the observed case is stale or audit fails', async () => {
    const f = await setup();
    const input = { ...common, id: 'case', expectedVersion: 'stale', nextStatus: 'resolved', resolutionCode: 'confirmed_violation' };
    expect(await action('reports.decide').execute(f.db, input, f.context)).toMatchObject({ status: 'conflict' });
    f.sqlite.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit_events BEGIN SELECT RAISE(ABORT,'fixture'); END");
    await expect(action('reports.decide').execute(f.db, { ...input, idempotencyKey: 'audit', expectedVersion: await f.version('report-cases', 'report_cases', 'case') }, f.context)).rejects.toThrow();
    expect(f.sqlite.prepare('SELECT status FROM report_cases').get()?.status).toBe('under_review');
    expect(f.sqlite.prepare('SELECT status FROM crowd_review_rounds').get()?.status).toBe('active');
    expect(f.sqlite.prepare('SELECT is_public FROM data_cards').get()?.is_public).toBe(1);
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM user_messages').get()?.n).toBe(0);
  });

  it.each(['take-over', 'cancel', 'override'] as const)('performs %s only with current round and case revisions', async (kind) => {
    const f = await setup();
    const input = { ...common, id: 'round', expectedVersion: await f.version('crowd-review', 'crowd_review_rounds', 'round'), expectedCaseVersion: await f.version('report-cases', 'report_cases', 'case'), ...(kind === 'override' ? { caseDecision: 'no_violation' } : {}) };
    expect(await action(`crowd-review.${kind}`).execute(f.db, { ...input, expectedCaseVersion: 'stale', idempotencyKey: 'stale' }, f.context)).toMatchObject({ status: 'conflict' });
    expect(await action(`crowd-review.${kind}`).execute(f.db, input, f.context)).toMatchObject({ status: 'succeeded' });
    expect(f.sqlite.prepare('SELECT status FROM crowd_review_assignments').get()?.status).toBe('revoked');
    expect(JSON.parse(String(f.sqlite.prepare('SELECT result_summary_json FROM crowd_review_rounds').get()?.result_summary_json)).adminAction.adminPrincipalId).toBe('operator');
    expect(f.sqlite.prepare('SELECT status FROM report_cases').get()?.status).toBe(kind === 'override' ? 'dismissed' : 'under_review');
    expect(f.sqlite.prepare('SELECT is_public FROM data_cards').get()?.is_public).toBe(1);
  });

  it('reviews appeal atomically with author notification and keeps business-user attribution null', async () => {
    const f = await setup();
    f.sqlite.exec("UPDATE report_cases SET status='resolved',resolution_code='confirmed_violation'");
    f.sqlite.exec("INSERT INTO report_appeals(id,report_case_id,appellant_user_id,target_user_id,target_entity_type,target_entity_id,appeal_reason_code,details,status,case_status_snapshot,case_resolution_code_snapshot,case_updated_at_snapshot) VALUES ('appeal','case',1,1,'data_card','card','factual_error','说明','submitted','resolved','confirmed_violation','2026-01-01')");
    const input = { ...common, id: 'appeal', expectedVersion: await f.version('report-appeals', 'report_appeals', 'appeal'), expectedCaseVersion: await f.version('report-cases', 'report_cases', 'case'), resolutionCode: 'overturned_no_violation' };
    expect(await action('appeals.review').execute(f.db, input, f.context)).toMatchObject({ status: 'succeeded' });
    await action('appeals.review').execute(f.db, input, f.context);
    expect(f.sqlite.prepare('SELECT reviewed_by_user_id,reviewed_by_admin_principal_id FROM report_appeals').get()).toEqual({ reviewed_by_user_id: null, reviewed_by_admin_principal_id: 'operator' });
    expect(f.sqlite.prepare('SELECT status FROM report_cases').get()?.status).toBe('dismissed');
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM user_messages').get()?.n).toBe(1);
  });

  it('grants then revokes inspectors and invalidates outstanding assignments', async () => {
    const f = await setup();
    expect(await action('inspectors.status').execute(f.db, { ...common, id: '2', expectedVersion: 'missing', nextStatus: 'active' }, f.context)).toMatchObject({ status: 'succeeded' });
    expect(await action('inspectors.status').execute(f.db, { ...common, id: '2', idempotencyKey: 'revoke', expectedVersion: await f.version('inspectors', 'crowd_review_inspectors', '2'), nextStatus: 'revoked' }, f.context)).toMatchObject({ status: 'succeeded' });
    expect(f.sqlite.prepare('SELECT status FROM crowd_review_assignments').get()?.status).toBe('revoked');
    expect(f.sqlite.prepare('SELECT event_type FROM inspector_discipline_events ORDER BY rowid').all()).toEqual([{ event_type: 'grant' }, { event_type: 'revoke' }]);
  });

  it('claims a first creator notification only once', async () => {
    const f = await setup();
    const input = { ...common, id: 'case', expectedVersion: await f.version('report-cases', 'report_cases', 'case') };
    expect(await action('reports.notify-creator').execute(f.db, input, f.context)).toMatchObject({ status: 'succeeded' });
    await action('reports.notify-creator').execute(f.db, input, f.context);
    expect(await action('reports.notify-creator').execute(f.db, { ...input, idempotencyKey: 'again', expectedVersion: await f.version('report-cases', 'report_cases', 'case') }, f.context)).toMatchObject({ status: 'conflict' });
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM user_messages').get()?.n).toBe(1);
  });

  it('rejects a late automatic crowd outcome after a manual override and never re-bans the card', async () => {
    const f = await setup();
    const now = '2026-09-12T12:00:00.000Z';
    const input = { ...common, id: 'round', expectedVersion: await f.version('crowd-review', 'crowd_review_rounds', 'round'), expectedCaseVersion: await f.version('report-cases', 'report_cases', 'case'), caseDecision: 'no_violation' };
    await action('crowd-review.override').execute(f.db, input, f.context);
    expect(await applyAutomaticCrowdResolution(f.db, { reportCaseId: 'case', roundId: 'round', status: 'resolved', resolutionCode: 'confirmed_violation', closedAt: now, now })).toBe(false);
    expect(f.sqlite.prepare('SELECT status FROM report_cases').get()?.status).toBe('dismissed');
    expect(f.sqlite.prepare('SELECT is_public FROM data_cards').get()?.is_public).toBe(1);
  });

  it('commits automatic case outcome and card punishment together and rolls both back on card failure', async () => {
    const f = await setup();
    const now = '2026-09-12T12:00:00.000Z';
    f.sqlite.exec(`UPDATE crowd_review_rounds SET status='concluded',result_code='violation',updated_at='${now}'`);
    const input = { reportCaseId: 'case', roundId: 'round', status: 'resolved' as const, resolutionCode: 'confirmed_violation' as const, closedAt: now, now };
    f.sqlite.exec("CREATE TRIGGER fail_card BEFORE UPDATE ON data_cards BEGIN SELECT RAISE(ABORT,'fixture'); END");
    await expect(applyAutomaticCrowdResolution(f.db, input)).rejects.toThrow();
    expect(f.sqlite.prepare('SELECT status FROM report_cases').get()?.status).toBe('under_review');
    f.sqlite.exec('DROP TRIGGER fail_card');
    expect(await applyAutomaticCrowdResolution(f.db, input)).toBe(true);
    expect(f.sqlite.prepare('SELECT is_public FROM data_cards').get()?.is_public).toBe(-1);
    expect(await notifyResolvedReportCase(f.db, 'case')).toBe(true);
    expect(await notifyResolvedReportCase(f.db, 'case')).toBe(false);
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM user_messages').get()?.n).toBe(1);
  });

  it('prevents delayed old resolution notifications across a manual decision between read and claim', async () => {
    const f = await setup();
    f.sqlite.exec("UPDATE report_cases SET status='resolved',resolution_code='confirmed_violation'");
    const racingDb = { ...f.db, async batch(statements: Parameters<typeof f.db.batch>[0]) {
      f.sqlite.exec("UPDATE report_cases SET status='dismissed',resolution_code='no_violation',updated_at='new-version'");
      return f.db.batch(statements);
    } };
    expect(await notifyResolvedReportCase(racingDb, 'case')).toBe(false);
    expect(f.sqlite.prepare('SELECT count(*) AS n FROM user_messages').get()?.n).toBe(0);
  });
});
