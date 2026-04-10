import { describe, expect, test } from 'bun:test';

import {
  createReportAppealsServiceForTests,
  ReportAppealConflictError,
  ReportAppealForbiddenError,
  ReportAppealUnprocessableError,
  ReportAppealValidationError,
} from '@/lib/report-appeals/service';

const now = '2026-04-10T02:00:00.000Z';

const makeCaseRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'case-1',
  targetEntityType: 'data_card',
  targetEntityId: 'card-1',
  targetUserId: 2,
  status: 'resolved',
  resolutionCode: 'confirmed_violation',
  updatedAt: '2026-04-10T01:20:00.000Z',
  targetCardName: '公开卡',
  ...overrides,
});

const makeAppealRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'appeal-1',
  reportCaseId: 'case-1',
  appellantUserId: 2,
  targetUserId: 2,
  targetEntityType: 'data_card',
  targetEntityId: 'card-1',
  appealReasonCode: 'missing_context',
  details: '补充说明',
  evidenceSummaryJson: '{"references":[]}',
  status: 'submitted',
  resolutionCode: null,
  resolutionNote: null,
  caseStatusSnapshot: 'resolved',
  caseResolutionCodeSnapshot: 'confirmed_violation',
  caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
  reviewedByUserId: null,
  reviewedAt: null,
  withdrawnAt: null,
  createdAt: '2026-04-10T01:30:00.000Z',
  updatedAt: '2026-04-10T01:30:00.000Z',
  currentCaseStatus: 'resolved',
  currentCaseResolutionCode: 'confirmed_violation',
  currentCaseClosedAt: '2026-04-10T01:20:00.000Z',
  currentCaseUpdatedAt: '2026-04-10T01:20:00.000Z',
  ...overrides,
});

const buildService = (
  overrides: Parameters<typeof createReportAppealsServiceForTests>[0] = {},
) =>
  createReportAppealsServiceForTests({
    now: () => now,
    idFactory: (() => {
      let index = 0;
      return () => `appeal-generated-${++index}`;
    })(),
    createUserMessageEntry: async () => ({ id: 1 }),
    ...overrides,
  });

