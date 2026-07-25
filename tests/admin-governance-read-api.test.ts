import { describe, expect, test } from 'vitest';

import { createAdminCrowdReviewCasesHandler } from '@/components/creation/api/admin/crowd-review/cases/index';
import { createAdminCrowdReviewInspectorsHandler } from '@/components/creation/api/admin/crowd-review/inspectors/index';
import { createAdminReportCasesHandler } from '@/components/creation/api/admin/report-cases/index';

describe('admin governance read APIs', () => {
  test('GET /api/admin/report-cases forwards status filter', async () => {
    let receivedStatus: string | undefined;
    const handler = createAdminReportCasesHandler({
      listAdminReportCases: async (input) => {
        receivedStatus = input.status;
        return {
          items: [],
          fetchedAt: '2026-04-11T02:30:00.000Z',
        };
      },
    });

    const response = await handler(new Request('https://example.test/api/admin/report-cases?status=under_review'));
    expect(response.status).toBe(200);
    expect(receivedStatus).toBe('under_review');
  });

  test('GET /api/admin/crowd-review/inspectors forwards status filter', async () => {
    let receivedStatus: string | undefined;
    const handler = createAdminCrowdReviewInspectorsHandler({
      listAdminCrowdReviewInspectors: async (input) => {
        receivedStatus = input.status;
        return {
          items: [],
          fetchedAt: '2026-04-11T02:30:00.000Z',
        };
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/crowd-review/inspectors?status=active'),
    );
    expect(response.status).toBe(200);
    expect(receivedStatus).toBe('active');
  });

  test('GET /api/admin/crowd-review/cases forwards round status filter', async () => {
    let receivedStatus: string | undefined;
    const handler = createAdminCrowdReviewCasesHandler({
      listAdminCrowdReviewCases: async (input) => {
        receivedStatus = input.status;
        return {
          items: [],
          fetchedAt: '2026-04-11T02:30:00.000Z',
        };
      },
    });

    const response = await handler(
      new Request('https://example.test/api/admin/crowd-review/cases?status=active'),
    );
    expect(response.status).toBe(200);
    expect(receivedStatus).toBe('active');
  });
});
