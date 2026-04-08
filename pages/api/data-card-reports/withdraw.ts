import { json, readJson, requireAuthUser, withPvpErrorBoundary } from '@/lib/pvp/server';
import {
  DataCardReportsServiceUnavailableError,
  DataCardReportValidationError,
  type DataCardReportsServiceDb,
  withdrawDataCardReport,
} from '@/lib/data-card-reports/service';

export const runtime = 'edge';

type HandlerDeps = {
  requireAuthUser: typeof requireAuthUser;
  getDb: () => DataCardReportsServiceDb | Promise<DataCardReportsServiceDb>;
  withdrawDataCardReport: typeof withdrawDataCardReport;
};

const defaultDeps: HandlerDeps = {
  requireAuthUser,
  getDb: async () => {
    const { getDrizzleDbFromRuntime } = await import('@/lib/db/drizzle');
    return getDrizzleDbFromRuntime();
  },
  withdrawDataCardReport,
};

const resolveDb = async (deps: Partial<HandlerDeps>): Promise<DataCardReportsServiceDb> =>
  (deps.getDb ? await deps.getDb() : await defaultDeps.getDb());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toErrorResponse = (error: unknown): Response | null => {
  if (error instanceof DataCardReportValidationError) {
    return json({ error: error.message }, { status: 400 });
  }
  if (error instanceof DataCardReportsServiceUnavailableError) {
    return json({ error: error.message }, { status: 503 });
  }
  return null;
};

export const createDataCardReportWithdrawHandler =
  (deps: Partial<HandlerDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    const auth = await (deps.requireAuthUser ?? defaultDeps.requireAuthUser)(req);
    if ('response' in auth) return auth.response;

    const payload = await readJson<Record<string, unknown>>(req);
    if ('response' in payload) return payload.response;
    if (!isRecord(payload.data)) {
      return json({ error: '请求体格式无效' }, { status: 400 });
    }

    const body = payload.data;

    const targetEntityId =
      (typeof body.targetEntityId === 'string' ? body.targetEntityId : null) ??
      (typeof body.dataCardId === 'string' ? body.dataCardId : null);
    if (!targetEntityId || targetEntityId.trim().length === 0) {
      return json({ error: '缺少目标数据卡 ID' }, { status: 400 });
    }

    try {
      const result = await (deps.withdrawDataCardReport ?? defaultDeps.withdrawDataCardReport)({
        db: await resolveDb(deps),
        reporterUserId: auth.user.id,
        targetEntityId: targetEntityId.trim(),
      });
      return json(result);
    } catch (error) {
      const response = toErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };

export default withPvpErrorBoundary(createDataCardReportWithdrawHandler());
