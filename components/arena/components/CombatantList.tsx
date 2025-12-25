'use client';

import { useState } from 'react';

import { getCombatantDisplayName } from '../utils/characterValidator';
import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, CombatantData } from '../types';
import { useBattleActions } from '../hooks/useBattleActions';

interface CombatantListProps {
  onShowDetails: (combatant: CombatantData) => void;
}

const COMBATANT_TYPE_LABELS: Record<CombatantData['type'], string> = {
  'magical-girl': '魔法少女',
  canshou: '残兽',
  'general-character': '通用角色',
};

export function CombatantList({ onShowDetails }: CombatantListProps) {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const removeCombatant = useBattleSelector((state) => state.removeCombatant);
  const moveCombatant = useBattleSelector((state) => state.moveCombatant);
  const { handleAddRandomPlaceholder, handleTeamChange, handleClearRoster } = useBattleActions();
  const [copiedStatus, setCopiedStatus] = useState<Record<string, boolean>>({});

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

      <ul className="list-disc list-inside text-sm text-gray-600 mt-2 space-y-2">
        {combatants.map((combatant, index) => {
          const isPlaceholder = 'id' in combatant;
          const key = isPlaceholder ? combatant.id : combatant.filename;
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
            <li key={key} className="flex justify-between items-start group gap-2">
              <div className="flex flex-col gap-1 pt-0.5">
                <button
                  type="button"
                  onClick={() => moveCombatant(index, index - 1)}
                  disabled={isGenerating || !canMoveUp}
                  className="w-6 h-6 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={`上移 ${displayName}`}
                  title="上移"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveCombatant(index, index + 1)}
                  disabled={isGenerating || !canMoveDown}
                  className="w-6 h-6 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={`下移 ${displayName}`}
                  title="下移"
                >
                  ↓
                </button>
              </div>
              <div className="flex items-center flex-grow min-w-0">
                <span className="break-words mr-2" title={displayName}>
                  {displayName}
                  <span className="text-xs text-gray-500 ml-1">{typeDisplay}</span>
                  {!isPlaceholder && combatant.isPreset && <span className="text-xs text-purple-600 ml-1">(预设)</span>}
                  {!isPlaceholder && combatant.isValid && <span className="text-xs text-green-600 ml-1">(原生)</span>}
                  {!isPlaceholder && combatant.wasCorrected && <span className="text-xs text-yellow-600 ml-2">(格式已修正)</span>}
                  {!isPlaceholder && combatant.isNonStandard && (
                    <span className="text-xs text-orange-500 ml-1 font-semibold">(非规范格式)</span>
                  )}
                </span>
                {!isPlaceholder && (
                  <select
                    value={combatant.teamId || 0}
                    onChange={(e) => handleTeamChange(combatant.filename, parseInt(e.target.value, 10))}
                    className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white disabled:opacity-50 ml-auto"
                    disabled={isGenerating}
                  >
                    <option value={0}>无分队</option>
                    <option value={1}>队伍 1</option>
                    <option value={2}>队伍 2</option>
                    <option value={3}>队伍 3</option>
                    <option value={4}>队伍 4</option>
                  </select>
                )}
              </div>
              <div className="flex items-center flex-shrink-0">
                {!isPlaceholder && (
                  <>
                    <button
                      onClick={() => onShowDetails(combatant)}
                      className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300 mr-2"
                      disabled={isGenerating}
                    >
                      详情
                    </button>
                    {combatant.wasCorrected && (
                      <div className="flex gap-2 mr-2">
                        <button
                          onClick={() => downloadJson(combatant)}
                          disabled={isGenerating}
                          className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                        >
                          下载
                        </button>
                        <button
                          onClick={() => copyJson(combatant)}
                          disabled={isGenerating}
                          className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 w-16"
                        >
                          {copiedStatus[combatant.filename] ? '已复制!' : '复制'}
                        </button>
                      </div>
                    )}
                  </>
                )}
                <button
                  onClick={() => !isGenerating && removeCombatant(isPlaceholder ? combatant.id : combatant.filename)}
                  className={`w-5 h-5 bg-red-200 text-red-700 rounded-full flex items-center justify-center text-xs font-bold transition-colors flex-shrink-0 ${
                    isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-300'
                  }`}
                  aria-label={`移除 ${displayName}`}
                  disabled={isGenerating}
                >
                  X
                </button>
              </div>
            </li>
          );
        })}
      </ul>

    </div>
  );
}
