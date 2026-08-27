import {
  hostedDrPreviewOrigin,
  hostedDrStableOrigin,
} from './hosted-dr-client.generated';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const isLoopbackDevelopmentOrigin = (origin: string): boolean => {
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol)
      && LOOPBACK_HOSTS.has(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
};

export const resolveHostedApiOrigin = (
  configuredOrigin: string | undefined,
  environment: string | undefined,
): string => {
  const origin = configuredOrigin?.trim();
  const normalizedEnvironment = environment?.trim().toLowerCase() || 'development';

  if (normalizedEnvironment === 'production') {
    if (!origin || origin === hostedDrStableOrigin) return hostedDrStableOrigin;
    throw new Error(
      'production 环境的 NEXT_PUBLIC_HONO_API_ORIGIN 只能使用 manifest 声明的 stable origin',
    );
  }

  if (normalizedEnvironment === 'preview') {
    if (origin === hostedDrPreviewOrigin) return hostedDrPreviewOrigin;
    throw new Error(
      'preview 环境必须显式使用 manifest 声明的 preview origin，且不得回退到 stable origin',
    );
  }

  if (!origin || origin === hostedDrStableOrigin || origin === hostedDrPreviewOrigin) {
    return origin || hostedDrStableOrigin;
  }
  if (environment !== 'production' && isLoopbackDevelopmentOrigin(origin)) return origin;
  throw new Error(
    'NEXT_PUBLIC_HONO_API_ORIGIN 必须是 manifest 声明的 stable/preview origin，'
    + '或非 production 的 loopback origin',
  );
};

export const honoApiConfig = {
  enabled: true,
  // Production clients consume stable/explicit preview logical entries only;
  // physical primary/DR origins remain server/control-plane contract details.
  origin: resolveHostedApiOrigin(
    process.env.NEXT_PUBLIC_HONO_API_ORIGIN,
    process.env.NEXT_PUBLIC_HOSTED_API_ENVIRONMENT?.trim() || process.env.NODE_ENV,
  ),
};
