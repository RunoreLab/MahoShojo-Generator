import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDateTime } from '@/lib/constants';
import { buildTitleDisplay } from '@/lib/text';

interface ReplaceCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  cards: any[];
  targetType: 'character' | 'scenario' | 'history' | 'questionnaire';
  onConfirm: (cardId: string, opts: { name?: string; description?: string; isPublic?: number }) => Promise<void>;
  isSaving?: boolean;
}

export default function ReplaceCardModal({
  isOpen,
  onClose,
  cards,
  targetType,
  onConfirm,
  isSaving = false
}: ReplaceCardModalProps) {
  const filteredCards = useMemo(() => cards.filter((c) => c.type === targetType), [cards, targetType]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState<number | undefined>(undefined);

  // 避免弹窗打开时背景滚动，并确保弹层不受页面 stacking context（如 backdrop-filter）影响。
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!selectedId) return;
    const card = filteredCards.find((c) => c.id === selectedId);
    if (card) {
      setName(card.name || '');
      setDescription(card.description || '');
      setIsPublic(card.is_public);
    }
  }, [selectedId, filteredCards]);

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: 1000000 }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">替换已有数据卡</h3>
          <button className="text-gray-500 hover:text-gray-700 text-2xl" onClick={onClose}>
            ×
          </button>
        </div>

        {filteredCards.length === 0 ? (
          <p className="text-sm text-gray-600">暂无同类型的数据卡可替换。</p>
        ) : (
          <>
            <div className="space-y-3 mb-4">
              {filteredCards.map((card) => {
                const { display, full } = buildTitleDisplay(card.name || '未命名');
                return (
                  <label
                    key={card.id}
                    className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:border-purple-500 ${
                      selectedId === card.id ? 'border-purple-500 bg-purple-50' : 'border-gray-200'
                    }`}
                  >
                    <input
                      type="radio"
                      className="mt-1"
                      name="replace-card"
                      checked={selectedId === card.id}
                      onChange={() => setSelectedId(card.id)}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-800" title={full}>
                          {display}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                          {card.type === 'character' ? '角色' : card.type === 'scenario' ? '情景' : '叙事历史'}
                        </span>
                        {card.pending_data && (
                          <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded">更新审核中</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 line-clamp-2">{card.description}</p>
                      <p className="text-[11px] text-gray-500 mt-1">
                        创建 {formatDateTime(card.created_at)} ｜ 更新 {formatDateTime(card.updated_at)} ｜ 公开状态：{card.is_public === 1 ? '公开' : '私有'}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>

            {selectedId && (
              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">名称（可覆盖）</label>
                  <input
                    className="input-field"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={20}
                    disabled={isSaving}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">描述（可覆盖）</label>
                  <textarea
                    className="input-field"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    maxLength={300}
                    disabled={isSaving}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="replace-public"
                    className="w-4 h-4 text-purple-600"
                    checked={(isPublic ?? 0) === 1}
                    onChange={(e) => setIsPublic(e.target.checked ? 1 : 0)}
                    disabled={isSaving}
                  />
                  <label htmlFor="replace-public" className="text-sm text-gray-700">
                    替换后设为公开
                  </label>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                onClick={onClose}
                disabled={isSaving}
              >
                取消
              </button>
              <button
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60"
                disabled={!selectedId || isSaving}
                onClick={() =>
                  selectedId &&
                  onConfirm(selectedId, { name, description, isPublic: isPublic === undefined ? undefined : isPublic })
                }
              >
                {isSaving ? '替换中…' : '确认替换'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
