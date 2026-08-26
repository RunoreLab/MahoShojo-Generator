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
    process.env.NODE_ENV,
  ),
};
