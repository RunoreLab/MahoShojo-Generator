import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';

import { dataCardApi } from '@/lib/auth';

export interface TavernCloudCardRow {
  id: string;
  type: 'character' | 'scenario' | 'history';
  name: string;
  description?: string | null;
  data: string;
  updated_at?: string;
  deleted_at?: string | null;
}

interface TavernCloudCardPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAuthenticated: boolean;
  onPick: (card: TavernCloudCardRow) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const asCardRow = (value: unknown): TavernCloudCardRow | null => {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const type = asString(value.type);
  const name = asString(value.name);
  const data = asString(value.data);
  if (!id || !type || !name || !data) return null;
  if (type !== 'character' && type !== 'scenario' && type !== 'history') return null;
  const description = asString(value.description);
  const updated_at = asString(value.updated_at) ?? undefined;
  const deleted_at = asString(value.deleted_at);
  return { id, type, name, data, description: description ?? undefined, updated_at, deleted_at: deleted_at ?? undefined };
};

export function TavernCloudCardPickerModal({ isOpen, onClose, isAuthenticated, onPick }: TavernCloudCardPickerModalProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<TavernCloudCardRow[]>([]);

  const visibleCards = useMemo(() => {
    return cards.filter((card) => card.type === 'character' && !card.deleted_at).slice(0, 30);
  }, [cards]);

  const fetchCards = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const items = await dataCardApi.getCards(query || undefined);
      const parsed: TavernCloudCardRow[] = [];
      for (const item of items as unknown[]) {
        const row = asCardRow(item);
        if (!row) continue;
        parsed.push(row);
      }
      setCards(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setError(null);
    setCards([]);
    if (!isAuthenticated) return;
    void fetchCards('');
  }, [fetchCards, isAuthenticated, isOpen]);

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

  const content = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: 999999,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={() => {
        if (loading) return;
        onClose();
      }}
    >
      <div
        className="bg-white rounded-2xl p-6 max-w-2xl w-full relative shadow-2xl border border-pink-100 max-h-[85vh] overflow-hidden flex flex-col"
        style={{ zIndex: 1000000 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none"
          aria-label="关闭"
          disabled={loading}
        >
          ×
        </button>

        <div className="pr-8">
          <h2 className="text-xl font-bold text-gray-900">从档案馆选择角色数据卡</h2>
          <div className="mt-1 text-xs text-gray-600">仅显示“角色”类型；载入后会自动带入导出字段。</div>
        </div>

        {!isAuthenticated ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="font-semibold">未登录</div>
            <div className="mt-1">请先登录后再使用档案馆选择功能。</div>
            <button
              type="button"
              className="mt-3 rounded-xl border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-semibold text-pink-800 hover:bg-pink-100"
              onClick={() => router.push('/character-manager')}
            >
              前往档案馆登录
            </button>
          </div>
        ) : null}

        {isAuthenticated ? (
          <>
            <div className="mt-4 flex gap-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 rounded-xl border border-pink-100 bg-white/80 p-3 text-sm text-gray-900"
                placeholder="搜索名称/描述（可选）"
                disabled={loading}
              />
              <button
                type="button"
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                  loading ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-pink-200 bg-pink-50 text-pink-800 hover:bg-pink-100'
                }`}
                onClick={() => fetchCards(search.trim())}
                disabled={loading}
              >
                {loading ? '加载中…' : '搜索'}
              </button>
            </div>

            {error ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
            ) : null}

            <div className="mt-4 flex-1 overflow-y-auto rounded-xl border border-pink-100 bg-white/70">
              {loading ? (
                <div className="p-4 text-sm text-gray-600">加载中…</div>
              ) : visibleCards.length === 0 ? (
                <div className="p-4 text-sm text-gray-600">暂无可选数据卡（或搜索无结果）。</div>
              ) : (
                <ul className="divide-y divide-pink-100">
                  {visibleCards.map((card) => (
                    <li key={card.id} className="p-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 truncate">{card.name}</div>
                        {card.description ? <div className="mt-1 text-xs text-gray-600 line-clamp-2">{card.description}</div> : null}
                        {card.updated_at ? <div className="mt-1 text-xs text-gray-500">更新：{card.updated_at}</div> : null}
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded-xl border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-semibold text-pink-800 hover:bg-pink-100"
                        onClick={() => onPick(card)}
                      >
                        载入
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                  loading ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
                onClick={onClose}
                disabled={loading}
              >
                关闭
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );

  return typeof window !== 'undefined' ? createPortal(content, document.body) : null;
}
