import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

export type ArenaProductParityClassification =
  | 'shared/proposable'
  | 'shared/host-only'
  | 'host-runtime-only'
  | 'local-only'
  | 'forbidden'
  | 'deferred-with-reason';

export type ArenaProductParityModeCapability =
  | 'editable'
  | 'derived'
  | 'materialized'
  | 'read-only'
  | 'host-only'
  | 'local-only'
  | 'forbidden'
  | 'deferred'
  | 'not-applicable';

export const ARENA_PRODUCT_PARITY_TEST_IDS = [
  'GMR10P-A-EXACT-GENERATION-FIELDS',
  'GMR10P-A-SHARED-PROPOSAL-COVERAGE',
  'GMR10P-A-ARENA-UI-CONTRACT',
  'GMR10P-A-EXPLICIT-GAPS',
] as const;
export type ArenaProductParityTestId = typeof ARENA_PRODUCT_PARITY_TEST_IDS[number];

export interface ArenaProductParityCoverageEntry {
  readonly classification: ArenaProductParityClassification;
  readonly single: ArenaProductParityModeCapability;
  readonly roomHost: ArenaProductParityModeCapability;
  readonly roomProposal: ArenaProductParityModeCapability;
  readonly contractChangeTypes: readonly string[];
  readonly testIds: readonly ArenaProductParityTestId[];
  readonly reason?: string;
  readonly gap?: string;
}

type SharedConfigCoverageEntry = ArenaProductParityCoverageEntry & {
  readonly rootField: keyof ArenaRoomSharedConfig;
};

const coverageEntry = <const Entry extends ArenaProductParityCoverageEntry>(
  entry: Entry,
): Entry => entry;

const sharedProposable = (
  contractChangeTypes: readonly string[],
  testIds: readonly ArenaProductParityTestId[] = ['GMR10P-A-SHARED-PROPOSAL-COVERAGE'],
): ArenaProductParityCoverageEntry => coverageEntry({
  classification: 'shared/proposable',
  single: 'editable',
  roomHost: 'editable',
  roomProposal: 'editable',
  contractChangeTypes,
  testIds,
});

const derivedSharedProposable = (
  contractChangeTypes: readonly string[],
): ArenaProductParityCoverageEntry => coverageEntry({
  classification: 'shared/proposable',
  single: 'derived',
  roomHost: 'materialized',
  roomProposal: 'derived',
  contractChangeTypes,
  testIds: ['GMR10P-A-SHARED-PROPOSAL-COVERAGE'],
});

const materializedSharedPayload = (
  reason: string,
  contractChangeTypes: readonly string[],
): ArenaProductParityCoverageEntry => coverageEntry({
  classification: 'shared/proposable',
  single: 'derived',
  roomHost: 'materialized',
  roomProposal: 'derived',
  contractChangeTypes,
  testIds: ['GMR10P-A-SHARED-PROPOSAL-COVERAGE'],
  reason,
});

const classified = (
  classification: ArenaProductParityClassification,
  modes: Readonly<{
    single: ArenaProductParityModeCapability;
    roomHost: ArenaProductParityModeCapability;
    roomProposal: ArenaProductParityModeCapability;
  }>,
  options: Readonly<{
    contractChangeTypes?: readonly string[];
    testIds?: readonly ArenaProductParityTestId[];
    reason?: string;
    gap?: string;
  }>,
): ArenaProductParityCoverageEntry => coverageEntry({
  classification,
  ...modes,
  contractChangeTypes: options.contractChangeTypes ?? [],
  testIds: options.testIds ?? ['GMR10P-A-EXPLICIT-GAPS'],
  ...(options.reason === undefined ? {} : { reason: options.reason }),
  ...(options.gap === undefined ? {} : { gap: options.gap }),
});

/**
 * GMR-10P-A 的 machine-readable 产品覆盖基线。
 *
 * generationRequest 的 key 与 useBattleEngine 真正提交的 generation object
 * 一一对应；defineArenaGenerationRequest 会在 Web typecheck 时拒绝 matrix 外字段。
 * roomSharedConfig 同时展开影响产品语义的嵌套字段，但 rootField 保持可与
 * ArenaRoomSharedConfigSchema 顶层字段做精确覆盖检查。
 */
