// Desktop 运行地的 CardLibraryHost 装配（D5.0e，`DESK-ONLINE-010`）。
//
// 在线通路不 fetch `/api/*`：每条调用映射到 `desktop-cloud` 契约的固定路由
// 标识，method/path/会话 cookie 由 native 侧注入（D5.0e-2 的卡库通路）。
// 本地面复用 `IpcLocalCardRepository`（SQLite，设备所有，离线可用）。
// 本文件只组装端口；交互语义全部在 @mahoshojo/ui-web/card-library。

import { useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link, useRouter } from '@tanstack/react-router';
import { DataCardSummaryPageSchema } from '@mahoshojo/contracts/data-cards';
import { normalizeQuestionnaireDataCard } from '@mahoshojo/domain/questionnaire-card';
import {
  createLocalStorageCardLibraryMarks,
  type BadgeDefinition,
  type CardLibraryAuthState,
  type CardLibraryCardMeta,
  type CardLibraryHost,
  type CardLibraryLinkProps,
  type CardLibraryOnlinePort,
  type CardLibraryPlatform,
  type CardLibraryPublicCachePort,
  type CardLibraryPublicListQuery,
  type CardLibraryRemoteResult,
  type CardLibrarySlots,
  type CardLibraryTag,
} from '@mahoshojo/ui-web/card-library';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';

import { requestCardLibraryRoute } from './card-library-bridge';
import { DesktopCloudError, type InvokeFn } from './cloud-bridge';
import { queryPublicReadCache, readPublicCacheCard } from './public-cache-bridge';
import { downloadTextFile } from './download-text-file';
import { IpcLocalCardRepository } from './local-card-bridge';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from '../app/hash-history-fragment';
import { useDesktopCloudSession } from '../features/account/use-desktop-cloud-session';
import type {
  DesktopCardLibraryRouteId,
} from '@mahoshojo/contracts/desktop-cloud';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const bodyError = (body: unknown): string | null => {
  const error = asRecord(body)?.error;
  return typeof error === 'string' && error.trim() ? error : null;
};

const describeCause = (cause: unknown, fallback: string): string =>
  cause instanceof DesktopCloudError
    ? (cause.code === 'not-authenticated' ? '需要登录云端账号' : cause.message)
    : cause instanceof Error
      ? cause.message
      : fallback;

/**
 * native IPC 无法中途取消已发出的 HTTP；abort 的语义是「调用方不再认领结果」。
 * 这里把它物化成 rejection，让共享 hooks 的 `signal.aborted` 检查继续成立。
 */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (cause) => { signal.removeEventListener('abort', onAbort); reject(cause); },
    );
  });
}

const serializeQuery = (
  entries: Record<string, string | number | boolean | undefined>,
): Record<string, string> => {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === '') continue;
    query[key] = String(value);
  }
  return query;
};

const serializePublicListQuery = (query: CardLibraryPublicListQuery): Record<string, string> => {
  const params: Record<string, string> = {
    type: query.type,
    limit: String(query.limit),
    offset: String(query.offset),
    sortBy: query.sortBy,
    // 列表只要摘要投影，正文按需经 loadFullCard/单卡路由单独取（D5.0e-r1）。
    view: 'summary',
  };
  if (query.search) params.search = query.search;
  if (query.tagIds && query.tagIds.length > 0) {
    params.tagIds = query.tagIds.join(',');
    if (query.tagMatch === 'all') params.tagMatch = 'all';
  }
  if (query.author) params.author = query.author;
  if (query.minLikes) params.minLikes = query.minLikes;
  if (query.maxLikes) params.maxLikes = query.maxLikes;
  if (query.minUsage) params.minUsage = query.minUsage;
  if (query.maxUsage) params.maxUsage = query.maxUsage;
  if (query.minFavorites) params.minFavorites = query.minFavorites;
  if (query.maxFavorites) params.maxFavorites = query.maxFavorites;
  if (query.roleType) params.roleType = query.roleType;
  if (query.recommendedOnly) params.recommendedOnly = '1';
  if (query.nativeOnly) params.nativeOnly = '1';
  if (query.nativeAllowedOnly) params.nativeAllowedOnly = '1';
  return params;
};

/**
 * 组装 Desktop 的在线端口。`invokeFn` 可注入便于测试；方法体内不假设登录态——
 * `required` 路由由 native 在无会话时 fail-closed（`not-authenticated`），
 * `optional` 路由断网/未登录照样工作（与 Web 公开库语义一致）。
 */
