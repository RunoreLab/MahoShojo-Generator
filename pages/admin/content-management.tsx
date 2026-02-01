// pages/admin/content-management.tsx

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { debounce } from '@/lib/debounce';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import { AdminTableScroll } from '@/components/admin/AdminTableScroll';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';

// 定义数据卡类型接口
interface DataCard {
  id: string;
  name: string;
  description: string;
  data: string; // 确保 data 字段存在
  type: 'character' | 'scenario' | 'history' | 'questionnaire';
  is_public: -1 | 0 | 1;
  review_status: 'pending' | 'approved' | 'rejected';
  username: string;
  like_count: number;
  usage_count: number;
  favorite_count: number;
  is_recommended: number;
  created_at: string;
  updated_at: string;
  pending_update_id?: string | null;
  pending_update_name?: string | null;
  pending_update_description?: string | null;
  pending_update_data?: string | null;
  pending_update_created_at?: string | null;
}

interface AiTargetSnapshotItem {
  kind: 'card' | 'update';
  cardId: string;
  updateId?: string;
  name: string;
  description: string;
  data: string;
  originalName?: string;
  originalDescription?: string;
  originalData?: string;
}

// AI审查结果类型
interface AiReviewResult {
    id: string;
    name: string;
    suggestion: 'approved' | 'rejected';
    reason: string;
}

const parseQuestionnaireNativeAllowed = (rawData: string | null | undefined): boolean => {
  if (!rawData) return false;
  try {
    const parsed = JSON.parse(rawData);
    if (parsed && typeof parsed === 'object') {
      return Boolean((parsed as any).nativeAllowed);
    }
  } catch {
    return false;
  }
  return false;
};