export const ARENA_PRODUCT_PARITY_COVERAGE = {
  contractSource: 'existing-arena-ui',
  legacyMiniEditorIsProductContract: false,
  generationRequest: {
    generationRequestId: classified('host-runtime-only', {
      single: 'derived', roomHost: 'derived', roomProposal: 'not-applicable',
    }, {
      reason: '幂等 generation identity 由发起端/runtime 使用，不属于 Room Shared Config。',
    }),
    combatants: materializedSharedPayload(
      '完整角色 payload 已由 frozen Shared Config 的 ref/stub 与 exact canonical/request-scoped payload materialize。',
      ['addCombatant', 'removeCombatant', 'setCharacterGuidance', 'assignTeam'],
    ),
    mode: derivedSharedProposable(['setBattleMode']),
    arenaFreeRankingEnabled: classified('shared/host-only', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: '排位开关影响生成，但当前被定义为 host-only Arena control，尚未进入 Shared Config。',
    }),
    userGuidance: derivedSharedProposable(['setUserGuidance']),
    scenario: materializedSharedPayload(
      '展开后的情景正文由 frozen exact ref 或 request-scoped host-local map materialize。',
      ['setScenario'],
    ),
    auxScenarios: materializedSharedPayload(
      '展开后的辅助情景正文由 frozen exact ref 或 request-scoped host-local map materialize。',
      ['addAuxScenario', 'removeAuxScenario'],
    ),
    materials: materializedSharedPayload(
      '展开后的素材正文由 frozen exact ref 或 request-scoped host-local map materialize。',
      ['addMaterial', 'removeMaterial'],
    ),
    scenarioTitle: derivedSharedProposable(['setScenario']),
    scenarioFileName: derivedSharedProposable(['setScenario']),
    scenarioSourceDataCardId: derivedSharedProposable(['setScenario']),
    scenarioSourceDataCardUpdatedAt: derivedSharedProposable(['setScenario']),
    teams: derivedSharedProposable(['addTeam', 'removeTeam', 'assignTeam']),
    teamNames: derivedSharedProposable(['addTeam', 'renameTeam']),
    language: derivedSharedProposable(['setSelectedLanguage']),
    readArenaHistory: derivedSharedProposable(['setHistorySettings']),
    arenaHistoryReadLimit: derivedSharedProposable(['setHistorySettings']),
    writeArenaHistory: derivedSharedProposable(['setHistorySettings']),
    readCurrentState: derivedSharedProposable(['setHistorySettings']),
    writeCurrentState: derivedSharedProposable(['setHistorySettings']),
    readNarrativeHistory: derivedSharedProposable(['setHistorySettings']),
    writeNarrativeHistory: derivedSharedProposable(['setHistorySettings']),
    narrativeHistoryReadLimit: derivedSharedProposable(['setHistorySettings']),
    narrativeHistory: classified('local-only', {
      single: 'local-only', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: '历史正文来自 host local store；Room 只共享是否读取与上限，不广播正文。',
    }),
    isDowngrade: classified('host-runtime-only', {
      single: 'derived', roomHost: 'host-only', roomProposal: 'not-applicable',
    }, {
      reason: '传输/兼容降级标记不属于多人产品共享语义。',
    }),
    adjudicationEvents: classified('deferred-with-reason', {
      single: 'editable', roomHost: 'deferred', roomProposal: 'deferred',
    }, {
      reason: 'adjudication 配置尚未进入 Shared Config 或 Proposal；需先定义安全投影与 materialization。',
    }),
    storyLength: derivedSharedProposable(['setStoryLength']),
    customStoryLength: derivedSharedProposable(['setStoryLength']),
    questionnaireSelections: classified('deferred-with-reason', {
      single: 'editable', roomHost: 'deferred', roomProposal: 'deferred',
    }, {
      reason: 'questionnaire selections 尚未进入 Shared Config 或 Proposal，需先建立可验证 ref。',
    }),
    questionnaires: classified('deferred-with-reason', {
      single: 'derived', roomHost: 'deferred', roomProposal: 'forbidden',
    }, {
      reason: 'questionnaire lore 当前携带展开内容；进入 Shared Config/Proposal 前仍需新增可验证 exact-ref materialization contract。',
    }),
    customProvider: classified('host-runtime-only', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: 'Provider、model、credential 只允许 request-scoped host runtime 使用。',
    }),
  },
  roomSharedConfig: {
    battleMode: { ...sharedProposable(['setBattleMode']), rootField: 'battleMode' },
    combatants: {
      ...sharedProposable(['addCombatant', 'removeCombatant']),
      rootField: 'combatants',
    },
    'combatants.characterGuidance': {
      ...sharedProposable(['setCharacterGuidance']),
      rootField: 'combatants',
    },
    teams: { ...sharedProposable(['addTeam', 'removeTeam', 'assignTeam']), rootField: 'teams' },
    'teams.combatantKeys': { ...sharedProposable(['assignTeam']), rootField: 'teams' },
    'teams.displayName': { ...sharedProposable(['addTeam', 'renameTeam']), rootField: 'teams' },
    scenario: { ...sharedProposable(['setScenario']), rootField: 'scenario' },
    auxScenarios: {
      ...sharedProposable(['addAuxScenario', 'removeAuxScenario']),
      rootField: 'auxScenarios',
    },
    materials: {
      ...sharedProposable(['addMaterial', 'removeMaterial']),
      rootField: 'materials',
    },
    userGuidance: { ...sharedProposable(['setUserGuidance']), rootField: 'userGuidance' },
    storyLength: { ...sharedProposable(['setStoryLength']), rootField: 'storyLength' },
    customStoryLength: {
      ...sharedProposable(['setStoryLength']),
      rootField: 'customStoryLength',
    },
    selectedLanguage: { ...sharedProposable(['setSelectedLanguage']), rootField: 'selectedLanguage' },
    historySettings: { ...sharedProposable(['setHistorySettings']), rootField: 'historySettings' },
    'historySettings.readArenaHistory': { ...sharedProposable(['setHistorySettings']), rootField: 'historySettings' },
    'historySettings.readArenaHistoryLimit': { ...sharedProposable(['setHistorySettings']), rootField: 'historySettings' },
    'historySettings.isArenaHistoryUnlimited': { ...sharedProposable(['setHistorySettings']), rootField: 'historySettings' },
    'historySettings.writeArenaHistory': { ...sharedProposable(['setHistorySettings']), rootField: 'historySettings' },
    'historySettings.readCurrentState': { ...sharedProposable(['setHistorySettings']), rootField: 'historySettings' },
    'historySettings.writeCurrentState': { ...sharedProposable(['setHistorySettings']), rootField: 'historySettings' },
    'historySettings.readNarrativeHistory': { ...sharedProposable(['setHistorySettings']), rootField: 'historySettings' },
    'historySettings.readNarrativeHistoryLimit': { ...sharedProposable(['setHistorySettings']), rootField: 'historySettings' },
    'historySettings.isNarrativeHistoryUnlimited': { ...sharedProposable(['setHistorySettings']), rootField: 'historySettings' },
    'historySettings.writeNarrativeHistory': { ...sharedProposable(['setHistorySettings']), rootField: 'historySettings' },
  } satisfies Readonly<Record<string, SharedConfigCoverageEntry>>,
  proposalChanges: {
    addCombatant: sharedProposable(['addCombatant']),
    removeCombatant: sharedProposable(['removeCombatant']),
    setCharacterGuidance: sharedProposable(['setCharacterGuidance']),
    assignTeam: sharedProposable(['assignTeam']),
    addTeam: sharedProposable(['addTeam']),
    removeTeam: sharedProposable(['removeTeam']),
    renameTeam: sharedProposable(['renameTeam']),
    setBattleMode: sharedProposable(['setBattleMode']),
    setSelectedLanguage: sharedProposable(['setSelectedLanguage']),
    setScenario: sharedProposable(['setScenario']),
    addAuxScenario: sharedProposable(['addAuxScenario']),
    removeAuxScenario: sharedProposable(['removeAuxScenario']),
    addMaterial: sharedProposable(['addMaterial']),
    removeMaterial: sharedProposable(['removeMaterial']),
    setUserGuidance: sharedProposable(['setUserGuidance']),
    setStoryLength: sharedProposable(['setStoryLength']),
    setHistorySettings: sharedProposable(['setHistorySettings']),
  },
  arenaUi: {
    battleMode: sharedProposable(['setBattleMode'], ['GMR10P-A-ARENA-UI-CONTRACT']),
    combatantRoster: sharedProposable(
      ['addCombatant', 'removeCombatant'],
      ['GMR10P-A-ARENA-UI-CONTRACT'],
    ),
    combatantOnlineDataCard: sharedProposable(
      ['addCombatant'],
      ['GMR10P-A-ARENA-UI-CONTRACT'],
    ),
    combatantPreset: classified('shared/host-only', {
      single: 'editable', roomHost: 'editable', roomProposal: 'deferred',
    }, {
      reason: 'host 可发布 stable preset ref；member proposal 需等待 server-known preset registry。',
    }),
    combatantLocalUpload: classified('forbidden', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: 'member Proposal 禁止上传本地 payload。',
    }),
    combatantLocalPaste: classified('forbidden', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: 'member Proposal 禁止粘贴本地 payload。',
    }),
    characterGuidance: sharedProposable(
      ['setCharacterGuidance'],
      ['GMR10P-A-ARENA-UI-CONTRACT'],
    ),
    teamAssignment: sharedProposable(
      ['addTeam', 'removeTeam', 'assignTeam'],
      ['GMR10P-A-ARENA-UI-CONTRACT'],
    ),
    teamDisplayName: sharedProposable(
      ['addTeam', 'renameTeam'],
      ['GMR10P-A-ARENA-UI-CONTRACT'],
    ),
    scenario: sharedProposable(['setScenario'], ['GMR10P-A-ARENA-UI-CONTRACT']),
    scenarioLocalUpload: classified('forbidden', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: 'member Proposal 禁止上传本地情景。',
    }),
    scenarioLocalPaste: classified('forbidden', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: 'member Proposal 禁止粘贴本地情景。',
    }),
    auxScenarios: sharedProposable(
      ['addAuxScenario', 'removeAuxScenario'],
      ['GMR10P-A-ARENA-UI-CONTRACT'],
    ),
    auxScenarioLocalUpload: classified('forbidden', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: 'member Proposal 禁止上传本地辅助情景。',
    }),
    auxScenarioLocalPaste: classified('forbidden', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: 'member Proposal 禁止粘贴本地辅助情景。',
    }),
    materials: sharedProposable(
      ['addMaterial', 'removeMaterial'],
      ['GMR10P-A-ARENA-UI-CONTRACT'],
    ),
    materialLocalUpload: classified('forbidden', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: 'member Proposal 禁止上传本地素材。',
    }),
    materialLocalPaste: classified('forbidden', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: 'member Proposal 禁止粘贴本地素材。',
    }),
    userGuidance: sharedProposable(['setUserGuidance'], ['GMR10P-A-ARENA-UI-CONTRACT']),
    storyLength: sharedProposable(['setStoryLength'], ['GMR10P-A-ARENA-UI-CONTRACT']),
    customStoryLength: sharedProposable(['setStoryLength'], ['GMR10P-A-ARENA-UI-CONTRACT']),
    selectedLanguage: sharedProposable(
      ['setSelectedLanguage'],
      ['GMR10P-A-ARENA-UI-CONTRACT'],
    ),
    historySettings: sharedProposable(
      ['setHistorySettings'],
      ['GMR10P-A-ARENA-UI-CONTRACT'],
    ),
    narrativeHistory: classified('local-only', {
      single: 'local-only', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: '正文保留在 host local store，Room 只共享安全读写设置。',
    }),
    questionnaireLore: classified('deferred-with-reason', {
      single: 'editable', roomHost: 'deferred', roomProposal: 'deferred',
    }, {
      reason: '需要先定义 questionnaire/lore exact ref、权限与 Shared Config/Proposal materialization。',
    }),
    questionnaireLocalUpload: classified('forbidden', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: 'member Proposal 禁止上传本地 questionnaire/lore payload。',
    }),
    questionnaireLocalPaste: classified('forbidden', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: 'member Proposal 禁止粘贴本地 questionnaire/lore payload。',
    }),
    adjudicationEvents: classified('deferred-with-reason', {
      single: 'editable', roomHost: 'deferred', roomProposal: 'deferred',
    }, {
      reason: '需要先定义可共享 adjudication 安全子集与 Shared Config/Proposal contract。',
    }),
    arenaFreeRankingEnabled: classified('shared/host-only', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: '排位是 host-only Arena control，member Proposal 不得改动。',
    }),
    customProvider: classified('host-runtime-only', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: 'Provider 与 credential 不进入 Room authority。',
    }),
    generationMode: classified('host-runtime-only', {
      single: 'editable', roomHost: 'host-only', roomProposal: 'forbidden',
    }, {
      reason: 'stream/non-stream transport selection 不进入 Room authority。',
    }),
  },
} as const;

