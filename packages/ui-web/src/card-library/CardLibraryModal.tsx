// card-library/CardLibraryModal.tsx
//
// 共享数据卡选择器（原 apps/web/components/BattleDataModal.tsx，D5.0e 抽取）。
// 运行地能力全部由 `host` 端口注入：在线请求、本地库仓储、设备标记、链接组件、
// 详情/卡组插槽。本文件不得 import 任何 apps/* 源码或宿主传输层。

import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { inferCharacterKind } from '@mahoshojo/domain/data-cards';
import DataCard from './DataCard';
import SortSelector from './SortSelector';
import { useCardLibrarySummaryPage } from './use-card-library-summary-page';
import { isDefinitiveClientTerminalStatus } from './net-status';
import {
  isPublicVisibility,
  mapPublicDataCardRowToBattleSelectionPayload,
  mapPublicDataCardRowToSourceData,
  normalizePublicVisibilityValue,
} from './read-mappers';
import { isLocalDataCardRow, mapLocalCardRecordToDetailsCard, markCachedDataCardRow, getCachedDataCardRowMeta, isCachedDataCardRow, type LocalDataCardRow } from './rows';
import { buildSafeFileName } from '../client/fileName';
import { useLocalDataCards } from './use-local-data-cards';
import { useLocalLibraryAutoSave } from './use-local-library-auto-save';
import { ChevronDown, Filter, HardDrive } from 'lucide-react';
import { BaseModal } from '../modal/BaseModal';
import { acquireModalEnvironment } from '../modal/modal-lifecycle';
import { isTopmostFocusTrapLayer, useEscapeLayer } from '../modal/escape-stack';
import { ModalTabs, modalTabIds, type ModalTabItem } from '../modal/ModalTabs';
import { buttonClassName } from './Button';
import { DataCardEmptyState } from './DataCardEmptyState';
import { getDataCardStatus } from './status';
import type { BadgeDefinition } from './badge-types';
import type {
  CardLibraryCachedListQuery,
  CardLibraryCacheStatus,
  CardLibraryHost,
  CardLibrarySelectionContext,
} from './host';
import { PUBLIC_DATA_CARD_NOT_FOUND_CODE } from '@mahoshojo/contracts/desktop-cloud';
import {
  ONLINE_DATA_CARD_TYPES,
  OnlineDataCardTypeSchema,
  type OnlineDataCardType,
} from '@mahoshojo/contracts/data-cards';

type DataCardType = OnlineDataCardType;
type BattleDataSelectedType = DataCardType | 'all';

/** 同时喂给 ModalTabs 的 idPrefix 和下方 tabpanel 的 id，两边必须同源。 */
const TAB_ID_PREFIX = 'battle-data-source';
const TAB_ARIA_LABEL = '数据卡来源';

export interface CardLibraryModalProps {
  host: CardLibraryHost;
  /** 仅检查已有记录：不提供选择或卡片写入/使用动作。默认保持原选择器行为。 */
  browseOnly?: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSelectCard?: (card: any, context: CardLibrarySelectionContext) => void;
  onToggleCard?: (card: any, nextSelected: boolean, context: CardLibrarySelectionContext) => void;
  selectedType: BattleDataSelectedType;
  allowedTypes?: DataCardType[];
  initialTab?: BattleDataTab;
  visibleTabs?: BattleDataTab[];
  titleOverride?: string;
  selectionMode?: 'single' | 'multi';
  selectedCardIds?: string[];
  selectedCountOverride?: number;
  maxSelected?: number;
  externalError?: string | null;
  /** 是否允许从私有卡组批量导入；默认保持既有 Arena 行为。 */
  allowDeckImport?: boolean;
  /** 是否允许打开数据卡详情（以及详情中的举报等嵌套入口）；默认保持既有行为。 */
  allowCardDetails?: boolean;
}

export type BattleDataTab = 'my' | 'public' | 'recommended' | 'favorites' | 'local';

/**
 * 「最近一次已提交」值的镜像只能写于提交之后。layout effect 在 commit 内同步
 * 完成，保证同一事件循环里到达的迟到 Promise（微任务）已经能看到新值——普通
 * effect 经调度器异步冲刷，存在被微任务抢先的窗口。SSR 下 layout effect 为空
 * 操作且会告警（服务端也没有可判的异步竞态），退回 `useEffect`。
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const normalizeCardTypeForLibrary = (card: unknown): DataCardType => {
  const parsed = OnlineDataCardTypeSchema.safeParse((card as { type?: unknown })?.type);
  return parsed.success ? parsed.data : 'character';
};

/**
 * 缓存正文不可执行的终态错误（撤回/仅摘要/缺失/明确业务不可用）。
 * 与「传输类失败回落缓存」区分开：它直接终止选择流程，不回落、不重试。
 */
class CachedCardUnavailableError extends Error {}

const normalizeTagIds = (value: unknown): string[] => {
  const rawList: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') rawList.push(item);
    }
  } else if (typeof value === 'string') {
    rawList.push(...value.split(','));
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
};

const getCardTagIds = (card: any): string[] => {
  if (!card) return [];
  if (Array.isArray(card.tagIds)) return normalizeTagIds(card.tagIds);
  if (Array.isArray(card.tag_ids)) return normalizeTagIds(card.tag_ids);
  if (typeof card.tag_ids === 'string') return normalizeTagIds(card.tag_ids);
  return [];
};

const resolveQuestionnaireNativeAllowed = (card: any): boolean => {
  if (!card || card.type !== 'questionnaire') return false;
  if (typeof card.nativeAllowed === 'boolean') return card.nativeAllowed;
  if (typeof card.native_allowed === 'boolean') return card.native_allowed;

  let payload = card.data;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return false;
    }
  }

  if (!payload || typeof payload !== 'object') return false;
  if (typeof (payload as any).nativeAllowed === 'boolean') return (payload as any).nativeAllowed;
  if (typeof (payload as any).native_allowed === 'boolean') return (payload as any).native_allowed;
  return false;
};

// 【新增】筛选条件的状态接口
interface Filters {
  author: string;
  minLikes: string;
  maxLikes: string;
  minUsage: string;
  maxUsage: string;
  minFavorites: string;
  maxFavorites: string;
  recommendedOnly: boolean;
  roleType: '' | 'magical-girl' | 'canshou' | 'general';
  nativeOnly: boolean;
  nativeAllowedOnly: boolean;
}

type ApiTag = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: 'user' | 'system' | 'admin';
  isActive: boolean;
};

