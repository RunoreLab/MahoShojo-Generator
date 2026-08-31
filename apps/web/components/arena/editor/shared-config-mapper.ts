import {
  ArenaRoomSharedConfigSchema,
  type ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import type {
  ArenaEditorCombatantView,
  ArenaEditorMaterialView,
  ArenaEditorScenarioView,
  ArenaEditorTeamView,
} from './types';
import type { BattleStoreState, Combatant, ScenarioState } from '../types';
import type { ArenaMaterialState } from '@/lib/arena/materials';

export type ArenaEditorViewProjection = Readonly<{
  combatants: readonly ArenaEditorCombatantView[];
  teams: readonly ArenaEditorTeamView[];
  scenario: ArenaEditorScenarioView | null;
  auxScenarios: readonly ArenaEditorScenarioView[];
  materials: readonly ArenaEditorMaterialView[];
  battleMode: ArenaRoomSharedConfig['battleMode'];
  storyLength: ArenaRoomSharedConfig['storyLength'];
  customStoryLength: string;
  selectedLanguage: string;
  userGuidance: string;
  historySettings: ArenaRoomSharedConfig['historySettings'];
  busy: boolean;
}>;

const freezeArray = <T>(input: readonly T[]): readonly T[] => Object.freeze(input);

const sourceOfKey = (key: string): 'data-card' | 'preset' => (
  key.startsWith('preset:') ? 'preset' : 'data-card'
);

const sharedReference = (
  entry: { readonly ref: { readonly id: string; readonly versionToken: string } },
) => Object.freeze({
  id: entry.ref.id,
  versionToken: entry.ref.versionToken,
});

const sharedScenarioView = (
  entry:
    | NonNullable<ArenaRoomSharedConfig['scenario']>
    | ArenaRoomSharedConfig['materials'][number],
): ArenaEditorScenarioView => {
  if ('ref' in entry) {
    return Object.freeze({
      key: entry.key,
      name: entry.ref.id,
      source: sourceOfKey(entry.key),
      access: 'reference' as const,
      reference: sharedReference(entry),
    });
  }
  return Object.freeze({
    key: entry.key,
    name: entry.displayName,
    source: 'host-local' as const,
    access: 'stub' as const,
    reference: null,
  });
};

export const cloneArenaEditorSharedConfig = (
  input: unknown,
): ArenaRoomSharedConfig => ArenaRoomSharedConfigSchema.parse(input);

export const mapSharedConfigToArenaEditorView = (
  input: unknown,
): ArenaEditorViewProjection => {
  const config = cloneArenaEditorSharedConfig(input);
  const assignmentByCombatant = new Map<string, string>();
  config.teams.forEach((team) => {
    team.combatantKeys.forEach((key) => assignmentByCombatant.set(key, team.key));
  });

  return Object.freeze({
    combatants: freezeArray(config.combatants.map((entry): ArenaEditorCombatantView => {
      if ('ref' in entry) {
        return Object.freeze({
          key: entry.key,
          name: entry.ref.id,
          type: null,
          source: sourceOfKey(entry.key),
          access: 'reference',
          reference: sharedReference(entry),
          characterGuidance: entry.characterGuidance ?? '',
          teamKey: assignmentByCombatant.get(entry.key) ?? null,
        });
      }
      return Object.freeze({
        key: entry.key,
        name: entry.displayName,
        type: entry.type,
        source: 'host-local',
        access: 'stub',
        reference: null,
        characterGuidance: entry.characterGuidance ?? '',
        teamKey: assignmentByCombatant.get(entry.key) ?? null,
      });
    })),
    teams: freezeArray(config.teams.map((team): ArenaEditorTeamView => Object.freeze({
      key: team.key,
      name: team.displayName,
      combatantKeys: freezeArray([...team.combatantKeys]),
    }))),
    scenario: config.scenario ? sharedScenarioView(config.scenario) : null,
    auxScenarios: freezeArray(config.auxScenarios.map(sharedScenarioView)),
    materials: freezeArray(config.materials.map(sharedScenarioView)),
    battleMode: config.battleMode,
    storyLength: config.storyLength,
    customStoryLength: config.customStoryLength ?? '',
    selectedLanguage: config.selectedLanguage,
    userGuidance: config.userGuidance,
    historySettings: Object.freeze({ ...config.historySettings }),
    busy: false,
  });
};

const text = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const recordName = (value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  return text(record.codename) || text(record.name) || text(record.title);
};

const localCombatantKey = (combatant: Combatant, index: number): string => {
  if ('data' in combatant) {
    if (text(combatant.sourceDataCardId)) return `data-card:${combatant.sourceDataCardId}`;
    if (combatant.isPreset) return `preset:${combatant.filename}`;
    return text(combatant.arenaRoomKey)
      || text(combatant.adjudicationSourceKey)
      || `local-combatant:${index}`;
  }
  return `random:${combatant.id}`;
};

const localScenarioView = (
  scenario: ScenarioState,
  fallbackKey: string,
): ArenaEditorScenarioView | null => {
  if (scenario.content === null) return null;
  const sourceDataCardId = text(scenario.sourceDataCardId);
  const source = sourceDataCardId
    ? 'data-card' as const
    : scenario.isNative ? 'preset' as const : 'host-local' as const;
  return Object.freeze({
    key: sourceDataCardId
      ? `data-card:${sourceDataCardId}`
      : text(scenario.arenaRoomKey) || text(scenario.adjudicationSourceKey) || fallbackKey,
    name: text(scenario.sourceDataCardName)
      || recordName(scenario.content)
      || text(scenario.fileName)
      || '未命名情景',
    source,
    access: 'full' as const,
    reference: sourceDataCardId ? Object.freeze({
      id: sourceDataCardId,
      versionToken: text(scenario.sourceDataCardUpdatedAt),
    }) : null,
  });
};

const localMaterialView = (
  material: ArenaMaterialState,
  index: number,
): ArenaEditorMaterialView => {
  const sourceDataCardId = text(material.sourceDataCardId);
  const source = sourceDataCardId
    ? 'data-card' as const
    : material.isNative ? 'preset' as const : 'host-local' as const;
  return Object.freeze({
    key: sourceDataCardId
      ? `data-card:${sourceDataCardId}`
      : text(material.arenaRoomKey) || `local-material:${material.id || index}`,
    name: text(material.name) || '未命名素材',
    source,
    access: 'full' as const,
    reference: sourceDataCardId ? Object.freeze({
      id: sourceDataCardId,
      versionToken: text(material.sourceDataCardUpdatedAt),
    }) : null,
  });
};

export const mapBattleStoreToArenaEditorView = (
  state: BattleStoreState,
): ArenaEditorViewProjection => {
  const teamKeyById = new Map(state.teams.map((team) => [
    team.id,
    team.roomKey?.trim() || `team:${team.id}`,
  ]));
  const combatants = state.combatants.map((combatant, index): ArenaEditorCombatantView => {
    const key = localCombatantKey(combatant, index);
    if (!('data' in combatant)) {
      return Object.freeze({
        key,
        name: text(combatant.filename) || '随机角色',
        type: combatant.type === 'random-canshou' ? 'canshou' : 'magical-girl',
        source: 'random',
        access: 'placeholder',
        reference: null,
        characterGuidance: '',
        teamKey: combatant.teamId ? teamKeyById.get(combatant.teamId) ?? null : null,
      });
    }
    const sourceDataCardId = text(combatant.sourceDataCardId);
    return Object.freeze({
      key,
      name: text(combatant.sourceDataCardName)
        || recordName(combatant.data)
        || text(combatant.filename)
        || '未命名角色',
      type: combatant.type,
      source: sourceDataCardId
        ? 'data-card'
        : combatant.isPreset ? 'preset' : 'host-local',
      access: 'full',
      reference: sourceDataCardId ? Object.freeze({
        id: sourceDataCardId,
        versionToken: text(combatant.sourceDataCardUpdatedAt),
      }) : null,
      characterGuidance: combatant.characterGuidance ?? '',
      teamKey: combatant.teamId ? teamKeyById.get(combatant.teamId) ?? null : null,
    });
  });

  return Object.freeze({
    combatants: freezeArray(combatants),
    teams: freezeArray(state.teams.map((team): ArenaEditorTeamView => Object.freeze({
      key: team.roomKey?.trim() || `team:${team.id}`,
      name: team.name,
      combatantKeys: freezeArray(combatants
        .filter((combatant) => combatant.teamKey === (team.roomKey?.trim() || `team:${team.id}`))
        .map((combatant) => combatant.key)),
    }))),
    scenario: localScenarioView(state.scenario, 'local-scenario:main'),
    auxScenarios: freezeArray(state.auxScenarios.flatMap((scenario, index) => {
      const view = localScenarioView(scenario, `local-scenario:${scenario.id || index}`);
      return view ? [view] : [];
    })),
    materials: freezeArray(state.materials.map(localMaterialView)),
    battleMode: state.battleMode,
    storyLength: state.storyLength,
    customStoryLength: state.customStoryLength,
    selectedLanguage: state.selectedLanguage,
    userGuidance: state.settings.userGuidance,
    historySettings: Object.freeze({
      readArenaHistory: state.settings.readArenaHistory,
      readArenaHistoryLimit: state.settings.readArenaHistoryLimit,
      isArenaHistoryUnlimited: state.settings.isArenaHistoryUnlimited,
      writeArenaHistory: state.settings.writeArenaHistory,
      readCurrentState: state.settings.readCurrentState,
      writeCurrentState: state.settings.writeCurrentState,
      readNarrativeHistory: state.settings.readNarrativeHistory,
      readNarrativeHistoryLimit: state.settings.readNarrativeHistoryLimit,
      isNarrativeHistoryUnlimited: state.settings.isNarrativeHistoryUnlimited,
      writeNarrativeHistory: state.settings.writeNarrativeHistory,
    }),
    busy: state.isGenerating,
  });
};
