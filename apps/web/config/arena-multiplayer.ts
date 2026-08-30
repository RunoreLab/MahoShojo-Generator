import { honoApiConfig } from './hono-api';

type ArenaHostedApiConfig = {
  readonly enabled: boolean;
  readonly origin: string;
  readonly target: 'local' | 'preview' | 'production' | 'test';
};

export type ArenaMultiplayerConfig = {
  readonly enabled: boolean;
  readonly origin: string;
};

const readFlag = (raw: string | undefined): boolean => {
  if (!raw?.trim()) return false;
  const value = raw.trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  throw new Error('NEXT_PUBLIC_ARENA_MULTIPLAYER_ENABLED 必须是 boolean flag');
};

export const resolveArenaMultiplayerConfig = (
  rawFlag: string | undefined,
  hostedApi: ArenaHostedApiConfig,
): ArenaMultiplayerConfig => {
  const enabled = readFlag(rawFlag);
  if (!enabled) return { enabled: false, origin: hostedApi.origin };
  if (hostedApi.target === 'production' || hostedApi.target === 'preview') {
    throw new Error('Arena multiplayer 在 Production Gate 前禁止开启');
  }
  if (!hostedApi.enabled) {
    throw new Error('Arena multiplayer 需要 Hono API enabled placement');
  }
  return { enabled: true, origin: hostedApi.origin };
};

export const arenaMultiplayerConfig = resolveArenaMultiplayerConfig(
  process.env.NEXT_PUBLIC_ARENA_MULTIPLAYER_ENABLED,
  honoApiConfig,
);
