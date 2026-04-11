'use client';

import type { ComponentProps } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import { mapPublicDataCardRowToDetailsCard } from '@/lib/data-card-read-mappers';
import { PRESET_LIST } from '@/lib/presets';
import { fetchPublicDataCardRowById, type PublicDataCardApiFetchLike } from '@/lib/public-card-cache/public-data-card-api';
import { getPublicCardByIdWithSharedCache } from '@/lib/public-card-cache/shared-loader';

export type LeaderboardEntityDetailsTarget = {
  entityType: 'data_card' | 'preset';
  entityId: string;
  displayName: string;
  authorName?: string | null;
  pendingNotice?: string | null;
};

type CacheEntry = {
  card: ComponentProps<typeof DataCardDetailsModal>['card'];
  metaCardId: string | null | undefined;
  pendingNotice: string | null;
};

const presetByFilename = new Map(PRESET_LIST.map((preset) => [preset.filename, preset]));

export type LoadLeaderboardEntityDetailsOptions = {
  fetcher?: PublicDataCardApiFetchLike;
  getNowMs?: () => number;
};

export const loadLeaderboardEntityDetails = async (
  entity: LeaderboardEntityDetailsTarget,
  options: LoadLeaderboardEntityDetailsOptions = {},
): Promise<CacheEntry> => {
  if (entity.entityType === 'data_card') {
    const result = await getPublicCardByIdWithSharedCache({
      id: entity.entityId,
      fetcher: (id) => fetchPublicDataCardRowById(id, { fetcher: options.fetcher }),
      allowedRecordSources: ['public-data-card-api'],
      getNowMs: options.getNowMs,
    });

    if (!result.card) {
      throw new Error('无法读取数据卡');
    }

    return {
      card: mapPublicDataCardRowToDetailsCard(result.card, {
        id: entity.entityId,
        name: entity.displayName,
        author:
          typeof entity.authorName === 'string' && entity.authorName.trim()
            ? entity.authorName.trim()
            : '未知',
      }),
      metaCardId: undefined,
      pendingNotice: entity.pendingNotice ?? null,
    };
  }

  const presetMeta = presetByFilename.get(entity.entityId);
  const response = await (options.fetcher ?? fetch)(`/presets/${encodeURIComponent(entity.entityId)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`无法加载预设设定文件（HTTP ${response.status}）`);
  }
  const presetData = (await response.json()) as unknown;

  const baseNotice = entity.pendingNotice ?? null;
  const pendingNotice = baseNotice
    ? `${baseNotice} · 预设角色不支持标签/指标查询（以排行榜展示为准）`
    : '预设角色不支持标签/指标查询（以排行榜展示为准）';

  return {
    card: {
      id: `preset:${entity.entityId}`,
      name: presetMeta?.name ?? entity.displayName,
      description: presetMeta?.description ?? '系统预设角色',
      type: 'character',
      data: JSON.stringify(presetData, null, 2),
      isPublic: true,
      author: '官方',
      usageCount: 0,
      likeCount: 0,
      favoriteCount: 0,
    },
    metaCardId: null,
    pendingNotice,
  };
};

export function LeaderboardEntityDetailsModal(props: {
  isOpen: boolean;
  onClose: () => void;
  entity: LeaderboardEntityDetailsTarget | null;
}) {
  const { isOpen, onClose, entity } = props;
  const [detailsCard, setDetailsCard] = useState<ComponentProps<typeof DataCardDetailsModal>['card'] | null>(null);
  const [detailsMetaCardId, setDetailsMetaCardId] = useState<string | null | undefined>(undefined);
  const [detailsPendingNotice, setDetailsPendingNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const requestIdRef = useRef(0);

  const modalTitle = useMemo(() => {
    if (!entity) return '角色详情';
    return entity.entityType === 'preset' ? '预设角色详情' : '数据卡详情';
  }, [entity]);

  useEffect(() => {
    if (!isOpen || !entity) return;

    const requestId = (requestIdRef.current += 1);
    const controller = new AbortController();

    setIsLoading(true);
    setError(null);
    setDetailsCard(null);
    setDetailsMetaCardId(undefined);
    setDetailsPendingNotice(entity.pendingNotice ?? null);

    void (async () => {
      try {
        const entry = await loadLeaderboardEntityDetails(entity, {
          fetcher: (input, init) =>
            fetch(input, {
              ...init,
              signal: controller.signal,
            }),
        });

        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        setDetailsCard(entry.card);
        setDetailsMetaCardId(entry.metaCardId);
        setDetailsPendingNotice(entry.pendingNotice);
      } catch (err) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [entity, isOpen, retryNonce]);

  if (!isOpen || !entity) return null;

  if (isLoading || !detailsCard) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <div className="text-base font-semibold text-gray-900">{modalTitle}</div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            >
              关闭
            </button>
          </div>
          {detailsPendingNotice ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {detailsPendingNotice}
            </div>
          ) : null}
          <div className="mt-4 text-sm text-gray-600">
            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
                <div>加载失败：{error}</div>
                <button
                  type="button"
                  onClick={() => setRetryNonce((prev) => prev + 1)}
                  className="mt-2 rounded-md bg-white px-2 py-1 text-xs text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
                >
                  重试
                </button>
              </div>
            ) : (
              '正在加载角色详情...'
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <DataCardDetailsModal
      isOpen
      onClose={onClose}
      card={detailsCard}
      pendingNotice={detailsPendingNotice ?? undefined}
      metaCardId={detailsMetaCardId}
    />
  );
}
