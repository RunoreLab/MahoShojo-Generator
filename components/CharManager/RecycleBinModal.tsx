import React, { useMemo, useState } from 'react';
import DataCardDetailsModal from '../DataCardDetailsModal';
import { buildTitleDisplay } from '@/lib/text';

interface RecycleBinModalProps {
  isOpen: boolean;
  onClose: () => void;
  recycleCards: any[];
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  limit: number;
}

const formatDateTime = (value?: string): string => {
  if (!value) {
    return '未知时间';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN');
};

export default function RecycleBinModal({
  isOpen,
  onClose,
  recycleCards,
  onRestore,
  onDelete,
  limit
}: RecycleBinModalProps) {
  const [selectedCard, setSelectedCard] = useState<any | null>(null);

  const parsedCards = useMemo(() => {
    return recycleCards.map((card) => {
      let parsedData: any = null;
      try {
        parsedData = JSON.parse(card.data);
      } catch (error) {
        console.warn('解析回收站数据卡失败:', error);
      }
      return { ...card, parsedData };
    });
  }, [recycleCards]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none z-10"
          aria-label="关闭"
        >
          ×
        </button>
        <div className="flex justify-between items-center mb-4 pr-8">
          <div>
            <h2 className="text-xl font-bold">数据卡回收站</h2>
            <p className="text-sm text-gray-500 mt-1">删除后会暂存于此，最多保留 {limit} 个，超出将自动清理最早的记录。</p>
          </div>
          <div className="text-sm text-gray-600">
            {recycleCards.length}/{limit}
          </div>
        </div>

        {parsedCards.length === 0 ? (
          <p className="text-gray-500 text-center py-8">回收站为空</p>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              {parsedCards.map((card) => {
                const { display, full } = buildTitleDisplay(card.name || '未命名');
                return (
                  <div key={card.id} className="border border-gray-200 rounded-lg p-4 flex flex-col h-full bg-gray-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <h3 className="text-base font-semibold text-gray-800 break-words" title={full}>
                          {display}
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">类型：{card.type === 'scenario' ? '情景' : '角色'}</p>
                      </div>
                      <span className="text-xs text-gray-500 whitespace-nowrap">删除于 {formatDateTime(card.deleted_at)}</span>
                    </div>
                  <p className="text-sm text-gray-600 mt-3 line-clamp-2 min-h-[40px]">
                    {card.description || '（无描述）'}
                  </p>
                  <div className="mt-auto pt-4 flex flex-wrap gap-2 justify-end">
                    <button
                      onClick={() => setSelectedCard(card)}
                      className="px-3 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-100"
                    >
                      查看详情
                    </button>
                    <button
                      onClick={() => onRestore(card.id)}
                      className="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                    >
                      恢复
                    </button>
                    <button
                      onClick={() => onDelete(card.id)}
                      className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      彻底删除
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {selectedCard && (
        <DataCardDetailsModal
          isOpen={true}
          onClose={() => setSelectedCard(null)}
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
            author: selectedCard.parsedData?._author || '我',
            createdAt: selectedCard.created_at,
            updatedAt: selectedCard.updated_at
          }}
        />
      )}
    </div>
  );
}
