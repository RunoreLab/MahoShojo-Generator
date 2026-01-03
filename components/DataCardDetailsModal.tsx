import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Info, Star, Heart, Download } from 'lucide-react';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { getFieldDisplayName } from '@/lib/fieldTranslations';
import { formatDateTime } from '@/lib/constants';
import { authStorage } from '@/lib/auth';

type ApiTag = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  scope: 'user' | 'system' | 'admin';
  isActive: boolean;
};

type ApiMetrics = {
  techScore: number;
  techLevel: string;
  isNative: boolean | null;
  dataCardUpdatedAt: string;
  isStale: boolean;
};

type ApiRating = {
  queue: 'strict' | 'free';
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  tier: string;
  lastDelta: number | null;
  lastAppliedAt: string | null;
  publicRank: number | null;
};

type ApiMetaResponse =
  | {
      success: true;
      dataCardId: string;
      tags: ApiTag[];
      metrics: ApiMetrics | null;
      ratings: { strict: ApiRating | null; free: ApiRating | null };
    }
  | { success: false; error?: string };

type ApiTagsResponse =
  | { success: true; tags: ApiTag[] }
  | { success: false; error?: string };

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json;
};

interface DataCardDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isOwner?: boolean;
  card: {
    id: string;
    name: string;
    description: string;
    type: 'character' | 'scenario' | 'history';
    data: string; // JSON字符串
    isPublic: boolean;
    usageCount?: number;
    likeCount?: number;
    favoriteCount?: number;
    author?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  pendingNotice?: string;
}

