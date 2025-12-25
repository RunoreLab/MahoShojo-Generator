'use client';

import { X } from 'lucide-react';
import { useMemo, useState } from 'react';

export type PvpHandCardItem = {
  snapshotId: string;
  name: string;
  type?: string | null;
  dataJson?: string | null;
  ref?: any;
};

const getCardSourceLabel = (ref: any): string => {
  const kind = typeof ref?.kind === 'string' ? ref.kind : '';
  if (kind === 'preset') return '预设';
  if (kind === 'data_card') return '数据卡';
  return '快照';
};

export function PvpHandModal({
  isOpen,
  onClose,
  cards,
  hasChosenMe,
  isChoosing,
  onOpenDetails,
  onChoose,
}: {
  isOpen: boolean;
  onClose: () => void;
  cards: PvpHandCardItem[];
  hasChosenMe: boolean;
  isChoosing: boolean;
  onOpenDetails: (card: PvpHandCardItem) => void;
  onChoose: (snapshotId: string) => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => {
      const name = typeof c?.name === 'string' ? c.name : '';
      const type = typeof c?.type === 'string' ? c.type : '';
      const source = getCardSourceLabel(c?.ref);
      return `${name} ${type} ${source}`.toLowerCase().includes(q);
    });
  }, [cards, query]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <div className="text-lg font-bold text-gray-800">手牌</div>
            <div className="text-xs text-gray-500 mt-1">
              共 {cards.length} 张 {hasChosenMe ? '（你已出牌）' : ''}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 border-b bg-gray-50">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索：名称 / 类型 / 来源（预设/数据卡）"
            className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
          />
        </div>

        <div className="flex-1 overflow-auto p-5">
          {filtered.length <= 0 ? (
            <div className="text-sm text-gray-600">没有匹配的手牌。</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((c) => {
                const sourceLabel = getCardSourceLabel(c.ref);
                const type = typeof c.type === 'string' && c.type ? c.type : 'unknown';
                return (
                  <div key={c.snapshotId} className="rounded-xl border bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-gray-900 break-words">{c.name || '未命名'}</div>
                        <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-2">
                          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{type}</span>
                          <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{sourceLabel}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 text-sm"
                        onClick={() => onOpenDetails(c)}
                      >
                        详情
                      </button>
                      <button
                        className="px-3 py-2 rounded-lg text-sm text-white bg-gradient-to-r from-pink-500 to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => onChoose(c.snapshotId)}
                        disabled={isChoosing || hasChosenMe}
                        title={hasChosenMe ? '你已选择过出战卡' : undefined}
                      >
                        {hasChosenMe ? '已出战' : isChoosing ? '提交中…' : '出战'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-5 border-t bg-gray-50 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

