'use client';

import { useBattleStore } from '../stores/useBattleStore';

export function BattleModeSwitcher() {
  const battleMode = useBattleStore((state) => state.battleMode);
  const setBattleMode = useBattleStore((state) => state.setBattleMode);
  const isGenerating = useBattleStore((state) => state.isGenerating);

  const renderHelper = () => {
    switch (battleMode) {
      case 'daily':
        return (
          <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
            <p className="font-bold">你已选择【日常模式】！</p>
            <p className="mt-1">此模式下将聚焦于角色间的互动故事，而非战斗。</p>
          </div>
        );
      case 'kizuna':
        return (
          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            <p className="font-bold">你已选择【羁绊模式】！</p>
            <p className="mt-1">在此模式下，战斗将更注重友情、羁绊与信念，能力强度不再是唯一关键。</p>
          </div>
        );
      case 'classic':
        return (
          <div className="mt-2 p-3 bg-pink-50 border border-pink-200 rounded-lg text-sm text-pink-800">
            <p className="font-bold">你已选择【经典模式】！</p>
            <p className="mt-1">经典模式：战斗结果主要基于角色的能力设定和战斗推演规则。</p>
          </div>
        );
      case 'scenario':
        return null;
      default:
        return null;
    }
  };

  return (
    <div className="input-group">
      <label className="input-label">选择故事模式</label>
      <div className="flex items-center space-x-1 bg-gray-200 p-1 rounded-full">
        {([
          { key: 'daily', label: '日常模式☕' },
          { key: 'kizuna', label: '羁绊模式✨' },
          { key: 'classic', label: '经典模式⚔️' },
          { key: 'scenario', label: '情景模式📜' },
        ] as const).map((option) => (
          <button
            key={option.key}
            onClick={() => setBattleMode(option.key)}
            disabled={isGenerating}
            className={`w-1/4 py-2 text-sm font-semibold rounded-full transition-colors duration-300 ${
              battleMode === option.key ? 'bg-white text-pink-600 shadow' : 'text-gray-600 hover:bg-gray-300'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {renderHelper()}
    </div>
  );
}
