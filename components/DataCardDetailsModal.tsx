import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Info, Star, Heart, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { MarkdownBlock } from '@/components/MarkdownBlock';
import { getFieldDisplayName } from '@/lib/fieldTranslations';
import { formatDateTime } from '@/lib/constants';
import { authStorage } from '@/lib/auth';
import { upsertArenaRankCacheFromMeta } from '@/lib/arena/rank-cache';
import { TierBadge } from '@/components/ranking/TierBadge';
import { buildTitleDisplay } from '@/lib/text';
import {
  extractDataCardVisualAssets,
  type DataCardVisualAssetKind,
  type DataCardVisualAssetSourceType,
} from '@/lib/data-card-visual-assets';
import { buildDataCardReviewDiff } from '@/lib/data-card-review-diff';

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
  seasonPeak: ApiRatingSeasonExtreme | null;
  seasonPeakTier: string | null;
  seasonLow: ApiRatingSeasonExtreme | null;
};

type ApiRatingSeasonExtreme = {
  rating: number;
  games: number;
  occurredAt: string;
  tier: string;
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

export function StrictSeasonExtremaBlock({ strict }: { strict: ApiRating }) {
  const peak = strict.seasonPeak;
  const low = strict.seasonLow;
  const peakTier = strict.seasonPeakTier;

  if (!peak && !low && !peakTier) return null;

  return (
    <div className="flex flex-col gap-1 text-[11px] text-gray-600">
      {peak && (
        <div className="flex flex-wrap items-center gap-1">
          <span>
            赛季最高 {peak.rating}（
            <TierBadge tier={peak.tier} className="mx-1 align-middle" />
            ）
          </span>
          <span className="text-[10px] text-gray-400" title={peak.occurredAt}>
            {formatDateTime(peak.occurredAt)}
          </span>
        </div>
      )}
      {low && (
        <div className="flex flex-wrap items-center gap-1">
          <span>
            赛季最低 {low.rating}（
            <TierBadge tier={low.tier} className="mx-1 align-middle" />
            ）
          </span>
          <span className="text-[10px] text-gray-400" title={low.occurredAt}>
            {formatDateTime(low.occurredAt)}
          </span>
        </div>
      )}
      {peakTier && (
        <div>
          赛季最高段位 <TierBadge tier={peakTier} className="mx-1 align-middle" />
        </div>
      )}
    </div>
  );
}

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json;
};

const META_EXPANDED_STORAGE_KEY = 'mahoshojo.data-card-details.meta-expanded.v1';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value: string) => UUID_PATTERN.test(value.trim());

const sanitizeDownloadFilename = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '数据卡';
  return trimmed.replace(/[\\/:*?"<>|\n\r\t]/g, '_');
};

const formatBytes = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '大小未知';
  const units = ['B', 'KB', 'MB', 'GB'];
  let current = value;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const getVisualAssetKindLabel = (kind: DataCardVisualAssetKind): string => {
  if (kind === 'portrait') return '立绘';
  if (kind === 'illustration') return '插图';
  if (kind === 'avatar') return '头像';
  return '图片';
};

const getVisualAssetSourceTypeLabel = (sourceType: DataCardVisualAssetSourceType): string => {
  if (sourceType === 'dataUrl') return '内嵌 data URL';
  if (sourceType === 'remote') return '远程 URL';
  return '本地/相对路径';
};

const getDiffBadgeClass = (changeType: 'added' | 'removed' | 'changed'): string => {
  if (changeType === 'added') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (changeType === 'removed') return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
};

const getDiffLabel = (changeType: 'added' | 'removed' | 'changed'): string => {
  if (changeType === 'added') return '新增';
  if (changeType === 'removed') return '删除';
  return '修改';
};

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
    type: 'character' | 'scenario' | 'history' | 'questionnaire';
    data: string; // JSON字符串
    isPublic: boolean;
    usageCount?: number;
    likeCount?: number;
    favoriteCount?: number;
    author?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  compareCard?: {
    name: string;
    description: string;
    data: string;
    updatedAt?: string;
  } | null;
  pendingNotice?: string;
}

