import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as schema from '@/lib/db/schema';
import {
  createReportWithReferencesIfCaseEditable,
  countReportSubmissionEventsByReporterSince,
  createReport,
  createReportCase,
  createReportSubmissionEvent,
  getActiveReportByCaseAndReporter,
  getLatestReportSubmissionEventByReport,
  getOpenReportCaseByTarget,
  listReportReferencesByReport,
  markReportCaseCreatorNotified,
  replaceReportReferences,
  replaceReportReferencesIfCaseEditable,
  updateActiveReportForReporter,
  updateActiveReportForReporterWithReferencesIfCaseEditable,
  withdrawActiveReportAndMaybeDismissCaseIfEditable,
} from '@/lib/db/repositories/data-card-reports';

let sqlite: Database;
let db: AppDrizzleDb;

const now = '2026-04-08T10:20:00.000Z';

const exec = (sqlText: string) => sqlite.exec(sqlText);

const createReportCaseFixture = async () =>
  createReportCase(db, {
    id: 'case-1',
    targetEntityType: 'data_card',
    targetEntityId: 'card-1',
    targetUserId: 2,
    now,
  });

const createReportFixture = async () =>
  createReport(db, {
    id: 'report-1',
    caseId: 'case-1',
    reporterUserId: 7,
    reasonCode: 'plagiarism',
    details: '初次说明',
    evidenceSummaryJson: '{}',
    normalizedPayloadHash: 'hash-a',
    targetNameSnapshot: '公开卡',
    targetDescriptionSnapshot: '描述',
    targetDataSnapshot: '{"name":"公开卡"}',
    targetUpdatedAtSnapshot: '2026-04-08T10:00:00.000Z',
    now,
  });

