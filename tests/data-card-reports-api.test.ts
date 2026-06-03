import { describe, expect, test } from 'vitest';

import {
  DataCardReportForbiddenError,
  DataCardReportsServiceUnavailableError,
  DataCardReportValidationError,
} from '@/lib/data-card-reports/service';
import { createDataCardReportsHandler } from '@/app/api/data-card-reports/handler';
import { createDataCardReportWithdrawHandler } from '@/app/api/data-card-reports/withdraw/handler';

const auth = {
  user: { id: 7, username: 'hana' },
  source: 'better-auth-session' as const,
};

const bannedAuth = {
  user: { id: 8, username: 'banned-hana', is_banned: '2026-04-08T09:00:00.000Z' },
  source: 'better-auth-session' as const,
};

const jsonBody = async <T>(response: Response): Promise<T> => (await response.json()) as T;

describe('data card reports API', () => {
  test('GET capability returns canReport false for logged out viewer without requiring mutation auth', async () => {
    const handler = createDataCardReportsHandler({
      getAuthUser: async () => null,
      getDb: () => {
        throw new Error('logged out capability should not resolve db');
      },
      getDataCardReportCapability: async () => ({
        canReport: false,
        reportDisabledReason: '登录后可举报',
        hasOpenCase: false,
        myActiveReport: null,
        reasons: [],
        caseSummary: null,
      }),
    });

    const response = await handler(new Request('https://example.test/api/data-card-reports?dataCardId=card-1'));
    const payload = await jsonBody<{ canReport: boolean; reportDisabledReason: string | null }>(response);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ canReport: false, reportDisabledReason: '登录后可举报' });
  });

  test('GET capability returns existing report draft, reasons and anonymous case summary for eligible viewer', async () => {
    const handler = createDataCardReportsHandler({
      getAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      getDataCardReportCapability: async () => ({
        canReport: true,
        reportDisabledReason: null,
        hasOpenCase: true,
        myActiveReport: {
          reasonCode: 'plagiarism',
          details: '说明',
          references: [],
        },
        reasons: [{ code: 'plagiarism', label: '疑似抄袭', description: '高度近似搬运' }],
        caseSummary: {
          caseId: 'case-1',
          reportCount: 2,
          reasonLabels: ['疑似抄袭'],
          referenceSummary: ['引用公开数据卡：白百合'],
        },
      }),
    });

    const response = await handler(new Request('https://example.test/api/data-card-reports?dataCardId=card-1'));
    const payload = await jsonBody<any>(response);

    expect(response.status).toBe(200);
    expect(payload.hasOpenCase).toBe(true);
    expect(payload.reasons[0].code).toBe('plagiarism');
    expect(payload.caseSummary.caseId).toBe('case-1');
  });

  test('GET capability returns disabled payload for banned viewer without calling service', async () => {
    const handler = createDataCardReportsHandler({
      getAuthUser: async () => bannedAuth,
      getDb: () => {
        throw new Error('banned capability should not resolve db');
      },
      getDataCardReportCapability: async () => {
        throw new Error('service should not be called for banned viewer');
      },
    });

    const response = await handler(new Request('https://example.test/api/data-card-reports?dataCardId=card-1'));
    const payload = await jsonBody<{
      canReport: boolean;
      reportDisabledReason: string | null;
      hasOpenCase: boolean;
      myActiveReport: null;
      reasons: Array<{ code: string }>;
      caseSummary: null;
    }>(response);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      canReport: false,
      reportDisabledReason: '账号已被封禁',
      hasOpenCase: false,
      myActiveReport: null,
      caseSummary: null,
    });
    expect(payload.reasons.length).toBeGreaterThan(0);
    expect(payload.reasons[0]?.code).toBe('plagiarism');
  });

  test('POST submit requires login', async () => {
    const handler = createDataCardReportsHandler({
      requireAuthUser: async () => ({ response: new Response(JSON.stringify({ error: '未授权' }), { status: 401 }) }) as never,
      getDb: () => ({ db: true }),
      submitDataCardReport: async () => {
        throw new Error('service should not be called');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/data-card-reports', {
        method: 'POST',
        body: JSON.stringify({ targetEntityId: 'card-1', reasonCode: 'plagiarism', references: [] }),
      }),
    );

    expect(response.status).toBe(401);
  });

  test('POST submit rejects self-report with 403 and stable error body', async () => {
    const handler = createDataCardReportsHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      submitDataCardReport: async () => {
        throw new DataCardReportForbiddenError('不能举报自己的公开数据卡');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/data-card-reports', {
        method: 'POST',
        body: JSON.stringify({ targetEntityId: 'card-1', reasonCode: 'plagiarism', references: [] }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await jsonBody<{ error: string }>(response)).toEqual({ error: '不能举报自己的公开数据卡' });
  });

  test('POST submit rejects non-public target with 400 and stable error body', async () => {
    const handler = createDataCardReportsHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      submitDataCardReport: async () => {
        throw new DataCardReportValidationError('目标数据卡不存在或当前不可举报');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/data-card-reports', {
        method: 'POST',
        body: JSON.stringify({ targetEntityId: 'card-1', reasonCode: 'plagiarism', references: [] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await jsonBody<{ error: string }>(response)).toEqual({ error: '目标数据卡不存在或当前不可举报' });
  });

  test('POST submit rejects invalid reason or invalid reference with 400 and stable error body', async () => {
    const handler = createDataCardReportsHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      submitDataCardReport: async () => {
        throw new DataCardReportValidationError('举报理由无效');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/data-card-reports', {
        method: 'POST',
        body: JSON.stringify({ targetEntityId: 'card-1', reasonCode: 'bad', references: [] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await jsonBody<{ error: string }>(response)).toEqual({ error: '举报理由无效' });
  });

  test('POST submit rejects non-object JSON body with 400 instead of throwing', async () => {
    const handler = createDataCardReportsHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      submitDataCardReport: async () => {
        throw new Error('service should not be called');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/data-card-reports', {
        method: 'POST',
        body: JSON.stringify(null),
      }),
    );

    expect(response.status).toBe(400);
    expect(await jsonBody<{ error: string }>(response)).toEqual({ error: '请求体格式无效' });
  });

  test('POST submit returns 429 for rejected_rate_limited', async () => {
    const handler = createDataCardReportsHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      submitDataCardReport: async () => ({
        submissionDecision: 'rejected_rate_limited',
        caseId: null,
        reportId: null,
        creatorNotified: false,
      }),
    });

    const response = await handler(
      new Request('https://example.test/api/data-card-reports', {
        method: 'POST',
        body: JSON.stringify({ targetEntityId: 'card-1', reasonCode: 'plagiarism', references: [] }),
      }),
    );

    expect(response.status).toBe(429);
  });

  test('POST submit returns 422 for rejected_screened', async () => {
    const handler = createDataCardReportsHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      submitDataCardReport: async () => ({
        submissionDecision: 'rejected_screened',
        caseId: null,
        reportId: null,
        creatorNotified: false,
      }),
    });

    const response = await handler(
      new Request('https://example.test/api/data-card-reports', {
        method: 'POST',
        body: JSON.stringify({ targetEntityId: 'card-1', reasonCode: 'plagiarism', references: [] }),
      }),
    );

    expect(response.status).toBe(422);
  });

  test('POST submit returns submissionDecision caseId reportId creatorNotified on success', async () => {
    const handler = createDataCardReportsHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      submitDataCardReport: async () => ({
        submissionDecision: 'created',
        caseId: 'case-1',
        reportId: 'report-1',
        creatorNotified: true,
      }),
    });

    const response = await handler(
      new Request('https://example.test/api/data-card-reports', {
        method: 'POST',
        body: JSON.stringify({ targetEntityId: 'card-1', reasonCode: 'plagiarism', references: [] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      submissionDecision: 'created',
      caseId: 'case-1',
      reportId: 'report-1',
      creatorNotified: true,
    });
  });

  test('POST withdraw requires login and returns service result', async () => {
    const unauthorized = createDataCardReportWithdrawHandler({
      requireAuthUser: async () => ({ response: new Response(JSON.stringify({ error: '未授权' }), { status: 401 }) }) as never,
      getDb: () => ({ db: true }),
      withdrawDataCardReport: async () => ({ withdrawn: true, caseDismissed: false }),
    });
    const handler = createDataCardReportWithdrawHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      withdrawDataCardReport: async () => ({ withdrawn: true, caseDismissed: true }),
    });

    expect(
      (await unauthorized(new Request('https://example.test/api/data-card-reports/withdraw', { method: 'POST' }))).status,
    ).toBe(401);

    const response = await handler(
      new Request('https://example.test/api/data-card-reports/withdraw', {
        method: 'POST',
        body: JSON.stringify({ targetEntityId: 'card-1' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({ withdrawn: true, caseDismissed: true });
  });

  test('POST withdraw rejects non-object JSON body with 400 instead of throwing', async () => {
    const handler = createDataCardReportWithdrawHandler({
      requireAuthUser: async () => auth,
      getDb: () => ({ db: true }),
      withdrawDataCardReport: async () => {
        throw new Error('service should not be called');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/data-card-reports/withdraw', {
        method: 'POST',
        body: JSON.stringify([]),
      }),
    );

    expect(response.status).toBe(400);
    expect(await jsonBody<{ error: string }>(response)).toEqual({ error: '请求体格式无效' });
  });

  test('POST submit returns 503 when service db is unavailable', async () => {
    const handler = createDataCardReportsHandler({
      requireAuthUser: async () => auth,
      getDb: () => null,
      submitDataCardReport: async () => {
        throw new DataCardReportsServiceUnavailableError('举报服务当前不可用');
      },
    });

    const response = await handler(
      new Request('https://example.test/api/data-card-reports', {
        method: 'POST',
        body: JSON.stringify({ targetEntityId: 'card-1', reasonCode: 'plagiarism', references: [] }),
      }),
    );

    expect(response.status).toBe(503);
  });
});
