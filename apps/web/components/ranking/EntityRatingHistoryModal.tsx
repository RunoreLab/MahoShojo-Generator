'use client';

import { X } from 'lucide-react';

import { formatDateTime } from '@/lib/constants';

export type EntityRatingHistoryItem = {
  generationId: string;
  createdAt: string;
  appliedAt: string | null;
  opponent: {
    entityType: 'data_card' | 'preset';
    entityId: string;
    displayName: string;
  };
  result: 'win' | 'loss' | 'draw';
  delta: number;
  afterRating: number;
  initiator: {
    userId: number | null;
    username: string | null;
  };
};

export type EntityRatingHistoryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  loading: boolean;
  error: string | null;
  items: EntityRatingHistoryItem[];
  onRetry: () => void;
};

const formatSignedDelta = (value: number): string => (value > 0 ? `+${value}` : String(value));

const resultLabel: Record<EntityRatingHistoryItem['result'], string> = {
  win: '胜',
  loss: '负',
  draw: '平',
};

const resultClassName: Record<EntityRatingHistoryItem['result'], string> = {
  win: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  loss: 'border-rose-200 bg-rose-50 text-rose-700',
  draw: 'border-gray-200 bg-gray-50 text-gray-700',
};

const deltaClassName = (delta: number): string => {
  if (delta > 0) return 'text-emerald-700';
  if (delta < 0) return 'text-rose-700';
  return 'text-gray-700';
};

export function EntityRatingHistoryModal({
  isOpen,
  onClose,
  title = '最近严格排位',
  loading,
  error,
  items,
  onRetry,
}: EntityRatingHistoryModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div>
            <div className="text-base font-semibold text-gray-900">{title}</div>
            <div className="mt-0.5 text-xs text-gray-500">公开显示最近 10 条已计分 strict 对局</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {loading ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-600">
              正在加载最近严格排位记录...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800">
              <div>无法加载最近严格排位记录：{error}</div>
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 rounded-md bg-white px-3 py-1.5 text-xs text-gray-700 ring-1 ring-red-200 hover:bg-red-50"
              >
                重试
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
              暂无严格排位记录
            </div>
          ) : (
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {items.map((item) => (
                <div key={`${item.generationId}:${item.createdAt}`} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${resultClassName[item.result]}`}
                        >
                          {resultLabel[item.result]}
                        </span>
                        <span className="truncate text-sm font-medium text-gray-900">
                          对手：{item.opponent.displayName || '未知角色'}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                        <span title={item.createdAt}>{formatDateTime(item.createdAt)}</span>
                        <span>发起者：{item.initiator.username?.trim() || '未知用户'}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <div className={`font-semibold ${deltaClassName(item.delta)}`}>{formatSignedDelta(item.delta)}</div>
                      <div className="mt-1 text-xs text-gray-500">赛后 {item.afterRating}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
