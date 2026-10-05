'use client';

// Web 运行地的 CardLibraryHost 装配（D5.0e）。
// 在线通路复用既有 Web 传输面：bounded-retry fetch、authStorage 鉴权、
// favoritesApi/deckApi、`/api/*` 固定路由；本地面复用浏览器 IndexedDB 仓储。
// 新增桌面宿主时不得反向 import 本文件——共享语义在 @mahoshojo/ui-web/card-library。

import Link from 'next/link';
import { useMemo } from 'react';
import type {
  BadgeDefinition,
  CardLibraryCardMeta,
  CardLibraryHost,
  CardLibraryOnlinePort,
  CardLibraryPlatform,
  CardLibraryPublicCardBody,
  CardLibraryPublicListBody,
  CardLibraryPublicListQuery,
  CardLibrarySlots,
  CardLibraryTag,
} from '@mahoshojo/ui-web/card-library';
import { useAuth } from '@/lib/useAuth';
import { authStorage, deckApi, favoritesApi } from '@/lib/auth';
import { fetchJsonWithBoundedRetry } from '@/lib/bounded-fetch';
import { getDataCardSummaryPage, loadFullDataCard } from '@/lib/data-card-list-client';
import { getLocalCardRepository } from '@/lib/local-library/card-repository';
import { addLikedCard, addUsedCard, isCardLiked, isCardUsed } from '@/lib/localStorage';
import { downloadBlob } from '@/lib/client/blobUrl';
import { copyCardText, reportDataCardStat, WebCardLibraryLink } from '@/lib/card-tile-platform';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import DecksModal from '@/components/DecksModal';
import { LocalLibraryStatusNote } from '@/components/shared/LocalLibraryStatusNote';

const serializePublicListQuery = (query: CardLibraryPublicListQuery): string => {
  const params = new URLSearchParams({
    type: query.type,
    limit: query.limit.toString(),
    offset: query.offset.toString(),
    sortBy: query.sortBy,
    // 列表只要摘要投影：正文按需经 loadFullCard/fetchPublicCardById 单独取，
    // 与 Desktop native 4MiB 响应上限兼容（D5.0e-r1）。
    view: 'summary',
  });
  if (query.search) params.append('search', query.search);
  if (query.tagIds && query.tagIds.length > 0) {
    params.append('tagIds', query.tagIds.join(','));
    if (query.tagMatch === 'all') params.append('tagMatch', 'all');
  }
  if (query.author) params.append('author', query.author);
  if (query.minLikes) params.append('minLikes', query.minLikes);
  if (query.maxLikes) params.append('maxLikes', query.maxLikes);
  if (query.minUsage) params.append('minUsage', query.minUsage);
  if (query.maxUsage) params.append('maxUsage', query.maxUsage);
  if (query.minFavorites) params.append('minFavorites', query.minFavorites);
  if (query.maxFavorites) params.append('maxFavorites', query.maxFavorites);
  if (query.roleType) params.append('roleType', query.roleType);
  if (query.recommendedOnly) params.append('recommendedOnly', '1');
  if (query.nativeOnly) params.append('nativeOnly', '1');
  if (query.nativeAllowedOnly) params.append('nativeAllowedOnly', '1');
  return params.toString();
};