export type ArenaGenerationRequestSemanticField = keyof (
  typeof ARENA_PRODUCT_PARITY_COVERAGE
)['generationRequest'];

export type ArenaGenerationRequestCoverageShape = Readonly<
  Record<ArenaGenerationRequestSemanticField, unknown>
>;

const classifiedGenerationRequestFields = new Set<string>(
  Object.keys(ARENA_PRODUCT_PARITY_COVERAGE.generationRequest),
);

/**
 * Runtime counterpart of defineArenaGenerationRequest. It intentionally checks
 * only whether every supplied semantic field has a matrix row; B owns value
 * materialization and server authority validation.
 */
export const assertArenaGenerationRequestFieldsClassified = <
  const Request extends Readonly<Record<string, unknown>>,
>(request: Request): Request => {
  for (const field of Object.keys(request)) {
    if (!classifiedGenerationRequestFields.has(field)) {
      throw new Error(`ARENA_GENERATION_FIELD_UNCLASSIFIED:${field}`);
    }
  }
  return request;
};

type RejectUnclassifiedGenerationFields<Request extends ArenaGenerationRequestCoverageShape> =
  Request & Record<Exclude<keyof Request, ArenaGenerationRequestSemanticField>, never>;

/**
 * Runtime identity + compile-time exact-key gate。新增 generation 字段时，必须先在
 * ARENA_PRODUCT_PARITY_COVERAGE.generationRequest 分类，否则 Web typecheck 失败。
 */
export const defineArenaGenerationRequest = <
  const Request extends ArenaGenerationRequestCoverageShape,
>(request: RejectUnclassifiedGenerationFields<Request>): Request => request;
