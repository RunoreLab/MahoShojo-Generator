import { honoApiConfig } from './hono-api';
import { arenaRoomClientTargets } from './arena-room-origins.generated';

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
  readonly origin?: string;
  readonly writerActivation?: string;
  readonly readerContract?: string;
  readonly goNoGo?: string;
  readonly targets: Readonly<Record<'production' | 'preview', {
    readonly logicalOrigin: string;
    readonly provisioning: 'not-provisioned' | 'provisioned';
  }>>;
};

const readFlag = (raw: string | undefined): boolean => {
  if (!raw?.trim()) return false;
  const value = raw.trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  throw new Error('NEXT_PUBLIC_ARENA_MULTIPLAYER_ENABLED 必须是 boolean flag');
};

const isCanonicalHttpsOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash
      && url.origin === value;
  } catch {
    return false;
  }
};

export const resolveArenaMultiplayerConfig = (
  rawFlag: string | undefined,
  hostedApi: ArenaHostedApiConfig,
  activation: ArenaMultiplayerActivation = {
    origin: process.env.NEXT_PUBLIC_ARENA_ROOM_ORIGIN,
    writerActivation: process.env.NEXT_PUBLIC_ARENA_ROOM_WRITER_ACTIVATION,
    readerContract: process.env.NEXT_PUBLIC_ARENA_ROOM_READER_CONTRACT,
    goNoGo: process.env.NEXT_PUBLIC_ARENA_ROOM_GO_NO_GO,
    targets: arenaRoomClientTargets,
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

  const roomTarget = activation.targets[hostedApi.target];
  const expectedOrigin = roomTarget.logicalOrigin;
  const origin = activation.origin?.trim() ?? '';
  if (!isCanonicalHttpsOrigin(origin) || origin !== expectedOrigin) {
    throw new Error('Arena multiplayer protected target 必须使用 manifest 已声明的 logical Room origin');
  }
  if (roomTarget.provisioning !== 'provisioned') {
    throw new Error('Arena multiplayer logical Room origin 尚未 provision');
  }
  return { enabled: true, origin };
};

export const arenaMultiplayerConfig = resolveArenaMultiplayerConfig(
  process.env.NEXT_PUBLIC_ARENA_MULTIPLAYER_ENABLED,
  honoApiConfig,
);
