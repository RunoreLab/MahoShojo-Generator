import { requireInternalToken, type RequireInternalTokenResult } from '@/lib/auth/internal-token';
import { runGrantSponsor } from '@/lib/automation/badges/grant-sponsor';
import { json, methodNotAllowed, readOptionalJson } from '@/lib/internal-api/response';

export const runtime = 'edge';

type GrantSponsorRequestBody = {
  dryRun?: unknown;
  requestId?: unknown;
};

type GrantSponsorApiDeps = {
  requireInternalToken: (req: Request, options: { scopes: string[] }) => Promise<RequireInternalTokenResult>;
  runGrantSponsor: typeof runGrantSponsor;
};

const defaultDeps: GrantSponsorApiDeps = {
  requireInternalToken,
  runGrantSponsor,
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

export const createGrantSponsorInternalHandler =
  (overrides: Partial<GrantSponsorApiDeps> = {}) =>
  async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return methodNotAllowed();
    }

    const deps: GrantSponsorApiDeps = {
      ...defaultDeps,
      ...overrides,
    };

    const auth = await deps.requireInternalToken(req, {
      scopes: ['badges:grant:sponsor'],
    });
    if ('response' in auth) return auth.response;

    const parsed = await readOptionalJson<GrantSponsorRequestBody>(req);
    if ('response' in parsed) return parsed.response;

    const dryRun = normalizeDryRun(parsed.data.dryRun);
    if (dryRun === null) {
      return json({ error: 'dryRun 必须是布尔值' }, { status: 400 });
    }

    const requestId = normalizeRequestId(parsed.data.requestId);
    if (parsed.data.requestId != null && requestId === null) {
      return json({ error: 'requestId 必须是非空字符串' }, { status: 400 });
    }

    const result = await deps.runGrantSponsor({ dryRun });
    return json(
      {
        success: true,
        job: 'grantSponsor',
        requestId,
        dryRun,
        triggeredBy: auth.principal.name,
        sponsorBadgeId: result.sponsorBadgeId,
        excellentReporterRule: result.excellentReporterRule,
        summary: result.summary,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  };

export default createGrantSponsorInternalHandler();