export const createDesktopCardLibraryOnlinePort = (invokeFn: InvokeFn): CardLibraryOnlinePort => {
  const call = (
    routeId: DesktopCardLibraryRouteId,
    query?: Record<string, string>,
    body?: unknown,
  ) => requestCardLibraryRoute(invokeFn, { routeId, ...(query ? { query } : {}), ...(body !== undefined ? { body: body as never } : {}) });

  return {
    fetchSummaryPage: async (source, query, signal) => {
      const params = serializeQuery({ view: 'summary' });
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
        params[key] = Array.isArray(value) ? value.join(',') : String(value);
      }
      const res = await withAbort(
        call(source === 'my' ? 'data-cards.query' : 'favorites.query', params),
        signal,
      );
      const body = asRecord(res.body);
      if (res.status < 200 || res.status >= 300 || body?.success === false) {
        throw new Error(bodyError(res.body) ?? `数据卡加载失败（HTTP ${res.status}）`);
      }
      return DataCardSummaryPageSchema.parse(res.body);
    },

    fetchPublicCards: async (query, signal) => {
      const res = await withAbort(
        call('public-data-cards.query', serializePublicListQuery(query)),
        signal,
      );
      const ok = res.status >= 200 && res.status < 300;
      return { ok, status: res.status, data: res.body } as CardLibraryRemoteResult<never>;
    },

    fetchPublicCardById: async (cardId, signal) => {
      const res = await withAbort(
        call('public-data-cards.query', { id: cardId }),
        signal,
      );
      const ok = res.status >= 200 && res.status < 300;
      return { ok, status: res.status, data: res.body } as CardLibraryRemoteResult<never>;
    },

    loadFullCard: async (card, source, signal) => {
      // 与 Web `loadFullDataCard` 同语义：列表行已带正文直接返回；
      // 「我的」走鉴权路由，其余走公开路由；旧问卷卡在合并后归一化。
      const row = card as Record<string, unknown>;
      if (typeof row?.data === 'string') return card;
      const res = await withAbort(
        call(source === 'my' ? 'data-cards.query' : 'public-data-cards.query', { id: String(row?.id ?? '') }),
        signal,
      );
      const body = asRecord(res.body);
      const remoteCard = asRecord(body?.card);
      if (res.status < 200 || res.status >= 300 || body?.success === false || typeof remoteCard?.data !== 'string') {
        throw new Error(bodyError(res.body) ?? '数据卡不存在或无权访问');
      }
      const full = { ...row, ...remoteCard };
      if (row.isLegacyQuestionnaire) {
        const normalized = normalizeQuestionnaireDataCard(full);
        if (!normalized) throw new Error('该旧卡内容不是有效的问卷，请在角色管理中检查原卡');
        return normalized;
      }
      return full;
    },

    listTags: async (signal) => {
      try {
        const res = await withAbort(call('tags.query', { includeInactive: '1' }), signal);
        const body = asRecord(res.body);
        if (res.status < 200 || res.status >= 300 || body?.success !== true) {
          return { ok: false, error: bodyError(res.body) ?? `标签库加载失败（${res.status}）` };
        }
        return { ok: true, tags: Array.isArray(body.tags) ? (body.tags as CardLibraryTag[]) : [] };
      } catch (cause) {
        return { ok: false, error: describeCause(cause, '标签库加载失败') };
      }
    },

    listFavoriteIds: async () => {
      try {
        const res = await call('favorites.query', { idsOnly: '1' });
        if (res.status < 200 || res.status >= 300) return { success: false, favorites: [] };
        const body = asRecord(res.body);
        return { success: body?.success !== false, favorites: Array.isArray(body?.favorites) ? body.favorites as string[] : [] };
      } catch {
        return { success: false, favorites: [] };
      }
    },

    addFavorite: async (cardId) => {
      try {
        const res = await call('favorites.add', undefined, { cardId });
        const body = asRecord(res.body);
        return res.status >= 200 && res.status < 300 ? (body ?? { success: true }) : { success: false, ...(body ?? {}) };
      } catch (cause) {
        return { success: false, error: describeCause(cause, '收藏失败') };
      }
    },

    removeFavorite: async (cardId) => {
      try {
        const res = await call('favorites.remove', undefined, { cardId });
        const body = asRecord(res.body);
        return res.status >= 200 && res.status < 300 ? (body ?? { success: true }) : { success: false, ...(body ?? {}) };
      } catch (cause) {
        return { success: false, error: describeCause(cause, '取消收藏失败') };
      }
    },

    getDeckCards: async (deckId) => {
      try {
        const res = await call('deck-cards.query', { deckId });
        const body = asRecord(res.body);
        if (res.status < 200 || res.status >= 300 || !body || !Array.isArray(body.cards)) return null;
        return { cards: body.cards as Array<{ isAccessible?: boolean; card?: unknown }> };
      } catch {
        return null;
      }
    },

    reportCardStat: async (cardId, stat) => {
      try {
        const res = await call('data-card-stats.report', undefined, { cardId, type: stat });
        const body = asRecord(res.body);
        return res.status >= 200 && res.status < 300 && body?.success === true;
      } catch {
        return false;
      }
    },

    fetchCardMetaBatch: async (cardIds, signal) => {
      try {
        const res = await withAbort(
          call('data-card-meta-batch.query', undefined, { dataCardIds: [...cardIds] }),
          signal,
        );
        const body = asRecord(res.body);
        if (res.status < 200 || res.status >= 300 || body?.success !== true || !asRecord(body.items)) return null;
        const out: Record<string, CardLibraryCardMeta> = {};
        for (const [id, item] of Object.entries(asRecord(body.items)!)) {
          const record = asRecord(item);
          const metrics = asRecord(record?.metrics);
          const strict = asRecord(record?.strict);
          out[id] = {
            techScore: typeof metrics?.techScore === 'number' ? metrics.techScore : null,
            techLevel: typeof metrics?.techLevel === 'string' ? metrics.techLevel : null,
            strictTier: typeof strict?.tier === 'string' ? strict.tier : null,
            isNative: typeof metrics?.isNative === 'boolean' ? metrics.isNative : null,
          };
        }
        return out;
      } catch {
        return null;
      }
    },

    fetchAuthorBadgesBatch: async (userIds, signal) => {
      try {
        const res = await withAbort(
          call('badges-batch.query', undefined, { userIds: [...userIds] }),
          signal,
        );
        const body = asRecord(res.body);
        if (res.status < 200 || res.status >= 300 || body?.success !== true || !asRecord(body.items)) return null;
        const out: Record<number, BadgeDefinition[]> = {};
        for (const [uid, badges] of Object.entries(asRecord(body.items)!)) {
          const userId = Number(uid);
          if (userId > 0 && Array.isArray(badges)) out[userId] = badges as BadgeDefinition[];
        }
        return out;
      } catch {
        return null;
      }
    },

    /**
     * 「本地 → 线上副本」：本地记录创建为**新的**云端私有卡（isPublic: 0）。
     * 本地行没有服务器身份，这里不存在更新原卡的语义；失败只回错误，
     * 本地记录保持不变（DESK-ONLINE-010）。
     */
    uploadLocalRecord: async (record: LocalCardRecordV1) => {
      try {
        const res = await call('data-cards.create', undefined, {
          type: record.cardType,
          name: record.title,
          description: '',
          data: record.data,
          isPublic: 0,
        });
        const body = asRecord(res.body);
        if (res.status < 200 || res.status >= 300 || body?.success === false) {
          return { ok: false, error: bodyError(res.body) ?? `上传失败（HTTP ${res.status}）` };
        }
        return { ok: true };
      } catch (cause) {
        return { ok: false, error: describeCause(cause, '上传到云端失败，请重试') };
      }
    },
  };
};

