import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDateTime } from '@/lib/constants';
import { buildTitleDisplay } from '@/lib/text';
import { JsonSizeIndicator } from '@/components/shared/JsonSizeIndicator';
import { getDataCardStatus, getDataCardVisibilityValue } from '@/lib/data-card-status';

export type ReplaceCardTargetType = 'character' | 'scenario' | 'history' | 'questionnaire';

type ReplaceCardViewer = {
  id?: number | null;
  username?: string | null;
};

type ReplaceCardEmptyStateInput = {
  targetType: ReplaceCardTargetType;
  totalCards: number;
  candidateCount: number;
  viewer?: ReplaceCardViewer | null;
  loadError?: string | null;
};

export function getReplaceCardTargetTypeLabel(targetType: ReplaceCardTargetType): string {
  if (targetType === 'character') return '角色';
  if (targetType === 'scenario') return '情景';
  if (targetType === 'history') return '叙事历史';
  return '问卷';
}

const formatReplaceCardViewer = (viewer?: ReplaceCardViewer | null): string => {
  const username = typeof viewer?.username === 'string' ? viewer.username.trim() : '';
  const id = typeof viewer?.id === 'number' && Number.isFinite(viewer.id) ? Math.trunc(viewer.id) : null;

  if (username && id !== null) return `${username} (#${id})`;
  if (username) return username;
  if (id !== null) return `用户 #${id}`;
  return '未知';
};

export function buildReplaceCardEmptyState(input: ReplaceCardEmptyStateInput): {
  title: string;
  details: string[];
  errorMessage: string | null;
} {
  const errorMessage = typeof input.loadError === 'string' && input.loadError.trim() ? input.loadError.trim() : null;
  const details = [
    ...(errorMessage ? ['加载状态：失败'] : []),
    `当前登录：${formatReplaceCardViewer(input.viewer)}`,
    `已加载数据卡：${Math.max(0, Math.trunc(input.totalCards))} 张`,
    `目标类型：${getReplaceCardTargetTypeLabel(input.targetType)}`,
    `同类型候选：${Math.max(0, Math.trunc(input.candidateCount))} 张`,
  ];

  return {
    title: '暂无同类型的数据卡可替换。',
    details,
    errorMessage,
  };
}

interface ReplaceCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  cards: any[];
  targetType: ReplaceCardTargetType;
  onConfirm: (cardId: string, opts: { name?: string; description?: string; isPublic?: number }) => Promise<void>;
  isSaving?: boolean;
  data?: unknown;
  viewer?: ReplaceCardViewer | null;
  loadError?: string | null;
}

export default function ReplaceCardModal({
  isOpen,
  onClose,
  cards,
  targetType,
  onConfirm,
  isSaving = false,
  data,
  viewer = null,
  loadError = null,
}: ReplaceCardModalProps) {
  const filteredCards = useMemo(() => cards.filter((c) => c.type === targetType), [cards, targetType]);
  const emptyState = useMemo(
    () =>
      buildReplaceCardEmptyState({
        targetType,
        totalCards: cards.length,
        candidateCount: filteredCards.length,
        viewer,
        loadError,
      }),
    [cards.length, filteredCards.length, loadError, targetType, viewer],
  );
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
      setIsPublic(getDataCardVisibilityValue(card));
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
          <div className="space-y-3">
            <p className="text-sm text-gray-600">{emptyState.title}</p>
            {emptyState.errorMessage && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                最近一次数据卡列表加载失败：{emptyState.errorMessage}
              </div>
            )}
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              {emptyState.details.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-4">
              {filteredCards.map((card) => {
                const { display, full } = buildTitleDisplay(card.name || '未命名');
                const cardStatus = getDataCardStatus(card);
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
                        创建 {formatDateTime(card.created_at)} ｜ 更新 {formatDateTime(card.updated_at)} ｜ 公开状态：{cardStatus.label}
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

            {data !== undefined && data !== null && (
              <JsonSizeIndicator
                data={data}
                className="mt-0 mb-4"
                warningText="⚠️ 接近云端 300KB 上限，替换可能失败，请先精简数据。"
              />
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