export default function DataCardDetailsModal({
  isOpen,
  onClose,
  card,
  pendingNotice,
  isOwner = false,
}: DataCardDetailsModalProps) {
  const [metaNonce, setMetaNonce] = useState(0);
  const [meta, setMeta] = useState<Extract<ApiMetaResponse, { success: true }> | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [isEditingTags, setIsEditingTags] = useState(false);
  const [allTags, setAllTags] = useState<ApiTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [tagSearch, setTagSearch] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);
  const [saveTagsError, setSaveTagsError] = useState<string | null>(null);

  const reloadMeta = useCallback(async (dataCardId: string) => {
    setMetaLoading(true);
    setMetaError(null);
    try {
      const authHeader = await authStorage.getAuthHeader();
      const headers: HeadersInit = authHeader ? { Authorization: authHeader } : {};
      const json = await fetchJson<ApiMetaResponse>(`/api/data-card-meta?dataCardId=${encodeURIComponent(dataCardId)}`, {
        method: 'GET',
        headers,
      });
      if (json && (json as any).success === true) {
        setMeta(json as Extract<ApiMetaResponse, { success: true }>);
      } else {
        setMeta(null);
        setMetaError((json as any)?.error ?? '无法加载指标');
      }
    } catch (error) {
      setMeta(null);
      setMetaError(String(error));
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !card?.id) return;
    void reloadMeta(card.id);
    setIsEditingTags(false);
    setSaveTagsError(null);
  }, [isOpen, card?.id, metaNonce, reloadMeta]);

  useEffect(() => {
    if (!meta || isEditingTags) return;
    const userTagIds = meta.tags.filter((t) => t.scope === 'user').map((t) => t.id);
    setSelectedTagIds(userTagIds);
  }, [meta, isEditingTags]);

  const visibleTags = useMemo(() => {
    if (!meta?.tags) return [];
    return meta.tags;
  }, [meta?.tags]);

  const formatSignedDelta = (value: number) => (value >= 0 ? `+${value}` : String(value));

  const openTagEditor = useCallback(async () => {
    if (!isOwner) return;
    setIsEditingTags(true);
    setSaveTagsError(null);
    if (allTags.length > 0) return;
    setTagsLoading(true);
    setTagsError(null);
    try {
      const json = await fetchJson<ApiTagsResponse>('/api/tags', { method: 'GET' });
      if (json && (json as any).success === true) {
        setAllTags((json as any).tags ?? []);
      } else {
        setTagsError((json as any)?.error ?? '无法加载标签库');
      }
    } catch (error) {
      setTagsError(String(error));
    } finally {
      setTagsLoading(false);
    }
  }, [allTags.length, isOwner]);

  const selectableTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    return allTags
      .filter((t) => t.isActive && t.scope === 'user')
      .filter((t) => {
        if (!q) return true;
        return (t.name ?? '').toLowerCase().includes(q) || (t.category ?? '').toLowerCase().includes(q);
      });
  }, [allTags, tagSearch]);

  const selectedTagCount = selectedTagIds.length;
  const isTagLimitReached = selectedTagCount >= 30;

  const toggleSelectTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) => {
      if (prev.includes(tagId)) return prev.filter((id) => id !== tagId);
      if (prev.length >= 30) return prev;
      return [...prev, tagId];
    });
  }, []);

  const saveTags = useCallback(async () => {
    if (!isOwner) return;
    setSavingTags(true);
    setSaveTagsError(null);
    try {
      const authHeader = await authStorage.getAuthHeader();
      if (!authHeader) {
        setSaveTagsError('未登录，无法保存标签');
        return;
      }

      await fetchJson('/api/data-card-tags', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({ dataCardId: card.id, tagIds: selectedTagIds }),
      });

      setIsEditingTags(false);
      setMetaNonce((n) => n + 1);
    } catch (error) {
      setSaveTagsError(String(error));
    } finally {
      setSavingTags(false);
    }
  }, [card.id, isOwner, selectedTagIds]);

  if (!isOpen) return null;

  let parsedData: any = {};
  try {
    parsedData = JSON.parse(card.data);
  } catch (error) {
    console.error('解析数据卡内容失败:', error);
  }

  // 递归渲染对象内容
  const renderObjectContent = (obj: any, level: number = 0): React.ReactNode => {
    if (typeof obj === 'string') {
      if (!obj.trim()) return <span className="text-gray-500">（空）</span>;

      return (
        <MarkdownBlock
          content={obj}
          variant="light"
          className="text-sm"
        />
      );
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
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
            // 跳过问卷答案字段
            if (key === 'userAnswers') return null;

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
            <div
              className={`p-2 mt-1 rounded-lg ${
                card.type === 'character' ? 'bg-pink-100' : card.type === 'scenario' ? 'bg-purple-100' : 'bg-emerald-100'
              }`}
            >
              <Info
                className={`w-5 h-5 ${
                  card.type === 'character'
                    ? 'text-pink-600'
                    : card.type === 'scenario'
                      ? 'text-purple-600'
                      : 'text-emerald-700'
                }`}
              />
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
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{card.likeCount ?? 0}</span>
                <span className="flex items-center gap-1"><Star className="w-3 h-3" />{card.favoriteCount ?? 0}</span>
                <span className="flex items-center gap-1"><Download className="w-3 h-3" />{card.usageCount ?? 0}</span>
              </div>
              <div className="flex items-center gap-4 mt-2 text-[11px] text-gray-500">
                <span>创建：{formatDateTime(card.createdAt)}</span>
                <span>更新：{formatDateTime(card.updatedAt)}</span>
              </div>

              <div className="mt-2 text-[11px] text-gray-600 space-y-1">
                {metaLoading ? (
                  <div className="text-gray-500">正在加载技术值/标签/排位...</div>
                ) : metaError ? (
                  <div className="text-red-600">指标加载失败：{metaError}</div>
                ) : meta ? (
                  <>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>
                        技术值：{meta.metrics ? `${meta.metrics.techScore}（${meta.metrics.techLevel}）` : '—'}
                        {meta.metrics?.isStale ? <span className="ml-1 text-amber-700">（已触发重算）</span> : null}
                      </span>
                      <a
                        href="/encyclopedia/tech-index"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        了解技术值
                      </a>
                      <span>
                        原生：{meta.metrics?.isNative == null ? '未知' : meta.metrics.isNative ? '是' : '否'}
                      </span>
                      {card.type === 'character' && (
                        <span>
                          排位：
                          {meta.ratings.strict ? (
                            <span
                              title={
                                meta.ratings.strict.lastDelta != null && meta.ratings.strict.lastAppliedAt
                                  ? `最近变动：Δ${formatSignedDelta(meta.ratings.strict.lastDelta)} @ ${formatDateTime(meta.ratings.strict.lastAppliedAt)}`
                                  : undefined
                              }
                            >
                              strict {meta.ratings.strict.rating}（{meta.ratings.strict.tier}
                              {meta.ratings.strict.lastDelta != null ? `，Δ${formatSignedDelta(meta.ratings.strict.lastDelta)}` : ''}
                              {isOwner && meta.ratings.strict.publicRank != null ? `，公共#${meta.ratings.strict.publicRank}` : ''}
                              ）
                            </span>
                          ) : (
                            'strict —'
                          )}
                          {' / '}
                          {meta.ratings.free ? (
                            <span
                              title={
                                meta.ratings.free.lastDelta != null && meta.ratings.free.lastAppliedAt
                                  ? `最近变动：Δ${formatSignedDelta(meta.ratings.free.lastDelta)} @ ${formatDateTime(meta.ratings.free.lastAppliedAt)}`
                                  : undefined
                              }
                            >
                              free {meta.ratings.free.rating}（{meta.ratings.free.tier}
                              {meta.ratings.free.lastDelta != null ? `，Δ${formatSignedDelta(meta.ratings.free.lastDelta)}` : ''}
                              {isOwner && meta.ratings.free.publicRank != null ? `，公共#${meta.ratings.free.publicRank}` : ''}
                              ）
                            </span>
                          ) : (
                            'free —'
                          )}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-gray-500">标签：</span>
                      {visibleTags.length === 0 ? (
                        <span className="text-gray-400">暂无</span>
                      ) : (
                        visibleTags.map((tag) => (
                          <span
                            key={tag.id}
                            className="px-2 py-0.5 rounded-full border border-gray-200 bg-white text-gray-700"
                            title={tag.description ?? undefined}
                          >
                            {tag.name}
                          </span>
                        ))
                      )}
                      {isOwner && (
                        <button
                          onClick={() => void openTagEditor()}
                          className="ml-1 px-2 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                        >
                          编辑
                        </button>
                      )}
                      <a
                        href="/encyclopedia/tags"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1 text-blue-600 hover:underline"
                      >
                        了解标签
                      </a>
                    </div>

                    {isEditingTags && (
                      <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="text-xs font-medium text-gray-700">
                            选择标签（最多 30 个，当前 {selectedTagCount}）
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setIsEditingTags(false);
                                setSaveTagsError(null);
                              }}
                              className="px-2 py-1 text-xs rounded border border-gray-200 bg-white hover:bg-gray-100"
                              disabled={savingTags}
                            >
                              取消
                            </button>
                            <button
                              onClick={() => void saveTags()}
                              className="px-2 py-1 text-xs rounded bg-purple-600 text-white hover:bg-purple-700 disabled:bg-purple-300"
                              disabled={savingTags}
                            >
                              {savingTags ? '保存中...' : '保存'}
                            </button>
                          </div>
                        </div>

                        {saveTagsError && (
                          <div className="mt-2 text-xs text-red-600">保存失败：{saveTagsError}</div>
                        )}

                        <input
                          value={tagSearch}
                          onChange={(e) => setTagSearch(e.target.value)}
                          placeholder="搜索标签..."
                          className="input-field mt-2 w-full"
                        />

                        {tagsLoading ? (
                          <div className="mt-2 text-xs text-gray-500">正在加载标签库...</div>
                        ) : tagsError ? (
                          <div className="mt-2 text-xs text-red-600">标签库加载失败：{tagsError}</div>
                        ) : (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selectableTags.map((tag) => {
                              const selected = selectedTagIds.includes(tag.id);
                              const disabled = !selected && isTagLimitReached;
                              return (
                                <button
                                  key={tag.id}
                                  onClick={() => toggleSelectTag(tag.id)}
                                  disabled={disabled}
                                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                                    selected
                                      ? 'bg-purple-600 text-white border-purple-600'
                                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                                  } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                  title={tag.description ?? undefined}
                                >
                                  {tag.name}
                                </button>
                              );
                            })}

                            {selectableTags.length === 0 && (
                              <div className="text-xs text-gray-500">没有匹配的标签</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
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
          <div className="mb-3 space-y-2">
            {pendingNotice && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm px-3 py-2">
                {pendingNotice}
              </div>
            )}
            <h3 className="font-medium text-gray-700 flex items-center gap-2">
              <span>{card.type === 'history' ? '内容' : '详细设定'}</span>
            </h3>
          </div>

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
