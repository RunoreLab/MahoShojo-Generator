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
          normalizedPayloadHash: existingHash,
          status: 'active',
        }),
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

  test('does not mark case notified before creator message is written successfully', async () => {
    let markCalled = false;
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
      },
      createUserMessageEntry: async () => {
        throw new Error('message write failed');
      },
    });

    await expect(service.submitDataCardReport(makeSubmitInput(7))).rejects.toThrow('message write failed');
    expect(markCalled).toBe(false);
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
