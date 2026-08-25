import { issueActivityToken } from '@/lib/auth/activity-token';
import { requireAuthUserForApp } from '@/lib/auth/server-app';
import { ensureBusinessUserLegacyAuthKey } from '@/lib/auth/user-auth-linking';
import { getBusinessUserById } from '@/lib/db/repositories/business-users';
import { getDrizzleDbFromRuntime } from '@/lib/db/drizzle';

type VerifyDeps = {
  requireAuthUserForApp: typeof requireAuthUserForApp;
  issueActivityToken: typeof issueActivityToken;
  getDrizzleDbFromRuntime: typeof getDrizzleDbFromRuntime;
  getBusinessUserById: typeof getBusinessUserById;
  ensureBusinessUserLegacyAuthKey: typeof ensureBusinessUserLegacyAuthKey;
};

const defaultVerifyDeps: VerifyDeps = {
  requireAuthUserForApp,
  issueActivityToken,
  getDrizzleDbFromRuntime,
  getBusinessUserById,
  ensureBusinessUserLegacyAuthKey,
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildVerifyHandler = (deps: VerifyDeps): ((req: Request) => Promise<Response>) => {
  return async (req: Request): Promise<Response> => {
    try {
      const auth = await deps.requireAuthUserForApp(req);
      if ('response' in auth) {
        return auth.response;
      }

      const user = auth.user;
      const activityToken = await deps.issueActivityToken(user.id);
      const db = deps.getDrizzleDbFromRuntime();
      const businessUser = db ? await deps.getBusinessUserById(db, user.id) : null;
      const ensuredUser = businessUser ? await deps.ensureBusinessUserLegacyAuthKey(businessUser) : null;
      const authKey = toNonEmptyString(ensuredUser?.authKey);

      return new Response(
        JSON.stringify({
          success: true,
          authKey,
          user: {
            id: user.id,
            username: user.username,
            prefix: user.prefix,
            is_banned: user.is_banned ?? null,
            is_admin: user.is_admin ?? 0,
            is_review_exempt: user.is_review_exempt ?? 0,
          },
          activityToken: activityToken ?? null,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } catch (error) {
      console.error('Verify error:', error);
      return new Response(JSON.stringify({ error: '验证失败，请稍后重试' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
};

export const createVerifyHandler = (overrides: Partial<VerifyDeps> = {}): ((req: Request) => Promise<Response>) => {
  return buildVerifyHandler({ ...defaultVerifyDeps, ...overrides });
};

export const POST = createVerifyHandler();
