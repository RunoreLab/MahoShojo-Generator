import { describe, expect, test } from 'bun:test';

import { buildNormalizedReportPayloadHash } from '@/lib/data-card-reports/normalization';
import { createDataCardReportsServiceForTests } from '@/lib/data-card-reports/service';
import type { DataCardReportSubmissionDecision } from '@/lib/data-card-reports/types';

const now = '2026-04-08T10:20:00.000Z';

const targetCard = {
  id: 'card-1',
  user_id: 2,
  type: 'character' as const,
  name: '公开卡',
  description: '描述',
  data: '{"name":"公开卡"}',
  is_public: 1,
  public_since: null,
  usage_count: 0,
  like_count: 0,
  favorite_count: 0,
  review_status: 'approved',
  is_recommended: 0,
  created_at: null,
  updated_at: '2026-04-08T10:00:00.000Z',
  deleted_at: null,
  username: 'creator',
  tag_ids: null,
};

const makeSubmitInput = (reporterUserId: number, details = '说明') => ({
  db: {} as never,
  reporterUserId,
  targetEntityId: 'card-1',
  reasonCode: 'plagiarism' as const,
  details,
  references: [],
});

const buildService = (overrides: Parameters<typeof createDataCardReportsServiceForTests>[0] = {}) =>
  createDataCardReportsServiceForTests({
    now: () => now,
    idFactory: (() => {
      let index = 0;
      return () => `id-${++index}`;
    })(),
    getTargetCard: async () => targetCard,
    resolveReferenceSnapshots: async () => [],
    rateLimit: async () => ({ allowed: true }),
    screenSubmission: async () => ({ allowed: true }),
    createUserMessageEntry: async () => ({ id: 99 }),
    ...overrides,
  });

