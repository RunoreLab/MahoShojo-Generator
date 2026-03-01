import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { deckApi, deckFavoritesApi, deckStatsApi, dataCardApi } from '@/lib/auth';
import { addLikedDeck, getLikedDecks } from '@/lib/localStorage';
import { buildTitleDisplay } from '@/lib/text';
import { getDeckStatus, getDeckVisibilityValue } from '@/lib/deck-status';

type DeckTab = 'my' | 'public' | 'favorites';

type DeckRow = {
  id: string;
  userId: number;
  username?: string;
  name: string;
  description?: string | null;
  isPublic: number;
  likeCount?: number;
  favoriteCount?: number;
  cardCount?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type DeckCardEntry = {
  data_card_id: string;
  sort_order: number;
  isAccessible: boolean;
  displayName: string;
  displayType: string;
  reason?: 'deleted' | 'private' | 'banned' | 'unknown';
  card?: any;
};

interface DecksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportDeck: (deckId: string) => void;
}

const statusLabel = (deck: unknown): { label: string; className: string } => {
  const status = getDeckStatus(deck).status;
  if (status === 'banned') return { label: '封禁', className: 'bg-red-50 text-red-700 border-red-200' };
  if (status === 'public') return { label: '公开', className: 'bg-green-50 text-green-700 border-green-200' };
  return { label: '私有', className: 'bg-gray-50 text-gray-700 border-gray-200' };
};

