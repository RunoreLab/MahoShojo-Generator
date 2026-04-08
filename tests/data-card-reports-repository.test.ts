import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as schema from '@/lib/db/schema';
import {
  countReportSubmissionEventsByReporterSince,
  createReport,
  createReportCase,
  createReportSubmissionEvent,
  getActiveReportByCaseAndReporter,
  getOpenReportCaseByTarget,
  listReportReferencesByReport,
  replaceReportReferences,
  updateActiveReportForReporter,
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
});
