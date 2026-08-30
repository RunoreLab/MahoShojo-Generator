import React, { useEffect, useMemo, useState } from 'react';
import { randomUUID } from '@/lib/crypto';
import { formatDateTime } from '@/lib/constants';
import type { NarrativeHistoryDataCardV1, NarrativeHistoryEntry } from '@/types/arena';

interface TargetCardMeta {
  id: string;
  name: string;
  description: string;
  isPublic: number;
}

interface NarrativeHistoryCardEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData: NarrativeHistoryDataCardV1 | null;
  targetCard?: TargetCardMeta | null;
  onReplaceTarget?: (payload: NarrativeHistoryDataCardV1) => Promise<void>;
}

const nowIso = () => new Date().toISOString();

const parseIsoOrFallback = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return fallback;
  return new Date(time).toISOString();
};

const normalizeEntries = (entries: unknown): NarrativeHistoryEntry[] => {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const content = typeof (raw as any).content === 'string' ? (raw as any).content : '';
      const title = typeof (raw as any).title === 'string' ? (raw as any).title : '';
      const fallbackTime = new Date(0).toISOString();
      const createdAt = parseIsoOrFallback((raw as any).createdAt ?? (raw as any).created_at, fallbackTime);
      const updatedAt = parseIsoOrFallback((raw as any).updatedAt ?? (raw as any).updated_at, createdAt);
      return {
        id: typeof (raw as any).id === 'string' ? (raw as any).id : randomUUID(),
        title: (title || '未命名战报').slice(0, 120),
        content,
        createdAt,
        updatedAt,
      } satisfies NarrativeHistoryEntry;
    })
    .filter((item): item is NarrativeHistoryEntry => Boolean(item));
};

const normalizeCardPayload = (data: NarrativeHistoryDataCardV1): NarrativeHistoryDataCardV1 => {
  const updatedAt = parseIsoOrFallback(data.updatedAt, nowIso());
  const entries = normalizeEntries(data.entries);
  const title = typeof data.title === 'string' ? data.title : '叙事历史';
  return {
    templateId: 'narrative-history',
    version: 1,
    title,
    updatedAt,
    entries,
  };
};

