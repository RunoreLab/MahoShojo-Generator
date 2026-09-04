'use client';

import { useEffect, useRef, useState } from 'react';

import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import { OnlineDataCardTypeSchema, type OnlineDataCardType } from '@mahoshojo/contracts/data-cards';

import { ARENA_ROOM_PRESET_CATALOG } from '@/lib/arena-room/generated/arena-room-preset-catalog';
import { fetchPublicDataCardRowById } from '@/lib/public-card-cache/public-data-card-api';
import type { ArenaRoomReferenceDetailsRequest } from '@/lib/arena-room/reference-presentation';

type DetailsCard = React.ComponentProps<typeof DataCardDetailsModal>['card'];

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const loadOnlineCard = async (id: string): Promise<DetailsCard> => {
  const result = await fetchPublicDataCardRowById(id);
  if (result.kind !== 'success') {
    throw new Error(result.kind === 'not-found'
      ? '该公开数据卡不存在或已删除'
      : '该公开数据卡暂时无法读取');
  }
  if (!result.card || typeof result.card !== 'object' || Array.isArray(result.card)) {
    throw new Error('该公开数据卡正文无效');
  }
  const row = result.card as Record<string, unknown>;
  const parsedType = OnlineDataCardTypeSchema.safeParse(row.type);
  const type: OnlineDataCardType = parsedType.success ? parsedType.data : 'character';
  return {
    id: text(row.id) || id,
    name: text(row.name) || id,
    description: text(row.description) || '房间引用的公开数据卡',
    type,
    data: typeof row.data === 'string' ? row.data : JSON.stringify(row.data ?? {}, null, 2),
    isPublic: true,
    usageCount: typeof row.usage_count === 'number' ? row.usage_count : undefined,
    likeCount: typeof row.like_count === 'number' ? row.like_count : undefined,
    favoriteCount: typeof row.favorite_count === 'number' ? row.favorite_count : undefined,
    author: text(row.username) || '—',
    createdAt: text(row.created_at) || undefined,
    updatedAt: text(row.updated_at) || text(row.updatedAt) || undefined,
  };
};

const loadPresetCard = async (
  kind: ArenaRoomReferenceDetailsRequest['kind'],
  id: string,
): Promise<DetailsCard> => {
  const entry = ARENA_ROOM_PRESET_CATALOG.find((item) => item.id === id && item.kind === kind);
  if (!entry) throw new Error('该预设不在房间策展目录内');
  const basePath = kind === 'character' ? '/presets/' : kind === 'scenario' ? '/scenario-presets/' : null;
  if (!basePath) throw new Error('暂不支持查看该类型预设的详情');
  const response = await fetch(`${basePath}${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error('该预设内容暂时无法读取');
  const payload: unknown = await response.json();
  return {
    id: entry.id,
    name: entry.displayName,
    description: '房间内置预设（由作者维护、随站点发布）',
    type: entry.kind,
    data: JSON.stringify(payload, null, 2),
    isPublic: true,
    author: '系统',
  };
};

/**
 * 房间引用详情弹窗：仅面向可安全读取的引用（预设策展目录 / 在线公开数据卡）。
 * host-local stub 不产生详情请求，也不会进入本组件。
 */
export function ArenaRoomReferenceDetailsDialog({
  request,
  onClose,
}: {
  readonly request: ArenaRoomReferenceDetailsRequest | null;
  readonly onClose: () => void;
}) {
  const [card, setCard] = useState<DetailsCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    if (!request) {
      setCard(null);
      setError(null);
      return;
    }
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setCard(null);
    setError(null);
    let cancelled = false;
    void (request.source === 'data-card'
      ? loadOnlineCard(request.id)
      : loadPresetCard(request.kind, request.id)
    ).then((loaded) => {
      if (!cancelled && loadGenerationRef.current === generation) setCard(loaded);
    }).catch((loadError: unknown) => {
      if (!cancelled && loadGenerationRef.current === generation) {
        setError(loadError instanceof Error ? loadError.message : '详情暂时无法读取');
      }
    });
    return () => { cancelled = true; };
  }, [request]);

  if (!request) return null;
  if (error) {
    return (
      <div
        role="alert"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={onClose}
      >
        <div
          className="max-w-sm rounded-xl bg-white p-4 text-sm text-red-700 dark:bg-gray-900 dark:text-red-300"
          onClick={(event) => event.stopPropagation()}
        >
          <p>{error}</p>
          <button
            type="button"
            className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    );
  }
  if (!card) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div
          className="rounded-xl bg-white px-6 py-4 text-sm text-gray-600 dark:bg-gray-900 dark:text-gray-300"
          onClick={(event) => event.stopPropagation()}
          role="status"
        >
          正在加载详情…
        </div>
      </div>
    );
  }
  return (
    <DataCardDetailsModal
      isOpen
      onClose={onClose}
      card={card}
      metaCardId={request.source === 'data-card' ? card.id : null}
    />
  );
}
