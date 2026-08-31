'use client';

import {
  BattleModeSelector,
  type BattleModeKey,
} from '@/components/shared/BattleModeSelector';

type BattleModeControlProps = {
  value: BattleModeKey;
  onChange: (next: BattleModeKey) => void;
  disabled?: boolean;
  label?: string;
  showHelper?: boolean;
};

/** Arena 单人编辑与房间 Proposal 共用的纯受控模式选择。 */
export function BattleModeControl(props: BattleModeControlProps) {
  return <BattleModeSelector {...props} />;
}
