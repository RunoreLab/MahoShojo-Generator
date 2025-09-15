import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { config } from '@/lib/config';

interface SaveCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  name: string;
  description: string;
  isPublic: boolean;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPublicChange: (value: boolean) => void;
  error: string | null;
  isSaving?: boolean;
  currentCardCount?: number;
  userCapacity?: number;
}

export default function SaveCardModal({
  isOpen,
  onClose,
  onSave,
  name,
  description,
  isPublic,
  onNameChange,
  onDescriptionChange,
  onPublicChange,
  error,
  isSaving = false,
  currentCardCount = 0,
  userCapacity = config.DEFAULT_DATA_CARD_CAPACITY
}: SaveCardModalProps) {
  // 阻止背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const modalContent = (
    <div 
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ 
        zIndex: 999999,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)'
      }}
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-lg p-6 max-w-md w-full relative shadow-2xl"
        style={{ zIndex: 1000000 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none"
          aria-label="关闭"
        >
          ×
        </button>
        <div className="flex justify-between items-center mb-4 pr-8">
          <h2 className="text-xl font-bold">保存数据卡</h2>
          <div className="text-sm text-gray-600">
            {currentCardCount}/{userCapacity}
          </div>
        </div>

        {/* 容量警告 */}
        {currentCardCount >= userCapacity && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md text-sm">
            ⚠️ 数据卡数量已达上限（{userCapacity}个），请先删除部分数据卡
          </div>
        )}
        {currentCardCount >= userCapacity - 5 && currentCardCount < userCapacity && (
          <div className="mb-4 p-3 bg-yellow-100 text-yellow-700 rounded-md text-sm">
            ⚠️ 数据卡容量即将用完（{currentCardCount}/{userCapacity}）
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              数据卡名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              className="input-field"
              placeholder="请输入数据卡名称"
              maxLength={50}
              disabled={isSaving}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              描述
            </label>
            <textarea
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              className="input-field"
              rows={3}
              placeholder="请输入数据卡描述"
              maxLength={50}
              disabled={isSaving}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="newCardPublic"
              checked={isPublic}
              onChange={(e) => onPublicChange(e.target.checked)}
              className="w-4 h-4 text-purple-600 rounded"
              disabled={isSaving}
            />
            <label htmlFor="newCardPublic" className="text-sm text-gray-700">
              设为公开（其他用户可见）
            </label>
          </div>

          {isPublic && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
              ⚠️ 公开的数据卡将对所有用户可见
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={!name.trim() || isSaving || currentCardCount >= userCapacity}
              className={`flex-1 generate-button ${(!name.trim() || isSaving || currentCardCount >= userCapacity) ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isSaving ? '保存中...' : (currentCardCount >= userCapacity ? '容量已满' : '保存')}
            </button>
            <button
              onClick={onClose}
              disabled={isSaving}
              className={`flex-1 generate-button ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={{
                background: 'white',
                backgroundImage: 'none',
                color: '#6b7280',
                border: '2px solid #e5e7eb'
              }}
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // 使用 Portal 将模态框渲染到 document.body
  return typeof window !== 'undefined' ? createPortal(modalContent, document.body) : null;
}