/**
 * Desktop 侧链接组件：只接管「无修饰键的主键点击」这一种 router 内导航；
 * Ctrl/Cmd/Shift/Alt、中键/右键、`target=_blank` 与已 defaultPrevented 的点击
 * 一律交回 WebView 原生锚点语义，与 Web `GlobalTopBar`/`WebCardLibraryLink` 对齐
 *（D5.0e-r1）。
 */
export const DesktopCardLibraryLink = ({ href, className, title, target, rel, onClick, children }: CardLibraryLinkProps) => {
  const router = useRouter();
  return (
    <a
      // hash history 下渲染真实 `#` 前缀 href：Ctrl/中键点击、复制链接与脚本失败后的
      // 原生跳转都会落到这个地址上，裸产品路径伺服不到（D5.1-P2-r1）。
      href={resolveInternalHrefForHashHistory(href)}
      className={className}
      title={title}
      target={target}
      rel={rel}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.button !== 0) return;
        if (target === '_blank') return;
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        event.preventDefault();
        navigateByProductHref(router, href);
      }}
    >
      {children}
    </a>
  );
};

const copyCardText = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // 走 execCommand 回退（WebView 在部分上下文拒发 clipboard 权限）。
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('copy failed');
  } finally {
    textarea.remove();
  }
};

const desktopPlatform: CardLibraryPlatform = {
  Link: DesktopCardLibraryLink,
  marks: createLocalStorageCardLibraryMarks(),
  copyText: copyCardText,
  downloadJson: downloadTextFile,
};

/**
 * 公开资料持久缓存的宿主端口（D5.1-K2，DESK-CACHE-004/005）。
 *
 * 查询入参逐项白名单映射到 `desktop-ipc` 契约——`nativeOnly` 在共享类型上
 * 就不存在（投影缺该字段），这里不需要也不能透传；其余可选字段按
 * 「有值才携带」组装，空串/空数组不落进请求。`signal` 与在线通路同语义：
 * IPC 无法中途取消，abort 物化为「调用方不认领结果」。
 */
