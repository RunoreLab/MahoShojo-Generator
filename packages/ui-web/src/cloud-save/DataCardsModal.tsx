import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PageJump } from '../pagination';
import { createPortal } from 'react-dom';
import DataCard from '../card-library/DataCard';
import EditCardForm from './EditCardForm';
import { OwnedCardDeleteDialog, useOwnedCardDelete } from './OwnedCardDeleteDialog';
import type { OwnedCardDeletePort } from './owned-card-delete';
import { useOwnedCardMetadataEditor, type OwnedCardMetadataPort } from './owned-card-metadata';
import { inferDataCardTemplate as inferTemplate } from '@mahoshojo/domain/data-cards';
import { useCardLibrarySummaryPage } from '../card-library/use-card-library-summary-page';
import { normalizePublicVisibilityValue } from '../card-library/read-mappers';
import { getDataCardStatus } from '../card-library/status';
import type { DataCardsModalHost } from './host';
import { BASE_MODAL_BODY_LAYOUT_CLASS_NAME, useBaseModalAccessibility } from '../modal/BaseModal';
import { ChevronDown, Filter } from 'lucide-react';
import { ONLINE_DATA_CARD_TYPES, type OnlineDataCardType } from '@mahoshojo/contracts/data-cards';

export interface DataCardsModalProps {
  host: DataCardsModalHost;
  /** 同账号凭据代际也隔离列表、详情与未完成的动作。 */
  scopeKey?: string | number;
  busy?: boolean;
  metadataEditor?: OwnedCardMetadataPort;
  deletePort?: OwnedCardDeletePort;
  isOpen: boolean;
  onClose: () => void;
  dataCards: any[];
  summaryOwnerId?: number;
  refreshKey?: number;
  loading?: boolean;
  error?: string | null;
  onReload?: () => void;
  editingCard?: any | null;
  currentPage: number;
  cardsPerPage: number;
  onPageChange: (page: number) => void;
  onEditCard?: (card: any) => void;
  onUpdateCard?: (id: string, name: string, description: string, isPublic: number) => void;
  onDeleteCard?: (id: string) => void | Promise<void>;
  onLoadCard?: (card: any) => void | Promise<void>;
  onCancelEdit?: () => void;
  onShareCard?: (card: any) => void;
  onReplaceCard?: (card: any) => void | Promise<void>;
  userCapacity?: number;
  capacityKnown?: boolean;
  userUsedSlots?: number;
  onOpenRecycleBin?: () => void;
  recycleCount?: number | null;
  recycleLabel?: string;
  recycleLimit?: number;
  title?: string;
  emptyText?: string;
  defaultFilters?: Partial<Filters>;
  allowedTypes?: CardTypeFilter[];
  hideRoleTypeFilter?: boolean;
  showHotHint?: boolean;
  hideEditData?: boolean;
  allowHistoryReplace?: boolean;
}

type CardTypeFilter = '' | OnlineDataCardType;
type CardVisibilityFilter = '' | 'private' | 'public' | 'banned';
type CardRoleType = 'magical-girl' | 'canshou' | 'general';
type RoleTypeFilter = '' | CardRoleType;
type SortOption = 'updated_at' | 'created_at' | 'likes' | 'usage' | 'favorites';

type Filters = {
  type: CardTypeFilter;
  visibility: CardVisibilityFilter;
  minLikes: string;
  maxLikes: string;
  minUsage: string;
  maxUsage: string;
  minFavorites: string;
  maxFavorites: string;
  roleType: RoleTypeFilter;
};

const initialFilters: Filters = {
  type: '',
  visibility: '',
  minLikes: '',
  maxLikes: '',
  minUsage: '',
  maxUsage: '',
  minFavorites: '',
  maxFavorites: '',
  roleType: '',
};

const ALL_CARD_TYPES: CardTypeFilter[] = [...ONLINE_DATA_CARD_TYPES];

const typeLabelMap: Record<Exclude<CardTypeFilter, ''>, string> = {
  character: '角色',
  scenario: '情景',
  history: '叙事历史',
  questionnaire: '问卷',
};

const isFilterActive = (filters: Filters) => {
  return Boolean(
    filters.type ||
    filters.visibility ||
    filters.minLikes ||
    filters.maxLikes ||
    filters.minUsage ||
    filters.maxUsage ||
    filters.minFavorites ||
    filters.maxFavorites ||
    filters.roleType
  );
};