export default function DataCardDetailsModal({
  isOpen,
  onClose,
  card,
  compareCard = null,
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
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [assetDimensions, setAssetDimensions] = useState<Record<string, { width: number; height: number }>>({});

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
  const cardTypeLabel =
    card.type === 'character'
      ? '角色'
      : card.type === 'scenario'
        ? '剧本'
        : card.type === 'history'
          ? '历史'
          : '问卷';
  const descriptionText = card.description?.trim() ? card.description : '暂无简介';
  const tagSectionRef = useRef<HTMLDivElement | null>(null);
  const tagSearchInputRef = useRef<HTMLInputElement | null>(null);

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
  const resolvedCloudCardId = typeof resolvedMetaCardId === 'string' ? resolvedMetaCardId.trim() : '';
  const isCloudDataCard = Boolean(resolvedCloudCardId) && isUuid(resolvedCloudCardId);
  const canDownloadCard = isCloudDataCard ? (Boolean(meta) || isOwner) : true;

  useEffect(() => {
    if (!isCloudDataCard) return;
    if (!meta) return;
    if (card.type !== 'character') return;

    const entityId = resolvedCloudCardId;
    const strict = meta.ratings.strict;
    if (strict) {
      upsertArenaRankCacheFromMeta({
        entityType: 'data_card',
        entityId,
        queue: 'strict',
        rating: typeof strict.rating === 'number' ? strict.rating : null,
        games: typeof strict.games === 'number' ? strict.games : null,
        tier: typeof strict.tier === 'string' ? strict.tier : null,
      });
    }

    const free = meta.ratings.free;
    if (free) {
      upsertArenaRankCacheFromMeta({
        entityType: 'data_card',
        entityId,
        queue: 'free',
        rating: typeof free.rating === 'number' ? free.rating : null,
        games: typeof free.games === 'number' ? free.games : null,
        tier: typeof free.tier === 'string' ? free.tier : null,
      });
    }
  }, [card.type, isCloudDataCard, meta, resolvedCloudCardId]);

  useEffect(() => {
    if (!isOpen) return;
    if (!resolvedMetaCardId) {
      metaAbortRef.current?.abort();
      setMeta(null);
      setMetaError(null);
      setMetaLoading(false);
      setIsEditingTags(false);
      setSaveTagsError(null);
      setDownloadError(null);
      return;
    }
    void reloadMeta(resolvedMetaCardId);
    setIsEditingTags(false);
    setSaveTagsError(null);
    setDownloadError(null);
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

  useEffect(() => {
    if (!isOpen || !isEditingTags) return;
    const prefersReducedMotion = typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (tagSectionRef.current) {
      tagSectionRef.current.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    }
    if (tagSearchInputRef.current) {
      const focusInput = () => tagSearchInputRef.current?.focus();
      if (typeof window !== 'undefined' && window.requestAnimationFrame) {
        window.requestAnimationFrame(focusInput);
      } else {
        focusInput();
      }
    }
  }, [isEditingTags, isOpen]);

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

  const downloadDataCard = useCallback(() => {
    if (!canDownloadCard) return;

    setDownloadError(null);
    try {
      const payload = JSON.parse(card.data);
      const jsonString = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `${sanitizeDownloadFilename(card.name || '数据卡')}.json`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('下载数据卡失败:', error);
      setDownloadError('下载失败：数据卡内容不是有效的 JSON');
    }
  }, [canDownloadCard, card.data, card.name]);

  const saveTags = useCallback(async () => {
    setSavingTags(true);
    setSaveTagsError(null);
    try {
      if (tagScope === 'user') {
        if (!isOwner) {
          setSaveTagsError('无权修改用户标签');
          return;
        }

        await fetchJson('/api/data-card-tags', await authStorage.buildAuthenticatedRequestInit({
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ dataCardId: card.id, tagIds: selectedTagIds }),
        }));
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

  const parsedData = useMemo(() => {
    try {
      return JSON.parse(card.data) as Record<string, unknown>;
    } catch (error) {
      console.error('解析数据卡内容失败:', error);
      return {};
    }
  }, [card.data]);

  const visualAssets = useMemo(() => extractDataCardVisualAssets(parsedData), [parsedData]);
  const reviewDiff = useMemo(() => {
    if (!compareCard) return null;
    return buildDataCardReviewDiff({
      originalName: compareCard.name,
      originalDescription: compareCard.description,
      originalData: compareCard.data,
      updatedName: card.name,
      updatedDescription: card.description,
      updatedData: card.data,
    });
  }, [card.data, card.description, card.name, compareCard]);

  useEffect(() => {
    if (!isOpen) return;
    setAssetDimensions({});
  }, [card.id, card.data, isOpen]);

  if (!isOpen) return null;

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
          <div className="flex items-center gap-3">
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
              <p className="text-xs text-gray-500 mt-1">类型：{cardTypeLabel}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-2 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {pendingNotice && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm px-3 py-2">
              {pendingNotice}
            </div>
          )}

          {reviewDiff && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="font-medium text-gray-700 flex items-center gap-2">
                  <span>待审更新差异</span>
                </h3>
                <div className="text-xs text-gray-500">
                  共 {reviewDiff.total} 处变化
                  {compareCard?.updatedAt ? ` · 原版更新于 ${formatDateTime(compareCard.updatedAt)}` : ''}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                  修改 {reviewDiff.changed}
                </span>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">
                  新增 {reviewDiff.added}
                </span>
                <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">
                  删除 {reviewDiff.removed}
                </span>
              </div>

              {reviewDiff.total > 0 ? (
                <div className="max-h-96 space-y-3 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3">
                  {reviewDiff.entries.map((entry) => (
                    <div key={`${entry.changeType}:${entry.path}`} className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${getDiffBadgeClass(entry.changeType)}`}>
                          {getDiffLabel(entry.changeType)}
                        </span>
                        <span className="text-sm font-medium text-gray-800">{entry.fieldLabel}</span>
                        <code className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{entry.path}</code>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">原版</div>
                          <pre className="whitespace-pre-wrap break-words text-xs text-gray-700">{entry.beforeValue}</pre>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">待审版</div>
                          <pre className="whitespace-pre-wrap break-words text-xs text-gray-700">{entry.afterValue}</pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                  当前待审版本与线上版本没有检测到结构化差异。若仅修改了不可见字段，可继续在下方完整内容中复核。
                </div>
              )}
            </section>
          )}

          <section className="space-y-2">
            <h3 className="font-medium text-gray-700 flex items-center gap-2">
              <span>概览</span>
            </h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">
              {descriptionText}
            </p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><Heart className="w-3 h-3" />{card.likeCount ?? 0}</span>
              <span className="flex items-center gap-1"><Star className="w-3 h-3" />{card.favoriteCount ?? 0}</span>
              <span className="flex items-center gap-1"><Download className="w-3 h-3" />{card.usageCount ?? 0}</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-gray-500">
              <span>作者：{card.author ?? '未知'}</span>
              <span>创建：{formatDateTime(card.createdAt)}</span>
              <span>更新：{formatDateTime(card.updatedAt)}</span>
            </div>
          </section>

          <section className="space-y-2" ref={tagSectionRef}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="font-medium text-gray-700 flex items-center gap-2">
                <span>技术与标签</span>
              </h3>
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
            </div>

            {!showMetaDetails && (
              <div className="text-[11px] text-gray-500">{metaSummary}</div>
            )}

            {showMetaDetails && (
              <div className="text-[11px] text-gray-600 space-y-2">
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
                        <div className="flex flex-col gap-1">
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
                                ）
                              </span>
                            ) : (
                              '自由 —'
                            )}
                          </span>
                          {meta.ratings.strict && <StrictSeasonExtremaBlock strict={meta.ratings.strict} />}
                        </div>
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
                          ref={tagSearchInputRef}
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
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="font-medium text-gray-700 flex items-center gap-2">
                <span>视觉资产</span>
              </h3>
              <div className="text-xs text-gray-500">
                {visualAssets.length > 0 ? `共检测到 ${visualAssets.length} 个图片资源` : '未检测到图片资源'}
              </div>
            </div>

            {visualAssets.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {visualAssets.map((asset) => {
                  const dimensions = assetDimensions[asset.id];
                  return (
                    <div key={asset.id} className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                      <div className="aspect-[4/3] bg-gray-100">
                        <img
                          src={asset.previewUrl}
                          alt={`${card.name} ${asset.keyPath}`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          onLoad={(event) => {
                            const target = event.currentTarget;
                            if (!target.naturalWidth || !target.naturalHeight) return;
                            setAssetDimensions((prev) => {
                              const current = prev[asset.id];
                              if (current?.width === target.naturalWidth && current?.height === target.naturalHeight) {
                                return prev;
                              }
                              return {
                                ...prev,
                                [asset.id]: { width: target.naturalWidth, height: target.naturalHeight },
                              };
                            });
                          }}
                        />
                      </div>
                      <div className="space-y-2 p-3 text-xs text-gray-600">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-0.5 text-fuchsia-700">
                            {getVisualAssetKindLabel(asset.kind)}
                          </span>
                          <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-gray-700">
                            {getVisualAssetSourceTypeLabel(asset.sourceType)}
                          </span>
                          {asset.mimeType ? (
                            <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-gray-700">
                              {asset.mimeType}
                            </span>
                          ) : null}
                        </div>
                        <div>
                          <span className="font-medium text-gray-700">字段路径：</span>
                          <code className="break-all rounded bg-white px-1 py-0.5 text-[11px] text-gray-700">{asset.keyPath}</code>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          <span>预估大小：{formatBytes(asset.approxBytes)}</span>
                          {dimensions ? <span>尺寸：{dimensions.width} × {dimensions.height}</span> : null}
                        </div>
                        <div className="space-y-1">
                          <div className="font-medium text-gray-700">源地址</div>
                          <code className="block break-all rounded bg-white px-2 py-1 text-[11px] text-gray-700">{asset.sourceUrl}</code>
                        </div>
                        {asset.previewUrl !== asset.sourceUrl ? (
                          <div className="space-y-1">
                            <div className="font-medium text-gray-700">预览代理</div>
                            <code className="block break-all rounded bg-white px-2 py-1 text-[11px] text-gray-700">{asset.previewUrl}</code>
                          </div>
                        ) : null}
                        <div>
                          <a
                            href={asset.previewUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            在新标签页中打开
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                当前数据卡中没有识别到可预览的图片字段。若该卡使用了非常规协议字段，仍可在下方 JSON 详情中手动检查。
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="font-medium text-gray-700 flex items-center gap-2">
              <span>{card.type === 'history' ? '内容' : '详细设定'}</span>
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
          </section>
        </div>

        {/* 底部 */}
        <div className="p-6 border-t bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
          <div className="min-h-[18px]">
            {downloadError && (
              <div className="text-xs text-red-600">{downloadError}</div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={downloadDataCard}
              disabled={!canDownloadCard}
              className={`px-4 py-2 rounded-lg transition-colors inline-flex items-center gap-2 ${
                canDownloadCard
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-blue-200 text-blue-50 cursor-not-allowed'
              }`}
              title={
                canDownloadCard
                  ? isCloudDataCard
                    ? '下载云端数据卡 JSON'
                    : '下载本地/预设数据卡 JSON'
                  : metaLoading
                    ? '正在校验权限...'
                    : metaError
                      ? '无权下载该数据卡'
                      : '暂不可下载'
              }
            >
              <Download className="w-4 h-4" />
              <span>
                {isCloudDataCard && metaLoading && !canDownloadCard
                  ? '校验中...'
                  : canDownloadCard
                    ? '下载'
                    : '不可下载'}
              </span>
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
