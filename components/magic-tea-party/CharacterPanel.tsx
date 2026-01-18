import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';

import DecksModal from '@/components/DecksModal';
import { downloadBlob } from '@/lib/client/blobUrl';
import { buildSafeFileName } from '@/lib/client/fileName';
import { dataCardApi, deckApi } from '@/lib/auth';
import { inferTemplate } from '@/lib/data-card-converter';
import type { MagicTeaPartyRole, MagicTeaPartySession } from '@/lib/magic-tea-party/types';
import { buildTitleDisplay } from '@/lib/text';
import type { ArenaHistory, ArenaHistoryEntry, CharacterCurrentState } from '@/types/arena';

type MagicTeaPartyCharacterPanelProps = {
  activeSession: MagicTeaPartySession | null;
  roles: MagicTeaPartyRole[];
  isAuthenticated: boolean;
  onUpdateRoles: (roles: MagicTeaPartyRole[]) => void;
  onUpdatePlayerRole: (roleId: string | null) => void;
  onToggleRoleCard: (payload: unknown, nextSelected: boolean) => void | Promise<void>;
};

const parseDataCardPayload = (raw: unknown): any => {
  if (typeof raw === 'string') return JSON.parse(raw);
  if (raw && typeof raw === 'object') return raw;
  throw new Error('数据卡内容为空或格式不受支持。');
};

const getRoleSourceLabel = (role: MagicTeaPartyRole): string => {
  if (role.source === 'preset') return '预设';
  if (role.source === 'local') return '本地';
  if (role.source === 'tavern') return '酒馆';
  if (role.source === 'public') return '公开';
  if (role.source === 'cloud') return '私有';
  return '未知';
};

const safeCloneCard = (card: Record<string, unknown> | undefined): Record<string, unknown> => {
  if (!card) return {};
  try {
    return JSON.parse(JSON.stringify(card)) as Record<string, unknown>;
  } catch {
    return { ...card };
  }
};

const readArenaHistory = (role: MagicTeaPartyRole): ArenaHistory | null => {
  const raw = (role.card as any)?.arena_history ?? (role.card as any)?.arenaHistory ?? null;
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as ArenaHistory;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === 'object') return raw as ArenaHistory;
  return null;
};

const readArenaHistoryEntries = (role: MagicTeaPartyRole): ArenaHistoryEntry[] => {
  const history = readArenaHistory(role);
  if (history && Array.isArray(history.entries)) return history.entries as ArenaHistoryEntry[];
  const raw = (role.card as any)?.arena_history ?? (role.card as any)?.arenaHistory ?? null;
  if (Array.isArray(raw)) return raw as ArenaHistoryEntry[];
  return [];
};

const readCurrentState = (role: MagicTeaPartyRole): CharacterCurrentState | null => {
  const raw = (role.card as any)?.current_state ?? (role.card as any)?.currentState ?? null;
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as CharacterCurrentState;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === 'object') return raw as CharacterCurrentState;
  return null;
};

const buildRoleBadges = (role: MagicTeaPartyRole): { text: string; tone: 'pink' | 'gray' | 'amber' | 'blue' }[] => {
  const badges: { text: string; tone: 'pink' | 'gray' | 'amber' | 'blue' }[] = [];
  if (role.source === 'preset') badges.push({ text: '预设', tone: 'pink' });
  if (role.source === 'local') badges.push({ text: '本地', tone: 'gray' });
  if (role.source === 'tavern') badges.push({ text: '酒馆', tone: 'blue' });
  if (role.source === 'cloud') badges.push({ text: '私有', tone: 'blue' });
  if (role.source === 'public') badges.push({ text: '公开', tone: 'blue' });
  if (role.template) badges.push({ text: `模板:${role.template}`, tone: 'amber' });
  if (role.isNative === false) badges.push({ text: '非原生', tone: 'gray' });
  return badges;
};

const getBadgeClassName = (tone: 'pink' | 'gray' | 'amber' | 'blue') => {
  if (tone === 'pink') return 'bg-pink-50 text-pink-700 border-pink-100';
  if (tone === 'amber') return 'bg-amber-50 text-amber-700 border-amber-100';
  if (tone === 'blue') return 'bg-sky-50 text-sky-700 border-sky-100';
  return 'bg-gray-50 text-gray-600 border-gray-100';
};

