import { describe, expect, test } from 'bun:test';

import {
  createCrowdReviewServiceForTests,
  CrowdReviewConflictError,
} from '@/lib/crowd-review/service';

const now = '2026-04-08T12:00:00.000Z';

const makeCurrentCase = (overrides: Record<string, unknown> = {}) => ({
  assignmentId: 'assignment-1',
  assignmentStatus: 'assigned',
  assignedAt: '2026-04-08T11:30:00.000Z',
  expiresAt: '2026-04-08T12:30:00.000Z',
  caseId: 'round-1',
  reportCaseId: 'case-1',
  targetEntityType: 'data_card',
  targetEntityId: 'card-1',
  targetSnapshot: { name: '公开卡', description: '描述' },
  reportSummary: {
    reasonLabels: ['疑似抄袭'],
    details: ['文本高度近似'],
    references: ['引用公开数据卡：对照卡'],
  },
  ruleHints: ['投票前不会展示票况'],
  availableDecisions: ['violation', 'no_violation', 'abstain'],
  postVoteSummary: null,
  ...overrides,
});

const makeAssignmentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'assignment-1',
  crowdReviewRoundId: 'round-1',
  inspectorUserId: 7,
  status: 'assigned',
  assignedAt: '2026-04-08T11:30:00.000Z',
  expiresAt: '2026-04-08T12:30:00.000Z',
  completedAt: null,
  decision: null,
  decisionNote: null,
  postVoteSummaryJson: '{}',
  postVoteSummarySeenAt: null,
  createdAt: '2026-04-08T11:30:00.000Z',
  updatedAt: '2026-04-08T11:30:00.000Z',
  reportCaseId: 'case-1',
  targetEntityId: 'card-1',
  targetSnapshotName: '公开卡',
  targetSnapshotDescription: '描述',
  reasonLabels: ['疑似抄袭'],
  detailPreviews: ['文本高度近似'],
  referenceSummary: ['引用公开数据卡：对照卡'],
  roundStatus: 'active',
  roundDeadlineAt: '2026-04-08T12:30:00.000Z',
  roundMinValidVotes: 3,
  roundExtensionCount: 0,
  roundResultCode: null,
  ...overrides,
});

const makeRoundRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'round-1',
  reportCaseId: 'case-1',
  status: 'active',
  openedAt: '2026-04-08T11:00:00.000Z',
  deadlineAt: '2026-04-08T11:59:00.000Z',
  extensionCount: 0,
  minValidVotes: 2,
  resultCode: null,
  resultSummaryJson: '{}',
  createdAt: '2026-04-08T11:00:00.000Z',
  updatedAt: '2026-04-08T11:00:00.000Z',
  ...overrides,
});

const buildService = (
  overrides: Parameters<typeof createCrowdReviewServiceForTests>[0] = {},
) =>
  createCrowdReviewServiceForTests({
    now: () => now,
    idFactory: (() => {
      let index = 0;
      return () => `generated-${++index}`;
    })(),
    hasInspectorBadge: async () => true,
    repo: {
      getInspectorState: async () => ({
        userId: 7,
        status: 'active',
        suspendedUntil: null,
        statusReasonCode: null,
        statusReasonDetail: null,
        updatedByUserId: 1,
        createdAt: now,
        updatedAt: now,
      }),
      getActiveAssignmentByInspector: async () => null,
      listAssignableCases: async () => [],
      createCrowdReviewRound: async () => makeRoundRow(),
      createCrowdReviewAssignment: async () => makeAssignmentRow(),
      getAssignmentByIdForInspector: async () => makeAssignmentRow(),
      getRoundById: async () => makeRoundRow(),
      listAssignmentsByRound: async () => [],
      finalizeAssignment: async () => true,
      updateAssignmentPostVoteSummary: async () => true,
      updateRound: async () => true,
      updateReportCaseResolution: async () => true,
      listCrowdReviewHistoryByInspector: async () => [],
      advanceExpiredState: async () => undefined,
    },
    ...overrides,
    repo: {
      getInspectorState: async () => ({
        userId: 7,
        status: 'active',
        suspendedUntil: null,
        statusReasonCode: null,
        statusReasonDetail: null,
        updatedByUserId: 1,
        createdAt: now,
        updatedAt: now,
      }),
      getActiveAssignmentByInspector: async () => null,
      listAssignableCases: async () => [],
      createCrowdReviewRound: async () => makeRoundRow(),
      createCrowdReviewAssignment: async () => makeAssignmentRow(),
      getAssignmentByIdForInspector: async () => makeAssignmentRow(),
      getRoundById: async () => makeRoundRow(),
      listAssignmentsByRound: async () => [],
      finalizeAssignment: async () => true,
      updateAssignmentPostVoteSummary: async () => true,
      updateRound: async () => true,
      updateReportCaseResolution: async () => true,
      listCrowdReviewHistoryByInspector: async () => [],
      advanceExpiredState: async () => undefined,
      ...(overrides.repo ?? {}),
    },
  });

