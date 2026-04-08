import { getAuthUser, json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import {
  DataCardReportForbiddenError,
  DataCardReportsServiceUnavailableError,
  DataCardReportValidationError,
  getDataCardReportCapability,
  type DataCardReportsServiceDb,
  submitDataCardReport,
} from '@/lib/data-card-reports/service';

export const runtime = 'edge';

type HandlerDeps = {
  getAuthUser: typeof getAuthUser;
  requireAuthUser: typeof requireAuthUser;
  getDb: () => DataCardReportsServiceDb | Promise<DataCardReportsServiceDb>;
  getDataCardReportCapability: typeof getDataCardReportCapability;
  submitDataCardReport: typeof submitDataCardReport;
};

const defaultDeps: HandlerDeps = {
  getAuthUser,
  requireAuthUser,
  getDb: async () => {
    const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
    return getDrizzleDbFromRuntime();
  },
  getDataCardReportCapability,
  submitDataCardReport,
};

const resolveDb = async (deps: Partial<HandlerDeps>): Promise<DataCardReportsServiceDb> =>
  (deps.getDb ? await deps.getDb() : await defaultDeps.getDb());

const getTargetEntityIdFromQuery = (req: Request): string => {
  const url = new URL(req.url);
  return url.searchParams.get('dataCardId')?.trim() ?? '';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseSubmitBody = async (
  req: Request,
): Promise<
  | {
      targetEntityId: string;
      reasonCode: string;
      details: string | null;
      references: Array<{ referenceType: 'public_data_card' | 'encyclopedia_entry'; referenceId: string; note?: string | null }>;
    }
  | { response: Response }
> => {
  const payload = await readJson<Record<string, unknown>>(req);
  if ('response' in payload) return payload;
  if (!isRecord(payload.data)) {
    return { response: json({ error: '请求体格式无效' }, { status: 400 }) };
  }

  const body = payload.data;

  const targetEntityId =
    (typeof body.targetEntityId === 'string' ? body.targetEntityId : null) ??
    (typeof body.dataCardId === 'string' ? body.dataCardId : null);
  const reasonCode = typeof body.reasonCode === 'string' ? body.reasonCode : '';
  const details = typeof body.details === 'string' ? body.details : null;
  const references = Array.isArray(body.references) ? body.references : [];

  if (!targetEntityId || targetEntityId.trim().length === 0) {
    return { response: json({ error: '缺少目标数据卡 ID' }, { status: 400 }) };
  }
  if (!reasonCode.trim()) {
    return { response: json({ error: '缺少举报理由' }, { status: 400 }) };
  }

  return {
    targetEntityId: targetEntityId.trim(),
    reasonCode: reasonCode.trim(),
    details,
    references: references as Array<{
      referenceType: 'public_data_card' | 'encyclopedia_entry';
      referenceId: string;
      note?: string | null;
    }>,
  };
};

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof DataCardReportValidationError) {
    return json({ error: error.message }, { status: 400 });
  }
  if (error instanceof DataCardReportForbiddenError) {
    return json({ error: error.message }, { status: 403 });
  }
  if (error instanceof DataCardReportsServiceUnavailableError) {
    return json({ error: error.message }, { status: 503 });
  }
  return null;
};

export const createDataCardReportsHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method === 'GET') {
      const targetEntityId = getTargetEntityIdFromQuery(req);
      if (!targetEntityId) {
        return json({ error: '缺少 dataCardId' }, { status: 400 });
      }

      try {
        const auth = await (deps.getAuthUser ?? defaultDeps.getAuthUser)(req);
        const payload = await (deps.getDataCardReportCapability ?? defaultDeps.getDataCardReportCapability)({
          db: await resolveDb(deps),
          viewerUserId: auth?.user.id ?? null,
          targetEntityId,
        });
        return json(payload, { headers: { 'Cache-Control': 'no-store' } });
      } catch (error) {
        const response = toErrorResponse(error);
        if (response) return response;
        throw error;
      }
    }

    if (req.method === 'POST') {
      const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
      if ('response' in auth) return auth.response;

      const parsed = await parseSubmitBody(req);
      if ('response' in parsed) return parsed.response;

      try {
        const result = await (deps.submitDataCardReport ?? defaultDeps.submitDataCardReport)({
          db: await resolveDb(deps),
          reporterUserId: auth.user.id,
          targetEntityId: parsed.targetEntityId,
          reasonCode: parsed.reasonCode,
          details: parsed.details,
          references: parsed.references,
        });

        const status =
          result.submissionDecision === 'rejected_rate_limited'
            ? 429
            : result.submissionDecision === 'rejected_screened'
              ? 422
              : 200;

        return json(result, { status });
      } catch (error) {
        const response = toErrorResponse(error);
        if (response) return response;
        throw error;
      }
    }

    return json({ error: 'Method not allowed' }, { status: 405 });
  };

export default withPvpErrorBoundary(createDataCardReportsHandler());
