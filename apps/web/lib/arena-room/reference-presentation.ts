'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { ARENA_ROOM_PRESET_CATALOG } from './generated/arena-room-preset-catalog';
import { fetchPublicDataCardRowById } from '@/lib/public-card-cache/public-data-card-api';
import { getPublicCardByIdWithSharedCache } from '@/lib/public-card-cache/shared-loader';

export type ArenaRoomReferenceSource = 'preset' | 'data-card';

export type ArenaRoomReferenceRequest = Readonly<{
  source: ArenaRoomReferenceSource;
  kind: 'character' | 'scenario' | 'material';
  id: string;
  /** 房间引用身份的一部分：在线卡为服务器 updatedAt，预设为策展目录内容摘要。 */
  versionToken?: string;
}>;

/** 详情弹窗的请求：仅预设策展目录与在线公开卡可发起。 */
export type ArenaRoomReferenceDetailsRequest = Readonly<{
  source: ArenaRoomReferenceSource;
  kind: 'character' | 'scenario' | 'material';
  id: string;
  versionToken?: string;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** 策展目录内的预设名称是 web-safe 元数据，可直接同步展示。 */
export const arenaRoomPresetReferenceName = (
  kind: ArenaRoomReferenceRequest['kind'],
  id: string,
): string | null => (
  ARENA_ROOM_PRESET_CATALOG.find((entry) => entry.kind === kind && entry.id === id)?.displayName ?? null
);

/** 超过该长度的 ID（如 UUID）缩写展示；完整 ID 仍由调用方通过 title 暴露。 */
export const shortReferenceId = (id: string): string => (
  id.length <= 20 ? id : `${id.slice(0, 20)}…`
);

/**
 * 房间引用展示名解析：
 * - 预设引用使用策展目录 displayName；
 * - 在线公开引用使用公开卡缓存（memory/IndexedDB/网络）中的名称；
 * - 只有找不到时才回退到 ID 缩写。host-local stub 不经过本模块，
 *   继续展示房主主动分享的 displayName（安全边界）。
 */
export const formatArenaRoomReferenceName = (
  request: Pick<ArenaRoomReferenceRequest, 'source' | 'id'>,
  resolvedName: string | null | undefined,
): string => {
  if (resolvedName) return resolvedName;
  return request.source === 'preset' ? request.id : shortReferenceId(request.id);
};

type Listener = () => void;

const onlineNameCacheKey = (id: string, versionToken: string | undefined): string => (
  versionToken === undefined ? id : `${id}@${versionToken}`
);

const onlineNameCache = new Map<string, string>();
const onlineNameInFlight = new Set<string>();
/** 加载失败/未命中的负缓存：避免每次重渲染都重新发起请求形成渲染循环。 */
const onlineNameFailedAt = new Map<string, number>();
const ONLINE_NAME_RETRY_MS = 5 * 60 * 1000;
const listeners = new Set<Listener>();
let snapshot: ReadonlyMap<string, string> = new Map();

const emit = (): void => {
  snapshot = new Map(onlineNameCache);
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = (): ReadonlyMap<string, string> => snapshot;

const loadOnlineName = async (id: string, versionToken: string | undefined): Promise<void> => {
  const cacheKey = onlineNameCacheKey(id, versionToken);
  if (onlineNameCache.has(cacheKey) || onlineNameInFlight.has(cacheKey)) return;
  const failedAt = onlineNameFailedAt.get(cacheKey);
  if (failedAt !== undefined && Date.now() - failedAt < ONLINE_NAME_RETRY_MS) return;
  onlineNameInFlight.add(cacheKey);
  try {
    const result = await getPublicCardByIdWithSharedCache({
      id,
      fetcher: fetchPublicDataCardRowById,
    });
    const name = isRecord(result.card) ? text(result.card.name) : '';
    if (name && !onlineNameCache.has(cacheKey)) onlineNameCache.set(cacheKey, name);
    else if (!name) onlineNameFailedAt.set(cacheKey, Date.now());
    emit();
  } catch {
    // 名称是展示增强；加载失败记入负缓存并保持 ID 缩写回退即可。
    onlineNameFailedAt.set(cacheKey, Date.now());
  } finally {
    onlineNameInFlight.delete(cacheKey);
  }
};

/** 订阅在线公开卡名称缓存；对未知 (id, versionToken) 触发一次后台加载。 */
export const useArenaRoomReferenceNames = (
  requests: readonly ArenaRoomReferenceRequest[],
): ReadonlyMap<string, string> => {
  const onlineCacheKeys = useMemo(
    () => [...new Set(requests
      .filter((request) => request.source === 'data-card')
      .map((request) => onlineNameCacheKey(request.id, request.versionToken)))],
    [requests],
  );
  const requestKey = onlineCacheKeys.join('\n');

  useEffect(() => {
    const byKey = new Map(requests
      .filter((request) => request.source === 'data-card')
      .map((request) => [onlineNameCacheKey(request.id, request.versionToken), request] as const));
    onlineCacheKeys.forEach((cacheKey) => {
      const request = byKey.get(cacheKey);
      if (request) void loadOnlineName(request.id, request.versionToken);
    });
  }, [requestKey, onlineCacheKeys, requests]);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return snapshot;
};

export const arenaRoomReferenceRequestKey = (request: ArenaRoomReferenceRequest): string => (
  request.versionToken === undefined
    ? `${request.source}:${request.kind}:${request.id}`
    : `${request.source}:${request.kind}:${request.id}@${request.versionToken}`
);

/** 解析 `preset:<id>` / `data-card:<id>` 形式的房间共享 key。 */
export const parseArenaRoomReferenceKey = (
  key: string,
  fallbackKind: ArenaRoomReferenceRequest['kind'],
): ArenaRoomReferenceRequest | null => {
  if (key.startsWith('preset:')) {
    return { source: 'preset', kind: fallbackKind, id: key.slice('preset:'.length) };
  }
  if (key.startsWith('data-card:')) {
    return { source: 'data-card', kind: fallbackKind, id: key.slice('data-card:'.length) };
  }
  return null;
};

/** 预设走策展目录同步解析，在线公开卡按 (id, versionToken) 走名称缓存；都没有时返回 null。 */
export const resolveArenaRoomReferenceName = (
  request: ArenaRoomReferenceRequest,
  onlineNames: ReadonlyMap<string, string>,
): string | null => (
  request.source === 'preset'
    ? arenaRoomPresetReferenceName(request.kind, request.id)
    : onlineNames.get(onlineNameCacheKey(request.id, request.versionToken)) ?? null
);

/** 策展目录条目的版本摘要；目录外预设返回 null。 */
export const arenaRoomPresetReferenceVersionToken = (
  kind: ArenaRoomReferenceRequest['kind'],
  id: string,
): string | null => (
  ARENA_ROOM_PRESET_CATALOG.find((entry) => entry.kind === kind && entry.id === id)?.versionToken ?? null
);

/**
 * 预设引用请求：优先绑定房间引用的版本（引用身份），其次绑定策展目录当前版本
 * （目录外预设不带版本）。详情弹窗据此比较"引用版本 vs 站点当前版本"。
 */
export const presetReferenceRequest = (
  kind: ArenaRoomReferenceRequest['kind'],
  id: string,
  roomVersionToken?: string | null,
): ArenaRoomReferenceRequest => {
  const roomVersion = typeof roomVersionToken === 'string' ? roomVersionToken.trim() : '';
  const versionToken = roomVersion !== ''
    ? roomVersion
    : arenaRoomPresetReferenceVersionToken(kind, id);
  return versionToken === null
    ? { source: 'preset', kind, id }
    : { source: 'preset', kind, id, versionToken };
};

/** 在线公开卡引用请求：绑定引用身份中的 versionToken；ref 缺失时返回 null。 */
export const dataCardReferenceRequest = (
  kind: ArenaRoomReferenceRequest['kind'],
  ref: { readonly id: string; readonly versionToken?: string } | null | undefined,
): ArenaRoomReferenceRequest | null => (
  ref
    ? {
        source: 'data-card',
        kind,
        id: ref.id,
        ...(ref.versionToken === undefined ? {} : { versionToken: ref.versionToken }),
      }
    : null
);

/**
 * 房间引用版本是否已相对当前公开内容漂移：
 * 在线卡的 versionToken 即服务器元数据 updatedAt；预设为策展目录内容摘要。
 * 返回 null 表示请求未绑定版本或无法取得当前版本，无法判定。
 * 展示层只负责提示漂移；是否重新选择引用仍由用户通过正规编辑路径决定，
 * 接受时的 stale 校验始终以服务器权威判定为准。
 */
export const arenaRoomReferenceVersionDrifted = (
  expectedVersionToken: string | undefined,
  currentVersionToken: string | null | undefined,
): boolean | null => {
  if (typeof expectedVersionToken !== 'string' || expectedVersionToken === '') return null;
  const current = typeof currentVersionToken === 'string' ? currentVersionToken.trim() : '';
  if (!current) return null;
  return current !== expectedVersionToken;
};

/** 统一来源前缀：与提案摘要中的 在线:/预设: 命名空间一致。 */
export const arenaRoomReferenceSourcePrefix = (source: ArenaRoomReferenceSource): string => (
  source === 'preset' ? '预设' : '在线'
);
