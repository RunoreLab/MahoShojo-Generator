// components/BattleDataModal.tsx

import React, { useState, useEffect, useCallback } from 'react';
import DataCard from './DataCard';
import SortSelector from './SortSelector';
import DataCardDetailsModal from './DataCardDetailsModal';
import { useAuth } from '@/lib/useAuth';
import { dataCardApi } from '@/lib/auth';
import { addUsedCard, isCardUsed } from '@/lib/localStorage';
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
}

export default function BattleDataModal({
  isOpen,
  onClose,
  onSelectCard,
  selectedType
}: BattleDataModalProps) {
  const { isAuthenticated } = useAuth();
  const [userDataCards, setUserDataCards] = useState<any[]>([]);
  const [publicDataCards, setPublicDataCards] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'my' | 'public'>('public');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'likes' | 'usage' | 'created_at'>('created_at');
  const [selectedCard, setSelectedCard] = useState<any | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const cardsPerPage = 12;

  // 【新增】高级筛选的状态
  const initialFilters: Filters = { author: '', minLikes: '', maxLikes: '', minUsage: '', maxUsage: '' };
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);


  // 获取用户的数据卡
  const loadUserDataCards = useCallback(async (searchTerm?: string, sortBy?: 'likes' | 'usage' | 'created_at') => {
    if (!isAuthenticated) return;

    try {
      setIsLoading(true);
      const cards = await dataCardApi.getCards(searchTerm, sortBy);
      // 根据选择的类型过滤数据卡
      const filteredCards = cards.filter((card: any) => card.type === selectedType);
      setUserDataCards(filteredCards);
    } catch (error) {
      console.error('获取用户数据卡失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, selectedType]);

  // 通过 ID 获取数据卡并显示在列表中
  const loadCardByIdForDisplay = useCallback(async (cardId: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/public-data-cards?id=${cardId}`);
      if (response.ok) {
        const result = await response.json();
        setPublicDataCards(result.success && result.card ? [result.card] : []);
      } else {
        setPublicDataCards([]);
      }
    } catch (error) {
      console.error('通过ID获取数据卡失败:', error);
      setPublicDataCards([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 【修改】获取公开数据卡，现在会接收所有筛选条件
  const loadPublicDataCards = useCallback(async (
    page: number = 1,
    currentSortBy: 'likes' | 'usage' | 'created_at',
    currentSearchTerm?: string,
    currentFilters?: Filters
  ) => {
    try {
      setIsLoading(true);
      const offset = (page - 1) * cardsPerPage;
      const params = new URLSearchParams({
        type: selectedType,
        limit: cardsPerPage.toString(),
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
      }

      const response = await fetch(`/api/public-data-cards?${params}`);
      if (response.ok) {
        const result = await response.json();
        setPublicDataCards(result.success ? (result.cards || []) : []);
      }
    } catch (error) {
      console.error('获取公开数据卡失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedType, cardsPerPage]);

  // 防抖功能 - 延迟500ms执行搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // 当防抖搜索词变化时执行搜索
  useEffect(() => {
    if (!isOpen) return;

    // 检查是否包含 UUID 格式的 ID
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = debouncedSearchQuery.match(uuidRegex);

    if (match) {
      loadCardByIdForDisplay(match[0]);
    } else {
      loadPublicDataCards(1, sortBy, debouncedSearchQuery.trim() || undefined, filters);
    }
    setCurrentPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchQuery, isOpen, loadCardByIdForDisplay]);


  // 当模态框打开时加载数据
  useEffect(() => {
    if (isOpen) {
      setCurrentPage(1);
      setSearchQuery('');
      setFilters(initialFilters); // 清空高级筛选

      if (isAuthenticated) {
        setActiveTab('my');
        loadUserDataCards(undefined, sortBy);
      } else {
        setActiveTab('public');
      }
      loadPublicDataCards(1, sortBy);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedType, isAuthenticated]);

  // 处理卡片选择
  const handleSelectCard = async (card: any) => {
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
        _isPublic: card.is_public,
        _author: card.username || '未知'
      });
      onClose();
    } catch (error) {
      console.error('解析数据卡失败:', error);
    }
  };

  // 【新增】处理高级筛选输入变化
  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  // 【新增】应用高级筛选
  const applyFilters = () => {
    setCurrentPage(1);
    loadPublicDataCards(1, sortBy, debouncedSearchQuery.trim() || undefined, filters);
  };

  // 【新增】重置高级筛选
  const resetFilters = () => {
    setFilters(initialFilters);
    setCurrentPage(1);
    loadPublicDataCards(1, sortBy, debouncedSearchQuery.trim() || undefined, initialFilters);
  };

  // 【新增】处理作者点击事件
  const handleAuthorClick = (authorName: string) => {
    if (activeTab !== 'public') return;
    const newFilters = { ...initialFilters, author: authorName };
    setFilters(newFilters);
    setCurrentPage(1);
    setShowAdvancedFilters(true); // 展开筛选器让用户看到
    loadPublicDataCards(1, sortBy, '', newFilters);
  };

  // 处理页码变化
  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    if (activeTab === 'public') {
      loadPublicDataCards(newPage, sortBy, debouncedSearchQuery.trim() || undefined, filters);
    }
  };

  // 处理排序变化
  const handleSortChange = (newSortBy: 'likes' | 'usage' | 'created_at') => {
    setSortBy(newSortBy);
    setCurrentPage(1);
    if (activeTab === 'my') {
      loadUserDataCards(debouncedSearchQuery.trim() || undefined, newSortBy);
    } else if (activeTab === 'public') {
      loadPublicDataCards(1, newSortBy, debouncedSearchQuery.trim() || undefined, filters);
    }
  };

  if (!isOpen) return null;

  const userTotalPages = activeTab === 'my' ? Math.ceil(userDataCards.length / cardsPerPage) : 1;
  const paginatedUserCards = activeTab === 'my' ? userDataCards.slice((currentPage - 1) * cardsPerPage, currentPage * cardsPerPage) : [];
  const displayCards = activeTab === 'my' ? paginatedUserCards : publicDataCards;
  const typeLabel = selectedType === 'character' ? '角色' : '情景';
  const isFilterActive = Object.values(filters).some(v => v !== '');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg mx-4 p-6 max-w-7xl w-full max-h-[90vh] overflow-hidden flex flex-col relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl z-10">×</button>
        <h2 className="text-xl font-bold mb-4 pr-8">选择{typeLabel}数据卡</h2>

        {/* 筛选和排序区域 */}
        <div className="mb-2">
          <div className="flex flex-wrap gap-2 mb-2 items-center">
            <div className="flex-1 relative min-w-[250px]">
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={`搜索${typeLabel}名称或粘贴分享链接...`} className="w-full input-field pr-10" />
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={resetFilters} className="px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">重置</button>
                <button onClick={applyFilters} className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-md hover:bg-purple-700">应用筛选</button>
              </div>
            </div>
          )}
        </div>

        {/* 标签页切换 */}
        <div className="flex gap-2 mb-4">
          {isAuthenticated && <button onClick={() => { setActiveTab('my'); setCurrentPage(1); loadUserDataCards(undefined, sortBy); }} className={`px-4 py-2 rounded text-sm font-medium ${activeTab === 'my' ? 'bg-pink-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}>我的{typeLabel} ({userDataCards.length})</button>}
          <button onClick={() => { setActiveTab('public'); setCurrentPage(1); loadPublicDataCards(1, sortBy, '', filters); }} className={`px-4 py-2 rounded text-sm font-medium ${activeTab === 'public' ? 'bg-pink-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}>公开{typeLabel}</button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-auto">
          {isLoading ? <div className="flex justify-center items-center h-full"><div className="text-gray-500">加载中...</div></div>
            : displayCards.length === 0 ? <div className="text-center text-gray-500 py-8">暂无数据卡</div>
              : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {displayCards.map((card: any) => (
                  <div key={card.id} className="cursor-pointer h-full" onClick={() => handleSelectCard(card)}>
                    <DataCard
                      id={card.id} name={card.name} description={card.description} type={card.type} isPublic={card.is_public}
                      usageCount={card.usage_count} likeCount={card.like_count} author={activeTab === 'public' ? (card.username || '未知') : '我'}
                      onViewDetails={() => { setSelectedCard(card); setShowDetailsModal(true); }}
                      onAuthorClick={handleAuthorClick} // 【新增】传递作者点击处理函数
                    />
                  </div>
                ))}
              </div>}
        </div>
        
        {/* 分页与底部 */}
        {((activeTab === 'my' && userDataCards.length > cardsPerPage) || (activeTab === 'public' && (displayCards.length >= cardsPerPage || currentPage > 1))) &&
          <div className="flex justify-center items-center gap-2 pt-4 border-t mt-4">
            <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="page-button">上一页</button>
            <span className="text-sm text-gray-600">第 {currentPage} 页{activeTab === 'my' ? ` / ${userTotalPages}` : ''}</span>
            <button onClick={() => handlePageChange(currentPage + 1)} disabled={activeTab === 'my' ? currentPage >= userTotalPages : displayCards.length < cardsPerPage} className="page-button">下一页</button>
          </div>
        }
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
            author: activeTab === 'public' ? (selectedCard.username || '未知') : '我',
            createdAt: selectedCard.created_at,
            updatedAt: selectedCard.updated_at
          }}
        />
      )}
    </div>
  );
}