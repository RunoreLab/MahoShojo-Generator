import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as schema from '@/lib/db/schema';
import {
  createReportAppeal,
  getAppealableCaseForUser,
  getLatestNonWithdrawnAppealByCaseSnapshot,
  getReportAppealByIdForAdmin,
  getReportAppealByIdForAppellant,
  getReportCaseForResolutionNotification,
  listReportAppealReferences,
  listReportAppealsByAppellant,
  listReportAppealsForAdmin,
  markReportCaseResolutionNotified,
  replaceReportAppealReferences,
  updateReportAppealResolution,
} from '@/lib/db/repositories/report-appeals';

let sqlite: Database;
let db: AppDrizzleDb;

const now = '2026-04-10T01:30:00.000Z';
const caseUpdatedAtSnapshot = '2026-04-10T01:20:00.000Z';

const exec = (sqlText: string) => sqlite.exec(sqlText);

describe('report appeals repository', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:');
    db = drizzle(sqlite, { schema }) as unknown as AppDrizzleDb;

    exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT NOT NULL
      );
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
        review_status TEXT DEFAULT 'approved',
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
      CREATE TABLE report_appeals (
        id TEXT PRIMARY KEY,
        report_case_id TEXT NOT NULL,
        appellant_user_id INTEGER NOT NULL,
        target_user_id INTEGER NOT NULL,
        target_entity_type TEXT NOT NULL,
        target_entity_id TEXT NOT NULL,
        appeal_reason_code TEXT NOT NULL,
        details TEXT NOT NULL,
        evidence_summary_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        resolution_code TEXT,
        resolution_note TEXT,
        case_status_snapshot TEXT NOT NULL,
        case_resolution_code_snapshot TEXT,
        case_updated_at_snapshot TEXT NOT NULL,
        reviewed_by_user_id INTEGER,
        reviewed_at TEXT,
        withdrawn_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX idx_report_appeals_case_active
        ON report_appeals(report_case_id)
        WHERE status IN ('submitted', 'under_review');
      CREATE UNIQUE INDEX idx_report_appeals_case_snapshot_unique
        ON report_appeals(report_case_id, case_updated_at_snapshot)
        WHERE status IN ('submitted', 'under_review', 'resolved');
      CREATE INDEX idx_report_appeals_appellant_created
        ON report_appeals(appellant_user_id, created_at DESC);
      CREATE TABLE report_appeal_references (
        id TEXT PRIMARY KEY,
        appeal_id TEXT NOT NULL,
        reference_type TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        label_snapshot TEXT NOT NULL,
        url_snapshot TEXT,
        note TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_report_appeal_references_sort
        ON report_appeal_references(appeal_id, sort_order, created_at);
      CREATE UNIQUE INDEX idx_report_appeal_references_target_unique
        ON report_appeal_references(appeal_id, reference_type, reference_id);

      INSERT INTO users (id, username, email) VALUES
        (2, 'creator', 'creator@example.test'),
        (7, 'appellant', 'appellant@example.test');
      INSERT INTO data_cards (id, user_id, type, name, description, data, is_public, review_status, updated_at)
        VALUES ('card-1', 2, 'character', '公开卡', '描述', '{"name":"公开卡"}', 1, 'approved', '${caseUpdatedAtSnapshot}');
      INSERT INTO report_cases (
        id,
        target_entity_type,
        target_entity_id,
        target_user_id,
        status,
        resolution_code,
        latest_reported_at,
        closed_at,
        created_at,
        updated_at
      ) VALUES (
        'case-1',
        'data_card',
        'card-1',
        2,
        'resolved',
        'confirmed_violation',
        '2026-04-10T01:00:00.000Z',
        '2026-04-10T01:20:00.000Z',
        '2026-04-10T01:00:00.000Z',
        '${caseUpdatedAtSnapshot}'
      );
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  test('creates one active appeal per case', async () => {
    await createReportAppeal(db, {
      id: 'appeal-1',
      reportCaseId: 'case-1',
      appellantUserId: 7,
      targetUserId: 2,
      targetEntityType: 'data_card',
      targetEntityId: 'card-1',
      appealReasonCode: 'missing_context',
      details: '补充上下文',
      evidenceSummaryJson: '{}',
      status: 'submitted',
      resolutionCode: null,
      resolutionNote: null,
      caseStatusSnapshot: 'resolved',
      caseResolutionCodeSnapshot: 'confirmed_violation',
      caseUpdatedAtSnapshot,
      reviewedByUserId: null,
      reviewedAt: null,
      withdrawnAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      createReportAppeal(db, {
        id: 'appeal-2',
        reportCaseId: 'case-1',
        appellantUserId: 7,
        targetUserId: 2,
        targetEntityType: 'data_card',
        targetEntityId: 'card-1',
        appealReasonCode: 'other',
        details: '重复提交',
        evidenceSummaryJson: '{}',
        status: 'submitted',
        resolutionCode: null,
        resolutionNote: null,
        caseStatusSnapshot: 'resolved',
        caseResolutionCodeSnapshot: 'confirmed_violation',
        caseUpdatedAtSnapshot: '2026-04-10T01:25:00.000Z',
        reviewedByUserId: null,
        reviewedAt: null,
        withdrawnAt: null,
        createdAt: '2026-04-10T01:31:00.000Z',
        updatedAt: '2026-04-10T01:31:00.000Z',
      }),
    ).rejects.toThrow();
  });

  test('prevents duplicate non-withdrawn appeals for the same case snapshot', async () => {
    await createReportAppeal(db, {
      id: 'appeal-1',
      reportCaseId: 'case-1',
      appellantUserId: 7,
      targetUserId: 2,
      targetEntityType: 'data_card',
      targetEntityId: 'card-1',
      appealReasonCode: 'missing_context',
      details: '补充上下文',
      evidenceSummaryJson: '{}',
      status: 'resolved',
      resolutionCode: 'upheld',
      resolutionNote: '维持原判',
      caseStatusSnapshot: 'resolved',
      caseResolutionCodeSnapshot: 'confirmed_violation',
      caseUpdatedAtSnapshot,
      reviewedByUserId: 2,
      reviewedAt: '2026-04-10T01:40:00.000Z',
      withdrawnAt: null,
      createdAt: now,
      updatedAt: '2026-04-10T01:40:00.000Z',
    });

    await expect(
      createReportAppeal(db, {
        id: 'appeal-2',
        reportCaseId: 'case-1',
        appellantUserId: 7,
        targetUserId: 2,
        targetEntityType: 'data_card',
        targetEntityId: 'card-1',
        appealReasonCode: 'other',
        details: '再次申诉',
        evidenceSummaryJson: '{}',
        status: 'submitted',
        resolutionCode: null,
        resolutionNote: null,
        caseStatusSnapshot: 'resolved',
        caseResolutionCodeSnapshot: 'confirmed_violation',
        caseUpdatedAtSnapshot,
        reviewedByUserId: null,
        reviewedAt: null,
        withdrawnAt: null,
        createdAt: '2026-04-10T01:41:00.000Z',
        updatedAt: '2026-04-10T01:41:00.000Z',
      }),
    ).rejects.toThrow();
  });

  test('lists appeal history by appellant in reverse chronological order', async () => {
    await createReportAppeal(db, {
      id: 'appeal-1',
      reportCaseId: 'case-1',
      appellantUserId: 7,
      targetUserId: 2,
      targetEntityType: 'data_card',
      targetEntityId: 'card-1',
      appealReasonCode: 'missing_context',
      details: '较早申诉',
      evidenceSummaryJson: '{}',
      status: 'withdrawn',
      resolutionCode: null,
      resolutionNote: null,
      caseStatusSnapshot: 'resolved',
      caseResolutionCodeSnapshot: 'confirmed_violation',
      caseUpdatedAtSnapshot: '2026-04-10T01:10:00.000Z',
      reviewedByUserId: null,
      reviewedAt: null,
      withdrawnAt: '2026-04-10T01:12:00.000Z',
      createdAt: '2026-04-10T01:11:00.000Z',
      updatedAt: '2026-04-10T01:12:00.000Z',
    });
    await createReportAppeal(db, {
      id: 'appeal-2',
      reportCaseId: 'case-1',
      appellantUserId: 7,
      targetUserId: 2,
      targetEntityType: 'data_card',
      targetEntityId: 'card-1',
      appealReasonCode: 'other',
      details: '较新申诉',
      evidenceSummaryJson: '{}',
      status: 'submitted',
      resolutionCode: null,
      resolutionNote: null,
      caseStatusSnapshot: 'resolved',
      caseResolutionCodeSnapshot: 'confirmed_violation',
      caseUpdatedAtSnapshot,
      reviewedByUserId: null,
      reviewedAt: null,
      withdrawnAt: null,
      createdAt: '2026-04-10T01:31:00.000Z',
      updatedAt: '2026-04-10T01:31:00.000Z',
    });

    const items = await listReportAppealsByAppellant(db, 7, 10);

    expect(items.map((item) => item.id)).toEqual(['appeal-2', 'appeal-1']);
  });

  test('allows a brand-new appeal after the same snapshot was previously withdrawn', async () => {
    await createReportAppeal(db, {
      id: 'appeal-withdrawn',
      reportCaseId: 'case-1',
      appellantUserId: 7,
      targetUserId: 2,
      targetEntityType: 'data_card',
      targetEntityId: 'card-1',
      appealReasonCode: 'missing_context',
      details: '先撤回',
      evidenceSummaryJson: '{}',
      status: 'withdrawn',
      resolutionCode: null,
      resolutionNote: null,
      caseStatusSnapshot: 'resolved',
      caseResolutionCodeSnapshot: 'confirmed_violation',
      caseUpdatedAtSnapshot,
      reviewedByUserId: null,
      reviewedAt: null,
      withdrawnAt: '2026-04-10T01:31:00.000Z',
      createdAt: now,
      updatedAt: '2026-04-10T01:31:00.000Z',
    });

    const created = await createReportAppeal(db, {
      id: 'appeal-new',
      reportCaseId: 'case-1',
      appellantUserId: 7,
      targetUserId: 2,
      targetEntityType: 'data_card',
      targetEntityId: 'card-1',
      appealReasonCode: 'other',
      details: '重新提交',
      evidenceSummaryJson: '{}',
      status: 'submitted',
      resolutionCode: null,
      resolutionNote: null,
      caseStatusSnapshot: 'resolved',
      caseResolutionCodeSnapshot: 'confirmed_violation',
      caseUpdatedAtSnapshot,
      reviewedByUserId: null,
      reviewedAt: null,
      withdrawnAt: null,
      createdAt: '2026-04-10T01:32:00.000Z',
      updatedAt: '2026-04-10T01:32:00.000Z',
    });

    expect(created.id).toBe('appeal-new');
  });

  test('stores structured appeal references with stable sort order', async () => {
    await createReportAppeal(db, {
      id: 'appeal-1',
      reportCaseId: 'case-1',
      appellantUserId: 7,
      targetUserId: 2,
      targetEntityType: 'data_card',
      targetEntityId: 'card-1',
      appealReasonCode: 'missing_context',
      details: '补充上下文',
      evidenceSummaryJson: '{}',
      status: 'submitted',
      resolutionCode: null,
      resolutionNote: null,
      caseStatusSnapshot: 'resolved',
      caseResolutionCodeSnapshot: 'confirmed_violation',
      caseUpdatedAtSnapshot,
      reviewedByUserId: null,
      reviewedAt: null,
      withdrawnAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await replaceReportAppealReferences(db, {
      appealId: 'appeal-1',
      references: [
        {
          id: 'ref-1',
          referenceType: 'encyclopedia_entry',
          referenceId: 'community-rules',
          labelSnapshot: '社区守则',
          urlSnapshot: '/encyclopedia/community-rules',
          note: '先看这条',
          sortOrder: 0,
          createdAt: now,
        },
        {
          id: 'ref-2',
          referenceType: 'public_data_card',
          referenceId: 'card-2',
          labelSnapshot: '对照卡',
          urlSnapshot: '/character-manager?dataCardId=card-2',
          note: '再看对照卡',
          sortOrder: 1,
          createdAt: now,
        },
      ],
    });

    const rows = await listReportAppealReferences(db, 'appeal-1');

    expect(rows.map((row) => [row.referenceType, row.referenceId, row.sortOrder])).toEqual([
      ['encyclopedia_entry', 'community-rules', 0],
      ['public_data_card', 'card-2', 1],
    ]);
  });

  test('marks report case resolution notification snapshot with compare-and-swap semantics', async () => {
    const first = await markReportCaseResolutionNotified(db, {
      reportCaseId: 'case-1',
      expectedCaseUpdatedAt: caseUpdatedAtSnapshot,
      now,
    });
    const second = await markReportCaseResolutionNotified(db, {
      reportCaseId: 'case-1',
      expectedCaseUpdatedAt: caseUpdatedAtSnapshot,
      now: '2026-04-10T01:32:00.000Z',
    });
    const stale = await markReportCaseResolutionNotified(db, {
      reportCaseId: 'case-1',
      expectedCaseUpdatedAt: '2026-04-10T01:19:59.000Z',
      now: '2026-04-10T01:33:00.000Z',
    });
    const reportCaseRow = sqlite
      .query(
        `
          SELECT resolution_notified_at, resolution_notified_case_updated_at, updated_at
          FROM report_cases
          WHERE id = 'case-1'
        `,
      )
      .get() as {
      resolution_notified_at: string | null;
      resolution_notified_case_updated_at: string | null;
      updated_at: string;
    };
    const existing = await getLatestNonWithdrawnAppealByCaseSnapshot(db, {
      reportCaseId: 'case-1',
      caseUpdatedAtSnapshot,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(stale).toBe(false);
    expect(reportCaseRow.resolution_notified_at).toBe(now);
    expect(reportCaseRow.resolution_notified_case_updated_at).toBe(caseUpdatedAtSnapshot);
    expect(reportCaseRow.updated_at).toBe(caseUpdatedAtSnapshot);
    expect(existing).toBeNull();
  });

  test('updateReportAppealResolution accepts both submitted and under_review as reviewable states', async () => {
    await createReportAppeal(db, {
      id: 'appeal-under-review',
      reportCaseId: 'case-1',
      appellantUserId: 7,
      targetUserId: 2,
      targetEntityType: 'data_card',
      targetEntityId: 'card-1',
      appealReasonCode: 'missing_context',
      details: '人工复核中',
      evidenceSummaryJson: '{}',
      status: 'under_review',
      resolutionCode: null,
      resolutionNote: null,
      caseStatusSnapshot: 'resolved',
      caseResolutionCodeSnapshot: 'confirmed_violation',
      caseUpdatedAtSnapshot,
      reviewedByUserId: null,
      reviewedAt: null,
      withdrawnAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const updated = await updateReportAppealResolution(db, {
      appealId: 'appeal-under-review',
      resolutionCode: 'upheld',
      resolutionNote: '维持原判',
      reviewedByUserId: 2,
      reviewedAt: '2026-04-10T02:05:00.000Z',
      now: '2026-04-10T02:05:00.000Z',
    });

    expect(updated).toBe(true);
  });

  test('keeps an appealable resolved case readable after the target data card row is removed', async () => {
    exec(`DELETE FROM data_cards WHERE id = 'card-1';`);

    const row = await getAppealableCaseForUser(db, {
      reportCaseId: 'case-1',
      userId: 2,
    });

    expect(row).not.toBeNull();
    expect(row?.id).toBe('case-1');
    expect(row?.targetEntityId).toBe('card-1');
    expect(row?.resolutionCode).toBe('confirmed_violation');
  });

  test('keeps appeal history and detail readable after the target data card row is removed', async () => {
    await createReportAppeal(db, {
      id: 'appeal-1',
      reportCaseId: 'case-1',
      appellantUserId: 7,
      targetUserId: 2,
      targetEntityType: 'data_card',
      targetEntityId: 'card-1',
      appealReasonCode: 'missing_context',
      details: '卡片被移除后仍可查看',
      evidenceSummaryJson: '{}',
      status: 'submitted',
      resolutionCode: null,
      resolutionNote: null,
      caseStatusSnapshot: 'resolved',
      caseResolutionCodeSnapshot: 'confirmed_violation',
      caseUpdatedAtSnapshot,
      reviewedByUserId: null,
      reviewedAt: null,
      withdrawnAt: null,
      createdAt: now,
      updatedAt: now,
    });

    exec(`DELETE FROM data_cards WHERE id = 'card-1';`);

    const history = await listReportAppealsByAppellant(db, 7, 10);
    const appellantDetail = await getReportAppealByIdForAppellant(db, {
      appealId: 'appeal-1',
      userId: 7,
    });
    const adminDetail = await getReportAppealByIdForAdmin(db, 'appeal-1');
    const adminList = await listReportAppealsForAdmin(db, {
      limit: 10,
    });

    expect(history.map((item) => item.id)).toEqual(['appeal-1']);
    expect(appellantDetail?.id).toBe('appeal-1');
    expect(adminDetail?.id).toBe('appeal-1');
    expect(adminList.map((item) => item.id)).toEqual(['appeal-1']);
  });

  test('keeps resolution notification context readable after the target data card row is removed', async () => {
    exec(`DELETE FROM data_cards WHERE id = 'card-1';`);

    const row = await getReportCaseForResolutionNotification(db, 'case-1');

    expect(row).not.toBeNull();
    expect(row?.id).toBe('case-1');
    expect(row?.targetEntityId).toBe('card-1');
    expect(row?.targetUserId).toBe(2);
  });
});
