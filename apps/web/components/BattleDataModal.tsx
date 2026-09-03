// components/BattleDataModal.tsx

import React, { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import DataCard from './DataCard';
import SortSelector from './SortSelector';
import DataCardDetailsModal from './DataCardDetailsModal';
import { useAuth } from '@/lib/useAuth';
import { authStorage, dataCardApi, favoritesApi, deckApi } from '@/lib/auth';
import {
  isPublicVisibility,
  mapPublicDataCardRowToBattleSelectionPayload,
  normalizePublicVisibilityValue,
} from '@/lib/data-card-read-mappers';
import { addUsedCard, isCardUsed } from '@/lib/localStorage';
import { inferTemplate } from '@/lib/data-card-converter';
import { buildTitleDisplay } from '@/lib/text';
import { ChevronDown, Filter } from 'lucide-react';
import DecksModal from './DecksModal';
import { getDataCardStatus } from '@/lib/data-card-status';
import type { BadgeDefinition } from '@/types/badge';
import {
  ONLINE_DATA_CARD_TYPES,
  OnlineDataCardTypeSchema,
  type OnlineDataCardType,
} from '@mahoshojo/contracts/data-cards';

type DataCardType = OnlineDataCardType;
type BattleDataSelectedType = DataCardType | 'all';

interface BattleDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCard?: (card: any) => void;
  onToggleCard?: (card: any, nextSelected: boolean) => void;
  selectedType: BattleDataSelectedType;
  allowedTypes?: DataCardType[];
  initialTab?: BattleDataTab;
  visibleTabs?: BattleDataTab[];
  titleOverride?: string;
  pvpHandTab?: PvpHandTabProps;
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

type BattleDataTab = 'my' | 'public' | 'recommended' | 'favorites' | 'pvpHand';

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

type PvpHandTabCard = {
  snapshotId: string;
  name: string;
  type?: string | null;
  dataJson?: string | null;
  ref?: any;
};

type PvpHandTabProps = {
  cards: PvpHandTabCard[];
  hasChosenMe: boolean;
  isChoosing: boolean;
  onChoose: (snapshotId: string) => void;
};

const getPvpHandSourceLabel = (ref: any): string => {
  const kind = typeof ref?.kind === 'string' ? ref.kind : '';
  if (kind === 'preset') return '预设';
  if (kind === 'data_card') return '数据卡';
  return '快照';
};

const getPvpHandRefHint = (ref: any): string | null => {
  const kind = typeof ref?.kind === 'string' ? ref.kind : '';
  if (kind === 'preset') return typeof ref?.filename === 'string' ? ref.filename : null;
  if (kind === 'data_card') return typeof ref?.id === 'string' ? ref.id : null;
  return null;
};

const getPvpHandPreviewText = (dataJson: string | null | undefined): string => {
  if (!dataJson) return '';
  try {
    const parsed = JSON.parse(dataJson);
    const codename = typeof parsed?.codename === 'string' ? parsed.codename : null;
    const name = typeof parsed?.name === 'string' ? parsed.name : null;
    const templateId: unknown = parsed?.templateId || parsed?.template || parsed?.template_id;
    const templateText = typeof templateId === 'string' ? templateId : null;
    const parts = [codename, name, templateText].filter((x): x is string => typeof x === 'string' && Boolean(x.trim()));
    const line = parts.join(' / ').trim();
    if (line) return line.length > 120 ? `${line.slice(0, 120)}…` : line;
  } catch {
    // ignore
  }

  const collapsed = dataJson.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  return collapsed.length > 120 ? `${collapsed.slice(0, 120)}…` : collapsed;
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

export default function BattleDataModal({
  isOpen,
  onClose,
  onSelectCard,
  onToggleCard,
  selectedType,
  allowedTypes,
  initialTab,
  visibleTabs,
  titleOverride,
  pvpHandTab,
  selectionMode = 'single',
  selectedCardIds,
  selectedCountOverride,
  maxSelected,
  externalError,
  allowDeckImport = true,
  allowCardDetails = true,
}: BattleDataModalProps) {
  const { isAuthenticated, user, userBadges } = useAuth();
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
  const isSingleSelectingRef = useRef(false);
  const [userDataCards, setUserDataCards] = useState<any[]>([]);
  const [publicDataCards, setPublicDataCards] = useState<any[]>([]);
  const [favoriteCards, setFavoriteCards] = useState<any[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
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
  detailsModalOpenRef.current = allowCardDetails && showDetailsModal && selectedCard !== null;
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

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
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
      if (detailsModalOpenRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

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
      document.body.style.overflow = previousBodyOverflow;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

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

  const effectiveTabs = useMemo<BattleDataTab[]>(() => {
    const candidates = Array.isArray(visibleTabs) && visibleTabs.length > 0
      ? visibleTabs
      : ([
        ...(pvpHandTab ? (['pvpHand'] as const) : []),
        ...(isAuthenticated ? (['my'] as const) : []),
        'public' as const,
        'recommended' as const,
        ...(isAuthenticated ? (['favorites'] as const) : []),
      ] as const);

    const seen = new Set<BattleDataTab>();
    const out: BattleDataTab[] = [];
    for (const tab of candidates as BattleDataTab[]) {
      if ((tab === 'my' || tab === 'favorites') && !isAuthenticated) continue;
      if (tab === 'pvpHand' && !pvpHandTab) continue;
      if (seen.has(tab)) continue;
      seen.add(tab);
      out.push(tab);
    }
    return out.length > 0 ? out : ['public'];
  }, [visibleTabs, pvpHandTab, isAuthenticated]);

  const isPvpHandTab = activeTab === 'pvpHand';
  const isPublicTab = activeTab === 'public' || activeTab === 'recommended';

  const inferRoleType = useCallback((card: any): 'magical-girl' | 'canshou' | 'general' | null => {
    if (!card || card.type !== 'character') return null;

    let payload = card.data;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }

    const tpl = inferTemplate(payload);
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

  const loadTagOptions = useCallback(async () => {
    if (tagOptionsLoading || tagOptions.length > 0) return;
    setTagOptionsLoading(true);
    setTagOptionsError(null);
    try {
      const response = await fetch('/api/tags?includeInactive=1');
      if (!response.ok) {
        setTagOptionsError(`标签库加载失败（${response.status}）`);
        return;
      }
      const json = (await response.json()) as { success: boolean; tags?: ApiTag[]; error?: string };
      if (!json?.success) {
        setTagOptionsError(json?.error ?? '标签库加载失败');
        return;
      }
      setTagOptions(Array.isArray(json.tags) ? json.tags : []);
    } catch (error) {
      setTagOptionsError(String(error));
    } finally {
      setTagOptionsLoading(false);
    }
  }, [tagOptions.length, tagOptionsLoading]);

  const ensureTagOptions = useCallback(() => {
    if (tagOptions.length > 0 || tagOptionsLoading) return;
    void loadTagOptions();
  }, [loadTagOptions, tagOptions.length, tagOptionsLoading]);


  // 获取用户的数据卡
  const loadUserDataCards = useCallback(async (searchTerm?: string, sortBy?: 'likes' | 'usage' | 'favorites' | 'created_at') => {
    if (!isAuthenticated) return;

    try {
      setIsLoading(true);
      const cards = await dataCardApi.getCards(searchTerm, sortBy);
      // 根据选择的类型过滤数据卡
      const filteredCards = cards.filter((card: any) => effectiveAllowedTypeSet.has(card.type));
      setUserDataCards(mapWithRoleType(filteredCards));
    } catch (error) {
      console.error('获取用户数据卡失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, effectiveAllowedTypeSet, mapWithRoleType]);

  // 通过 ID 获取数据卡并显示在列表中
  const loadCardByIdForDisplay = useCallback(async (cardId: string) => {
    publicFetchAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    publicFetchAbortControllerRef.current = abortController;
    try {
      setIsLoading(true);
      const response = await fetch(`/api/public-data-cards?id=${cardId}`, { signal: abortController.signal });
      if (response.ok) {
        const result = await response.json();
        const card = result.success && result.card && effectiveAllowedTypeSet.has(result.card.type) ? result.card : null;
        setPublicDataCards(card ? mapWithRoleType([card]) : []);
      } else {
        setPublicDataCards([]);
      }
    } catch (error) {
      if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return;
      }
      console.error('通过ID获取数据卡失败:', error);
      setPublicDataCards([]);
    } finally {
      if (publicFetchAbortControllerRef.current === abortController) {
        publicFetchAbortControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }, [effectiveAllowedTypeSet, mapWithRoleType]);

  // 【修改】获取公开数据卡，现在会接收所有筛选条件
  const loadPublicDataCards = useCallback(async (
    page: number = 1,
    currentSortBy: 'likes' | 'usage' | 'favorites' | 'created_at',
    currentSearchTerm?: string,
    currentFilters?: Filters,
    currentTagIds?: string[],
    currentTagMatch?: 'any' | 'all'
  ) => {
    publicFetchAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    publicFetchAbortControllerRef.current = abortController;
    try {
      setIsLoading(true);
      const useRoleTypeFilter = Boolean(currentFilters?.roleType && selectedType === 'character');
      const effectiveLimit = useRoleTypeFilter ? 500 : cardsPerPage;
      const offset = useRoleTypeFilter ? 0 : (page - 1) * cardsPerPage;
      const fetchType = async (type: DataCardType): Promise<any[]> => {
        const params = new URLSearchParams({
          type,
          limit: effectiveLimit.toString(),
          offset: offset.toString(),
          sortBy: currentSortBy
        });

        if (currentSearchTerm) params.append('search', currentSearchTerm);
        if (Array.isArray(currentTagIds) && currentTagIds.length > 0) {
          params.append('tagIds', currentTagIds.join(','));
          if (currentTagMatch === 'all') {
            params.append('tagMatch', 'all');
          }
        }
        // 【新增】将高级筛选条件添加到请求参数中
        if (currentFilters) {
          if (currentFilters.author) params.append('author', currentFilters.author);
          if (currentFilters.minLikes) params.append('minLikes', currentFilters.minLikes);
          if (currentFilters.maxLikes) params.append('maxLikes', currentFilters.maxLikes);
          if (currentFilters.minUsage) params.append('minUsage', currentFilters.minUsage);
          if (currentFilters.maxUsage) params.append('maxUsage', currentFilters.maxUsage);
          if (currentFilters.minFavorites) params.append('minFavorites', currentFilters.minFavorites);
          if (currentFilters.maxFavorites) params.append('maxFavorites', currentFilters.maxFavorites);
          if (currentFilters.recommendedOnly) params.append('recommendedOnly', '1');
          if (currentFilters.nativeOnly) params.append('nativeOnly', '1');
          if (currentFilters.nativeAllowedOnly) params.append('nativeAllowedOnly', '1');
        }

        const response = await fetch(`/api/public-data-cards?${params}`, { signal: abortController.signal });
        if (!response.ok) return [];
        const result = await response.json();
        return result.success ? (result.cards || []) : [];
      };

      const batches = await Promise.all(effectiveAllowedTypes.map((type) => fetchType(type)));
      let cards = mapWithRoleType(batches.flat());
      if (currentFilters?.roleType && selectedType === 'character') {
        cards = cards.filter((card: any) => card.roleType === currentFilters.roleType);
      }
      setPublicDataCards(cards);
    } catch (error) {
      if (abortController.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return;
      }
      console.error('获取公开数据卡失败:', error);
    } finally {
      if (publicFetchAbortControllerRef.current === abortController) {
        publicFetchAbortControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }, [selectedType, effectiveAllowedTypes, cardsPerPage, mapWithRoleType]);

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

  const loadFavorites = useCallback(async (
    typeParam?: BattleDataSelectedType,
    showLoading: boolean = false,
    sortCriteria?: 'likes' | 'usage' | 'favorites' | 'created_at'
  ) => {
    if (!isAuthenticated) return;

    try {
      if (showLoading) {
        setIsLoading(true);
      }
      const targetType = typeParam ?? selectedType;
      const results = targetType === 'all'
        ? await Promise.all(effectiveAllowedTypes.map((type) => favoritesApi.getFavorites({ type })))
        : [await favoritesApi.getFavorites({ type: targetType as DataCardType })];
      const favorites = results.flatMap((result) =>
        result.success && Array.isArray(result.favorites) ? result.favorites : []
      );
      if (results.some((result) => result.success)) {
        const cards = mapWithRoleType(favorites);
        const finalSort = sortCriteria ?? sortBy;
        setFavoriteCards(sortFavorites(cards, finalSort));
        setFavoriteIds(new Set(cards.map((card: any) => card.id)));
      } else {
        setFavoriteCards([]);
        setFavoriteIds(new Set());
      }
    } catch (error) {
      console.error('获取收藏数据卡失败:', error);
      setFavoriteCards([]);
      setFavoriteIds(new Set());
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, [isAuthenticated, selectedType, effectiveAllowedTypes, sortFavorites, mapWithRoleType, sortBy]);

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
    if (isPvpHandTab) return;
    void loadTagOptions();
  }, [isOpen, isPvpHandTab, loadTagOptions]);

  // 当防抖搜索词变化时执行搜索
  useEffect(() => {
    if (!isOpen) return;

    const trimmed = debouncedSearchQuery.trim();
    setCurrentPage(1);

    // 私有库搜索：直接从用户数据卡接口查询
    if (activeTab === 'my') {
      loadUserDataCards(trimmed || undefined, sortBy);
      return;
    }

    // 收藏库本地过滤，避免重复请求
    if (activeTab === 'favorites') {
      return;
    }

    if (activeTab === 'pvpHand') {
      return;
    }

    // 检查是否包含 UUID 格式的 ID
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = trimmed.match(uuidRegex);

    if (match) {
      loadCardByIdForDisplay(match[0]);
    } else {
      loadPublicDataCards(1, sortBy, trimmed || undefined, publicFilters, selectedTagIds, tagMatchMode);
    }
  }, [debouncedSearchQuery, isOpen, activeTab, loadUserDataCards, loadCardByIdForDisplay, loadPublicDataCards, sortBy, publicFilters, selectedTagIds, tagMatchMode]);

  useEffect(() => {
    if (!isOpen) return;
    if (isPvpHandTab) return;
    if (!isPublicTab) return;

    const trimmed = debouncedSearchQuery.trim();
    if (trimmed) {
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      if (uuidRegex.test(trimmed)) return;
    }

    setCurrentPage(1);
    loadPublicDataCards(1, sortBy, trimmed || undefined, publicFilters, selectedTagIds, tagMatchMode);
  }, [isPublicTab, publicFilters, debouncedSearchQuery, isOpen, isPvpHandTab, loadPublicDataCards, selectedTagIds, sortBy, tagMatchMode]);

  useEffect(() => {
    return () => {
      publicFetchAbortControllerRef.current?.abort();
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

    const fallbackTab: BattleDataTab = effectiveTabs[0] ?? 'public';
    const canUseInitialTab = Boolean(initialTab && effectiveTabs.includes(initialTab));
    const desiredDefaultTab: BattleDataTab = isAuthenticated ? 'my' : 'public';

    const nextTab: BattleDataTab = (() => {
      if (canUseInitialTab) return initialTab as BattleDataTab;
      if (!hasUserSelectedTabRef.current) {
        return effectiveTabs.includes(desiredDefaultTab) ? desiredDefaultTab : fallbackTab;
      }
      if (!isAuthenticated && !isPublicTab && effectiveTabs.includes('public')) return 'public';
      return effectiveTabs.includes(activeTab) ? activeTab : fallbackTab;
    })();

    setActiveTab(nextTab);

    // 按当前 Tab 触发首屏加载
    if (isAuthenticated && effectiveTabs.includes('my') && (nextTab === 'my' || (!hasUserSelectedTabRef.current && nextTab === 'public'))) {
      loadUserDataCards(undefined, sortBy);
      if (effectiveTabs.includes('favorites')) {
        loadFavorites(selectedType, false, sortBy);
      }
    }

    if (isAuthenticated && effectiveTabs.includes('favorites') && nextTab === 'favorites') {
      loadFavorites(selectedType, true, sortBy);
    }

    if (effectiveTabs.includes('public') || effectiveTabs.includes('recommended')) {
      const initialPublicFilters = buildPublicFilters(initialFilters, nextTab);
      loadPublicDataCards(1, sortBy, undefined, initialPublicFilters, [], 'any');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedType, isAuthenticated]);

  // 切换数据卡类型时，清除不适配当前类型的筛选项，避免误筛
  useEffect(() => {
    setFilters((prev) => normalizeFiltersBySelectedType(prev));
    setActiveFilters((prev) => normalizeFiltersBySelectedType(prev));
  }, [normalizeFiltersBySelectedType]);

  const selectedIdSet = useMemo(() => new Set((selectedCardIds || []).filter((x): x is string => typeof x === 'string' && Boolean(x))), [selectedCardIds]);
  const selectedCount = typeof selectedCountOverride === 'number' ? selectedCountOverride : selectedIdSet.size;
  const atLimit = selectionMode === 'multi' && typeof maxSelected === 'number' && maxSelected > 0 && selectedCount >= maxSelected;
  const canToggle = selectionMode === 'multi' && typeof onToggleCard === 'function';
  const canImportDeck = allowDeckImport && isAuthenticated && selectionMode === 'multi' && selectedType === 'character' && (typeof onToggleCard === 'function' || typeof onSelectCard === 'function');

  // 处理卡片选择
  const handleSelectCard = async (card: any) => {
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

      const payload = mapPublicDataCardRowToBattleSelectionPayload(card);

      if (selectionMode === 'multi') {
        if (canToggle) {
          onToggleCard?.(payload, nextSelected);
        } else if (nextSelected) {
          onSelectCard?.(payload);
        }
      } else {
        onSelectCard?.(payload);
        onClose();
      }

      // 如果是公开卡片且未使用过，增加使用次数（仅在「加入」时触发）
      if (nextSelected && isPublicVisibility(payload._isPublic) && !isCardUsed(cardId)) {
        void (async () => {
          try {
            const response = await fetch('/api/data-card-stats', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                cardId,
                type: 'usage'
              })
            });

            if (response.ok) {
              const result = await response.json();
              if (result.success) {
                // 添加到本地存储
                addUsedCard(cardId);
              }
            }
          } catch (error) {
            console.error('增加使用次数失败:', error);
          }
        })();
      }
    } catch (error) {
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

    try {
      const detail = await deckApi.getDeckCards(deckId);
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

          if (canToggle) {
            onToggleCard?.(payload, true);
          } else {
            onSelectCard?.(payload);
          }

          nextSelectedIds.add(cardId);
          remaining -= 1;

          if (isPublicVisibility(payload._isPublic) && !isCardUsed(cardId)) {
            void (async () => {
              try {
                const response = await fetch('/api/data-card-stats', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ cardId, type: 'usage' })
                });
                if (response.ok) {
                  const result = await response.json();
                  if (result.success) addUsedCard(cardId);
                }
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
  }, [allowDeckImport, canToggle, effectiveAllowedTypeSet, maxSelected, onSelectCard, onToggleCard, selectedCount, selectedIdSet, selectionMode]);

  const handleDownloadCard = useCallback((card: any) => {
    try {
      let cardPayload = card.data;
      if (typeof cardPayload === 'string') {
        cardPayload = JSON.parse(cardPayload);
      }
      const blob = new Blob([JSON.stringify(cardPayload, null, 2)], { type: 'application/json' });
      const sanitizedName = (card.name || '数据卡').replace(/[\\/:*?"<>|]/g, '_');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sanitizedName}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('保存数据卡失败:', error);
    }
  }, []);

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

    if (nextState) {
      const result = await favoritesApi.add(card.id);
      if (!result.success && !result.alreadyExists) {
        return false;
      }

      const delta = result.alreadyExists ? 0 : 1;

      setFavoriteIds((prev) => {
        const next = new Set(prev);
        next.add(card.id);
        return next;
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

    const result = await favoritesApi.remove(card.id);
    if (!result.success) {
      return false;
    }

    setFavoriteIds((prev) => {
      const next = new Set(prev);
      next.delete(card.id);
      return next;
    });

    setPublicDataCards((prev) => adjustFavoriteCount(prev, card.id, -1));
    setUserDataCards((prev) => adjustFavoriteCount(prev, card.id, -1));
    setFavoriteCards((prev) => prev.filter((item) => item.id !== card.id));

    return true;
  }, [isAuthenticated, adjustFavoriteCount, sortFavorites, sortBy]);

  // 处理页码变化
  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    if (isPublicTab && !(publicFilters.roleType && selectedType === 'character')) {
      loadPublicDataCards(newPage, sortBy, debouncedSearchQuery.trim() || undefined, publicFilters, selectedTagIds, tagMatchMode);
    }
  };

  // 处理排序变化
  const handleSortChange = (newSortBy: 'likes' | 'usage' | 'favorites' | 'created_at') => {
    setSortBy(newSortBy);
    setCurrentPage(1);
    if (activeTab === 'my') {
      loadUserDataCards(debouncedSearchQuery.trim() || undefined, newSortBy);
    } else if (isPublicTab) {
      loadPublicDataCards(1, newSortBy, debouncedSearchQuery.trim() || undefined, publicFilters, selectedTagIds, tagMatchMode);
    } else if (activeTab === 'favorites') {
      setFavoriteCards((prev) => sortFavorites(prev, newSortBy));
    }
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

  const filteredUserCards = useMemo(() => applyTagFilter(userDataCards), [applyTagFilter, userDataCards]);
  const filteredFavoriteCards = useMemo(() => {
    const keyword = debouncedSearchQuery.trim().toLowerCase();
    const baseList = keyword
      ? favoriteCards.filter((card) => {
        const name = (card.name || '').toLowerCase();
        const desc = (card.description || '').toLowerCase();
        return name.includes(keyword) || desc.includes(keyword);
      })
      : favoriteCards;
    return applyTagFilter(baseList);
  }, [favoriteCards, debouncedSearchQuery, applyTagFilter]);
  const filteredPublicCards = useMemo(() => applyTagFilter(publicDataCards), [applyTagFilter, publicDataCards]);

  const userTotalPages = Math.max(1, Math.ceil(filteredUserCards.length / cardsPerPage));

  const filteredPvpHandCards = useMemo<PvpHandTabCard[]>(() => {
    const cards = Array.isArray(pvpHandTab?.cards) ? pvpHandTab.cards : [];
    const keyword = debouncedSearchQuery.trim().toLowerCase();
    if (!keyword) return cards;

    return cards.filter((card) => {
      const name = (card.name || '').toLowerCase();
      const type = (typeof card.type === 'string' ? card.type : '').toLowerCase();
      const source = getPvpHandSourceLabel(card.ref).toLowerCase();
      const refHint = (getPvpHandRefHint(card.ref) || '').toLowerCase();
      return `${name} ${type} ${source} ${refHint}`.includes(keyword);
    });
  }, [pvpHandTab?.cards, debouncedSearchQuery]);

  const favoritesTotalPages = Math.max(1, Math.ceil(filteredFavoriteCards.length / cardsPerPage));
  const paginatedUserCards = useMemo(
    () => filteredUserCards.slice((currentPage - 1) * cardsPerPage, currentPage * cardsPerPage),
    [filteredUserCards, currentPage, cardsPerPage]
  );
  const paginatedFavoriteCards = useMemo(
    () => filteredFavoriteCards.slice((currentPage - 1) * cardsPerPage, currentPage * cardsPerPage),
    [filteredFavoriteCards, currentPage, cardsPerPage]
  );

  const publicPaginatedCards = useMemo(() => {
    if (publicFilters.roleType && selectedType === 'character') {
      return filteredPublicCards.slice((currentPage - 1) * cardsPerPage, currentPage * cardsPerPage);
    }
    return filteredPublicCards;
  }, [filteredPublicCards, publicFilters.roleType, selectedType, currentPage, cardsPerPage]);

  const displayCards = useMemo(() => {
    if (activeTab === 'my') return paginatedUserCards;
    if (activeTab === 'favorites') return paginatedFavoriteCards;
    if (isPublicTab) return publicPaginatedCards;
    return [];
  }, [activeTab, isPublicTab, paginatedUserCards, paginatedFavoriteCards, publicPaginatedCards]);

  const displayCardIds = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const card of displayCards as any[]) {
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
    if (isPvpHandTab) return;
    if (displayCardIds.length === 0) return;

    const pendingIds = displayCardIds.filter((id) => !Object.prototype.hasOwnProperty.call(cardMetaById, id));
    if (pendingIds.length === 0) return;

    metaFetchAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    metaFetchAbortControllerRef.current = abortController;

    const run = async () => {
      try {
        const authHeader = await authStorage.getAuthHeader();
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (authHeader) headers.Authorization = authHeader;

        const res = await fetch('/api/data-card-meta-batch', {
          method: 'POST',
          headers,
          body: JSON.stringify({ dataCardIds: pendingIds }),
          signal: abortController.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as any;
        if (!json || json.success !== true || typeof json.items !== 'object' || !json.items) return;

        setCardMetaById((prev) => {
          const next = { ...prev };
          for (const [id, item] of Object.entries<any>(json.items)) {
            const metrics = item?.metrics ?? null;
            const strict = item?.strict ?? null;
            next[id] = {
              techScore: typeof metrics?.techScore === 'number' ? metrics.techScore : null,
              techLevel: typeof metrics?.techLevel === 'string' ? metrics.techLevel : null,
              strictTier: typeof strict?.tier === 'string' ? strict.tier : null,
              isNative: typeof metrics?.isNative === 'boolean' ? metrics.isNative : null,
            };
          }
          return next;
        });
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
  }, [isOpen, isPvpHandTab, displayCardIds, cardMetaById]);

  // 批量获取作者佩戴的徽章
  const currentUserEquippedBadges = useMemo(() => {
    return (Array.isArray(userBadges) ? userBadges : [])
      .filter((ub) => ub.isEquipped)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((ub) => ub.badge);
  }, [userBadges]);

  useEffect(() => {
    if (!isOpen) return;
    if (isPvpHandTab) return;
    if (displayCards.length === 0) return;

    // "我的" 标签页直接使用当前用户的徽章
    if (activeTab === 'my' && user?.id) {
      setAuthorBadgesById((prev) => {
        if (prev[user.id]) return prev;
        return { ...prev, [user.id]: currentUserEquippedBadges };
      });
      return;
    }

    // 提取需要获取徽章的用户 ID
    const pendingUserIds = new Set<number>();
    for (const card of displayCards as any[]) {
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
        const res = await fetch('/api/badges/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: [...pendingUserIds] }),
          signal: abortController.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as any;
        if (!json || json.success !== true || typeof json.items !== 'object' || !json.items) return;

        setAuthorBadgesById((prev) => {
          const next = { ...prev };
          for (const [uid, badges] of Object.entries<any>(json.items)) {
            const userId = Number(uid);
            if (userId > 0 && Array.isArray(badges)) {
              next[userId] = badges;
            }
          }
          return next;
        });
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
  }, [isOpen, isPvpHandTab, activeTab, displayCards, user?.id, currentUserEquippedBadges, authorBadgesById]);

  const publicTotalPages = publicFilters.roleType && selectedType === 'character'
    ? Math.max(1, Math.ceil(filteredPublicCards.length / cardsPerPage))
    : null;

  const currentTabTotalPages = activeTab === 'my'
    ? userTotalPages
    : activeTab === 'favorites'
      ? favoritesTotalPages
    : isPublicTab
        ? publicTotalPages
        : null;
  const typeLabelMap: Record<BattleDataSelectedType, string> = {
    character: '角色',
    scenario: '情景',
    history: '叙事历史',
    questionnaire: '问卷',
    all: '素材',
  };
  const typeLabel = typeLabelMap[selectedType] ?? '数据';
  const modalTitle = titleOverride || (isPvpHandTab ? '我的手牌' : `选择${typeLabel}数据卡`);
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
        className="bg-white rounded-lg p-6 w-[96vw] max-w-[90rem] h-[85vh] max-h-[90vh] overflow-hidden flex flex-col relative"
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
	                  placeholder={isPvpHandTab ? '搜索手牌：名称 / 类型 / 来源（预设/数据卡）' : `搜索${typeLabel}名称或粘贴分享链接...`}
	                  className="w-full input-field pr-10"
	                />
	                {searchQuery && searchQuery !== debouncedSearchQuery && <div className="absolute right-3 top-1/2 -translate-y-1/2"><div className="w-4 h-4 border-2 border-pink-500 border-t-transparent rounded-full animate-spin"></div></div>}
	              </div>
	              {!isPvpHandTab && <SortSelector value={sortBy} onChange={handleSortChange} />}
              {!isPvpHandTab && (
                <button
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-colors ${isFilterActive ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  <Filter className="w-4 h-4" /> 高级筛选 <ChevronDown className={`w-4 h-4 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>
            {!isPvpHandTab && (
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
                      disabled={selectedType === 'questionnaire'}
                    />
                    <span className={selectedType === 'questionnaire' ? 'text-gray-400' : ''}>仅看原生</span>
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
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={resetFilters} className="px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">重置</button>
                  <button onClick={applyFilters} className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-md hover:bg-purple-700">应用筛选</button>
                </div>
              </div>
            )}
          </div>

          {/* 标签页切换 */}
          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <div className="flex gap-2">
            {effectiveTabs.includes('pvpHand') && (
              <button
                onClick={() => {
                  hasUserSelectedTabRef.current = true;
                  setActiveTab('pvpHand');
                  setCurrentPage(1);
                }}
                className={`px-4 py-2 rounded text-sm font-medium ${activeTab === 'pvpHand' ? 'bg-pink-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
              >
                手牌 ({pvpHandTab?.cards?.length ?? 0})
              </button>
            )}
            {effectiveTabs.includes('my') && (
              <button
                onClick={() => {
                  hasUserSelectedTabRef.current = true;
                  setActiveTab('my');
                  setCurrentPage(1);
                  loadUserDataCards(undefined, sortBy);
                }}
                className={`px-4 py-2 rounded text-sm font-medium ${activeTab === 'my' ? 'bg-pink-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
              >
                我的{typeLabel} ({userDataCards.length})
              </button>
            )}
            {effectiveTabs.includes('public') && (
              <button
                onClick={() => {
                  hasUserSelectedTabRef.current = true;
                  setActiveTab('public');
                  setCurrentPage(1);
                  loadPublicDataCards(1, sortBy, '', buildPublicFilters(filters, 'public'), selectedTagIds, tagMatchMode);
                }}
                className={`px-4 py-2 rounded text-sm font-medium ${activeTab === 'public' ? 'bg-pink-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
              >
                公开{typeLabel}
              </button>
            )}
            {effectiveTabs.includes('recommended') && (
              <button
                onClick={() => {
                  hasUserSelectedTabRef.current = true;
                  setActiveTab('recommended');
                  setCurrentPage(1);
                  loadPublicDataCards(1, sortBy, '', buildPublicFilters(filters, 'recommended'), selectedTagIds, tagMatchMode);
                }}
                className={`px-4 py-2 rounded text-sm font-medium ${activeTab === 'recommended' ? 'bg-pink-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
              >
                管理员推荐
              </button>
            )}
            {effectiveTabs.includes('favorites') && (
              <button
                onClick={() => {
                  hasUserSelectedTabRef.current = true;
                  setActiveTab('favorites');
                  setCurrentPage(1);
                  loadFavorites(selectedType, true, sortBy);
                }}
                className={`px-4 py-2 rounded text-sm font-medium ${activeTab === 'favorites' ? 'bg-pink-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
              >
                我的收藏 ({favoriteCards.length})
              </button>
            )}
            </div>

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
	          <div>
	            {isPvpHandTab ? (
	              filteredPvpHandCards.length === 0 ? (
	                <div className="text-center text-gray-500 py-8">暂无手牌</div>
	              ) : (
	                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
	                  {filteredPvpHandCards.map((card) => {
	                    const sourceLabel = getPvpHandSourceLabel(card.ref);
	                    const refHint = getPvpHandRefHint(card.ref);
	                    const type = typeof card.type === 'string' && card.type ? card.type : 'unknown';
	                    const preview = getPvpHandPreviewText(card.dataJson);
	                    const { display: displayName, full: fullName } = buildTitleDisplay(card.name || '未命名');

	                    const disableChoose = Boolean(pvpHandTab?.isChoosing || pvpHandTab?.hasChosenMe);

	                    return (
	                      <div key={card.snapshotId} className="rounded-lg border bg-white p-4 flex flex-col">
	                        <div className="min-w-0">
	                          <div className="font-semibold text-gray-900 break-words" title={fullName}>
	                            {displayName}
	                          </div>
	                          <div className="mt-1 flex flex-wrap gap-2 text-xs">
	                            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{type}</span>
	                            <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{sourceLabel}</span>
	                            {refHint && <span className="px-2 py-0.5 rounded-full bg-white border text-gray-600">{refHint}</span>}
	                          </div>
	                        </div>

	                        {preview ? <div className="mt-3 text-xs text-gray-600 break-words">{preview}</div> : null}

	                        <div className="mt-4 grid grid-cols-2 gap-2">
	                          <button
	                            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 text-sm"
	                            onClick={() => {
	                              const author = sourceLabel === '预设' ? '预设角色（快照）' : sourceLabel === '数据卡' ? '数据卡（快照）' : 'PVP 快照';
	                              setSelectedCard({
	                                id: `pvp:hand:${card.snapshotId}`,
	                                name: card.name || '未命名',
	                                description: refHint ? `PVP 手牌（${sourceLabel}快照：${refHint}）` : `PVP 手牌（${sourceLabel}快照）`,
	                                type: 'character',
	                                data: typeof card.dataJson === 'string' ? card.dataJson : JSON.stringify(card.dataJson ?? {}),
	                                isPublic: true,
	                                username: author,
	                              });
	                              setShowDetailsModal(true);
	                            }}
	                          >
	                            详情
	                          </button>
	                          <button
                            className="min-h-10 px-3 py-2 rounded-lg text-sm text-white bg-gradient-to-r from-pink-500 to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
	                            onClick={() => pvpHandTab?.onChoose(card.snapshotId)}
	                            disabled={disableChoose}
	                            title={pvpHandTab?.hasChosenMe ? '你已选择过出战卡' : undefined}
	                          >
	                            {pvpHandTab?.hasChosenMe ? '已出战' : pvpHandTab?.isChoosing ? '提交中…' : '出战'}
	                          </button>
	                        </div>
	                      </div>
	                    );
	                  })}
	                </div>
	              )
	            ) : isLoading ? (
	              <div className="flex justify-center items-center min-h-[40vh]"><div className="text-gray-500">加载中...</div></div>
	            ) : displayCards.length === 0 ? (
	              <div className="text-center text-gray-500 py-8">暂无数据卡</div>
	            ) : (
		              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
		                {displayCards.map((card: any) => {
		                  const isFavorited = favoriteIds.has(card.id);
		                  const enableFavorite = isAuthenticated && activeTab !== 'my';
	                    const isSelected = selectedIdSet.has(card.id);
	                    const itemDisabled = selectionMode === 'multi' && !isSelected && atLimit;
	                    const showQuickToggle = selectionMode === 'multi';
	                    const quickToggleDisabled = isSelected ? !canToggle : itemDisabled;
	                    const quickToggleTitle = isSelected
	                      ? (canToggle ? '移除' : '当前模式不支持移除')
	                      : (itemDisabled ? '已达到上限' : '加入');
                      const questionnaireNativeAllowed = resolveQuestionnaireNativeAllowed(card);

		                  return (
		                    <div
                        key={card.id}
                        className={`relative h-full ${itemDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        {...(selectionMode === 'single' ? {
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
		                        onViewDetails={allowCardDetails ? () => { setSelectedCard(card); setShowDetailsModal(true); } : undefined}
	                        onAuthorClick={handleAuthorClick}
	                        onToggleFavorite={enableFavorite ? (next) => handleFavoriteToggleForCard(card, next) : undefined}
	                        onDownload={() => handleDownloadCard(card)}
	                      />
	                    </div>
	                  );
	                })}
	              </div>
      )}

	      {allowDeckImport ? (
	        <DecksModal
	          isOpen={showDecksModal}
	          onClose={() => setShowDecksModal(false)}
	          onImportDeck={(deckId) => void handleImportDeck(deckId)}
	        />
	      ) : null}
	          </div>

          {/* 分页与底部 */}
          {(
            (activeTab === 'my' && filteredUserCards.length > cardsPerPage) ||
            (activeTab === 'favorites' && filteredFavoriteCards.length > cardsPerPage) ||
            (isPublicTab && (
              (publicFilters.roleType && selectedType === 'character')
                ? publicPaginatedCards.length > 0 || publicTotalPages! > 1
                : (displayCards.length >= cardsPerPage || currentPage > 1)
            ))
          ) &&
            <div className="flex justify-center items-center gap-2 pt-4 border-t mt-4">
              <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="page-button">上一页</button>
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
                      : publicTotalPages
                        ? currentPage >= publicTotalPages
                        : displayCards.length < cardsPerPage
                }
                className="page-button"
              >
                下一页
              </button>
            </div>
          }
	    </div>
	  </div>

	  {/* 详情模态框 */}
      {allowCardDetails && selectedCard && (
        <DataCardDetailsModal
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
