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
}>;

/** 详情弹窗的请求：仅预设策展目录与在线公开卡可发起。 */
export type ArenaRoomReferenceDetailsRequest = Readonly<{
  source: ArenaRoomReferenceSource;
  kind: 'character' | 'scenario' | 'material';
  id: string;
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

const loadOnlineName = async (id: string): Promise<void> => {
  if (onlineNameCache.has(id) || onlineNameInFlight.has(id)) return;
  const failedAt = onlineNameFailedAt.get(id);
  if (failedAt !== undefined && Date.now() - failedAt < ONLINE_NAME_RETRY_MS) return;
  onlineNameInFlight.add(id);
  try {
    const result = await getPublicCardByIdWithSharedCache({
      id,
      fetcher: fetchPublicDataCardRowById,
    });
    const name = isRecord(result.card) ? text(result.card.name) : '';
    if (name && !onlineNameCache.has(id)) onlineNameCache.set(id, name);
    else if (!name) onlineNameFailedAt.set(id, Date.now());
    emit();
  } catch {
    // 名称是展示增强；加载失败记入负缓存并保持 ID 缩写回退即可。
    onlineNameFailedAt.set(id, Date.now());
  } finally {
    onlineNameInFlight.delete(id);
  }
};

/** 订阅在线公开卡名称缓存；对未知 ID 触发一次后台加载。 */
export const useArenaRoomReferenceNames = (
  requests: readonly ArenaRoomReferenceRequest[],
): ReadonlyMap<string, string> => {
  const onlineIds = useMemo(
    () => [...new Set(requests.filter((request) => request.source === 'data-card').map((request) => request.id))],
    [requests],
  );
  const requestKey = onlineIds.join('\n');

  useEffect(() => {
    onlineIds.forEach((id) => { void loadOnlineName(id); });
  }, [requestKey, onlineIds]);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return snapshot;
};

export const arenaRoomReferenceRequestKey = (request: ArenaRoomReferenceRequest): string => (
  `${request.source}:${request.kind}:${request.id}`
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

/** 预设走策展目录同步解析，在线公开卡走名称缓存；都没有时返回 null。 */
export const resolveArenaRoomReferenceName = (
  request: ArenaRoomReferenceRequest,
  onlineNames: ReadonlyMap<string, string>,
): string | null => (
  request.source === 'preset'
    ? arenaRoomPresetReferenceName(request.kind, request.id)
    : onlineNames.get(request.id) ?? null
);

/** 统一来源前缀：与提案摘要中的 在线:/预设: 命名空间一致。 */
export const arenaRoomReferenceSourcePrefix = (source: ArenaRoomReferenceSource): string => (
  source === 'preset' ? '预设' : '在线'
);