describe('crowd review service', () => {
  test('summary reports ineligible when user lacks inspector badge even if authenticated', async () => {
    const service = buildService({
      hasInspectorBadge: async () => false,
      repo: {
        getInspectorState: async () => {
          throw new Error('should not read inspector state without badge');
        },
      },
    });

    const summary = await service.getCrowdReviewSummary({ db: {} as never, userId: 7 });

    expect(summary).toMatchObject({
      eligible: false,
      inspectorStatus: 'ineligible',
      hasCurrentAssignment: false,
      hasCrowdReviewPending: false,
    });
  });

  test('summary reports suspended inspector with reason and no current-case action', async () => {
    const service = buildService({
      repo: {
        getInspectorState: async () => ({
          userId: 7,
          status: 'suspended',
          suspendedUntil: '2026-04-10T00:00:00.000Z',
          statusReasonCode: 'cooldown',
          statusReasonDetail: '等待人工复核',
          updatedByUserId: 1,
          createdAt: now,
          updatedAt: now,
        }),
      },
    });

    const summary = await service.getCrowdReviewSummary({ db: {} as never, userId: 7 });

    expect(summary).toMatchObject({
      eligible: false,
      inspectorStatus: 'suspended',
      hasCurrentAssignment: false,
      hasCrowdReviewPending: false,
    });
    expect(summary.statusReason).toContain('等待人工复核');
  });

  test('assign returns existing current assignment before creating a new one', async () => {
    let createAssignmentCalled = false;
    const service = buildService({
      repo: {
        getActiveAssignmentByInspector: async () => makeAssignmentRow(),
        createCrowdReviewAssignment: async () => {
          createAssignmentCalled = true;
          return makeAssignmentRow({ id: 'assignment-2' });
        },
      },
    });

    const result = await service.assignCrowdReviewCurrentCase({ db: {} as never, userId: 7 });

    expect(result.createdNewAssignment).toBe(false);
    expect(result.currentCase.assignmentId).toBe('assignment-1');
    expect(createAssignmentCalled).toBe(false);
  });

  test('assign skips reporter, target author, and already-assigned inspectors', async () => {
    const service = buildService({
      repo: {
        listAssignableCases: async () => [
          {
            reportCaseId: 'case-reporter',
            targetEntityId: 'card-r',
            targetUserId: 9,
            reporterUserIds: [7],
            assignedInspectorUserIds: [],
            existingRoundId: null,
          },
          {
            reportCaseId: 'case-target',
            targetEntityId: 'card-t',
            targetUserId: 7,
            reporterUserIds: [10],
            assignedInspectorUserIds: [],
            existingRoundId: null,
          },
          {
            reportCaseId: 'case-dup',
            targetEntityId: 'card-d',
            targetUserId: 11,
            reporterUserIds: [10],
            assignedInspectorUserIds: [7],
            existingRoundId: 'round-existing',
          },
          {
            reportCaseId: 'case-good',
            targetEntityId: 'card-good',
            targetUserId: 12,
            reporterUserIds: [10],
            assignedInspectorUserIds: [],
            existingRoundId: null,
          },
        ],
        createCrowdReviewRound: async (db, input) => makeRoundRow({ id: input.id, reportCaseId: input.reportCaseId }),
        createCrowdReviewAssignment: async (db, input) =>
          makeAssignmentRow({ id: input.id, crowdReviewRoundId: input.crowdReviewRoundId, reportCaseId: 'case-good' }),
      },
    });

    const result = await service.assignCrowdReviewCurrentCase({ db: {} as never, userId: 7 });

    expect(result.createdNewAssignment).toBe(true);
    expect(result.currentCase.reportCaseId).toBe('case-good');
  });

  test('submit finalizes assignment and returns post-vote summary without exposing pre-vote tallies', async () => {
    const service = buildService({
      repo: {
        getAssignmentByIdForInspector: async () => makeAssignmentRow(),
        getRoundById: async () => makeRoundRow({ deadlineAt: '2026-04-08T13:00:00.000Z' }),
        listAssignmentsByRound: async () => [
          makeAssignmentRow({ id: 'assignment-1', status: 'voted', decision: 'violation' }),
          makeAssignmentRow({ id: 'assignment-2', status: 'assigned', inspectorUserId: 8 }),
        ],
        finalizeAssignment: async () => true,
      },
    });

    const result = await service.submitCrowdReviewDecision({
      db: {} as never,
      userId: 7,
      assignmentId: 'assignment-1',
      decision: 'violation',
      note: null,
    });

    expect(result.assignmentStatus).toBe('voted');
    expect(result.postVoteSummary.summaryText.length).toBeGreaterThan(0);
    expect('preVoteTally' in (result as unknown as Record<string, unknown>)).toBe(false);
  });

  test('concluded violation round writes report case to resolved confirmed_violation', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const service = buildService({
      repo: {
        getAssignmentByIdForInspector: async () => makeAssignmentRow(),
        getRoundById: async () => makeRoundRow(),
        listAssignmentsByRound: async () => [
          makeAssignmentRow({ id: 'assignment-1', status: 'voted', decision: 'violation' }),
          makeAssignmentRow({ id: 'assignment-2', status: 'voted', decision: 'violation', inspectorUserId: 8 }),
        ],
        finalizeAssignment: async () => true,
        updateRound: async (_db, input) => {
          writes.push({ type: 'round', ...input });
          return true;
        },
        updateReportCaseResolution: async (_db, input) => {
          writes.push({ type: 'reportCase', ...input });
          return true;
        },
      },
    });

    await service.submitCrowdReviewDecision({
      db: {} as never,
      userId: 7,
      assignmentId: 'assignment-1',
      decision: 'violation',
      note: null,
    });

    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'reportCase',
        status: 'resolved',
        resolutionCode: 'confirmed_violation',
      }),
    );
  });

  test('concluded no_violation round writes report case to dismissed no_violation', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const service = buildService({
      repo: {
        getAssignmentByIdForInspector: async () => makeAssignmentRow(),
        getRoundById: async () => makeRoundRow(),
        listAssignmentsByRound: async () => [
          makeAssignmentRow({ id: 'assignment-1', status: 'voted', decision: 'no_violation' }),
          makeAssignmentRow({ id: 'assignment-2', status: 'voted', decision: 'no_violation', inspectorUserId: 8 }),
        ],
        finalizeAssignment: async () => true,
        updateRound: async (_db, input) => {
          writes.push({ type: 'round', ...input });
          return true;
        },
        updateReportCaseResolution: async (_db, input) => {
          writes.push({ type: 'reportCase', ...input });
          return true;
        },
      },
    });

    await service.submitCrowdReviewDecision({
      db: {} as never,
      userId: 7,
      assignmentId: 'assignment-1',
      decision: 'no_violation',
      note: null,
    });

    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'reportCase',
        status: 'dismissed',
        resolutionCode: 'no_violation',
      }),
    );
  });

  test('tie after first deadline extends once and second tie escalates to under_review', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const service = buildService({
      repo: {
        getAssignmentByIdForInspector: async (_db, input) =>
          input.assignmentId === 'assignment-3'
            ? makeAssignmentRow({ id: 'assignment-3', crowdReviewRoundId: 'round-2' })
            : makeAssignmentRow(),
        getRoundById: async (_db, roundId) =>
          roundId === 'round-2'
            ? makeRoundRow({ id: 'round-2', extensionCount: 1 })
            : makeRoundRow({ id: roundId }),
        listAssignmentsByRound: async (_db, roundId) =>
          roundId === 'round-2'
            ? [
                makeAssignmentRow({ id: 'assignment-3', crowdReviewRoundId: 'round-2', status: 'voted', decision: 'violation' }),
                makeAssignmentRow({ id: 'assignment-4', crowdReviewRoundId: 'round-2', status: 'voted', decision: 'no_violation', inspectorUserId: 8 }),
              ]
            : [
                makeAssignmentRow({ id: 'assignment-1', status: 'voted', decision: 'violation' }),
                makeAssignmentRow({ id: 'assignment-2', status: 'voted', decision: 'no_violation', inspectorUserId: 8 }),
              ],
        finalizeAssignment: async () => true,
        updateRound: async (_db, input) => {
          writes.push(input);
          return true;
        },
        updateReportCaseResolution: async (_db, input) => {
          writes.push({ type: 'reportCase', ...input });
          return true;
        },
      },
    });

    await service.submitCrowdReviewDecision({
      db: {} as never,
      userId: 7,
      assignmentId: 'assignment-1',
      decision: 'violation',
      note: null,
    });
    await service.submitCrowdReviewDecision({
      db: {} as never,
      userId: 7,
      assignmentId: 'assignment-3',
      decision: 'violation',
      note: null,
    });

    expect(writes).toContainEqual(expect.objectContaining({ status: 'waiting_more_votes', extensionCount: 1 }));
    expect(writes).toContainEqual(expect.objectContaining({ status: 'escalated', resultCode: 'escalated' }));
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'reportCase',
        status: 'under_review',
        resolutionCode: null,
      }),
    );
  });

  test('summary lazily advances expired assignments before reporting pending work', async () => {
    let advanceCalls = 0;
    const service = buildService({
      repo: {
        advanceExpiredState: async () => {
          advanceCalls += 1;
        },
      },
    });

    await service.getCrowdReviewSummary({ db: {} as never, userId: 7 });

    expect(advanceCalls).toBe(1);
  });

  test('summary settles overdue rounds that already reached minimum valid votes', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const service = buildService({
      repo: {
        listExpiredRounds: async () => [
          makeRoundRow({
            id: 'round-expired',
            reportCaseId: 'case-expired',
            deadlineAt: '2026-04-08T11:00:00.000Z',
            minValidVotes: 2,
          }),
        ],
        listAssignmentsByRound: async (_db, roundId) =>
          roundId === 'round-expired'
            ? [
                makeAssignmentRow({
                  id: 'assignment-expired-1',
                  crowdReviewRoundId: 'round-expired',
                  reportCaseId: 'case-expired',
                  status: 'voted',
                  decision: 'violation',
                }),
                makeAssignmentRow({
                  id: 'assignment-expired-2',
                  crowdReviewRoundId: 'round-expired',
                  reportCaseId: 'case-expired',
                  inspectorUserId: 8,
                  status: 'voted',
                  decision: 'violation',
                }),
              ]
            : [],
        updateRound: async (_db, input) => {
          writes.push({ type: 'round', ...input });
          return true;
        },
        updateReportCaseResolution: async (_db, input) => {
          writes.push({ type: 'reportCase', ...input });
          return true;
        },
      } as any,
    });

    await service.getCrowdReviewSummary({ db: {} as never, userId: 7 });

    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'round',
        roundId: 'round-expired',
        status: 'concluded',
        resultCode: 'violation',
      }),
    );
    expect(writes).toContainEqual(
      expect.objectContaining({
        type: 'reportCase',
        reportCaseId: 'case-expired',
        status: 'resolved',
        resolutionCode: 'confirmed_violation',
      }),
    );
  });

  test('summary reports pending work when assignable cases exist without current assignment', async () => {
    const service = buildService({
      repo: {
        getActiveAssignmentByInspector: async () => null,
        listAssignableCases: async () => [
          {
            reportCaseId: 'case-good',
            targetEntityId: 'card-good',
            targetUserId: 12,
            reporterUserIds: [10],
            assignedInspectorUserIds: [],
            existingRoundId: null,
          },
        ],
      },
    });

    const summary = await service.getCrowdReviewSummary({ db: {} as never, userId: 7 });

    expect(summary).toMatchObject({
      eligible: true,
      hasCurrentAssignment: false,
      hasCrowdReviewPending: true,
    });
  });

  test('submit is idempotent when the assignment is already final', async () => {
    let finalizeCalled = false;
    const service = buildService({
      repo: {
        getAssignmentByIdForInspector: async () =>
          makeAssignmentRow({
            status: 'voted',
            decision: 'violation',
            postVoteSummaryJson: '{"summaryText":"已投票"}',
            postVoteSummarySeenAt: now,
          }),
        finalizeAssignment: async () => {
          finalizeCalled = true;
          return true;
        },
      },
    });

    const result = await service.submitCrowdReviewDecision({
      db: {} as never,
      userId: 7,
      assignmentId: 'assignment-1',
      decision: 'violation',
      note: null,
    });

    expect(result.idempotentReplay).toBe(true);
    expect(finalizeCalled).toBe(false);
    expect(result.assignmentStatus).toBe('voted');
  });

  test('submit throws conflict when assignment state changes before finalize succeeds', async () => {
    const service = buildService({
      repo: {
        finalizeAssignment: async () => false,
      },
    });

    await expect(
      service.submitCrowdReviewDecision({
        db: {} as never,
        userId: 7,
        assignmentId: 'assignment-1',
        decision: 'violation',
        note: null,
      }),
    ).rejects.toBeInstanceOf(CrowdReviewConflictError);
  });

  test('assign adopts the concurrent active round after create-round unique conflict', async () => {
    let assignmentRoundId: string | null = null;
    const service = buildService({
      repo: {
        listAssignableCases: async () => [
          {
            reportCaseId: 'case-race',
            targetEntityId: 'card-race',
            targetUserId: 12,
            reporterUserIds: [10],
            assignedInspectorUserIds: [],
            existingRoundId: null,
          },
        ],
        createCrowdReviewRound: async () => {
          throw new Error('UNIQUE constraint failed: crowd_review_rounds.report_case_id');
        },
        getActiveRoundByReportCaseId: async (_db, reportCaseId) =>
          reportCaseId === 'case-race'
            ? makeRoundRow({ id: 'round-race', reportCaseId })
            : null,
        createCrowdReviewAssignment: async (_db, input) => {
          assignmentRoundId = input.crowdReviewRoundId;
          return makeAssignmentRow({
            id: input.id,
            crowdReviewRoundId: input.crowdReviewRoundId,
            reportCaseId: 'case-race',
            targetEntityId: 'card-race',
          });
        },
      } as any,
    });

    const result = await service.assignCrowdReviewCurrentCase({ db: {} as never, userId: 7 });

    expect(result.createdNewAssignment).toBe(true);
    expect(result.currentCase.caseId).toBe('round-race');
    expect(assignmentRoundId).toBe('round-race');
  });

  test('submit persists computed post-vote summary for later idempotent replay', async () => {
    let persistedSummaryJson = '{}';
    let finalized = false;
    const service = buildService({
      repo: {
        getAssignmentByIdForInspector: async () =>
          finalized
            ? makeAssignmentRow({
                status: 'voted',
                decision: 'violation',
                postVoteSummaryJson: persistedSummaryJson,
              })
            : makeAssignmentRow(),
        getRoundById: async () => makeRoundRow({ deadlineAt: '2026-04-08T13:00:00.000Z' }),
        listAssignmentsByRound: async () => [
          makeAssignmentRow({ id: 'assignment-1', status: 'voted', decision: 'violation' }),
          makeAssignmentRow({ id: 'assignment-2', status: 'assigned', inspectorUserId: 8 }),
        ],
        finalizeAssignment: async () => {
          finalized = true;
          return true;
        },
        updateAssignmentPostVoteSummary: async (_db, input) => {
          persistedSummaryJson = input.postVoteSummaryJson;
          return true;
        },
      },
    });

    const first = await service.submitCrowdReviewDecision({
      db: {} as never,
      userId: 7,
      assignmentId: 'assignment-1',
      decision: 'violation',
      note: null,
    });
    const replay = await service.submitCrowdReviewDecision({
      db: {} as never,
      userId: 7,
      assignmentId: 'assignment-1',
      decision: 'violation',
      note: null,
    });

    expect(first.postVoteSummary.summaryText.length).toBeGreaterThan(0);
    expect(JSON.parse(persistedSummaryJson).summaryText).toBe(first.postVoteSummary.summaryText);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.postVoteSummary.summaryText).toBe(first.postVoteSummary.summaryText);
  });
});