const inferRoleType = (card: any): CardRoleType | undefined => {
  if (!card || card.type !== 'character') return undefined;
  if (card.roleType) return card.roleType;
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

  const templateId = payload?.templateId || payload?.template || payload?.template_id;
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

  if (payload?.codename) return 'magical-girl';
  if (payload?.name) return 'canshou';
  return 'general';
};

const extractCardAuthor = (card: any): string | undefined => {
  if (!card) return undefined;
  if (card.data === undefined && typeof card.username === 'string') return card.username || undefined;
  try {
    const data = typeof card.data === 'string' ? JSON.parse(card.data) : card.data;
    if (data && typeof data === 'object' && typeof (data as any)._author === 'string') {
      const author = (data as any)._author.trim();
      return author ? author : undefined;
    }
  } catch {
    // 忽略解析错误
  }
  return undefined;
};

const toOptionalNumber = (value: string): number | null => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  return num;
};

const getCountValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const getTimeValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : 0;
  }
  return 0;
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

export function DataCardsModal(props: DataCardsModalProps) {
  return <DataCardsModalScope key={`${props.summaryOwnerId ?? 'supplied'}:${props.scopeKey ?? ''}`} {...props} />;
}

function DataCardsModalScope({
  host,
  busy: suppliedBusy = false,
  metadataEditor,
  deletePort,
  isOpen,
  onClose,
  dataCards: suppliedCards,
  summaryOwnerId,
  refreshKey = 0,
  loading: suppliedLoading = false,
  error: suppliedError = null,
  onReload: suppliedReload,
  editingCard,
  currentPage,
  cardsPerPage,
  onPageChange,
  onEditCard,
  onUpdateCard,
  onDeleteCard,
  onLoadCard,
  onCancelEdit,
  onShareCard,
  onReplaceCard,
  userCapacity = host.defaultCapacity,
  capacityKnown = true,
  userUsedSlots = 0,
  onOpenRecycleBin,
  recycleCount = null,
  recycleLabel = '回收站',
  recycleLimit = host.recycleLimit,
  title = '我的数据卡',
  emptyText = '暂无数据卡',
  defaultFilters,
  allowedTypes,
  hideRoleTypeFilter = false,
  showHotHint = true,
  hideEditData = false,
  allowHistoryReplace = false,
}: DataCardsModalProps) {
  const metadata = useOwnedCardMetadataEditor(metadataEditor, isOpen);
  const deletion = useOwnedCardDelete(deletePort, isOpen);
  const isDeleting = () => (deletion.controller?.getSnapshot().phase ?? 'idle') !== 'idle';
  const busy = suppliedBusy || metadata.isBusy() || deletion.busy;
  const close = () => { if (!suppliedBusy && !metadata.isBusy() && !isDeleting()) { metadata.hide(); onClose(); } };
  const { dialogRef, initialFocusRef, titleId } = useBaseModalAccessibility({ isOpen, onClose: close });
  const [selectedCard, setSelectedCard] = useState<any | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const metaFetchAbortControllerRef = useRef<AbortController | null>(null);
  const [cardMetaById, setCardMetaById] = useState<Record<string, { techScore: number | null; techLevel: string | null; strictTier: string | null; isNative: boolean | null }>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const isComposingSearchRef = useRef(false);
  const [sortBy, setSortBy] = useState<SortOption>('updated_at');
  const resolvedAllowedTypes = useMemo(() => {
    const list = Array.isArray(allowedTypes) && allowedTypes.length > 0 ? allowedTypes : ALL_CARD_TYPES;
    return list.filter((type) => type) as Exclude<CardTypeFilter, ''>[];
  }, [allowedTypes]);
  const sanitizedDefaultFilters = useMemo(() => {
    const next: Filters = { ...initialFilters, ...(defaultFilters ?? {}) };
    if (next.type && !resolvedAllowedTypes.includes(next.type as Exclude<CardTypeFilter, ''>)) {
      next.type = '';
    }
    if (next.type !== 'character') {
      next.roleType = '';
    }
    return next;
  }, [defaultFilters, resolvedAllowedTypes]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(() => isFilterActive(sanitizedDefaultFilters));
  const [filters, setFilters] = useState<Filters>(sanitizedDefaultFilters);
  const [activeFilters, setActiveFilters] = useState<Filters>(sanitizedDefaultFilters);
  const serverPaged = summaryOwnerId !== undefined;
  const summaryQuery = {
    limit: cardsPerPage, offset: (currentPage - 1) * cardsPerPage,
    search: debouncedSearchQuery.trim() || undefined, sortBy,
    types: activeFilters.type ? [activeFilters.type] : resolvedAllowedTypes,
    includeLegacyQuestionnaires: resolvedAllowedTypes.length === 1 && resolvedAllowedTypes[0] === 'questionnaire',
    visibility: activeFilters.visibility || undefined, roleType: activeFilters.roleType || undefined,
    ...Object.fromEntries(['minLikes', 'maxLikes', 'minUsage', 'maxUsage', 'minFavorites', 'maxFavorites']
      .map((key) => [key, toOptionalNumber(activeFilters[key as keyof Filters]) ?? undefined])),
  };
  const page = useCardLibrarySummaryPage(host.fetchSummaryPage, 'my', summaryOwnerId ?? null, isOpen && serverPaged, summaryQuery);
  const dataCards = serverPaged ? page.cards : suppliedCards;
  const loading = serverPaged ? page.loading : suppliedLoading;
  const error = serverPaged ? page.error : suppliedError;
  const onReload = serverPaged ? page.reload : suppliedReload;
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const actionController = useRef<AbortController | null>(null);
  const { reload: reloadSummary } = page;
  useEffect(() => { if (refreshKey || metadata.refresh || deletion.refresh) reloadSummary(); }, [refreshKey, metadata.refresh, deletion.refresh, reloadSummary]);
  useEffect(() => {
    if (!isOpen) { setSelectedCard(null); setShowDetailsModal(false); setActionError(null); setActionPending(false); }
    return () => { actionController.current?.abort(); actionController.current = null; };
  }, [isOpen]);
  const withCardAction = async (action: (signal: AbortSignal) => void | Promise<void>, failureMessage: string) => {
    // 重复点击不派生第二个动作；关闭或账号代际变化后不认领迟到的错误。
    if (suppliedBusy || metadata.isBusy() || isDeleting() || actionController.current !== null) return;
    const controller = new AbortController();
    actionController.current = controller;
    setActionError(null); setActionPending(true);
    try {
      await action(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) setActionError(cause instanceof Error ? cause.message : failureMessage);
    } finally {
      if (actionController.current === controller) { actionController.current = null; setActionPending(false); }
    }
  };
  const withFullCard = (card: any, action: (full: any) => void | Promise<void>) => withCardAction(async (signal) => {
    const full = await host.loadFullCard(card, 'my', signal);
    if (!signal.aborted) await action(full);
  }, '读取数据卡失败');



  useEffect(() => {
    if (isComposingSearchRef.current) return;
    const t = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 500);
    return () => {
      window.clearTimeout(t);
    };
  }, [searchQuery]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFilters((prev) => {
      const next: Filters = { ...prev, [name]: value } as Filters;

      if (name === 'type') {
        const nextType = value as CardTypeFilter;
        if (nextType !== 'character') {
          next.roleType = '';
        }
      }

      if (name === 'roleType') {
        const nextRoleType = value as RoleTypeFilter;
        if (nextRoleType && prev.type !== 'character') {
          next.type = 'character';
        }
      }

      return next;
    });
  };

  const applyFilters = () => {
    setActiveFilters(filters);
  };

  const resetFilters = () => {
    setFilters(sanitizedDefaultFilters);
    setActiveFilters(sanitizedDefaultFilters);
    setShowAdvancedFilters(true);
  };

  const isFilterActiveNow = useMemo(() => {
    return isFilterActive(activeFilters);
  }, [activeFilters]);

  const processedCards = useMemo(() => {
    return (Array.isArray(dataCards) ? dataCards : []).map((card) => {
      const roleType = inferRoleType(card);
      const author = extractCardAuthor(card);
      return {
        ...card,
        uiRoleType: roleType,
        uiAuthor: author,
      };
    });
  }, [dataCards]);

  const filteredAndSortedCards = useMemo(() => {
    if (serverPaged) return processedCards;
    const queryRaw = debouncedSearchQuery.trim();
    const query = queryRaw.toLowerCase();

    const minLikes = toOptionalNumber(activeFilters.minLikes);
    const maxLikes = toOptionalNumber(activeFilters.maxLikes);
    const minUsage = toOptionalNumber(activeFilters.minUsage);
    const maxUsage = toOptionalNumber(activeFilters.maxUsage);
    const minFavorites = toOptionalNumber(activeFilters.minFavorites);
    const maxFavorites = toOptionalNumber(activeFilters.maxFavorites);

    const filtered = processedCards.filter((card: any) => {
      if (!card) return false;

      // 类型筛选
      if (activeFilters.type && card.type !== activeFilters.type) {
        return false;
      }

      // 公开状态筛选
      if (activeFilters.visibility) {
        const status = getDataCardStatus(card).status;
        if (activeFilters.visibility === 'public' && status !== 'public') return false;
        if (activeFilters.visibility === 'private' && status !== 'private') return false;
        if (activeFilters.visibility === 'banned' && status !== 'banned') return false;
      }

      // 角色类型筛选（有值时自动限定为 character）
      if (activeFilters.roleType) {
        if (card.type !== 'character') return false;
        if ((card as any).uiRoleType !== activeFilters.roleType) return false;
      }

      const likes = getCountValue(card.like_count);
      const usage = getCountValue(card.usage_count);
      const favorites = getCountValue(card.favorite_count);

      if (minLikes !== null && likes < minLikes) return false;
      if (maxLikes !== null && likes > maxLikes) return false;
      if (minUsage !== null && usage < minUsage) return false;
      if (maxUsage !== null && usage > maxUsage) return false;
      if (minFavorites !== null && favorites < minFavorites) return false;
      if (maxFavorites !== null && favorites > maxFavorites) return false;

      if (query) {
        const name = typeof card.name === 'string' ? card.name : '';
        const description = typeof card.description === 'string' ? card.description : '';
        const id = typeof card.id === 'string' ? card.id : '';
        const roleType = typeof (card as any).uiRoleType === 'string' ? (card as any).uiRoleType : '';
        const typeLabel = card.type === 'character'
          ? '角色'
          : card.type === 'scenario'
            ? '情景'
            : card.type === 'history'
              ? '叙事历史'
              : card.type === 'questionnaire'
                ? '问卷'
                : '';
        const roleTypeLabel = roleType === 'magical-girl' ? '魔法少女' : roleType === 'canshou' ? '残兽' : roleType === 'general' ? '通用' : '';
        const haystack = `${name}\n${description}\n${id}\n${card.type ?? ''}\n${typeLabel}\n${roleType}\n${roleTypeLabel}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });

    const sorted = [...filtered].sort((a: any, b: any) => {
      if (sortBy === 'likes') {
        const diff = getCountValue(b.like_count) - getCountValue(a.like_count);
        if (diff !== 0) return diff;
      } else if (sortBy === 'usage') {
        const diff = getCountValue(b.usage_count) - getCountValue(a.usage_count);
        if (diff !== 0) return diff;
      } else if (sortBy === 'favorites') {
        const diff = getCountValue(b.favorite_count) - getCountValue(a.favorite_count);
        if (diff !== 0) return diff;
      } else if (sortBy === 'created_at') {
        const diff = getTimeValue(b.created_at) - getTimeValue(a.created_at);
        if (diff !== 0) return diff;
      } else if (sortBy === 'updated_at') {
        const diff = getTimeValue(b.updated_at) - getTimeValue(a.updated_at);
        if (diff !== 0) return diff;
      }

      // 兜底：按更新时间（新->旧）
      return getTimeValue(b.updated_at) - getTimeValue(a.updated_at);
    });

    return sorted;
  }, [processedCards, debouncedSearchQuery, activeFilters, sortBy, serverPaged]);

  // 处理查看详情
  const handleViewDetails = (card: any) => {
    setSelectedCard(card);
    setShowDetailsModal(true);
  };

  const total = serverPaged ? page.total : filteredAndSortedCards.length;
  const totalPages = Math.max(1, Math.ceil(total / cardsPerPage));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const paginatedCards = serverPaged ? filteredAndSortedCards : filteredAndSortedCards.slice(
    (safeCurrentPage - 1) * cardsPerPage,
    safeCurrentPage * cardsPerPage
  );

  useEffect(() => {
    if (!isOpen) return;
    onPageChange(1);
  }, [isOpen, debouncedSearchQuery, activeFilters, sortBy, onPageChange]);

  useEffect(() => {
    if (!isOpen) return;
    setFilters(sanitizedDefaultFilters);
    setActiveFilters(sanitizedDefaultFilters);
    setShowAdvancedFilters(isFilterActive(sanitizedDefaultFilters));
  }, [isOpen, sanitizedDefaultFilters]);

  useEffect(() => {
    if (!isOpen) return;
    if (serverPaged && page.status !== 'success') return;
    if (currentPage > totalPages) {
      onPageChange(totalPages);
    }
  }, [isOpen, currentPage, totalPages, onPageChange, serverPaged, page.status]);

  const paginatedCardIds = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const card of paginatedCards as any[]) {
      const id = typeof card?.id === 'string' ? card.id.trim() : '';
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [paginatedCards]);

  useEffect(() => {
    if (!isOpen) return;
    if (paginatedCardIds.length === 0) return;

    const pendingIds = paginatedCardIds.filter((id) => !Object.prototype.hasOwnProperty.call(cardMetaById, id));
    if (pendingIds.length === 0) return;

    metaFetchAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    metaFetchAbortControllerRef.current = abortController;

    const run = async () => {
      try {
        const items = await host.fetchCardMetaBatch(pendingIds, abortController.signal);
        if (items && !abortController.signal.aborted) setCardMetaById((prev) => {
          const next = { ...prev };
          // 服务端可省略暂无指标/不可见的条目；空结果也是本次查询已完成，不能无限重查。
          for (const id of pendingIds) next[id] = items[id] ?? { techScore: null, techLevel: null, strictTier: null, isNative: null };
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
  }, [isOpen, paginatedCardIds, cardMetaById, host]);

  const DataCardDetailsModal = host.DetailsModal;
  if (!isOpen) return null;

  const modal = (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center overflow-hidden overscroll-none z-50 p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="bg-white rounded-lg p-6 max-w-7xl w-full max-h-[min(90dvh,calc(100dvh-2rem))] overflow-hidden flex flex-col relative">
        <button
          ref={initialFocusRef}
          onClick={close}
          disabled={busy}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none z-10"
          aria-label="关闭"
        >
          ×
        </button>
        <div className="shrink-0 flex justify-between items-center mb-4 pr-8 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 id={titleId} className="text-xl font-bold">{title}</h2>
            <div className="text-sm text-gray-600">
              {capacityKnown ? `${userUsedSlots}/${userCapacity} 槽` : '云端容量未知'}（{serverPaged ? page.hasLoaded ? page.total : '—' : dataCards.length} 张）
              {!serverPaged && filteredAndSortedCards.length !== dataCards.length && (
                <span className="ml-2 text-gray-500">筛选后 {filteredAndSortedCards.length}</span>
              )}
            </div>
            {showHotHint && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                🔥 热门卡片仅减免 1 个基础槽；超出 300KiB 的额外槽位仍计费
              </div>
            )}
          </div>
          {onReload && (
            <button type="button" onClick={onReload} disabled={loading || busy}
              className="px-3 py-2 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50">
              {loading ? '加载中…' : error ? '重试' : '刷新'}
            </button>
          )}
          {onOpenRecycleBin && (
            <button
              onClick={() => { if (!busy && !isDeleting()) onOpenRecycleBin(); }}
              disabled={busy}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-200 transition-colors"
            >
              {recycleLabel}{recycleCount === null ? '' : ` ${recycleCount}/${recycleLimit}`}
            </button>
          )}
        </div>

        <div className={BASE_MODAL_BODY_LAYOUT_CLASS_NAME} role="region" aria-labelledby={titleId} tabIndex={0}>
          {actionPending && <p role="status" className="text-gray-600 text-center py-3">正在处理数据卡，请稍候…</p>}
        {/* fieldset 只承载禁用语义，普通 div 负责 flex 收缩与原生滚动。 */}
        <fieldset disabled={busy} className="min-w-0">
          {(error || actionError) && <p role="alert" className="text-red-600 text-center py-3">{actionError || (error && dataCards.length > 0 ? `刷新失败，当前显示上次成功结果：${error}` : error)}</p>}
          <>
              {/* 搜索 / 排序 / 筛选 */}
              <div className="mb-3">
                <div className="flex flex-wrap gap-2 items-center">
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
                      placeholder="搜索：名称 / 简介 / ID…"
                      className="w-full input-field pr-10"
                    />
                    {searchQuery && searchQuery !== debouncedSearchQuery && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 whitespace-nowrap">排序</span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortOption)}
                      className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                    >
                      <option value="updated_at">更新时间</option>
                      <option value="created_at">创建时间</option>
                      <option value="likes">点赞数</option>
                      <option value="usage">使用数</option>
                      <option value="favorites">收藏数</option>
                    </select>
                  </div>

                  <button
                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-colors ${isFilterActiveNow ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  >
                    <Filter className="w-4 h-4" /> 高级筛选{' '}
                    <ChevronDown className={`w-4 h-4 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
                  </button>
                </div>

                {showAdvancedFilters && (
                  <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-600">卡片类型</label>
                        <select name="type" value={filters.type} onChange={handleFilterChange} className="input-field">
                          <option value="">全部</option>
                          {resolvedAllowedTypes.map((type) => (
                            <option key={type} value={type}>{typeLabelMap[type]}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-600">公开状态</label>
                        <select name="visibility" value={filters.visibility} onChange={handleFilterChange} className="input-field">
                          <option value="">全部</option>
                          <option value="private">私有</option>
                          <option value="public">公开</option>
                          <option value="banned">封禁</option>
                        </select>
                      </div>
                      {!hideRoleTypeFilter && resolvedAllowedTypes.includes('character') && (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-gray-600">角色类型</label>
                          <select
                            name="roleType"
                            value={filters.roleType}
                            onChange={handleFilterChange}
                            className="input-field disabled:bg-gray-100 disabled:text-gray-400"
                            disabled={filters.type !== '' && filters.type !== 'character'}
                          >
                            <option value="">全部</option>
                            <option value="magical-girl">魔法少女</option>
                            <option value="canshou">残兽</option>
                            <option value="general">通用</option>
                          </select>
                        </div>
                      )}

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
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button onClick={resetFilters} className="px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">重置</button>
                      <button onClick={applyFilters} className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-md hover:bg-purple-700">应用筛选</button>
                    </div>
                  </div>
                )}
              </div>

              {metadata.status && <p role="status" className="mb-3 text-sm text-green-700">{metadata.status}</p>}
              {metadata.selection && <div className="mb-4" aria-label="编辑数据卡信息">
                <EditCardForm card={{ ...metadata.selection.card, is_public: metadata.selection.target?.isPublic ?? metadata.selection.card.is_public }}
                  showTemplate={false} value={metadata.selection.draft} onChange={metadata.change}
                  onSave={() => void metadata.save()} onCancel={metadata.cancel} busy={busy}
                  cancelLabel={metadata.selection.phase === 'uncertain' ? '已知晓，结束本次修改' : '取消'}
                  submitDisabled={metadata.selection.phase !== 'editing'} error={metadata.selection.error}
                  supplementaryContent={<>
                    {(metadata.selection.phase === 'reading' || metadata.selection.phase === 'checking') && <p role="status">正在读取云端信息…</p>}
                    {['uncertain', 'conflict'].includes(metadata.selection.phase) && <div className="space-y-2 text-sm">
                      {metadata.selection.phase === 'uncertain' && <p>关闭只会隐藏本次修改。明确结束会放弃保留的输入和提示，不会撤销服务器可能已执行的修改。</p>}
                      <button type="button" onClick={() => void metadata.check()}>重新读取云端信息</button>
                      {metadata.selection.candidate && <div className="rounded border p-2">
                        <p>当前云端名称：{metadata.selection.candidate.name}</p>
                        <p>当前云端描述：{metadata.selection.candidate.description || '（空）'}</p>
                        <p>当前云端可见性：{metadata.selection.candidate.isPublic === -1 ? '封禁' : metadata.selection.candidate.isPublic === 1 ? '公开' : '私有'}</p>
                        <p>此信息仅供核对，不能确认上一请求的结果。编辑输入仍保留。</p>
                        <button type="button" onClick={metadata.acceptCandidate}>已核对，使用此版本继续编辑</button>
                      </div>}
                    </div>}
                  </>} />
              </div>}
              {/* 数据卡网格 */}
              {filteredAndSortedCards.length === 0 ? (
                <p role="status" className="text-gray-500 text-center py-8">{loading || (serverPaged && page.status === 'idle') ? '正在加载数据卡…' : error ? '数据卡未能加载，请重试。' : total === 0 ? emptyText : '暂无匹配的数据卡'}</p>
              ) : (
                <div className="mb-4">
                  <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {paginatedCards.map((card) => {
                      const roleType = (card as any).uiRoleType as CardRoleType | undefined;
                      const author = (card as any).uiAuthor as string | undefined;

                      const hot = host.isHotCard({ favorite_count: card.favorite_count, usage_count: card.usage_count });
                      const hasPendingUpdate = Boolean(card.has_pending_update || card.pending_data);
                      const questionnaireNativeAllowed = resolveQuestionnaireNativeAllowed(card);

                      return editingCard?.id === card.id && onUpdateCard && onCancelEdit ? (
                        <EditCardForm
                          key={card.id}
                          card={editingCard}
                          onSave={(name, description, isPublic) =>
                            onUpdateCard(card.id, name, description, isPublic)
                          }
                          onCancel={onCancelEdit}
                        />
                      ) : (
                        <DataCard
                          platform={host.tilePlatform}
                          key={card.id}
                          id={card.id}
                          name={card.name}
                          description={card.description}
                          type={card.type}
                          roleType={roleType}
                          isPublic={normalizePublicVisibilityValue(card)}
                          reviewStatus={card.review_status}
                          usageCount={card.usage_count}
                          likeCount={card.like_count}
                          favoriteCount={card.favorite_count}
                          isRecommended={card.is_recommended === 1}
                          techScore={cardMetaById[card.id]?.techScore ?? null}
                          techLevel={cardMetaById[card.id]?.techLevel ?? null}
                          strictTier={cardMetaById[card.id]?.strictTier ?? null}
                          isNative={cardMetaById[card.id]?.isNative ?? null}
                          questionnaireNativeAllowed={questionnaireNativeAllowed}
                          hot={hot}
                          pending={hasPendingUpdate}
                          author={author}
                          isOwner={true}
                          onViewDetails={DataCardDetailsModal ? () => void withFullCard(card, handleViewDetails) : undefined}
                          onDownload={() => void withFullCard(card, (card) => {
                            // 下载功能
                            const dataToDownload = JSON.parse(card.data);
                            return host.downloadJson(`${card.name}.json`, JSON.stringify(dataToDownload, null, 2));
                          })}
                          onEditInfo={metadataEditor ? () => { if (!busy && !isDeleting() && actionController.current === null) void metadata.begin(card); } : onEditCard ? () => void withFullCard(card, onEditCard) : undefined}
                          onEditData={!hideEditData && onLoadCard ? () => void withFullCard(card, onLoadCard) : undefined}
                          onDelete={deletion.controller ? () => { if (!busy && !metadata.selection && actionController.current === null) void deletion.controller?.beginActive(card.id); } : onDeleteCard ? () => void withCardAction(() => onDeleteCard(card.id), '删除失败') : undefined}
                          onShare={onShareCard ? () => void withFullCard(card, onShareCard) : undefined}
                          onReplace={
                            onReplaceCard && (card.type !== 'history' || allowHistoryReplace)
                              ? () => void withFullCard(card, onReplaceCard)
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 分页控件 */}
              {totalPages > 1 && (
                <div className="flex flex-wrap justify-center items-center gap-2 pt-4 border-t">
                  <button
                    onClick={() => onPageChange(Math.max(1, safeCurrentPage - 1))}
                    disabled={safeCurrentPage === 1}
                    className="px-3 py-1 rounded text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    上一页
                  </button>
                  <span className="text-sm text-gray-600">
                    第 {safeCurrentPage} / {totalPages} 页
                  </span>
                  <button
                    onClick={() => onPageChange(Math.min(totalPages, safeCurrentPage + 1))}
                    disabled={safeCurrentPage === totalPages}
                    className="px-3 py-1 rounded text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    下一页
                  </button>
                  <PageJump currentPage={safeCurrentPage} totalPages={totalPages} onPageChange={onPageChange} disabled={busy || loading} />
                </div>
              )}
          </>
        </fieldset>
        </div>
      </div>

      <OwnedCardDeleteDialog controller={deletion.controller} onManageRecycle={onOpenRecycleBin} />
      {/* 详情模态框 */}
      {selectedCard && DataCardDetailsModal && (
        <DataCardDetailsModal
          source={{ kind: 'owned' }}
          isOpen={showDetailsModal}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedCard(null);
          }}
          isOwner={true}
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
            author: '我',
            createdAt: selectedCard.created_at,
            updatedAt: selectedCard.updated_at,
            tagIds: selectedCard.tagIds ?? selectedCard.tag_ids
          }}
          pendingNotice={selectedCard.pending_data ? '线上版本仍为旧版，新版审核通过后生效' : undefined}
        />
      )}
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modal, document.body);
  }
  return modal;
}