describe('data card reports service', () => {
  test('multi-user reports against the same card reuse one open case', async () => {
    let openCase: any = null;
    const reports: any[] = [];
    const service = buildService({
      repo: {
        getOpenReportCaseByTarget: async () => openCase,
        createReportCase: async (input: any) => {
          openCase = { ...input, status: 'open', creatorNotifiedAt: null, creatorNotifiedReportCount: 0 };
          return openCase;
        },
        getActiveReportByCaseAndReporter: async (input: any) => {
          if (input.reporterUserId === 8) return null;
          if (input.reporterUserId !== 7) return null;
          return reports.find((report) => report.caseId === input.caseId && report.reporterUserId === input.reporterUserId) ?? null;
        },
        createReport: async (input: any) => {
          const row = { ...input, status: 'active' };
          reports.push(row);
          return row;
        },
        updateActiveReportForReporter: async (input: any) => ({ id: 'updated-report', ...input, status: 'active' }),
        replaceReportReferences: async () => {},
        countActiveReportsByCase: async () => reports.length,
        markReportCaseCreatorNotified: async () => {
          openCase.creatorNotifiedAt = now;
          return true;
        },
      },
    });

    const first = await service.submitDataCardReport(makeSubmitInput(7));
    const second = await service.submitDataCardReport(makeSubmitInput(8));

    expect(first.submissionDecision).toBe('created');
    expect(second.submissionDecision).toBe('created');
    expect(first.caseId).toBe(second.caseId);
    expect(reports).toHaveLength(2);
  });

  test('same user changed payload updates active report after passing screening', async () => {
    let updateCalled = false;
    const service = buildService({
      repo: {
        getOpenReportCaseByTarget: async () => ({
          id: 'case-1',
          targetEntityType: 'data_card',
          targetEntityId: 'card-1',
          targetUserId: 2,
          status: 'open',
          creatorNotifiedAt: now,
          creatorNotifiedReportCount: 1,
        }),
        getActiveReportByCaseAndReporter: async () => ({
          id: 'report-1',
          caseId: 'case-1',
          reporterUserId: 7,
          normalizedPayloadHash: 'hash-a',
          status: 'active',
        }),
        updateActiveReportForReporter: async (input: any) => {
          updateCalled = true;
          return { id: 'report-1', ...input, status: 'active' };
        },
        replaceReportReferences: async () => {},
        countActiveReportsByCase: async () => 1,
      },
    });

    const result = await service.submitDataCardReport(makeSubmitInput(7, '新的说明'));

    expect(result.submissionDecision).toBe('updated');
    expect(updateCalled).toBe(true);
  });

  test('same user same normalized payload returns noop and does not count rate limit', async () => {
    let rateLimitCalled = false;
    const existingHash = await buildNormalizedReportPayloadHash({
      targetEntityId: 'card-1',
      reasonCode: 'plagiarism',
      details: '说明',
      references: [],
    });
    const existingHashService = buildService({
      repo: {
        getOpenReportCaseByTarget: async () => ({
          id: 'case-1',
          targetEntityType: 'data_card',
          targetEntityId: 'card-1',
          targetUserId: 2,
          status: 'open',
          creatorNotifiedAt: now,
          creatorNotifiedReportCount: 1,
        }),
        getActiveReportByCaseAndReporter: async () => ({
          id: 'report-1',
          caseId: 'case-1',
          reporterUserId: 7,
          evidenceSummaryJson: '{}',
          normalizedPayloadHash: existingHash,
          status: 'active',
        }),
        listReportReferencesByReport: async () => [],
        replaceReportReferences: async () => {},
      },
      rateLimit: async () => {
        rateLimitCalled = true;
        return { allowed: true };
      },
    });

    const result = await existingHashService.submitDataCardReport(makeSubmitInput(7));

    expect(result.submissionDecision).toBe('noop_duplicate_payload');
    expect(rateLimitCalled).toBe(false);
  });

  test('same payload retry repairs missing references after a partial write failure', async () => {
    let activeReport: any = null;
    let replaceAttempts = 0;
    const writtenReferences: any[] = [];
    const service = buildService({
      repo: {
        getOpenReportCaseByTarget: async () => ({
          id: 'case-1',
          targetEntityType: 'data_card',
          targetEntityId: 'card-1',
          targetUserId: 2,
          status: 'open',
          creatorNotifiedAt: now,
          creatorNotifiedReportCount: 1,
        }),
        getActiveReportByCaseAndReporter: async () => activeReport,
        createReport: async (_db: any, input: any) => {
          activeReport = { ...input, id: 'report-1', status: 'active' };
          return activeReport;
        },
        updateActiveReportForReporter: async () => {
          throw new Error('should not update same payload retry');
        },
        listReportReferencesByReport: async () => writtenReferences,
        replaceReportReferences: async (_db: any, input: any) => {
          replaceAttempts += 1;
          writtenReferences.splice(0, writtenReferences.length);
          if (replaceAttempts === 1) {
            throw new Error('transient references failure');
          }
          writtenReferences.push(
            ...input.references.map((reference: any) => ({
              referenceType: reference.referenceType,
              referenceId: reference.referenceId,
              note: reference.note,
              sortOrder: reference.sortOrder,
            })),
          );
        },
        countActiveReportsByCase: async () => 1,
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
      ],
    });

    const submitInput = {
      ...makeSubmitInput(7),
      references: [{ referenceType: 'encyclopedia_entry' as const, referenceId: 'community-rules', note: '需要核对' }],
    };

    await expect(service.submitDataCardReport(submitInput)).rejects.toThrow('transient references failure');

    const result = await service.submitDataCardReport(submitInput);

    expect(result).toEqual({
      submissionDecision: 'noop_duplicate_payload',
      caseId: 'case-1',
      reportId: 'report-1',
      creatorNotified: false,
    });
    expect(replaceAttempts).toBe(2);
    expect(writtenReferences).toEqual([
      {
        referenceType: 'encyclopedia_entry',
        referenceId: 'community-rules',
        note: '需要核对',
        sortOrder: 0,
      },
    ]);
  });

  test('same payload retry can resend creator notification after a partial write failure', async () => {
    const openCase = {
      id: 'case-1',
      targetEntityType: 'data_card',
      targetEntityId: 'card-1',
      targetUserId: 2,
      status: 'open',
      creatorNotifiedAt: null,
      creatorNotifiedReportCount: 0,
    };
    let activeReport: any = null;
    let markAttempts = 0;
    let clearAttempts = 0;
    let messageAttempts = 0;
    const service = buildService({
      repo: {
        getOpenReportCaseByTarget: async () => openCase,
        getActiveReportByCaseAndReporter: async () => activeReport,
        createReport: async (_db: any, input: any) => {
          activeReport = { ...input, id: 'report-1', status: 'active' };
          return activeReport;
        },
        updateActiveReportForReporter: async () => {
          throw new Error('should not update same payload retry');
        },
        listReportReferencesByReport: async () => [],
        replaceReportReferences: async () => {},
        countActiveReportsByCase: async () => 1,
        markReportCaseCreatorNotified: async (_db: any, input: any) => {
          markAttempts += 1;
          if (openCase.creatorNotifiedAt) return false;
          openCase.creatorNotifiedAt = input.notifiedAt;
          openCase.creatorNotifiedReportCount = input.reportCount;
          return true;
        },
        clearReportCaseCreatorNotified: async (_db: any, input: any) => {
          clearAttempts += 1;
          if (openCase.creatorNotifiedAt !== input.notifiedAt) return false;
          openCase.creatorNotifiedAt = null;
          openCase.creatorNotifiedReportCount = 0;
          return true;
        },
      },
      createUserMessageEntry: async () => {
        messageAttempts += 1;
        if (messageAttempts === 1) {
          throw new Error('message write failed');
        }
        return { id: 9 };
      },
    });

    await expect(service.submitDataCardReport(makeSubmitInput(7))).rejects.toThrow('message write failed');

    const result = await service.submitDataCardReport(makeSubmitInput(7));

    expect(result).toEqual({
      submissionDecision: 'noop_duplicate_payload',
      caseId: 'case-1',
      reportId: 'report-1',
      creatorNotified: true,
    });
    expect(markAttempts).toBe(2);
    expect(clearAttempts).toBe(1);
    expect(messageAttempts).toBe(2);
  });

  test('changed payload that fails rate limit returns 429-facing decision and does not write', async () => {
    let updateCalled = false;
    const service = buildService({
      repo: {
        getOpenReportCaseByTarget: async () => ({
          id: 'case-1',
          targetEntityType: 'data_card',
          targetEntityId: 'card-1',
          targetUserId: 2,
          status: 'open',
          creatorNotifiedAt: now,
          creatorNotifiedReportCount: 1,
        }),
        getActiveReportByCaseAndReporter: async () => ({
          id: 'report-1',
          caseId: 'case-1',
          reporterUserId: 7,
          normalizedPayloadHash: 'hash-a',
          status: 'active',
        }),
        updateActiveReportForReporter: async () => {
          updateCalled = true;
          throw new Error('should not update');
        },
      },
      rateLimit: async () => ({ allowed: false }),
    });

    const result = await service.submitDataCardReport(makeSubmitInput(7, '新的说明'));

    expect(result.submissionDecision satisfies DataCardReportSubmissionDecision).toBe('rejected_rate_limited');
    expect(updateCalled).toBe(false);
  });

  test('creator notification is sent only once for the open case with actorUserId null and source report_case', async () => {
    const messages: any[] = [];
    const service = buildService({
      repo: {
        getOpenReportCaseByTarget: async () => null,
        createReportCase: async (input: any) => ({
          ...input,
          status: 'open',
          creatorNotifiedAt: null,
          creatorNotifiedReportCount: 0,
        }),
        getActiveReportByCaseAndReporter: async () => null,
        createReport: async (input: any) => ({ id: input.id, ...input, status: 'active' }),
        replaceReportReferences: async () => {},
        countActiveReportsByCase: async () => 1,
        markReportCaseCreatorNotified: async () => true,
      },
      createUserMessageEntry: async (input: any) => {
        messages.push(input);
        return { id: 9 };
      },
    });

    const result = await service.submitDataCardReport(makeSubmitInput(7));

    expect(result.creatorNotified).toBe(true);
    expect(messages[0]).toMatchObject({
      recipientUserId: 2,
      actorUserId: null,
      sourceEntityType: 'report_case',
      templateKey: 'user.moderation.data_card_reported',
    });
  });

  test('create report case falls back to existing open case when insert hits concurrent unique conflict', async () => {
    let lookupCount = 0;
    const service = buildService({
      repo: {
        getOpenReportCaseByTarget: async () => {
          lookupCount += 1;
          return lookupCount >= 2
            ? {
                id: 'case-1',
                targetEntityType: 'data_card',
                targetEntityId: 'card-1',
                targetUserId: 2,
                status: 'open',
                creatorNotifiedAt: now,
                creatorNotifiedReportCount: 1,
              }
            : null;
        },
        createReportCase: async () => {
          throw new Error('UNIQUE constraint failed: report_cases.target_entity_type, report_cases.target_entity_id');
        },
        getActiveReportByCaseAndReporter: async () => null,
        createReport: async (input: any) => ({ id: input.id, ...input, status: 'active' }),
        replaceReportReferences: async () => {},
        countActiveReportsByCase: async () => 1,
        markReportCaseCreatorNotified: async () => false,
      },
    });

    const result = await service.submitDataCardReport(makeSubmitInput(7));

    expect(result.caseId).toBe('case-1');
    expect(result.submissionDecision).toBe('created');
  });

  test('reuses reporter active report after concurrent case creation is adopted', async () => {
    let lookupCount = 0;
    let createReportCalled = false;
    let updateCalled = false;
    const activeReport = {
      id: 'report-1',
      caseId: 'case-1',
      reporterUserId: 7,
      normalizedPayloadHash: 'old-hash',
      status: 'active',
    };
    const service = buildService({
      repo: {
        getOpenReportCaseByTarget: async () => {
          lookupCount += 1;
          return lookupCount >= 2
            ? {
                id: 'case-1',
                targetEntityType: 'data_card',
                targetEntityId: 'card-1',
                targetUserId: 2,
                status: 'open',
                creatorNotifiedAt: now,
                creatorNotifiedReportCount: 1,
              }
            : null;
        },
        createReportCase: async () => {
          throw new Error('UNIQUE constraint failed: report_cases.target_entity_type, report_cases.target_entity_id');
        },
        getActiveReportByCaseAndReporter: async (_db: any, input: any) =>
          input.caseId === 'case-1' ? activeReport : null,
        createReport: async () => {
          createReportCalled = true;
          throw new Error('should not create duplicate report');
        },
        updateActiveReportForReporter: async (_db: any, input: any) => {
          updateCalled = true;
          return { id: 'report-1', ...input, status: 'active' };
        },
        replaceReportReferences: async () => {},
        countActiveReportsByCase: async () => 1,
        markReportCaseCreatorNotified: async () => false,
      },
    });

    const result = await service.submitDataCardReport(makeSubmitInput(7, '新的说明'));

    expect(result.caseId).toBe('case-1');
    expect(result.reportId).toBe('report-1');
    expect(result.submissionDecision).toBe('updated');
    expect(createReportCalled).toBe(false);
    expect(updateCalled).toBe(true);
  });

  test('reuses concurrent active report creation as noop when payload hash already matches', async () => {
    let createReportAttempted = false;
    let replaceCalled = false;
    let updateCalled = false;
    const payloadHash = await buildNormalizedReportPayloadHash({
      targetEntityId: 'card-1',
      reasonCode: 'plagiarism',
      details: '说明',
      references: [],
    });
    const service = buildService({
      repo: {
        getOpenReportCaseByTarget: async () => ({
          id: 'case-1',
          targetEntityType: 'data_card',
          targetEntityId: 'card-1',
          targetUserId: 2,
          status: 'open',
          creatorNotifiedAt: now,
          creatorNotifiedReportCount: 1,
        }),
        getActiveReportByCaseAndReporter: async () =>
          createReportAttempted
            ? {
                id: 'report-1',
                caseId: 'case-1',
                reporterUserId: 7,
                normalizedPayloadHash: payloadHash,
                status: 'active',
              }
            : null,
        createReport: async () => {
          createReportAttempted = true;
          throw new Error('UNIQUE constraint failed: reports.case_id, reports.reporter_user_id');
        },
        updateActiveReportForReporter: async () => {
          updateCalled = true;
          throw new Error('should not update after duplicate payload conflict');
        },
        replaceReportReferences: async () => {
          replaceCalled = true;
        },
        countActiveReportsByCase: async () => 1,
        markReportCaseCreatorNotified: async () => false,
      },
    });

    const result = await service.submitDataCardReport(makeSubmitInput(7));

    expect(result).toEqual({
      submissionDecision: 'noop_duplicate_payload',
      caseId: 'case-1',
      reportId: 'report-1',
      creatorNotified: false,
    });
    expect(updateCalled).toBe(false);
    expect(replaceCalled).toBe(false);
  });

  test('updates concurrent active report after insert conflict when payload differs', async () => {
    let createReportAttempted = false;
    let replaceCalled = false;
    let updateCalled = false;
    const service = buildService({
      repo: {
        getOpenReportCaseByTarget: async () => ({
          id: 'case-1',
          targetEntityType: 'data_card',
          targetEntityId: 'card-1',
          targetUserId: 2,
          status: 'open',
          creatorNotifiedAt: now,
          creatorNotifiedReportCount: 1,
        }),
        getActiveReportByCaseAndReporter: async () =>
          createReportAttempted
            ? {
                id: 'report-1',
                caseId: 'case-1',
                reporterUserId: 7,
                normalizedPayloadHash: 'old-hash',
                status: 'active',
              }
            : null,
        createReport: async () => {
          createReportAttempted = true;
          throw new Error('UNIQUE constraint failed: reports.case_id, reports.reporter_user_id');
        },
        updateActiveReportForReporter: async (_db: any, input: any) => {
          updateCalled = true;
          return { id: 'report-1', ...input, status: 'active' };
        },
        replaceReportReferences: async () => {
          replaceCalled = true;
        },
        countActiveReportsByCase: async () => 1,
        markReportCaseCreatorNotified: async () => false,
      },
    });

    const result = await service.submitDataCardReport(makeSubmitInput(7, '新的说明'));

    expect(result).toEqual({
      submissionDecision: 'updated',
      caseId: 'case-1',
      reportId: 'report-1',
      creatorNotified: false,
    });
    expect(updateCalled).toBe(true);
    expect(replaceCalled).toBe(true);
  });

  test('sends creator notification only after winning notification flag claim', async () => {
    const messages: any[] = [];
    const service = buildService({
      repo: {
        getOpenReportCaseByTarget: async () => ({
          id: 'case-1',
          targetEntityType: 'data_card',
          targetEntityId: 'card-1',
          targetUserId: 2,
          status: 'open',
          creatorNotifiedAt: null,
          creatorNotifiedReportCount: 0,
        }),
        getActiveReportByCaseAndReporter: async () => null,
        createReport: async (input: any) => ({ id: input.id, ...input, status: 'active' }),
        replaceReportReferences: async () => {},
        countActiveReportsByCase: async () => 1,
        markReportCaseCreatorNotified: async () => false,
      },
      createUserMessageEntry: async (input: any) => {
        messages.push(input);
        return { id: 9 };
      },
    });

    const result = await service.submitDataCardReport(makeSubmitInput(7));

    expect(result.creatorNotified).toBe(false);
    expect(messages).toHaveLength(0);
  });

  test('rolls back claimed notification flag when creator message write fails', async () => {
    let markCalled = false;
    let clearCalled = false;
    const service = buildService({
      repo: {
        getOpenReportCaseByTarget: async () => null,
        createReportCase: async (input: any) => ({
          ...input,
          status: 'open',
          creatorNotifiedAt: null,
          creatorNotifiedReportCount: 0,
        }),
        getActiveReportByCaseAndReporter: async () => null,
        createReport: async (input: any) => ({ id: input.id, ...input, status: 'active' }),
        replaceReportReferences: async () => {},
        countActiveReportsByCase: async () => 1,
        markReportCaseCreatorNotified: async () => {
          markCalled = true;
          return true;
        },
        clearReportCaseCreatorNotified: async () => {
          clearCalled = true;
          return true;
        },
      },
      createUserMessageEntry: async () => {
        throw new Error('message write failed');
      },
    });

    await expect(service.submitDataCardReport(makeSubmitInput(7))).rejects.toThrow('message write failed');
    expect(markCalled).toBe(true);
    expect(clearCalled).toBe(true);
  });

  test('builds self-remediation candidate DTO from current card updatedAt and notice snapshot', () => {
    const service = buildService();

    const dto = service.buildSelfRemediationCandidateDto({
      caseId: 'case-1',
      creatorNotifiedAt: '2026-04-08T10:20:00.000Z',
      targetCardUpdatedAtAtNotice: '2026-04-08T10:00:00.000Z',
      currentTargetCardUpdatedAt: '2026-04-08T10:40:00.000Z',
    });

    expect(dto).toEqual({
      caseId: 'case-1',
      isSelfRemediationCandidate: true,
      selfRemediationDetectedAt: '2026-04-08T10:40:00.000Z',
    });
  });

  test('falls back to creatorNotifiedAt when notice snapshot updatedAt is unavailable', () => {
    const service = buildService();

    const dto = service.buildSelfRemediationCandidateDto({
      caseId: 'case-1',
      creatorNotifiedAt: '2026-04-08T10:20:00.000Z',
      targetCardUpdatedAtAtNotice: null,
      currentTargetCardUpdatedAt: '2026-04-08T10:40:00.000Z',
    });

    expect(dto).toEqual({
      caseId: 'case-1',
      isSelfRemediationCandidate: true,
      selfRemediationDetectedAt: '2026-04-08T10:40:00.000Z',
    });
  });
});
