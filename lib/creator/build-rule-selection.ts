import { tryLoadBuildRulePresetById } from './build-rules';

import type { CreatorTemplateId } from './templates';

type ReconcileCreatorBuildRuleSelectionInput = {
  template: CreatorTemplateId;
  selectedRuleIds: string[];
  primaryRuleId: string | null;
};

export function reconcileCreatorBuildRuleSelection({
  template,
  selectedRuleIds,
  primaryRuleId,
}: ReconcileCreatorBuildRuleSelectionInput): {
  selectedRuleIds: string[];
  primaryRuleId: string | null;
} {
  const compatibleRuleIds = selectedRuleIds.filter((ruleId) => {
    const preset = tryLoadBuildRulePresetById(ruleId);
    return Boolean(preset?.supportedTemplates.includes(template));
  });

  return {
    selectedRuleIds: compatibleRuleIds,
    primaryRuleId:
      primaryRuleId && compatibleRuleIds.includes(primaryRuleId)
        ? primaryRuleId
        : compatibleRuleIds[0] ?? null,
  };
}
