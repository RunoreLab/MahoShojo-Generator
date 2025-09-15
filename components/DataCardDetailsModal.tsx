import React from 'react';
import { X, Info } from 'lucide-react';
import { getFieldDisplayName } from '@/lib/fieldTranslations';

interface DataCardDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  card: {
    id: string;
    name: string;
    description: string;
    type: 'character' | 'scenario';
    data: string; // JSON字符串
    isPublic: boolean;
    usageCount?: number;
    likeCount?: number;
    author?: string;
    createdAt?: string;
    updatedAt?: string;
  };
}

export default function DataCardDetailsModal({
  isOpen,
  onClose,
  card
}: DataCardDetailsModalProps) {
  if (!isOpen) return null;

  let parsedData: any = {};
  try {
    parsedData = JSON.parse(card.data);
  } catch (error) {
    console.error('解析数据卡内容失败:', error);
  }

  // 递归渲染对象内容
  const renderObjectContent = (obj: any, level: number = 0): React.ReactNode => {
    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
      return <span className="text-gray-700">{String(obj)}</span>;
    }

    if (Array.isArray(obj)) {
      return (
        <div className="space-y-1">
          {obj.map((item, index) => (
            <div key={index} className="flex items-start gap-2">
              <span className="text-gray-500 text-sm">•</span>
              <div className="flex-1">
                {renderObjectContent(item, level + 1)}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (typeof obj === 'object' && obj !== null) {
      return (
        <div className="space-y-2">
          {Object.entries(obj).map(([key, value]) => {
            // 跳过内部字段
            if (key.startsWith('_')) return null;
            // 跳过 metadata 字段
            if (key === 'metadata') return null;

            return (
              <div key={key} className="border-l-2 border-gray-200 pl-3">
                <div className="font-medium text-gray-600 text-sm mb-1">
                  {getFieldDisplayName(key)}:
                </div>
                <div className="ml-2">
                  {renderObjectContent(value, level + 1)}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return <span className="text-gray-500">无数据</span>;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-start gap-3">
            <div className={`p-2 mt-1 rounded-lg ${card.type === 'character' ? 'bg-pink-100' : 'bg-purple-100'
              }`}>
              <Info className={`w-5 h-5 ${card.type === 'character' ? 'text-pink-600' : 'text-purple-600'
                }`} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">
                {card.name}
              </h2>
              <p className="text-sm text-gray-500">
                {card.description}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                作者：{card.author}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 详细设定内容 */}
        <div className="flex-1 overflow-auto p-6">
          <h3 className="font-medium text-gray-700 mb-4 flex items-center gap-2">
            <span>详细设定</span>
          </h3>

          <div className="bg-gray-50 rounded-lg p-4">
            {Object.keys(parsedData).length > 0 ? (
              renderObjectContent(parsedData)
            ) : (
              <p className="text-gray-500 text-center py-8">
                暂无详细设定数据
              </p>
            )}
          </div>
        </div>

        {/* 底部 */}
        <div className="p-6 border-t bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}