export function MagicTeaPartyCharacterPanel(props: MagicTeaPartyCharacterPanelProps) {
  const { activeSession, roles, isAuthenticated, onUpdateRoles, onUpdatePlayerRole, onToggleRoleCard } = props;
  const [showDecksModal, setShowDecksModal] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'edit' | 'history' | 'cloud'>('overview');
  const [draftName, setDraftName] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftCurrentState, setDraftCurrentState] = useState('');
  const [draftCardText, setDraftCardText] = useState('');
  const [showRawEditor, setShowRawEditor] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const [draggingRoleId, setDraggingRoleId] = useState<string | null>(null);
  const [cloudName, setCloudName] = useState('');
  const [cloudDescription, setCloudDescription] = useState('');
  const [cloudIsPublic, setCloudIsPublic] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudNotice, setCloudNotice] = useState<string | null>(null);

  const playerRoleId = activeSession?.playerRoleId ?? null;
  const roleCount = roles.length;
  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null;
  const hasSession = Boolean(activeSession);

  const handleRemove = useCallback(
    (roleId: string) => {
      const next = roles.filter((role) => role.id !== roleId);
      onUpdateRoles(next);
      if (playerRoleId === roleId) {
        onUpdatePlayerRole(null);
      }
    },
    [onUpdatePlayerRole, onUpdateRoles, playerRoleId, roles]
  );

  const handleClearAll = useCallback(() => {
    onUpdateRoles([]);
    onUpdatePlayerRole(null);
  }, [onUpdatePlayerRole, onUpdateRoles]);

  const handleExportRole = useCallback((role: MagicTeaPartyRole) => {
    const payload = JSON.stringify(role.card ?? {}, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const filename = buildSafeFileName(role.name || 'magic-tea-party-role', 'json', 'magic-tea-party-role');
    downloadBlob(blob, filename);
  }, []);

  const handleMoveRole = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      if (fromIndex < 0 || toIndex < 0) return;
      if (fromIndex >= roles.length || toIndex >= roles.length) return;
      const next = [...roles];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      onUpdateRoles(next);
    },
    [onUpdateRoles, roles]
  );

  const handleDragStart = (roleId: string) => (event: DragEvent<HTMLDivElement>) => {
    setDraggingRoleId(roleId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', roleId);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (targetRoleId: string) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData('text/plain') || draggingRoleId;
    if (!sourceId || sourceId === targetRoleId) return;
    const fromIndex = roles.findIndex((role) => role.id === sourceId);
    const toIndex = roles.findIndex((role) => role.id === targetRoleId);
    handleMoveRole(fromIndex, toIndex);
    setDraggingRoleId(null);
  };

  const handleDragEnd = () => {
    setDraggingRoleId(null);
  };

  const resetRoleDraft = useCallback(
    (role: MagicTeaPartyRole | null) => {
      if (!role) {
        setDraftName('');
        setDraftNotes('');
        setDraftCurrentState('');
        setDraftCardText('');
        setCloudName('');
        setCloudDescription('');
        setCloudIsPublic(false);
        return;
      }
      setDraftName(role.name ?? '');
      setDraftNotes(role.notes ?? '');
      const currentState = readCurrentState(role);
      setDraftCurrentState(currentState?.summary ?? '');
      setDraftCardText(JSON.stringify(role.card ?? {}, null, 2));
      setCloudName(role.name ?? '');
      setCloudDescription(
        typeof (role.card as any)?.description === 'string' ? String((role.card as any).description) : role.notes ?? ''
      );
      setCloudIsPublic(role.source === 'public');
    },
    []
  );

  const handleSaveRole = useCallback(() => {
    if (!selectedRole) return;
    const trimmedName = draftName.trim();
    if (!trimmedName) {
      setEditError('角色名称不能为空。');
      return;
    }
    let nextCard: Record<string, unknown> = safeCloneCard(selectedRole.card);
    if (showRawEditor) {
      try {
        nextCard = JSON.parse(draftCardText || '{}') as Record<string, unknown>;
      } catch {
        setEditError('角色卡 JSON 解析失败，请检查格式。');
        return;
      }
    }

    const template = inferTemplate(nextCard);
    if (template === 'magical-girl') {
      nextCard.codename = trimmedName;
    } else {
      nextCard.name = trimmedName;
    }

    if (draftCurrentState.trim()) {
      const currentState = (nextCard.current_state && typeof nextCard.current_state === 'object'
        ? { ...(nextCard.current_state as Record<string, unknown>) }
        : {}) as Record<string, unknown>;
      currentState.summary = draftCurrentState.trim();
      currentState.updated_at = new Date().toISOString();
      nextCard.current_state = currentState;
    } else if (nextCard.current_state && typeof nextCard.current_state === 'object') {
      const currentState = { ...(nextCard.current_state as Record<string, unknown>) };
      currentState.summary = '';
      nextCard.current_state = currentState;
    }

    const nextRole: MagicTeaPartyRole = {
      ...selectedRole,
      name: trimmedName,
      notes: draftNotes.trim() ? draftNotes.trim() : undefined,
      card: nextCard,
      template:
        template === 'magical-girl' || template === 'canshou' || template === 'general' ? template : selectedRole.template,
    };

    const nextRoles = roles.map((role) => (role.id === selectedRole.id ? nextRole : role));
    onUpdateRoles(nextRoles);
    setEditError(null);
    setEditNotice('角色修改已保存到本地会话。');
  }, [draftCardText, draftCurrentState, draftName, draftNotes, onUpdateRoles, roles, selectedRole, showRawEditor]);

  const handleSaveToCloud = useCallback(
    async (mode: 'create' | 'replace') => {
      if (!selectedRole) return;
      if (!isAuthenticated) {
        setCloudError('登录后才能保存到云端。');
        return;
      }
      const trimmedName = cloudName.trim() || selectedRole.name || '角色';
      const trimmedDescription = cloudDescription.trim();
      const payloadCard = safeCloneCard(selectedRole.card ?? {});
      setCloudBusy(true);
      setCloudError(null);
      setCloudNotice(null);
      try {
        if (mode === 'create') {
          const result = await dataCardApi.createCard('character', trimmedName, trimmedDescription, payloadCard, cloudIsPublic ? 1 : 0);
          if (!result.success || !result.id) {
            throw new Error(result.error || '保存失败');
          }
          const nextRole: MagicTeaPartyRole = {
            ...selectedRole,
            dataCardId: String(result.id),
            source: cloudIsPublic ? 'public' : 'cloud',
          };
          const nextRoles = roles.map((role) => (role.id === selectedRole.id ? nextRole : role));
          onUpdateRoles(nextRoles);
          setCloudNotice('已保存到云端数据卡。');
        } else {
          const cardId = selectedRole.dataCardId;
          if (!cardId) {
            throw new Error('未找到云端数据卡 ID，无法替换。');
          }
          const result = await dataCardApi.replaceCard(cardId, {
            name: trimmedName,
            description: trimmedDescription,
            isPublic: cloudIsPublic ? 1 : 0,
            data: payloadCard,
          });
          if (!result.success) {
            throw new Error(result.error || '替换失败');
          }
          const nextRole: MagicTeaPartyRole = {
            ...selectedRole,
            source: cloudIsPublic ? 'public' : 'cloud',
          };
          const nextRoles = roles.map((role) => (role.id === selectedRole.id ? nextRole : role));
          onUpdateRoles(nextRoles);
          setCloudNotice(result.pendingReview ? '已提交替换，正在审核。' : '云端数据卡已替换。');
        }
      } catch (err) {
        setCloudError(err instanceof Error ? err.message : '云端保存失败');
      } finally {
        setCloudBusy(false);
      }
    },
    [cloudDescription, cloudIsPublic, cloudName, isAuthenticated, onUpdateRoles, roles, selectedRole]
  );

  const handleImportDeck = useCallback(
    async (deckId: string) => {
      if (!activeSession) return;
      if (!deckId) return;
      setImportError(null);
      setImportNotice(null);
      try {
        const detail = await deckApi.getDeckCards(deckId);
        const entries = Array.isArray(detail?.cards) ? detail.cards : [];
        let imported = 0;

        for (const entry of entries) {
          if (!entry?.isAccessible || !entry?.card) continue;
          const card = entry.card;
          if (card.type !== 'character') continue;

          const cardId = typeof card?.id === 'string' ? card.id : '';
          if (!cardId) continue;

          const cardData = parseDataCardPayload(card.data);
          const payload = {
            ...cardData,
            _cardId: card.id,
            _cardName: card.name,
            _cardDescription: card.description || '',
            _isPublic: card.is_public,
            _updatedAt: card.updated_at,
            _createdAt: card.created_at,
            _author: card.username || '未知',
            _likeCount: typeof card.like_count === 'number' ? card.like_count : undefined,
            _favoriteCount: typeof card.favorite_count === 'number' ? card.favorite_count : undefined,
            _usageCount: typeof card.usage_count === 'number' ? card.usage_count : undefined,
          };

          await onToggleRoleCard(payload, true);
          imported += 1;
        }

        setImportNotice(imported > 0 ? `已导入 ${imported} 张角色卡。` : '卡组中暂无可导入的角色卡。');
      } catch (err) {
        setImportError(err instanceof Error ? err.message : '卡组导入失败');
      }
    },
    [activeSession, onToggleRoleCard]
  );

  const roleCards = useMemo(
    () =>
      roles.map((role) => {
        const { display } = buildTitleDisplay(role.name || '未命名');
        return { ...role, displayName: display };
      }),
    [roles]
  );

  useEffect(() => {
    if (!selectedRoleId && roles.length > 0) {
      setSelectedRoleId(roles[0]?.id ?? null);
      return;
    }
    if (selectedRoleId && !roles.some((role) => role.id === selectedRoleId)) {
      setSelectedRoleId(roles[0]?.id ?? null);
    }
  }, [roles, selectedRoleId]);

  useEffect(() => {
    resetRoleDraft(selectedRole);
    setEditError(null);
    setEditNotice(null);
    setCloudError(null);
    setCloudNotice(null);
    setActiveTab('overview');
    setShowRawEditor(false);
  }, [resetRoleDraft, selectedRole]);

  return (
    <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-800">角色面板</div>
        <div className="flex items-center gap-2 text-xs">
          {isAuthenticated ? (
            <button
              type="button"
              className="rounded-lg border border-pink-200 bg-white px-3 py-1.5 text-xs font-semibold text-pink-700 hover:bg-pink-50"
              onClick={() => setShowDecksModal(true)}
              disabled={!activeSession}
            >
              卡组导入
            </button>
          ) : null}
          {roleCount > 0 ? (
            <button
              type="button"
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              onClick={handleClearAll}
              disabled={!activeSession}
            >
              清空全部
            </button>
          ) : null}
          <button
            type="button"
            className="text-xs text-pink-700 hover:underline"
            onClick={() => setCollapsed((prev) => !prev)}
          >
            {collapsed ? '展开' : '收起'}
          </button>
        </div>
      </div>

      {importNotice ? <div className="text-xs text-emerald-600">{importNotice}</div> : null}
      {importError ? <div className="text-xs text-red-600">{importError}</div> : null}

      {collapsed ? (
        <div className="text-xs text-gray-500">
          {!hasSession
            ? '尚未选择会话，展开后可查看或编辑角色。'
            : roleCount === 0
              ? '暂无角色，展开可导入或添加。'
              : `共 ${roleCount} 名角色，当前：${selectedRole?.name ?? '未选择'}`}
        </div>
      ) : (
        <>
          {roleCount === 0 ? (
            <div className="text-xs text-gray-500">暂无角色，先从右侧面板或预设中添加。</div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-2">
                {roleCards.map((role, index) => {
                  const badges = buildRoleBadges(role);
                  const currentState = readCurrentState(role);
                  return (
                    <div
                      key={role.id}
                      className={`cursor-pointer rounded-lg border px-3 py-2 transition ${
                        selectedRoleId === role.id ? 'border-pink-300 bg-pink-50/60 shadow-sm' : 'border-pink-100 bg-white'
                      }`}
                      draggable
                      onDragStart={handleDragStart(role.id)}
                      onDragOver={handleDragOver}
                      onDragEnd={handleDragEnd}
                      onDrop={handleDrop(role.id)}
                      onClick={() => setSelectedRoleId(role.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <span className="mt-1 text-xs text-gray-300" title="拖拽排序">
                            ≡
                          </span>
                          <div>
                            <div className="text-sm font-semibold text-gray-800">{role.displayName}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {badges.map((badge) => (
                                <span
                                  key={`${role.id}-${badge.text}`}
                                  className={`rounded-full border px-2 py-0.5 text-[10px] ${getBadgeClassName(badge.tone)}`}
                                >
                                  {badge.text}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 text-xs text-gray-400">
                          <button
                            type="button"
                            className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-50"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleMoveRole(index, index - 1);
                            }}
                            disabled={index === 0 || !activeSession}
                            title="上移"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-50"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleMoveRole(index, index + 1);
                            }}
                            disabled={index === roleCards.length - 1 || !activeSession}
                            title="下移"
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 text-[11px] text-gray-600">
                        当前状态：{currentState?.summary ? currentState.summary : '（未填写）'}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg border border-pink-100 bg-pink-50/30 p-3">
                {selectedRole ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-gray-800">{selectedRole.name}</div>
                        <div className="mt-1 text-[11px] text-gray-500">
                          来源：{getRoleSourceLabel(selectedRole)} · 模板：{selectedRole.template || '未知'}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <button
                          type="button"
                          className="rounded-md border border-pink-200 bg-white px-2 py-1 text-xs text-pink-700 hover:bg-pink-50"
                          onClick={() => onUpdatePlayerRole(selectedRole.id)}
                          disabled={!activeSession}
                        >
                          {playerRoleId === selectedRole.id ? '玩家角色' : '设为玩家'}
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                          onClick={() => handleExportRole(selectedRole)}
                        >
                          导出
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                          onClick={() => handleRemove(selectedRole.id)}
                        >
                          移除
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      {(['overview', 'edit', 'history', 'cloud'] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                            activeTab === tab
                              ? 'border-pink-300 bg-white text-pink-700'
                              : 'border-transparent bg-transparent text-gray-500 hover:text-gray-700'
                          }`}
                          onClick={() => setActiveTab(tab)}
                        >
                          {tab === 'overview' && '概览'}
                          {tab === 'edit' && '编辑'}
                          {tab === 'history' && '历战'}
                          {tab === 'cloud' && '云端'}
                        </button>
                      ))}
                    </div>

                    {activeTab === 'overview' ? (
                      <div className="space-y-2 text-xs text-gray-600">
                        <div>
                          <span className="font-semibold text-gray-700">当前状态：</span>
                          {readCurrentState(selectedRole)?.summary || '（未填写）'}
                        </div>
                        <div>
                          <span className="font-semibold text-gray-700">历战条目：</span>
                          {readArenaHistoryEntries(selectedRole).length} 条
                        </div>
                        {selectedRole.notes ? (
                          <div>
                            <span className="font-semibold text-gray-700">备注：</span>
                            {selectedRole.notes}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {activeTab === 'edit' ? (
                      <div className="space-y-3">
                        {editNotice ? <div className="text-xs text-emerald-600">{editNotice}</div> : null}
                        {editError ? <div className="text-xs text-red-600">{editError}</div> : null}
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="text-xs font-semibold text-gray-600">角色名称</label>
                            <input
                              className="input-field"
                              value={draftName}
                              onChange={(event) => setDraftName(event.target.value)}
                              disabled={!activeSession}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-semibold text-gray-600">角色备注</label>
                            <input
                              className="input-field"
                              value={draftNotes}
                              onChange={(event) => setDraftNotes(event.target.value)}
                              placeholder="可选"
                              disabled={!activeSession}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-gray-600">当前状态摘要</label>
                          <textarea
                            className="input-field h-24 resize-y"
                            value={draftCurrentState}
                            onChange={(event) => setDraftCurrentState(event.target.value)}
                            placeholder="更新角色当前状态摘要"
                            disabled={!activeSession}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">高级：直接编辑角色卡 JSON。</span>
                          <button
                            type="button"
                            className="text-xs text-pink-700 hover:underline"
                            onClick={() => setShowRawEditor((prev) => !prev)}
                            disabled={!activeSession}
                          >
                            {showRawEditor ? '收起 JSON 编辑' : '编辑角色卡 JSON'}
                          </button>
                        </div>
                        {showRawEditor ? (
                          <textarea
                            className="input-field h-48 resize-y font-mono text-[11px]"
                            value={draftCardText}
                            onChange={(event) => setDraftCardText(event.target.value)}
                            disabled={!activeSession}
                          />
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="rounded-lg bg-pink-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={handleSaveRole}
                            disabled={!activeSession}
                          >
                            保存修改
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                            onClick={() => resetRoleDraft(selectedRole)}
                            disabled={!activeSession}
                          >
                            重置
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {activeTab === 'history' ? (
                      <div className="space-y-2 text-xs text-gray-600">
                        {readArenaHistoryEntries(selectedRole).length === 0 ? (
                          <div className="text-xs text-gray-500">暂无历战记录。</div>
                        ) : (
                          readArenaHistoryEntries(selectedRole).map((entry) => (
                            <div key={`${selectedRole.id}-${entry.id}`} className="rounded-md border border-pink-100 bg-white px-3 py-2">
                              <div className="text-sm font-semibold text-gray-800">{entry.title || '未命名战报'}</div>
                              <div className="mt-1 text-[11px] text-gray-500">
                                类型：{entry.type} · 胜者：{entry.winner || '未知'}
                              </div>
                              {entry.participants && entry.participants.length > 0 ? (
                                <div className="mt-1 text-[11px] text-gray-500">
                                  参战者：{entry.participants.join(' / ')}
                                </div>
                              ) : null}
                              {entry.impact ? <div className="mt-1 text-[11px] text-gray-600">影响：{entry.impact}</div> : null}
                            </div>
                          ))
                        )}
                        {readArenaHistory(selectedRole)?.attributes ? (
                          <div className="text-[11px] text-gray-400">
                            世界线：{readArenaHistory(selectedRole)?.attributes.world_line_id}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {activeTab === 'cloud' ? (
                      <div className="space-y-2 text-xs text-gray-600">
                        {!isAuthenticated ? <div className="text-xs text-red-600">登录后才能保存到云端。</div> : null}
                        {cloudNotice ? <div className="text-xs text-emerald-600">{cloudNotice}</div> : null}
                        {cloudError ? <div className="text-xs text-red-600">{cloudError}</div> : null}
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-gray-600">云端名称</label>
                            <input
                              className="input-field"
                              value={cloudName}
                              onChange={(event) => setCloudName(event.target.value)}
                              disabled={!isAuthenticated || cloudBusy}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-gray-600">公开状态</label>
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={cloudIsPublic}
                                onChange={(event) => setCloudIsPublic(event.target.checked)}
                                disabled={!isAuthenticated || cloudBusy}
                              />
                              <span>设为公开</span>
                            </label>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-semibold text-gray-600">简介</label>
                          <textarea
                            className="input-field h-20 resize-y"
                            value={cloudDescription}
                            onChange={(event) => setCloudDescription(event.target.value)}
                            disabled={!isAuthenticated || cloudBusy}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="rounded-lg bg-pink-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => void handleSaveToCloud('create')}
                            disabled={!isAuthenticated || cloudBusy}
                          >
                            保存到云端
                          </button>
                          {selectedRole.dataCardId ? (
                            <button
                              type="button"
                              className="rounded-lg border border-pink-200 bg-white px-3 py-1.5 text-xs font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => void handleSaveToCloud('replace')}
                              disabled={!isAuthenticated || cloudBusy}
                            >
                              替换云端内容
                            </button>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          如需同步本地编辑，请先在“编辑”中保存修改，再执行云端保存/替换。
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">选择一个角色查看详情。</div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <DecksModal
        isOpen={showDecksModal}
        onClose={() => setShowDecksModal(false)}
        onImportDeck={(deckId) => void handleImportDeck(deckId)}
      />
    </div>
  );
}
