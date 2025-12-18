'use client';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState } from '../types';

const buttonTextMap: Record<string, string> = {
  daily: '流式生成日常故事 (´｡• ᵕ •｡`) ♡',
  kizuna: '流式生成宿命对决 (๑•̀ㅂ•́)و✧',
  classic: '流式生成独家新闻 _φ(❐_❐✧',
  scenario: '流式开始演绎情景 (´｡• ᵕ •｡`)',
};

interface StreamBattleActionsProps {
  onGenerate: () => void;
  isLoading: boolean;
}

export function StreamBattleActions({ onGenerate, isLoading }: StreamBattleActionsProps) {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const isMatching = useBattleSelector((state) => state.isMatching);

  const getButtonText = () => {
    if (isLoading) {
      switch (battleMode) {
        case 'daily':
          return '✨ 撰写日常逸闻中... (｡･ω･｡)ﾉ';
        case 'kizuna':
          return '✨ 描绘宿命对决中... (ง •̀_•́)ง';
        case 'classic':
          return '✨ 推演激烈战斗中... (ง •̀_•́)ง';
        case 'scenario':
          return '✨ 演绎指定剧本中... (｡･ω･｡)ﾉ';
        default:
          return '✨ 生成中...';
      }
    }
    return buttonTextMap[battleMode] || '🎬 开始生成战报';
  };

  return (
    <div className="text-center" style={{ marginTop: '1.5rem' }}>
      <button
        onClick={onGenerate}
        disabled={
          isLoading ||
          !!isMatching ||
          (battleMode === 'daily' || battleMode === 'scenario'
            ? combatants.length < 1
            : combatants.length < 2)
        }
        className="generate-button"
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1.1rem',
          fontWeight: 'bold',
          background: isLoading || isMatching
            ? 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)'
            : 'linear-gradient(135deg, #ff89c4ff 0%, #f65c83ff 100%)',
          color: 'white',
          border: 'none',
          cursor: isLoading || isMatching ? 'not-allowed' : 'pointer',
        }}
      >
        {getButtonText()}
      </button>
    </div>
  );
}
