import {
  ARENA_CANONICAL_CAPABILITIES,
  MAX_CONTROL_FRAME_BYTES,
  MAX_PENDING_PROPOSALS_PER_MEMBER,
  MAX_ROOM_MEMBERS,
} from '@mahoshojo/contracts/arena-room';

import type { ArenaGateLayer } from './gate-types';

export type ArenaGateReasonCategory =
  | 'product-parity'
  | 'security/privacy'
  | 'authorization/authority'
  | 'distributed-consistency'
  | 'resource/concurrency'
  | 'explicit-product-non-goal';

export interface ArenaGateCapabilityRegistryEntry {
  readonly code: string;
  readonly condition: string;
  readonly layer: ArenaGateLayer;
  readonly currentSource: string;
  readonly singleEquivalent: string;
  readonly canonicalSource: string;
  readonly reasonCategory: ArenaGateReasonCategory;
  readonly reason: string;
  readonly userAction: string;
  readonly currentUserMessage: string | null;
  readonly messageKey: string;
  readonly testId: string;
  readonly canonicalValue?: number;
}

const gate = (
  entry: ArenaGateCapabilityRegistryEntry,
): ArenaGateCapabilityRegistryEntry => Object.freeze(entry);

/** GMR-10Q-A gate/capability inventory and test binding. */
export const ARENA_GATE_CAPABILITY_REGISTRY: readonly ArenaGateCapabilityRegistryEntry[] = Object.freeze([
  gate({
    code: 'ROOM_CREATE_AUTH_REQUIRED', condition: '只有已认证用户可创建房间', layer: 'room-lifecycle',
    currentSource: 'apps/api/src/arena-room/room-http.ts', singleEquivalent: '单人 Arena 不需要 Room 身份门禁',
    canonicalSource: 'packages/multiplayer-core/src/state-machine.ts', reasonCategory: 'authorization/authority',
    reason: '创建共享 authority state 必须绑定可信账户身份。', userAction: '登录后重新创建房间。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomCreateAuthRequired', testId: 'GMR10Q-A-ROOM-LIFECYCLE',
  }),
  gate({
    code: 'ROOM_MEMBER_LIMIT', condition: '活跃成员达到房间人数上限时拒绝加入', layer: 'room-lifecycle',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 无房间成员',
    canonicalSource: 'packages/contracts/src/limits.ts', reasonCategory: 'resource/concurrency',
    reason: '实时 fan-out、presence 与 authority state 需要有界成员数。', userAction: '等待成员退出或加入其他房间。',
    currentUserMessage: '房间已满。', messageKey: 'arena.multiplayer.gate.roomMemberLimit', testId: 'GMR10Q-A-ROOM-MEMBER-LIMIT',
    canonicalValue: MAX_ROOM_MEMBERS,
  }),
  gate({
    code: 'ROOM_CLOSE_HOST_REQUIRED', condition: '只有房主可主动关闭房间', layer: 'room-lifecycle',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 用户控制自己的会话',
    canonicalSource: 'docs/specs/2026-08-21_arena-multiplayer-v1-spec.md', reasonCategory: 'authorization/authority',
    reason: '共享 Room 生命周期由唯一房主负责。', userAction: '请房主关闭房间；普通成员可自行退出。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomCloseHostRequired', testId: 'GMR10Q-A-ROOM-LIFECYCLE',
  }),
  gate({
    code: 'ROOM_LEAVE_MEMBERSHIP_REQUIRED', condition: '只有活跃房间成员可执行离开动作', layer: 'room-lifecycle',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 不存在共享 membership',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'authorization/authority',
    reason: '离开动作必须作用于经 authority state 验证的当前成员。', userAction: '先恢复房间连接；若已退出则无需重复操作。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomLeaveMembershipRequired', testId: 'GMR10Q-A-ROOM-LIFECYCLE',
  }),
  gate({
    code: 'ROOM_CONFIG_SCHEMA', condition: 'Shared Config 只接受 allowlist 字段、稳定 key 与完整引用关系', layer: 'room-shareability',
    currentSource: 'packages/contracts/src/shared-config.ts', singleEquivalent: '单人 Arena 使用同一生成语义但保留完整本地 payload',
    canonicalSource: 'packages/contracts/src/shared-config.ts', reasonCategory: 'security/privacy',
    reason: 'Room 只共享安全投影，不广播 secret 或 host-local 正文。', userAction: '修正具体配置项后重新更新房间配置。',
    currentUserMessage: '当前竞技场配置无法安全共享，请检查角色、版本与数量限制。', messageKey: 'arena.multiplayer.gate.roomConfigSchema', testId: 'GMR10Q-B-DRAFT-SHAREABILITY',
  }),
  gate({
    code: 'ROOM_CONFIG_COMBATANT_LIMIT', condition: 'Shared Config 角色数不得超过 canonical runtime 容量', layer: 'room-shareability',
    currentSource: 'packages/contracts/src/shared-config.ts', singleEquivalent: '单人 UI 不自设更低上限，执行前服从 runtime 容量',
    canonicalSource: 'packages/contracts/src/arena-capabilities.ts', reasonCategory: 'product-parity',
    reason: '多人共享角色容量直接继承 Arena canonical capability。', userAction: '将参战角色减少到 32 位以内。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomConfigCombatantLimit', testId: 'GMR10Q-D-COMBATANT-CAPACITY',
    canonicalValue: ARENA_CANONICAL_CAPABILITIES.maxCombatants,
  }),
  gate({
    code: 'ROOM_CONFIG_REFERENCE_LIMIT', condition: 'auxScenarios 与 materials 使用累计 reference budget', layer: 'room-shareability',
    currentSource: 'packages/contracts/src/shared-config.ts', singleEquivalent: '单人 Arena 参考项服从同一累计资源 sanity budget',
    canonicalSource: 'packages/contracts/src/arena-capabilities.ts', reasonCategory: 'product-parity',
    reason: '删除无资源证据的每类 10 项限制，继承 canonical 累计预算。', userAction: '移除部分辅助情景或素材。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomConfigReferenceLimit', testId: 'GMR10Q-D-REFERENCE-CAPACITY',
    canonicalValue: ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity,
  }),
  gate({
    code: 'ROOM_CONFIG_FRAME_LIMIT', condition: 'Room snapshot/control event 必须装入单个 frame', layer: 'room-shareability',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 无 Room control frame',
    canonicalSource: 'packages/contracts/src/limits.ts', reasonCategory: 'resource/concurrency',
    reason: 'Redis/WSS control fan-out 使用有界序列化 frame。', userAction: '缩短配置文本或减少引用项后重试。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomConfigFrameLimit', testId: 'GMR10Q-D-CONTROL-FRAME',
    canonicalValue: MAX_CONTROL_FRAME_BYTES,
  }),
  gate({
    code: 'ORIGIN_SIGNATURE_NOT_ELIGIBILITY_GATE', condition: '普通多人不得把原生签名状态当作内容有效性', layer: 'room-shareability',
    currentSource: 'apps/web/lib/arena-room/shared-config.ts', singleEquivalent: '单人 Arena 接受通过内容 validator 的自定义角色',
    canonicalSource: 'apps/web/components/arena/utils/fileParser.ts', reasonCategory: 'product-parity',
    reason: '来源可信度与内容有效性是不同语义。', userAction: '无需为普通多人模式补原生签名；仅修正实际格式问题。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.originSignatureInformational', testId: 'GMR10Q-C-ORIGIN-SEMANTICS',
  }),
  gate({
    code: 'ROOM_SHAREABILITY_ISSUES', condition: '建房与当前本地配置投影失败分离并展示具体 issues', layer: 'room-shareability',
    currentSource: 'apps/web/components/arena/multiplayer/ArenaMultiplayerPanel.tsx', singleEquivalent: '单人 Arena 在具体字段附近展示 validation',
    canonicalSource: 'packages/multiplayer-core/src/gate-types.ts', reasonCategory: 'product-parity',
    reason: 'Room 可先创建，未同步配置需要逐项可行动诊断。', userAction: '按具体问题修正后点击更新房间配置。',
    currentUserMessage: '当前竞技场配置无法安全共享，请检查角色、版本与数量限制。', messageKey: 'arena.multiplayer.gate.roomShareabilityIssues', testId: 'GMR10Q-E-STRUCTURED-ISSUES',
  }),
  gate({
    code: 'ROOM_CONFIG_PUBLISH_FENCE', condition: '发布/应用 Shared Config 需要房主 authority 与 exact revision fence', layer: 'room-shareability',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 直接更新自己的当前配置',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'distributed-consistency',
    reason: '防止非房主或旧 revision 覆盖 Room authority。', userAction: '请房主同步最新房间配置后重新发布。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomConfigPublishFence', testId: 'GMR10Q-A-CONFIG-PUBLISH-FENCE',
  }),
  gate({
    code: 'PROPOSAL_TYPED_CHANGE', condition: '成员只能提交 allowlist typed change 与 precondition', layer: 'collaboration',
    currentSource: 'packages/contracts/src/proposals.ts', singleEquivalent: '单人 Arena 直接编辑自己的本地配置',
    canonicalSource: 'packages/contracts/src/proposals.ts', reasonCategory: 'security/privacy',
    reason: '成员不得借通用 patch 注入私有 payload 或越权字段。', userAction: '仅提交多人编辑器支持的配置变更。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.proposalTypedChange', testId: 'GMR10Q-A-PROPOSAL-CONTRACT',
  }),
  gate({
    code: 'PROPOSAL_PENDING_LIMIT', condition: '单个成员待处理提案达到上限时拒绝新提案', layer: 'collaboration',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 无待处理提案队列',
    canonicalSource: 'packages/contracts/src/limits.ts', reasonCategory: 'resource/concurrency',
    reason: '有界协作队列保护 snapshot 与房主审阅负载。', userAction: '撤回一个提案或等待房主处理后再提交。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.proposalPendingLimit', testId: 'GMR10Q-A-PROPOSAL-PENDING-LIMIT',
    canonicalValue: MAX_PENDING_PROPOSALS_PER_MEMBER,
  }),
  gate({
    code: 'PROPOSAL_REVISION_CONFLICT', condition: '接受提案前验证 revision、expectedBase 与同目标冲突', layer: 'collaboration',
    currentSource: 'packages/multiplayer-core/src/conflicts.ts', singleEquivalent: '单人 Arena 无并发 Room authority',
    canonicalSource: 'packages/contracts/src/proposals.ts', reasonCategory: 'distributed-consistency',
    reason: '防止旧提案覆盖房间中已经发生的语义变更。', userAction: '同步当前房间配置并重新提交或由房主确认冲突。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.proposalRevisionConflict', testId: 'GMR10Q-A-PROPOSAL-CONFLICT',
  }),
  gate({
    code: 'PROPOSAL_ACTION_AUTHORITY', condition: '成员只能提交/撤回自己的提案，房主负责 resolve', layer: 'collaboration',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 用户直接接受自己的配置编辑',
    canonicalSource: 'docs/specs/2026-08-21_arena-multiplayer-v1-spec.md', reasonCategory: 'authorization/authority',
    reason: '提案作者与 Room 配置发布者拥有不同的最小权限。', userAction: '成员可撤回自己的提案；接受或拒绝需由房主操作。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.proposalActionAuthority', testId: 'GMR10Q-A-PROPOSAL-AUTHORITY',
  }),
  gate({
    code: 'COLLABORATION_PRODUCT_TERMINOLOGY', condition: '普通用户界面使用中文协作术语，英文协议名仅进入技术详情', layer: 'collaboration',
    currentSource: 'apps/web/components/arena/multiplayer/ArenaProposalPanel.tsx', singleEquivalent: '单人 Arena 使用面向用户的中文配置术语',
    canonicalSource: 'docs/specs/2026-09-01_073000_Arena多人门禁分层最小化与单人一致性修订.md', reasonCategory: 'product-parity',
    reason: 'Proposal/revision/BASE 等协议术语不是面向普通用户的产品语言。', userAction: '按“配置提案、房间配置版本、提案基准/当前值/建议值”理解和操作。',
    currentUserMessage: 'Proposal / typed diff / BASE / CURRENT / PROPOSED / revision', messageKey: 'arena.multiplayer.capability.collaborationProductTerminology', testId: 'GMR10Q-E-TERMINOLOGY',
  }),
  gate({
    code: 'GENERATION_COMBATANTS_EMPTY', condition: '开始生成时 roster 为空', layer: 'generation-readiness',
    currentSource: 'packages/multiplayer-core/src/generation-readiness.ts', singleEquivalent: '单人 Arena 空 roster 不能开始生成',
    canonicalSource: 'packages/contracts/src/arena-capabilities.ts', reasonCategory: 'product-parity',
    reason: '生成完整性只在 start/preflight 检查，不阻止房间存在。', userAction: '至少添加 1 位参战角色后再开始生成。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.generationCombatantsEmpty', testId: 'GMR10Q-B-GENERATION-READINESS',
  }),
  gate({
    code: 'GENERATION_COMBATANTS_INSUFFICIENT', condition: '角色数少于当前模式的单人最低人数', layer: 'generation-readiness',
    currentSource: 'packages/multiplayer-core/src/generation-readiness.ts', singleEquivalent: 'classic/kizuna=2，daily/scenario=1',
    canonicalSource: 'packages/contracts/src/arena-capabilities.ts', reasonCategory: 'product-parity',
    reason: '多人开始生成继承单人 mode-specific 最低人数。', userAction: '继续添加角色直到满足当前模式要求。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.generationCombatantsInsufficient', testId: 'GMR10Q-F-MODE-MINIMUM-PARITY',
  }),
  gate({
    code: 'GENERATION_SCENARIO_REQUIRED', condition: 'scenario 模式缺少主情景', layer: 'generation-readiness',
    currentSource: 'packages/multiplayer-core/src/generation-readiness.ts', singleEquivalent: '单人 scenario 模式同样要求主情景',
    canonicalSource: 'apps/web/components/arena/hooks/useBattleEngine.ts', reasonCategory: 'product-parity',
    reason: '多人生成完整性继承单人情景要求。', userAction: '选择或载入主情景后再开始生成。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.generationScenarioRequired', testId: 'GMR10Q-F-SCENARIO-PARITY',
  }),
  gate({
    code: 'GENERATION_COMBATANT_LIMIT', condition: '生成角色数超过 canonical runtime 容量', layer: 'generation-readiness',
    currentSource: 'packages/multiplayer-core/src/generation-readiness.ts', singleEquivalent: '单人生成同样受 runtime 32 位上限约束',
    canonicalSource: 'packages/contracts/src/arena-capabilities.ts', reasonCategory: 'product-parity',
    reason: '生成前明确报告实际 runtime 容量。', userAction: '将参战角色减少到 32 位以内。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.generationCombatantLimit', testId: 'GMR10Q-D-COMBATANT-CAPACITY',
    canonicalValue: ARENA_CANONICAL_CAPABILITIES.maxCombatants,
  }),
  gate({
    code: 'HOST_LOCAL_PAYLOAD_MISSING', condition: 'host-local stub 缺少 request-scoped 完整 payload 或 digest/type 不匹配', layer: 'generation-readiness',
    currentSource: 'apps/api/src/arena-room/room-generation-materializer.ts', singleEquivalent: '单人 Arena 从本地 store 读取并校验完整内容',
    canonicalSource: 'packages/contracts/src/room-http.ts', reasonCategory: 'security/privacy',
    reason: '完整本地正文不得持久化到 Room，只能由房主请求临时提供并严格匹配。', userAction: '请房主重新载入本地内容或更新房间配置。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.hostLocalPayloadMissing', testId: 'GMR10Q-C-HOST-LOCAL-MATERIALIZATION',
  }),
  gate({
    code: 'REFERENCE_STALE', condition: 'online exact ref 的 version/permission 已变化', layer: 'generation-readiness',
    currentSource: 'apps/api/src/arena-room/room-generation-materializer.ts', singleEquivalent: '单人在线卡按当前 canonical 版本读取',
    canonicalSource: 'packages/contracts/src/primitives.ts', reasonCategory: 'distributed-consistency',
    reason: '权威生成不得静默把冻结引用替换为新版本。', userAction: '重新同步或重新选择已更新的数据卡。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.referenceStale', testId: 'GMR10Q-C-EXACT-REF',
  }),
  gate({
    code: 'RUNTIME_BODY_LIMIT', condition: 'materialized request 超出 Hosted body budget', layer: 'runtime-resource',
    currentSource: 'packages/hosted-api/src/arena-generation/resource-budget.ts', singleEquivalent: '单人与多人调用同一 Hosted runtime',
    canonicalSource: 'packages/hosted-api/src/arena-generation/resource-budget.ts', reasonCategory: 'resource/concurrency',
    reason: '限制单次解析、内存与 provider request 成本。', userAction: '缩减角色、情景、素材或历史正文。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.runtimeBodyLimit', testId: 'GMR10Q-A-RUNTIME-BUDGET',
  }),
  gate({
    code: 'RUNTIME_COMBATANT_LIMIT', condition: 'runtime 角色 sanity count 超出 canonical 容量', layer: 'runtime-resource',
    currentSource: 'packages/hosted-api/src/arena-generation/resource-budget.ts', singleEquivalent: '单人与多人使用同一 runtime 上限',
    canonicalSource: 'packages/contracts/src/arena-capabilities.ts', reasonCategory: 'product-parity',
    reason: 'Hosted runtime 从 dependency-neutral source 继承角色容量。', userAction: '将参战角色减少到 32 位以内。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.runtimeCombatantLimit', testId: 'GMR10Q-D-HOSTED-CAPABILITY-PARITY',
    canonicalValue: ARENA_CANONICAL_CAPABILITIES.maxCombatants,
  }),
  gate({
    code: 'RUNTIME_REFERENCE_LIMIT', condition: 'materialized reference collections 累计超出 sanity budget', layer: 'runtime-resource',
    currentSource: 'packages/hosted-api/src/arena-generation/resource-budget.ts', singleEquivalent: '单人与多人使用同一累计 reference budget',
    canonicalSource: 'packages/contracts/src/arena-capabilities.ts', reasonCategory: 'product-parity',
    reason: 'Hosted runtime 与 Room contract 共享同一参考项容量。', userAction: '减少辅助情景、素材、问卷或叙事历史引用。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.runtimeReferenceLimit', testId: 'GMR10Q-D-HOSTED-CAPABILITY-PARITY',
    canonicalValue: ARENA_CANONICAL_CAPABILITIES.maxReferenceItemsSanity,
  }),
  gate({
    code: 'RUNTIME_PROMPT_BUDGET', condition: '保守估算的 prompt token 超出当前 funding channel', layer: 'runtime-resource',
    currentSource: 'packages/hosted-api/src/arena-generation/resource-budget.ts', singleEquivalent: '单人与多人服从相同 funding channel',
    canonicalSource: 'packages/hosted-api/src/arena-generation/resource-budget.ts', reasonCategory: 'resource/concurrency',
    reason: '保护系统资金与 provider context ceiling。', userAction: '缩短输入，或在允许时切换具备更高预算的渠道。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.runtimePromptBudget', testId: 'GMR10Q-A-RUNTIME-BUDGET',
  }),
  gate({
    code: 'RUNTIME_SINGLE_PRODUCER', condition: '同一 Room 同时只允许一个 authority generation producer', layer: 'runtime-resource',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人发起端也以 generationRequestId 保持幂等',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'distributed-consistency',
    reason: '防止重复 provider 调用和分叉权威结果。', userAction: '等待当前生成结束，或恢复未知结果后再重试。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.runtimeSingleProducer', testId: 'GMR10Q-A-RUNTIME-SINGLE-PRODUCER',
  }),
  gate({
    code: 'RUNTIME_OUTPUT_LIMIT', condition: 'provider 输出不得超过 Hosted output byte ceiling', layer: 'runtime-resource',
    currentSource: 'packages/hosted-api/src/arena-generation/resource-budget.ts', singleEquivalent: '单人与多人调用同一 Hosted output pipeline',
    canonicalSource: 'packages/hosted-api/src/arena-generation/resource-budget.ts', reasonCategory: 'resource/concurrency',
    reason: '限制单次流式缓存、持久化与 fan-out 正文大小。', userAction: '缩短目标故事长度或拆分生成。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.runtimeOutputLimit', testId: 'GMR10Q-A-RUNTIME-BUDGET',
  }),
  gate({
    code: 'RESULT_HOST_WRITE_AUTHORITY', condition: '只有房主可把结果写回 host/private 角色与历史', layer: 'result-action',
    currentSource: 'apps/web/components/arena/components/BattleResult.tsx', singleEquivalent: '单人用户可写回自己的本地角色、当前状态与历史',
    canonicalSource: 'packages/multiplayer-core/src/product-parity-coverage.ts', reasonCategory: 'authorization/authority',
    reason: '成员看到权威结果不等于获得房主私有存储写权限。', userAction: '成员可查看结果；需要写回时由房主执行。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.resultHostWriteAuthority', testId: 'GMR10Q-F-RESULT-ACTION-PARITY',
  }),
  gate({
    code: 'RESULT_PRESENTATION_PARITY', condition: '多人权威结果复用单人 Arena presentation', layer: 'result-action',
    currentSource: 'apps/web/components/arena/components/BattleResultPresentation.tsx', singleEquivalent: '完整 Arena 战报与更新结果展示',
    canonicalSource: 'apps/web/components/arena/components/BattleResultPresentation.tsx', reasonCategory: 'product-parity',
    reason: '多人不是第二套简化结果界面。', userAction: '在房间内查看与单人一致的权威结果。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.capability.resultPresentationParity', testId: 'GMR10Q-F-RESULT-ACTION-PARITY',
  }),
  gate({
    code: 'ARENA_DEFAULTS_INHERIT_SINGLE', condition: '多人未声明例外的默认值、输入范围和用户容量继承单人', layer: 'room-shareability',
    currentSource: 'packages/multiplayer-core/src/product-parity-coverage.ts', singleEquivalent: '单人 Arena 的默认值、输入范围与用户侧容量规则',
    canonicalSource: 'apps/web/components/arena/stores/useBattleStore.ts', reasonCategory: 'product-parity',
    reason: '未分类的多人差异不得形成第二套产品语义。', userAction: '按现有 Arena 相同方式配置；差异应显示明确原因。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.capability.defaultsInheritSingle', testId: 'GMR10Q-F-DEFAULT-PARITY',
  }),
  gate({
    code: 'NARRATIVE_HISTORY_SETTINGS_PARITY', condition: 'Room 共享叙事历史 read/write 与 limit/unlimited 设置', layer: 'room-shareability',
    currentSource: 'packages/contracts/src/shared-config.ts', singleEquivalent: '单人叙事历史 read/write 开关与 limit/unlimited 语义保持一致',
    canonicalSource: 'packages/multiplayer-core/src/product-parity-coverage.ts', reasonCategory: 'product-parity',
    reason: '只共享安全选择即可维持用户可感知语义。', userAction: '在 Arena 历史设置中调整叙事历史读取、写入和上限。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.capability.narrativeHistorySettingsParity', testId: 'GMR10Q-F-NARRATIVE-HISTORY-PARITY',
  }),
  gate({
    code: 'NARRATIVE_HISTORY_BODY_LOCAL', condition: '叙事历史正文只在房主 runtime/request scope materialize', layer: 'generation-readiness',
    currentSource: 'packages/contracts/src/room-http.ts', singleEquivalent: '单人从用户本地叙事历史读取正文',
    canonicalSource: 'packages/multiplayer-core/src/product-parity-coverage.ts', reasonCategory: 'security/privacy',
    reason: '叙事历史正文属于本地/私有数据，不因多人 parity 广播给成员。', userAction: '由房主保留并载入本地历史；成员只同步安全设置和结果摘要。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.capability.narrativeHistoryBodyLocal', testId: 'GMR10Q-F-NARRATIVE-HISTORY-PARITY',
  }),
]);