export default function DecksModal({ isOpen, onClose, onImportDeck }: DecksModalProps) {
  const [activeTab, setActiveTab] = useState<DeckTab>('my');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [likedDeckIds, setLikedDeckIds] = useState<Set<string>>(new Set());

  const [myDecks, setMyDecks] = useState<DeckRow[]>([]);
  const [publicDecks, setPublicDecks] = useState<DeckRow[]>([]);
  const [favoriteDecks, setFavoriteDecks] = useState<DeckRow[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  const [capacity, setCapacity] = useState<number | null>(null);
  const [deckCount, setDeckCount] = useState<number | null>(null);

  const [publicSearch, setPublicSearch] = useState('');
  const [publicSortBy, setPublicSortBy] = useState<'likes' | 'favorites' | 'createdAt'>('createdAt');
  const [publicOffset, setPublicOffset] = useState(0);
  const publicLimit = 12;
  const [hasMorePublic, setHasMorePublic] = useState(true);

  const [detailDeck, setDetailDeck] = useState<DeckRow | null>(null);
  const [detailCards, setDetailCards] = useState<DeckCardEntry[]>([]);
  const [detailMode, setDetailMode] = useState<'view' | 'edit'>('view');

  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createIsPublic, setCreateIsPublic] = useState(0);

  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIsPublic, setEditIsPublic] = useState(0);

  const [addSource, setAddSource] = useState<'my' | 'public'>('my');
  const [addSearch, setAddSearch] = useState('');
  const [addCandidates, setAddCandidates] = useState<any[]>([]);
  const [addLoading, setAddLoading] = useState(false);

  const canCreate = useMemo(() => {
    if (capacity === null || deckCount === null) return true;
    return deckCount < capacity;
  }, [capacity, deckCount]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const refreshFavorites = useCallback(async () => {
    const ids = await deckFavoritesApi.getFavoriteIds();
    setFavoriteIds(new Set(ids));
  }, []);

  const refreshMyDecks = useCallback(async () => {
    const result = await deckApi.getMyDecks();
    if (!result) return;
    setMyDecks(result.decks || []);
    setCapacity(typeof result.capacity === 'number' ? result.capacity : null);
    setDeckCount(typeof result.deckCount === 'number' ? result.deckCount : null);
  }, []);

  const refreshFavoriteDecks = useCallback(async () => {
    const decks = await deckFavoritesApi.getFavorites();
    setFavoriteDecks(decks);
  }, []);

  const loadPublicDecks = useCallback(
    async (reset: boolean) => {
      const nextOffset = reset ? 0 : publicOffset;
      const decks = await deckApi.getPublicDecks({
        limit: publicLimit,
        offset: nextOffset,
        search: publicSearch.trim() || undefined,
        sortBy: publicSortBy
      });

      if (reset) {
        setPublicDecks(decks);
      } else {
        setPublicDecks((prev) => [...prev, ...decks]);
      }

      const nextHasMore = decks.length >= publicLimit;
      setHasMorePublic(nextHasMore);
      setPublicOffset(nextOffset + publicLimit);
    },
    [publicLimit, publicOffset, publicSearch, publicSortBy]
  );

  const openDeckDetail = useCallback(
    async (deck: DeckRow, mode: 'view' | 'edit') => {
      setLoading(true);
      setDetailDeck(deck);
      setDetailMode(mode);
      setDetailCards([]);
      try {
        const detail = await deckApi.getDeckCards(deck.id);

        if (!detail) {
          showToast('加载卡组失败');
          setDetailDeck(null);
          return;
        }

        setDetailDeck(detail.deck);
        setDetailCards(detail.cards || []);

        if (mode === 'edit') {
          setEditName(detail.deck?.name || '');
          setEditDescription(detail.deck?.description || '');
          setEditIsPublic(getDeckVisibilityValue(detail.deck) === 1 ? 1 : 0);
        }
      } finally {
        setLoading(false);
      }
    },
    [showToast]
  );

  const closeDetail = useCallback(() => {
    setDetailDeck(null);
    setDetailCards([]);
    setDetailMode('view');
    setAddCandidates([]);
    setAddSearch('');
  }, []);

  const handleCreate = useCallback(async () => {
    const name = createName.trim();
    if (!name) return showToast('请输入卡组名称');

    setLoading(true);
    try {
      const result = await deckApi.createDeck({ name, description: createDescription, isPublic: createIsPublic });
      if (!result?.success) {
        showToast(result?.error || '创建失败');
        return;
      }
      setCreateName('');
      setCreateDescription('');
      setCreateIsPublic(0);
      await refreshMyDecks();
      showToast('卡组创建成功');
    } finally {
      setLoading(false);
    }
  }, [createDescription, createIsPublic, createName, refreshMyDecks, showToast]);

  const handleDeleteDeck = useCallback(
    async (deckId: string) => {
      if (!window.confirm('确定要删除这个卡组吗？（不可恢复）')) return;
      setLoading(true);
      try {
        const ok = await deckApi.deleteDeck(deckId);
        if (!ok) {
          showToast('删除失败');
          return;
        }
        if (detailDeck?.id === deckId) closeDetail();
        await refreshMyDecks();
        showToast('已删除');
      } finally {
        setLoading(false);
      }
    },
    [closeDetail, detailDeck?.id, refreshMyDecks, showToast]
  );

  const handleSaveDeck = useCallback(async () => {
    if (!detailDeck) return;
    const name = editName.trim();
    if (!name) return showToast('请输入卡组名称');

    setLoading(true);
    try {
      const ok = await deckApi.updateDeck(detailDeck.id, { name, description: editDescription, isPublic: editIsPublic });
      if (!ok) {
        showToast('保存失败');
        return;
      }
      await refreshMyDecks();
      showToast('已保存');
      setDetailDeck((prev) => (prev ? { ...prev, name, description: editDescription, isPublic: editIsPublic } : prev));
    } finally {
      setLoading(false);
    }
  }, [detailDeck, editDescription, editIsPublic, editName, refreshMyDecks, showToast]);

  const handleRemoveDeckCard = useCallback(
    async (dataCardId: string) => {
      if (!detailDeck) return;
      setLoading(true);
      try {
        const ok = await deckApi.removeDeckCards(detailDeck.id, [dataCardId]);
        if (!ok) {
          showToast('移除失败');
          return;
        }
        setDetailCards((prev) => prev.filter((c) => c.data_card_id !== dataCardId));
      } finally {
        setLoading(false);
      }
    },
    [detailDeck, showToast]
  );

  const handlePrune = useCallback(async () => {
    if (!detailDeck) return;
    setLoading(true);
    try {
      const result = await deckApi.pruneInaccessible(detailDeck.id);
      if (!result?.success) {
        showToast(result?.error || '清理失败');
        return;
      }
      const refreshed = await deckApi.getDeckCards(detailDeck.id);
      if (refreshed) {
        setDetailDeck(refreshed.deck);
        setDetailCards(refreshed.cards || []);
      }
      showToast(`已清理 ${result.removed || 0} 张不可用卡片`);
    } finally {
      setLoading(false);
    }
  }, [detailDeck, showToast]);

  const fetchAddCandidates = useCallback(async () => {
    if (!detailDeck || detailMode !== 'edit') return;
    const query = addSearch.trim();
    setAddLoading(true);
    try {
      if (addSource === 'my') {
        const cards = await dataCardApi.getCards(query || undefined);
        const filtered = (cards || []).filter((c: any) => c?.type === 'character' && !c?.deleted_at);
        setAddCandidates(filtered.slice(0, 30));
      } else {
        const cards = await deckApi.getPublicCharacterCards(query || undefined);
        setAddCandidates(cards.slice(0, 30));
      }
    } finally {
      setAddLoading(false);
    }
  }, [addSearch, addSource, detailDeck, detailMode]);

  const handleAddCards = useCallback(
    async (cardIds: string[]) => {
      if (!detailDeck) return;
      setLoading(true);
      try {
        const result = await deckApi.addDeckCards(detailDeck.id, cardIds);
        if (!result?.success) {
          showToast(result?.error || '添加失败');
          return;
        }
        const refreshed = await deckApi.getDeckCards(detailDeck.id);
        if (refreshed) {
          setDetailDeck(refreshed.deck);
          setDetailCards(refreshed.cards || []);
        }
        showToast(`已添加 ${result.added || 0} 张，跳过 ${result.skipped || 0} 张`);
      } finally {
        setLoading(false);
      }
    },
    [detailDeck, showToast]
  );

  const toggleFavorite = useCallback(
    async (deck: DeckRow) => {
      const deckId = deck.id;
      const isFav = favoriteIds.has(deckId);

      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (isFav) next.delete(deckId);
        else next.add(deckId);
        return next;
      });

      setPublicDecks((prev) =>
        prev.map((d) =>
          d.id === deckId
            ? { ...d, favoriteCount: Math.max(0, (d.favoriteCount || 0) + (isFav ? -1 : 1)) }
            : d
        )
      );

      try {
        const ok = isFav ? await deckFavoritesApi.removeFavorite(deckId) : await deckFavoritesApi.addFavorite(deckId);
        if (!ok) {
          showToast('操作失败');
          await refreshFavorites();
        }
      } catch {
        await refreshFavorites();
      }
    },
    [favoriteIds, refreshFavorites, showToast]
  );

  const likeDeck = useCallback(
    async (deckId: string) => {
      const success = addLikedDeck(deckId);
      if (!success) {
        setLikedDeckIds((prev) => {
          if (prev.has(deckId)) return prev;
          const next = new Set(prev);
          next.add(deckId);
          return next;
        });
        return;
      }

      setLikedDeckIds((prev) => {
        const next = new Set(prev);
        next.add(deckId);
        return next;
      });
      setPublicDecks((prev) => prev.map((d) => (d.id === deckId ? { ...d, likeCount: (d.likeCount || 0) + 1 } : d)));
      try {
        const ok = await deckStatsApi.like(deckId);
        if (!ok) {
          throw new Error('like deck failed');
        }
      } catch {
        setPublicDecks((prev) =>
          prev.map((d) => (d.id === deckId ? { ...d, likeCount: Math.max(0, (d.likeCount || 0) - 1) } : d))
        );
      }
    },
    []
  );

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    void (async () => {
      try {
        setLikedDeckIds(getLikedDecks());
        await Promise.all([refreshMyDecks(), refreshFavorites(), loadPublicDecks(true)]);
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, loadPublicDecks, refreshFavorites, refreshMyDecks]);

  useEffect(() => {
    if (!isOpen) return;
    // 切换 Tab 时拉取对应数据
    void (async () => {
      if (activeTab === 'favorites') {
        await refreshFavoriteDecks();
      }
      if (activeTab === 'public') {
        setPublicOffset(0);
        await loadPublicDecks(true);
      }
      if (activeTab === 'my') {
        await refreshMyDecks();
      }
    })();
  }, [activeTab, isOpen, loadPublicDecks, refreshFavoriteDecks, refreshMyDecks]);

  useEffect(() => {
    if (!isOpen) return;
    if (detailMode !== 'edit') return;
    void fetchAddCandidates();
  }, [addSource, addSearch, detailMode, fetchAddCandidates, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col relative">
        <button
          onClick={() => {
            closeDetail();
            onClose();
          }}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none z-10"
          aria-label="关闭"
        >
          ×
        </button>

        <div className="p-6 border-b">
          <div className="flex items-center justify-between pr-8 gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold">卡组</h2>
              {capacity !== null && deckCount !== null && (
                <span className="text-sm text-gray-600">
                  {deckCount}/{capacity}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab('my')}
                className={`px-3 py-1.5 rounded text-sm font-medium ${activeTab === 'my' ? 'bg-pink-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
              >
                我的卡组
              </button>
              <button
                onClick={() => setActiveTab('public')}
                className={`px-3 py-1.5 rounded text-sm font-medium ${activeTab === 'public' ? 'bg-pink-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
              >
                公开卡组
              </button>
              <button
                onClick={() => setActiveTab('favorites')}
                className={`px-3 py-1.5 rounded text-sm font-medium ${activeTab === 'favorites' ? 'bg-pink-500 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
              >
                我的收藏
              </button>
            </div>
          </div>
        </div>

        {toast && (
          <div className="px-6 pt-4">
            <div className="text-sm bg-black text-white inline-flex px-3 py-1.5 rounded-md">{toast}</div>
          </div>
        )}

        <div className="flex-1 overflow-auto p-6">
          {detailDeck ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold break-words">{detailDeck.name || '未命名卡组'}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${statusLabel(detailDeck).className}`}>
                      {statusLabel(detailDeck).label}
                    </span>
                    {detailDeck.username && <span className="text-xs text-gray-500">作者：{detailDeck.username}</span>}
                  </div>
                  {detailDeck.description && <p className="text-sm text-gray-600 mt-1 break-words">{detailDeck.description}</p>}
                  <div className="text-xs text-gray-500 mt-2 flex gap-3 flex-wrap">
                    <span>卡片：{detailDeck.cardCount ?? detailCards.length}</span>
                    <span>点赞：{detailDeck.likeCount ?? 0}</span>
                    <span>收藏：{detailDeck.favoriteCount ?? 0}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      onImportDeck(detailDeck.id);
                      closeDetail();
                      onClose();
                    }}
                    className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700"
                  >
                    导入
                  </button>

                  {detailMode === 'edit' && (
                    <>
                      <button onClick={handleSaveDeck} className="px-3 py-1.5 text-sm bg-pink-600 text-white rounded-md hover:bg-pink-700">
                        保存
                      </button>
                      <button onClick={handlePrune} className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700">
                        清理不可用卡
                      </button>
                    </>
                  )}

                  <button onClick={closeDetail} className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">
                    返回列表
                  </button>
                </div>
              </div>

              {detailMode === 'edit' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">名称</label>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} className="input-field w-full" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">公开状态</label>
                    <select value={editIsPublic} onChange={(e) => setEditIsPublic(Number(e.target.value))} className="input-field w-full">
                      <option value={0}>私有</option>
                      <option value={1}>公开</option>
                    </select>
                  </div>
                  <div className="space-y-1 md:col-span-3">
                    <label className="text-xs font-medium text-gray-600">描述</label>
                    <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="input-field w-full min-h-[72px]" />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-lg border bg-white">
                  <div className="px-4 py-3 border-b flex items-center justify-between">
                    <div className="font-semibold">卡组卡片</div>
                    <div className="text-xs text-gray-500">不可用卡将显示占位符</div>
                  </div>
                  <div className="p-4 space-y-2">
                    {detailCards.length === 0 ? (
                      <div className="text-sm text-gray-500">暂无卡片</div>
                    ) : (
                      detailCards.map((c) => {
                        const { display, full } = buildTitleDisplay(c.displayName || '未命名');
                        return (
                          <div key={c.data_card_id} className={`flex items-center justify-between gap-3 rounded-md border p-3 ${c.isAccessible ? 'bg-white' : 'bg-gray-50'}`}>
                            <div className="min-w-0">
                              <div className="font-medium text-sm break-words" title={full}>
                                {display}
                                {!c.isAccessible && (
                                  <span className="ml-2 text-xs text-gray-500">
                                    （不可用：{c.reason === 'deleted' ? '已删除/回收站' : c.reason === 'banned' ? '封禁' : '他人私有/未审核'}）
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 mt-1">{c.displayType}</div>
                            </div>

                            {detailMode === 'edit' && (
                              <button
                                onClick={() => void handleRemoveDeckCard(c.data_card_id)}
                                className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                              >
                                移除
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {detailMode === 'edit' && (
                  <div className="rounded-lg border bg-white">
                    <div className="px-4 py-3 border-b flex items-center justify-between">
                      <div className="font-semibold">添加卡片（角色）</div>
                      <div className="flex items-center gap-2">
                        <select value={addSource} onChange={(e) => setAddSource(e.target.value as any)} className="input-field text-sm">
                          <option value="my">我的数据卡</option>
                          <option value="public">公开库</option>
                        </select>
                        <input
                          value={addSearch}
                          onChange={(e) => setAddSearch(e.target.value)}
                          placeholder="搜索名称/描述"
                          className="input-field text-sm w-56"
                        />
                      </div>
                    </div>

                    <div className="p-4 space-y-2">
                      {addLoading ? (
                        <div className="text-sm text-gray-500">加载中...</div>
                      ) : addCandidates.length === 0 ? (
                        <div className="text-sm text-gray-500">暂无结果</div>
                      ) : (
                        addCandidates.map((card: any) => {
                          const { display, full } = buildTitleDisplay(card.name || '未命名');
                          return (
                            <div key={card.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                              <div className="min-w-0">
                                <div className="text-sm font-medium break-words" title={full}>{display}</div>
                                <div className="text-xs text-gray-500 mt-1 truncate">{card.description || ''}</div>
                              </div>
                              <button
                                onClick={() => void handleAddCards([card.id])}
                                className="px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
                              >
                                添加
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'my' && (
                <div className="space-y-4">
                  <div className="rounded-lg border bg-white p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="font-semibold">新建卡组</div>
                      {!canCreate && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                          卡组数量已达上限
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-600">名称</label>
                        <input value={createName} onChange={(e) => setCreateName(e.target.value)} className="input-field w-full" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-600">公开状态</label>
                        <select value={createIsPublic} onChange={(e) => setCreateIsPublic(Number(e.target.value))} className="input-field w-full">
                          <option value={0}>私有</option>
                          <option value={1}>公开</option>
                        </select>
                      </div>
                      <div className="space-y-1 md:col-span-3">
                        <label className="text-xs font-medium text-gray-600">描述</label>
                        <textarea value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} className="input-field w-full min-h-[72px]" />
                      </div>
                    </div>
                    <div className="flex justify-end mt-3">
                      <button
                        disabled={loading || !canCreate}
                        onClick={() => void handleCreate()}
                        className={`px-3 py-1.5 text-sm rounded-md ${loading || !canCreate ? 'bg-gray-300 text-gray-600' : 'bg-pink-600 text-white hover:bg-pink-700'}`}
                      >
                        创建
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {myDecks.length === 0 ? (
                      <div className="text-sm text-gray-500">暂无卡组</div>
                    ) : (
                      myDecks.map((d) => (
                        <div key={d.id} className="rounded-lg border bg-white p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="font-semibold break-words">{d.name || '未命名卡组'}</div>
                                <span className={`text-xs px-2 py-0.5 rounded-full border ${statusLabel(d).className}`}>
                                  {statusLabel(d).label}
                                </span>
                              </div>
                              {d.description && <div className="text-sm text-gray-600 mt-1 break-words">{d.description}</div>}
                              <div className="text-xs text-gray-500 mt-2 flex gap-3 flex-wrap">
                                <span>卡片：{d.cardCount ?? 0}</span>
                                <span>点赞：{d.likeCount ?? 0}</span>
                                <span>收藏：{d.favoriteCount ?? 0}</span>
                              </div>
                            </div>
                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => {
                                  onImportDeck(d.id);
                                  onClose();
                                }}
                                className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700"
                              >
                                导入
                              </button>
                              <button onClick={() => void openDeckDetail(d, 'edit')} className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">
                                编辑
                              </button>
                              <button onClick={() => void handleDeleteDeck(d.id)} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700">
                                删除
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'public' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      value={publicSearch}
                      onChange={(e) => setPublicSearch(e.target.value)}
                      placeholder="搜索卡组名称/描述"
                      className="input-field w-72"
                    />
                    <select value={publicSortBy} onChange={(e) => setPublicSortBy(e.target.value as any)} className="input-field">
                      <option value="createdAt">最新</option>
                      <option value="likes">最多点赞</option>
                      <option value="favorites">最多收藏</option>
                    </select>
                    <button
                      onClick={() => {
                        setPublicOffset(0);
                        void loadPublicDecks(true);
                      }}
                      className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                    >
                      搜索
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {publicDecks.length === 0 ? (
                      <div className="text-sm text-gray-500">暂无公开卡组</div>
                    ) : (
                      publicDecks.map((d) => (
                        <div key={d.id} className="rounded-lg border bg-white p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-semibold break-words">{d.name || '未命名卡组'}</div>
                              <div className="text-xs text-gray-500 mt-1">作者：{d.username || '未知'}</div>
                              {d.description && <div className="text-sm text-gray-600 mt-2 break-words">{d.description}</div>}
                              <div className="text-xs text-gray-500 mt-2 flex gap-3 flex-wrap">
                                <span>卡片：{d.cardCount ?? 0}</span>
                                <span>点赞：{d.likeCount ?? 0}</span>
                                <span>收藏：{d.favoriteCount ?? 0}</span>
                              </div>
                            </div>
                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => {
                                  onImportDeck(d.id);
                                  onClose();
                                }}
                                className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700"
                              >
                                导入
                              </button>
                              <button onClick={() => void openDeckDetail(d, 'view')} className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">
                                详情
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mt-4 flex-wrap">
                            <button
                              onClick={() => void likeDeck(d.id)}
                              disabled={likedDeckIds.has(d.id)}
                              className={`px-3 py-1 text-sm rounded-md ${
                                likedDeckIds.has(d.id)
                                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                                  : 'bg-pink-600 text-white hover:bg-pink-700'
                              }`}
                            >
                              {likedDeckIds.has(d.id) ? '已点赞' : '点赞 +1'}
                            </button>
                            <button
                              onClick={() => void toggleFavorite(d)}
                              className={`px-3 py-1 text-sm rounded-md ${favoriteIds.has(d.id) ? 'bg-amber-600 text-white hover:bg-amber-700' : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'}`}
                            >
                              {favoriteIds.has(d.id) ? '已收藏' : '收藏'}
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {hasMorePublic && (
                    <div className="flex justify-center">
                      <button
                        onClick={() => void loadPublicDecks(false)}
                        className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                      >
                        加载更多
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'favorites' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {favoriteDecks.length === 0 ? (
                      <div className="text-sm text-gray-500">暂无收藏卡组</div>
                    ) : (
                      favoriteDecks.map((d) => (
                        <div key={d.id} className="rounded-lg border bg-white p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-semibold break-words">{d.name || '未命名卡组'}</div>
                              <div className="text-xs text-gray-500 mt-1">作者：{d.username || '未知'}</div>
                              {d.description && <div className="text-sm text-gray-600 mt-2 break-words">{d.description}</div>}
                              <div className="text-xs text-gray-500 mt-2 flex gap-3 flex-wrap">
                                <span>卡片：{d.cardCount ?? 0}</span>
                                <span>点赞：{d.likeCount ?? 0}</span>
                                <span>收藏：{d.favoriteCount ?? 0}</span>
                              </div>
                            </div>
                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => {
                                  onImportDeck(d.id);
                                  onClose();
                                }}
                                className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700"
                              >
                                导入
                              </button>
                              <button onClick={() => void openDeckDetail(d, 'view')} className="px-3 py-1.5 text-sm bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">
                                详情
                              </button>
                              <button
                                onClick={async () => {
                                  await deckFavoritesApi.removeFavorite(d.id);
                                  await refreshFavorites();
                                  await refreshFavoriteDecks();
                                  showToast('已取消收藏');
                                }}
                                className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700"
                              >
                                取消收藏
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t text-xs text-gray-500 flex items-center justify-between">
          <div>说明：卡组当前只提供“角色”数据卡的快捷导入与管理。</div>
          {loading && <div>处理中...</div>}
        </div>
      </div>
    </div>
  );
}
