'use client';

import { useBattleStore } from '../stores/useBattleStore';
import { useBattleEngine } from '../hooks/useBattleEngine';
import { BattleStoreState } from '../types';

const buttonTextMap: Record<string, string> = {
  daily: '生成日常故事 (´｡• ᵕ •｡`) ♡',
  kizuna: '生成宿命对决 (๑•̀ㅂ•́)و✧',
  classic: '生成独家新闻 _φ(❐_❐✧',
  scenario: '开始演绎情景 (´｡• ᵕ •｡`)',
};

export function BattleActions() {
  const { handleGenerate, isGenerating, isCooldown, remainingTime } = useBattleEngine();
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const battleMode = useBattleSelector((state) => state.battleMode);

  const getButtonText = () => {
    if (isCooldown) return `记者赶稿中...请等待 ${remainingTime} 秒`;
    if (isGenerating) {
      switch (battleMode) {
        case 'daily':
          return '撰写日常逸闻中... (｡･ω･｡)ﾉ';
        case 'kizuna':
          return '描绘宿命对决中... (ง •̀_•́)ง';
        case 'classic':
          return '推演激烈战斗中... (ง •̀_•́)ง';
        case 'scenario':
          return '演绎指定剧本中... (｡･ω･｡)ﾉ';
        default:
          return '生成中...';
      }
    }
    return buttonTextMap[battleMode] || '生成战报';
  };

  return (
    <button
      onClick={() => handleGenerate()}
      disabled={
        isGenerating ||
        isCooldown ||
        (battleMode === 'daily' || battleMode === 'scenario'
          ? combatants.length < 1
          : combatants.length < 2)
      }
      className="generate-button"
    >
      {getButtonText()}
    </button>
  );
}
