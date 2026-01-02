'use client';

import { useMemo, useState } from 'react';

import { useBattleActions } from '../hooks/useBattleActions';
import { useBattleStore } from '../stores/useBattleStore';
import type { BattleStoreState, Combatant, CombatantData } from '../types';
import { getCombatantDisplayName } from '../utils/characterValidator';

interface CombatantListProps {
  onShowDetails: (combatant: CombatantData) => void;
}

const COMBATANT_TYPE_LABELS: Record<CombatantData['type'], string> = {
  'magical-girl': '魔法少女',
  canshou: '残兽',
  'general-character': '通用角色',
};

type IndexedCombatant = {
  combatant: Combatant;
  index: number;
};

const getCombatantKey = (combatant: Combatant) => ('id' in combatant ? combatant.id : combatant.filename);

const getCombatantIdentifier = getCombatantKey;

export function CombatantList({ onShowDetails }: CombatantListProps) {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const teams = useBattleSelector((state) => state.teams);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const removeCombatant = useBattleSelector((state) => state.removeCombatant);
  const moveCombatant = useBattleSelector((state) => state.moveCombatant);
  const addTeam = useBattleSelector((state) => state.addTeam);
  const removeTeam = useBattleSelector((state) => state.removeTeam);
  const renameTeam = useBattleSelector((state) => state.renameTeam);
  const toggleTeamCollapsed = useBattleSelector((state) => state.toggleTeamCollapsed);
  const updateCombatantTeam = useBattleSelector((state) => state.updateCombatantTeam);
  const updateCombatantCharacterGuidance = useBattleSelector((state) => state.updateCombatantCharacterGuidance);
  const { handleAddRandomPlaceholder, handleClearRoster } = useBattleActions();

  const [copiedStatus, setCopiedStatus] = useState<Record<string, boolean>>({});
  const [guidanceOpenFor, setGuidanceOpenFor] = useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [editingTeamName, setEditingTeamName] = useState<string>('');
  const [unassignedCollapsed, setUnassignedCollapsed] = useState(false);

  const teamNameMap = useMemo(() => {
    const map = new Map<number, string>();
    teams.forEach((team) => map.set(team.id, team.name));
    return map;
  }, [teams]);

  const getTeamLabel = (teamId: number | undefined) => {
    if (!teamId) return '未分队';
    const name = teamNameMap.get(teamId);
    return name && name.trim() ? name.trim() : `队伍 ${teamId}`;
  };

  const indexedCombatants = useMemo<IndexedCombatant[]>(
    () =>
      combatants.map((combatant, index) => ({
        combatant,
        index,
      })),
    [combatants]
  );

  const hasAnyTeam = useMemo(() => {
    if (teams.length > 0) return true;
    return combatants.some((c) => typeof c.teamId === 'number' && c.teamId > 0);
  }, [combatants, teams.length]);

  const combatantsByTeam = useMemo(() => {
    const byTeamId = new Map<number, IndexedCombatant[]>();
    const unassigned: IndexedCombatant[] = [];

    indexedCombatants.forEach((item) => {
      const teamId = item.combatant.teamId;
      if (!teamId) {
        unassigned.push(item);
        return;
      }
      const bucket = byTeamId.get(teamId) ?? [];
      bucket.push(item);
      byTeamId.set(teamId, bucket);
    });

    return { byTeamId, unassigned };
  }, [indexedCombatants]);

  const beginEditTeam = (teamId: number) => {
    const current = teams.find((t) => t.id === teamId);
    setEditingTeamId(teamId);
    setEditingTeamName(current?.name ?? `分队 ${teamId}`);
  };

  const commitEditTeam = () => {
    if (editingTeamId === null) return;
    renameTeam(editingTeamId, editingTeamName);
    setEditingTeamId(null);
    setEditingTeamName('');
  };

  const downloadJson = (combatant: CombatantData) => {
    const jsonData = JSON.stringify(combatant.data, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const baseName = getCombatantDisplayName(combatant.data);
    link.download = `${baseName}_修正版.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const copyJson = async (combatant: CombatantData) => {
    const jsonData = JSON.stringify(combatant.data, null, 2);
    await navigator.clipboard.writeText(jsonData);
    setCopiedStatus((prev) => ({ ...prev, [combatant.filename]: true }));
    setTimeout(() => {
      setCopiedStatus((prev) => ({ ...prev, [combatant.filename]: false }));
    }, 2000);
  };

  if (combatants.length === 0) {
    return null;
  }

  const renderCombatantRow = (combatant: Combatant, index: number) => {
    const isPlaceholder = 'id' in combatant;
    const key = getCombatantKey(combatant);
    const data = isPlaceholder ? null : (combatant as CombatantData);
    const displayName = isPlaceholder ? combatant.filename : getCombatantDisplayName(data?.data);
    const typeDisplay = isPlaceholder
      ? combatant.type === 'random-magical-girl'
        ? '(随机魔法少女)'
        : '(随机残兽)'
      : `(${COMBATANT_TYPE_LABELS[data!.type]})`;
    const canMoveUp = index > 0;
    const canMoveDown = index < combatants.length - 1;

    return (
      <div key={key} className="group rounded-lg bg-white/70 border border-gray-300 px-2 py-2">
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-1 pt-0.5">
            <button
              type="button"
              onClick={() => moveCombatant(index, index - 1)}
              disabled={isGenerating || !canMoveUp}
              className="w-6 h-6 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="上移"
              title="上移"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => moveCombatant(index, index + 1)}
              disabled={isGenerating || !canMoveDown}
              className="w-6 h-6 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="下移"
              title="下移"
            >
              ↓
            </button>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-start sm:gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-800 leading-snug break-words line-clamp-3" title={displayName}>
                  {displayName}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                  <span className="whitespace-nowrap">{typeDisplay}</span>
                  {!isPlaceholder && data?.isPreset && <span className="text-purple-600 whitespace-nowrap">(预设)</span>}
                  {!isPlaceholder && data?.isNonStandard && (
                    <span className="text-orange-500 font-semibold whitespace-nowrap">(非规范格式)</span>
                  )}
                  {!isPlaceholder && data?.wasCorrected && <span className="text-yellow-600 whitespace-nowrap">(格式已修正)</span>}
                </div>
              </div>

              <div className="mt-2 sm:mt-0 flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
                {!isPlaceholder && (
                  <>
                    <button
                      onClick={() => setGuidanceOpenFor((prev) => (prev === key ? null : key))}
                      className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                      disabled={isGenerating}
                      title="为该角色输入行动/想法引导（最多100字）"
                    >
                      行动
                    </button>
                    <button
                      onClick={() => onShowDetails(combatant as CombatantData)}
                      className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300"
                      disabled={isGenerating}
                    >
                      详情
                    </button>
                    {(combatant as CombatantData).wasCorrected && (
                      <>
                        <button
                          onClick={() => downloadJson(combatant as CombatantData)}
                          disabled={isGenerating}
                          className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                        >
                          下载
                        </button>
                        <button
                          onClick={() => copyJson(combatant as CombatantData)}
                          disabled={isGenerating}
                          className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 w-16"
                        >
                          {copiedStatus[(combatant as CombatantData).filename] ? '已复制!' : '复制'}
                        </button>
                      </>
                    )}
                  </>
                )}
                <button
                  onClick={() => !isGenerating && removeCombatant(getCombatantIdentifier(combatant))}
                  className={`w-5 h-5 bg-red-200 text-red-700 rounded-full flex items-center justify-center text-xs font-bold transition-colors flex-shrink-0 ${
                    isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-300'
                  }`}
                  aria-label={`移除 ${displayName}`}
                  disabled={isGenerating}
                >
                  X
                </button>
              </div>
            </div>

            {!isPlaceholder && guidanceOpenFor !== key && data?.characterGuidance?.trim() && (
              <div className="mt-1 text-xs text-gray-500 italic break-words">
                行动引导：{data.characterGuidance.trim()}
              </div>
            )}
          </div>
        </div>

        {!isPlaceholder && guidanceOpenFor === key && (
          <div className="mt-2 ml-8 p-2 rounded bg-white/70 border border-gray-300">
            <div className="text-xs text-gray-700 mb-1">角色行动引导（可选，最多100字）</div>
            <textarea
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 bg-white disabled:opacity-50"
              rows={3}
              maxLength={100}
              disabled={isGenerating}
              placeholder="例如：谨慎试探、优先保护同伴、尽量不杀、被恐惧支配、隐藏身份等"
              value={data?.characterGuidance ?? ''}
              onChange={(e) => updateCombatantCharacterGuidance((combatant as CombatantData).filename, e.target.value)}
            />
            <div className="mt-1 flex justify-between items-center text-xs text-gray-500">
              <span>{Array.from((data?.characterGuidance ?? '')).length}/100</span>
              <button
                type="button"
                className="px-2 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                onClick={() => setGuidanceOpenFor(null)}
                disabled={isGenerating}
              >
                收起
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mb-4 p-3 bg-gray-200 rounded-lg">
      <div className="flex justify-between items-center m-0 top-0 right-0">
        <p className="font-semibold text-sm text-gray-700">已选角色 ({combatants.length}/10):</p>
        <button
          onClick={handleClearRoster}
          disabled={isGenerating}
          className="text-sm text-red-500 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          清空列表
        </button>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => handleAddRandomPlaceholder('random-magical-girl')}
          disabled={isGenerating || combatants.length >= 10}
          className="text-xs flex-1 bg-pink-100 text-pink-700 px-3 py-1.5 rounded-lg hover:bg-pink-200 disabled:opacity-50"
        >
          + 添加随机魔法少女
        </button>
        <button
          onClick={() => handleAddRandomPlaceholder('random-canshou')}
          disabled={isGenerating || combatants.length >= 10}
          className="text-xs flex-1 bg-red-100 text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-200 disabled:opacity-50"
        >
          + 添加随机残兽
        </button>
      </div>

      <div className="flex justify-between items-center mt-3">
        <p className="text-xs text-gray-600">提示：不使用分队时，下面就是普通的角色列表；需要分队再新建即可。</p>
        <button
          type="button"
          onClick={() => {
            const id = addTeam();
            setUnassignedCollapsed(false);
            beginEditTeam(id);
          }}
          disabled={isGenerating}
          className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-50"
        >
          + 新建分队
        </button>
      </div>

      {!hasAnyTeam && <div className="mt-2 space-y-2">{combatants.map((c, idx) => renderCombatantRow(c, idx))}</div>}

      {hasAnyTeam && (
        <div className="mt-2 space-y-2">
          {(combatantsByTeam.unassigned.length > 0 || teams.length > 0) && (
            <div className="rounded-lg border border-gray-300 bg-white/50">
              <button
                type="button"
                className="w-full flex items-center justify-between px-2 py-2"
                onClick={() => setUnassignedCollapsed((v) => !v)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-gray-700">{unassignedCollapsed ? '▶' : '▼'}</span>
                  <span className="font-semibold text-sm text-gray-700">未分队</span>
                  <span className="text-xs text-gray-500">({combatantsByTeam.unassigned.length})</span>
                </div>

                {teams.length > 0 && (
                  <select
                    defaultValue=""
                    className="text-xs border border-gray-300 rounded px-1 py-1 bg-white disabled:opacity-50"
                    disabled={isGenerating || indexedCombatants.every((item) => !item.combatant.teamId)}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      if (!value) return;
                      updateCombatantTeam(value, null);
                      e.currentTarget.value = '';
                    }}
                    title="把某个已分队的角色移回未分队"
                  >
                    <option value="">移回未分队…</option>
                    {indexedCombatants
                      .filter((item) => item.combatant.teamId)
                      .map((item) => {
                        const identifier = getCombatantIdentifier(item.combatant);
                        const isPlaceholder = 'id' in item.combatant;
                        const data = isPlaceholder ? null : (item.combatant as CombatantData);
                        const name = isPlaceholder ? item.combatant.filename : getCombatantDisplayName(data?.data);
                        const label = `${name}（${getTeamLabel(item.combatant.teamId)}）`;
                        return (
                          <option key={identifier} value={identifier}>
                            {label}
                          </option>
                        );
                      })}
                  </select>
                )}
              </button>

              {!unassignedCollapsed && (
                <div className="p-2 pt-0 space-y-2">
                  {combatantsByTeam.unassigned.map((item) => renderCombatantRow(item.combatant, item.index))}
                </div>
              )}
            </div>
          )}

          {teams.map((team) => {
            const members = combatantsByTeam.byTeamId.get(team.id) ?? [];
            const isCollapsed = team.isCollapsed;

            return (
              <div key={team.id} className="rounded-lg border border-gray-300 bg-white/50">
                <div className="flex items-center justify-between px-2 py-2 gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-2 min-w-0"
                    onClick={() => toggleTeamCollapsed(team.id)}
                  >
                    <span className="text-xs text-gray-700">{isCollapsed ? '▶' : '▼'}</span>
                    {editingTeamId === team.id ? (
                      <input
                        className="text-sm font-semibold text-gray-700 border border-gray-300 rounded px-2 py-1 bg-white w-44"
                        value={editingTeamName}
                        disabled={isGenerating}
                        autoFocus
                        maxLength={50}
                        onChange={(e) => setEditingTeamName(e.target.value)}
                        onBlur={commitEditTeam}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEditTeam();
                          if (e.key === 'Escape') {
                            setEditingTeamId(null);
                            setEditingTeamName('');
                          }
                        }}
                        aria-label="分队名称"
                      />
                    ) : (
                      <span className="font-semibold text-sm text-gray-700 truncate" title={team.name}>
                        {team.name}
                      </span>
                    )}
                    <span className="text-xs text-gray-500">({members.length})</span>
                  </button>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <select
                      defaultValue=""
                      className="text-xs border border-gray-300 rounded px-1 py-1 bg-white disabled:opacity-50"
                      disabled={isGenerating || indexedCombatants.length === 0}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        if (!value) return;
                        updateCombatantTeam(value, team.id);
                        e.currentTarget.value = '';
                      }}
                      title="把角色加入/转移到该分队"
                    >
                      <option value="">添加/转移成员…</option>
                      {indexedCombatants
                        .filter((item) => item.combatant.teamId !== team.id)
                        .map((item) => {
                          const identifier = getCombatantIdentifier(item.combatant);
                          const isPlaceholder = 'id' in item.combatant;
                          const data = isPlaceholder ? null : (item.combatant as CombatantData);
                          const name = isPlaceholder ? item.combatant.filename : getCombatantDisplayName(data?.data);
                          return (
                            <option key={identifier} value={identifier}>
                              {name}（{getTeamLabel(item.combatant.teamId)}）
                            </option>
                          );
                        })}
                    </select>

                    <button
                      type="button"
                      onClick={() => beginEditTeam(team.id)}
                      disabled={isGenerating}
                      className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-50"
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (isGenerating) return;
                        if (!confirm(`确定删除分队「${team.name}」吗？成员会回到未分队。`)) return;
                        removeTeam(team.id);
                      }}
                      disabled={isGenerating}
                      className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 disabled:opacity-50"
                    >
                      删除
                    </button>
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="p-2 pt-0 space-y-2">
                    {members.length === 0 ? (
                      <div className="text-xs text-gray-500 px-1 py-2">暂无成员（可用右侧下拉框添加/转移）</div>
                    ) : (
                      members.map((item) => renderCombatantRow(item.combatant, item.index))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