const fetchCardMetaBatch = async (
  cardIds: readonly string[],
  signal: AbortSignal,
): Promise<Record<string, CardLibraryCardMeta> | null> => {
  const authHeader = await authStorage.getAuthHeader();
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (authHeader) headers.Authorization = authHeader;
  const res = await fetch('/api/data-card-meta-batch', {
    method: 'POST',
    headers,
    body: JSON.stringify({ dataCardIds: [...cardIds] }),
    signal,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as any;
  if (!json || json.success !== true || typeof json.items !== 'object' || !json.items) return null;
  const out: Record<string, CardLibraryCardMeta> = {};
  for (const [id, item] of Object.entries<any>(json.items)) {
    const metrics = item?.metrics ?? null;
    const strict = item?.strict ?? null;
    out[id] = {
      techScore: typeof metrics?.techScore === 'number' ? metrics.techScore : null,
      techLevel: typeof metrics?.techLevel === 'string' ? metrics.techLevel : null,
      strictTier: typeof strict?.tier === 'string' ? strict.tier : null,
      isNative: typeof metrics?.isNative === 'boolean' ? metrics.isNative : null,
    };
  }
  return out;
};

const fetchAuthorBadgesBatch = async (
  userIds: readonly number[],
  signal: AbortSignal,
): Promise<Record<number, BadgeDefinition[]> | null> => {
  const res = await fetch('/api/badges/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds: [...userIds] }),
    signal,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as any;
  if (!json || json.success !== true || typeof json.items !== 'object' || !json.items) return null;
  const out: Record<number, BadgeDefinition[]> = {};
  for (const [uid, badges] of Object.entries<any>(json.items)) {
    const userId = Number(uid);
    if (userId > 0 && Array.isArray(badges)) out[userId] = badges;
  }
  return out;
};

const webOnlinePort: CardLibraryOnlinePort = {
  fetchSummaryPage: (source, query, signal) => getDataCardSummaryPage(source, query, signal),
  fetchPublicCards: (query, signal) =>
    fetchJsonWithBoundedRetry<CardLibraryPublicListBody>(`/api/public-data-cards?${serializePublicListQuery(query)}`, { signal }),
  fetchPublicCardById: (cardId, signal) =>
    fetchJsonWithBoundedRetry<CardLibraryPublicCardBody>(`/api/public-data-cards?id=${encodeURIComponent(cardId)}`, { signal }),
  loadFullCard: (card, source, signal) => loadFullDataCard(card, source, signal),
  async listTags() {
    try {
      const response = await fetch('/api/tags?includeInactive=1');
      if (!response.ok) {
        return { ok: false, error: `标签库加载失败（${response.status}）` };
      }
      const json = (await response.json()) as { success: boolean; tags?: CardLibraryTag[]; error?: string };
      if (!json?.success) {
        return { ok: false, error: json?.error ?? '标签库加载失败' };
      }
      return { ok: true, tags: Array.isArray(json.tags) ? json.tags : [] };
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
    }
  },
  listFavoriteIds: () => favoritesApi.getFavorites({ idsOnly: true }),
  addFavorite: (cardId) => favoritesApi.add(cardId),
  removeFavorite: (cardId) => favoritesApi.remove(cardId),
  getDeckCards: (deckId) => deckApi.getDeckCards(deckId),
  reportCardStat: reportDataCardStat,
  fetchCardMetaBatch,
  fetchAuthorBadgesBatch,
};

const webPlatform: CardLibraryPlatform = {
  Link: WebCardLibraryLink,
  marks: {
    isLiked: isCardLiked,
    markLiked: addLikedCard,
    isUsed: isCardUsed,
    markUsed: addUsedCard,
  },
  copyText: copyCardText,
  downloadJson(fileName, jsonText) {
    downloadBlob(new Blob([jsonText], { type: 'application/json' }), fileName);
  },
};

const webSlots: CardLibrarySlots = {
  CardDetailsModal: DataCardDetailsModal,
  DecksModal,
  renderLocalLibraryBanner: () => (
    <>
      <LocalLibraryStatusNote />
      <Link
        href="/local-library"
        target="_blank"
        rel="noopener noreferrer"
        prefetch={false}
        className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-purple-700 hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600"
      >
        本地库管理与整库导入导出（新标签页）
      </Link>
    </>
  ),
  localLibraryLink: (
    <Link
      href="/encyclopedia/local-library"
      className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
    >
      本地库说明
    </Link>
  ),
};

/** 组装 Web 运行地的数据卡选择器宿主。`auth` 每次渲染重取，其余通路是模块级常量。 */
export function useWebCardLibraryHost(): CardLibraryHost {
  const { isAuthenticated, user, userBadges, loading } = useAuth();
  // 三态投影（D5.0e-r1）：auth store 还在恢复/校验会话时是 `unknown`，
  // 不能把它折叠成「已登出」——否则开启校验中的账号页签与收藏态会被误清。
  const authStatus = loading ? 'unknown' : isAuthenticated ? 'authenticated' : 'unauthenticated';
  return useMemo(
    () => ({
      auth: {
        status: authStatus,
        userId: user?.id ?? null,
        userBadges: userBadges ?? [],
      },
      online: webOnlinePort,
      local: { repository: getLocalCardRepository() },
      platform: webPlatform,
      slots: webSlots,
    }),
    [authStatus, user?.id, userBadges],
  );
}
