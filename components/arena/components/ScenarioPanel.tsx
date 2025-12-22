'use client';

import { ScenarioPickerPanel } from '@/components/shared/ScenarioPickerPanel';

import { useBattleStore } from '../stores/useBattleStore';
import { useBattleActions } from '../hooks/useBattleActions';
import { BattleStoreState } from '../types';

interface ScenarioPanelProps {
  onOpenScenarioModal: () => void;
  onRandomMatchScenario: () => void;
  isAuthenticated: boolean;
}

export function ScenarioPanel({
  onOpenScenarioModal,
  onRandomMatchScenario,
  isAuthenticated,
}: ScenarioPanelProps) {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const scenario = useBattleSelector((state) => state.scenario);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const isMatching = useBattleSelector((state) => state.isMatching);
  const setError = useBattleSelector((state) => state.setError);
  const { handleScenarioUpload, handleScenarioPaste } = useBattleActions();

  return (
    <ScenarioPickerPanel
      onOpenScenarioModal={onOpenScenarioModal}
      onRandomMatchScenario={onRandomMatchScenario}
      onScenarioUpload={handleScenarioUpload}
      onScenarioPaste={handleScenarioPaste}
      onActionError={(error) => setError(`❌ ${error.message}`)}
      isAuthenticated={isAuthenticated}
      isGenerating={isGenerating}
      isMatchingBlocked={isMatching !== null}
      isMatchingScenario={isMatching === 'scenario'}
      scenarioFileName={scenario.fileName || null}
      isScenarioNative={scenario.isNative}
    />
  );
}