export default function NarrativeHistoryCardEditorModal({
  isOpen,
  onClose,
  initialData,
  targetCard,
  onReplaceTarget,
}: NarrativeHistoryCardEditorModalProps) {
  const [title, setTitle] = useState('叙事历史');
  const [entries, setEntries] = useState<NarrativeHistoryEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !initialData) return;
    const normalized = normalizeCardPayload(initialData);
    setTitle(normalized.title || '叙事历史');
    setEntries(normalized.entries);
    setActiveId(normalized.entries[0]?.id ?? null);
    setError(null);
    setSaving(false);
  }, [isOpen, initialData]);

  const activeEntry = useMemo(
    () => (activeId ? entries.find((item) => item.id === activeId) ?? null : null),
    [activeId, entries]
  );

  const buildPayload = (): NarrativeHistoryDataCardV1 => ({
    templateId: 'narrative-history',
    version: 1,
    title: title?.trim() ? title.trim().slice(0, 120) : '叙事历史',
    updatedAt: nowIso(),
    entries: [...entries].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none z-10"
          aria-label="关闭"
          disabled={saving}
        >
          ×
        </button>

        <div className="flex items-center justify-between gap-3 pr-8 flex-wrap">
          <div className="space-y-1">
            <h2 className="text-xl font-bold">叙事历史编辑</h2>
            <div className="text-xs text-gray-500">
              {targetCard ? `目标数据卡：${targetCard.name}（${targetCard.id}）` : '未绑定云端数据卡（可导出 JSON 后再保存到云端）'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
              onClick={() => {
                const payload = buildPayload();
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${payload.title || '叙事历史'}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              disabled={!initialData || saving}
            >
              导出 JSON
            </button>
            {onReplaceTarget && targetCard && (
              <button
                type="button"
                className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-60"
                onClick={async () => {
                  if (!onReplaceTarget) return;
                  setSaving(true);
                  setError(null);
                  try {
                    await onReplaceTarget(buildPayload());
                    setSaving(false);
                    onClose();
                    return;
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '替换失败');
                    setSaving(false);
                    return;
                  }
                }}
                disabled={!initialData || saving}
              >
                {saving ? '替换中…' : '替换此数据卡'}
              </button>
            )}
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs text-gray-500 mb-1">卡片标题（写入 JSON 的 title 字段）</label>
          <input
            className="input-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 overflow-hidden">
          <div className="border border-gray-200 rounded-lg p-3 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-700">历史条目（{entries.length}）</div>
              <button
                type="button"
                className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60"
                onClick={() => {
                  const ts = nowIso();
                  const entry: NarrativeHistoryEntry = {
                    id: randomUUID(),
                    title: '未命名战报',
                    content: '',
                    createdAt: ts,
                    updatedAt: ts,
                  };
                  setEntries((prev) => [entry, ...prev]);
                  setActiveId(entry.id);
                }}
                disabled={saving}
              >
                新增
              </button>
            </div>

            <div className="mt-3 flex-1 overflow-y-auto space-y-2">
              {entries.length === 0 ? (
                <div className="text-sm text-gray-500">暂无条目。你可以点击“新增”手动创建。</div>
              ) : (
                entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={[
                      'w-full text-left border rounded-lg p-3 transition-colors',
                      entry.id === activeId
                        ? 'border-pink-300 bg-pink-50/40'
                        : 'border-gray-200 hover:border-pink-300 hover:bg-pink-50/40',
                    ].join(' ')}
                    onClick={() => setActiveId(entry.id)}
                    disabled={saving}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-gray-800 truncate">{entry.title || '未命名战报'}</div>
                      <div className="text-[11px] text-gray-500 shrink-0">{formatDateTime(entry.updatedAt)}</div>
                    </div>
                    <div className="mt-1 text-xs text-gray-500 line-clamp-2">{(entry.content || '').trim() || '（内容为空）'}</div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-2 border border-gray-200 rounded-lg p-3 overflow-hidden flex flex-col">
            {!activeEntry ? (
              <div className="text-sm text-gray-500">请选择左侧条目进行编辑。</div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs text-gray-500">
                    创建：{formatDateTime(activeEntry.createdAt)}｜更新：{formatDateTime(activeEntry.updatedAt)}
                  </div>
                  <button
                    type="button"
                    className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-60"
                    onClick={() => {
                      if (!window.confirm('确定要删除这条叙事历史吗？')) return;
                      setEntries((prev) => prev.filter((item) => item.id !== activeEntry.id));
                      setActiveId((prev) => {
                        if (prev !== activeEntry.id) return prev;
                        const remaining = entries.filter((item) => item.id !== activeEntry.id);
                        return remaining[0]?.id ?? null;
                      });
                    }}
                    disabled={saving}
                  >
                    删除
                  </button>
                </div>

                <div className="mt-3">
                  <label className="block text-xs text-gray-500 mb-1">标题</label>
                  <input
                    className="input-field"
                    value={activeEntry.title}
                    onChange={(e) => {
                      const next = e.target.value.toString().slice(0, 120);
                      setEntries((prev) =>
                        prev.map((item) =>
                          item.id === activeEntry.id ? { ...item, title: next, updatedAt: nowIso() } : item
                        )
                      );
                    }}
                    disabled={saving}
                  />
                </div>

                <div className="mt-3 flex-1 overflow-hidden flex flex-col">
                  <label className="block text-xs text-gray-500 mb-1">正文</label>
                  <textarea
                    className="input-field font-mono text-xs flex-1"
                    value={activeEntry.content}
                    onChange={(e) => {
                      const next = e.target.value.toString();
                      setEntries((prev) =>
                        prev.map((item) =>
                          item.id === activeEntry.id ? { ...item, content: next, updatedAt: nowIso() } : item
                        )
                      );
                    }}
                    disabled={saving}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {error && <div className="mt-3 text-xs text-red-600">{error}</div>}
      </div>
    </div>
  );
}
