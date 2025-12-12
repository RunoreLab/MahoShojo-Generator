import React, { useState } from 'react';
import DataCard from '../DataCard';
import EditCardForm from './EditCardForm';
import DataCardDetailsModal from '../DataCardDetailsModal';
import { config } from '@/lib/config';
import { inferTemplate } from '@/lib/data-card-converter';
import { isHotCard } from '@/lib/constants';

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
  userCapacity?: number;
  onOpenRecycleBin?: () => void;
  recycleCount?: number;
  recycleLimit?: number;
}

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
  userCapacity = config.DEFAULT_DATA_CARD_CAPACITY,
  onOpenRecycleBin,
  recycleCount = 0,
  recycleLimit = config.RECYCLE_BIN_LIMIT
}: DataCardsModalProps) {
  const [selectedCard, setSelectedCard] = useState<any | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const inferRoleType = (card: any): 'magical-girl' | 'canshou' | 'general' | undefined => {
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

  if (!isOpen) return null;

  // 处理查看详情
  const handleViewDetails = (card: any) => {
    setSelectedCard(card);
    setShowDetailsModal(true);
  };

  const totalPages = Math.ceil(dataCards.length / cardsPerPage);
  const paginatedCards = dataCards.slice(
    (currentPage - 1) * cardsPerPage,
    currentPage * cardsPerPage
  );

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
            {/* 数据卡网格 */}
            <div className="flex-1 overflow-y-auto mb-4">
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {paginatedCards.map((card) => {
                  // 解析数据中的作者信息
                  let author = undefined;
                  try {
                    const data = JSON.parse(card.data);
                    author = data._author;
                  } catch {
                    // 忽略解析错误
                  }
                  const roleType = inferRoleType(card);

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
                    />
                  );
                })}
              </div>
            </div>

            {/* 分页控件 */}
            {dataCards.length > cardsPerPage && (
              <div className="flex justify-center items-center gap-2 pt-4 border-t">
                <button
                  onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 rounded text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
                >
                  上一页
                </button>
                <span className="text-sm text-gray-600">
                  第 {currentPage} / {totalPages} 页
                </span>
                <button
                  onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
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
