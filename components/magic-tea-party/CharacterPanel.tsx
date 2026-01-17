import { useCallback, useMemo, useState } from 'react';

import DecksModal from '@/components/DecksModal';
import { downloadBlob } from '@/lib/client/blobUrl';
import { buildSafeFileName } from '@/lib/client/fileName';
import { deckApi } from '@/lib/auth';
import type { MagicTeaPartyRole, MagicTeaPartySession } from '@/lib/magic-tea-party/types';
import { buildTitleDisplay } from '@/lib/text';

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
  if (role.source === 'public') return '公开';
  if (role.source === 'cloud') return '私有';
  return '未知';
};

export function MagicTeaPartyCharacterPanel(props: MagicTeaPartyCharacterPanelProps) {
  const { activeSession, roles, isAuthenticated, onUpdateRoles, onUpdatePlayerRole, onToggleRoleCard } = props;
  const [showDecksModal, setShowDecksModal] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const playerRoleId = activeSession?.playerRoleId ?? null;
  const roleCount = roles.length;

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
        </div>
      </div>

      {importNotice ? <div className="text-xs text-emerald-600">{importNotice}</div> : null}
      {importError ? <div className="text-xs text-red-600">{importError}</div> : null}

      {roleCount === 0 ? (
        <div className="text-xs text-gray-500">暂无角色，先从右侧面板或预设中添加。</div>
      ) : (
        <div className="space-y-2">
          {roleCards.map((role) => (
            <div key={role.id} className="rounded-lg border border-pink-100 bg-pink-50/40 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-gray-800">{role.displayName}</div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    来源：{getRoleSourceLabel(role)} · 模板：{role.template || '未知'}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    type="button"
                    className="rounded-md border border-pink-200 bg-white px-2 py-1 text-xs text-pink-700 hover:bg-pink-50"
                    onClick={() => onUpdatePlayerRole(role.id)}
                    disabled={!activeSession}
                  >
                    {playerRoleId === role.id ? '玩家角色' : '设为玩家'}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    onClick={() => handleExportRole(role)}
                  >
                    导出
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    onClick={() => handleRemove(role.id)}
                  >
                    移除
                  </button>
                </div>
              </div>
              {role.card?.current_state ? (
                <div className="mt-2 text-[11px] text-gray-600">
                  当前状态：{typeof (role.card as any).current_state?.summary === 'string' ? (role.card as any).current_state.summary : '（未填写）'}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <DecksModal
        isOpen={showDecksModal}
        onClose={() => setShowDecksModal(false)}
        onImportDeck={(deckId) => void handleImportDeck(deckId)}
      />
    </div>
  );
}
