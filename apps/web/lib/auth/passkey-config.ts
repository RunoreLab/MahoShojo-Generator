import 'server-only';
import { parseHostedApiDeploymentTarget } from '@mahoshojo/hosted-api/hosted-dr';
import { parseTrustedBetterAuthBaseUrl } from '@/lib/auth/trusted-better-auth-url';

export const PRODUCTION_PASSKEY_ORIGIN = 'https://mahoshojo.colanns.me';

export type PasskeyConfig = {
  origin: string;
  rpId: string;
  local: boolean;
};

export function readPasskeyConfig(env: NodeJS.ProcessEnv = process.env): PasskeyConfig | null {
  const configured = env.PASSKEY_ORIGIN?.trim();
  if (!configured || !env.BETTER_AUTH_URL?.trim()) return null;

  try {
    const target = parseHostedApiDeploymentTarget(env.NEXT_PUBLIC_HOSTED_API_ENVIRONMENT);
    const local = target === 'local' || target === 'test' || (!target && env.NODE_ENV === 'development');
    const trustedOrigin = parseTrustedBetterAuthBaseUrl(env.BETTER_AUTH_URL, { allowLocalHttp: local });
    const url = new URL(configured);
    if (configured !== url.origin || trustedOrigin.origin !== url.origin) return null;
    if (local ? url.hostname !== 'localhost' : url.protocol !== 'https:' || url.port) return null;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if ((target === 'production') !== (url.origin === PRODUCTION_PASSKEY_ORIGIN)) return null;
    if (!local && target !== 'production' && target !== 'preview') return null;
    return { origin: url.origin, rpId: url.hostname, local };
  } catch {
    return null;
  }
}
