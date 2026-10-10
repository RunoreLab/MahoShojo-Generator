import type { WebPackageRef, WebPackagePromptProjection } from '@mahoshojo/contracts/web-package';
import type { NarrativeHistoryEntry } from '@mahoshojo/domain/arena-types';
import { materializeArenaNarrativeHistoryForRequest } from '@mahoshojo/domain/narrative-history-operations';
import { buildBattleStoryArenaRequest, type BattleStoryArenaRequestInput } from '@mahoshojo/domain/arena-battle-story-request';

export type ArenaGenerationSnapshotSettings = Readonly<{
  userGuidance: string;
  readArenaHistory: boolean; readArenaHistoryLimit: number; isArenaHistoryUnlimited: boolean; writeArenaHistory: boolean;
  readCurrentState: boolean; writeCurrentState: boolean;
  readNarrativeHistory: boolean; readNarrativeHistoryLimit: number; isNarrativeHistoryUnlimited: boolean; writeNarrativeHistory: boolean;
}>;
export type ArenaGenerationSnapshotCombatant = Readonly<{
  type: string; data: any; isValid: boolean; isPreset: boolean; filename: string;
  teamId?: number; characterGuidance?: string; sourceDataCardId?: string; sourceDataCardUpdatedAt?: string;
}>;
export type ArenaGenerationInputSnapshot = Readonly<{
  combatants: readonly ArenaGenerationSnapshotCombatant[];
  teams: readonly { id: number; name: string }[];
  battleMode: 'classic' | 'kizuna' | 'daily' | 'scenario';
  reportFormat: 'markdown' | 'web';
  webPackageRef?: WebPackageRef | null;
  webPackagePromptProjection?: WebPackagePromptProjection;
  arenaFreeRankingEnabled: boolean;
  scenario: Readonly<{ content: Record<string, unknown> | null; fileName: string | null; sourceDataCardId?: string; sourceDataCardUpdatedAt?: string }>;
  scenarioDisplayName: string | null;
  auxScenarios: readonly { content: Record<string, unknown> }[];
  materials: readonly unknown[];
  selectedLanguage: string;
  settings: ArenaGenerationSnapshotSettings;
  narrativeHistoryEntries: readonly NarrativeHistoryEntry[];
  adjudicationEvents: readonly unknown[];
  storyLength: string;
  /** Normalized by the host's existing story-length adapter. */
  customStoryLength?: string;
  questionnaireSelections?: readonly unknown[];
  questionnaires?: readonly unknown[];
}>;

/** Business-only request projection. The host owns resolution, credentials, identity and dispatch. */
export const buildArenaGenerationInputSnapshot = (input: ArenaGenerationInputSnapshot) => {
  const { combatants: freshCombatants, teams: teamList, battleMode, reportFormat, webPackageRef,
    webPackagePromptProjection, arenaFreeRankingEnabled, scenario, scenarioDisplayName, auxScenarios,
    materials, selectedLanguage, settings, narrativeHistoryEntries, adjudicationEvents, storyLength,
    customStoryLength, questionnaireSelections, questionnaires } = input;
  const shouldUseScenario = battleMode === 'scenario' && Boolean(scenario.content);
  const teams: Record<number, string[]> = {};
  const teamNamesById = new Map<number, string>(
    teamList.map((team) => [team.id, typeof team.name === 'string' ? team.name.trim() : ''] as const)
  );

  freshCombatants.forEach((combatant) => {
    if (!combatant.teamId) return;
    if (!teams[combatant.teamId]) teams[combatant.teamId] = [];
    teams[combatant.teamId].push(combatant.data.codename || combatant.data.name);
  });

  const teamNames: Record<number, string> = {};
  Object.keys(teams).forEach((key) => {
    const teamId = Number(key);
    const name = teamNamesById.get(teamId);
    if (name) teamNames[teamId] = name;
  });

  const numericLimit = settings.isArenaHistoryUnlimited ? null : Math.max(1, settings.readArenaHistoryLimit);
  const arenaHistoryReadLimit = settings.readArenaHistory ? numericLimit ?? null : undefined;
  const localNarrativeHistory = materializeArenaNarrativeHistoryForRequest(
    settings,
    narrativeHistoryEntries,
  );
  const narrativeHistoryReadLimit = localNarrativeHistory.readLimit;
  const narrativeHistoryForRequest = localNarrativeHistory.entries;

  return {
    reportFormat,
    ...(reportFormat === 'web' && webPackageRef ? { webPackageRef } : {}),
    ...(webPackagePromptProjection ? { webPackagePromptProjection } : {}),
    combatants: freshCombatants.map((combatant) => ({
      type: combatant.type,
      data: combatant.data,
      isNative: combatant.isValid,
      isPreset: combatant.isPreset,
      filename: combatant.isPreset ? combatant.filename : null,
      teamId: typeof combatant.teamId === 'number' ? combatant.teamId : null,
      characterGuidance: typeof (combatant as any).characterGuidance === 'string' ? (combatant as any).characterGuidance : null,
      sourceDataCardId: combatant.sourceDataCardId,
      sourceDataCardUpdatedAt: combatant.sourceDataCardUpdatedAt,
    })),
    mode: battleMode,
    arenaFreeRankingEnabled,
    userGuidance: settings.userGuidance,
    scenario: shouldUseScenario ? scenario.content : undefined,
    auxScenarios: shouldUseScenario && auxScenarios.length > 0 ? auxScenarios.map((s) => s.content) : undefined,
    materials: materials.length > 0 ? materials : undefined,
    scenarioTitle: shouldUseScenario ? scenarioDisplayName : undefined,
    scenarioFileName: shouldUseScenario ? scenario.fileName : undefined,
    scenarioSourceDataCardId: shouldUseScenario ? scenario.sourceDataCardId : undefined,
    scenarioSourceDataCardUpdatedAt: shouldUseScenario ? scenario.sourceDataCardUpdatedAt : undefined,
    teams: Object.keys(teams).length > 0 ? teams : undefined,
    teamNames: Object.keys(teamNames).length > 0 ? teamNames : undefined,
    language: selectedLanguage,
    readArenaHistory: settings.readArenaHistory,
    arenaHistoryReadLimit,
    writeArenaHistory: settings.writeArenaHistory,
    readCurrentState: settings.readCurrentState,
    writeCurrentState: settings.writeCurrentState,
    readNarrativeHistory: settings.readNarrativeHistory,
    writeNarrativeHistory: settings.writeNarrativeHistory,
    narrativeHistoryReadLimit,
    narrativeHistory: narrativeHistoryForRequest,
    isDowngrade: false,
    adjudicationEvents,
    storyLength,
    customStoryLength: customStoryLength || undefined,
    questionnaireSelections,
    questionnaires,
  };
};

/** Controlled story seam. Arbitrary draft extensions never become internal guidance.
 * Uses the same business fields as Hosted session generation, with Direct output policy.
 */
export const buildArenaStoryGenerationInputSnapshot = (story: BattleStoryArenaRequestInput) => ({
  ...buildBattleStoryArenaRequest(story),
  reportFormat: 'markdown' as const,
  arenaFreeRankingEnabled: false,
  webPackageRef: undefined,
  webPackagePromptProjection: undefined,
  scenarioTitle: undefined,
  isDowngrade: false,
});