export function CardLibraryModal({
  host,
  isOpen,
  onClose,
  onSelectCard,
  onToggleCard,
  selectedType,
  allowedTypes,
  initialTab,
  visibleTabs,
  titleOverride,
  selectionMode = 'single',
  selectedCardIds,
  selectedCountOverride,
  maxSelected,
  externalError,
  allowDeckImport = true,
  allowCardDetails = true,
  browseOnly = false,
}: CardLibraryModalProps) {
  const { status: authStatus, userId, userBadges } = host.auth;
  // `unknown`（未确认登录态）一律不当成「已登出」：账号页签不出现、账号绑定
  // 状态不清理——只有确认过的 `unauthenticated` 才走登出语义。
  const isAuthenticated = authStatus === 'authenticated';
  const modalTitleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isComposingSearchRef = useRef(false);
  const publicFetchAbortControllerRef = useRef<AbortController | null>(null);
  const metaFetchAbortControllerRef = useRef<AbortController | null>(null);
  const badgeFetchAbortControllerRef = useRef<AbortController | null>(null);
  const selectingCardIdsRef = useRef<Set<string>>(new Set());
  const cardReadController = useRef<AbortController>(new AbortController());
  // 详情按“每次动作”创建：新的详情点击会中止上一次未完成的详情读取（last-click-wins）。
  const cardDetailControllerRef = useRef<AbortController | null>(null);
  const isSingleSelectingRef = useRef(false);
  const [publicDataCards, setPublicDataCards] = useState<any[]>([]);
  // 「上一次成功在线结果」标记：查询键 + 该行数。行数为 0 的成功结果
  // 不能算「可保留的在线行」——同条件刷新失败时必须允许缓存降级。
  const publicLoadedRef = useRef<{ requestKey: string; rowCount: number } | null>(null);
  const [publicTotalPages, setPublicTotalPages] = useState<number | null>(null);

  /**
   * 账号身份（D5.0e-r2）：稳定 identity key，不再维护数值纪元。
   * `authenticated` → `account:<userId>`；`unauthenticated` → `session:unauthenticated`；
   * `unknown`（未确认登录态）不产出新身份，沿用最后一个已确认 key（冷启动为
   * `session:unknown`）——A→checking→A 不换 key，收藏等账号绑定缓存不因一次
   * 会话探测而失配；A→B 与 A→登出则立即换 key 隔离。
   * render-phase adjust 是 React 官方收敛模式；render 阶段不得写 ref（并发渲染
   * 被丢弃时 ref 不随快照回滚）。
   */
  const confirmedAccountKey = isAuthenticated
    ? `account:${userId}`
    : authStatus === 'unauthenticated'
      ? 'session:unauthenticated'
      : null;
  const [committedAccountKey, setCommittedAccountKey] = useState<string>(confirmedAccountKey ?? 'session:unknown');
  if (confirmedAccountKey !== null && confirmedAccountKey !== committedAccountKey) {
    setCommittedAccountKey(confirmedAccountKey);
  }
  const accountKey = committedAccountKey;
  /**
   * 「最近一次已提交身份」的镜像：账号绑定的异步操作发起时捕获
   * `latestAccountKeyRef.current`，await 返回后若不一致则一律不得写回 UI。
   * 镜像只能在提交后更新（useIsomorphicLayoutEffect 在 commit 内同步完成）。
   */
  const latestAccountKeyRef = useRef(accountKey);
  useIsomorphicLayoutEffect(() => {
    latestAccountKeyRef.current = accountKey;
  }, [accountKey]);

  // 收藏集合按账号身份持有一份：渲染只投影当前身份的值，旧身份的迟到写入天然失效。
  const EMPTY_FAVORITE_IDS = useRef(new Set<string>()).current;
  const [favoriteView, setFavoriteView] = useState<{ owner: string; ids: Set<string> }>({ owner: accountKey, ids: EMPTY_FAVORITE_IDS });
  const favoriteIds = favoriteView.owner === accountKey ? favoriteView.ids : EMPTY_FAVORITE_IDS;
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<BattleDataTab>('public');
  const [showDecksModal, setShowDecksModal] = useState(false);
  // 记录用户是否主动切换过 Tab，防止排序等状态变动时被意外重置
  const hasUserSelectedTabRef = React.useRef(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'likes' | 'usage' | 'favorites' | 'created_at'>('created_at');
  const [selectedCard, setSelectedCard] = useState<any | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const detailsModalOpenRef = useRef(false);
  detailsModalOpenRef.current = allowCardDetails && Boolean(host.slots.CardDetailsModal) && showDetailsModal && selectedCard !== null;
  /**
   * 任何「栈外」子层在前台时，本层对 Escape/Tab 都让位（阻断而不是关闭）：
   * 详情/卡组弹窗由 host slot 注入、不注册进共享层级栈——没有这道闸，
   * 一次 Escape 会把背后的卡库模态框一起关掉，留下孤儿子层（DESK-PARITY-007）。
   * `pendingLocalRemoval` 的删除确认是 BaseModal，自己占栈顶一层，不在此列。
   */
  const childOverlayOpenRef = useRef(false);
  childOverlayOpenRef.current =
    detailsModalOpenRef.current ||
    (allowDeckImport && Boolean(host.slots.DecksModal) && showDecksModal);
  const [selectError, setSelectError] = useState<string | null>(null);
  const cardsPerPage = 12;
  const [cardMetaById, setCardMetaById] = useState<Record<string, { techScore: number | null; techLevel: string | null; strictTier: string | null; isNative: boolean | null }>>({});
  const [authorBadgesById, setAuthorBadgesById] = useState<Record<number, BadgeDefinition[]>>({});
  const effectiveAllowedTypes = useMemo<DataCardType[]>(() => {
    const candidates = selectedType === 'all'
      ? (Array.isArray(allowedTypes) && allowedTypes.length > 0 ? allowedTypes : ONLINE_DATA_CARD_TYPES)
      : [selectedType];
    const seen = new Set<DataCardType>();
    return candidates.filter((type): type is DataCardType => {
      const result = OnlineDataCardTypeSchema.safeParse(type);
      if (!result.success || seen.has(result.data)) return false;
      seen.add(result.data);
      return true;
    });
  }, [allowedTypes, selectedType]);
  const effectiveAllowedTypeSet = useMemo(() => new Set<DataCardType>(effectiveAllowedTypes), [effectiveAllowedTypes]);

  // 【新增】高级筛选的状态
  const initialFilters = useMemo<Filters>(() => ({
    author: '',
    minLikes: '',
    maxLikes: '',
    minUsage: '',
    maxUsage: '',
    minFavorites: '',
    maxFavorites: '',
    recommendedOnly: false,
    roleType: '',
    nativeOnly: false,
    nativeAllowedOnly: false,
  }), []);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [activeFilters, setActiveFilters] = useState<Filters>(initialFilters);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [tagSearch, setTagSearch] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagMatchMode, setTagMatchMode] = useState<'any' | 'all'>('any');
  const [tagOptions, setTagOptions] = useState<ApiTag[]>([]);
  const [tagOptionsLoading, setTagOptionsLoading] = useState(false);
  const [tagOptionsError, setTagOptionsError] = useState<string | null>(null);
  /**
   * 「已经取过标签库」必须显式记一份，不能用 `tagOptions.length > 0` 代替：
   * 标签库为空时长度恒为 0，旧实现会把它当成「还没取过」，于是每次渲染都重新请求，
   * loading true/false 交替触发无限重渲染。用 ref 承载以保持 callback 身份稳定。
   */
  const tagOptionsSettledRef = useRef(false);
  const tagOptionsInFlightRef = useRef(false);

  // Escape 收口进共享层级栈：栈外子层（详情/卡组 slot）在前台时本层
  // 显式阻断（返回 true 但不关闭），一次按键不会连锁关闭两层；否则关闭自身。
  const modalLayerId = useEscapeLayer({
    active: isOpen,
    trapsFocus: true,
    onEscape: () => {
      if (childOverlayOpenRef.current) return true;
      onCloseRef.current();
      return true;
    },
  });

  useEffect(() => {
    if (!isOpen) return;
    const modalEnvironment = acquireModalEnvironment();
    const modal = modalRef.current;
    closeButtonRef.current?.focus();

    const focusableSelector = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      // 栈外子层在前台，或上方另有模态层（本地删除确认等 BaseModal）时让位。
      if (childOverlayOpenRef.current || !isTopmostFocusTrapLayer(modalLayerId)) return;

      const focusable = [...(modalRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
        .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) {
        event.preventDefault();
        modalRef.current?.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !modalRef.current?.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !modalRef.current?.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      modalEnvironment.releaseScroll();
      // 上层公告/确认框仍持有焦点时，下层异步关闭不能将它拉回页面入口。
      const canRestoreFocus = document.activeElement === document.body
        || modal?.contains(document.activeElement);
      if (canRestoreFocus) modalEnvironment.restoreFocus();
    };
  }, [isOpen, modalLayerId]);

  const buildPublicFilters = useCallback((source: Filters, tab: BattleDataTab) => {
    if (tab === 'recommended') {
      return { ...source, recommendedOnly: true };
    }
    if (source.recommendedOnly) {
      return { ...source, recommendedOnly: false };
    }
    return source;
  }, []);

  const publicFilters = useMemo(() => buildPublicFilters(activeFilters, activeTab), [activeFilters, activeTab, buildPublicFilters]);
  // 公开库请求键覆盖 page/search/filter/tab/UUID 语义；任一变化都让旧结果先失效。
  const buildPublicRequestKey = useCallback((
    kind: 'list' | 'id',
    args: { page?: number; sort?: string; search?: string; filters?: Filters | null; tagIds?: string[]; tagMatch?: string; cardId?: string } = {},
  ) => JSON.stringify({
    kind,
    tab: activeTab,
    page: args.page ?? null,
    sort: args.sort ?? null,
    search: args.search ?? '',
    filters: args.filters ?? null,
    tagIds: args.tagIds ?? [],
    tagMatch: args.tagMatch ?? 'any',
    cardId: args.cardId ?? null,
    selectedType,
    types: effectiveAllowedTypes,
  }), [activeTab, effectiveAllowedTypes, selectedType]);
  const normalizeFiltersBySelectedType = useCallback((source: Filters): Filters => {
    let next = source;

    if (selectedType !== 'character' && next.roleType) {
      next = { ...next, roleType: '' };
    }
    if (selectedType === 'questionnaire' && next.nativeOnly) {
      next = { ...next, nativeOnly: false };
    }
    if (selectedType !== 'questionnaire' && next.nativeAllowedOnly) {
      next = { ...next, nativeAllowedOnly: false };
    }

    return next;
  }, [selectedType]);

  // 认证三态（DESK-ONLINE-010）：'unknown'（idle/checking/authenticating）不是"已登出"——
  // 账号页签在 unknown 期间保持可见，数据 hooks 因 owner=null 暂不取数，待会话解析后自动
  // 补齐；只有明确 unauthenticated 才收起 my/favorites。
  const accountTabsVisible = authStatus !== 'unauthenticated';
  const effectiveTabs = useMemo<BattleDataTab[]>(() => {
    const candidates = Array.isArray(visibleTabs) && visibleTabs.length > 0
      ? visibleTabs
      : ([
        ...(accountTabsVisible ? (['my'] as const) : []),
        'local' as const,
        'public' as const,
        'recommended' as const,
        ...(accountTabsVisible ? (['favorites'] as const) : []),
      ] as const);

    const seen = new Set<BattleDataTab>();
    const out: BattleDataTab[] = [];
    for (const tab of candidates as BattleDataTab[]) {
      if ((tab === 'my' || tab === 'favorites') && !accountTabsVisible) continue;
      if (seen.has(tab)) continue;
      seen.add(tab);
      out.push(tab);
    }
    return out.length > 0 ? out : ['public'];
  }, [visibleTabs, accountTabsVisible]);

  const isPublicTab = activeTab === 'public' || activeTab === 'recommended';
  // 私有/收藏摘要只继承这些 Tab 上实际可见且有语义的条件。
  // 公开库高级筛选（author/数值/roleType/native*/recommendedOnly）只随公开列表请求发送，
  // 避免切换 Tab 后界面已隐藏的筛选继续污染 my/favorites 查询（例如 owner=Alice 且 author=Bob 恒为空）。
  const summaryQuery = {
    limit: cardsPerPage, offset: (currentPage - 1) * cardsPerPage,
    search: debouncedSearchQuery.trim() || undefined, sortBy, types: effectiveAllowedTypes,
    tagIds: selectedTagIds, tagMatch: tagMatchMode,
  };
  const myPage = useCardLibrarySummaryPage(host.online.fetchSummaryPage, 'my', isAuthenticated ? userId : null, isOpen && activeTab === 'my', summaryQuery);
  const favoritesPage = useCardLibrarySummaryPage(host.online.fetchSummaryPage, 'favorites', isAuthenticated ? userId : null, isOpen && activeTab === 'favorites', summaryQuery);
  const { cards: rawUserDataCards, setCards: setUserDataCards, reload: loadUserDataCards } = myPage;
  const { setCards: setFavoriteCards } = favoritesPage;
  const [publicError, setPublicError] = useState<string | null>(null);
  /* ── 公开缓存视图（D5.1-K2）────────────────────────────────────────
   * 三态：'online'（当前线上结果/在线失败仅保留 stale 行）、'cache'
   * （用户主动浏览已缓存资料）、自动降级（在线失败且无 stale 行时展示
   * cachedView 快照）。`publicFailedKey` 记「哪个请求语义在线上失败」，
   * 只有 key 与当前查询一致才判降级，换查询语义后不会误贴失败标签。
   */
  const [publicViewMode, setPublicViewMode] = useState<'online' | 'cache'>('online');
  const [publicFailedKey, setPublicFailedKey] = useState<string | null>(null);
  const [cachedView, setCachedView] = useState<{
    key: string;
    entries: any[];
    /** 匹配本机缓存的行数——不是线上 total（DESK-CACHE-004）。 */
    total: number;
    bodyCount: number;
    totalPages: number;
    status: CardLibraryCacheStatus;
    /** 部分类型查询不可用（该类型贡献 0 行），如实提示覆盖受限。 */
    partial: boolean;
  } | null>(null);
  const cacheFetchAbortControllerRef = useRef<AbortController | null>(null);
  const [cacheLoading, setCacheLoading] = useState(false);
  /**
   * 本次会话内已确认撤回的卡 id → 撤回确认时已签发的最新缓存查询序号
   * （水位线）。签发序号不超过水位线的响应属「撤回确认之前签发」的迟到
   * 证据，不得重新展示该卡（`DESK-CACHE-006`——「已撤回」是移出可见/
   * 可选集合的终态，不是「仅摘要」）；超过水位线的查询是撤回之后签发
   * 的新证据——native 只交付 `availability='known'` 且未被屏障/占位
   * 排除的行，它仍返回该卡即视为已用真实公开响应重新捕获的权威确认，
   * 解除本会话标记。弹窗重开即重置，native 读侧本就是权威兜底。
   */
  const withdrawnCacheIdsRef = useRef<Map<string, number>>(new Map());
  /** 缓存列表查询的进程内签发序号——撤回水位线的「签发先后」比较基准。 */
  const cacheQuerySeqRef = useRef(0);
  /** 连接恢复/窗口回前台的重验证合并节流。 */
  const lastReconnectAtRef = useRef(0);
  const isLocalTab = activeTab === 'local';
  const localCards = useLocalDataCards(host.local.repository, isOpen && isLocalTab, effectiveAllowedTypes, debouncedSearchQuery);
  const localRecordById = useMemo(
    () => new Map(localCards.records.map((record) => [record.id, record])),
    [localCards.records],
  );
  const [localActionError, setLocalActionError] = useState<string | null>(null);
  const [localActionNotice, setLocalActionNotice] = useState<string | null>(null);
  const [uploadingLocalId, setUploadingLocalId] = useState<string | null>(null);
  const [removingLocalId, setRemovingLocalId] = useState<string | null>(null);
  const [pendingLocalRemoval, setPendingLocalRemoval] = useState<LocalDataCardRow | null>(null);
  const libraryAutoSave = useLocalLibraryAutoSave(host.local.repository);
  const [libraryCopyMessage, setLibraryCopyMessage] = useState<string | null>(null);

  /**
   * 账号身份切换的清场（render-phase adjust）：渲染途中发现身份已更换时，
   * 把「上个账号留下的可辨认痕迹」在本帧同步清掉，不等 effect——否则
   * 下一个绘制帧之前新账号界面仍会短暂显示旧账号的通知/错误。
   * 卡组弹窗同属账号私有面：注入实现内部持有 myDecks/favoriteDecks 等不以
   * 账号隔离的 state，换身份必须关闭（重开时经 `key={accountKey}` 重挂载）。
   * 本地库操作状态（pendingLocalRemoval 等）属于设备动作，不在此列。
   */
  const [appliedAccountKey, setAppliedAccountKey] = useState(accountKey);
  if (appliedAccountKey !== accountKey) {
    setAppliedAccountKey(accountKey);
    setShowDecksModal(false);
    setLocalActionError(null);
    setLocalActionNotice(null);
    setLibraryCopyMessage(null);
    setSelectError(null);
  }

  const listLoading = activeTab === 'my' ? myPage.loading : activeTab === 'favorites' ? favoritesPage.loading : isLocalTab ? localCards.loading : (isLoading || cacheLoading);
  const listError = activeTab === 'my' ? myPage.error : activeTab === 'favorites' ? favoritesPage.error : isLocalTab ? localCards.error : publicError;
  const listIdle = activeTab === 'my' ? myPage.status === 'idle' : activeTab === 'favorites' ? favoritesPage.status === 'idle' : false;
  const { reload: reloadFavorites } = favoritesPage;
  useEffect(() => {
    cardReadController.current = new AbortController();
    return () => {
      cardReadController.current.abort();
      cardDetailControllerRef.current?.abort();
      cardDetailControllerRef.current = null;
    };
  }, [isOpen, activeTab, userId]);
  useEffect(() => {
    if (!isOpen || isPublicTab) return;
    const status = activeTab === 'my' ? myPage.status : activeTab === 'favorites' ? favoritesPage.status : null;
    const total = activeTab === 'my' ? myPage.total : favoritesPage.total;
    if (status === 'success' && currentPage > Math.max(1, Math.ceil(total / cardsPerPage))) {
      setCurrentPage(Math.max(1, Math.ceil(total / cardsPerPage)));
    }
  }, [isOpen, isPublicTab, activeTab, myPage.status, myPage.total, favoritesPage.status, favoritesPage.total, currentPage, cardsPerPage]);
  useEffect(() => {
    if (!isOpen || !isAuthenticated) return;
    // 收藏 id 是账号私有偏好：写入打发起时的身份标签，渲染只投影当前身份——
    // 切账号/登出后，旧账号迟到的响应不可能投影进新会话。
    const ownerKey = accountKey;
    let cancelled = false;
    void host.online.listFavoriteIds().then((result) => {
      if (!cancelled && result.success) setFavoriteView({ owner: ownerKey, ids: new Set(result.favorites as string[]) });
    }).catch(() => {
      // 收藏标记是纯装饰：失败时保持空集，列表照常渲染。
    });
    return () => { cancelled = true; };
  }, [isOpen, isAuthenticated, userId, host.online, accountKey]);

  const inferRoleType = useCallback((card: any): 'magical-girl' | 'canshou' | 'general' | null => {
    if (!card || card.type !== 'character') return null;
    if (card.roleType) return card.roleType;

    let payload = card.data;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }

    // 与 Web `inferTemplate` 在角色推断上等价：`inferCharacterKind` 覆盖
    // magical-girl/canshou/general，'unknown' 与原实现走同一条模板文本回退。
    const tpl = inferCharacterKind(payload);
    if (tpl === 'magical-girl' || tpl === 'canshou' || tpl === 'general') return tpl;

    // 回退：按 templateId 字段文本判断
    const templateId: unknown = payload?.templateId || payload?.template || payload?.template_id;
    const templateText = typeof templateId === 'string' ? templateId.toLowerCase() : '';
    if (templateText.includes('魔法少女') || templateText.includes('magical-girl') || templateText.includes('magical')) {
      return 'magical-girl';
    }
    if (templateText.includes('残兽') || templateText.includes('canshou')) {
      return 'canshou';
    }
    if (templateText.includes('通用') || templateText.includes('general')) {
      return 'general';
    }

    // 最终兜底：codename -> 魔法少女；name -> 残兽；否则通用
    if (payload?.codename) return 'magical-girl';
    if (payload?.name) return 'canshou';
    return 'general';
  }, []);

  const mapWithRoleType = useCallback((cards: any[]): any[] => {
    return cards.map((card) => ({
      ...card,
      roleType: inferRoleType(card) || undefined,
    }));
  }, [inferRoleType]);

  /**
   * K2：把「当前查询语义」投影到本机缓存查询。字段逐一白名单对应，不额外加
   * 条件；`nativeOnly` 刻意缺席——缓存投影没有 isNative，如实口径是禁用
   * 该筛选并说明，而不是静默放行全部结果或把缺失当 false 过滤掉。
   */
  const buildCachedQueries = useCallback((page: number, searchTerm?: string): CardLibraryCachedListQuery[] => {
    const trimmed = searchTerm ?? debouncedSearchQuery.trim();
    return effectiveAllowedTypes.map((type) => ({
      type,
      limit: cardsPerPage,
      offset: (page - 1) * cardsPerPage,
      sortBy,
      search: trimmed || undefined,
      tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      tagMatch: tagMatchMode,
      author: publicFilters.author || undefined,
      minLikes: publicFilters.minLikes || undefined,
      maxLikes: publicFilters.maxLikes || undefined,
      minUsage: publicFilters.minUsage || undefined,
      maxUsage: publicFilters.maxUsage || undefined,
      minFavorites: publicFilters.minFavorites || undefined,
      maxFavorites: publicFilters.maxFavorites || undefined,
      roleType:
        publicFilters.roleType && selectedType === 'character'
          ? publicFilters.roleType
          : undefined,
      recommendedOnly: publicFilters.recommendedOnly || undefined,
      nativeAllowedOnly: publicFilters.nativeAllowedOnly || undefined,
    }));
  }, [debouncedSearchQuery, effectiveAllowedTypes, sortBy, selectedTagIds, tagMatchMode, publicFilters, selectedType, cardsPerPage]);

  /**
   * 读取一页本机缓存并打上 `__readSource:'cache'` 标记。多类型逐类型聚合
   * 与在线路径同构；任一类型缓存不可用时该类型贡献 0 行，并以 `partial`
   * 如实标注覆盖受限。Abort 只丢弃过期请求，不写任何状态。
   */
  const loadCachedListPage = useCallback(async (page: number, requestKey: string, searchTerm?: string) => {
    const port = host.publicCache;
    if (!port) return;
    cacheFetchAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    cacheFetchAbortControllerRef.current = abortController;
    const issueSeq = (cacheQuerySeqRef.current += 1);
    setCacheLoading(true);
    try {
      const pages = await Promise.all(
        buildCachedQueries(page, searchTerm).map((query) => port.queryCachedCards(query, abortController.signal)),
      );
      if (abortController.signal.aborted) return;
      const entries = pages.flatMap((p) =>
        p.entries
          // 签发序号不超过撤回水位线：本次查询在撤回确认之前发出，迟到
          // 响应不得把已撤回卡重新放回可见集合。超过水位线即撤回之后签发
          // ——native 权威仍交付该卡说明它已被新公开响应重新捕获，解除
          // 会话标记而不是永久隐藏合法恢复的资料。
          .filter((entry) => {
            const id = entry.card.id;
            if (typeof id !== 'string') return true;
            const barrierSeq = withdrawnCacheIdsRef.current.get(id);
            if (barrierSeq === undefined) return true;
            if (issueSeq <= barrierSeq) return false;
            withdrawnCacheIdsRef.current.delete(id);
            return true;
          })
          .map((entry) =>
            markCachedDataCardRow(
              { ...entry.card, roleType: inferRoleType(entry.card) || undefined },
              { hasBody: entry.hasBody, lastSuccessAt: entry.lastSuccessAt },
            ),
          ),
      );
      const status: CardLibraryCacheStatus =
        pages.every((p) => p.status === 'ready') ? 'ready'
        : pages.every((p) => p.status === 'empty') ? 'empty'
        : pages.some((p) => p.status === 'ready') ? 'ready'
        : pages.some((p) => p.status === 'unavailable') ? 'unavailable'
        : pages.some((p) => p.status === 'unsupported-schema') ? 'unsupported-schema'
        : 'empty';
      setCachedView({
        key: requestKey,
        entries,
        total: pages.reduce((sum, p) => sum + p.total, 0),
        bodyCount: pages.reduce((sum, p) => sum + p.bodyCount, 0),
        totalPages: Math.max(1, ...pages.map((p) => Math.ceil(p.total / cardsPerPage))),
        status,
        partial: pages.some((p) => p.status === 'unavailable' || p.status === 'unsupported-schema'),
      });
    } catch {
      if (abortController.signal.aborted) return;
      setCachedView({
        key: requestKey,
        entries: [], total: 0, bodyCount: 0, totalPages: 1,
        status: 'unavailable', partial: false,
      });
    } finally {
      // 与在线 owner 同一约定：被更新的请求取代时不清 loading、不释放 ref。
      if (cacheFetchAbortControllerRef.current === abortController) {
        cacheFetchAbortControllerRef.current = null;
        setCacheLoading(false);
      }
    }
  }, [host.publicCache, buildCachedQueries, inferRoleType, cardsPerPage]);

  /**
   * 当前公开查询的请求键——在线/缓存两套结果共用同一语义源：
   * 主动缓存视图固定 list 语义（粘贴链接检索按搜索词匹配 card_id），
   * 在线视图 uuid 检索走 'id' 语义，与 loadPublicDataCards 的分支一致。
   */
  const currentPublicRequestKey = useMemo(() => {
    const trimmed = debouncedSearchQuery.trim();
    if (publicViewMode === 'cache') {
      return buildPublicRequestKey('list', {
        page: currentPage, sort: sortBy, search: trimmed || undefined,
        filters: publicFilters, tagIds: selectedTagIds, tagMatch: tagMatchMode,
      });
    }
    const uuidMatch = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return uuidMatch
      ? buildPublicRequestKey('id', { cardId: uuidMatch[0] })
      : buildPublicRequestKey('list', {
          page: currentPage, sort: sortBy, search: trimmed || undefined,
          filters: publicFilters, tagIds: selectedTagIds, tagMatch: tagMatchMode,
        });
  }, [publicViewMode, debouncedSearchQuery, currentPage, sortBy, publicFilters, selectedTagIds, tagMatchMode, buildPublicRequestKey]);

  /**
   * 降级判定的三层口径：
   * - `publicDegradedActive`：当前查询语义在线上失败；
   * - `staleOnlineRowsShown`：该查询本次成功过，同 key 的在线行仍是最新已知事实，
   *   显示它而不是更早的缓存（缓存仍照常补齐，供换查询时使用）；
   * - `cachedViewShown`：主动缓存视图，或降级且没有可保留在线行时展示快照。
   */
  const publicDegradedActive =
    isPublicTab &&
    publicViewMode === 'online' &&
    publicFailedKey !== null &&
    publicFailedKey === currentPublicRequestKey;
  const staleOnlineRowsShown =
    publicDegradedActive &&
    publicLoadedRef.current?.requestKey === currentPublicRequestKey &&
    publicDataCards.length > 0;
  const cachedViewShown = isPublicTab && cachedView !== null && (
    (publicViewMode === 'cache' && cachedView.key === currentPublicRequestKey) ||
    (publicDegradedActive && !staleOnlineRowsShown && cachedView.key === publicFailedKey)
  );
  /**
   * 数据来源横幅的两态：'browse' 用户主动查看缓存；'degraded' 在线失败
   * 自动落到缓存快照。同 key 在线失败但仍有 stale 在线行时 banner 为空——
   * 那条路沿用既有 listError「上次成功结果」口径，语义已经准确。
   */
  const publicCacheBanner: 'browse' | 'degraded' | null =
    !isPublicTab ? null
    : publicViewMode === 'cache' ? 'browse'
    : cachedViewShown ? 'degraded'
    : null;
  /** 「仅看原生」在缓存投影里没有 isNative 字段——忽略并说明，不静默放行。 */
  const nativeOnlyIgnored = Boolean(publicCacheBanner) && publicFilters.nativeOnly;

  const reloadCachedCurrentQuery = useCallback((page: number) => {
    if (!isPublicTab || !host.publicCache) return;
    const trimmed = debouncedSearchQuery.trim();
    const requestKey = buildPublicRequestKey('list', {
      page, sort: sortBy, search: trimmed || undefined,
      filters: publicFilters, tagIds: selectedTagIds, tagMatch: tagMatchMode,
    });
    // 粘贴分享链接时取链接中的 uuid 做检索词——整串不是 card_id 的 LIKE 前缀。
    const uuidMatch = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    void loadCachedListPage(page, requestKey, uuidMatch ? uuidMatch[0] : undefined);
  }, [isPublicTab, host.publicCache, debouncedSearchQuery, sortBy, publicFilters, selectedTagIds, tagMatchMode, buildPublicRequestKey, loadCachedListPage]);

  const loadTagOptions = useCallback(async (options: { force?: boolean } = {}) => {
    if (tagOptionsInFlightRef.current) return;
    if (!options.force && tagOptionsSettledRef.current) return;
    tagOptionsInFlightRef.current = true;
    setTagOptionsLoading(true);
    setTagOptionsError(null);
    try {
      const result = await host.online.listTags(new AbortController().signal);
      if (!result.ok) {
        setTagOptionsError(result.error);
        return;
      }
      setTagOptions(Array.isArray(result.tags) ? result.tags : []);
      // 空标签库同样是成功结果：记为已取过，避免"永远在加载"。
      tagOptionsSettledRef.current = true;
    } catch (error) {
      setTagOptionsError(String(error));
    } finally {
      tagOptionsInFlightRef.current = false;
      setTagOptionsLoading(false);
    }
  }, [host.online]);

  const ensureTagOptions = useCallback(() => {
    // 缓存视图不暗中请求标签候选——候选列表属于线上元数据；
    // 已选标签与已加载候选在缓存视图里照常生效。
    if (publicCacheBanner !== null) return;
    void loadTagOptions();
  }, [loadTagOptions, publicCacheBanner]);

  const userDataCards = useMemo(() => mapWithRoleType(
    rawUserDataCards.filter((card: any) => effectiveAllowedTypeSet.has(card.type)),
  ), [rawUserDataCards, effectiveAllowedTypeSet, mapWithRoleType]);
  const favoriteCards = useMemo(() => mapWithRoleType(favoritesPage.cards), [favoritesPage.cards, mapWithRoleType]);

  // 通过 ID 获取数据卡并显示在列表中
  const loadCardByIdForDisplay = useCallback(async (cardId: string) => {
    const requestKey = buildPublicRequestKey('id', { cardId });
    publicFetchAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    publicFetchAbortControllerRef.current = abortController;
    if (publicLoadedRef.current?.requestKey !== requestKey) {
      // 查询语义变化（含 UUID 切换）：旧结果不得冒充新查询结果。
      publicLoadedRef.current = null;
      setPublicDataCards([]);
      setPublicTotalPages(null);
    }
    let failedStatus: number | null = null;
    try {
      setIsLoading(true);
      setPublicError(null);
      const result = await host.online.fetchPublicCardById(cardId, abortController.signal);
      if (result.ok) {
        if (abortController.signal.aborted) return;
        const card = result.data.success && result.data.card && effectiveAllowedTypeSet.has(result.data.card.type) ? result.data.card : null;
        // rowCount 记「实际可展示行数」：返回成功但卡片被过滤掉时记 0。
        publicLoadedRef.current = { requestKey, rowCount: card ? 1 : 0 };
        setPublicDataCards(card ? mapWithRoleType([card]) : []);
        setPublicTotalPages(1);
        setPublicFailedKey(null);
      } else {
        failedStatus = result.status;
        throw new Error(`获取数据卡失败（HTTP ${result.status}）`);
      }
    } catch (error) {
      if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return;
      }
      // 同 requestKey 的 5xx/timeout 保留 stale 单卡；4xx 业务终态（卡被转私有/删除）必须清掉。
      // 「保留」以有可展示行为前提：上次成功但零行时允许查缓存降级。
      const hasRetainedRows =
        publicLoadedRef.current?.requestKey === requestKey && publicLoadedRef.current.rowCount > 0;
      const keepStale =
        hasRetainedRows && !(failedStatus !== null && isDefinitiveClientTerminalStatus(failedStatus));
      if (!keepStale) {
        publicLoadedRef.current = null;
        setPublicDataCards([]);
        setPublicTotalPages(null);
      }
      setPublicError(error instanceof Error ? error.message : '获取数据卡失败');
      setPublicFailedKey(requestKey);
      // 在线失败后查一次本机缓存：没有可保留的在线行时才可能展示快照，
      // 4xx 终态已判定在线事实不存在，缓存行仍会标 stale 而非冒充存在。
      // 搜索词用提取出的 cardId——分享链接整串不是 card_id 的 LIKE 前缀。
      if (!keepStale) void loadCachedListPage(1, requestKey, cardId);
    } finally {
      if (publicFetchAbortControllerRef.current === abortController) {
        publicFetchAbortControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }, [host.online, buildPublicRequestKey, effectiveAllowedTypeSet, mapWithRoleType, loadCachedListPage]);

  // 【修改】获取公开数据卡，现在会接收所有筛选条件
  const loadPublicDataCards = useCallback(async (
    page: number = 1,
    currentSortBy: 'likes' | 'usage' | 'favorites' | 'created_at',
    currentSearchTerm?: string,
    currentFilters?: Filters,
    currentTagIds?: string[],
    currentTagMatch?: 'any' | 'all'
  ) => {
    const requestKey = buildPublicRequestKey('list', {
      page, sort: currentSortBy, search: currentSearchTerm, filters: currentFilters ?? null,
      tagIds: currentTagIds ?? [], tagMatch: currentTagMatch,
    });
    publicFetchAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    publicFetchAbortControllerRef.current = abortController;
    if (publicLoadedRef.current?.requestKey !== requestKey) {
      // 翻页/搜索/筛选/Tab 变化：旧查询结果不得冒充新查询结果。
      publicLoadedRef.current = null;
      setPublicDataCards([]);
      setPublicTotalPages(null);
    }
    try {
      setIsLoading(true);
      setPublicError(null);
      // 摘要分页：每页数量即卡片上限，列表不含正文；roleType 等筛选全部
      // 在服务端完成——不再先取一大批回客户端过滤（旧 limit=500 在服务端
      // MAX_LIMIT=100 下本来就截断，筛选结果不完整）。
      const fetchType = async (type: DataCardType): Promise<{ cards: any[]; total: number | null }> => {
        const result = await host.online.fetchPublicCards({
          type,
          limit: cardsPerPage,
          offset: (page - 1) * cardsPerPage,
          sortBy: currentSortBy,
          search: currentSearchTerm,
          tagIds: currentTagIds && currentTagIds.length > 0 ? currentTagIds : undefined,
          tagMatch: currentTagMatch,
          author: currentFilters?.author || undefined,
          minLikes: currentFilters?.minLikes || undefined,
          maxLikes: currentFilters?.maxLikes || undefined,
          minUsage: currentFilters?.minUsage || undefined,
          maxUsage: currentFilters?.maxUsage || undefined,
          minFavorites: currentFilters?.minFavorites || undefined,
          maxFavorites: currentFilters?.maxFavorites || undefined,
          roleType: currentFilters?.roleType && selectedType === 'character' ? currentFilters.roleType : undefined,
          recommendedOnly: currentFilters?.recommendedOnly || undefined,
          nativeOnly: currentFilters?.nativeOnly || undefined,
          nativeAllowedOnly: currentFilters?.nativeAllowedOnly || undefined,
        }, abortController.signal);
        if (!result.ok) throw new Error(`获取公开数据卡失败（HTTP ${result.status}）`);
        if (!result.data.success || !Array.isArray(result.data.cards)) {
          throw new Error(result.data.error || '列表响应无效');
        }
        const total = typeof result.data.total === 'number' && Number.isFinite(result.data.total)
          ? result.data.total
          : null;
        return { cards: result.data.cards, total };
      };

      const batches = await Promise.all(effectiveAllowedTypes.map((type) => fetchType(type)));
      if (abortController.signal.aborted) return;
      const cards = mapWithRoleType(batches.flatMap((batch) => batch.cards));
      publicLoadedRef.current = { requestKey, rowCount: cards.length };
      setPublicDataCards(cards);
      setPublicFailedKey(null);
      // 多类型并行请求时总页数取各类型最大（与 Web 旧行为一致：跨类型分页各自独立）。
      setPublicTotalPages(
        batches.every((batch) => batch.total !== null)
          ? Math.max(1, ...batches.map((batch) => Math.ceil((batch.total as number) / cardsPerPage)))
          : null,
      );
    } catch (error) {
      if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return;
      }
      const hasRetainedRows =
        publicLoadedRef.current?.requestKey === requestKey && publicLoadedRef.current.rowCount > 0;
      if (!hasRetainedRows) {
        publicLoadedRef.current = null;
        setPublicDataCards([]);
        setPublicTotalPages(null);
        // K2：本次失败语义没有可保留的在线行（含「上次成功但零行」）——
        // 查本机缓存，命中的快照以 stale 标记展示，不混入线上结果。
        void loadCachedListPage(page, requestKey);
      }
      setPublicError(error instanceof Error ? error.message : '获取公开数据卡失败');
      setPublicFailedKey(requestKey);
    } finally {
      if (publicFetchAbortControllerRef.current === abortController) {
        publicFetchAbortControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }, [host.online, buildPublicRequestKey, selectedType, effectiveAllowedTypes, cardsPerPage, mapWithRoleType, loadCachedListPage]);

  // 公开查询的显式重放入口：始终使用当前 debouncedSearchQuery + publicFilters，
  // 页码由调用方显式传入（不读取 currentPage，避免翻页 → callback identity → effect 的间接依赖），
  // 供 effect、重试按钮、翻页与“再次点击当前 Tab”复用，避免 closure 里的过期查询语义。
  const reloadPublicCurrentQuery = useCallback((page: number) => {
    if (!isPublicTab) return;
    const trimmed = debouncedSearchQuery.trim();
    const uuidMatch = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) {
      loadCardByIdForDisplay(uuidMatch[0]);
      return;
    }
    loadPublicDataCards(page, sortBy, trimmed || undefined, publicFilters, selectedTagIds, tagMatchMode);
  }, [isPublicTab, debouncedSearchQuery, sortBy, publicFilters, selectedTagIds, tagMatchMode, loadCardByIdForDisplay, loadPublicDataCards]);

  // 公开页签的服务端分页越界回收：total 已知而当前页超出时（并发删卡、筛选收紧等）
  // 回收到最后一页并重新拉取。缓存视图 totalPages 已 clamp，不进入此回收。
  useEffect(() => {
    if (!isOpen || !isPublicTab || publicViewMode === 'cache' || publicTotalPages === null || currentPage <= publicTotalPages) return;
    const next = Math.max(1, publicTotalPages);
    setCurrentPage(next);
    reloadPublicCurrentQuery(next);
  }, [isOpen, isPublicTab, publicViewMode, publicTotalPages, currentPage, reloadPublicCurrentQuery]);

  const sortFavorites = useCallback((items: any[], criteria: 'likes' | 'usage' | 'favorites' | 'created_at') => {
    const sorted = [...items];
    switch (criteria) {
      case 'likes':
        sorted.sort((a, b) => (b.like_count ?? 0) - (a.like_count ?? 0));
        break;
      case 'usage':
        sorted.sort((a, b) => (b.usage_count ?? 0) - (a.usage_count ?? 0));
        break;
      case 'favorites':
        sorted.sort((a, b) => (b.favorite_count ?? 0) - (a.favorite_count ?? 0));
        break;
      case 'created_at':
      default:
        sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return sorted;
  }, []);

  const adjustFavoriteCount = useCallback((cards: any[], cardId: string, delta: number) => {
    return cards.map((card) => {
      if (card.id !== cardId) return card;
      const nextCount = Math.max(0, (card.favorite_count ?? 0) + delta);
      return { ...card, favorite_count: nextCount };
    });
  }, []);

  // 防抖功能 - 延迟500ms执行搜索（兼容 IME：组词期不触发，结束后会继续等待并触发）
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      timer = setTimeout(() => {
        if (isComposingSearchRef.current) {
          schedule();
          return;
        }
        setDebouncedSearchQuery(searchQuery);
      }, 500);
    };

    schedule();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!isOpen) return;
    void loadTagOptions();
  }, [isOpen, loadTagOptions]);

  useEffect(() => {
    if (!isOpen || !isPublicTab) {
      publicFetchAbortControllerRef.current?.abort();
      publicFetchAbortControllerRef.current = null;
      cacheFetchAbortControllerRef.current?.abort();
      cacheFetchAbortControllerRef.current = null;
    }
  }, [isOpen, isPublicTab]);

  // 公开查询的唯一请求 owner：防抖搜索、Tab、排序、筛选、标签变化都从这里发起。
  // 翻页不在其中：reloadPublicCurrentQuery 不读取 currentPage（页码显式传参），
  // 本 effect 依赖链也不含 currentPage，翻页由 handlePageChange 独占发起。
  // K2：主动缓存视图下同一 owner 改发缓存查询——进入公开库默认在线视图，
  // 线上查询仍照常发出；切换视图时页码归一，在线/缓存分页互不串扰。
  useEffect(() => {
    if (!isOpen) return;

    setCurrentPage(1);
    if (!isPublicTab) return;

    if (publicViewMode === 'cache') {
      reloadCachedCurrentQuery(1);
      return;
    }
    reloadPublicCurrentQuery(1);
  }, [debouncedSearchQuery, isOpen, activeTab, isPublicTab, publicViewMode, sortBy, publicFilters, selectedTagIds, tagMatchMode, reloadPublicCurrentQuery, reloadCachedCurrentQuery]);

  // K2：连接恢复信号/窗口回到前台触发一次合并的重验证。
  // - 降级中：重试线上查询，成功即自动回到当前线上结果；
  // - 主动缓存视图：保留用户选择，只刷新快照视图本身；
  // - 'online' 事件是恢复信号，强制重发；focus 走 15s 节流防连击。
  // 该监听是缓存宿主（Desktop）的专属能力：没有 publicCache 端口的
  // 宿主（Web）不得挂载这套自动重发逻辑，避免新增原本不存在的请求。
  useEffect(() => {
    if (!isOpen || !isPublicTab || !host.publicCache || typeof window === 'undefined') return;
    const maybeRevalidate = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastReconnectAtRef.current < 15_000) return;
      lastReconnectAtRef.current = now;
      if (publicViewMode === 'cache') {
        reloadCachedCurrentQuery(currentPage);
        return;
      }
      if (publicFailedKey !== null || force) {
        reloadPublicCurrentQuery(currentPage);
      }
    };
    const onOnline = () => maybeRevalidate(true);
    const onFocus = () => maybeRevalidate(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
    };
  }, [isOpen, isPublicTab, host.publicCache, publicViewMode, publicFailedKey, currentPage, reloadPublicCurrentQuery, reloadCachedCurrentQuery]);

  useEffect(() => {
    return () => {
      publicFetchAbortControllerRef.current?.abort();
      cacheFetchAbortControllerRef.current?.abort();
    };
  }, []);

  // 当模态框打开时加载数据
  useEffect(() => {
    if (!isOpen) return;

    setCurrentPage(1);
    setSearchQuery('');
    setSelectError(null);
    setFilters(initialFilters); // 清空高级筛选
    setActiveFilters(initialFilters);
    setTagSearch('');
    setSelectedTagIds([]);
    setTagMatchMode('any');
    setTagOptionsError(null);
    tagOptionsSettledRef.current = false;
    tagOptionsInFlightRef.current = false;
    // 每次打开默认回到在线视图并发出线上查询（进入公开库必走线上口径）；
    // 主动缓存视图不跨弹窗会话延续，避免「曾经点过缓存」变成隐式锁定。
    setPublicViewMode('online');
    setPublicFailedKey(null);
    setCachedView(null);
    // 会话级撤回集合同属本弹窗会话——重开后由 native 权威读兜底。
    withdrawnCacheIdsRef.current.clear();

    const fallbackTab: BattleDataTab = effectiveTabs[0] ?? 'public';
    const canUseInitialTab = Boolean(initialTab && effectiveTabs.includes(initialTab));
    const desiredDefaultTab: BattleDataTab = isAuthenticated ? 'my' : 'public';

    const nextTab: BattleDataTab = (() => {
      if (canUseInitialTab) return initialTab as BattleDataTab;
      if (!hasUserSelectedTabRef.current) {
        return effectiveTabs.includes(desiredDefaultTab) ? desiredDefaultTab : fallbackTab;
      }
      // 只有"确认未登录"才强收回 public；unknown 期间保留用户所在页签等待会话解析。
      if (authStatus === 'unauthenticated' && !isPublicTab && effectiveTabs.includes('public')) return 'public';
      return effectiveTabs.includes(activeTab) ? activeTab : fallbackTab;
    })();

    setActiveTab(nextTab);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedType, isAuthenticated, authStatus]);

  // 切换数据卡类型时，清除不适配当前类型的筛选项，避免误筛
  useEffect(() => {
    setFilters((prev) => normalizeFiltersBySelectedType(prev));
    setActiveFilters((prev) => normalizeFiltersBySelectedType(prev));
  }, [normalizeFiltersBySelectedType]);

  const selectedIdSet = useMemo(() => new Set((selectedCardIds || []).filter((x): x is string => typeof x === 'string' && Boolean(x))), [selectedCardIds]);
  const selectedCount = typeof selectedCountOverride === 'number' ? selectedCountOverride : selectedIdSet.size;
  const atLimit = selectionMode === 'multi' && typeof maxSelected === 'number' && maxSelected > 0 && selectedCount >= maxSelected;
  const canToggle = selectionMode === 'multi' && typeof onToggleCard === 'function';
  const canImportDeck = allowDeckImport && Boolean(host.slots.DecksModal) && isAuthenticated && selectionMode === 'multi' && selectedType === 'character' && (typeof onToggleCard === 'function' || typeof onSelectCard === 'function');

  /**
   * 确认撤回后立即把该卡从缓存可见/可选集合移除——「已撤回」是终态
   * （`DESK-CACHE-006`），不是「仅摘要」。三步收口：
   * 1. 记入会话级撤回集合，水位线 = 确认时已签发的最新查询序号：
   *    序号不超过水位线的迟到响应不得重新展示该卡；之后签发的查询
   *    若仍由 native 权威交付该卡（重新公开已被重新捕获）则解除标记；
   * 2. 中止在途缓存列表查询（abort 信号让该批结果在写 state 前被
   *    丢弃），并把行从当前视图立即移除；
   * 3. 重查 native 缓存集合：total/bodyCount/分页按撤回后的权威
   *    全集重新计算——不再从当前页条目近似推算 bodyCount。
   */
  const markCachedRowWithdrawn = useCallback((cardId: string) => {
    withdrawnCacheIdsRef.current.set(cardId, cacheQuerySeqRef.current);
    cacheFetchAbortControllerRef.current?.abort();
    // 中止不释放 ref 引用——被弃用的那次加载在 finally 里看到 ref
    // 已换人便不再清 loading；这里手动复位，避免转圈悬挂。
    cacheFetchAbortControllerRef.current = null;
    setCacheLoading(false);
    setCachedView((view) =>
      view
        ? { ...view, entries: view.entries.filter((entry) => entry?.id !== cardId) }
        : view,
    );
    if (!isPublicTab || !host.publicCache) return;
    // 沿用当前视图语义的 key 重查（降级态是失败查询的 key，浏览态是
    // list 语义），不引入新语义；当前页被抽空时由 clamp effect 回退。
    if (publicDegradedActive && publicFailedKey) {
      void loadCachedListPage(currentPage, publicFailedKey);
    } else {
      reloadCachedCurrentQuery(currentPage);
    }
  }, [isPublicTab, host.publicCache, publicDegradedActive, publicFailedKey, currentPage, loadCachedListPage, reloadCachedCurrentQuery]);

  // 缓存视图的页码回收：撤回移除/筛选收紧使 totalPages 收缩、当前页
  // 越界时回退到末页并重查。只作用于主动缓存视图——降级快照附着在
  // 失败的线上请求上，翻页本就由在线路径重试（与线上 clamp 同口径）。
  useEffect(() => {
    if (!isOpen || !isPublicTab || publicViewMode !== 'cache') return;
    if (!cachedView || !cachedViewShown || currentPage <= cachedView.totalPages) return;
    const next = Math.max(1, cachedView.totalPages);
    setCurrentPage(next);
    reloadCachedCurrentQuery(next);
  }, [isOpen, isPublicTab, publicViewMode, cachedView, cachedViewShown, currentPage, reloadCachedCurrentQuery]);

  /**
   * K2：取缓存行的正文快照（DESK-CACHE-005）。
   *
   * 联网可达且当前查询没有被判「线上失败」时先按需重验证单卡：
   * 撤回终态与 native 分类同一证据——HTTP 404 + `success:false` + 业务
   * 撤回码三者同时成立才算「已确认撤回」（DESK-CACHE-006）；传输类失败/
   * 未知 4xx/5xx 都回落缓存正文。仅摘要/缺失/撤回是终态，用
   * CachedCardUnavailableError 终止选择流程，错误文案如实说明。
   */
  const loadCachedCardBody = useCallback(async (
    cardId: string,
    signal: AbortSignal,
  ): Promise<{ card: Record<string, unknown>; viaCache: boolean }> => {
    const port = host.publicCache;
    if (!port) throw new CachedCardUnavailableError('本机缓存不可用');
    const degradedNow = publicFailedKey !== null && publicFailedKey === currentPublicRequestKey;
    const mayReachOnline = (typeof navigator === 'undefined' || navigator.onLine !== false) && !degradedNow;
    if (mayReachOnline) {
      try {
        const res = await host.online.fetchPublicCardById(cardId, signal);
        if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
        const body = res.data as { success?: unknown; card?: unknown; code?: unknown } | undefined;
        const onlineCard = body?.card as Record<string, unknown> | null | undefined;
        // 升级为线上已验证事实前必须核对返回卡 id：错置身份（拿到另一张
        // 卡却标成 cloud:<请求id>）比传输失败更严重，不许放行。
        if (res.ok && body?.success === true && onlineCard && onlineCard.id === cardId) {
          return { card: onlineCard, viaCache: false };
        }
        // 401/无码 404/5xx/HTML/成功但卡 id 不符——一律当传输失败回落缓存；
        // 只有三项证据齐全的业务撤回才是终态，并立即把该缓存行标记失效。
        if (res.status === 404 && body?.success === false && body?.code === PUBLIC_DATA_CARD_NOT_FOUND_CODE) {
          markCachedRowWithdrawn(cardId);
          throw new CachedCardUnavailableError('这张卡已从公开库撤回或不再公开，缓存快照不再提供。');
        }
      } catch (error) {
        if (error instanceof CachedCardUnavailableError) throw error;
        if (error instanceof Error && error.name === 'AbortError') throw error;
        // 其余（网络层/解析层）皆传输类失败，继续走缓存。
      }
    }
    const result = await port.loadCachedCard(cardId, signal);
    if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    if (result.availability === 'full' && result.entry) {
      // 快照必须重新带 storageLocation:'cache' 标记——IPC 返回的新对象
      // 不带行标记，否则 payload mapper 会把缓存卡误判成 cloud 身份。
      return {
        card: markCachedDataCardRow(result.entry.card as Record<string, unknown>, {
          hasBody: true,
          lastSuccessAt: result.entry.lastSuccessAt ?? null,
        }),
        viaCache: true,
      };
    }
    if (result.availability === 'withdrawn') {
      markCachedRowWithdrawn(cardId);
      throw new CachedCardUnavailableError('这张卡已从公开库撤回或不再公开。');
    }
    if (result.availability === 'summary-only') {
      throw new CachedCardUnavailableError('这张卡只缓存了摘要，正文需联网后获取。');
    }
    // 'absent' 之外先按 status 如实归因：缓存损坏/版本不受支持不是
    // 「没有这张卡」——文案不得把缓存故障说成数据缺失。
    if (result.status === 'unsupported-schema') {
      throw new CachedCardUnavailableError('本机缓存数据版本不受支持，正文需联网后获取。');
    }
    if (result.status === 'unavailable') {
      throw new CachedCardUnavailableError('本机缓存暂不可用，正文需联网后获取。');
    }
    throw new CachedCardUnavailableError('本机缓存中没有这张卡。');
  }, [host.publicCache, host.online, publicFailedKey, currentPublicRequestKey, markCachedRowWithdrawn]);

  // 处理卡片选择
  const handleSelectCard = async (card: any) => {
    if (browseOnly) return;
    const cardId = typeof card?.id === 'string' ? card.id : '';
    if (!cardId) return;

    setSelectError(null);

    if (selectionMode === 'single' && isSingleSelectingRef.current) return;
    if (selectingCardIdsRef.current.has(cardId)) return;
    selectingCardIdsRef.current.add(cardId);
    if (selectionMode === 'single') isSingleSelectingRef.current = true;

    try {
      const isSelected = selectedIdSet.has(cardId);
      const nextSelected = !isSelected;

      if (selectionMode === 'multi') {
        if (!nextSelected && !canToggle) {
          return;
        }
        if (nextSelected && atLimit) {
          return;
        }
      }

      const signal = cardReadController.current.signal;
      // 本地库记录本来就带着完整正文；走 host.online.loadFullCard 只会得到一次注定 404 的请求。
      const isLocalRow = isLocalDataCardRow(card);
      // 缓存行只按正文快照选择/预览——仅摘要行在 UI 层已禁用入口，这里兜底拦截。
      const isCacheRow = isCachedDataCardRow(card);
      if (isCacheRow && !getCachedDataCardRowMeta(card)?.hasBody) return;
      const cachedResolved = isCacheRow ? await loadCachedCardBody(cardId, signal) : null;
      const full = isLocalRow
        ? card
        : isCacheRow
          ? cachedResolved!.card
          : typeof card.data === 'string' ? card : await host.online.loadFullCard(card, activeTab === 'my' ? 'my' : 'public', signal);
      if (signal.aborted) return;
      const payload = mapPublicDataCardRowToBattleSelectionPayload(full);
      // 选中上下文：canonical 卡 id 相同的不同来源副本（云端卡 vs 本地副本 vs 缓存快照）
      // 必须产出不同 selectionId，下游问卷作用域据此隔离（D5.0e-r1 / D5.1-K2）。
      // 缓存行按需重验证成功时正文已是线上已验证事实，语义如实升级为 cloud。
      const selectionContext: CardLibrarySelectionContext = isLocalRow
        ? { selectionId: `local:${cardId}`, storageLocation: 'local' }
        : isCacheRow && cachedResolved?.viaCache !== false
          ? { selectionId: `cache:${cardId}`, storageLocation: 'cache' }
          : { selectionId: `cloud:${cardId}`, storageLocation: 'cloud', cloudCardId: cardId };
      selectionContext.rawSourceData = mapPublicDataCardRowToSourceData(full);

      if (selectionMode === 'multi') {
        if (canToggle) {
          onToggleCard?.(payload, nextSelected, selectionContext);
        } else if (nextSelected) {
          onSelectCard?.(payload, selectionContext);
        }
      } else {
        onSelectCard?.(payload, selectionContext);
        onClose();
      }

      // 如果是公开卡片且未使用过，增加使用次数（仅在「加入」时触发）。
      // `_cardId !== ''` 即已验证的线上身份：本地行与缓存快照（`_cardId:''`）
      // 不产生线上计数；缓存行重验证成功后才恢复线上身份，此时计数是诚实的。
      if (nextSelected && payload._cardId !== '' && isPublicVisibility(payload._isPublic) && !host.platform.marks.isUsed(cardId)) {
        void (async () => {
          try {
            if (await host.online.reportCardStat(cardId, 'usage')) {
              // 服务端确认后才写入本地使用标记
              host.platform.marks.markUsed(cardId);
            }
          } catch (error) {
            console.error('增加使用次数失败:', error);
          }
        })();
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('解析数据卡失败:', error);
      setSelectError(error instanceof Error ? error.message : '解析数据卡失败，请稍后重试。');
    } finally {
      selectingCardIdsRef.current.delete(cardId);
      if (selectionMode === 'single') isSingleSelectingRef.current = false;
    }
  };

  const handleImportDeck = useCallback(async (deckId: string) => {
    if (!deckId) return;
    if (!allowDeckImport) return;
    if (selectionMode !== 'multi') return;

    // 卡组读取是账号绑定请求：await 期间账号可能已切换——旧账号的迟到响应
    // 绝不能经 onToggleCard/onSelectCard 写进新账号的选择状态（DESK-ONLINE-010）。
    const ownerKey = latestAccountKeyRef.current;
    try {
      const detail = await host.online.getDeckCards(deckId);
      if (latestAccountKeyRef.current !== ownerKey) return;
      const entries = Array.isArray(detail?.cards) ? detail.cards : [];

      let remaining = typeof maxSelected === 'number' && maxSelected > 0 ? Math.max(0, maxSelected - selectedCount) : Number.POSITIVE_INFINITY;
      const nextSelectedIds = new Set(selectedIdSet);

      for (const entry of entries) {
        if (remaining <= 0) break;
        if (!entry?.isAccessible || !entry?.card) continue;

        const card = entry.card;
        if (!effectiveAllowedTypeSet.has(card.type)) continue;

        const cardId = typeof card?.id === 'string' ? card.id : '';
        if (!cardId || nextSelectedIds.has(cardId)) continue;

        try {
          const payload = mapPublicDataCardRowToBattleSelectionPayload(card);
          const selectionContext: CardLibrarySelectionContext = {
            selectionId: `cloud:${cardId}`,
            storageLocation: 'cloud',
            cloudCardId: cardId,
            rawSourceData: mapPublicDataCardRowToSourceData(card),
          };

          if (canToggle) {
            onToggleCard?.(payload, true, selectionContext);
          } else {
            onSelectCard?.(payload, selectionContext);
          }

          nextSelectedIds.add(cardId);
          remaining -= 1;

          if (isPublicVisibility(payload._isPublic) && !host.platform.marks.isUsed(cardId)) {
            void (async () => {
              try {
                if (await host.online.reportCardStat(cardId, 'usage')) host.platform.marks.markUsed(cardId);
              } catch (error) {
                console.error('增加使用次数失败:', error);
              }
            })();
          }
        } catch (error) {
          console.error('解析数据卡失败:', error);
        }
      }
    } catch (error) {
      console.error('导入卡组失败:', error);
    }
  }, [allowDeckImport, canToggle, effectiveAllowedTypeSet, host.online, host.platform, maxSelected, onSelectCard, onToggleCard, selectedCount, selectedIdSet, selectionMode]);

  const handleDownloadCard = useCallback(async (card: any) => {
    const downloadJson = host.platform.downloadJson;
    if (!downloadJson) return;
    try {
      const signal = cardReadController.current.signal;
      const isCacheRow = isCachedDataCardRow(card);
      if (isCacheRow && !getCachedDataCardRowMeta(card)?.hasBody) return;
      const full = isLocalDataCardRow(card)
        ? card
        : isCacheRow
          ? (await loadCachedCardBody(card.id, signal)).card
          : typeof card.data === 'string' ? card : await host.online.loadFullCard(card, activeTab === 'my' ? 'my' : 'public', signal);
      if (signal.aborted) return;
      let cardPayload = full.data;
      if (typeof cardPayload === 'string') {
        cardPayload = JSON.parse(cardPayload);
      }
      // buildSafeFileName 一并把基名截断到 80 字符：超长卡名导出不会撞上文件系统文件名上限。
      downloadJson(buildSafeFileName(card.name ?? '', 'json', '数据卡'), JSON.stringify(cardPayload, null, 2));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setSelectError(error instanceof Error ? error.message : '保存数据卡失败');
    }
  }, [activeTab, host.online, host.platform, loadCachedCardBody]);

  /**
   * 从本机本地库删除一张数据卡。
   *
   * 与"取消选择"是两件事：删除后本地库不再保留这条记录，而取消选择只影响本次会话。
   * 这里刻意不做静默删除——tombstone 由仓储负责，UI 只负责把后果说清楚。
   */
  const handleRemoveLocalCard = useCallback(async (card: LocalDataCardRow) => {
    setLocalActionError(null);
    setRemovingLocalId(card.id);
    try {
      await host.local.repository.delete(card.id);
      localCards.reload();
    } catch (error) {
      setLocalActionError(error instanceof Error ? error.message : '本地库删除失败，请重试。');
    } finally {
      setRemovingLocalId((current) => (current === card.id ? null : current));
    }
  }, [localCards, host.local.repository]);

  /**
   * 「本地 → 线上副本」显式上传（D5.0e）。
   * 端口存在才接线；失败只显示错误，本地记录绝不被删除或改写。
   * 上传的是一份**新**线上记录（默认私有），本地卡仍没有服务器身份。
   */
  const handleUploadLocalCard = useCallback(async (card: LocalDataCardRow) => {
    const upload = host.online.uploadLocalRecord;
    if (!upload) return;
    const record = localRecordById.get(card.id);
    if (!record) {
      setLocalActionError('本地库中的这张数据卡已不可用。');
      return;
    }
    setLocalActionError(null);
    setLocalActionNotice(null);
    setUploadingLocalId(card.id);
    // 上传是账号绑定的写操作：await 返回时账号可能已切换，迟到的成功/失败
    // 提示都不得投影到新账号会话（DESK-ONLINE-010 stale-result rejection）。
    const ownerKey = latestAccountKeyRef.current;
    try {
      const result = await upload(record);
      if (latestAccountKeyRef.current !== ownerKey) return;
      if (result.ok) {
        setLocalActionNotice('已上传为云端新数据卡（默认私有）。');
      } else {
        setLocalActionError(result.error);
      }
    } catch (error) {
      if (latestAccountKeyRef.current !== ownerKey) return;
      setLocalActionError(error instanceof Error ? error.message : '上传到云端失败，请重试。');
    } finally {
      // spinner 是本行本地状态，不属于账号投影：无论身份是否已更换都要复位。
      setUploadingLocalId((current) => (current === card.id ? null : current));
    }
  }, [host.online, localRecordById]);

  /**
   * LIB-007「下载本地副本」：把线上数据卡复制一份进本机本地库。
   *
   * 复制而非移动：线上记录不受影响，本地副本通过 `cloudRef` 与它保持可辨认的对应关系。
   * 内容相同则整卡更新，用户不会因为多点一次就多出一张几乎一样的卡。
   */
  const handleSaveCardToLibrary = useCallback(async (card: any) => {
    setLocalActionError(null);
    // 详情弹窗用 `void onSaveCopyToLocalLibrary()` 调用：这里抛出去就是未处理
    // rejection，用户既看不到提示，弹窗也不会关。
    let payload: unknown;
    try {
      payload = typeof card?.data === 'string' ? JSON.parse(card.data) : card?.data;
    } catch {
      setLocalActionError('这张数据卡的正文不是合法 JSON，无法保存到本地库。');
      return;
    }
    if (payload === undefined || payload === null) {
      setLocalActionError('这张数据卡没有可保存的正文。');
      return;
    }
    // cloudRef 只记录权威出处：云端行写 cardId；本地行没有线上身份，不写。
    // 服务端目前没有对外暴露 revision token，不用 updated_at 之类的时间戳冒充。
    const isLocalRow = isLocalDataCardRow(card);
    const cloudCardId = !isLocalRow && typeof card?.id === 'string' && card.id ? card.id : undefined;
    const summary = await libraryAutoSave.save([{
      cardType: normalizeCardTypeForLibrary(card),
      title: typeof card?.name === 'string' && card.name.trim() ? card.name : '未命名数据卡',
      payload,
      // 该入口只对云端行暴露（本地行 details 卡不提供），固定为下载副本语义。
      execution: 'downloaded',
      cloudRef: cloudCardId ? { cardId: cloudCardId } : undefined,
    }]);
    if (libraryAutoSave.error) setLocalActionError(libraryAutoSave.error);
    setLibraryCopyMessage(summary.saved > 0
      ? `已保存到本地库：${summary.saved} 张。`
      : summary.updated > 0
        ? '本地库中已有内容相同的数据卡，已更新原卡。'
        : summary.inRecycleBin > 0
          ? '内容相同的数据卡在本地库回收站中，未重复保存；可在「本地库」页面恢复。'
          : summary.failed > 0
            ? '保存到本地库失败。'
            : null);
  }, [libraryAutoSave]);

  const handleSaveSelectedCardToLibrary = useCallback(async () => {
    if (!selectedCard) return;
    await handleSaveCardToLibrary(selectedCard);
    if (isLocalTab) localCards.reload();
  }, [selectedCard, handleSaveCardToLibrary, isLocalTab, localCards]);

  // 查看详情：与 DataCardsModal.withFullCard 一致，新动作 abort 旧动作，
  // 避免连续点击 A、B 时先返回的 A 覆盖最后点击的 B。
  const openCardDetails = useCallback(async (card: any) => {
    cardDetailControllerRef.current?.abort();
    const controller = new AbortController();
    cardDetailControllerRef.current = controller;
    const { signal } = controller;
    try {
      if (isLocalDataCardRow(card)) {
        const record = localRecordById.get(card.id);
        if (!record) throw new Error('本地库中的这张数据卡已不可用。');
        if (signal.aborted) return;
        setSelectedCard(mapLocalCardRecordToDetailsCard(record));
        setShowDetailsModal(true);
        return;
      }
      // 缓存行详情 = 正文快照；仅摘要行入口已禁用，这里兜底用缓存正文通道。
      const full = isCachedDataCardRow(card)
        ? (await loadCachedCardBody(card.id, signal)).card
        : await host.online.loadFullCard(card, activeTab === 'my' ? 'my' : 'public', signal);
      if (signal.aborted) return;
      setSelectedCard(full);
      setShowDetailsModal(true);
    } catch (error) {
      if (signal.aborted) return;
      setSelectError(error instanceof Error ? error.message : '读取数据卡失败');
    } finally {
      if (cardDetailControllerRef.current === controller) cardDetailControllerRef.current = null;
    }
  }, [activeTab, host.online, localRecordById, loadCachedCardBody]);

  // 【新增】处理高级筛选输入变化
  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name } = e.target;
    let nextValue: string | boolean = (e.target as HTMLInputElement).value;

    if (e.target instanceof HTMLInputElement && e.target.type === 'checkbox') {
      nextValue = e.target.checked;
    }

    setFilters(prev => ({ ...prev, [name]: nextValue } as Filters));
  };

  // 【新增】应用高级筛选
  const applyFilters = () => {
    const nextFilters = normalizeFiltersBySelectedType(filters);
    if (nextFilters !== filters) {
      setFilters(nextFilters);
    }
    setCurrentPage(1);
    setActiveFilters(nextFilters);
  };

  // 【新增】重置高级筛选
  const resetFilters = () => {
    setFilters(initialFilters);
    setActiveFilters(initialFilters);
    setCurrentPage(1);
  };

  // 【新增】处理作者点击事件
  const handleAuthorClick = (authorName: string) => {
    if (!isPublicTab) return;
    const newFilters = { ...initialFilters, author: authorName };
    setFilters(newFilters);
    setActiveFilters(newFilters);
    setCurrentPage(1);
    setShowAdvancedFilters(true); // 展开筛选器让用户看到
  };

  const handleFavoriteToggleForCard = useCallback(async (card: any, nextState: boolean) => {
    if (!isAuthenticated) {
      return false;
    }
    // 账号身份捕获：await 之后账号可能已切换——旧账号的迟到结果绝不能写回
    // 新账号的 UI（收藏集合、列表计数、收藏列表内容一律拒绝投影）。
    const ownerKey = latestAccountKeyRef.current;
    const isCurrentSession = () => latestAccountKeyRef.current === ownerKey;

    if (nextState) {
      const result = await host.online.addFavorite(card.id);
      if (!isCurrentSession()) {
        return false;
      }
      if (!result.success && !result.alreadyExists) {
        return false;
      }

      const delta = result.alreadyExists ? 0 : 1;

      setFavoriteView((prev) => {
        if (prev.owner !== ownerKey) return prev;
        const next = new Set(prev.ids);
        next.add(card.id);
        return { owner: ownerKey, ids: next };
      });

      if (delta !== 0) {
        setPublicDataCards((prev) => adjustFavoriteCount(prev, card.id, delta));
        setUserDataCards((prev) => adjustFavoriteCount(prev, card.id, delta));
      }

      setFavoriteCards((prev) => {
        const exists = prev.some((item) => item.id === card.id);
        let nextList = prev;
        if (exists) {
          nextList = delta !== 0 ? adjustFavoriteCount(prev, card.id, delta) : [...prev];
        } else {
          const newCard = {
            ...card,
            favorite_count: (card.favorite_count ?? 0) + delta,
            favorited_at: new Date().toISOString()
          };
          nextList = [...prev, newCard];
        }
        return sortFavorites(nextList, sortBy);
      });

      return true;
    }

    const result = await host.online.removeFavorite(card.id);
    if (!isCurrentSession()) {
      return false;
    }
    if (!result.success) {
      return false;
    }

    setFavoriteView((prev) => {
      if (prev.owner !== ownerKey) return prev;
      const next = new Set(prev.ids);
      next.delete(card.id);
      return { owner: ownerKey, ids: next };
    });

    setPublicDataCards((prev) => adjustFavoriteCount(prev, card.id, -1));
    setUserDataCards((prev) => adjustFavoriteCount(prev, card.id, -1));
    setFavoriteCards((prev) => prev.filter((item) => item.id !== card.id));
    reloadFavorites();

    return true;
  }, [isAuthenticated, host.online, adjustFavoriteCount, sortFavorites, sortBy, setUserDataCards, setFavoriteCards, reloadFavorites]);

  // 处理页码变化：翻页请求的显式 owner；公开页签无论筛选如何都重新发起服务端分页请求。
  // 在线/缓存两套分页互不串扰：缓存视图的翻页只读本机快照。
  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    if (isPublicTab) {
      if (publicViewMode === 'cache') reloadCachedCurrentQuery(newPage);
      else reloadPublicCurrentQuery(newPage);
    }
  };

  // 处理排序变化：只更新 state，由公开查询 effect 统一发起请求
  const handleSortChange = (newSortBy: 'likes' | 'usage' | 'favorites' | 'created_at') => {
    setSortBy(newSortBy);
    setCurrentPage(1);
  };

  const tagById = useMemo(() => {
    const map = new Map<string, ApiTag>();
    for (const tag of tagOptions) {
      if (!tag?.id) continue;
      map.set(tag.id, tag);
    }
    return map;
  }, [tagOptions]);

  const selectedTagChips = useMemo(() => {
    return selectedTagIds.map((id) => {
      const tag = tagById.get(id);
      return {
        id,
        label: tag?.name ?? id,
        description: tag?.description ?? null,
      };
    });
  }, [selectedTagIds, tagById]);

  const filteredTagOptions = useMemo(() => {
    const keyword = tagSearch.trim().toLowerCase();
    if (!keyword) return [];
    return tagOptions
      .filter((tag) => {
        const name = (tag.name || '').toLowerCase();
        const id = (tag.id || '').toLowerCase();
        const category = (tag.category || '').toLowerCase();
        const description = (tag.description || '').toLowerCase();
        return (
          name.includes(keyword) ||
          id.includes(keyword) ||
          category.includes(keyword) ||
          description.includes(keyword)
        );
      })
      .filter((tag) => !selectedTagIds.includes(tag.id))
      .slice(0, 8);
  }, [tagOptions, tagSearch, selectedTagIds]);

  const toggleTagFilter = useCallback((tagId: string) => {
    setSelectedTagIds((prev) => {
      if (prev.includes(tagId)) return prev.filter((id) => id !== tagId);
      return [...prev, tagId];
    });
  }, []);

  const clearTagFilters = useCallback(() => {
    setTagSearch('');
    setSelectedTagIds([]);
  }, []);

  const tagFilterSet = useMemo(() => new Set(selectedTagIds), [selectedTagIds]);
  const applyTagFilter = useCallback((cards: any[]) => {
    if (selectedTagIds.length === 0) return cards;
    return cards.filter((card) => {
      const tagIds = getCardTagIds(card);
      if (tagMatchMode === 'all') {
        if (tagIds.length === 0) return false;
        const tagSet = new Set(tagIds);
        return selectedTagIds.every((id) => tagSet.has(id));
      }
      return tagIds.some((id) => tagFilterSet.has(id));
    });
  }, [selectedTagIds, tagFilterSet, tagMatchMode]);

  const filteredPublicCards = useMemo(() => applyTagFilter(publicDataCards), [applyTagFilter, publicDataCards]);
  const userTotalPages = Math.max(1, Math.ceil(myPage.total / cardsPerPage));

  const favoritesTotalPages = Math.max(1, Math.ceil(favoritesPage.total / cardsPerPage));
  const paginatedUserCards = userDataCards;
  const paginatedFavoriteCards = favoriteCards;

  const publicPaginatedCards = filteredPublicCards;

  const localPaginatedCards = useMemo(
    () => localCards.rows.slice((currentPage - 1) * cardsPerPage, currentPage * cardsPerPage),
    [localCards.rows, currentPage, cardsPerPage],
  );
  const localTotalPages = Math.max(1, Math.ceil(localCards.total / cardsPerPage));

  const displayCards = useMemo(() => {
    if (activeTab === 'my') return paginatedUserCards;
    if (activeTab === 'favorites') return paginatedFavoriteCards;
    if (isLocalTab) return localPaginatedCards;
    // 缓存视图命中的行已是独立分页结果（不是在线行集的再过滤），
    // 直接整页展示；主动缓存视图中查询在飞时回空集，不把上一次线上行
    // 短暂投影到「本机缓存」横幅下。
    if (isPublicTab) {
      if (publicViewMode === 'cache') return cachedViewShown ? (cachedView?.entries ?? []) : [];
      return cachedViewShown ? (cachedView?.entries ?? []) : publicPaginatedCards;
    }
    return [];
  }, [activeTab, isLocalTab, isPublicTab, publicViewMode, paginatedUserCards, paginatedFavoriteCards, localPaginatedCards, publicPaginatedCards, cachedViewShown, cachedView]);

  // 「搜索/筛选无命中」和「这个库里本来就没有」对用户是两件事，空状态必须分开说。
  // 标签是与关键词、高级筛选各自独立的状态，且在每一个页签上都渲染，
  // 只看关键词和 Filters 会把「只按标签筛出了 0 条」误判成「库里本来就没有」。
  const hasActiveQuery = useMemo(() => (
    debouncedSearchQuery.trim().length > 0
    || selectedTagIds.length > 0
    || JSON.stringify(activeFilters) !== JSON.stringify(initialFilters)
  ), [debouncedSearchQuery, selectedTagIds, activeFilters, initialFilters]);

  const reloadActiveList = useCallback(() => {
    if (activeTab === 'my') { loadUserDataCards(); return; }
    if (activeTab === 'favorites') { favoritesPage.reload(); return; }
    if (isLocalTab) { localCards.reload(); return; }
    // 主动缓存视图的「重试」重读缓存快照——重连线上走横幅的「回到线上」。
    if (isPublicTab && publicViewMode === 'cache') { reloadCachedCurrentQuery(currentPage); return; }
    reloadPublicCurrentQuery(currentPage);
  }, [activeTab, isLocalTab, isPublicTab, publicViewMode, localCards, favoritesPage, reloadPublicCurrentQuery, reloadCachedCurrentQuery, currentPage, loadUserDataCards]);

  const displayCardIds = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const card of displayCards as any[]) {
      // 本地库记录与缓存快照行都不参与服务器侧的批量元数据请求：
      // 前者没有线上身份；后者是冻结输入，缓存模式不得暗中请求线上辅助端点。
      if (isLocalDataCardRow(card) || isCachedDataCardRow(card)) continue;
      const id = typeof card?.id === 'string' ? card.id.trim() : '';
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [displayCards]);

  useEffect(() => {
    if (!isOpen) return;
    if (displayCardIds.length === 0) return;
    const fetchCardMetaBatch = host.online.fetchCardMetaBatch;
    // 宿主未提供元数据批量查询时整体降级为不显示，不产生空请求。
    if (!fetchCardMetaBatch) return;

    // 本地库记录没有服务器侧技术值/段位；为它们发批量请求只会得到空响应。
    const pendingIds = displayCardIds.filter((id) => !Object.prototype.hasOwnProperty.call(cardMetaById, id));
    if (pendingIds.length === 0) return;

    metaFetchAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    metaFetchAbortControllerRef.current = abortController;

    const run = async () => {
      try {
        const items = await fetchCardMetaBatch(pendingIds, abortController.signal);
        if (!items) return;

        setCardMetaById((prev) => ({ ...prev, ...items }));
      } catch (error) {
        if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          return;
        }
        console.warn('加载数据卡技术值/段位失败（降级为不显示）:', error);
      } finally {
        if (metaFetchAbortControllerRef.current === abortController) {
          metaFetchAbortControllerRef.current = null;
        }
      }
    };

    void run();

    return () => {
      abortController.abort();
    };
  }, [isOpen, displayCardIds, cardMetaById, host.online]);

  // 批量获取作者佩戴的徽章
  const currentUserEquippedBadges = useMemo(() => {
    return (Array.isArray(userBadges) ? userBadges : [])
      .filter((ub) => ub.isEquipped)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((ub) => ub.badge);
  }, [userBadges]);

  useEffect(() => {
    if (!isOpen) return;
    if (displayCards.length === 0) return;
    const fetchAuthorBadgesBatch = host.online.fetchAuthorBadgesBatch;

    // "我的" 标签页直接使用当前用户的徽章
    if (activeTab === 'my' && userId) {
      setAuthorBadgesById((prev) => {
        if (prev[userId]) return prev;
        return { ...prev, [userId]: currentUserEquippedBadges };
      });
      return;
    }
    // 宿主未提供徽章批量查询时整体降级为不显示，不产生空请求。
    if (!fetchAuthorBadgesBatch) return;

    // 提取需要获取徽章的用户 ID（缓存快照行跳过——不暗中请求线上徽章端点）。
    const pendingUserIds = new Set<number>();
    for (const card of displayCards as any[]) {
      if (isCachedDataCardRow(card)) continue;
      const uid = typeof card?.user_id === 'number' ? card.user_id : 0;
      if (uid > 0 && !Object.prototype.hasOwnProperty.call(authorBadgesById, uid)) {
        pendingUserIds.add(uid);
      }
    }
    if (pendingUserIds.size === 0) return;

    badgeFetchAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    badgeFetchAbortControllerRef.current = abortController;

    const run = async () => {
      try {
        const items = await fetchAuthorBadgesBatch([...pendingUserIds], abortController.signal);
        if (!items) return;

        setAuthorBadgesById((prev) => ({ ...prev, ...items }));
      } catch (error) {
        if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          return;
        }
        console.warn('加载作者徽章失败（降级为不显示）:', error);
      } finally {
        if (badgeFetchAbortControllerRef.current === abortController) {
          badgeFetchAbortControllerRef.current = null;
        }
      }
    };

    void run();

    return () => {
      abortController.abort();
    };
  }, [isOpen, activeTab, displayCards, userId, currentUserEquippedBadges, authorBadgesById, host.online]);

  const currentTabTotalPages = activeTab === 'my'
    ? userTotalPages
    : activeTab === 'favorites'
      ? favoritesTotalPages
    : isLocalTab
      ? localTotalPages
    : isPublicTab
        ? (cachedViewShown
            ? cachedView?.totalPages ?? null
            : publicViewMode === 'cache' ? null : publicTotalPages)
        : null;
  const typeLabelMap: Record<BattleDataSelectedType, string> = {
    character: '角色',
    scenario: '情景',
    history: '叙事历史',
    questionnaire: '问卷',
    all: '素材',
  };
  const typeLabel = typeLabelMap[selectedType] ?? '数据';
  const modalTitle = titleOverride || `选择${typeLabel}数据卡`;
  const isFilterActive = useMemo(() => {
    return Boolean(
      publicFilters.author ||
      publicFilters.minLikes ||
      publicFilters.maxLikes ||
      publicFilters.minUsage ||
      publicFilters.maxUsage ||
      publicFilters.minFavorites ||
      publicFilters.maxFavorites ||
      publicFilters.recommendedOnly ||
      publicFilters.roleType ||
      publicFilters.nativeOnly ||
      publicFilters.nativeAllowedOnly
    );
  }, [publicFilters]);

  const { tabId: activeTabTabId, panelId: activeTabPanelId } = modalTabIds(TAB_ID_PREFIX, activeTab);

  /**
   * 页签定义。顺序即 effectiveTabs 的声明顺序，直接决定 rail 上的左右次序。
   *
   * 数量交给 ModalTabs 的 `count` 渲染成 `tabular-nums` 片段，而不是拼进 label：
   * 切换页签时数字变化不该把整条 rail 的宽度顶得跳动。
   */
  const tabItems: ModalTabItem<BattleDataTab>[] = [];
  if (effectiveTabs.includes('my')) {
    tabItems.push({ value: 'my', label: `我的${typeLabel}`, count: myPage.hasLoaded ? myPage.total : '—' });
  }
  if (effectiveTabs.includes('local')) {
    tabItems.push({
      value: 'local',
      label: '本地库',
      count: localCards.status === 'success' ? localCards.libraryTotal : '—',
      title: '本机本地库，无需登录；清除站点数据会一并删除',
    });
  }
  if (effectiveTabs.includes('public')) {
    tabItems.push({ value: 'public', label: `公开${typeLabel}` });
  }
  if (effectiveTabs.includes('recommended')) {
    tabItems.push({ value: 'recommended', label: '管理员推荐' });
  }
  if (effectiveTabs.includes('favorites')) {
    tabItems.push({ value: 'favorites', label: '我的收藏', count: favoritesPage.hasLoaded ? favoritesPage.total : '—' });
  }

  /**
   * 页签切换统一入口：原先每个按钮各自内联一套 onClick，现在按「是否当前页签」分派。
   *
   * 再次点击当前页签 = 用当前查询刷新，这是既有交互，不因为收敛到 ModalTabs 而丢掉；
   * 各页签的刷新入口本来就不同，切换页签只改 state、请求仍由 effect 发起。
   */
  const handleTabChange = (next: BattleDataTab) => {
    hasUserSelectedTabRef.current = true;
    if (next === activeTab) {
      setCurrentPage(1);
      if (next === 'my') loadUserDataCards();
      else if (next === 'local') localCards.reload();
      else if (next === 'favorites') favoritesPage.reload();
      else if (next === 'public' || next === 'recommended') {
        if (publicViewMode === 'cache') reloadCachedCurrentQuery(1);
        else reloadPublicCurrentQuery(1);
      }
      return;
    }
    setActiveTab(next);
    setCurrentPage(1);
  };

  if (!isOpen) {
    return null;
  }

  const modal = (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal={detailsModalOpenRef.current ? undefined : 'true'}
        aria-hidden={detailsModalOpenRef.current ? 'true' : undefined}
        aria-labelledby={modalTitleId}
        aria-label={modalTitle}
        tabIndex={-1}
        className="bg-white rounded-xl p-4 shadow-2xl sm:p-6 w-full max-w-[90rem] h-[85dvh] max-h-[90dvh] overflow-hidden flex flex-col relative"
      >
        <button
          type="button"
          ref={closeButtonRef}
          onClick={onClose}
          aria-label={`关闭${modalTitle}`}
          className="absolute right-4 top-4 z-10 inline-flex min-h-10 min-w-10 items-center justify-center text-gray-400 hover:text-gray-600 text-2xl"
        >×</button>
		        <h2 id={modalTitleId} className="text-xl font-bold pr-8">{modalTitle}</h2>
          {selectError && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {selectError}
            </div>
          )}
          {localActionError && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {localActionError}
            </div>
          )}
          {localActionNotice && (
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">
              {localActionNotice}
            </div>
          )}
          {externalError && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {externalError}
            </div>
          )}
          {selectionMode === 'multi' && typeof maxSelected === 'number' && maxSelected > 0 ? (
            <div className="mt-1 mb-4 text-sm text-gray-600">
              已选 {selectedCount}/{maxSelected}
              {canToggle ? '（再次点击已选卡可取消）' : ''}
              {atLimit ? '，已达到上限' : ''}
            </div>
          ) : (
            <div className="mb-4" />
          )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* 筛选和排序区域 */}
          <div className="mb-2">
            <div className="flex flex-wrap gap-2 mb-2 items-center">
              <div className="flex-1 relative min-w-[250px]">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onCompositionStart={() => {
                    isComposingSearchRef.current = true;
                  }}
                  onCompositionEnd={() => {
	                    isComposingSearchRef.current = false;
	                  }}
	                  placeholder={`搜索${typeLabel}名称或粘贴分享链接...`}
	                  className="w-full input-field pr-10"
	                />
	                {searchQuery && searchQuery !== debouncedSearchQuery && <div className="absolute right-3 top-1/2 -translate-y-1/2"><div className="w-4 h-4 border-2 border-pink-500 border-t-transparent rounded-full animate-spin"></div></div>}
	              </div>
	              <SortSelector value={sortBy} onChange={handleSortChange} />
              {isPublicTab && (
                <button
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-colors ${isFilterActive ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  <Filter className="w-4 h-4" /> 高级筛选 <ChevronDown className={`w-4 h-4 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
                </button>
              )}
              {isPublicTab && host.publicCache && (
                <button
                  type="button"
                  onClick={() => setPublicViewMode((mode) => (mode === 'cache' ? 'online' : 'cache'))}
                  className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-colors ${
                    publicViewMode === 'cache'
                      ? 'bg-amber-500 text-white hover:bg-amber-600'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  title={publicViewMode === 'cache'
                    ? '回到线上公开库（自动重新查询当前线上结果）'
                    : '浏览本机缓存的公开资料快照（不依赖网络）'}
                >
                  <HardDrive className="w-4 h-4" /> {publicViewMode === 'cache' ? '线上' : '已缓存'}
                </button>
              )}
            </div>
            {(
              <div className="mb-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs font-semibold text-gray-600">标签过滤</div>
                  <div className="relative flex-1 min-w-[180px]">
                    <input
                      type="text"
                      value={tagSearch}
                      onChange={(e) => setTagSearch(e.target.value)}
                      onFocus={ensureTagOptions}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setTagSearch('');
                          return;
                        }
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (filteredTagOptions.length > 0) {
                            toggleTagFilter(filteredTagOptions[0].id);
                            setTagSearch('');
                          }
                        }
                      }}
                      placeholder="搜索/添加标签"
                      className="input-field h-8 text-xs pr-8"
                    />
                    {tagOptionsLoading && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <div className="w-3 h-3 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>
                  {selectedTagIds.length > 0 && (
                    <button
                      type="button"
                      onClick={clearTagFilters}
                      className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                    >
                      清空
                    </button>
                  )}
                  <div className="flex items-center gap-1 text-[11px] text-gray-500">
                    <span>匹配</span>
                    <div className="inline-flex rounded-full border border-gray-200 bg-white overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setTagMatchMode('any')}
                        className={`px-2 py-0.5 text-[11px] transition-colors ${
                          tagMatchMode === 'any' ? 'bg-pink-500 text-white' : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        任一
                      </button>
                      <button
                        type="button"
                        onClick={() => setTagMatchMode('all')}
                        className={`px-2 py-0.5 text-[11px] transition-colors ${
                          tagMatchMode === 'all' ? 'bg-pink-500 text-white' : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        全部
                      </button>
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedTagChips.length === 0 ? (
                    <div className="text-[11px] text-gray-500">未选择标签</div>
                  ) : (
                    selectedTagChips.map((chip) => (
                      <span
                        key={chip.id}
                        className="inline-flex items-center gap-2 rounded-full bg-pink-50 px-3 py-1 text-xs text-pink-800"
                        title={chip.description ?? chip.label}
                      >
                        {chip.label}
                        <button
                          type="button"
                          className="text-pink-700 hover:text-pink-900"
                          onClick={() => toggleTagFilter(chip.id)}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </div>
                {tagSearch.trim() && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {tagOptionsLoading ? (
                      <div className="text-[11px] text-gray-500">正在加载标签库...</div>
                    ) : filteredTagOptions.length === 0 ? (
                      <div className="text-[11px] text-gray-500">未找到匹配标签</div>
                    ) : (
                      filteredTagOptions.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => {
                            toggleTagFilter(tag.id);
                            setTagSearch('');
                          }}
                          className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-100"
                          title={tag.description ?? tag.name}
                        >
                          {tag.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
                {tagOptionsError && (
                  <div className="mt-1 text-[11px] text-red-600">{tagOptionsError}</div>
                )}
                {publicCacheBanner !== null && tagOptions.length === 0 && (
                  <div className="mt-1 text-[11px] text-gray-400">
                    缓存视图：标签候选项需联网加载；已选标签仍可作用于缓存筛选。
                  </div>
                )}
              </div>
            )}
            {/* 【新增】高级筛选面板 */}
            {showAdvancedFilters && isPublicTab && (
              <div className="p-4 bg-gray-50 rounded-lg border space-y-3 mb-2 animate-fade-in-down">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">作者</label>
                    <input type="text" name="author" value={filters.author} onChange={handleFilterChange} placeholder="输入作者名" className="input-field" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">点赞数</label>
                    <div className="flex gap-2">
                      <input type="number" name="minLikes" value={filters.minLikes} onChange={handleFilterChange} placeholder="最少" className="input-field w-1/2" />
                      <input type="number" name="maxLikes" value={filters.maxLikes} onChange={handleFilterChange} placeholder="最多" className="input-field w-1/2" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">使用数</label>
                    <div className="flex gap-2">
                      <input type="number" name="minUsage" value={filters.minUsage} onChange={handleFilterChange} placeholder="最少" className="input-field w-1/2" />
                      <input type="number" name="maxUsage" value={filters.maxUsage} onChange={handleFilterChange} placeholder="最多" className="input-field w-1/2" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">收藏数</label>
                    <div className="flex gap-2">
                      <input type="number" name="minFavorites" value={filters.minFavorites} onChange={handleFilterChange} placeholder="最少" className="input-field w-1/2" />
                      <input type="number" name="maxFavorites" value={filters.maxFavorites} onChange={handleFilterChange} placeholder="最多" className="input-field w-1/2" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">角色类型</label>
                    <select
                      name="roleType"
                      value={filters.roleType}
                      onChange={handleFilterChange}
                      className="input-field disabled:bg-gray-100 disabled:text-gray-400"
                      disabled={selectedType !== 'character'}
                    >
                      <option value="">全部</option>
                      <option value="magical-girl">魔法少女</option>
                      <option value="canshou">残兽</option>
                      <option value="general">通用</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      name="nativeOnly"
                      checked={filters.nativeOnly}
                      onChange={handleFilterChange}
                      disabled={selectedType === 'questionnaire' || publicCacheBanner !== null}
                    />
                    <span className={selectedType === 'questionnaire' || publicCacheBanner !== null ? 'text-gray-400' : ''}>仅看原生</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      name="nativeAllowedOnly"
                      checked={filters.nativeAllowedOnly}
                      onChange={handleFilterChange}
                      disabled={selectedType !== 'questionnaire'}
                    />
                    <span className={selectedType !== 'questionnaire' ? 'text-gray-400' : ''}>仅看原生许可</span>
                  </label>
                </div>
                {publicCacheBanner !== null && (
                  <p className="text-[11px] leading-5 text-gray-500">
                    缓存视图：「仅看原生」依赖线上元数据，当前不可用并已忽略；「仅看原生许可」按抓取时保存的标记筛选，不代表当前资格。
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={resetFilters} className="px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">重置</button>
                  <button onClick={applyFilters} className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-md hover:bg-purple-700">应用筛选</button>
                </div>
              </div>
            )}
          </div>

          {listError && !cachedViewShown && publicCacheBanner !== 'browse' && <div role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {displayCards.length ? `刷新失败，当前显示上次成功结果：${listError}` : `数据卡加载失败：${listError}`}
            <button type="button" disabled={listLoading} className="ml-3 px-3 py-2 rounded bg-white disabled:opacity-50"
              onClick={reloadActiveList}>重试</button>
          </div>}
          {/* 标签页切换。窄屏由 ModalTabs 内部横向滚动承载，不再让 flex 收缩把中文标签压成竖排。
              整行 sticky：卡片网格在滚动容器里，往下翻页时页签必须留在视野内，
              否则手机上滚到列表底部就再也切不了页签，只能一路滚回顶部。
              z-10 只在「下方内容区已自成一个层叠上下文」时成立——卡片网格的 `isolate` 是
              这个前提，两处必须一起改，否则卡内浮层会穿透上来。 */}
          <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center justify-between gap-2 bg-white py-1">
            <ModalTabs
              idPrefix={TAB_ID_PREFIX}
              ariaLabel={TAB_ARIA_LABEL}
              items={tabItems}
              value={activeTab}
              onValueChange={handleTabChange}
              className="max-w-full"
            />

            {/* 卡组导入不是页签，必须留在滚动 rail 之外，否则它会被一起卷走。 */}
            {canImportDeck && (
              <button
                onClick={() => setShowDecksModal(true)}
                className="px-4 py-2 rounded text-sm font-medium bg-purple-600 text-white hover:bg-purple-700"
              >
                卡组导入
              </button>
            )}
          </div>

	          {/* 内容区域 */}
          <div
            role="tabpanel"
            id={activeTabPanelId}
            aria-labelledby={activeTabTabId}
          >
            {isLocalTab ? (
              <div className="mb-3">
                {host.slots.renderLocalLibraryBanner?.()}
              </div>
            ) : null}
            {publicCacheBanner ? (
              <div className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
                publicCacheBanner === 'browse'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <HardDrive className="h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    {publicCacheBanner === 'browse' ? (
                      <>
                        正在浏览本机缓存的公开资料快照
                        {cachedView && cachedView.key === currentPublicRequestKey
                          ? `：命中 ${cachedView.total} 条（${cachedView.bodyCount} 条已缓存正文可离线打开）`
                          : ''}
                        ，不是当前线上结果。
                      </>
                    ) : (
                      <>
                        线上公开库暂时不可用{publicError ? `（${publicError}）` : ''}，
                        正在显示本机缓存快照，不代表线上现状。
                      </>
                    )}
                    {cachedViewShown && cachedView ? (
                      <>
                        {cachedView.status === 'unavailable' ? ' 缓存库当前不可用。' : ''}
                        {cachedView.status === 'unsupported-schema' ? ' 缓存库由更新版本创建，本版本不可读取。' : ''}
                        {cachedView.partial ? ' 部分类型缓存不可用，结果可能不全。' : ''}
                        {nativeOnlyIgnored ? ' 「仅看原生」筛选依赖线上元数据，缓存中不可用、已忽略。' : ''}
                      </>
                    ) : null}
                  </span>
                  <span className="flex-1" />
                  {publicCacheBanner === 'browse' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => reloadCachedCurrentQuery(currentPage)}
                        className="rounded border border-amber-300 bg-white px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                      >
                        刷新快照视图
                      </button>
                      <button
                        type="button"
                        onClick={() => setPublicViewMode('online')}
                        className="rounded border border-amber-300 bg-white px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                      >
                        回到线上
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => reloadPublicCurrentQuery(currentPage)}
                      className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-800 hover:bg-red-100"
                    >
                      重试线上
                    </button>
                  )}
                  {host.publicCache?.openCacheManagement ? (
                    <button
                      type="button"
                      onClick={() => host.publicCache?.openCacheManagement?.()}
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                    >
                      管理缓存
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
	            {(listLoading || listIdle) && displayCards.length === 0 ? (
	              <div className="flex justify-center items-center min-h-[40vh]"><div className="text-gray-500">加载中...</div></div>
	            ) : displayCards.length === 0 ? (
	              <DataCardEmptyState
	                tab={activeTab}
	                typeLabel={typeLabel}
	                error={Boolean(listError)}
	                hasActiveSearch={hasActiveQuery}
	                onRetry={listError ? reloadActiveList : undefined}
	                localLibraryLink={host.slots.localLibraryLink}
	                renderLocalEmpty={host.slots.renderLocalLibraryEmpty}
                  cacheView={publicCacheBanner}
                  cachedStatus={cachedView?.status}
	              />
	            ) : (
		              <div
                        // `isolate` 让网格自成一个层叠上下文。卡片右上角的 +/- 浮层是
                        // `absolute z-20`，而卡片容器只是 `relative`（z-index 为 auto，不构成
                        // 层叠上下文），于是这个 z-20 直接和弹窗的 chrome 参与比较，压过上方
                        // `z-10` 的 sticky 页签行——卡片被遮住了，浮层按钮却还浮在页签行上。
                        // 隔离后 z-20 只在网格内部生效，sticky 行仍然盖住整片列表。
                        className="isolate grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                      >
		                {displayCards.map((card: any) => {
		                  const isFavorited = favoriteIds.has(card.id);
		                  const cachedMeta = getCachedDataCardRowMeta(card);
		                  const rowIsCached = cachedMeta !== null;
		                  const rowIsLocal = isLocalDataCardRow(card);
		                  // unknown（会话探测中）不等于已登出：入口保持可用，真正拒绝由
		                  // handleFavoriteToggleForCard 的 authenticated 检查兜底。
		                  // 缓存行不提供收藏入口——收藏是服务器权威写路径（DESK-CACHE-004）。
		                  const enableFavorite = authStatus !== 'unauthenticated' && activeTab !== 'my' && !rowIsCached;
	                    const isSelected = selectedIdSet.has(card.id);
	                    // 仅摘要缓存行：可浏览元数据，但正文相关动作一律不可执行。
	                    const rowBodyUnavailable = rowIsCached && cachedMeta.hasBody !== true;
	                    const itemDisabled = rowBodyUnavailable || (selectionMode === 'multi' && !isSelected && atLimit);
	                    const showQuickToggle = !browseOnly && selectionMode === 'multi';
	                    const quickToggleDisabled = rowBodyUnavailable || (isSelected ? !canToggle : itemDisabled);
	                    const quickToggleTitle = rowBodyUnavailable
	                      ? '只缓存了摘要，联网后才能使用这张卡'
	                      : isSelected
	                        ? (canToggle ? '移除' : '当前模式不支持移除')
	                        : (itemDisabled ? '已达到上限' : '加入');
                      const questionnaireNativeAllowed = resolveQuestionnaireNativeAllowed(card);

		                  return (
		                    <div
                        key={card.id}
                        className={`relative h-full ${browseOnly ? '' : itemDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        {...(!browseOnly && selectionMode === 'single' ? {
                          role: 'button',
                          tabIndex: itemDisabled ? -1 : 0,
                          'aria-label': `选择${card.name || typeLabel}`,
                          'aria-disabled': itemDisabled || undefined,
                          onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                            if (itemDisabled) return;
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            void handleSelectCard(card);
                          },
                        } : {})}
                        onClick={() => {
                          if (itemDisabled) return;
                          void handleSelectCard(card);
                        }}
                      >
                      {showQuickToggle && (
		                        <button
		                          type="button"
		                          className={`absolute top-2 right-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 text-lg font-bold leading-none shadow-sm transition-colors after:absolute after:rounded-full after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 after:-inset-1 ${
	                            quickToggleDisabled
	                              ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
	                              : isSelected
	                                ? 'border-transparent bg-red-500 text-white hover:bg-red-600 focus-visible:ring-red-500'
	                                : 'border-transparent bg-emerald-500 text-white hover:bg-emerald-600 focus-visible:ring-emerald-500'
	                          }`}
	                          onClick={(e) => {
	                            e.stopPropagation();
	                            if (quickToggleDisabled) return;
	                            void handleSelectCard(card);
	                          }}
	                          disabled={quickToggleDisabled}
	                          title={quickToggleTitle}
	                          aria-label={quickToggleTitle}
	                        >
	                          {isSelected ? '-' : '+'}
	                        </button>
	                      )}
	                      <DataCard
                          browseOnly={browseOnly}
	                        platform={{
	                          Link: host.platform.Link,
	                          reviewHref: '/encyclopedia/review',
	                          marks: host.platform.marks,
	                          copyText: host.platform.copyText,
	                          reportStat: host.online.reportCardStat,
	                        }}
	                        storageLocation={rowIsLocal ? 'local' : rowIsCached ? 'cache' : 'cloud'}
                          cacheBodyAvailable={cachedMeta?.hasBody}
                          cacheLastConfirmedAt={cachedMeta?.lastSuccessAt}
	                        onRemoveFromLibrary={rowIsLocal ? () => setPendingLocalRemoval(card) : undefined}
	                        removePending={removingLocalId === card.id}
	                        onUploadToCloud={
	                          rowIsLocal && host.online.uploadLocalRecord
	                            ? () => void handleUploadLocalCard(card)
	                            : undefined
	                        }
	                        uploadPending={uploadingLocalId === card.id}
	                        localLibraryOriginHint={rowIsLocal ? '仅保存在本机，不会上传' : null}
	                        id={card.id}
	                        name={card.name}
	                        description={card.description}
	                        type={card.type}
	                        roleType={card.roleType}
	                        isPublic={normalizePublicVisibilityValue(card)}
                          isSelected={isSelected}
	                        reviewStatus={card.review_status}
	                        usageCount={card.usage_count}
	                        likeCount={card.like_count}
	                        favoriteCount={card.favorite_count}
                          techScore={cardMetaById[card.id]?.techScore ?? null}
                          techLevel={cardMetaById[card.id]?.techLevel ?? null}
                          strictTier={cardMetaById[card.id]?.strictTier ?? null}
                          isNative={cardMetaById[card.id]?.isNative ?? null}
                          questionnaireNativeAllowed={questionnaireNativeAllowed}
	                        isFavorited={isFavorited}
	                        canFavorite={enableFavorite}
	                        isRecommended={card.is_recommended === 1}
	                        author={activeTab === 'my' ? '我' : (card.username || '未知')}
	                        authorBadges={activeTab === 'my' ? currentUserEquippedBadges : (authorBadgesById[card.user_id] ?? [])}
		                        onViewDetails={allowCardDetails && host.slots.CardDetailsModal && !rowBodyUnavailable ? () => { void openCardDetails(card); } : undefined}
	                        onAuthorClick={handleAuthorClick}
	                        onToggleFavorite={enableFavorite ? (next) => handleFavoriteToggleForCard(card, next) : undefined}
	                        onDownload={host.platform.downloadJson && !rowBodyUnavailable ? () => { void handleDownloadCard(card); } : undefined}
	                      />
	                    </div>
	                  );
	                })}
	              </div>
      )}

      {/* 注入的 DecksModal 内部持有账号私有 state 且不按账号隔离：
          `key` 绑定账号身份，换身份即整体重挂载，旧账号内容不可见。 */}
      {allowDeckImport && host.slots.DecksModal ? (
        <host.slots.DecksModal
          key={accountKey}
          isOpen={showDecksModal}
          onClose={() => setShowDecksModal(false)}
          onImportDeck={(deckId) => void handleImportDeck(deckId)}
        />
      ) : null}

          {/* 分页与底部 */}
          {(
            (activeTab === 'my' && myPage.total > cardsPerPage) ||
            (activeTab === 'favorites' && favoritesPage.total > cardsPerPage) ||
            (isPublicTab && (
              publicViewMode === 'cache'
                ? cachedViewShown && ((cachedView?.totalPages ?? 1) > 1 || currentPage > 1)
                : cachedViewShown
                  ? (cachedView?.totalPages ?? 1) > 1 || currentPage > 1
                  : publicTotalPages !== null
                    ? publicTotalPages > 1 || currentPage > 1
                    : (displayCards.length >= cardsPerPage || currentPage > 1)
            ))
          ) &&
            <div className="flex justify-center items-center gap-2 pt-4 border-t mt-4">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className={buttonClassName({ variant: 'secondary', size: 'md' })}
              >
                上一页
              </button>
              <span className="text-sm text-gray-600">
                第 {currentPage} 页
                {currentTabTotalPages ? ` / ${currentTabTotalPages}` : ''}
              </span>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={
                  activeTab === 'my'
                    ? currentPage >= userTotalPages
                    : activeTab === 'favorites'
                      ? currentPage >= favoritesTotalPages
                      : isLocalTab
                        ? currentPage >= localTotalPages
                        : publicViewMode === 'cache'
                          ? !cachedViewShown || currentPage >= (cachedView?.totalPages ?? 1)
                          : cachedViewShown
                            ? currentPage >= (cachedView?.totalPages ?? 1)
                            : publicTotalPages
                              ? currentPage >= publicTotalPages
                              : displayCards.length < cardsPerPage
                }
                className={buttonClassName({ variant: 'secondary', size: 'md' })}
              >
                下一页
              </button>
            </div>
          }
            </div>
	    </div>
	  </div>

	  {/* 本地库删除二次确认：删除只影响本机，但不可从选择弹窗里撤销，措辞必须说清楚 */}
      <BaseModal
        isOpen={pendingLocalRemoval !== null}
        title="从本地库删除这张数据卡？"
        maxWidthClassName="max-w-md"
        closeOnBackdrop={!removingLocalId}
        onClose={() => { if (!removingLocalId) setPendingLocalRemoval(null); }}
        footer={(
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded text-sm border border-gray-300 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
              disabled={removingLocalId !== null}
              onClick={() => setPendingLocalRemoval(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              disabled={removingLocalId !== null}
              onClick={() => {
                if (pendingLocalRemoval) void handleRemoveLocalCard(pendingLocalRemoval).then(() => setPendingLocalRemoval(null));
              }}
            >
              {removingLocalId !== null ? '正在删除…' : '删除'}
            </button>
          </div>
        )}
      >
        <p className="text-sm text-gray-700 dark:text-gray-200">
          「{pendingLocalRemoval?.name}」只会从这台设备的本地库中移除，不影响任何线上数据卡，
          也不会同步到其他设备。删除后会移入本地库回收站，可在「本地库」页面恢复或彻底删除。
        </p>
      </BaseModal>

	  {/* 详情模态框 */}
      {allowCardDetails && selectedCard && host.slots.CardDetailsModal && (
        <host.slots.CardDetailsModal
          onSaveCopyToLocalLibrary={isLocalDataCardRow(selectedCard) ? undefined : handleSaveSelectedCardToLibrary}
          localLibrarySaveState={{ busy: libraryAutoSave.busy, message: libraryCopyMessage }}
          isOpen={showDetailsModal}
          fallbackFocusRef={closeButtonRef}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedCard(null);
            closeButtonRef.current?.focus();
          }}
          card={{
            id: selectedCard.id,
            name: selectedCard.name,
            description: selectedCard.description,
            type: selectedCard.type,
            data: selectedCard.data,
            isPublic: getDataCardStatus(selectedCard).status === 'public',
            usageCount: selectedCard.usage_count,
            likeCount: selectedCard.like_count,
            favoriteCount: selectedCard.favorite_count,
            author: activeTab === 'my' ? '我' : (selectedCard.username || '未知'),
            authorBadges: activeTab === 'my' ? currentUserEquippedBadges : (authorBadgesById[selectedCard.user_id] ?? []),
            createdAt: selectedCard.created_at,
            updatedAt: selectedCard.updated_at
          }}
        />
	  )}
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modal, document.body);
  }
  return modal;
}
