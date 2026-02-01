import React, { useEffect, useMemo, useRef, useState } from 'react';
import DataCard from '../DataCard';
import EditCardForm from './EditCardForm';
import DataCardDetailsModal from '../DataCardDetailsModal';
import { config } from '@/lib/config';
import { inferTemplate } from '@/lib/data-card-converter';
import { isHotCard } from '@/lib/constants';
import { authStorage } from '@/lib/auth';
import { ChevronDown, Filter } from 'lucide-react';

interface DataCardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataCards: any[];
  editingCard: any | null;
  currentPage: number;
  cardsPerPage: number;
  onPageChange: (page: number) => void;
  onEditCard: (card: any) => void;
  onUpdateCard: (id: string, name: string, description: string, isPublic: number) => void;
  onDeleteCard: (id: string) => void;
  onLoadCard: (card: any) => void;
  onCancelEdit: () => void;
  onShareCard?: (card: any) => void;
  onReplaceCard?: (card: any) => void;
  userCapacity?: number;
  onOpenRecycleBin?: () => void;
  recycleCount?: number;
  recycleLimit?: number;
}

type CardTypeFilter = '' | 'character' | 'scenario' | 'history';
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

const inferRoleType = (card: any): CardRoleType | undefined => {
  if (!card || card.type !== 'character') return undefined;
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

export default function DataCardsModal({
  isOpen,
  onClose,
  dataCards,
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
  userCapacity = config.DEFAULT_DATA_CARD_CAPACITY,
  onOpenRecycleBin,
  recycleCount = 0,
  recycleLimit = config.RECYCLE_BIN_LIMIT
}: DataCardsModalProps) {
  const [selectedCard, setSelectedCard] = useState<any | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const metaFetchAbortControllerRef = useRef<AbortController | null>(null);
  const [cardMetaById, setCardMetaById] = useState<Record<string, { techScore: number | null; techLevel: string | null; strictTier: string | null; isNative: boolean | null }>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const isComposingSearchRef = useRef(false);
  const [sortBy, setSortBy] = useState<SortOption>('updated_at');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [activeFilters, setActiveFilters] = useState<Filters>(initialFilters);

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
    setFilters(initialFilters);
    setActiveFilters(initialFilters);
    setShowAdvancedFilters(true);
  };

  const isFilterActive = useMemo(() => {
    return Boolean(
      activeFilters.type ||
      activeFilters.visibility ||
      activeFilters.minLikes ||
      activeFilters.maxLikes ||
      activeFilters.minUsage ||
      activeFilters.maxUsage ||
      activeFilters.minFavorites ||
      activeFilters.maxFavorites ||
      activeFilters.roleType
    );
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
        const isPublic = card.is_public === 1;
        const isBanned = card.is_public === -1;
        const isPrivate = !isPublic && !isBanned;
        if (activeFilters.visibility === 'public' && !isPublic) return false;
        if (activeFilters.visibility === 'private' && !isPrivate) return false;
        if (activeFilters.visibility === 'banned' && !isBanned) return false;
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
        const typeLabel = card.type === 'character' ? '角色' : card.type === 'scenario' ? '情景' : card.type === 'history' ? '叙事历史' : '';
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
  }, [processedCards, debouncedSearchQuery, activeFilters, sortBy]);

  // 处理查看详情
  const handleViewDetails = (card: any) => {
    setSelectedCard(card);
    setShowDetailsModal(true);
  };

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedCards.length / cardsPerPage));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const paginatedCards = filteredAndSortedCards.slice(
    (safeCurrentPage - 1) * cardsPerPage,
    safeCurrentPage * cardsPerPage
  );

  useEffect(() => {
    if (!isOpen) return;
    onPageChange(1);
  }, [isOpen, debouncedSearchQuery, activeFilters, sortBy, onPageChange]);

  useEffect(() => {
    if (!isOpen) return;
    if (currentPage > totalPages) {
      onPageChange(totalPages);
    }
  }, [isOpen, currentPage, totalPages, onPageChange]);

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
  }, [isOpen, paginatedCardIds, cardMetaById]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 max-w-7xl w-full max-h-[90vh] overflow-hidden flex flex-col relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none z-10"
          aria-label="关闭"
        >
          ×
        </button>
        <div className="flex justify-between items-center mb-4 pr-8 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">我的数据卡</h2>
            <div className="text-sm text-gray-600">
              {dataCards.length}/{userCapacity}
              {filteredAndSortedCards.length !== dataCards.length && (
                <span className="ml-2 text-gray-500">筛选后 {filteredAndSortedCards.length}</span>
              )}
            </div>
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
              🔥 热门卡片（收藏&gt;10 且使用&gt;30）不占槽位
            </div>
          </div>
          {onOpenRecycleBin && (
            <button
              onClick={onOpenRecycleBin}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg border border-gray-200 hover:bg-gray-200 transition-colors"
            >
              回收站 {recycleCount}/{recycleLimit}
            </button>
          )}
        </div>

        {dataCards.length === 0 ? (
          <p className="text-gray-500 text-center py-8">暂无数据卡</p>
        ) : (
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
                  className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-colors ${isFilterActive ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
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
                        <option value="character">角色</option>
                        <option value="scenario">情景</option>
                        <option value="history">叙事历史</option>
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

            {/* 数据卡网格 */}
            {filteredAndSortedCards.length === 0 ? (
              <p className="text-gray-500 text-center py-8">暂无匹配的数据卡</p>
            ) : (
              <div className="flex-1 overflow-y-auto mb-4">
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {paginatedCards.map((card) => {
                    const roleType = (card as any).uiRoleType as CardRoleType | undefined;
                    const author = (card as any).uiAuthor as string | undefined;

                    const hot = isHotCard({ favorite_count: card.favorite_count, usage_count: card.usage_count });
                    const hasPendingUpdate = Boolean(card.pending_data);

                    return editingCard?.id === card.id ? (
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
                        key={card.id}
                        id={card.id}
                        name={card.name}
                        description={card.description}
                        type={card.type}
                        roleType={roleType}
                        isPublic={card.is_public}
                        reviewStatus={card.review_status}
                        usageCount={card.usage_count}
                        likeCount={card.like_count}
                        favoriteCount={card.favorite_count}
                        isRecommended={card.is_recommended === 1}
                        techScore={cardMetaById[card.id]?.techScore ?? null}
                        techLevel={cardMetaById[card.id]?.techLevel ?? null}
                        strictTier={cardMetaById[card.id]?.strictTier ?? null}
                        isNative={cardMetaById[card.id]?.isNative ?? null}
                        hot={hot}
                        pending={hasPendingUpdate}
                        author={author}
                        isOwner={true}
                        onViewDetails={() => handleViewDetails(card)}
                        onDownload={() => {
                          // 下载功能
                          const dataToDownload = JSON.parse(card.data);
                          const blob = new Blob([JSON.stringify(dataToDownload, null, 2)], {
                            type: 'application/json'
                          });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${card.name}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        onEditInfo={() => onEditCard(card)}
                        onEditData={() => onLoadCard(card)}
                        onDelete={() => onDeleteCard(card.id)}
                        onShare={() => onShareCard?.(card)}
                        onReplace={card.type === 'history' ? undefined : () => onReplaceCard?.(card)}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* 分页控件 */}
            {filteredAndSortedCards.length > cardsPerPage && (
              <div className="flex justify-center items-center gap-2 pt-4 border-t">
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
              </div>
            )}
          </>
        )}
      </div>

      {/* 详情模态框 */}
      {selectedCard && (
        <DataCardDetailsModal
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
            isPublic: selectedCard.is_public,
            usageCount: selectedCard.usage_count,
            likeCount: selectedCard.like_count,
            favoriteCount: selectedCard.favorite_count,
            author: '我',
            createdAt: selectedCard.created_at,
            updatedAt: selectedCard.updated_at
          }}
          pendingNotice={selectedCard.pending_data ? '线上版本仍为旧版，新版审核通过后生效' : undefined}
        />
      )}
    </div>
  );
}
