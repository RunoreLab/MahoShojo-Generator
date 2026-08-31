import type { ArenaRoomSharedConfig } from '@mahoshojo/contracts/arena-room';

export type ArenaProductParityClassification =
  | 'shared/proposable'
  | 'shared/host-only'
  | 'host-runtime-only'
  | 'local-only'
  | 'forbidden'
  | 'deferred-with-reason';

export interface ArenaProductParityCoverageEntry {
  readonly classification: ArenaProductParityClassification;
  readonly reason?: string;
  readonly gap?: string;
}

type SharedConfigCoverageEntry = ArenaProductParityCoverageEntry & {
  readonly rootField: keyof ArenaRoomSharedConfig;
};

const sharedProposable = {
  classification: 'shared/proposable',
} as const satisfies ArenaProductParityCoverageEntry;

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
    generationRequestId: {
      classification: 'host-runtime-only',
      reason: '幂等 generation identity 由发起端/runtime 使用，不属于 Room Shared Config。',
    },
    combatants: {
      ...sharedProposable,
      gap: 'GMR-10P-B 仍需从 frozen Shared Config materialize 完整 payload，不能继续信任 host local 同名字段。',
    },
    mode: sharedProposable,
    arenaFreeRankingEnabled: {
      classification: 'shared/host-only',
      reason: '排位开关影响生成，但当前被定义为 host-only Arena control，尚未进入 Shared Config。',
    },
    userGuidance: sharedProposable,
    scenario: sharedProposable,
    auxScenarios: sharedProposable,
    materials: sharedProposable,
    scenarioTitle: sharedProposable,
    scenarioFileName: sharedProposable,
    scenarioSourceDataCardId: sharedProposable,
    scenarioSourceDataCardUpdatedAt: sharedProposable,
    teams: sharedProposable,
    teamNames: {
      classification: 'shared/host-only',
      gap: 'Shared Config 已保存 team display name，但 Proposal 缺少 rename team change。',
    },
    language: {
      classification: 'shared/host-only',
      gap: 'Shared Config 已保存 selectedLanguage，但 Proposal 缺少 setLanguage change。',
    },
    readArenaHistory: sharedProposable,
    arenaHistoryReadLimit: sharedProposable,
    writeArenaHistory: sharedProposable,
    readCurrentState: sharedProposable,
    writeCurrentState: sharedProposable,
    readNarrativeHistory: sharedProposable,
    writeNarrativeHistory: sharedProposable,
    narrativeHistoryReadLimit: sharedProposable,
    narrativeHistory: {
      classification: 'local-only',
      reason: '历史正文来自 host local store；Room 只共享是否读取与上限，不广播正文。',
    },
    isDowngrade: {
      classification: 'host-runtime-only',
      reason: '传输/兼容降级标记不属于多人产品共享语义。',
    },
    adjudicationEvents: {
      classification: 'deferred-with-reason',
      reason: 'adjudication 配置尚未进入 Shared Config 或 Proposal；需先定义安全投影与 materialization。',
    },
    storyLength: sharedProposable,
    customStoryLength: sharedProposable,
    questionnaireSelections: {
      classification: 'deferred-with-reason',
      reason: 'questionnaire selections 尚未进入 Shared Config 或 Proposal，需先建立可验证 ref。',
    },
    questionnaires: {
      classification: 'deferred-with-reason',
      reason: 'questionnaire lore 当前携带展开内容，需在 GMR-10P-B 设计 exact-ref materialization。',
    },
    customProvider: {
      classification: 'host-runtime-only',
      reason: 'Provider、model、credential 只允许 request-scoped host runtime 使用。',
    },
  },
  roomSharedConfig: {
    battleMode: { ...sharedProposable, rootField: 'battleMode' },
    combatants: { ...sharedProposable, rootField: 'combatants' },
    'combatants.characterGuidance': { ...sharedProposable, rootField: 'combatants' },
    teams: { ...sharedProposable, rootField: 'teams' },
    'teams.combatantKeys': { ...sharedProposable, rootField: 'teams' },
    'teams.displayName': {
      classification: 'shared/host-only',
      rootField: 'teams',
      gap: 'Room 保存 team display name，但 Proposal 没有 rename team change。',
    },
    scenario: { ...sharedProposable, rootField: 'scenario' },
    auxScenarios: { ...sharedProposable, rootField: 'auxScenarios' },
    materials: { ...sharedProposable, rootField: 'materials' },
    userGuidance: { ...sharedProposable, rootField: 'userGuidance' },
    storyLength: { ...sharedProposable, rootField: 'storyLength' },
    customStoryLength: { ...sharedProposable, rootField: 'customStoryLength' },
    selectedLanguage: {
      classification: 'shared/host-only',
      rootField: 'selectedLanguage',
      gap: 'Room 保存 selectedLanguage，但 Proposal 没有 setLanguage change。',
    },
    historySettings: { ...sharedProposable, rootField: 'historySettings' },
    'historySettings.readArenaHistory': { ...sharedProposable, rootField: 'historySettings' },
    'historySettings.readArenaHistoryLimit': { ...sharedProposable, rootField: 'historySettings' },
    'historySettings.isArenaHistoryUnlimited': { ...sharedProposable, rootField: 'historySettings' },
    'historySettings.writeArenaHistory': { ...sharedProposable, rootField: 'historySettings' },
    'historySettings.readCurrentState': { ...sharedProposable, rootField: 'historySettings' },
    'historySettings.writeCurrentState': { ...sharedProposable, rootField: 'historySettings' },
    'historySettings.readNarrativeHistory': { ...sharedProposable, rootField: 'historySettings' },
    'historySettings.readNarrativeHistoryLimit': { ...sharedProposable, rootField: 'historySettings' },
    'historySettings.isNarrativeHistoryUnlimited': { ...sharedProposable, rootField: 'historySettings' },
    'historySettings.writeNarrativeHistory': { ...sharedProposable, rootField: 'historySettings' },
  } satisfies Readonly<Record<string, SharedConfigCoverageEntry>>,
  proposalChanges: {
    addCombatant: sharedProposable,
    removeCombatant: sharedProposable,
    setCharacterGuidance: sharedProposable,
    assignTeam: sharedProposable,
    setBattleMode: sharedProposable,
    setScenario: sharedProposable,
    addAuxScenario: sharedProposable,
    removeAuxScenario: sharedProposable,
    addMaterial: sharedProposable,
    removeMaterial: sharedProposable,
    setUserGuidance: sharedProposable,
    setStoryLength: sharedProposable,
    setHistorySettings: sharedProposable,
  },
  arenaUi: {
    battleMode: sharedProposable,
    combatantRoster: sharedProposable,
    combatantOnlineDataCard: sharedProposable,
    combatantPreset: {
      classification: 'shared/host-only',
      reason: 'host 可发布 stable preset ref；member proposal 需等待 server-known preset registry。',
    },
    combatantLocalUpload: {
      classification: 'forbidden',
      reason: 'member Proposal 禁止上传本地 payload。',
    },
    combatantLocalPaste: {
      classification: 'forbidden',
      reason: 'member Proposal 禁止粘贴本地 payload。',
    },
    characterGuidance: sharedProposable,
    teamAssignment: sharedProposable,
    teamDisplayName: {
      classification: 'shared/host-only',
      gap: 'Arena UI 可编辑 team display name，但 Proposal 缺少 rename team change。',
    },
    scenario: sharedProposable,
    scenarioLocalUpload: {
      classification: 'forbidden',
      reason: 'member Proposal 禁止上传本地情景。',
    },
    scenarioLocalPaste: {
      classification: 'forbidden',
      reason: 'member Proposal 禁止粘贴本地情景。',
    },
    auxScenarios: sharedProposable,
    auxScenarioLocalUpload: {
      classification: 'forbidden',
      reason: 'member Proposal 禁止上传本地辅助情景。',
    },
    auxScenarioLocalPaste: {
      classification: 'forbidden',
      reason: 'member Proposal 禁止粘贴本地辅助情景。',
    },
    materials: sharedProposable,
    materialLocalUpload: {
      classification: 'forbidden',
      reason: 'member Proposal 禁止上传本地素材。',
    },
    materialLocalPaste: {
      classification: 'forbidden',
      reason: 'member Proposal 禁止粘贴本地素材。',
    },
    userGuidance: sharedProposable,
    storyLength: sharedProposable,
    customStoryLength: sharedProposable,
    selectedLanguage: {
      classification: 'shared/host-only',
      gap: 'Arena UI 可编辑 selectedLanguage，但 Proposal 缺少 setLanguage change。',
    },
    historySettings: sharedProposable,
    narrativeHistory: {
      classification: 'local-only',
      reason: '正文保留在 host local store，Room 只共享安全读写设置。',
    },
    questionnaireLore: {
      classification: 'deferred-with-reason',
      reason: '需要先定义 questionnaire/lore exact ref、权限与 Shared Config/Proposal materialization。',
    },
    questionnaireLocalUpload: {
      classification: 'forbidden',
      reason: 'member Proposal 禁止上传本地 questionnaire/lore payload。',
    },
    questionnaireLocalPaste: {
      classification: 'forbidden',
      reason: 'member Proposal 禁止粘贴本地 questionnaire/lore payload。',
    },
    adjudicationEvents: {
      classification: 'deferred-with-reason',
      reason: '需要先定义可共享 adjudication 安全子集与 Shared Config/Proposal contract。',
    },
    arenaFreeRankingEnabled: {
      classification: 'shared/host-only',
      reason: '排位是 host-only Arena control，member Proposal 不得改动。',
    },
    customProvider: {
      classification: 'host-runtime-only',
      reason: 'Provider 与 credential 不进入 Room authority。',
    },
    generationMode: {
      classification: 'host-runtime-only',
      reason: 'stream/non-stream transport selection 不进入 Room authority。',
    },
  },
} as const;

export type ArenaGenerationRequestSemanticField = keyof (
  typeof ARENA_PRODUCT_PARITY_COVERAGE
)['generationRequest'];

export type ArenaGenerationRequestCoverageShape = Readonly<
  Record<ArenaGenerationRequestSemanticField, unknown>
>;

type RejectUnclassifiedGenerationFields<Request extends ArenaGenerationRequestCoverageShape> =
  Request & Record<Exclude<keyof Request, ArenaGenerationRequestSemanticField>, never>;

/**
 * Runtime identity + compile-time exact-key gate。新增 generation 字段时，必须先在
 * ARENA_PRODUCT_PARITY_COVERAGE.generationRequest 分类，否则 Web typecheck 失败。
 */
export const defineArenaGenerationRequest = <
  const Request extends ArenaGenerationRequestCoverageShape,
>(request: RejectUnclassifiedGenerationFields<Request>): Request => request;
