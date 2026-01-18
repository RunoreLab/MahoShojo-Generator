import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Info, Star, Heart, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { getFieldDisplayName } from '@/lib/fieldTranslations';
import { formatDateTime } from '@/lib/constants';
import { authStorage } from '@/lib/auth';
import { TierBadge } from '@/components/ranking/TierBadge';
import { buildTitleDisplay } from '@/lib/text';

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
  publicTotal: number | null;
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

const META_EXPANDED_STORAGE_KEY = 'mahoshojo.data-card-details.meta-expanded.v1';

interface DataCardDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isOwner?: boolean;
  adminTagEditor?: boolean;
  metaCardId?: string | null;
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
  metaCardId,
  isOwner = false,
  adminTagEditor = false,
}: DataCardDetailsModalProps) {
  const canEditTags = isOwner || adminTagEditor;
  const [tagScope, setTagScope] = useState<'user' | 'system' | 'admin'>(adminTagEditor ? 'admin' : 'user');
  const [metaNonce, setMetaNonce] = useState(0);
  const [meta, setMeta] = useState<Extract<ApiMetaResponse, { success: true }> | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const metaRequestIdRef = useRef(0);
  const metaAbortRef = useRef<AbortController | null>(null);

  const [isEditingTags, setIsEditingTags] = useState(false);
  const [allTags, setAllTags] = useState<ApiTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [tagSearch, setTagSearch] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);
  const [saveTagsError, setSaveTagsError] = useState<string | null>(null);
  const [isMetaExpanded, setIsMetaExpanded] = useState(true);
  const { display: displayName, full: fullName } = buildTitleDisplay(card.name || '未命名');

  const reloadMeta = useCallback(async (dataCardId: string) => {
    const requestId = (metaRequestIdRef.current += 1);
    metaAbortRef.current?.abort();
    const controller = new AbortController();
    metaAbortRef.current = controller;

    setMetaLoading(true);
    setMetaError(null);
    setMeta(null);
    try {
      const authHeader = await authStorage.getAuthHeader();
      if (controller.signal.aborted || requestId !== metaRequestIdRef.current) return;
      const headers: HeadersInit = authHeader ? { Authorization: authHeader } : {};
      const json = await fetchJson<ApiMetaResponse>(`/api/data-card-meta?dataCardId=${encodeURIComponent(dataCardId)}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      if (controller.signal.aborted || requestId !== metaRequestIdRef.current) return;
      if (json && (json as any).success === true) {
        setMeta(json as Extract<ApiMetaResponse, { success: true }>);
      } else {
        setMeta(null);
        setMetaError((json as any)?.error ?? '无法加载指标');
      }
    } catch (error) {
      if (controller.signal.aborted || requestId !== metaRequestIdRef.current) return;
      setMeta(null);
      setMetaError(String(error));
    } finally {
      if (controller.signal.aborted || requestId !== metaRequestIdRef.current) return;
      setMetaLoading(false);
    }
  }, []);

  const resolvedMetaCardId = metaCardId === undefined ? card?.id : metaCardId;

  useEffect(() => {
    if (!isOpen) return;
    if (!resolvedMetaCardId) {
      metaAbortRef.current?.abort();
      setMeta(null);
      setMetaError(null);
      setMetaLoading(false);
      setIsEditingTags(false);
      setSaveTagsError(null);
      return;
    }
    void reloadMeta(resolvedMetaCardId);
    setIsEditingTags(false);
    setSaveTagsError(null);
  }, [isOpen, metaNonce, reloadMeta, resolvedMetaCardId]);

  useEffect(() => {
    if (!isOpen) return;
    if (typeof window === 'undefined') return;
    let nextExpanded: boolean | null = null;
    try {
      const stored = window.localStorage.getItem(META_EXPANDED_STORAGE_KEY);
      if (stored === '1' || stored === '0') {
        nextExpanded = stored === '1';
      }
    } catch {
      nextExpanded = null;
    }
    if (nextExpanded == null) {
      nextExpanded = window.innerWidth >= 768;
    }
    setIsMetaExpanded(nextExpanded);
  }, [isOpen]);

  useEffect(() => {
    return () => metaAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!meta || isEditingTags) return;
    setSelectedTagIds(meta.tags.filter((t) => t.scope === tagScope).map((t) => t.id));
  }, [meta, isEditingTags, tagScope]);

  const visibleTags = useMemo(() => {
    if (!meta?.tags) return [];
    return meta.tags;
  }, [meta?.tags]);

  const metaSummary = useMemo(() => {
    if (metaLoading) return '指标加载中...';
    if (metaError) return '指标加载失败';
    if (!meta) return '暂无指标';
    const parts: string[] = [];
    if (meta.metrics) {
      parts.push(`技术值 ${meta.metrics.techScore}${meta.metrics.techLevel ? `/${meta.metrics.techLevel}` : ''}`);
    } else {
      parts.push('技术值 —');
    }
    if (card.type === 'character') {
      const strictRating = meta.ratings.strict?.rating ?? '—';
      const freeRating = meta.ratings.free?.rating ?? '—';
      parts.push(`排位 严格${strictRating} / 自由${freeRating}`);
    }
    parts.push(`标签 ${visibleTags.length}`);
    return parts.join(' · ');
  }, [card.type, meta, metaError, metaLoading, visibleTags.length]);

  const formatSignedDelta = (value: number) => (value >= 0 ? `+${value}` : String(value));

  const openTagEditor = useCallback(async () => {
    if (!canEditTags) return;
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
  }, [allTags.length, canEditTags]);

  const selectableTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase();
    return allTags
      .filter((t) => t.isActive && t.scope === tagScope)
      .filter((t) => {
        if (!q) return true;
        return (t.name ?? '').toLowerCase().includes(q) || (t.category ?? '').toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) => {
        const category = (a.category ?? '').localeCompare(b.category ?? '', 'zh-CN');
        if (category !== 0) return category;
        return a.name.localeCompare(b.name, 'zh-CN');
      });
  }, [allTags, tagScope, tagSearch]);

  const groupedSelectableTags = useMemo(() => {
    const map = new Map<string, ApiTag[]>();
    for (const tag of selectableTags) {
      const key = tag.category ?? '未分类';
      const list = map.get(key) ?? [];
      list.push(tag);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'zh-CN'));
  }, [selectableTags]);

  const selectedTagCount = selectedTagIds.length;
  const isTagLimitReached = selectedTagCount >= 30;
  const showMetaDetails = isMetaExpanded || isEditingTags;

  const toggleMetaExpanded = useCallback(() => {
    if (isEditingTags) return;
    setIsMetaExpanded((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(META_EXPANDED_STORAGE_KEY, next ? '1' : '0');
        } catch {
          // ignore storage errors
        }
      }
      return next;
    });
  }, [isEditingTags]);

  const toggleSelectTag = useCallback((tagId: string) => {
    setSelectedTagIds((prev) => {
      if (prev.includes(tagId)) return prev.filter((id) => id !== tagId);
      if (prev.length >= 30) return prev;
      return [...prev, tagId];
    });
  }, []);

  const saveTags = useCallback(async () => {
    setSavingTags(true);
    setSaveTagsError(null);
    try {
      if (tagScope === 'user') {
        if (!isOwner) {
          setSaveTagsError('无权修改用户标签');
          return;
        }

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
      } else {
        if (!adminTagEditor) {
          setSaveTagsError('无权修改管理员/系统标签');
          return;
        }

        await fetchJson('/api/admin/data-card-tags', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ dataCardId: card.id, scope: tagScope, tagIds: selectedTagIds }),
        });
      }

      setIsEditingTags(false);
      setMetaNonce((n) => n + 1);
    } catch (error) {
      setSaveTagsError(String(error));
    } finally {
      setSavingTags(false);
    }
  }, [adminTagEditor, card.id, isOwner, selectedTagIds, tagScope]);

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
              <h2 className="text-xl font-bold text-gray-800" title={fullName}>
                {displayName}
              </h2>
              <p className="text-sm text-gray-500">
                {card.description}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                作者：{card.author}
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{card.likeCount ?? 0}</span>
                <span className="flex items-center gap-1"><Star className="w-3 h-3" />{card.favoriteCount ?? 0}</span>
                <span className="flex items-center gap-1"><Download className="w-3 h-3" />{card.usageCount ?? 0}</span>
              </div>
              <div className="flex flex-wrap items-center gap-4 mt-1 text-[11px] text-gray-500">
                <span>创建：{formatDateTime(card.createdAt)}</span>
                <span>更新：{formatDateTime(card.updatedAt)}</span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                <button
                  type="button"
                  onClick={toggleMetaExpanded}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                  aria-expanded={showMetaDetails}
                  disabled={isEditingTags}
                >
                  {showMetaDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  <span>{showMetaDetails ? '收起信息' : '展开信息'}</span>
                </button>
                {!showMetaDetails && (
                  <span className="text-gray-500">{metaSummary}</span>
                )}
              </div>

              {showMetaDetails && (
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
                                严格 {meta.ratings.strict.rating}（
                                <TierBadge tier={meta.ratings.strict.tier} className="mx-1 align-middle" />
                                {meta.ratings.strict.lastDelta != null ? (
                                  <span>，Δ{formatSignedDelta(meta.ratings.strict.lastDelta)}</span>
                                ) : null}
                                {meta.ratings.strict.publicRank != null ? (
                                  <span>
                                    ，公共排名#{meta.ratings.strict.publicRank}
                                    {meta.ratings.strict.publicTotal != null ? `/${meta.ratings.strict.publicTotal}` : ''}
                                  </span>
                                ) : null}
                                ）
                              </span>
                            ) : (
                              '严格 —'
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
                                自由 {meta.ratings.free.rating}（
                                <TierBadge tier={meta.ratings.free.tier} className="mx-1 align-middle" />
                                {meta.ratings.free.lastDelta != null ? (
                                  <span>，Δ{formatSignedDelta(meta.ratings.free.lastDelta)}</span>
                                ) : null}
                                {meta.ratings.free.publicRank != null ? (
                                  <span>
                                    ，公共排名#{meta.ratings.free.publicRank}
                                    {meta.ratings.free.publicTotal != null ? `/${meta.ratings.free.publicTotal}` : ''}
                                  </span>
                                ) : null}
                                ）
                              </span>
                            ) : (
                              '自由 —'
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
                        {canEditTags && (
                          <button
                            onClick={() => void openTagEditor()}
                            className="ml-1 px-2 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                          >
                            {adminTagEditor ? '编辑（管理员/系统）' : '编辑'}
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
                            {adminTagEditor && (
                              <select
                                value={tagScope}
                                onChange={(e) => {
                                  const nextScope = (e.target.value === 'system' ? 'system' : 'admin') as 'system' | 'admin';
                                  setTagScope(nextScope);
                                  setTagSearch('');
                                  setSelectedTagIds(meta ? meta.tags.filter((t) => t.scope === nextScope).map((t) => t.id) : []);
                                }}
                                className="px-2 py-1 text-xs rounded border border-gray-200 bg-white"
                                disabled={savingTags}
                              >
                                <option value="admin">管理员标签</option>
                                <option value="system">系统标签</option>
                              </select>
                            )}
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
                            <div className="mt-2 max-h-64 overflow-auto pr-1 space-y-3">
                              {groupedSelectableTags.map(([category, categoryTags]) => (
                                <div key={category}>
                                  <div className="text-[11px] font-medium text-gray-600">
                                    {category}（{categoryTags.length}）
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {categoryTags.map((tag) => {
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
                                  </div>
                                </div>
                              ))}

                              {groupedSelectableTags.length === 0 && (
                                <div className="text-xs text-gray-500">没有匹配的标签</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                  </>
                ) : null}
              </div>
            )}
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