describe('data card reports repository', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;

    exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, email TEXT NOT NULL);
      CREATE TABLE data_cards (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        data TEXT NOT NULL,
        is_public INTEGER NOT NULL DEFAULT 0,
        public_since TEXT,
        usage_count INTEGER DEFAULT 0,
        like_count INTEGER DEFAULT 0,
        favorite_count INTEGER DEFAULT 0,
        review_status TEXT DEFAULT 'pending',
        is_recommended INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT
      );
      CREATE TABLE report_cases (
        id TEXT PRIMARY KEY,
        target_entity_type TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        target_user_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        resolution_code TEXT,
        creator_notified_at TEXT,
        creator_notified_report_count INTEGER NOT NULL DEFAULT 0,
        latest_reported_at TEXT NOT NULL,
        target_card_updated_at_at_notice TEXT,
        resolution_notified_at TEXT,
        resolution_notified_case_updated_at TEXT,
        closed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX idx_report_cases_target_open
        ON report_cases(target_entity_type, target_entity_id)
        WHERE status IN ('open', 'under_review');
      CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        reporter_user_id INTEGER NOT NULL,
        reason_code TEXT NOT NULL,
        details TEXT,
        status TEXT NOT NULL,
        evidence_summary_json TEXT NOT NULL DEFAULT '{}',
        normalized_payload_hash TEXT NOT NULL,
        target_name_snapshot TEXT NOT NULL,
        target_description_snapshot TEXT,
        target_data_snapshot TEXT NOT NULL,
        target_updated_at_snapshot TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        withdrawn_at TEXT
      );
      CREATE UNIQUE INDEX idx_reports_case_reporter_active
        ON reports(case_id, reporter_user_id)
        WHERE status = 'active';
      CREATE TABLE report_submission_events (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        report_id TEXT NOT NULL,
        reporter_user_id INTEGER NOT NULL,
        submission_decision TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_report_submission_events_reporter_created_at
        ON report_submission_events(reporter_user_id, created_at DESC);
      CREATE TABLE report_references (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL,
        reference_type TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        label_snapshot TEXT NOT NULL,
        url_snapshot TEXT,
        note TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX idx_report_references_report_target_unique
        ON report_references(report_id, reference_type, reference_id);
      CREATE TABLE crowd_review_rounds (
        id TEXT PRIMARY KEY,
        report_case_id TEXT NOT NULL,
        status TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        deadline_at TEXT NOT NULL,
        extension_count INTEGER NOT NULL DEFAULT 0,
        min_valid_votes INTEGER NOT NULL,
        result_code TEXT,
        result_summary_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_crowd_review_rounds_report_case_active
        ON crowd_review_rounds(report_case_id)
        WHERE status IN ('pending_dispatch', 'active', 'waiting_more_votes');
      INSERT INTO users (id, username, email) VALUES
        (2, 'creator', 'creator@example.test'),
        (7, 'reporter', 'reporter@example.test');
      INSERT INTO data_cards (id, user_id, type, name, description, data, is_public, review_status, updated_at)
        VALUES ('card-1', 2, 'character', '公开卡', '描述', '{"name":"公开卡"}', 1, 'approved', '2026-04-08T10:00:00.000Z');
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  test('creates one open case per public data card and finds it by target', async () => {
    await createReportCaseFixture();

    const row = await getOpenReportCaseByTarget(db, {
      targetEntityType: 'data_card',
      targetEntityId: 'card-1',
    });

    expect(row).toMatchObject({
      id: 'case-1',
      targetEntityId: 'card-1',
      status: 'open',
    });
  });

  test('active reporter unique index allows only one active report per case and reporter', async () => {
    await createReportCaseFixture();
    await createReportFixture();

    const updated = await updateActiveReportForReporter(db, {
      caseId: 'case-1',
      reporterUserId: 7,
      reasonCode: 'rule_violation_other',
      details: '修订说明',
      evidenceSummaryJson: '{}',
      normalizedPayloadHash: 'hash-b',
      targetNameSnapshot: '公开卡',
      targetDescriptionSnapshot: '描述',
      targetDataSnapshot: '{"name":"公开卡"}',
      targetUpdatedAtSnapshot: '2026-04-08T10:00:00.000Z',
      now: '2026-04-08T10:30:00.000Z',
    });
    const active = await getActiveReportByCaseAndReporter(db, {
      caseId: 'case-1',
      reporterUserId: 7,
    });

    expect(updated?.id).toBe('report-1');
    expect(active?.normalizedPayloadHash).toBe('hash-b');
  });

  test('replaces report references with unique normalized references', async () => {
    await createReportCaseFixture();
    await createReportFixture();

    await replaceReportReferences(db, {
      reportId: 'report-1',
      references: [
        {
          id: 'ref-1',
          referenceType: 'encyclopedia_entry',
          referenceId: 'community-rules',
          labelSnapshot: '社区守则',
          urlSnapshot: '/encyclopedia/community-rules',
          note: '第一次',
          sortOrder: 0,
        },
        {
          id: 'ref-2',
          referenceType: 'public_data_card',
          referenceId: 'card-2',
          labelSnapshot: '对照卡',
          urlSnapshot: '/character-manager',
          note: '对照',
          sortOrder: 1,
        },
      ],
    });

    const rows = await listReportReferencesByReport(db, 'report-1');

    expect(rows.map((row) => [row.referenceType, row.referenceId, row.sortOrder])).toEqual([
      ['encyclopedia_entry', 'community-rules', 0],
      ['public_data_card', 'card-2', 1],
    ]);
  });

  test('createReportWithReferencesIfCaseEditable blocks writes once the case has an active crowd review round', async () => {
    await createReportCaseFixture();
    exec(`
      INSERT INTO crowd_review_rounds (
        id, report_case_id, status, opened_at, deadline_at, extension_count, min_valid_votes, result_code, result_summary_json, created_at, updated_at
      ) VALUES (
        'round-1', 'case-1', 'active', '2026-04-08T10:21:00.000Z', '2026-04-08T11:21:00.000Z', 0, 3, NULL, '{}', '2026-04-08T10:21:00.000Z', '2026-04-08T10:21:00.000Z'
      );
    `);

    const created = await createReportWithReferencesIfCaseEditable(db, {
      id: 'report-1',
      caseId: 'case-1',
      reporterUserId: 7,
      reasonCode: 'plagiarism',
      details: '冻结后不应成功',
      evidenceSummaryJson: '{}',
      normalizedPayloadHash: 'hash-blocked',
      targetNameSnapshot: '公开卡',
      targetDescriptionSnapshot: '描述',
      targetDataSnapshot: '{"name":"公开卡"}',
      targetUpdatedAtSnapshot: '2026-04-08T10:00:00.000Z',
      now: '2026-04-08T10:21:00.000Z',
      references: [
        {
          id: 'ref-1',
          referenceType: 'encyclopedia_entry',
          referenceId: 'community-rules',
          labelSnapshot: '社区守则',
          urlSnapshot: '/encyclopedia/community-rules',
          note: null,
          sortOrder: 0,
        },
      ],
    });

    expect(created).toBeNull();
    expect(
      await getActiveReportByCaseAndReporter(db, {
        caseId: 'case-1',
        reporterUserId: 7,
      }),
    ).toBeNull();
  });

  test('updateActiveReportForReporterWithReferencesIfCaseEditable atomically updates report and references', async () => {
    await createReportCaseFixture();
    await createReportFixture();
    await replaceReportReferences(db, {
      reportId: 'report-1',
      references: [
        {
          id: 'ref-old',
          referenceType: 'encyclopedia_entry',
          referenceId: 'old-entry',
          labelSnapshot: '旧引用',
          urlSnapshot: '/encyclopedia/old-entry',
          note: '旧',
          sortOrder: 0,
        },
      ],
    });

    const updated = await updateActiveReportForReporterWithReferencesIfCaseEditable(db, {
      caseId: 'case-1',
      reporterUserId: 7,
      reasonCode: 'rule_violation_other',
      details: '修订说明',
      evidenceSummaryJson: '{"reasonLabels":["其他违规"]}',
      normalizedPayloadHash: 'hash-b',
      targetNameSnapshot: '公开卡',
      targetDescriptionSnapshot: '描述',
      targetDataSnapshot: '{"name":"公开卡"}',
      targetUpdatedAtSnapshot: '2026-04-08T10:30:00.000Z',
      now: '2026-04-08T10:30:00.000Z',
      references: [
        {
          id: 'ref-new-1',
          referenceType: 'encyclopedia_entry',
          referenceId: 'community-rules',
          labelSnapshot: '社区守则',
          urlSnapshot: '/encyclopedia/community-rules',
          note: '第一条',
          sortOrder: 0,
        },
        {
          id: 'ref-new-2',
          referenceType: 'public_data_card',
          referenceId: 'card-2',
          labelSnapshot: '对照卡',
          urlSnapshot: '/character-manager?dataCardId=card-2',
          note: '第二条',
          sortOrder: 1,
        },
      ],
    });

    const references = await listReportReferencesByReport(db, 'report-1');

    expect(updated?.details).toBe('修订说明');
    expect(updated?.normalizedPayloadHash).toBe('hash-b');
    expect(references.map((row) => row.referenceId)).toEqual(['community-rules', 'card-2']);
    expect(references.map((row) => row.note)).toEqual(['第一条', '第二条']);
  });

  test('replaceReportReferencesIfCaseEditable refuses to mutate references once the case has an active crowd review round', async () => {
    await createReportCaseFixture();
    await createReportFixture();
    await replaceReportReferences(db, {
      reportId: 'report-1',
      references: [
        {
          id: 'ref-old',
          referenceType: 'encyclopedia_entry',
          referenceId: 'old-entry',
          labelSnapshot: '旧引用',
          urlSnapshot: '/encyclopedia/old-entry',
          note: '旧',
          sortOrder: 0,
        },
      ],
    });
    exec(`
      INSERT INTO crowd_review_rounds (
        id, report_case_id, status, opened_at, deadline_at, extension_count, min_valid_votes, result_code, result_summary_json, created_at, updated_at
      ) VALUES (
        'round-1', 'case-1', 'waiting_more_votes', '2026-04-08T10:31:00.000Z', '2026-04-08T11:31:00.000Z', 0, 3, NULL, '{}', '2026-04-08T10:31:00.000Z', '2026-04-08T10:31:00.000Z'
      );
    `);

    const replaced = await replaceReportReferencesIfCaseEditable(db, {
      caseId: 'case-1',
      reportId: 'report-1',
      references: [
        {
          id: 'ref-new',
          referenceType: 'encyclopedia_entry',
          referenceId: 'community-rules',
          labelSnapshot: '社区守则',
          urlSnapshot: '/encyclopedia/community-rules',
          note: '新',
          sortOrder: 0,
        },
      ],
    });

    const rows = await listReportReferencesByReport(db, 'report-1');
    expect(replaced).toBe(false);
    expect(rows.map((row) => row.referenceId)).toEqual(['old-entry']);
  });

  test('counts immutable submission events by reporter and window', async () => {
    await createReportCaseFixture();
    await createReportFixture();

    await createReportSubmissionEvent(db, {
      id: 'event-1',
      caseId: 'case-1',
      reportId: 'report-1',
      reporterUserId: 7,
      submissionDecision: 'created',
      now: '2026-04-08T09:40:00.000Z',
    });
    await createReportSubmissionEvent(db, {
      id: 'event-2',
      caseId: 'case-1',
      reportId: 'report-1',
      reporterUserId: 7,
      submissionDecision: 'updated',
      now: '2026-04-08T10:10:00.000Z',
    });

    const countSinceHour = await countReportSubmissionEventsByReporterSince(db, {
      reporterUserId: 7,
      since: '2026-04-08T09:30:00.000Z',
    });
    const countSinceTen = await countReportSubmissionEventsByReporterSince(db, {
      reporterUserId: 7,
      since: '2026-04-08T10:00:00.000Z',
    });

    expect(countSinceHour).toBe(2);
    expect(countSinceTen).toBe(1);
  });

  test('createReportSubmissionEvent is idempotent for the same logical submission event id', async () => {
    await createReportCaseFixture();
    await createReportFixture();

    const first = await createReportSubmissionEvent(db, {
      id: 'submission:report-1:created:2026-04-08T10:20:00.000Z:hash-a',
      caseId: 'case-1',
      reportId: 'report-1',
      reporterUserId: 7,
      submissionDecision: 'created',
      now,
    });
    const second = await createReportSubmissionEvent(db, {
      id: 'submission:report-1:created:2026-04-08T10:20:00.000Z:hash-a',
      caseId: 'case-1',
      reportId: 'report-1',
      reporterUserId: 7,
      submissionDecision: 'created',
      now,
    });
    const count = await countReportSubmissionEventsByReporterSince(db, {
      reporterUserId: 7,
      since: '2026-04-08T10:00:00.000Z',
    });

    expect(second).toEqual(first);
    expect(count).toBe(1);
  });

  test('returns the latest submission event for a report', async () => {
    await createReportCaseFixture();
    await createReportFixture();

    await createReportSubmissionEvent(db, {
      id: 'event-1',
      caseId: 'case-1',
      reportId: 'report-1',
      reporterUserId: 7,
      submissionDecision: 'created',
      now: '2026-04-08T09:40:00.000Z',
    });
    await createReportSubmissionEvent(db, {
      id: 'event-2',
      caseId: 'case-1',
      reportId: 'report-1',
      reporterUserId: 7,
      submissionDecision: 'updated',
      now: '2026-04-08T10:10:00.000Z',
    });

    const latestEvent = await getLatestReportSubmissionEventByReport(db, 'report-1');

    expect(latestEvent).toMatchObject({
      id: 'event-2',
      reportId: 'report-1',
      submissionDecision: 'updated',
      createdAt: '2026-04-08T10:10:00.000Z',
    });
  });

  test('markReportCaseCreatorNotified stores the active report count at claim time', async () => {
    await createReportCaseFixture();
    await createReportFixture();
    await createReport(db, {
      id: 'report-2',
      caseId: 'case-1',
      reporterUserId: 8,
      reasonCode: 'harassment_or_hate',
      details: '并发举报',
      evidenceSummaryJson: '{}',
      normalizedPayloadHash: 'hash-b',
      targetNameSnapshot: '公开卡',
      targetDescriptionSnapshot: '描述',
      targetDataSnapshot: '{"name":"公开卡"}',
      targetUpdatedAtSnapshot: '2026-04-08T10:00:00.000Z',
      now: '2026-04-08T10:21:00.000Z',
    });

    const claimed = await markReportCaseCreatorNotified(db, {
      caseId: 'case-1',
      notifiedAt: '2026-04-08T10:22:00.000Z',
      reportCount: 1,
      targetCardUpdatedAtAtNotice: '2026-04-08T10:00:00.000Z',
    });
    const row = await getOpenReportCaseByTarget(db, {
      targetEntityType: 'data_card',
      targetEntityId: 'card-1',
    });

    expect(claimed).toBe(true);
    expect(row?.creatorNotifiedAt).toBe('2026-04-08T10:22:00.000Z');
    expect(row?.creatorNotifiedReportCount).toBe(2);
  });

  test('withdrawActiveReportAndMaybeDismissCaseIfEditable withdraws the last active report and dismisses the case', async () => {
    await createReportCaseFixture();
    await createReportFixture();

    const result = await withdrawActiveReportAndMaybeDismissCaseIfEditable(db, {
      caseId: 'case-1',
      reporterUserId: 7,
      now: '2026-04-08T10:35:00.000Z',
    });

    const report = await getActiveReportByCaseAndReporter(db, {
      caseId: 'case-1',
      reporterUserId: 7,
    });
    const caseRow = await db.query.reportCases.findFirst({
      where: (fields, { eq }) => eq(fields.id, 'case-1'),
    });

    expect(result).toEqual({ withdrawn: true, caseDismissed: true });
    expect(report).toBeNull();
    expect(caseRow?.status).toBe('dismissed');
  });

  test('withdrawActiveReportAndMaybeDismissCaseIfEditable blocks withdrawal once the case has an active crowd review round', async () => {
    await createReportCaseFixture();
    await createReportFixture();
    exec(`
      INSERT INTO crowd_review_rounds (
        id, report_case_id, status, opened_at, deadline_at, extension_count, min_valid_votes, result_code, result_summary_json, created_at, updated_at
      ) VALUES (
        'round-1', 'case-1', 'pending_dispatch', '2026-04-08T10:35:00.000Z', '2026-04-08T11:35:00.000Z', 0, 3, NULL, '{}', '2026-04-08T10:35:00.000Z', '2026-04-08T10:35:00.000Z'
      );
    `);

    const result = await withdrawActiveReportAndMaybeDismissCaseIfEditable(db, {
      caseId: 'case-1',
      reporterUserId: 7,
      now: '2026-04-08T10:36:00.000Z',
    });

    const report = await getActiveReportByCaseAndReporter(db, {
      caseId: 'case-1',
      reporterUserId: 7,
    });
    const caseRow = await db.query.reportCases.findFirst({
      where: (fields, { eq }) => eq(fields.id, 'case-1'),
    });

    expect(result).toEqual({ withdrawn: false, caseDismissed: false });
    expect(report?.status).toBe('active');
    expect(caseRow?.status).toBe('open');
  });
});
