import { honoApiConfig } from './hono-api';
import {
  hostedDrClientRouting,
  hostedDrPreviewOrigin,
} from './hosted-dr-client.generated';

const ARENA_ROOM_CHECKPOINT_CONTRACT =
  'arena-room-authority-v2-generation-payload-digest-v1';

type ArenaHostedApiConfig = {
  readonly enabled: boolean;
  readonly origin: string;
  readonly target: 'local' | 'preview' | 'production' | 'test';
};

export type ArenaMultiplayerConfig = {
  readonly enabled: boolean;
  readonly origin: string;
};

type ArenaMultiplayerActivation = {
  readonly writerActivation?: string;
  readonly readerContract?: string;
  readonly goNoGo?: string;
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
  activation: ArenaMultiplayerActivation = {
    writerActivation: process.env.NEXT_PUBLIC_ARENA_ROOM_WRITER_ACTIVATION,
    readerContract: process.env.NEXT_PUBLIC_ARENA_ROOM_READER_CONTRACT,
    goNoGo: process.env.NEXT_PUBLIC_ARENA_ROOM_GO_NO_GO,
  },
): ArenaMultiplayerConfig => {
  const enabled = readFlag(rawFlag);
  if (!enabled) return { enabled: false, origin: hostedApi.origin };
  if (!hostedApi.enabled) {
    throw new Error('Arena multiplayer 需要 Hono API enabled placement');
  }
  if (hostedApi.target !== 'production' && hostedApi.target !== 'preview') {
    return { enabled: true, origin: hostedApi.origin };
  }

  if (activation.writerActivation !== 'enabled') {
    throw new Error('Arena multiplayer protected activation 缺少 writer activation 证明');
  }
  if (activation.readerContract !== ARENA_ROOM_CHECKPOINT_CONTRACT) {
    throw new Error('Arena multiplayer protected activation 的 reader contract 不兼容');
  }
  if (activation.goNoGo !== 'approved') {
    throw new Error('Arena multiplayer protected activation 缺少 go/no-go approval');
  }

  return {
    enabled: true,
    origin: hostedApi.target === 'production'
      ? hostedDrClientRouting.primaryOrigin
      : hostedDrPreviewOrigin,
  };
};

export const arenaMultiplayerConfig = resolveArenaMultiplayerConfig(
  process.env.NEXT_PUBLIC_ARENA_MULTIPLAYER_ENABLED,
  honoApiConfig,
);
