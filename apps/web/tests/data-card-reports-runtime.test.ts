import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as schema from '@/lib/db/schema';

let sqlite: Database;
let db: AppDrizzleDb;

const exec = (sqlText: string) => sqlite.exec(sqlText);

describe('data card reports runtime guardrails', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;

    exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, email TEXT NOT NULL);
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
      CREATE INDEX idx_reports_reporter_status_created
        ON reports(reporter_user_id, status, created_at DESC);
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
      INSERT INTO users (id, username, email) VALUES
        (2, 'creator', 'creator@example.test'),
        (7, 'reporter', 'reporter@example.test');
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  test('production rate limit rejects the fourth effective submission within one hour', async () => {
    exec(`
      INSERT INTO report_cases (
        id, target_entity_type, target_entity_id, target_user_id, status, latest_reported_at, created_at, updated_at
      ) VALUES
        ('case-1', 'data_card', 'card-1', 2, 'open', '2026-04-08T09:40:00.000Z', '2026-04-08T09:40:00.000Z', '2026-04-08T09:40:00.000Z'),
        ('case-2', 'data_card', 'card-2', 2, 'open', '2026-04-08T09:45:00.000Z', '2026-04-08T09:45:00.000Z', '2026-04-08T09:45:00.000Z'),
        ('case-3', 'data_card', 'card-3', 2, 'open', '2026-04-08T09:50:00.000Z', '2026-04-08T09:50:00.000Z', '2026-04-08T09:50:00.000Z');
      INSERT INTO reports (
        id, case_id, reporter_user_id, reason_code, status, evidence_summary_json, normalized_payload_hash,
        target_name_snapshot, target_data_snapshot, created_at, updated_at
      ) VALUES
        ('report-1', 'case-1', 7, 'plagiarism', 'active', '{}', 'hash-1', '卡1', '{}', '2026-04-08T09:40:00.000Z', '2026-04-08T09:40:00.000Z'),
        ('report-2', 'case-2', 7, 'plagiarism', 'active', '{}', 'hash-2', '卡2', '{}', '2026-04-08T09:45:00.000Z', '2026-04-08T09:45:00.000Z'),
        ('report-3', 'case-3', 7, 'plagiarism', 'active', '{}', 'hash-3', '卡3', '{}', '2026-04-08T09:50:00.000Z', '2026-04-08T09:50:00.000Z');
      INSERT INTO report_submission_events (
        id, case_id, report_id, reporter_user_id, submission_decision, created_at
      ) VALUES
        ('event-1', 'case-1', 'report-1', 7, 'created', '2026-04-08T09:40:00.000Z'),
        ('event-2', 'case-2', 'report-2', 7, 'created', '2026-04-08T09:45:00.000Z'),
        ('event-3', 'case-3', 'report-3', 7, 'created', '2026-04-08T09:50:00.000Z');
    `);

    const serviceModule = await import('@/lib/data-card-reports/service');
    const rateLimit = (serviceModule as any).rateLimitDataCardReportSubmission;

    expect(typeof rateLimit).toBe('function');
    await expect(
      rateLimit(db, {
        reporterUserId: 7,
        targetEntityId: 'card-4',
        now: '2026-04-08T10:20:00.000Z',
      }),
    ).resolves.toEqual({ allowed: false });
  });

  test('production rate limit counts repeated updates to the same active report', async () => {
    exec(`
      INSERT INTO report_cases (
        id, target_entity_type, target_entity_id, target_user_id, status, latest_reported_at, created_at, updated_at
      ) VALUES
        ('case-1', 'data_card', 'card-1', 2, 'open', '2026-04-08T10:10:00.000Z', '2026-04-08T09:00:00.000Z', '2026-04-08T10:10:00.000Z');
      INSERT INTO reports (
        id, case_id, reporter_user_id, reason_code, status, evidence_summary_json, normalized_payload_hash,
        target_name_snapshot, target_data_snapshot, created_at, updated_at
      ) VALUES
        ('report-1', 'case-1', 7, 'plagiarism', 'active', '{}', 'hash-1', '卡1', '{}', '2026-04-08T09:00:00.000Z', '2026-04-08T09:00:00.000Z');
      INSERT INTO report_submission_events (
        id, case_id, report_id, reporter_user_id, submission_decision, created_at
      ) VALUES
        ('event-1', 'case-1', 'report-1', 7, 'created', '2026-04-08T09:30:00.000Z'),
        ('event-2', 'case-1', 'report-1', 7, 'updated', '2026-04-08T09:45:00.000Z'),
        ('event-3', 'case-1', 'report-1', 7, 'updated', '2026-04-08T10:10:00.000Z');
    `);

    const serviceModule = await import('@/lib/data-card-reports/service');
    const rateLimit = (serviceModule as any).rateLimitDataCardReportSubmission;

    expect(typeof rateLimit).toBe('function');
    await expect(
      rateLimit(db, {
        reporterUserId: 7,
        targetEntityId: 'card-2',
        now: '2026-04-08T10:20:00.000Z',
      }),
    ).resolves.toEqual({ allowed: false });
  });

  test('production rate limit ignores withdrawals that only bumped report updated_at', async () => {
    exec(`
      INSERT INTO report_cases (
        id, target_entity_type, target_entity_id, target_user_id, status, latest_reported_at, created_at, updated_at
      ) VALUES
        ('case-1', 'data_card', 'card-1', 2, 'dismissed', '2026-04-08T08:00:00.000Z', '2026-04-08T08:00:00.000Z', '2026-04-08T10:00:00.000Z'),
        ('case-2', 'data_card', 'card-2', 2, 'dismissed', '2026-04-08T08:05:00.000Z', '2026-04-08T08:05:00.000Z', '2026-04-08T10:05:00.000Z'),
        ('case-3', 'data_card', 'card-3', 2, 'dismissed', '2026-04-08T08:10:00.000Z', '2026-04-08T08:10:00.000Z', '2026-04-08T10:10:00.000Z');
      INSERT INTO reports (
        id, case_id, reporter_user_id, reason_code, status, evidence_summary_json, normalized_payload_hash,
        target_name_snapshot, target_data_snapshot, created_at, updated_at, withdrawn_at
      ) VALUES
        ('report-1', 'case-1', 7, 'plagiarism', 'withdrawn', '{}', 'hash-1', '卡1', '{}', '2026-04-08T08:00:00.000Z', '2026-04-08T10:00:00.000Z', '2026-04-08T10:00:00.000Z'),
        ('report-2', 'case-2', 7, 'plagiarism', 'withdrawn', '{}', 'hash-2', '卡2', '{}', '2026-04-08T08:05:00.000Z', '2026-04-08T10:05:00.000Z', '2026-04-08T10:05:00.000Z'),
        ('report-3', 'case-3', 7, 'plagiarism', 'withdrawn', '{}', 'hash-3', '卡3', '{}', '2026-04-08T08:10:00.000Z', '2026-04-08T10:10:00.000Z', '2026-04-08T10:10:00.000Z');
    `);

    const serviceModule = await import('@/lib/data-card-reports/service');
    const rateLimit = (serviceModule as any).rateLimitDataCardReportSubmission;

    expect(typeof rateLimit).toBe('function');
    await expect(
      rateLimit(db, {
        reporterUserId: 7,
        targetEntityId: 'card-4',
        now: '2026-04-08T10:20:00.000Z',
      }),
    ).resolves.toEqual({ allowed: true });
  });

  test('production screening rejects rule_violation_other without details', async () => {
    const serviceModule = await import('@/lib/data-card-reports/service');
    const screenSubmission = (serviceModule as any).screenDataCardReportSubmission;

    expect(typeof screenSubmission).toBe('function');
    await expect(
      screenSubmission({
        reporterUserId: 7,
        targetEntityId: 'card-1',
        reasonCode: 'rule_violation_other',
        details: null,
      }),
    ).resolves.toEqual({ allowed: false });
  });
});