export const createDesktopPublicCachePort = (
  invokeFn: InvokeFn,
  openCacheManagement: () => void,
): CardLibraryPublicCachePort => ({
  queryCachedCards: async (query, signal) =>
    withAbort(
      queryPublicReadCache(invokeFn, {
        ...(query.type ? { type: query.type } : {}),
        limit: query.limit,
        offset: query.offset,
        sortBy: query.sortBy,
        ...(query.search ? { search: query.search } : {}),
        ...(query.tagIds && query.tagIds.length > 0 ? { tagIds: [...query.tagIds] } : {}),
        ...(query.tagMatch ? { tagMatch: query.tagMatch } : {}),
        ...(query.author ? { author: query.author } : {}),
        ...(query.minLikes ? { minLikes: query.minLikes } : {}),
        ...(query.maxLikes ? { maxLikes: query.maxLikes } : {}),
        ...(query.minUsage ? { minUsage: query.minUsage } : {}),
        ...(query.maxUsage ? { maxUsage: query.maxUsage } : {}),
        ...(query.minFavorites ? { minFavorites: query.minFavorites } : {}),
        ...(query.maxFavorites ? { maxFavorites: query.maxFavorites } : {}),
        ...(query.roleType ? { roleType: query.roleType } : {}),
        ...(query.recommendedOnly ? { recommendedOnly: query.recommendedOnly } : {}),
        ...(query.nativeAllowedOnly ? { nativeAllowedOnly: query.nativeAllowedOnly } : {}),
      }),
      signal,
    ),
  loadCachedCard: async (cardId, signal) =>
    withAbort(readPublicCacheCard(invokeFn, cardId), signal),
  openCacheManagement,
});

const desktopSlots: CardLibrarySlots = {
  // 详情/卡组插槽暂不注入：Desktop 尚无对应 UI——共享组件会把这些入口隐藏，
  // 而不是渲染点击无反应的按钮（端口契约的「不提供即无入口」语义）。
  renderLocalLibraryBanner: () => (
    <p className="text-xs text-(--app-text-muted)">
      本地库数据只保存在这台设备上，不参与线上同步；登录状态不影响本地库的使用。
      <Link to="/local-library" className="ml-2 underline">
        管理本地库
      </Link>
    </p>
  ),
  localLibraryLink: (
    <Link
      to="/local-library"
      className="inline-flex min-h-11 items-center rounded-lg border border-(--app-border) bg-(--app-surface) px-4 py-2 text-sm"
    >
      本地库说明
    </Link>
  ),
};

/**
 * 组装 Desktop 运行地的数据卡选择器宿主。
 *
 * `auth` 来自共享 `DesktopCloudSessionStore` 的当前快照（cached-first：本机
 * 凭据即线上身份；选择器打开时调用方仍 `refresh()` 一次——`DESK-ONLINE-013`
 * 的主动使用探测）。本地面不依赖登录态。
 */
export function useDesktopCardLibraryHost(): CardLibraryHost {
  const { state } = useDesktopCloudSession();
  const router = useRouter();
  /**
   * 三态投影（D5.0e-r1 → D5.2 正交会话后口径不变）：
   * - `account != null`（cached 或已验证）：`authenticated`——本机凭据即线上
   *   请求会用的身份，unreachable 不改写它（凭据保留，DESK-ONLINE-012）；
   * - `account == null` 且 signed-out/expired：确认过的登出 → `unauthenticated`；
   * - 其余（未 bootstrap / checking / authenticating / unreachable 无账号）：
   *   `unknown`——尚未确认或服务不可达，不按登出清理。
   */
  const authStatus: CardLibraryAuthState['status'] =
    state.account !== null
      ? 'authenticated'
      : state.verification === 'signed-out' || state.verification === 'expired'
        ? 'unauthenticated'
        : 'unknown';
  return useMemo(
    () => ({
      auth: {
        status: authStatus,
        userId: state.account?.userId ?? null,
        userBadges: [],
      },
      online: createDesktopCardLibraryOnlinePort((command, args) => invoke(command, args as never)),
      local: {
        repository: new IpcLocalCardRepository((command, args) => invoke(command, args as never)),
      },
      platform: desktopPlatform,
      slots: desktopSlots,
      // K2：注入公开缓存只读端口——公开页签获得「已缓存」视图与在线失败
      // 自动降级；「管理缓存」深链到设置「数据与存储」分组。
      publicCache: createDesktopPublicCachePort(
        (command, args) => invoke(command, args as never),
        () => navigateByProductHref(router, '/settings?section=data'),
      ),
    }),
    [state.account, authStatus, router],
  );
}
