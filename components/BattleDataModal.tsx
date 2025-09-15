import React, { useState, useEffect, useCallback } from 'react';
import DataCard from './DataCard';
import SortSelector from './SortSelector';
import DataCardDetailsModal from './DataCardDetailsModal';
import { useAuth } from '@/lib/useAuth';
import { dataCardApi } from '@/lib/auth';
import { addUsedCard, isCardUsed } from '@/lib/localStorage';

interface BattleDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCard: (card: any) => void;
  selectedType: 'character' | 'scenario';
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

  // 通过 ID 获取数据卡并显示在列表中（不直接使用）
  const loadCardByIdForDisplay = useCallback(async (cardId: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/public-data-cards?id=${cardId}`);
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.card) {
          // 将找到的数据卡设置到公开数据卡列表中显示
          setPublicDataCards([result.card]);
        } else {
          // 未找到数据卡，清空列表
          setPublicDataCards([]);
        }
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

  // 获取公开数据卡
  const loadPublicDataCards = useCallback(async (searchTerm?: string, page: number = 1, sortBy?: 'likes' | 'usage' | 'created_at') => {
    try {
      setIsLoading(true);
      const offset = (page - 1) * cardsPerPage;
      const searchParams = new URLSearchParams({
        type: selectedType,
        limit: cardsPerPage.toString(),
        offset: offset.toString()
      });

      if (searchTerm) {
        searchParams.append('search', searchTerm);
      }
      
      if (sortBy) {
        searchParams.append('sortBy', sortBy);
      }

      const response = await fetch(`/api/public-data-cards?${searchParams}`);
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          const cards = result.cards || [];
          setPublicDataCards(cards);
        }
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
      // 如果检测到 UUID，通过 ID 搜索并展示在列表中
      const cardId = match[0];
      loadCardByIdForDisplay(cardId);
    } else {
      // 否则进行搜索
      const trimmedQuery = debouncedSearchQuery.trim();
      if (trimmedQuery) {
        loadPublicDataCards(trimmedQuery, 1, sortBy);
      } else if (debouncedSearchQuery === '') {
        // 只有在搜索框完全清空时才重新加载所有数据
        loadPublicDataCards(undefined, 1, sortBy);
      }
    }

    // 重置到第一页
    setCurrentPage(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchQuery, isOpen, loadCardByIdForDisplay, loadPublicDataCards]);

  // 当模态框打开时加载数据
  useEffect(() => {
    if (isOpen) {
      setCurrentPage(1);
      setSearchQuery(''); // 清空搜索

      // 根据登录状态设置默认标签页
      if (isAuthenticated) {
        setActiveTab('my');
        loadUserDataCards();
      } else {
        setActiveTab('public');
      }

      loadPublicDataCards(undefined, 1, sortBy);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedType, isAuthenticated, loadUserDataCards, loadPublicDataCards]);

  // 处理卡片选择并增加使用次数
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

  // 处理搜索输入 - 简化版，只更新输入值
  const handleSearchInput = (query: string) => {
    setSearchQuery(query);
  };

  // 处理页码变化
  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    if (activeTab === 'public') {
      // 对于公开标签页，需要重新加载数据
      const searchTerm = debouncedSearchQuery.trim() || undefined;
      loadPublicDataCards(searchTerm, newPage, sortBy);
    }
  };

  // 处理排序变化
  const handleSortChange = (newSortBy: 'likes' | 'usage' | 'created_at') => {
    setSortBy(newSortBy);
    setCurrentPage(1);
    
    // 根据当前活跃的标签页重新加载数据，不改变标签页
    if (activeTab === 'my') {
      const searchTerm = debouncedSearchQuery.trim() || undefined;
      loadUserDataCards(searchTerm, newSortBy);
    } else if (activeTab === 'public') {
      const searchTerm = debouncedSearchQuery.trim() || undefined;
      loadPublicDataCards(searchTerm, 1, newSortBy);
    }
  };

  // 处理查看详情
  const handleViewDetails = (card: any) => {
    setSelectedCard(card);
    setShowDetailsModal(true);
  };

  // 移除原来的过滤函数
  if (!isOpen) return null;

  // 对于我的数据卡，使用客户端分页
  const userTotalPages = activeTab === 'my' ? Math.ceil(userDataCards.length / cardsPerPage) : 1;
  const paginatedUserCards = activeTab === 'my'
    ? userDataCards.slice((currentPage - 1) * cardsPerPage, currentPage * cardsPerPage)
    : [];

  // 对于公开数据卡，使用服务端分页，直接显示获取的数据
  const displayCards = activeTab === 'my' ? paginatedUserCards : publicDataCards;

  const typeLabel = selectedType === 'character' ? '角色' : '情景';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg mx-4 p-6 max-w-7xl w-full max-h-[90vh] overflow-hidden flex flex-col relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none z-10"
          aria-label="关闭"
        >
          ×
        </button>

        <h2 className="text-xl font-bold mb-4 pr-8">选择{typeLabel}数据卡</h2>

        {/* 搜索框和排序 */}
        <div className="mb-2">
          <div className="flex gap-2 mb-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                placeholder={`搜索${typeLabel}名称或粘贴分享链接...`}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-transparent text-sm"
              />
              {searchQuery && searchQuery !== debouncedSearchQuery && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-pink-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </div>
            <SortSelector 
              value={sortBy} 
              onChange={handleSortChange}
              className="flex-shrink-0"
            />
          </div>
          <p className="text-xs text-gray-500">
            💡 支持搜索{typeLabel}的完整名称，或粘贴分享内容来查找特定数据卡
          </p>
        </div>

        {/* 标签页切换 */}
        <div className="flex gap-2 mb-4">
          {isAuthenticated && (
            <button
              onClick={() => {
                setActiveTab('my');
                setCurrentPage(1);
                const searchTerm = debouncedSearchQuery.trim() || undefined;
                loadUserDataCards(searchTerm, sortBy);
              }}
              className={`px-4 py-2 rounded text-sm font-medium ${activeTab === 'my'
                ? 'bg-pink-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
            >
              我的{typeLabel} ({userDataCards.length})
            </button>
          )}
          <button
            onClick={() => {
              setActiveTab('public');
              setCurrentPage(1);
              // 重新加载公开数据卡的第一页
              loadPublicDataCards(debouncedSearchQuery.trim() || undefined, 1, sortBy);
            }}
            className={`px-4 py-2 rounded text-sm font-medium ${activeTab === 'public'
              ? 'bg-pink-500 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
          >
            公开{typeLabel}
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex justify-center items-center h-32">
              <div className="text-gray-500">加载中...</div>
            </div>
          ) : displayCards.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {searchQuery ? (
                <>
                  <div className="mb-2">未找到匹配的{typeLabel}数据卡</div>
                  <div className="text-sm">尝试修改搜索关键词或清空搜索框查看所有数据卡</div>
                  <button
                    onClick={() => {
                      setSearchQuery('');
                    }}
                    className="mt-2 px-3 py-1 bg-pink-500 text-white rounded text-sm hover:bg-pink-600"
                  >
                    清空搜索
                  </button>
                </>
              ) : (
                activeTab === 'my' ?
                  `暂无${typeLabel}数据卡` :
                  `暂无公开的${typeLabel}数据卡`
              )}
            </div>
          ) : (
            <>
              {/* 数据卡网格 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-stretch">
                {displayCards.map((card: any) => {
                  const author = activeTab === 'public' ? (card.username || '未知') : '我';

                  return (
                    <div
                      key={card.id}
                      className="cursor-pointer transition-transform h-full"
                      onClick={() => handleSelectCard(card)}
                    >
                      <DataCard
                        id={card.id}
                        name={card.name}
                        description={card.description}
                        type={card.type}
                        isPublic={card.is_public}
                        usageCount={card.usage_count}
                        likeCount={card.like_count}
                        author={author}
                        onViewDetails={() => handleViewDetails(card)}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {/* 分页控件 */}
        {(
          (activeTab === 'my' && userDataCards.length > cardsPerPage) ||
          (activeTab === 'public' && (displayCards.length === cardsPerPage || currentPage > 1))
        ) && (
            <div className="flex justify-center items-center gap-2 pt-4 border-t mt-4">
              <button
                onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 rounded text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
              >
                上一页
              </button>
              <span className="text-sm text-gray-600">
                第 {currentPage} 页{activeTab === 'my' ? ` / ${userTotalPages}` : ''}
              </span>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={
                  activeTab === 'my'
                    ? currentPage >= userTotalPages
                    : displayCards.length < cardsPerPage
                }
                className="px-3 py-1 rounded text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
              >
                下一页
              </button>
            </div>
          )}
        {/* 底部提示 */}
        <div className="mt-4 text-center text-sm text-gray-500">
          点击数据卡即可加载到竞技场中
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
            author: activeTab === 'public' ? (selectedCard.username || '未知') : '我',
            createdAt: selectedCard.created_at,
            updatedAt: selectedCard.updated_at
          }}
        />
      )}
    </div>
  );
}