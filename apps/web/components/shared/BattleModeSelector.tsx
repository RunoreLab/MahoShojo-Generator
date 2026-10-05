'use client';

import { SegmentedControl, type SegmentedOption } from './SegmentedControl';

export type BattleModeKey = 'daily' | 'kizuna' | 'classic' | 'scenario';

const MODE_OPTIONS: readonly SegmentedOption<BattleModeKey>[] = [
  { value: 'daily', label: '日常模式', icon: '☕', description: '聚焦角色间的日常互动与故事。' },
  { value: 'kizuna', label: '羁绊模式', icon: '✨', description: '战斗更注重友情、羁绊与信念，能力强度并非唯一关键。' },
  { value: 'classic', label: '经典模式', icon: '⚔️', description: '主要依据角色能力设定与战斗推演规则决定结果。' },
  { value: 'scenario', label: '情景模式', icon: '📜', description: '结合所选情景卡的背景、规则与事件展开故事。' },
];

type BattleModeSelectorProps = {
  value: BattleModeKey;
  onChange: (next: BattleModeKey) => void;
  disabled?: boolean;
  label?: string;
  showHelper?: boolean;
};

const renderHelper = (battleMode: BattleModeKey) => {
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

export function BattleModeSelector({
  value,
  onChange,
  disabled = false,
  label = '选择故事模式',
  showHelper = true,
}: BattleModeSelectorProps) {
  return (
    <div className="input-group">
      <SegmentedControl label={label} value={value} options={MODE_OPTIONS} onChange={onChange} disabled={disabled} />
      {showHelper ? renderHelper(value) : null}
    </div>
  );
}
