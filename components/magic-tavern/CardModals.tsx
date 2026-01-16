import BattleDataModal from '@/components/BattleDataModal';

type MagicTavernCardModalsProps = {
  showRoleModal: boolean;
  showScenarioModal: boolean;
  selectedRoleCardIds: string[];
  selectedScenarioCardIds: string[];
  onCloseRoleModal: () => void;
  onCloseScenarioModal: () => void;
  onToggleRoleCard: (payload: unknown, nextSelected: boolean) => void | Promise<void>;
  onToggleScenarioCard: (payload: unknown, nextSelected: boolean) => void | Promise<void>;
};

export function MagicTavernCardModals(props: MagicTavernCardModalsProps) {
  const {
    showRoleModal,
    showScenarioModal,
    selectedRoleCardIds,
    selectedScenarioCardIds,
    onCloseRoleModal,
    onCloseScenarioModal,
    onToggleRoleCard,
    onToggleScenarioCard,
  } = props;

  return (
    <>
      <BattleDataModal
        isOpen={showRoleModal}
        onClose={onCloseRoleModal}
        selectedType="character"
        selectionMode="multi"
        selectedCardIds={selectedRoleCardIds}
        onToggleCard={(payload, nextSelected) => void onToggleRoleCard(payload, nextSelected)}
        titleOverride="选择登场角色（多选）"
      />

      <BattleDataModal
        isOpen={showScenarioModal}
        onClose={onCloseScenarioModal}
        selectedType="scenario"
        selectionMode="multi"
        selectedCardIds={selectedScenarioCardIds}
        onToggleCard={(payload, nextSelected) => void onToggleScenarioCard(payload, nextSelected)}
        titleOverride="选择发生场景（多选）"
      />
    </>
  );
}
