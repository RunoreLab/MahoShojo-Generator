import { requireInternalToken, type RequireInternalTokenResult } from '@/lib/auth/internal-token';
import { runGrantExcellentReporter } from '@/lib/automation/badges/grant-excellent-reporter';
import { json, methodNotAllowed, readOptionalJson } from '@/lib/internal-api/response';

export const runtime = 'edge';

type GrantExcellentReporterRequestBody = {
  dryRun?: unknown;
  requestId?: unknown;
};

type GrantExcellentReporterApiDeps = {
  requireInternalToken: (req: Request, options: { scopes: string[] }) => Promise<RequireInternalTokenResult>;
  runGrantExcellentReporter: typeof runGrantExcellentReporter;
};

const defaultDeps: GrantExcellentReporterApiDeps = {
  requireInternalToken,
  runGrantExcellentReporter,
};

const normalizeDryRun = (value: unknown): boolean | null => {
  if (value == null) return false;
  return typeof value === 'boolean' ? value : null;
};

const normalizeRequestId = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : null;
};

export const createGrantExcellentReporterInternalHandler =
  (overrides: Partial<GrantExcellentReporterApiDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return methodNotAllowed();
    }

    const deps: GrantExcellentReporterApiDeps = {
      ...defaultDeps,
      ...overrides,
    };

    const auth = await deps.requireInternalToken(req, {
      scopes: ['badges:grant:excellent-reporter'],
    });
    if ('response' in auth) return auth.response;

    const parsed = await readOptionalJson<GrantExcellentReporterRequestBody>(req);
    if ('response' in parsed) return parsed.response;

    const dryRun = normalizeDryRun(parsed.data.dryRun);
    if (dryRun === null) {
      return json({ error: 'dryRun 必须是布尔值' }, { status: 400 });
    }

    const requestId = normalizeRequestId(parsed.data.requestId);
    if (parsed.data.requestId != null && requestId === null) {
      return json({ error: 'requestId 必须是非空字符串' }, { status: 400 });
    }

    const result = await deps.runGrantExcellentReporter({ dryRun });
    return json(
      {
        success: true,
        job: 'grantExcellentReporter',
        requestId,
        dryRun,
        triggeredBy: auth.principal.name,
        rule: result.rule,
        summary: result.summary,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  };

export default createGrantExcellentReporterInternalHandler();
