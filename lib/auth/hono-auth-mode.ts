export type HonoAuthMode = 'hybrid' | 'bearer';

export const readHonoAuthMode = (
  env: NodeJS.ProcessEnv = process.env,
): HonoAuthMode => {
  const raw = env.HONO_AUTH_MODE?.trim().toLowerCase() || 'hybrid';
  if (raw === 'hybrid' || raw === 'bearer') return raw;
  throw new Error(`HONO_AUTH_MODE 必须是 hybrid 或 bearer，当前值：${raw}`);
};

export const isBearerOnlyHonoAuthMode = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => readHonoAuthMode(env) === 'bearer';
