import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';

import type { AppDrizzleDb } from '@/lib/db/drizzle';
import * as schema from '@/lib/db/schema';
import {
  createCrowdReviewAssignment,
  createCrowdReviewRound,
  getActiveAssignmentByInspector,
  getLatestCompletedAssignmentByInspector,
  getInspectorState,
  listAssignableCases,
  listCrowdReviewHistoryByInspector,
  listActionableAssignmentsByInspector,
  upsertCrowdReviewInspectorState,
} from '@/lib/db/repositories/crowd-review';

let sqlite: Database;
let db: AppDrizzleDb;

const exec = (sqlText: string) => sqlite.exec(sqlText);

describe('crowd review repository', () => {
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
        is_public INTEGER NOT NULL,
        review_status TEXT DEFAULT 'approved',
        deleted_at TEXT,
        created_at TEXT,
        updated_at TEXT
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
      CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        reporter_user_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE crowd_review_inspectors (
        user_id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        suspended_until TEXT,
        status_reason_code TEXT,
        status_reason_detail TEXT,
        updated_by_user_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE inspector_discipline_events (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        reason_code TEXT,
        reason_detail TEXT,
        source_entity_type TEXT,
        source_entity_id TEXT,
        created_by_user_id INTEGER,
        created_at TEXT NOT NULL
      );
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
      CREATE TABLE crowd_review_assignments (
        id TEXT PRIMARY KEY,
        crowd_review_round_id TEXT NOT NULL,
        inspector_user_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        completed_at TEXT,
        decision TEXT,
        decision_note TEXT,
        post_vote_summary_json TEXT NOT NULL DEFAULT '{}',
        post_vote_summary_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_crowd_review_assignments_active_inspector
        ON crowd_review_assignments(inspector_user_id)
        WHERE status = 'assigned';
      CREATE UNIQUE INDEX idx_crowd_review_assignments_round_inspector
        ON crowd_review_assignments(crowd_review_round_id, inspector_user_id);
      INSERT INTO users (id, username, email) VALUES
        (1, 'admin', 'admin@example.test'),
        (2, 'creator', 'creator@example.test'),
        (7, 'inspector-a', 'a@example.test'),
        (8, 'inspector-b', 'b@example.test');
      INSERT INTO report_cases (
        id, target_entity_type, target_entity_id, target_user_id, status, latest_reported_at, created_at, updated_at
      ) VALUES
        ('case-1', 'data_card', 'card-1', 2, 'open', '2026-04-08T10:00:00.000Z', '2026-04-08T10:00:00.000Z', '2026-04-08T10:00:00.000Z'),
        ('case-2', 'data_card', 'card-2', 2, 'open', '2026-04-08T10:05:00.000Z', '2026-04-08T10:05:00.000Z', '2026-04-08T10:05:00.000Z');
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  test('stores inspector state rows and returns active eligibility', async () => {
    await upsertCrowdReviewInspectorState(db, {
      userId: 7,
      status: 'active',
      suspendedUntil: null,
      statusReasonCode: null,
      statusReasonDetail: null,
      updatedByUserId: 1,
      now: '2026-04-08T10:20:00.000Z',
    });

    const row = await getInspectorState(db, 7);

    expect(row).toMatchObject({
      userId: 7,
      status: 'active',
      updatedByUserId: 1,
    });
  });

  test('enforces one active round per report case', async () => {
    await createCrowdReviewRound(db, {
      id: 'round-1',
      reportCaseId: 'case-1',
      status: 'active',
      openedAt: '2026-04-08T10:20:00.000Z',
      deadlineAt: '2026-04-08T11:20:00.000Z',
      extensionCount: 0,
      minValidVotes: 3,
      resultCode: null,
      resultSummaryJson: '{}',
      now: '2026-04-08T10:20:00.000Z',
    });

    await expect(
      createCrowdReviewRound(db, {
        id: 'round-2',
        reportCaseId: 'case-1',
        status: 'pending_dispatch',
        openedAt: '2026-04-08T10:25:00.000Z',
        deadlineAt: '2026-04-08T11:25:00.000Z',
        extensionCount: 0,
        minValidVotes: 3,
        resultCode: null,
        resultSummaryJson: '{}',
        now: '2026-04-08T10:25:00.000Z',
      }),
    ).rejects.toThrow();
  });

  test('createCrowdReviewRound marks the report case as under_review when an active round is opened', async () => {
    await createCrowdReviewRound(db, {
      id: 'round-1',
      reportCaseId: 'case-1',
      status: 'active',
      openedAt: '2026-04-08T10:20:00.000Z',
      deadlineAt: '2026-04-08T11:20:00.000Z',
      extensionCount: 0,
      minValidVotes: 3,
      resultCode: null,
      resultSummaryJson: '{}',
      now: '2026-04-08T10:20:00.000Z',
    });

    const caseRow = await db.query.reportCases.findFirst({
      where: (fields, { eq }) => eq(fields.id, 'case-1'),
    });

    expect(caseRow?.status).toBe('under_review');
    expect(caseRow?.updatedAt).toBe('2026-04-08T10:20:00.000Z');
  });

  test('createCrowdReviewRound rejects dismissed report cases', async () => {
    exec(`
      UPDATE report_cases
      SET status = 'dismissed', updated_at = '2026-04-08T10:18:00.000Z', closed_at = '2026-04-08T10:18:00.000Z'
      WHERE id = 'case-2';
    `);

    await expect(
      createCrowdReviewRound(db, {
        id: 'round-dismissed',
        reportCaseId: 'case-2',
        status: 'pending_dispatch',
        openedAt: '2026-04-08T10:20:00.000Z',
        deadlineAt: '2026-04-08T11:20:00.000Z',
        extensionCount: 0,
        minValidVotes: 3,
        resultCode: null,
        resultSummaryJson: '{}',
        now: '2026-04-08T10:20:00.000Z',
      }),
    ).rejects.toThrow('案件状态已变化');
  });

  test('enforces one active assignment per inspector at a time', async () => {
    await createCrowdReviewRound(db, {
      id: 'round-1',
      reportCaseId: 'case-1',
      status: 'active',
      openedAt: '2026-04-08T10:20:00.000Z',
      deadlineAt: '2026-04-08T11:20:00.000Z',
      extensionCount: 0,
      minValidVotes: 3,
      resultCode: null,
      resultSummaryJson: '{}',
      now: '2026-04-08T10:20:00.000Z',
    });
    await createCrowdReviewRound(db, {
      id: 'round-2',
      reportCaseId: 'case-2',
      status: 'active',
      openedAt: '2026-04-08T10:21:00.000Z',
      deadlineAt: '2026-04-08T11:21:00.000Z',
      extensionCount: 0,
      minValidVotes: 3,
      resultCode: null,
      resultSummaryJson: '{}',
      now: '2026-04-08T10:21:00.000Z',
    });
    await createCrowdReviewAssignment(db, {
      id: 'assignment-1',
      crowdReviewRoundId: 'round-1',
      inspectorUserId: 7,
      status: 'assigned',
      assignedAt: '2026-04-08T10:22:00.000Z',
      expiresAt: '2026-04-08T10:52:00.000Z',
      completedAt: null,
      decision: null,
      decisionNote: null,
      postVoteSummaryJson: '{}',
      postVoteSummarySeenAt: null,
      now: '2026-04-08T10:22:00.000Z',
    });

    await expect(
      createCrowdReviewAssignment(db, {
        id: 'assignment-2',
        crowdReviewRoundId: 'round-2',
        inspectorUserId: 7,
        status: 'assigned',
        assignedAt: '2026-04-08T10:23:00.000Z',
        expiresAt: '2026-04-08T10:53:00.000Z',
        completedAt: null,
        decision: null,
        decisionNote: null,
        postVoteSummaryJson: '{}',
        postVoteSummarySeenAt: null,
        now: '2026-04-08T10:23:00.000Z',
      }),
    ).rejects.toThrow();
  });

  test('enforces one assignment per round and inspector pair', async () => {
    await createCrowdReviewRound(db, {
      id: 'round-1',
      reportCaseId: 'case-1',
      status: 'active',
      openedAt: '2026-04-08T10:20:00.000Z',
      deadlineAt: '2026-04-08T11:20:00.000Z',
      extensionCount: 0,
      minValidVotes: 3,
      resultCode: null,
      resultSummaryJson: '{}',
      now: '2026-04-08T10:20:00.000Z',
    });
    await createCrowdReviewAssignment(db, {
      id: 'assignment-1',
      crowdReviewRoundId: 'round-1',
      inspectorUserId: 7,
      status: 'voted',
      assignedAt: '2026-04-08T10:22:00.000Z',
      expiresAt: '2026-04-08T10:52:00.000Z',
      completedAt: '2026-04-08T10:24:00.000Z',
      decision: 'violation',
      decisionNote: null,
      postVoteSummaryJson: '{}',
      postVoteSummarySeenAt: '2026-04-08T10:24:00.000Z',
      now: '2026-04-08T10:24:00.000Z',
    });

    await expect(
      createCrowdReviewAssignment(db, {
        id: 'assignment-2',
        crowdReviewRoundId: 'round-1',
        inspectorUserId: 7,
        status: 'assigned',
        assignedAt: '2026-04-08T10:25:00.000Z',
        expiresAt: '2026-04-08T10:55:00.000Z',
        completedAt: null,
        decision: null,
        decisionNote: null,
        postVoteSummaryJson: '{}',
        postVoteSummarySeenAt: null,
        now: '2026-04-08T10:25:00.000Z',
      }),
    ).rejects.toThrow();
  });

  test('lists only current assignment rows that are still actionable', async () => {
    await createCrowdReviewRound(db, {
      id: 'round-1',
      reportCaseId: 'case-1',
      status: 'active',
      openedAt: '2026-04-08T10:20:00.000Z',
      deadlineAt: '2026-04-08T11:20:00.000Z',
      extensionCount: 0,
      minValidVotes: 3,
      resultCode: null,
      resultSummaryJson: '{}',
      now: '2026-04-08T10:20:00.000Z',
    });
    await createCrowdReviewRound(db, {
      id: 'round-2',
      reportCaseId: 'case-2',
      status: 'concluded',
      openedAt: '2026-04-08T10:21:00.000Z',
      deadlineAt: '2026-04-08T11:21:00.000Z',
      extensionCount: 0,
      minValidVotes: 3,
      resultCode: 'violation',
      resultSummaryJson: '{}',
      now: '2026-04-08T10:21:00.000Z',
    });
    await createCrowdReviewAssignment(db, {
      id: 'assignment-1',
      crowdReviewRoundId: 'round-1',
      inspectorUserId: 7,
      status: 'assigned',
      assignedAt: '2026-04-08T10:22:00.000Z',
      expiresAt: '2026-04-08T10:52:00.000Z',
      completedAt: null,
      decision: null,
      decisionNote: null,
      postVoteSummaryJson: '{}',
      postVoteSummarySeenAt: null,
      now: '2026-04-08T10:22:00.000Z',
    });
    await createCrowdReviewAssignment(db, {
      id: 'assignment-2',
      crowdReviewRoundId: 'round-2',
      inspectorUserId: 8,
      status: 'voted',
      assignedAt: '2026-04-08T10:23:00.000Z',
      expiresAt: '2026-04-08T10:53:00.000Z',
      completedAt: '2026-04-08T10:24:00.000Z',
      decision: 'no_violation',
      decisionNote: null,
      postVoteSummaryJson: '{}',
      postVoteSummarySeenAt: '2026-04-08T10:24:00.000Z',
      now: '2026-04-08T10:24:00.000Z',
    });

    const active = await getActiveAssignmentByInspector(db, 7);
    const actionable = await listActionableAssignmentsByInspector(db, 7);

    expect(active?.id).toBe('assignment-1');
    expect(actionable.map((row) => row.id)).toEqual(['assignment-1']);
  });

  test('does not return assigned rows from concluded rounds as active assignments', async () => {
    await createCrowdReviewRound(db, {
      id: 'round-closed',
      reportCaseId: 'case-1',
      status: 'concluded',
      openedAt: '2026-04-08T10:20:00.000Z',
      deadlineAt: '2026-04-08T11:20:00.000Z',
      extensionCount: 0,
      minValidVotes: 3,
      resultCode: 'violation',
      resultSummaryJson: '{}',
      now: '2026-04-08T10:20:00.000Z',
    });
    await createCrowdReviewAssignment(db, {
      id: 'assignment-closed',
      crowdReviewRoundId: 'round-closed',
      inspectorUserId: 7,
      status: 'assigned',
      assignedAt: '2026-04-08T10:22:00.000Z',
      expiresAt: '2026-04-08T10:52:00.000Z',
      completedAt: null,
      decision: null,
      decisionNote: null,
      postVoteSummaryJson: '{}',
      postVoteSummarySeenAt: null,
      now: '2026-04-08T10:22:00.000Z',
    });

    const active = await getActiveAssignmentByInspector(db, 7);
    const actionable = await listActionableAssignmentsByInspector(db, 7);

    expect(active).toBeNull();
    expect(actionable).toHaveLength(0);
  });

  test('returns the latest completed assignment for current-case recovery after refresh', async () => {
    await createCrowdReviewRound(db, {
      id: 'round-1',
      reportCaseId: 'case-1',
      status: 'concluded',
      openedAt: '2026-04-08T10:20:00.000Z',
      deadlineAt: '2026-04-08T11:20:00.000Z',
      extensionCount: 0,
      minValidVotes: 3,
      resultCode: 'violation',
      resultSummaryJson: '{}',
      now: '2026-04-08T10:20:00.000Z',
    });
    await createCrowdReviewRound(db, {
      id: 'round-2',
      reportCaseId: 'case-2',
      status: 'concluded',
      openedAt: '2026-04-08T10:21:00.000Z',
      deadlineAt: '2026-04-08T11:21:00.000Z',
      extensionCount: 0,
      minValidVotes: 3,
      resultCode: 'no_violation',
      resultSummaryJson: '{}',
      now: '2026-04-08T10:21:00.000Z',
    });
    await createCrowdReviewAssignment(db, {
      id: 'assignment-1',
      crowdReviewRoundId: 'round-1',
      inspectorUserId: 7,
      status: 'voted',
      assignedAt: '2026-04-08T10:22:00.000Z',
      expiresAt: '2026-04-08T10:52:00.000Z',
      completedAt: '2026-04-08T10:24:00.000Z',
      decision: 'violation',
      decisionNote: null,
      postVoteSummaryJson: '{}',
      postVoteSummarySeenAt: '2026-04-08T10:24:00.000Z',
      now: '2026-04-08T10:24:00.000Z',
    });
    await createCrowdReviewAssignment(db, {
      id: 'assignment-2',
      crowdReviewRoundId: 'round-2',
      inspectorUserId: 7,
      status: 'expired',
      assignedAt: '2026-04-08T10:25:00.000Z',
      expiresAt: '2026-04-08T10:55:00.000Z',
      completedAt: '2026-04-08T10:26:00.000Z',
      decision: null,
      decisionNote: null,
      postVoteSummaryJson: '{}',
      postVoteSummarySeenAt: null,
      now: '2026-04-08T10:26:00.000Z',
    });

    const latestCompleted = await getLatestCompletedAssignmentByInspector(db, 7);

    expect(latestCompleted?.id).toBe('assignment-2');
    expect(latestCompleted?.status).toBe('expired');
  });

  test('history excludes unfinished assigned rows and keeps completed rows ordered newest first', async () => {
    await createCrowdReviewRound(db, {
      id: 'round-active',
      reportCaseId: 'case-1',
      status: 'active',
      openedAt: '2026-04-08T10:20:00.000Z',
      deadlineAt: '2026-04-08T11:20:00.000Z',
      extensionCount: 0,
      minValidVotes: 3,
      resultCode: null,
      resultSummaryJson: '{}',
      now: '2026-04-08T10:20:00.000Z',
    });
    await createCrowdReviewRound(db, {
      id: 'round-completed-a',
      reportCaseId: 'case-2',
      status: 'concluded',
      openedAt: '2026-04-08T10:21:00.000Z',
      deadlineAt: '2026-04-08T11:21:00.000Z',
      extensionCount: 0,
      minValidVotes: 3,
      resultCode: 'violation',
      resultSummaryJson: '{}',
      now: '2026-04-08T10:21:00.000Z',
    });
    await exec(`
      INSERT INTO report_cases (
        id, target_entity_type, target_entity_id, target_user_id, status, latest_reported_at, created_at, updated_at
      ) VALUES (
        'case-3', 'data_card', 'card-3', 2, 'open', '2026-04-08T10:06:00.000Z', '2026-04-08T10:06:00.000Z', '2026-04-08T10:06:00.000Z'
      );
    `);
    await createCrowdReviewRound(db, {
      id: 'round-completed-b',
      reportCaseId: 'case-3',
      status: 'concluded',
      openedAt: '2026-04-08T10:22:00.000Z',
      deadlineAt: '2026-04-08T11:22:00.000Z',
      extensionCount: 0,
      minValidVotes: 3,
      resultCode: 'no_violation',
      resultSummaryJson: '{}',
      now: '2026-04-08T10:22:00.000Z',
    });

    await createCrowdReviewAssignment(db, {
      id: 'assignment-active',
      crowdReviewRoundId: 'round-active',
      inspectorUserId: 7,
      status: 'assigned',
      assignedAt: '2026-04-08T10:23:00.000Z',
      expiresAt: '2026-04-08T10:53:00.000Z',
      completedAt: null,
      decision: null,
      decisionNote: null,
      postVoteSummaryJson: '{}',
      postVoteSummarySeenAt: null,
      now: '2026-04-08T10:23:00.000Z',
    });
    await createCrowdReviewAssignment(db, {
      id: 'assignment-completed-a',
      crowdReviewRoundId: 'round-completed-a',
      inspectorUserId: 7,
      status: 'voted',
      assignedAt: '2026-04-08T10:24:00.000Z',
      expiresAt: '2026-04-08T10:54:00.000Z',
      completedAt: '2026-04-08T10:26:00.000Z',
      decision: 'violation',
      decisionNote: null,
      postVoteSummaryJson: '{}',
      postVoteSummarySeenAt: '2026-04-08T10:26:00.000Z',
      now: '2026-04-08T10:26:00.000Z',
    });
    await createCrowdReviewAssignment(db, {
      id: 'assignment-completed-b',
      crowdReviewRoundId: 'round-completed-b',
      inspectorUserId: 7,
      status: 'expired',
      assignedAt: '2026-04-08T10:25:00.000Z',
      expiresAt: '2026-04-08T10:55:00.000Z',
      completedAt: '2026-04-08T10:27:00.000Z',
      decision: null,
      decisionNote: null,
      postVoteSummaryJson: '{}',
      postVoteSummarySeenAt: null,
      now: '2026-04-08T10:27:00.000Z',
    });

    const history = await listCrowdReviewHistoryByInspector(db, 7, 20);

    expect(history.map((row) => row.assignmentId)).toEqual([
      'assignment-completed-b',
      'assignment-completed-a',
    ]);
    expect(history.every((row) => row.assignmentStatus !== 'assigned')).toBe(true);
  });

  test('listAssignableCases excludes cards that are no longer publicly accessible', async () => {
    exec(`
      INSERT INTO report_cases (
        id, target_entity_type, target_entity_id, target_user_id, status, latest_reported_at, created_at, updated_at
      ) VALUES (
        'case-3', 'data_card', 'card-3', 2, 'under_review', '2026-04-08T10:06:00.000Z', '2026-04-08T10:06:00.000Z', '2026-04-08T10:06:00.000Z'
      );

      INSERT INTO data_cards (
        id, user_id, type, name, description, data, is_public, review_status, deleted_at, created_at, updated_at
      ) VALUES
        ('card-1', 2, 'character', '公开卡', '描述', '{}', 1, 'approved', NULL, '2026-04-08T09:50:00.000Z', '2026-04-08T09:50:00.000Z'),
        ('card-2', 2, 'character', '待审卡', '描述', '{}', 1, 'pending', NULL, '2026-04-08T09:51:00.000Z', '2026-04-08T09:51:00.000Z'),
        ('card-3', 2, 'character', '已删除卡', '描述', '{}', 1, 'approved', '2026-04-08T09:59:00.000Z', '2026-04-08T09:52:00.000Z', '2026-04-08T09:59:00.000Z');

      INSERT INTO reports (id, case_id, reporter_user_id, status, created_at) VALUES
        ('report-1', 'case-1', 9, 'active', '2026-04-08T10:00:00.000Z'),
        ('report-2', 'case-2', 10, 'active', '2026-04-08T10:05:00.000Z'),
        ('report-3', 'case-3', 11, 'active', '2026-04-08T10:06:00.000Z');
    `);

    const cases = await listAssignableCases(db, 7);

    expect(cases.map((row) => row.reportCaseId)).toEqual(['case-1']);
  });
});
