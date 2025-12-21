// components/BattleDataModal.tsx

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import DataCard from './DataCard';
import SortSelector from './SortSelector';
import DataCardDetailsModal from './DataCardDetailsModal';
import { useAuth } from '@/lib/useAuth';
import { dataCardApi, favoritesApi } from '@/lib/auth';
import { addUsedCard, isCardUsed } from '@/lib/localStorage';
import { inferTemplate } from '@/lib/data-card-converter';
import { ChevronDown, Filter } from 'lucide-react';

interface BattleDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCard: (card: any) => void;
  selectedType: 'character' | 'scenario';
}

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
}

export default function BattleDataModal({
  isOpen,
  onClose,
  onSelectCard,
  selectedType
}: BattleDataModalProps) {
  const { isAuthenticated } = useAuth();
  const isComposingSearchRef = useRef(false);
  const publicFetchAbortControllerRef = useRef<AbortController | null>(null);
  const [userDataCards, setUserDataCards] = useState<any[]>([]);
  const [publicDataCards, setPublicDataCards] = useState<any[]>([]);
  const [favoriteCards, setFavoriteCards] = useState<any[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'my' | 'public' | 'favorites'>('public');
  // 记录用户是否主动切换过 Tab，防止排序等状态变动时被意外重置
  const hasUserSelectedTabRef = React.useRef(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'likes' | 'usage' | 'favorites' | 'created_at'>('created_at');
  const [selectedCard, setSelectedCard] = useState<any | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false); // 防止重复点击
  const cardsPerPage = 12;

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
    roleType: ''
  }), []);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [activeFilters, setActiveFilters] = useState<Filters>(initialFilters);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

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


  // 获取用户的数据卡
  const loadUserDataCards = useCallback(async (searchTerm?: string, sortBy?: 'likes' | 'usage' | 'favorites' | 'created_at') => {
    if (!isAuthenticated) return;

    try {
      setIsLoading(true);
      const cards = await dataCardApi.getCards(searchTerm, sortBy);
      // 根据选择的类型过滤数据卡
      const filteredCards = cards.filter((card: any) => card.type === selectedType);
      setUserDataCards(mapWithRoleType(filteredCards));
    } catch (error) {
      console.error('获取用户数据卡失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, selectedType, mapWithRoleType]);

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
        setPublicDataCards(result.success && result.card ? mapWithRoleType([result.card]) : []);
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
  }, [mapWithRoleType]);

  // 【修改】获取公开数据卡，现在会接收所有筛选条件
  const loadPublicDataCards = useCallback(async (
    page: number = 1,
    currentSortBy: 'likes' | 'usage' | 'favorites' | 'created_at',
    currentSearchTerm?: string,
    currentFilters?: Filters
  ) => {
    publicFetchAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    publicFetchAbortControllerRef.current = abortController;
    try {
      setIsLoading(true);
      const useRoleTypeFilter = Boolean(currentFilters?.roleType && selectedType === 'character');
      const effectiveLimit = useRoleTypeFilter ? 500 : cardsPerPage;
      const offset = useRoleTypeFilter ? 0 : (page - 1) * cardsPerPage;
      const params = new URLSearchParams({
        type: selectedType,
        limit: effectiveLimit.toString(),
        offset: offset.toString(),
        sortBy: currentSortBy
      });

      if (currentSearchTerm) params.append('search', currentSearchTerm);
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
      }

      const response = await fetch(`/api/public-data-cards?${params}`, { signal: abortController.signal });
      if (response.ok) {
        const result = await response.json();
        let cards = result.success ? (result.cards || []) : [];
        cards = mapWithRoleType(cards);
        if (currentFilters?.roleType && selectedType === 'character') {
          cards = cards.filter((card: any) => card.roleType === currentFilters.roleType);
        }
        setPublicDataCards(cards);
      }
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
  }, [selectedType, cardsPerPage, mapWithRoleType]);

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
    typeParam?: 'character' | 'scenario',
    showLoading: boolean = false,
    sortCriteria?: 'likes' | 'usage' | 'favorites' | 'created_at'
  ) => {
    if (!isAuthenticated) return;

    try {
      if (showLoading) {
        setIsLoading(true);
      }
      const result = await favoritesApi.getFavorites({ type: typeParam ?? selectedType });
      if (result.success) {
        const cards = Array.isArray(result.favorites) ? mapWithRoleType(result.favorites) : [];
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
  }, [isAuthenticated, selectedType, sortFavorites, mapWithRoleType, sortBy]);

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

    // 检查是否包含 UUID 格式的 ID
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = trimmed.match(uuidRegex);

    if (match) {
      loadCardByIdForDisplay(match[0]);
    } else {
      loadPublicDataCards(1, sortBy, trimmed || undefined, activeFilters);
    }
  }, [debouncedSearchQuery, isOpen, activeTab, loadUserDataCards, loadCardByIdForDisplay, loadPublicDataCards, sortBy, activeFilters]);

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
    setFilters(initialFilters); // 清空高级筛选
    setActiveFilters(initialFilters);
    setIsSelecting(false); // 重置选择状态

    // 仅在用户未主动切换 Tab 时，根据登录状态决定默认标签
    if (!hasUserSelectedTabRef.current) {
      if (isAuthenticated) {
        setActiveTab('my');
      } else {
        setActiveTab('public');
      }
    } else {
      // 处理从登录态变为未登录的情况，强制回到公开区
      if (!isAuthenticated && activeTab !== 'public') {
        setActiveTab('public');
      }
    }

    // 按当前 Tab 触发首屏加载
    if (isAuthenticated && (activeTab === 'my' || (!hasUserSelectedTabRef.current && activeTab === 'public'))) {
      loadUserDataCards(undefined, sortBy);
      loadFavorites(selectedType, false, sortBy);
    }

    if (activeTab === 'favorites') {
      loadFavorites(selectedType, true, sortBy);
    }

    loadPublicDataCards(1, sortBy);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedType, isAuthenticated]);

  // 切换到情景时清除角色类型筛选，避免误筛
  useEffect(() => {
    if (selectedType !== 'character') {
      setFilters((prev) => ({ ...prev, roleType: '' }));
      setActiveFilters((prev) => ({ ...prev, roleType: '' }));
    }
  }, [selectedType]);

  // 处理卡片选择
  const handleSelectCard = async (card: any) => {
    // 防止重复点击
    if (isSelecting) {
      return;
    }

    setIsSelecting(true);
    try {
      // 解析数据卡的JSON内容
      const cardData = JSON.parse(card.data);

      // 如果是公开卡片且未使用过，增加使用次数
      if (card.is_public && !isCardUsed(card.id)) {
        try {
          const response = await fetch('/api/data-card-stats', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              cardId: card.id,
              type: 'usage'
            })
          });

          if (response.ok) {
            const result = await response.json();
            if (result.success) {
              // 添加到本地存储
              addUsedCard(card.id);
            }
          }
        } catch (error) {
          console.error('增加使用次数失败:', error);
        }
      }

      onSelectCard({
        ...cardData,
        _cardId: card.id,
        _cardName: card.name,
        _cardDescription: card.description || '',
        _isPublic: card.is_public,
        _updatedAt: card.updated_at,
        _createdAt: card.created_at,
        _author: card.username || '未知',
        _likeCount: typeof card.like_count === 'number' ? card.like_count : undefined,
        _favoriteCount: typeof card.favorite_count === 'number' ? card.favorite_count : undefined,
        _usageCount: typeof card.usage_count === 'number' ? card.usage_count : undefined,
      });
      onClose();
    } catch (error) {
      console.error('解析数据卡失败:', error);
    } finally {
      setIsSelecting(false);
    }
  };

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
    setCurrentPage(1);
    setActiveFilters(filters);
  };

  // 【新增】重置高级筛选
  const resetFilters = () => {
    setFilters(initialFilters);
    setActiveFilters(initialFilters);
    setCurrentPage(1);
  };

  // 【新增】处理作者点击事件
  const handleAuthorClick = (authorName: string) => {
    if (activeTab !== 'public') return;
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
    if (activeTab === 'public' && !(activeFilters.roleType && selectedType === 'character')) {
      loadPublicDataCards(newPage, sortBy, debouncedSearchQuery.trim() || undefined, activeFilters);
    }
  };

  // 处理排序变化
  const handleSortChange = (newSortBy: 'likes' | 'usage' | 'favorites' | 'created_at') => {
    setSortBy(newSortBy);
    setCurrentPage(1);
    if (activeTab === 'my') {
      loadUserDataCards(debouncedSearchQuery.trim() || undefined, newSortBy);
    } else if (activeTab === 'public') {
      loadPublicDataCards(1, newSortBy, debouncedSearchQuery.trim() || undefined, activeFilters);
    } else if (activeTab === 'favorites') {
      setFavoriteCards((prev) => sortFavorites(prev, newSortBy));
    }
  };

  const userTotalPages = Math.max(1, Math.ceil(userDataCards.length / cardsPerPage));
  const filteredFavoriteCards = useMemo(() => {
    const keyword = debouncedSearchQuery.trim().toLowerCase();
    if (!keyword) return favoriteCards;

    return favoriteCards.filter((card) => {
      const name = (card.name || '').toLowerCase();
      const desc = (card.description || '').toLowerCase();
      return name.includes(keyword) || desc.includes(keyword);
    });
  }, [favoriteCards, debouncedSearchQuery]);

  const favoritesTotalPages = Math.max(1, Math.ceil(filteredFavoriteCards.length / cardsPerPage));
  const paginatedUserCards = useMemo(
    () => userDataCards.slice((currentPage - 1) * cardsPerPage, currentPage * cardsPerPage),
    [userDataCards, currentPage, cardsPerPage]
  );
  const paginatedFavoriteCards = useMemo(
    () => filteredFavoriteCards.slice((currentPage - 1) * cardsPerPage, currentPage * cardsPerPage),
    [filteredFavoriteCards, currentPage, cardsPerPage]
  );

  const publicPaginatedCards = useMemo(() => {
    if (activeFilters.roleType && selectedType === 'character') {
      return publicDataCards.slice((currentPage - 1) * cardsPerPage, currentPage * cardsPerPage);
    }
    return publicDataCards;
  }, [publicDataCards, activeFilters.roleType, selectedType, currentPage, cardsPerPage]);

  const displayCards = activeTab === 'my'
    ? paginatedUserCards
    : activeTab === 'favorites'
      ? paginatedFavoriteCards
      : publicPaginatedCards;

  const publicTotalPages = activeFilters.roleType && selectedType === 'character'
    ? Math.max(1, Math.ceil(publicDataCards.length / cardsPerPage))
    : null;

  const currentTabTotalPages = activeTab === 'my'
    ? userTotalPages
    : activeTab === 'favorites'
      ? favoritesTotalPages
      : publicTotalPages;
  const typeLabel = selectedType === 'character' ? '角色' : '情景';
  const isFilterActive = useMemo(() => {
    return Boolean(
      activeFilters.author ||
      activeFilters.minLikes ||
      activeFilters.maxLikes ||
      activeFilters.minUsage ||
      activeFilters.maxUsage ||
      activeFilters.minFavorites ||
      activeFilters.maxFavorites ||
      activeFilters.recommendedOnly ||
      activeFilters.roleType
    );
  }, [activeFilters]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg mx-4 p-6 max-w-7xl w-full h-[85vh] max-h-[90vh] overflow-hidden flex flex-col relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl z-10">×</button>
        <h2 className="text-xl font-bold mb-4 pr-8">选择{typeLabel}数据卡</h2>

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
              <button onClick={() => setShowAdvancedFilters(!showAdvancedFilters)} className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-colors ${isFilterActive ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                <Filter className="w-4 h-4" /> 高级筛选 <ChevronDown className={`w-4 h-4 transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {/* 【新增】高级筛选面板 */}
            {showAdvancedFilters && activeTab === 'public' && (
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
                <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
                  <input
                    type="checkbox"
                    name="recommendedOnly"
                    checked={filters.recommendedOnly}
                    onChange={handleFilterChange}
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                  />
                  仅查看管理员推荐
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={resetFilters} className="px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">重置</button>
                  <button onClick={applyFilters} className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-md hover:bg-purple-700">应用筛选</button>
                </div>
              </div>
            )}
          </div>

          {/* 标签页切换 */}
          <div className="flex gap-2 mb-4">
            {isAuthenticated && (
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
            <button
              onClick={() => {
                hasUserSelectedTabRef.current = true;
                setActiveTab('public');
                setCurrentPage(1);
                loadPublicDataCards(1, sortBy, '', filters);
              }}
              className={`px-4 py-2 rounded text-sm font-medium ${activeTab === 'public' ? 'bg-pink-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
            >
              公开{typeLabel}
            </button>
            {isAuthenticated && (
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

          {/* 内容区域 */}
          <div>
            {isLoading ? <div className="flex justify-center items-center min-h-[40vh]"><div className="text-gray-500">加载中...</div></div>
              : displayCards.length === 0 ? <div className="text-center text-gray-500 py-8">暂无数据卡</div>
                : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {displayCards.map((card: any) => {
                    const isFavorited = favoriteIds.has(card.id);
                    const enableFavorite = isAuthenticated && activeTab !== 'my';

                    return (
                      <div key={card.id} className="cursor-pointer h-full" onClick={() => handleSelectCard(card)}>
                        <DataCard
                          id={card.id}
                          name={card.name}
                          description={card.description}
                          type={card.type}
                          roleType={card.roleType}
                          isPublic={card.is_public}
                          reviewStatus={card.review_status}
                          usageCount={card.usage_count}
                          likeCount={card.like_count}
                          favoriteCount={card.favorite_count}
                          isFavorited={isFavorited}
                          canFavorite={enableFavorite}
                          isRecommended={card.is_recommended === 1}
                          author={activeTab === 'my' ? '我' : (card.username || '未知')}
                          onViewDetails={() => { setSelectedCard(card); setShowDetailsModal(true); }}
                          onAuthorClick={handleAuthorClick}
                          onToggleFavorite={enableFavorite ? (next) => handleFavoriteToggleForCard(card, next) : undefined}
                          onDownload={() => handleDownloadCard(card)}
                        />
                      </div>
                    );
                  })}
                </div>}
          </div>

          {/* 分页与底部 */}
          {(
            (activeTab === 'my' && userDataCards.length > cardsPerPage) ||
            (activeTab === 'favorites' && favoriteCards.length > cardsPerPage) ||
            (activeTab === 'public' && (
              (activeFilters.roleType && selectedType === 'character')
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
      {selectedCard && (
        <DataCardDetailsModal
          isOpen={showDetailsModal}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedCard(null);
          }}
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
            author: activeTab === 'my' ? '我' : (selectedCard.username || '未知'),
            createdAt: selectedCard.created_at,
            updatedAt: selectedCard.updated_at
          }}
        />
      )}
    </div>
  );
}
