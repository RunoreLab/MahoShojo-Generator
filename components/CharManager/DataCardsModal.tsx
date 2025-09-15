import React from 'react';
import DataCard from '../DataCard';
import EditCardForm from './EditCardForm';
import { config } from '@/lib/config';

interface DataCardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataCards: any[];
  editingCard: any | null;
  currentPage: number;
  cardsPerPage: number;
  onPageChange: (page: number) => void;
  onEditCard: (card: any) => void;
  onUpdateCard: (id: string, name: string, description: string, isPublic: boolean) => void;
  onDeleteCard: (id: string) => void;
  onLoadCard: (card: any) => void;
  onCancelEdit: () => void;
  onShareCard?: (card: any) => void;
  userCapacity?: number;
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
  userCapacity = config.DEFAULT_DATA_CARD_CAPACITY
}: DataCardsModalProps) {
  if (!isOpen) return null;

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
        <div className="flex justify-between items-center mb-4 pr-8">
          <h2 className="text-xl font-bold">我的数据卡</h2>
          <div className="text-sm text-gray-600">
            {dataCards.length}/{userCapacity}
          </div>
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
                      isPublic={card.is_public}
                      usageCount={card.usage_count}
                      likeCount={card.like_count}
                      author={author}
                      isOwner={true}
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
    </div>
  );
}