describe('report appeals service', () => {
  test('entry returns eligible appealable case for target owner on resolved confirmed_violation case', async () => {
    const service = buildService({
      repo: {
        getAppealableCaseForUser: async () => makeCaseRow(),
        getLatestNonWithdrawnAppealByCaseSnapshot: async () => null,
      },
    });

    const result = await service.getReportAppealEntry({
      db: {} as never,
      userId: 2,
      reportCaseId: 'case-1',
    });

    expect(result.eligible).toBe(true);
    expect(result.caseResolutionCode).toBe('confirmed_violation');
    expect(result.targetCard?.name).toBe('公开卡');
  });

  test('entry treats content_removed and self_remediated as appealable final outcomes', async () => {
    const service = buildService({
      repo: {
        getAppealableCaseForUser: async (_db, input) =>
          input.reportCaseId === 'case-removed'
            ? makeCaseRow({ id: 'case-removed', resolutionCode: 'content_removed' })
            : makeCaseRow({ id: 'case-fixed', resolutionCode: 'self_remediated' }),
        getLatestNonWithdrawnAppealByCaseSnapshot: async () => null,
      },
    });

    const removed = await service.getReportAppealEntry({
      db: {} as never,
      userId: 2,
      reportCaseId: 'case-removed',
    });
    const fixed = await service.getReportAppealEntry({
      db: {} as never,
      userId: 2,
      reportCaseId: 'case-fixed',
    });

    expect(removed.eligible).toBe(true);
    expect(fixed.eligible).toBe(true);
  });

  test('owner moderation summary omits appeal entry URL for non-appealable cases without active appeal', async () => {
    const service = buildService({
      repo: {
        getAppealableCaseForUser: async () => makeCaseRow({ status: 'under_review', resolutionCode: null }),
        getLatestNonWithdrawnAppealByCaseSnapshot: async () => null,
      },
    });

    const result = await service.getOwnerModerationSummary({
      db: {} as never,
      userId: 2,
      reportCaseId: 'case-1',
    });

    expect(result).not.toBeNull();
    expect(result?.canAppeal).toBe(false);
    expect(result?.appealEntryUrl).toBeNull();
    expect(result?.statusSummary).toContain('暂不可申诉');
  });

  test('owner moderation summary points to appeal detail when an appeal already exists', async () => {
    const service = buildService({
      repo: {
        getAppealableCaseForUser: async () => makeCaseRow(),
        getLatestNonWithdrawnAppealByCaseSnapshot: async () => makeAppealRow(),
      },
    });

    const result = await service.getOwnerModerationSummary({
      db: {} as never,
      userId: 2,
      reportCaseId: 'case-1',
    });

    expect(result).not.toBeNull();
    expect(result?.canAppeal).toBe(false);
    expect(result?.activeAppealId).toBe('appeal-1');
    expect(result?.appealEntryUrl).toBe('/report-appeals?appealId=appeal-1');
  });

  test('submit reuses existing non-withdrawn appeal for the same case snapshot instead of creating a duplicate', async () => {
    let createCalled = false;
    const service = buildService({
      repo: {
        getAppealableCaseForUser: async () => makeCaseRow(),
        getLatestNonWithdrawnAppealByCaseSnapshot: async () => makeAppealRow(),
        createReportAppeal: async () => {
          createCalled = true;
          return makeAppealRow();
        },
      },
    });

    const result = await service.submitReportAppeal({
      db: {} as never,
      userId: 2,
      reportCaseId: 'case-1',
      caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
      appealReasonCode: 'missing_context',
      details: '补充说明',
      references: [],
    });

    expect(result.appealId).toBe('appeal-1');
    expect(createCalled).toBe(false);
  });

  test('submit allows a new record after the same snapshot was previously withdrawn', async () => {
    let createCalled = false;
    const service = buildService({
      repo: {
        getAppealableCaseForUser: async () => makeCaseRow(),
        getLatestNonWithdrawnAppealByCaseSnapshot: async () => null,
        getActiveAppealByCase: async () => null,
        createReportAppeal: async (_db, input) => {
          createCalled = true;
          return makeAppealRow({ id: input.id });
        },
        replaceReportAppealReferences: async () => undefined,
      },
    });

    const result = await service.submitReportAppeal({
      db: {} as never,
      userId: 2,
      reportCaseId: 'case-1',
      caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
      appealReasonCode: 'missing_context',
      details: '补充说明',
      references: [],
    });

    expect(createCalled).toBe(true);
    expect(result.appealId).toContain('appeal-generated');
  });

  test('submit retry repairs partially written references after create succeeded but reference write failed', async () => {
    let existingAppeal: ReturnType<typeof makeAppealRow> | null = null;
    let replaceAttempts = 0;
    const writtenReferences: Array<Record<string, unknown>> = [];
    const service = buildService({
      repo: {
        getAppealableCaseForUser: async () => makeCaseRow(),
        getLatestNonWithdrawnAppealByCaseSnapshot: async () => existingAppeal,
        getActiveAppealByCase: async () => null,
        createReportAppeal: async (_db, input) => {
          existingAppeal = makeAppealRow({ id: input.id });
          return existingAppeal;
        },
        listReportAppealReferences: async () => writtenReferences as any,
        replaceReportAppealReferences: async (_db, input) => {
          replaceAttempts += 1;
          writtenReferences.splice(0, writtenReferences.length);
          if (replaceAttempts === 1) {
            writtenReferences.push({
              referenceType: input.references[0]?.referenceType,
              referenceId: input.references[0]?.referenceId,
              note: input.references[0]?.note,
              sortOrder: input.references[0]?.sortOrder,
            });
            throw new Error('transient references failure');
          }
          writtenReferences.push(
            ...input.references.map((reference) => ({
              referenceType: reference.referenceType,
              referenceId: reference.referenceId,
              note: reference.note,
              sortOrder: reference.sortOrder,
            })),
          );
        },
      },
      resolveReferenceSnapshots: async () => [
        {
          referenceType: 'encyclopedia_entry',
          referenceId: 'community-rules',
          labelSnapshot: '社区守则',
          urlSnapshot: '/encyclopedia/community-rules',
          note: '需要核对',
          sortOrder: 0,
        },
        {
          referenceType: 'public_data_card',
          referenceId: 'card-2',
          labelSnapshot: '对照卡',
          urlSnapshot: '/character-manager?dataCardId=card-2',
          note: '第二条证据',
          sortOrder: 1,
        },
      ],
    });

    const submitInput = {
      db: {} as never,
      userId: 2,
      reportCaseId: 'case-1',
      caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
      appealReasonCode: 'missing_context' as const,
      details: '补充说明',
      references: [
        { referenceType: 'encyclopedia_entry' as const, referenceId: 'community-rules', note: '需要核对' },
        { referenceType: 'public_data_card' as const, referenceId: 'card-2', note: '第二条证据' },
      ],
    };

    await expect(service.submitReportAppeal(submitInput)).rejects.toThrow('transient references failure');

    const result = await service.submitReportAppeal(submitInput);

    expect(result.appealId).toBe(existingAppeal?.id);
    expect(replaceAttempts).toBe(2);
    expect(writtenReferences).toEqual([
      {
        referenceType: 'encyclopedia_entry',
        referenceId: 'community-rules',
        note: '需要核对',
        sortOrder: 0,
      },
      {
        referenceType: 'public_data_card',
        referenceId: 'card-2',
        note: '第二条证据',
        sortOrder: 1,
      },
    ]);
  });

  test('submit does not rewrite references for an already resolved appeal', async () => {
    let replaceCalled = false;
    const service = buildService({
      repo: {
        getAppealableCaseForUser: async () => makeCaseRow(),
        getLatestNonWithdrawnAppealByCaseSnapshot: async () => makeAppealRow({ status: 'resolved' }),
        listReportAppealReferences: async () => [
          {
            appealId: 'appeal-1',
            referenceType: 'public_data_card',
            referenceId: 'card-old',
            labelSnapshot: '旧引用',
            urlSnapshot: '/data-cards/card-old',
            note: '旧备注',
            sortOrder: 0,
          },
        ],
        replaceReportAppealReferences: async () => {
          replaceCalled = true;
        },
      },
      resolveReferenceSnapshots: async () => [
        {
          referenceType: 'encyclopedia_entry',
          referenceId: 'community-rules',
          labelSnapshot: '社区守则',
          urlSnapshot: '/encyclopedia/community-rules',
          note: '新备注',
          sortOrder: 0,
        },
      ],
    });

    const result = await service.submitReportAppeal({
      db: {} as never,
      userId: 2,
      reportCaseId: 'case-1',
      caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
      appealReasonCode: 'missing_context',
      details: '补充说明',
      references: [{ referenceType: 'encyclopedia_entry', referenceId: 'community-rules', note: '新备注' }],
    });

    expect(result.appealId).toBe('appeal-1');
    expect(result.status).toBe('resolved');
    expect(replaceCalled).toBe(false);
  });

  test('submit rejects stale caseUpdatedAtSnapshot with 422', async () => {
    const service = buildService({
      repo: {
        getAppealableCaseForUser: async () => makeCaseRow({ updatedAt: '2026-04-10T01:25:00.000Z' }),
      },
    });

    await expect(
      service.submitReportAppeal({
        db: {} as never,
        userId: 2,
        reportCaseId: 'case-1',
        caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
        appealReasonCode: 'missing_context',
        details: '补充说明',
        references: [],
      }),
    ).rejects.toBeInstanceOf(ReportAppealUnprocessableError);
  });

  test('submit rejects unsupported referenceType values', async () => {
    let createCalled = false;
    const service = buildService({
      repo: {
        getAppealableCaseForUser: async () => makeCaseRow(),
        createReportAppeal: async () => {
          createCalled = true;
          return makeAppealRow();
        },
      },
    });

    await expect(
      service.submitReportAppeal({
        db: {} as never,
        userId: 2,
        reportCaseId: 'case-1',
        caseUpdatedAtSnapshot: '2026-04-10T01:20:00.000Z',
        appealReasonCode: 'missing_context',
        details: '补充说明',
        references: [{ referenceType: 'foo' as any, referenceId: 'community-rules', note: '规则依据' }],
      }),
    ).rejects.toThrow('引用类型无效');

    expect(createCalled).toBe(false);
  });

  test('withdraw only works for appellant before resolution', async () => {
    const service = buildService({
      repo: {
        getReportAppealByIdForAdmin: async () => makeAppealRow({ status: 'resolved', resolutionCode: 'upheld' }),
      },
    });

    await expect(
      service.withdrawReportAppeal({
        db: {} as never,
        userId: 2,
        appealId: 'appeal-1',
      }),
    ).rejects.toBeInstanceOf(ReportAppealConflictError);
  });

  test('detail rejects non-appellant viewers with 403', async () => {
    const service = buildService({
      repo: {
        getReportAppealByIdForAppellant: async () => null,
        getReportAppealByIdForAdmin: async () => makeAppealRow({ appellantUserId: 8 }),
      },
    });

    await expect(
      service.getReportAppealDetail({
        db: {} as never,
        userId: 2,
        appealId: 'appeal-1',
      }),
    ).rejects.toBeInstanceOf(ReportAppealForbiddenError);
  });

  test('admin review upheld resolves appeal without changing report case', async () => {
    let updatedCase = false;
    const service = buildService({
      repo: {
        getReportAppealByIdForAdmin: async () => makeAppealRow(),
        updateReportAppealResolution: async () => true,
        updateReportCaseAfterAppealReview: async () => {
          updatedCase = true;
          return true;
        },
      },
    });

    const result = await service.reviewReportAppeal({
      db: {} as never,
      adminUserId: 99,
      appealId: 'appeal-1',
      resolutionCode: 'upheld',
      resolutionNote: '维持原判',
    });

    expect(result.status).toBe('resolved');
    expect(updatedCase).toBe(false);
  });

  test('admin review overturned_no_violation writes report case to dismissed no_violation', async () => {
    let payload: Record<string, unknown> | null = null;
    const service = buildService({
      repo: {
        getReportAppealByIdForAdmin: async () => makeAppealRow(),
        updateReportAppealResolution: async () => true,
        updateReportCaseAfterAppealReview: async (_db, input) => {
          payload = input as unknown as Record<string, unknown>;
          return true;
        },
      },
    });

    await service.reviewReportAppeal({
      db: {} as never,
      adminUserId: 99,
      appealId: 'appeal-1',
      resolutionCode: 'overturned_no_violation',
      resolutionNote: '改判不违规',
    });

    expect(payload).toMatchObject({
      status: 'dismissed',
      resolutionCode: 'no_violation',
    });
  });

  test('admin review reopened_under_review writes report case back to under_review', async () => {
    let payload: Record<string, unknown> | null = null;
    const service = buildService({
      repo: {
        getReportAppealByIdForAdmin: async () => makeAppealRow(),
        updateReportAppealResolution: async () => true,
        updateReportCaseAfterAppealReview: async (_db, input) => {
          payload = input as unknown as Record<string, unknown>;
          return true;
        },
      },
    });

    await service.reviewReportAppeal({
      db: {} as never,
      adminUserId: 99,
      appealId: 'appeal-1',
      resolutionCode: 'reopened_under_review',
      resolutionNote: '转人工复核',
    });

    expect(payload).toMatchObject({
      status: 'under_review',
      resolutionCode: null,
      closedAt: null,
    });
  });

  test('admin review sends one report_appeal_resolved message with actionUrl to the appeal detail page', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const service = buildService({
      createUserMessageEntry: async (input) => {
        messages.push(input as unknown as Record<string, unknown>);
        return { id: 1 };
      },
      repo: {
        getReportAppealByIdForAdmin: async () => makeAppealRow(),
        updateReportAppealResolution: async () => true,
        updateReportCaseAfterAppealReview: async () => true,
      },
    });

    await service.reviewReportAppeal({
      db: {} as never,
      adminUserId: 99,
      appealId: 'appeal-1',
      resolutionCode: 'upheld',
      resolutionNote: '维持原判',
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      recipientUserId: 2,
      templateKey: 'user.moderation.report_appeal_resolved',
      actionUrl: '/report-appeals?appealId=appeal-1',
    });
  });

  test('admin review rejects invalid resolutionCode', async () => {
    const service = buildService();

    await expect(
      service.reviewReportAppeal({
        db: {} as never,
        adminUserId: 99,
        appealId: 'appeal-1',
        resolutionCode: 'bad-value' as any,
        resolutionNote: '无效',
      }),
    ).rejects.toBeInstanceOf(ReportAppealValidationError);
  });

  test('admin review rolls back appeal and case writes when message delivery fails', async () => {
    let restored = false;
    let revertedCasePayload: Record<string, unknown> | null = null;
    const service = buildService({
      createUserMessageEntry: async () => {
        throw new Error('message failed');
      },
      repo: {
        getReportAppealByIdForAdmin: async () =>
          makeAppealRow({
            status: 'submitted',
            currentCaseStatus: 'resolved',
            currentCaseResolutionCode: 'confirmed_violation',
            currentCaseClosedAt: '2026-04-10T01:20:00.000Z',
            currentCaseUpdatedAt: '2026-04-10T01:20:00.000Z',
          }),
        updateReportAppealResolution: async () => true,
        updateReportCaseAfterAppealReview: async (_db, input) => {
          revertedCasePayload = input as unknown as Record<string, unknown>;
          return true;
        },
        restoreReportAppealAfterReviewFailure: async () => {
          restored = true;
          return true;
        },
      },
    });

    await expect(
      service.reviewReportAppeal({
        db: {} as never,
        adminUserId: 99,
        appealId: 'appeal-1',
        resolutionCode: 'overturned_no_violation',
        resolutionNote: '改判不违规',
      }),
    ).rejects.toThrow('message failed');

    expect(restored).toBe(true);
    expect(revertedCasePayload).toMatchObject({
      status: 'resolved',
      resolutionCode: 'confirmed_violation',
    });
  });

  test('notifyReportCaseResolutionIfNeeded emits one message per final adverse case snapshot', async () => {
    const messages: Array<Record<string, unknown>> = [];
    let markCalls = 0;
    const service = buildService({
      createUserMessageEntry: async (input) => {
        messages.push(input as unknown as Record<string, unknown>);
        return { id: 1 };
      },
      repo: {
        getReportCaseForResolutionNotification: async () => makeCaseRow(),
        markReportCaseResolutionNotified: async () => {
          markCalls += 1;
          return markCalls === 1;
        },
      },
    });

    const first = await service.notifyReportCaseResolutionIfNeeded({
      db: {} as never,
      reportCaseId: 'case-1',
    });
    const second = await service.notifyReportCaseResolutionIfNeeded({
      db: {} as never,
      reportCaseId: 'case-1',
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.templateKey).toBe('user.moderation.report_case_resolved');
  });

  test('notifyReportCaseResolutionIfNeeded clears notification claim when message delivery fails', async () => {
    let cleared = false;
    const service = buildService({
      createUserMessageEntry: async () => {
        throw new Error('message failed');
      },
      repo: {
        getReportCaseForResolutionNotification: async () => makeCaseRow(),
        markReportCaseResolutionNotified: async () => true,
        clearReportCaseResolutionNotified: async () => {
          cleared = true;
          return true;
        },
      },
    });

    await expect(
      service.notifyReportCaseResolutionIfNeeded({
        db: {} as never,
        reportCaseId: 'case-1',
      }),
    ).rejects.toThrow('message failed');

    expect(cleared).toBe(true);
  });
});