const ContentManagementPage: React.FC = () => {
  const router = useRouter();
  const isComposingSearchRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [selectedCardDetails, setSelectedCardDetails] = useState<DataCard | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [detailsPendingNotice, setDetailsPendingNotice] = useState<string | undefined>(undefined);

  const [dataCards, setDataCards] = useState<DataCard[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    page: 1,
    limit: 20,
    search: '',
    reviewStatus: '',
    isPublic: '',
    type: '',
    isRecommended: '',
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);

  // AI 审查相关状态
  const [showAiReviewModal, setShowAiReviewModal] = useState(false);
  const [isAiReviewing, setIsAiReviewing] = useState(false);
  const [aiReviewResults, setAiReviewResults] = useState<AiReviewResult[]>([]);
  const [markedActions, setMarkedActions] = useState<Record<string, 'approve' | 'reject'>>({});
  const [aiBatchSize, setAiBatchSize] = useState(20);
  const [aiModel, setAiModel] = useState('default');
  const [availableAiModels, setAvailableAiModels] = useState<string[]>([]);
  const [availableAiModelsError, setAvailableAiModelsError] = useState<string | null>(null);
  const [externalReviewContent, setExternalReviewContent] = useState(''); // [新增] 外部审查粘贴内容
  const [copyStatus, setCopyStatus] = useState(''); // [新增] 复制按钮状态
  const [aiTargetSnapshotById, setAiTargetSnapshotById] = useState<Record<string, AiTargetSnapshotItem>>({});
  const [nativeUpdatingId, setNativeUpdatingId] = useState<string | null>(null);

  const aiModelLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const provider of AI_PROVIDER_CATALOG) {
      for (const modelOption of provider.models) {
        if (!map.has(modelOption.value)) map.set(modelOption.value, modelOption.label);
      }
    }
    return map;
  }, []);

  const fallbackAiModels = useMemo(() => {
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const provider of AI_PROVIDER_CATALOG) {
      for (const modelOption of provider.models) {
        if (modelOption.value === 'default') continue;
        if (seen.has(modelOption.value)) continue;
        seen.add(modelOption.value);
        deduped.push(modelOption.value);
      }
    }
    return deduped;
  }, []);

  const resolvedAiModels = useMemo(() => {
    const base = availableAiModels.length > 0 ? availableAiModels : fallbackAiModels;
    if (aiModel !== 'default' && aiModel.trim() && !base.includes(aiModel)) {
      return [aiModel, ...base];
    }
    return base;
  }, [aiModel, availableAiModels, fallbackAiModels]);

  const fetchAvailableAiModels = useCallback(async () => {
    try {
      setAvailableAiModelsError(null);
      const response = await fetch('/api/admin/ai-models');
      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || '获取 AI 模型列表失败');
      }
      const models: unknown = payload?.models;
      if (!Array.isArray(models)) {
        throw new Error('AI 模型列表返回格式异常');
      }
      setAvailableAiModels(
        models
          .filter((item): item is string => {
            if (typeof item !== 'string') return false;
            const trimmed = item.trim();
            return Boolean(trimmed) && trimmed !== 'default';
          })
          .map((item) => item.trim())
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取 AI 模型列表失败';
      setAvailableAiModels([]);
      setAvailableAiModelsError(message);
    }
  }, []);

  useEffect(() => {
    void fetchAvailableAiModels();
  }, [fetchAvailableAiModels]);

  const fetchData = useCallback(async (currentFilters: typeof filters) => {
    setLoading(true);
    setSelectedIds(new Set());
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    try {
      const params = new URLSearchParams({
        page: currentFilters.page.toString(),
        limit: currentFilters.limit.toString(),
        search: currentFilters.search.trim(),
        reviewStatus: currentFilters.reviewStatus,
        isPublic: currentFilters.isPublic,
        type: currentFilters.type,
        isRecommended: currentFilters.isRecommended,
        includePendingUpdates: '1',
      });
      const response = await fetch(`/api/admin/data-cards?${params.toString()}`, { signal: abortController.signal });
      if (!response.ok) throw new Error('获取数据失败');
      const data = await response.json();
      setDataCards(data.cards);
      setTotal(data.total);
    } catch (error) {
      if (abortController.signal.aborted) return;
      console.error(error);
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      if (!abortController.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (router.isReady) {
      const newFilters = {
        page: parseInt(router.query.page as string || '1', 10),
        limit: 20,
        search: router.query.search as string || '',
        reviewStatus: router.query.reviewStatus as string || '',
        isPublic: router.query.isPublic as string || '',
        type: router.query.type as string || '',
        isRecommended: router.query.isRecommended as string || '',
      };
      setFilters(newFilters);
      fetchData(newFilters);
    }
  }, [router.isReady, router.query, fetchData]);

  // useEffect 钩子，用于在 AI 审查结果加载后自动更新操作标记。
  useEffect(() => {
    if (aiReviewResults.length > 0) {
        const newMarkedActions: Record<string, 'approve' | 'reject'> = {};
        aiReviewResults.forEach(result => {
            // 注意: AI 返回的建议可能是 'approved'/'rejected'，
            // 而我们的状态管理使用的是 'approve'/'reject'，这里做一个简单的映射。
            if (result.suggestion === 'approved') {
                newMarkedActions[result.id] = 'approve';
            }
        });
        setMarkedActions(newMarkedActions);
    }
  }, [aiReviewResults]); // 依赖项是 aiReviewResults

  const updateUrl = useCallback((newFilters: typeof filters) => {
      const query: { [key: string]: any } = {};
      if (newFilters.page > 1) query.page = newFilters.page;
      if (newFilters.search.trim()) query.search = newFilters.search.trim();
      if (newFilters.reviewStatus) query.reviewStatus = newFilters.reviewStatus;
      if (newFilters.isPublic) query.isPublic = newFilters.isPublic;
      if (newFilters.type) query.type = newFilters.type;
      if (newFilters.isRecommended) query.isRecommended = newFilters.isRecommended;
      
      router.push({ pathname: router.pathname, query }, undefined, { shallow: true });
  }, [router]);

  const debouncedUpdateUrl = useMemo(() => debounce(updateUrl, 300), [updateUrl]);

  useEffect(() => {
    return () => {
      debouncedUpdateUrl.cancel();
    };
  }, [debouncedUpdateUrl]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const newFilters = { ...filters, [name]: value, page: 1 };
    setFilters(newFilters);
    const isComposing = name === 'search' && (isComposingSearchRef.current || (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing);
    if (isComposing) return;
    debouncedUpdateUrl(newFilters);
  };

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);
  
  const handlePageChange = (newPage: number) => {
    if (newPage > 0 && newPage <= Math.ceil(total / filters.limit)) {
      const newFilters = { ...filters, page: newPage };
      setFilters(newFilters);
      updateUrl(newFilters);
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedIds(e.target.checked ? new Set(dataCards.map(card => card.id)) : new Set());
  };

  const handleSelectOne = (id: string) => {
    const newSelectedIds = new Set(selectedIds);
    if (newSelectedIds.has(id)) {
        newSelectedIds.delete(id);
    } else {
        newSelectedIds.add(id);
    }
    setSelectedIds(newSelectedIds);
  };

  const openDetailsModal = (card: DataCard, pendingNotice?: string) => {
    setSelectedCardDetails(card);
    setDetailsPendingNotice(pendingNotice);
    setIsDetailsModalOpen(true);
  };

  const buildCardFromPendingUpdate = (card: DataCard, variant: 'update' | 'original'): DataCard => {
    if (variant === 'original') return card;
    return {
      ...card,
      name: card.pending_update_name ?? card.name,
      description: card.pending_update_description ?? card.description,
      data: card.pending_update_data ?? card.data,
      updated_at: card.pending_update_created_at ?? card.updated_at,
    };
  };

  const handleViewDetails = (card: DataCard) => {
    if (card.pending_update_id) {
      openDetailsModal(buildCardFromPendingUpdate(card, 'update'), '这是用户提交的更新版本，审核通过后将覆盖线上版本。');
      return;
    }
    openDetailsModal(card);
  };

  const handleViewOriginalDetails = (card: DataCard) => {
    if (!card.pending_update_id) return;
    openDetailsModal(buildCardFromPendingUpdate(card, 'original'), '这是当前线上版本（原版），用于对比参考。');
  };

  const handleViewDetailsFromAiTarget = (targetId: string, variant: 'review' | 'original') => {
    const snapshot = aiTargetSnapshotById[targetId];
    if (!snapshot) return;

    const baseCard = dataCards.find(card => card.id === snapshot.cardId);
    if (!baseCard) {
      alert('当前列表中找不到该卡片数据，请关闭模态框后刷新页面再试。');
      return;
    }

      if (snapshot.kind === 'update') {
        if (variant === 'original') {
          openDetailsModal(
            {
              ...baseCard,
              name: snapshot.originalName ?? baseCard.name,
              description: snapshot.originalDescription ?? baseCard.description,
              data: snapshot.originalData ?? baseCard.data,
            },
            '这是当前线上版本（原版），用于对比参考。'
          );
          return;
        }

        openDetailsModal(
          {
            ...baseCard,
            name: snapshot.name,
            description: snapshot.description,
            data: snapshot.data,
            updated_at: baseCard.pending_update_created_at ?? baseCard.updated_at,
          },
          '这是用户提交的更新版本，审核通过后将覆盖线上版本。'
        );
        return;
      }

    openDetailsModal(
      {
        ...baseCard,
        name: snapshot.name,
        description: snapshot.description,
        data: snapshot.data,
      }
    );
  };

  const handleBatchAction = async (action: string, value?: any) => {
    if (selectedIds.size === 0) return alert('请至少选择一个项目');
    if (!window.confirm(`确定要对选中的 ${selectedIds.size} 个项目执行此操作吗？`)) return;

    try {
      const response = await fetch('/api/admin/data-cards/batch-update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardIds: Array.from(selectedIds), action, value }),
      });
      if (!response.ok) throw new Error('操作失败');
      alert('操作成功！');
      await fetchData(filters);
    } catch (error) {
      alert(`操作失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleToggleQuestionnaireNative = async (card: DataCard, nextAllowed: boolean) => {
    if (nativeUpdatingId) return;
    const confirmText = nextAllowed
      ? '确定要允许该问卷生成原生内容吗？'
      : '确定要取消该问卷的原生许可吗？';
    if (!window.confirm(confirmText)) return;

    setNativeUpdatingId(card.id);
    try {
      const response = await fetch('/api/admin/questionnaire-native', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataCardId: card.id, nativeAllowed: nextAllowed }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || '更新失败');
      }

      const nextData = typeof payload?.data === 'string'
        ? payload.data
        : JSON.stringify({ ...(JSON.parse(card.data) as any), nativeAllowed: nextAllowed });

      setDataCards((prev) => prev.map((item) => (item.id === card.id ? { ...item, data: nextData } : item)));
    } catch (error) {
      alert(`操作失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setNativeUpdatingId(null);
    }
  };

  // 批量导出处理函数
  const handleExport = async () => {
    if (selectedIds.size === 0) {
      alert('请至少选择一个项目进行导出');
      return;
    }
    setIsExporting(true);
    try {
      const response = await fetch('/api/admin/export-data-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardIds: Array.from(selectedIds) }),
      });
      if (!response.ok) throw new Error('导出失败');

      const result = await response.json();
      if (!result.success) throw new Error(result.error || '导出失败');

      // 创建并下载JSON文件
      const jsonData = JSON.stringify(result.data, null, 2);
      const blob = new Blob([jsonData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exported_data_cards_${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (error) {
      alert('导出失败，请查看控制台');
      console.error('导出失败:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleRecomputeMetrics = async () => {
    if (selectedIds.size === 0) return alert('请至少选择一个项目');
    if (!window.confirm(`确定要对选中的 ${selectedIds.size} 个数据卡重算技术值/原生性吗？`)) return;

    try {
      const res = await fetch('/api/admin/data-card-metrics/recompute', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataCardIds: Array.from(selectedIds), force: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || '重算失败');
      }
      alert(`重算完成：processed=${data.processed} skipped=${data.skipped} failed=${data.failed} missing=${data.missing}`);
      await fetchData(filters);
    } catch (error) {
      alert(`重算失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const handleResetArenaRatings = async () => {
    if (selectedIds.size === 0) return alert('请至少选择一个项目');

    const characterIds = dataCards
      .filter((card) => selectedIds.has(card.id) && card.type === 'character')
      .map((card) => card.id);

    if (characterIds.length === 0) {
      alert('选中项中没有角色卡（type=character），无需重置排位。');
      return;
    }

    if (
      !window.confirm(
        `确定要重置选中的 ${characterIds.length} 张角色卡的排位分吗？（将同时重置 strict/free，重置为初始分）`
      )
    ) {
      return;
    }

    try {
      const results = await Promise.allSettled(
        characterIds.map(async (id) => {
          const res = await fetch('/api/admin/arena-ratings/reset', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entityType: 'data_card', entityId: id, queue: 'all' }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.success === false) {
            throw new Error(data.error || `重置失败: ${id}`);
          }
        })
      );

      const failed = results
        .map((r, idx) => ({ r, id: characterIds[idx] }))
        .filter(({ r }) => r.status === 'rejected')
        .map(({ id, r }) => `${id}: ${(r as PromiseRejectedResult).reason instanceof Error ? (r as PromiseRejectedResult).reason.message : String((r as PromiseRejectedResult).reason)}`);

      if (failed.length > 0) {
        alert(`部分重置失败（${failed.length}/${characterIds.length}）：\n${failed.slice(0, 10).join('\n')}${failed.length > 10 ? '\n...' : ''}`);
      } else {
        alert(`重置完成：${characterIds.length} 张角色卡`);
      }

      await fetchData(filters);
    } catch (error) {
      alert(`重置失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const executeBatchReviewUpdates = async (updateIds: string[], action: 'approve' | 'reject') => {
    const res = await fetch('/api/admin/data-card-updates/batch-review', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updateIds, action }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      const failedIds: string[] = Array.isArray(data.failedIds) ? data.failedIds : [];
      return { processed: Number(data.processed || 0), failedIds };
    }
    return { processed: Number(data.processed || updateIds.length), failedIds: [] as string[] };
  };

  const executeBatchUpdateCards = async (cardIds: string[], action: 'approve' | 'reject') => {
    const res = await fetch('/api/admin/data-cards/batch-update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardIds, action }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || '批量更新数据卡失败');
  };

  const handleBatchReviewWithUpdates = async (action: 'approve' | 'reject') => {
    if (selectedIds.size === 0) return alert('请至少选择一个项目');

    const selectedCards = dataCards.filter(card => selectedIds.has(card.id));
    const updateIds = selectedCards
      .map(card => card.pending_update_id)
      .filter((id): id is string => Boolean(id));
    const cardIds = selectedCards
      .filter(card => !card.pending_update_id)
      .map(card => card.id);

    if (
      !window.confirm(
        `即将${action === 'approve' ? '通过' : '拒绝'}：` +
          `${cardIds.length} 条卡片审查、${updateIds.length} 条更新审查。是否继续？`
      )
    ) {
      return;
    }

    try {
      if (updateIds.length > 0) {
        const { processed, failedIds } = await executeBatchReviewUpdates(updateIds, action);
        if (failedIds.length > 0) {
          alert(`更新审查存在部分失败：成功 ${processed - failedIds.length}，失败 ${failedIds.length}。请刷新后重试。`);
          await fetchData(filters);
          return;
        }
      }

      if (cardIds.length > 0) {
        await executeBatchUpdateCards(cardIds, action);
      }

      alert('操作成功！');
      await fetchData(filters);
    } catch (error) {
      alert(`操作失败: ${error instanceof Error ? error.message : '未知错误'}`);
      await fetchData(filters);
    }
  };

  // --- AI 审查处理函数 ---
  const handleOpenAiReview = () => {
    setAiReviewResults([]);
    setMarkedActions({});
    setExternalReviewContent('');
    setCopyStatus('');
    setAiTargetSnapshotById({});
    setShowAiReviewModal(true);
  };

  const handleStartAiReview = async () => {
    setIsAiReviewing(true);
    setAiReviewResults([]);
    try {
      const candidates = selectedIds.size > 0
        ? Array.from(selectedIds)
        : dataCards
            .filter(card => card.review_status === 'pending' || Boolean(card.pending_update_id))
            .map(card => card.id);
      const cardIdsToReview = candidates.slice(0, aiBatchSize);

      if (cardIdsToReview.length === 0) {
        alert('当前页面没有可审查内容（新建待审 / 更新待审）。');
        return;
      }

      const cardById = new Map(dataCards.map(card => [card.id, card]));
      const snapshot: Record<string, AiTargetSnapshotItem> = {};
      const targets: Array<{ kind: 'card' | 'update'; id: string; targetId: string }> = [];

      for (const cardId of cardIdsToReview) {
        const card = cardById.get(cardId);
        if (!card) continue;

        if (card.pending_update_id) {
          const targetId = `update:${card.pending_update_id}`;
          targets.push({ kind: 'update', id: card.pending_update_id, targetId });
          snapshot[targetId] = {
            kind: 'update',
            cardId,
            updateId: card.pending_update_id,
            name: card.pending_update_name ?? card.name,
            description: card.pending_update_description ?? card.description,
            data: card.pending_update_data ?? card.data,
            originalName: card.name,
            originalDescription: card.description,
            originalData: card.data,
          };
          continue;
        }

        const targetId = `card:${cardId}`;
        targets.push({ kind: 'card', id: cardId, targetId });
        snapshot[targetId] = {
          kind: 'card',
          cardId,
          name: card.name,
          description: card.description,
          data: card.data,
        };
      }

      setAiTargetSnapshotById(snapshot);

      const modelOverride = aiModel === 'default' ? undefined : aiModel;

      const response = await fetch('/api/admin/ai-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets, model: modelOverride }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'AI审查请求失败');
      setAiReviewResults(result.reviews);
    } catch (error) {
      alert(`AI审查失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsAiReviewing(false);
    }
  };

  const handleMarkAction = (id: string, action: 'approve' | 'reject') => {
    setMarkedActions(prev => ({ ...prev, [id]: action }));
  };

  const handleExecuteMarkedActions = async () => {
    const actionsToExecute = Object.entries(markedActions);
    if (actionsToExecute.length === 0) return alert('没有已标记的操作');

    const approveTargetIds = actionsToExecute.filter(([, action]) => action === 'approve').map(([id]) => id);
    const rejectTargetIds = actionsToExecute.filter(([, action]) => action === 'reject').map(([id]) => id);

    if (!window.confirm(`即将通过 ${approveTargetIds.length} 项，拒绝 ${rejectTargetIds.length} 项。是否继续？`)) return;

    try {
      const approveUpdateIds: string[] = [];
      const rejectUpdateIds: string[] = [];
      const approveCardIds: string[] = [];
      const rejectCardIds: string[] = [];

      for (const targetId of approveTargetIds) {
        const item = aiTargetSnapshotById[targetId];
        if (!item) continue;
        if (item.kind === 'update' && item.updateId) approveUpdateIds.push(item.updateId);
        if (item.kind === 'card') approveCardIds.push(item.cardId);
      }
      for (const targetId of rejectTargetIds) {
        const item = aiTargetSnapshotById[targetId];
        if (!item) continue;
        if (item.kind === 'update' && item.updateId) rejectUpdateIds.push(item.updateId);
        if (item.kind === 'card') rejectCardIds.push(item.cardId);
      }

      if (approveUpdateIds.length > 0) {
        const { failedIds } = await executeBatchReviewUpdates(approveUpdateIds, 'approve');
        if (failedIds.length > 0) {
          alert(`通过更新存在失败 ${failedIds.length} 条，请刷新后重试。`);
          await fetchData(filters);
          return;
        }
      }
      if (rejectUpdateIds.length > 0) {
        const { failedIds } = await executeBatchReviewUpdates(rejectUpdateIds, 'reject');
        if (failedIds.length > 0) {
          alert(`拒绝更新存在失败 ${failedIds.length} 条，请刷新后重试。`);
          await fetchData(filters);
          return;
        }
      }

      if (approveCardIds.length > 0) await executeBatchUpdateCards(approveCardIds, 'approve');
      if (rejectCardIds.length > 0) await executeBatchUpdateCards(rejectCardIds, 'reject');

      alert('操作成功！');
      setShowAiReviewModal(false);
      await fetchData(filters);
    } catch (error) {
      alert(`执行失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  // [新增] 外部审查 - 复制内容到剪贴板
  const handleCopyToClipboard = () => {
    const cardById = new Map(dataCards.map(card => [card.id, card]));
    const candidates = selectedIds.size > 0
      ? Array.from(selectedIds)
      : dataCards
          .filter(card => card.review_status === 'pending' || Boolean(card.pending_update_id))
          .map(card => card.id);
    const cardIdsToCopy = candidates.slice(0, aiBatchSize);
    if (cardIdsToCopy.length === 0) return alert('当前没有可复制的内容。');

    const snapshot: Record<string, AiTargetSnapshotItem> = {};
    const cardsToCopy = cardIdsToCopy.map(cardId => {
      const card = cardById.get(cardId);
      if (!card) return null;
      if (card.pending_update_id) {
        const targetId = `update:${card.pending_update_id}`;
        snapshot[targetId] = {
          kind: 'update',
          cardId,
          updateId: card.pending_update_id,
          name: card.pending_update_name ?? card.name,
          description: card.pending_update_description ?? card.description,
          data: card.pending_update_data ?? card.data,
          originalName: card.name,
          originalDescription: card.description,
          originalData: card.data,
        };
        let parsedData: any = card.pending_update_data ?? card.data;
        try {
          parsedData = JSON.parse(parsedData);
        } catch {
          // ignore
        }
        return {
          id: targetId,
          content: {
            name: card.pending_update_name ?? card.name,
            description: card.pending_update_description ?? card.description,
            data: parsedData,
          },
        };
      }

      const targetId = `card:${cardId}`;
      snapshot[targetId] = { kind: 'card', cardId, name: card.name, description: card.description, data: card.data };
      let parsedData: any = card.data;
      try {
        parsedData = JSON.parse(card.data);
      } catch {
        // ignore
      }
      return {
        id: targetId,
        content: {
          name: card.name,
          description: card.description,
          data: parsedData,
        },
      };
    }).filter((item): item is NonNullable<typeof item> => Boolean(item));

    setAiTargetSnapshotById(snapshot);
    
    const promptForLLM = `
You are a content moderator. Please review the following data cards based on our content policy (no politics, hate speech, explicit content, etc.). 
For each card, provide your suggestion ('approved' or 'rejected') and a brief reason in Chinese. 
Your entire response MUST be a single, valid JSON array of objects, with no other text before or after it.

Example format:
[
  { "id": "...", "suggestion": "approved", "reason": "虽存在部分擦边内容，但不存在明显不适宜的内容。" },
  { "id": "...", "suggestion": "rejected", "reason": "令人不适的内容：恐怖猎奇的行为。" }
]

Here is the batch of data cards to review:

${JSON.stringify(cardsToCopy, null, 2)}
`;
    navigator.clipboard.writeText(promptForLLM).then(() => {
        setCopyStatus(`已成功复制 ${cardsToCopy.length} 条待审查内容到剪贴板！`);
        setTimeout(() => setCopyStatus(''), 3000);
    }).catch(err => {
        alert('复制失败，请检查浏览器权限。');
        console.error('复制失败:', err);
    });
  };

  // [新增] 外部审查 - 解析并应用结果
  const handleParseAndApply = async () => {
      const normalizeJsonText = (input: string): string => {
          const trimmed = input.trim();
          if (!trimmed) return trimmed;

          const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
          const unfenced = fenced ? fenced[1].trim() : trimmed;

          if (unfenced.startsWith('[') || unfenced.startsWith('{')) return unfenced;

          const arrayStart = unfenced.indexOf('[');
          const arrayEnd = unfenced.lastIndexOf(']');
          if (arrayStart >= 0 && arrayEnd > arrayStart) {
              return unfenced.slice(arrayStart, arrayEnd + 1).trim();
          }

          return unfenced;
      };

      const tryReadClipboardText = async (): Promise<string | null> => {
          if (!navigator.clipboard?.readText) return null;
          try {
              return await navigator.clipboard.readText();
          } catch (error) {
              console.warn('读取剪贴板失败:', error);
              return null;
          }
      };

      let rawText = externalReviewContent;
      let sourceLabel = '文本框';

      if (!rawText.trim()) {
          const clipboardText = await tryReadClipboardText();
          if (!clipboardText?.trim()) {
              alert('文本框为空，且无法读取剪贴板内容。请先粘贴外部 AI 返回的 JSON 数组结果。');
              return;
          }
          rawText = clipboardText;
          sourceLabel = '剪贴板';
      }

      try {
          const parsedResults = JSON.parse(normalizeJsonText(rawText));
          if (!Array.isArray(parsedResults)) {
              throw new Error('粘贴的内容不是一个有效的 JSON 数组。');
          }
          
          // 验证数组中的每个对象是否符合格式
          const validatedResults: AiReviewResult[] = parsedResults.map(item => {
              if (!item.id || !item.suggestion || !['approved', 'rejected'].includes(item.suggestion) || typeof item.reason === 'undefined') {
                  throw new Error(`解析失败：对象 ${JSON.stringify(item)} 缺少 id, suggestion, 或 reason 字段。`);
              }
              const originalItem = aiTargetSnapshotById[item.id];
              return {
                  id: item.id,
                  name: originalItem?.name || item.id,
                  suggestion: item.suggestion,
                  reason: item.reason
              };
          });

          setAiReviewResults(validatedResults);
          setExternalReviewContent(''); // 清空文本框
          alert(`成功从${sourceLabel}解析并加载了 ${validatedResults.length} 条审查建议！`);
      } catch (error) {
          if (sourceLabel === '剪贴板' && !externalReviewContent.trim()) {
              setExternalReviewContent(rawText);
          }
          alert(`解析失败: ${error instanceof Error ? error.message : '无效的JSON格式'}`);
          console.error('解析外部审查结果失败:', error);
      }
  };

  const totalPages = Math.ceil(total / filters.limit);
  const getReviewStatusBadge = (status: DataCard['review_status']) => {
      const map = {
          pending: { text: '待审查', color: 'bg-yellow-100 text-yellow-800' },
          approved: { text: '已通过', color: 'bg-green-100 text-green-800' },
          rejected: { text: '未通过', color: 'bg-red-100 text-red-800' },
      };
      return <span className={`px-2 py-1 text-xs font-medium rounded-full ${map[status].color}`}>{map[status].text}</span>;
  };
  const getPublicStatusBadge = (status: DataCard['is_public']) => {
      const map = {
          '1': { text: '公开', color: 'bg-blue-100 text-blue-800' },
          '0': { text: '私有', color: 'bg-gray-100 text-gray-800' },
          '-1': { text: '封禁', color: 'bg-zinc-200 text-zinc-800 font-bold' },
      };
      const key = String(status);
      return <span className={`px-2 py-1 text-xs font-medium rounded-full ${map[key as keyof typeof map].color}`}>{map[key as keyof typeof map].text}</span>;
  };

  return (
    <>
      <Head>
        <title>内容档案管理 - Admin</title>
      </Head>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-7xl mx-auto">
          <div className="mb-4">
            <Link href="/admin">
              <span className="text-sm text-purple-600 hover:underline cursor-pointer">&larr; 返回管理后台主页</span>
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-4">内容档案管理</h1>

          {/* 筛选器区域 */}
          <div className="bg-white p-4 rounded-lg shadow-sm mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <input
                type="text"
                name="search"
                defaultValue={router.query.search || ''} // 使用 router.query 初始化以避免UI跳动
                onChange={handleFilterChange}
                onCompositionStart={() => {
                  isComposingSearchRef.current = true;
                }}
                onCompositionEnd={(e) => {
                  isComposingSearchRef.current = false;
                  const newFilters = { ...filters, search: e.currentTarget.value, page: 1 };
                  setFilters(newFilters);
                  debouncedUpdateUrl(newFilters);
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  if ((e.nativeEvent as unknown as { isComposing?: boolean }).isComposing || isComposingSearchRef.current) {
                    e.preventDefault();
                    return;
                  }
                  e.preventDefault();
                  const newFilters = { ...filters, search: e.currentTarget.value, page: 1 };
                  setFilters(newFilters);
                  debouncedUpdateUrl.cancel();
                  updateUrl(newFilters);
                }}
                onBlur={(e) => {
                  if (isComposingSearchRef.current) return;
                  const newFilters = { ...filters, search: e.currentTarget.value, page: 1 };
                  setFilters(newFilters);
                  debouncedUpdateUrl.cancel();
                  updateUrl(newFilters);
                }}
                placeholder="搜索名称、描述、作者..."
                className="input-field"
              />
              <select name="reviewStatus" value={filters.reviewStatus} onChange={handleFilterChange} className="input-field">
                <option value="">所有审查状态</option>
                <option value="pending">待审查</option>
                <option value="approved">已通过</option>
                <option value="rejected">未通过</option>
              </select>
              <select name="isPublic" value={filters.isPublic} onChange={handleFilterChange} className="input-field">
                <option value="">所有公开状态</option>
                <option value="1">公开</option>
                <option value="0">私有</option>
                <option value="-1">封禁</option>
              </select>
              <select name="type" value={filters.type} onChange={handleFilterChange} className="input-field">
                <option value="">所有类型</option>
                <option value="character">角色</option>
                <option value="scenario">情景</option>
                <option value="history">叙事历史</option>
                <option value="questionnaire">问卷</option>
              </select>
              <select name="isRecommended" value={filters.isRecommended} onChange={handleFilterChange} className="input-field">
                <option value="">推荐状态</option>
                <option value="1">仅推荐</option>
                <option value="0">未推荐</option>
              </select>
            </div>
          </div>

          {/* 操作栏 */}
          <div className="bg-white p-4 rounded-lg shadow-sm mb-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-600 mr-4">选中 {selectedIds.size} / {dataCards.length} 项 (共 {total} 项)</span>
            <div className="flex-grow flex flex-wrap gap-2">
                <button onClick={() => handleBatchReviewWithUpdates('approve')} className="admin-button-sm bg-green-600 hover:bg-green-700 text-white">通过审查</button>
                <button onClick={() => handleBatchReviewWithUpdates('reject')} className="admin-button-sm bg-red-600 hover:bg-red-700 text-white">拒绝审查</button>
                <button onClick={() => handleBatchAction('set_public_status', 1)} className="admin-button-sm bg-blue-600 hover:bg-blue-700 text-white">设为公开</button>
                <button onClick={() => handleBatchAction('set_public_status', 0)} className="admin-button-sm bg-gray-600 hover:bg-gray-700 text-white">设为私有</button>
                <button onClick={() => handleBatchAction('set_public_status', -1)} className="admin-button-sm bg-zinc-700 hover:bg-zinc-800 text-white">设为封禁</button>
                <button onClick={() => handleBatchAction('set_recommended', 1)} className="admin-button-sm bg-amber-500 hover:bg-amber-600 text-white">设为推荐</button>
                <button onClick={() => handleBatchAction('set_recommended', 0)} className="admin-button-sm bg-amber-200 hover:bg-amber-300 text-amber-800">取消推荐</button>
                <button onClick={handleRecomputeMetrics} className="admin-button-sm bg-indigo-700 hover:bg-indigo-800 text-white">重算技术值</button>
                <button onClick={handleResetArenaRatings} className="admin-button-sm bg-rose-700 hover:bg-rose-800 text-white">重置排位（角色）</button>
                <button onClick={handleExport} className="admin-button-sm bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50" disabled={isExporting || selectedIds.size === 0}>
                  {isExporting ? '导出中...' : '导出选中项'}
                </button>
                <button onClick={handleOpenAiReview} className="admin-button-sm bg-indigo-600 hover:bg-indigo-700 text-white">AI 辅助审查</button>
            </div>
          </div>
          
          {/* 数据表格 */}
          <AdminTableScroll withCard={false} className="bg-white rounded-lg shadow-sm">
            <table className="min-w-full w-max text-sm text-left text-gray-500">
              <thead className="text-xs text-gray-700 bg-gray-50">
                <tr>
                  <th scope="col" className="p-4"><input type="checkbox" onChange={handleSelectAll} checked={selectedIds.size === dataCards.length && dataCards.length > 0} /></th>
                  <th scope="col" className="px-6 py-3">名称 / 作者</th>
                  <th scope="col" className="px-6 py-3">类型</th>
                  <th scope="col" className="px-6 py-3">公开状态</th>
                  <th scope="col" className="px-6 py-3">审查状态</th>
                  <th scope="col" className="px-6 py-3 whitespace-nowrap">点赞 / 收藏 / 使用</th>
                  <th scope="col" className="px-6 py-3">内容预览</th>
                  <th scope="col" className="px-6 py-3">更新时间</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center p-8">加载中...</td></tr>
                ) : dataCards.length === 0 ? (
                  <tr><td colSpan={8} className="text-center p-8">未找到符合条件的数据</td></tr>
                ) : (
                  dataCards.map(card => {
                    const hasPendingUpdate = Boolean(card.pending_update_id);
                    const displayName = hasPendingUpdate ? (card.pending_update_name ?? card.name) : card.name;
                    const displayDescription = hasPendingUpdate ? (card.pending_update_description ?? card.description) : card.description;
                    const displayData = hasPendingUpdate ? (card.pending_update_data ?? card.data) : card.data;
                    const questionnaireNativeAllowed = card.type === 'questionnaire' ? parseQuestionnaireNativeAllowed(card.data) : false;
                    const canToggleQuestionnaireNative = card.type === 'questionnaire' && !hasPendingUpdate;

                    return (
                      <tr key={card.id} className="bg-white border-b hover:bg-gray-50">
                        <td className="p-4">
                          <input type="checkbox" onChange={() => handleSelectOne(card.id)} checked={selectedIds.has(card.id)} />
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => handleViewDetails(card)}
                            className="font-medium text-purple-600 hover:underline text-left"
                          >
                            {displayName}
                            {hasPendingUpdate && (
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-amber-100 text-amber-800">
                                更新待审核
                              </span>
                            )}
                            {!hasPendingUpdate && card.review_status === 'pending' && (
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-blue-100 text-blue-800">
                                新建待审
                              </span>
                            )}
                            {card.is_recommended === 1 && (
                              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-amber-100 text-amber-700">
                                <span>推荐</span>
                              </span>
                            )}
                            {card.type === 'questionnaire' && (
                              <button
                                type="button"
                                disabled={!canToggleQuestionnaireNative || nativeUpdatingId === card.id}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleToggleQuestionnaireNative(card, !questionnaireNativeAllowed);
                                }}
                                className={`ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border transition-colors ${questionnaireNativeAllowed
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                  : 'border-gray-200 bg-gray-100 text-gray-600 hover:bg-gray-200'
                                } ${!canToggleQuestionnaireNative || nativeUpdatingId === card.id ? 'opacity-60 cursor-not-allowed' : ''}`}
                                title={canToggleQuestionnaireNative ? '点击切换问卷原生许可' : '存在待审更新，暂不可切换'}
                              >
                                {questionnaireNativeAllowed ? '原生许可' : '非原生'}
                              </button>
                            )}
                          </button>
                          <div className="text-xs text-gray-500">by {card.username}</div>
                          {hasPendingUpdate && (
                            <div className="mt-1 flex items-center gap-2">
                              <span className="text-[11px] text-gray-500">原：{card.name}</span>
                              <button onClick={() => handleViewOriginalDetails(card)} className="text-[11px] text-gray-500 hover:text-gray-800 underline">
                                看原版
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {card.type === 'character'
                            ? '角色'
                            : card.type === 'scenario'
                              ? '情景'
                              : card.type === 'history'
                                ? '叙事历史'
                                : '问卷'}
                        </td>
                        <td className="px-6 py-4">{getPublicStatusBadge(card.is_public)}</td>
                        <td className="px-6 py-4">
                          <div className="space-y-1">
                            {hasPendingUpdate && (
                              <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-800">
                                更新待审核
                              </span>
                            )}
                            {getReviewStatusBadge(card.review_status)}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          ❤️ {card.like_count} / ⭐ {card.favorite_count} / 📥 {card.usage_count}
                        </td>
                        <td className="px-6 py-4 text-xs text-gray-500 max-w-xs">
                          {(() => {
                              const defaultDescriptions = ['角色数据卡', '情景数据卡', '叙事历史数据卡', '问卷数据卡'];
                              const normalizedDescription = (displayDescription || '').trim();
                              const isMeaningfulDescription = normalizedDescription && !defaultDescriptions.includes(normalizedDescription);

                              const contentToShow = (() => {
                                if (isMeaningfulDescription) return normalizedDescription;
                                if (card.type === 'history') {
                                  try {
                                    const parsed = displayData ? JSON.parse(displayData) : null;
                                    const count = Array.isArray(parsed?.entries) ? parsed.entries.length : 0;
                                    return `叙事历史（${count} 条）`;
                                  } catch {
                                    return '叙事历史（解析失败）';
                                  }
                                }
                                return displayData || '';
                              })();
                              let titleToShow = contentToShow;
                              try {
                                  if (!isMeaningfulDescription && displayData) {
                                      titleToShow = JSON.stringify(JSON.parse(displayData), null, 2);
                                  }
                              } catch (e) {
                                console.error('❌ 发生解析错误:', e);
                              }

                              return (
                                  <p className="truncate" title={titleToShow}>
                                      {contentToShow}
                                  </p>
                              );
                          })()}
                        </td>
                        <td className="px-6 py-4">
                          {hasPendingUpdate ? (
                            <div className="space-y-0.5">
                              <div className="text-sm text-gray-700">{new Date(card.pending_update_created_at || card.updated_at).toLocaleString()}</div>
                              <div className="text-[11px] text-gray-500">更新提交</div>
                            </div>
                          ) : (
                            new Date(card.updated_at).toLocaleString()
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </AdminTableScroll>

          {/* 分页 */}
          {totalPages > 1 && (
              <div className="flex justify-between items-center mt-4 text-sm">
                  <button onClick={() => handlePageChange(filters.page - 1)} disabled={loading || filters.page <= 1} className="admin-button-sm">上一页</button>
                  <span>第 {filters.page} / {totalPages} 页 (共 {total} 项)</span>
                  <button onClick={() => handlePageChange(filters.page + 1)} disabled={loading || filters.page >= totalPages} className="admin-button-sm">下一页</button>
              </div>
          )}
        </div>
      </div>
      
      {/* AI 辅助审查模态框 */}
      {showAiReviewModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                  <div className="flex justify-between items-center p-4 border-b">
                      <h2 className="text-lg font-bold">AI 辅助审查</h2>
                      <button onClick={() => setShowAiReviewModal(false)} className="text-gray-500 hover:text-gray-800 text-2xl">&times;</button>
                  </div>
                  <div className="flex-grow flex flex-col md:flex-row overflow-hidden">
                      {/* 左侧控制与结果区 */}
                      <div className="w-full md:w-1/2 flex flex-col border-r">
                          <div className="p-4 space-y-4">
                              <div className="flex items-center gap-4">
                                  <div>
                                      <label className="text-sm font-medium">单次处理数量</label>
                                      <input type="number" value={aiBatchSize} onChange={e => setAiBatchSize(parseInt(e.target.value))} className="input-field w-24 mt-1" min="1" max="50" />
                                  </div>
                                  <div>
                                    <label className="text-sm font-medium">使用模型</label>
                                    <select value={aiModel} onChange={e => setAiModel(e.target.value)} className="input-field mt-1">
                                      <option value="default">使用系统默认配置（推荐）</option>
                                      {resolvedAiModels.map(modelId => (
                                        <option key={modelId} value={modelId}>
                                          {aiModelLabelMap.get(modelId) ?? modelId}
                                        </option>
                                      ))}
                                    </select>
                                    {availableAiModelsError && availableAiModels.length === 0 && (
                                      <p className="text-[11px] text-amber-700 mt-1">模型列表获取失败，已回退到内置目录：{availableAiModelsError}</p>
                                    )}
                                  </div>
                                  <button onClick={handleStartAiReview} disabled={isAiReviewing} className="admin-button-sm bg-indigo-600 hover:bg-indigo-700 text-white self-end">
                                      {isAiReviewing ? '审查中...' : `开始审查`}
                                  </button>
                              </div>
                              <p className="text-xs text-gray-500">
                                若已在下方大列表中勾选内容，则优先审查勾选项；否则从当前列表中选取“新建待审 / 更新待审”最多 {aiBatchSize} 项。AI 给出“拒绝”不会自动勾选，需管理员确认。
                              </p>
                          </div>
                          <div className="flex-grow overflow-y-auto p-4 border-t">
                              {isAiReviewing && <div className="text-center">AI 正在努力分析中...</div>}
                              {aiReviewResults.length === 0 && !isAiReviewing && <div className="text-center text-gray-500">暂无审查结果</div>}
                              {aiReviewResults.length > 0 && (
                                  <div className="space-y-2">
                                      {aiReviewResults.map(res => (
                                          <div key={res.id} className="p-3 bg-gray-50 rounded-lg border">
                                              <p className="font-semibold">{res.name}</p>
                                              <p className={`text-sm font-bold ${res.suggestion === 'approved' ? 'text-green-600' : 'text-red-600'}`}>AI建议: {res.suggestion === 'approved' ? '通过' : '拒绝'}</p>
                                              <p className="text-xs text-gray-600 italic">理由: {res.reason}</p>
                                              {aiTargetSnapshotById[res.id] && (
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                  <button
                                                    onClick={() => handleViewDetailsFromAiTarget(res.id, 'review')}
                                                    className="admin-button-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                  >
                                                    {aiTargetSnapshotById[res.id].kind === 'update' ? '查看更新' : '查看详情'}
                                                  </button>
                                                  {aiTargetSnapshotById[res.id].kind === 'update' && (
                                                    <button
                                                      onClick={() => handleViewDetailsFromAiTarget(res.id, 'original')}
                                                      className="admin-button-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
                                                    >
                                                      看原版
                                                    </button>
                                                  )}
                                                </div>
                                              )}
                                              <div className="mt-2 flex gap-2">
                                                  <label className="flex items-center text-xs cursor-pointer"><input type="radio" name={`action-${res.id}`} onChange={() => handleMarkAction(res.id, 'approve')} checked={markedActions[res.id] === 'approve'}/><span className="ml-1">通过</span></label>
                                                  <label className="flex items-center text-xs cursor-pointer"><input type="radio" name={`action-${res.id}`} onChange={() => handleMarkAction(res.id, 'reject')} checked={markedActions[res.id] === 'reject'}/><span className="ml-1">拒绝</span></label>
                                              </div>
                                          </div>
                                      ))}
                                  </div>
                              )}
                          </div>
                      </div>
                      {/* 右侧外部工作流 */}
                      <div className="w-full md:w-1/2 flex flex-col">
                          <div className="p-4">
                              <h3 className="font-semibold mb-2">外部 AI 审查工作流</h3>
                              <button onClick={handleCopyToClipboard} className="admin-button-sm bg-gray-700 hover:bg-gray-800 text-white w-full mb-2">1. 复制内容以供外部审查</button>
                              {copyStatus && <p className="text-xs text-green-600 text-center mb-2">{copyStatus}</p>}
                              <textarea value={externalReviewContent} onChange={e => setExternalReviewContent(e.target.value)} placeholder="2. 在此处粘贴外部 AI 返回的 JSON 数组结果（留空则尝试读取剪贴板）..." className="input-field w-full h-32 resize-y"></textarea>
                              <button onClick={handleParseAndApply} className="admin-button-sm bg-blue-700 hover:bg-blue-800 text-white w-full mt-2">3. 解析并应用建议</button>
                          </div>
                      </div>
                  </div>
                  <div className="p-4 border-t flex justify-end">
                      <button onClick={handleExecuteMarkedActions} disabled={Object.keys(markedActions).length === 0} className="admin-button-sm bg-green-700 hover:bg-green-800 text-white">
                          执行所有已标记操作 ({Object.keys(markedActions).length})
                      </button>
                  </div>
              </div>
          </div>
      )}
      {/* 详情弹窗组件 */}
      {selectedCardDetails && (
        <DataCardDetailsModal
          isOpen={isDetailsModalOpen}
          onClose={() => setIsDetailsModalOpen(false)}
          pendingNotice={detailsPendingNotice}
          adminTagEditor
          card={{
            id: selectedCardDetails.id,
            name: selectedCardDetails.name,
            description: selectedCardDetails.description,
            type: selectedCardDetails.type,
            data: selectedCardDetails.data,
            isPublic: selectedCardDetails.is_public === 1,
            usageCount: selectedCardDetails.usage_count,
            likeCount: selectedCardDetails.like_count,
            favoriteCount: selectedCardDetails.favorite_count,
            author: selectedCardDetails.username,
            createdAt: selectedCardDetails.created_at,
            updatedAt: selectedCardDetails.updated_at
          }}
        />
      )}
    </>
  );
};

export default ContentManagementPage;
