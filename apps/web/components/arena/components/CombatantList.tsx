'use client';

import { ArenaRosterSection } from '../editor/features/roster/ArenaRosterSection';
import { useSoloRosterSectionModel } from '../editor/features/roster/useSoloRosterSection';
import type { CombatantData } from '../types';

interface CombatantListProps {
  onShowDetails: (combatant: CombatantData) => void;
}

/**
 * 单人 roster 区块入口：区块级组装已收口到 editor/features/roster 共享视图，
 * 这里只保留单人 adapter（battle store + 排位/技术值增强）的接线。
 */
export function CombatantList({ onShowDetails }: CombatantListProps) {
  const model = useSoloRosterSectionModel({ onShowDetails });
  return <ArenaRosterSection model={model} />;
}
