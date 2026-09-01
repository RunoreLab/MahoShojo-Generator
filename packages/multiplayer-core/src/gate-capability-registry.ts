import {
  ARENA_CANONICAL_CAPABILITIES,
  ARENA_ROOM_ERROR_TAXONOMY,
  MAX_CONTROL_FRAME_BYTES,
  MAX_PENDING_PROPOSALS_PER_MEMBER,
  MAX_ROOM_MEMBERS,
} from '@mahoshojo/contracts/arena-room';

import type { ArenaGateLayer } from './gate-types';
import { ARENA_PRODUCT_PARITY_SEMANTIC_KEYS } from './product-parity-coverage';

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
  readonly nextCondition?: string;
}

export const ARENA_GATE_TEST_EVIDENCE = [
  'packages/contracts/tests/gmr10q-gate-minimization.test.ts::[GMR10Q-CONTRACT-LIMITS] 暴露稳定且具体的 Room HTTP gate error codes，同时保持响应结构兼容',
  'packages/contracts/tests/gmr10q-error-taxonomy.test.ts::[GMR10Q-CONTRACT-TAXONOMY] 协商版本与 HTTP code 是可枚举的稳定 contract',
  'packages/multiplayer-core/tests/gmr10q-gate-registry-readiness.test.ts::[GMR10Q-READINESS] 共享 schema 接受空 roster，但 readiness 返回稳定且可行动的结构化 issue',
  'packages/multiplayer-core/tests/gmr10q-gate-registry-readiness.test.ts::[GMR10Q-CANONICAL-INVENTORY] 对真实 source inventory 做精确集合比对',
  'packages/multiplayer-core/tests/state-machine-lifecycle.test.ts::keeps membership separate from connection state and enforces host/member authority',
  'packages/multiplayer-core/tests/state-machine-proposal-generation.test.ts::supports host rejection and author withdrawal without changing config revision',
  'packages/multiplayer-core/tests/product-parity-coverage.test.ts::[GMR10P-A-ARENA-UI-CONTRACT] 以现有 Arena UI 而非三字段 editor 作为 contract',
  'packages/hosted-api/tests/arena-generation-resource-budget.test.ts::从 dependency-neutral canonical source 继承角色与参考项容量',
  'packages/contracts/tests/proposal.test.ts::supports dependency and atomic-group metadata, and caps change count',
  'packages/multiplayer-core/tests/core.test.ts::returns structured dependency and atomic-group selection problems',
  'packages/multiplayer-core/tests/state-machine-presence.test.ts::deadline closer 只在 exact current deadline 到期后关闭，重复 cleanup 由 terminal state 幂等吸收',
  'packages/multiplayer-core/tests/state-machine-recovery.test.ts::拒绝伪造/序列化 capability、scope 漂移、epoch 复用与 closed Room recovery',
  'packages/multiplayer-core/tests/state-machine-review-regressions.test.ts::fails oversized aggregate snapshots without throwing or poisoning the last valid state',
  'packages/hosted-api/tests/arena-generation-service.test.ts::same actor/request/payload reuses one generation and starts only one producer',
  'apps/web/tests/arena-multiplayer-interaction.test.tsx::空角色草稿直接创建房间，不进入降级或错误路径',
  'apps/web/tests/arena-multiplayer-interaction.test.tsx::本地配置不可共享时仍以 canonical 空草稿创建，成功后列出所有问题',
  'apps/web/tests/arena-room-shared-config.test.ts::角色数与 canonical runtime 的 32 位容量一致',
  'apps/web/tests/arena-room-shared-config.test.ts::辅助情景与素材不再各自限制 10 个，而是共享 256 个引用的累计预算',
  'apps/web/tests/arena-room-shared-config.test.ts::随机占位符不是可共享性问题，其他引用问题仍能稳定定位',
  'apps/web/tests/arena-proposal-panel.test.tsx::host 审阅显示 language 与 team structure typed changes',
  'apps/web/tests/arena-multiplayer-narrative-history-parity.test.tsx::GMR10Q-F-RESULT-ACTION-PARITY：只有房主在权威终态且开启写入时获得本地叙事历史写权',
  'apps/web/tests/arena-multiplayer-generation-bridge.test.ts::多人房主与单人一致地先解析随机角色，再构建可发布草稿',
  'apps/web/tests/arena-multiplayer-interaction.test.tsx::config publish unknown 在 connected 状态提供主动权威对账入口',
  'apps/api/tests/room-http.test.ts::schema preflight 保留角色、累计引用与版本缺失的可行动原因',
  'apps/api/tests/room-http.test.ts::Proposal route 对 malformed JSON、bad UTF-8、change limit 与 byte limit 返回独立错误',
  'apps/api/tests/room-http.test.ts::granular error taxonomy 需显式协商，旧客户端与未知版本只收到 0bb6b883 基线 code',
  'apps/web/tests/arena-battle-result-presentation.test.tsx::用主战报卡呈现流式战报与严格安全摘要',
  'packages/multiplayer-core/tests/state-machine-proposal-generation.test.ts::reserves one immutable attempt and treats an exact duplicate as idempotent',
  'packages/multiplayer-core/tests/state-machine-lifecycle.test.ts::enforces the active member cap without counting revoked authority tombstones',
  'packages/multiplayer-core/tests/state-machine-proposal-generation.test.ts::enforces the pending Proposal cap with a stable failure',
  'packages/multiplayer-core/tests/state-machine-lifecycle.test.ts::creates an open room with one active host and an explicit null predecessor',
  'packages/multiplayer-core/tests/state-machine-lifecycle.test.ts::treats host leave as room close and makes repeated close idempotent',
  'packages/multiplayer-core/tests/state-machine-lifecycle.test.ts::publishes only semantic config changes and rejects member authority',
  'packages/multiplayer-core/tests/core.test.ts::applies scenario, auxiliary/material add-remove, and combatant removal with team cleanup',
  'packages/multiplayer-core/tests/state-machine-proposal-generation.test.ts::submits once, rejects ID conflicts, and never accepts host-authored member proposals',
  'packages/multiplayer-core/tests/state-machine-proposal-generation.test.ts::lets the host atomically accept selected changes and terminally resolves the Proposal',
  'apps/web/tests/arena-room-client.test.ts::create 只发送一次、使用 credentials omit，并严格解析 session',
  'packages/contracts/tests/gmr10q-gate-minimization.test.ts::允许空 roster 安全共享，同时保留唯一键和 team 引用完整性',
  'packages/multiplayer-core/tests/state-machine-review-regressions.test.ts::removes terminal Proposals so normal room history cannot overflow the snapshot schema',
  'packages/hosted-api/tests/arena-generation-service.test.ts::accepts a valid create body exactly at the byte boundary',
  'packages/hosted-api/tests/arena-generation-service.test.ts::clears a completed Redis snapshot when Markdown alone exceeds the byte budget',
  'apps/api/tests/room-http.test.ts::kick/cancel 路由重新认证账号，只接受 strict epoch fence 并返回权威视图',
  'apps/api/tests/arena-room-generation-materializer.test.ts::canonical resolver 的 exact ref 不一致时 fail closed',
  'apps/api/tests/arena-room-generation-materializer.test.ts::host-local payload 必须匹配 frozen stub 的安全内容版本',
  'apps/web/tests/arena-room-host-reconciliation.test.ts::把新 authority 确定性 materialize 到 host BattleStore，并保留 opaque team key',
  'apps/web/tests/arena-battle-result-presentation.test.tsx::房间 viewer 可以沿用主战报卡的保存图片动作',
  'apps/api/tests/room-generation-service.test.ts::definitive downstream rejection %s 终结 Room attempt 并保留具体原因',
  'packages/hosted-runtime/tests/arena-generation-runtime.test.ts::applies the system prompt budget while allowing the same hosted BYOK prompt',
  'packages/hosted-runtime/tests/arena-generation-runtime.test.ts::fails generation when combined reasoning and markdown exceed the shared output byte budget',
] as const;
export type ArenaGateTestEvidence = typeof ARENA_GATE_TEST_EVIDENCE[number];

const testEvidenceByLayer: Readonly<Record<ArenaGateLayer, ArenaGateTestEvidence>> = {
  'room-lifecycle': ARENA_GATE_TEST_EVIDENCE[4],
  'room-shareability': ARENA_GATE_TEST_EVIDENCE[0],
  collaboration: ARENA_GATE_TEST_EVIDENCE[5],
  'generation-readiness': ARENA_GATE_TEST_EVIDENCE[2],
  'runtime-resource': ARENA_GATE_TEST_EVIDENCE[7],
  'result-action': ARENA_GATE_TEST_EVIDENCE[6],
};

const testEvidenceByCode: Readonly<Partial<Record<string, ArenaGateTestEvidence>>> = {
  ROOM_EMPTY_DRAFT_ALLOWED: ARENA_GATE_TEST_EVIDENCE[14],
  ROOM_CONFIG_SCHEMA: ARENA_GATE_TEST_EVIDENCE[15],
  ROOM_CONFIG_COMBATANT_LIMIT: ARENA_GATE_TEST_EVIDENCE[16],
  ROOM_CONFIG_REFERENCE_LIMIT: ARENA_GATE_TEST_EVIDENCE[17],
  ROOM_SHAREABILITY_ISSUES: ARENA_GATE_TEST_EVIDENCE[18],
  COLLABORATION_PRODUCT_TERMINOLOGY: ARENA_GATE_TEST_EVIDENCE[19],
  GENERATION_RANDOM_COMBATANT_RESOLUTION: ARENA_GATE_TEST_EVIDENCE[21],
  RESULT_HOST_WRITE_AUTHORITY: ARENA_GATE_TEST_EVIDENCE[20],
  RESULT_PRESENTATION_PARITY: ARENA_GATE_TEST_EVIDENCE[20],
  NARRATIVE_HISTORY_SETTINGS_PARITY: ARENA_GATE_TEST_EVIDENCE[20],
  NARRATIVE_HISTORY_BODY_LOCAL: ARENA_GATE_TEST_EVIDENCE[20],
  GENERATION_RECONCILIATION: ARENA_GATE_TEST_EVIDENCE[22],
  WEB_LOCAL_VALIDATION: ARENA_GATE_TEST_EVIDENCE[18],
  CONTRACT_SCHEMA_AND_LIMITS: ARENA_GATE_TEST_EVIDENCE[23],
  PROPOSAL_RESOURCE_AND_ATOMICITY: ARENA_GATE_TEST_EVIDENCE[24],
};

const gate = (
  entry: ArenaGateCapabilityRegistryEntry,
): ArenaGateCapabilityRegistryEntry => Object.freeze({
  ...entry,
  testId: entry.testId.includes('::')
    ? entry.testId
    : testEvidenceByCode[entry.code] ?? testEvidenceByLayer[entry.layer],
});

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
    code: 'ROOM_MEMBERSHIP_HISTORY_BOUND', condition: '成员资格审计历史达到 durable snapshot 上限', layer: 'room-lifecycle',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 不维护共享成员资格审计历史',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'resource/concurrency',
    reason: '房间 incarnation 的成员资格墓碑必须有界，避免 durable snapshot 无限增长。', userAction: '关闭当前房间并创建新房间。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomMembershipHistoryBound', testId: ARENA_GATE_TEST_EVIDENCE[12],
  }),
  gate({
    code: 'ROOM_MEMBER_IDENTITY_CONFLICT', condition: '同一房间 incarnation 不得复用不同成员的 identity', layer: 'room-lifecycle',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 没有共享成员 identity',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'distributed-consistency',
    reason: '成员 identity 复用会破坏 authority 与审计归属。', userAction: '重新加入并使用服务器签发的当前成员身份。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomMemberIdentityConflict', testId: ARENA_GATE_TEST_EVIDENCE[4],
  }),
  gate({
    code: 'ROOM_STATE_LIFECYCLE_FENCE', condition: '动作必须作用于存在且处于允许状态的当前房间 incarnation', layer: 'room-lifecycle',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 只作用于当前本地会话',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'distributed-consistency',
    reason: '不存在、已关闭或状态不匹配的 authority state 不得被继续变更。', userAction: '同步当前房间；房间已结束时创建或加入新房间。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomStateLifecycleFence', testId: ARENA_GATE_TEST_EVIDENCE[4],
  }),
  gate({
    code: 'ROOM_HOST_AUTHORITY_REQUIRED', condition: 'host-only 动作必须由当前活跃房主持有 exact authority scope', layer: 'room-lifecycle',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 用户天然拥有自己的本地会话 authority',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'authorization/authority',
    reason: '配置发布、提案处理、生成和管理动作必须保持唯一房主权威。', userAction: '由当前房主执行该动作，或先同步当前房间身份。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomHostAuthorityRequired', testId: ARENA_GATE_TEST_EVIDENCE[4],
  }),
  gate({
    code: 'ROOM_MEMBER_AUTHORITY_REQUIRED', condition: '成员动作必须绑定当前活跃 membership', layer: 'room-lifecycle',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 不需要共享 membership',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'authorization/authority',
    reason: '失效或不存在的成员身份不得提交房间动作。', userAction: '重新加入或恢复当前房间后再操作。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomMemberAuthorityRequired', testId: ARENA_GATE_TEST_EVIDENCE[4],
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
    currentUserMessage: '房间配置存在不支持共享的字段或无效引用，请查看具体问题后修正。', messageKey: 'arena.multiplayer.gate.roomConfigSchema', testId: 'GMR10Q-B-DRAFT-SHAREABILITY',
  }),
  gate({
    code: 'ROOM_EMPTY_DRAFT_ALLOWED', condition: '空角色列表是可创建、可共享、但尚不可生成的合法房间草稿', layer: 'room-shareability',
    currentSource: 'apps/web/components/arena/multiplayer/ArenaMultiplayerPanel.tsx', singleEquivalent: '单人 Arena 可先配置空草稿，开始生成时再校验角色',
    canonicalSource: 'packages/contracts/src/shared-config.ts', reasonCategory: 'product-parity',
    reason: '建房存在性与生成完整性属于不同阶段，空角色只应阻止生成。', userAction: '可先创建房间；开始生成前至少添加 1 位角色。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.capability.roomEmptyDraftAllowed', testId: 'GMR10Q-B-EMPTY-DRAFT',
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
    currentUserMessage: '请先处理下方列出的配置问题，再更新房间配置。', messageKey: 'arena.multiplayer.gate.roomShareabilityIssues', testId: 'GMR10Q-E-STRUCTURED-ISSUES',
  }),
  gate({
    code: 'ROOM_CONFIG_PUBLISH_FENCE', condition: '发布 Shared Config 需要房主 authority 与 exact revision fence', layer: 'room-shareability',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 直接更新自己的当前配置',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'distributed-consistency',
    reason: '防止非房主或旧 revision 覆盖 Room authority。', userAction: '请房主同步最新房间配置后重新发布。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomConfigPublishFence', testId: 'GMR10Q-A-CONFIG-PUBLISH-FENCE',
  }),
  gate({
    code: 'ROOM_CONFIG_APPLY_VALIDATION', condition: '将 Room authority 应用到本地编辑区前必须完成 exact ref、preset 与 host-local 对账', layer: 'room-shareability',
    currentSource: 'apps/web/lib/arena-room/host-reconciliation.ts', singleEquivalent: '单人 Arena 直接使用已在本地完成解析的正文',
    canonicalSource: 'packages/contracts/src/shared-config.ts', reasonCategory: 'security/privacy',
    reason: '共享 stub/ref 不是可直接写入本地编辑区的正文，错误来源或版本必须在任何本地写入前 fail closed。',
    userAction: '刷新对应在线或预置内容；本地正文缺失时恢复房主发布基准后重试。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomConfigApplyValidation', testId: ARENA_GATE_TEST_EVIDENCE[44],
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
    code: 'PROPOSAL_ID_CONFLICT', condition: '提案 identity 不得在同一房间 incarnation 中复用为不同请求', layer: 'collaboration',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 没有跨成员提案 identity',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'distributed-consistency',
    reason: '稳定提案 identity 用于幂等与审计，不得被另一语义请求覆盖。', userAction: '同步房间后以新的提案标识重新提交。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.proposalIdConflict', testId: ARENA_GATE_TEST_EVIDENCE[5],
  }),
  gate({
    code: 'PROPOSAL_HISTORY_BOUND', condition: '终态提案或协作 provenance 达到 durable snapshot 上限', layer: 'collaboration',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 不维护共享提案审计历史',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'resource/concurrency',
    reason: '提案与协作审计记录必须有界，避免 Room snapshot 无限增长。', userAction: '关闭当前房间并创建新房间。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.proposalHistoryBound', testId: ARENA_GATE_TEST_EVIDENCE[12],
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
    code: 'PROPOSAL_STATE_FENCE', condition: 'resolve/withdraw 只能作用于存在且仍为 submitted 的当前提案', layer: 'collaboration',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人 Arena 没有异步共享提案状态',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'distributed-consistency',
    reason: '不存在或已终结的提案不得再次改变权威配置。', userAction: '同步最新提案列表；已处理的提案无需重复操作。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.proposalStateFence', testId: ARENA_GATE_TEST_EVIDENCE[5],
  }),
  gate({
    code: 'COLLABORATION_PRODUCT_TERMINOLOGY', condition: '普通用户界面使用中文协作术语，英文协议名仅进入技术详情', layer: 'collaboration',
    currentSource: 'apps/web/components/arena/multiplayer/ArenaProposalPanel.tsx', singleEquivalent: '单人 Arena 使用面向用户的中文配置术语',
    canonicalSource: 'docs/specs/2026-09-01_073000_Arena多人门禁分层最小化与单人一致性修订.md', reasonCategory: 'product-parity',
    reason: 'Proposal/revision/BASE 等协议术语不是面向普通用户的产品语言。', userAction: '按“配置提案、房间配置版本、提案基准/当前值/建议值”理解和操作。',
    currentUserMessage: '配置提案 / 配置变更明细 / 提案基准 / 当前房间值 / 建议值 / 房间配置版本', messageKey: 'arena.multiplayer.capability.collaborationProductTerminology', testId: 'GMR10Q-E-TERMINOLOGY',
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
    code: 'GENERATION_RANDOM_COMBATANT_RESOLUTION', condition: '开始多人生成前按单人语义解析随机角色占位符', layer: 'generation-readiness',
    currentSource: 'apps/web/components/arena/multiplayer/generation-bridge.ts', singleEquivalent: '单人 Arena 在生成前解析随机角色',
    canonicalSource: 'apps/web/components/arena/hooks/useBattleEngine.ts', reasonCategory: 'product-parity',
    reason: '多人不得把随机占位符当作另一套非法配置，也不得把未解析占位符发送到 runtime。', userAction: '保留随机角色配置；生成时若没有可选角色，再按具体提示补充角色。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.generationRandomCombatantResolution', testId: 'GMR10Q-F-RANDOM-COMBATANT-PARITY',
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
    currentSource: 'packages/hosted-runtime/src/arena-generation/runtime.ts', singleEquivalent: '单人与多人调用同一 Hosted output pipeline',
    canonicalSource: 'packages/hosted-api/src/arena-generation/resource-budget.ts', reasonCategory: 'resource/concurrency',
    reason: '限制单次流式缓存、持久化与 fan-out 正文大小。', userAction: '缩短目标故事长度或拆分生成。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.runtimeOutputLimit', testId: 'GMR10Q-A-RUNTIME-BUDGET',
  }),
  gate({
    code: 'RESULT_HOST_WRITE_AUTHORITY', condition: '只有房主可按共享设置把权威终态追加到自己的本地叙事历史', layer: 'result-action',
    currentSource: 'apps/web/components/arena/multiplayer/useArenaRoomNarrativeHistoryResultWriter.ts', singleEquivalent: '单人用户可把生成结果追加到自己的本地叙事历史',
    canonicalSource: 'packages/multiplayer-core/src/product-parity-coverage.ts', reasonCategory: 'authorization/authority',
    reason: '成员看到权威结果不等于获得房主私有叙事历史写权限。', userAction: '成员可查看结果；叙事历史按房间设置仅由房主本地写入。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.resultHostWriteAuthority', testId: ARENA_GATE_TEST_EVIDENCE[20],
  }),
  gate({
    code: 'RESULT_PRESENTATION_PARITY', condition: '多人权威结果复用单人 Arena presentation', layer: 'result-action',
    currentSource: 'apps/web/components/arena/components/BattleResultPresentation.tsx', singleEquivalent: '完整 Arena 战报与更新结果展示',
    canonicalSource: 'apps/web/components/arena/components/BattleResultPresentation.tsx', reasonCategory: 'product-parity',
    reason: '多人不是第二套简化结果界面。', userAction: '在房间内查看与单人一致的权威结果。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.capability.resultPresentationParity', testId: ARENA_GATE_TEST_EVIDENCE[26],
  }),
  gate({
    code: 'RESULT_PRIVATE_WRITE_ACTIONS_DEFERRED', condition: '多人战报暂不显示 redo、手动应用或私有角色保存动作', layer: 'result-action',
    currentSource: 'apps/web/components/arena/components/BattleResultPresentation.tsx', singleEquivalent: '单人 Arena 可 redo、手动应用并写回完整本地角色',
    canonicalSource: 'docs/specs/2026-09-01_073000_Arena多人门禁分层最小化与单人一致性修订.md', reasonCategory: 'explicit-product-non-goal',
    reason: '当前 Room 结果只投影安全摘要，不包含可验证的完整角色更新正文；直接复用单人写入动作会误写或授予成员私有存储权限。',
    userAction: '当前可查看并保存战报图片；完整角色写回仍使用房主的单人 Arena 流程。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.capability.resultPrivateWriteActionsDeferred', testId: ARENA_GATE_TEST_EVIDENCE[26],
    nextCondition: '定义 host-only typed result-action contract，并能以 generation identity 将完整 host-local 更新正文安全对账后启用。',
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
    currentUserMessage: null, messageKey: 'arena.multiplayer.capability.narrativeHistorySettingsParity', testId: ARENA_GATE_TEST_EVIDENCE[6],
  }),
  gate({
    code: 'NARRATIVE_HISTORY_BODY_LOCAL', condition: '叙事历史正文只在房主 runtime/request scope materialize', layer: 'generation-readiness',
    currentSource: 'apps/web/lib/arena-room/narrative-history-runtime.ts', singleEquivalent: '单人从用户本地叙事历史读取正文',
    canonicalSource: 'packages/multiplayer-core/src/product-parity-coverage.ts', reasonCategory: 'security/privacy',
    reason: '叙事历史正文属于本地/私有数据，不因多人 parity 广播给成员。', userAction: '由房主保留并载入本地历史；成员只同步安全设置和结果摘要。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.capability.narrativeHistoryBodyLocal', testId: ARENA_GATE_TEST_EVIDENCE[6],
  }),
  gate({
    code: 'ROOM_PRESENCE_AUTHORITY', condition: 'presence 只更新连接状态与受信 deadline，不改变 membership', layer: 'room-lifecycle',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人没有共享 presence authority',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'distributed-consistency',
    reason: '连接状态必须与成员资格分离并由受信时间驱动。', userAction: '重新连接并同步当前房间状态。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomPresenceAuthority', testId: ARENA_GATE_TEST_EVIDENCE[10],
  }),
  gate({
    code: 'ROOM_KICK_HOST_REQUIRED', condition: '只有房主可撤销其他活跃成员资格', layer: 'room-lifecycle',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人没有共享成员踢出动作',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'authorization/authority',
    reason: '成员资格撤销是房主最小 authority 动作。', userAction: '请房主执行移出成员操作。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomKickHostRequired', testId: '',
  }),
  gate({
    code: 'ROOM_RECOVERY_FENCE', condition: '恢复必须匹配 incarnation、scope 与既有 durable state', layer: 'room-lifecycle',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人本地恢复不重建共享 authority',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'distributed-consistency',
    reason: '防止旧进程或伪造 capability 复活过期房间。', userAction: '重新进入当前房间实例。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.roomRecoveryFence', testId: ARENA_GATE_TEST_EVIDENCE[11],
  }),
  gate({
    code: 'PROPOSAL_RESOURCE_AND_ATOMICITY', condition: '提案受 change/byte/history/dependsOn/atomic/precondition 约束', layer: 'collaboration',
    currentSource: 'packages/contracts/src/proposals.ts', singleEquivalent: '单人编辑无需跨成员提案队列，但仍使用字段 validation',
    canonicalSource: 'packages/contracts/src/proposals.ts', reasonCategory: 'resource/concurrency',
    reason: '有界 typed change 与原子前置条件保护共享配置一致性。', userAction: '拆分过大提案，并基于最新房间配置重新提交。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.proposalResourceAndAtomicity', testId: ARENA_GATE_TEST_EVIDENCE[8],
  }),
  gate({
    code: 'GENERATION_RECONCILIATION', condition: '生成结果按 identity/attempt/terminal fence 对账', layer: 'generation-readiness',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人同样按 generationRequestId 幂等恢复',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'distributed-consistency',
    reason: '未知结果不得通过第二个 producer 静默重跑。', userAction: '恢复并查询原生成状态后再决定重试。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.generationReconciliation', testId: ARENA_GATE_TEST_EVIDENCE[27],
  }),
  gate({
    code: 'GENERATION_HISTORY_BOUND', condition: 'generation request/id/terminal replay ledger 达到 room-incarnation 上限', layer: 'generation-readiness',
    currentSource: 'packages/multiplayer-core/src/state-machine.ts', singleEquivalent: '单人生成也保留有界幂等记录，但没有共享 Room snapshot',
    canonicalSource: 'packages/multiplayer-core/src/state-machine-model.ts', reasonCategory: 'resource/concurrency',
    reason: '幂等与终态 fence 必须保留且有界，达到上限后不能静默丢弃旧身份再重跑 Provider。', userAction: '关闭当前房间并创建新房间。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.generationHistoryBound', testId: ARENA_GATE_TEST_EVIDENCE[12],
  }),
  gate({
    code: 'RUNTIME_ADJUDICATION_LIMIT', condition: 'adjudication event 数量不得超过 Hosted sanity ceiling', layer: 'runtime-resource',
    currentSource: 'packages/hosted-api/src/arena-generation/resource-budget.ts', singleEquivalent: '单人与多人使用同一 Hosted ceiling',
    canonicalSource: 'packages/hosted-api/src/arena-generation/resource-budget.ts', reasonCategory: 'resource/concurrency',
    reason: '限制规则裁定输入体积与 provider 成本。', userAction: '减少裁定事件后重新生成。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.runtimeAdjudicationLimit', testId: '',
  }),
  gate({
    code: 'RUNTIME_PROVIDER_CONFIG', condition: 'provider/model/credential 配置由 host runtime 校验且不进入 Room', layer: 'runtime-resource',
    currentSource: 'packages/hosted-api/src/arena-generation/service.ts', singleEquivalent: '单人与多人使用相同 provider 校验',
    canonicalSource: 'packages/contracts/src/arena-error-taxonomy.ts', reasonCategory: 'security/privacy',
    reason: 'provider credential 是 host-local secret，且无效配置必须在调用前失败。', userAction: '由房主修正模型、Provider 或凭据配置。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.runtimeProviderConfig', testId: '',
  }),
  gate({
    code: 'WEB_LOCAL_VALIDATION', condition: 'Web 本地检查只做即时反馈，authority 仍由服务端复验', layer: 'room-shareability',
    currentSource: 'apps/web/lib/arena-room/shared-config.ts', singleEquivalent: '单人 UI 使用同一内容 validation',
    canonicalSource: 'packages/contracts/src/shared-config.ts', reasonCategory: 'security/privacy',
    reason: '客户端 validation 不得替代共享 contract 与服务器 authority。', userAction: '按字段提示修正；服务端仍可能返回更精确的权限或版本错误。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.capability.webLocalValidation', testId: '',
  }),
  gate({
    code: 'CONTRACT_SCHEMA_AND_LIMITS', condition: 'wire schema 与 canonical limits 是所有 producer/consumer 的共同边界', layer: 'room-shareability',
    currentSource: 'packages/contracts/src/shared-config.ts', singleEquivalent: '单人/多人共用可共享语义和 runtime capacity',
    canonicalSource: 'packages/contracts/src/arena-capabilities.ts', reasonCategory: 'product-parity',
    reason: '避免 Web、API 与 Hosted runtime 各自维护 magic limit。', userAction: '修正具体 schema issue 或减少到公开容量内。',
    currentUserMessage: null, messageKey: 'arena.multiplayer.gate.contractSchemaAndLimits', testId: '',
  }),
]);

export const ARENA_GATE_SOURCE_INVENTORY = Object.freeze({
  stateMachineFailureReasons: [
    'invalid-state', 'invalid-command', 'invalid-authority-context', 'state-required',
    'state-already-exists', 'room-epoch-mismatch', 'room-epoch-reuse',
    'room-revision-mismatch', 'room-closed', 'host-required', 'member-required',
    'member-not-active', 'member-limit-reached', 'member-history-limit-reached',
    'member-id-conflict', 'proposal-id-conflict', 'proposal-pending-limit-reached',
    'proposal-history-limit-reached', 'proposal-not-found', 'proposal-not-submitted',
    'proposal-author-required', 'proposal-selection-invalid', 'proposal-conflict',
    'generation-active', 'generation-history-limit-reached', 'generation-request-conflict',
    'generation-id-conflict', 'generation-identity-mismatch', 'generation-attempt-mismatch',
    'generation-transition-invalid', 'generation-terminal-conflict', 'authority-scope-mismatch',
    'authority-scope-expired', 'deadline-not-reached', 'invalid-trusted-time',
    'command-timestamp-mismatch', 'command-timestamp-regression',
    'collaborative-history-limit-reached', 'room-snapshot-too-large',
  ],
  roomHttpErrorCodes: [
    'ROOM_AUTHENTICATION_REQUIRED', 'ROOM_AUTHENTICATION_DENIED', 'ROOM_FORBIDDEN',
    'ROOM_NOT_FOUND', 'ROOM_PAYLOAD_TOO_LARGE', 'ROOM_REQUEST_INVALID', 'ROOM_CONFLICT',
    'ROOM_RATE_LIMITED', 'ROOM_UNAVAILABLE', 'ROOM_GENERATION_COMBATANTS_EMPTY',
    'ROOM_GENERATION_COMBATANTS_INSUFFICIENT', 'ROOM_GENERATION_SCENARIO_REQUIRED',
    'ROOM_GENERATION_COMBATANT_LIMIT', 'ROOM_GENERATION_RANDOM_COMBATANT_UNRESOLVED',
    'ROOM_GENERATION_RECONCILIATION_REQUIRED', 'ROOM_MEMBER_LIMIT_REACHED',
    'ROOM_PROPOSAL_PENDING_LIMIT_REACHED', 'ROOM_PROPOSAL_CHANGE_LIMIT',
    'ROOM_PROPOSAL_BYTE_LIMIT', 'ROOM_CONFIG_FRAME_TOO_LARGE',
    'ROOM_CONFIG_SHAREABILITY_INVALID',
    'ROOM_CONFIG_COMBATANT_LIMIT', 'ROOM_CONFIG_REFERENCE_LIMIT',
    'ROOM_HOST_LOCAL_PAYLOAD_MISSING', 'ROOM_HOST_LOCAL_PAYLOAD_INVALID',
    'ROOM_HOST_LOCAL_KIND_MISMATCH', 'ROOM_HOST_LOCAL_DIGEST_MISMATCH',
    'ROOM_HOST_LOCAL_TYPE_MISMATCH', 'ROOM_HOST_LOCAL_CONTENT_VERSION_MISSING',
    'ROOM_HOST_LOCAL_PAYLOAD_MISSING_OR_MISMATCH',
    'ROOM_HOST_LOCAL_CONTENT_VERSION_MISMATCH', 'ROOM_REFERENCE_VERSION_MISSING',
    'ROOM_REFERENCE_STALE', 'ROOM_REFERENCE_DENIED', 'ROOM_RUNTIME_BODY_LIMIT',
    'ROOM_RUNTIME_REFERENCE_LIMIT', 'ROOM_RUNTIME_ADJUDICATION_LIMIT',
    'ROOM_RUNTIME_PROMPT_BUDGET_EXCEEDED', 'ROOM_PROVIDER_CONFIG_INVALID',
  ],
  generationReadinessIssueCodes: [
    'GENERATION_COMBATANTS_EMPTY', 'GENERATION_COMBATANTS_INSUFFICIENT',
    'GENERATION_SCENARIO_REQUIRED', 'GENERATION_COMBATANT_LIMIT',
  ],
  runtimeResourceBudgetKeys: [
    'hardBodyBytes', 'cancelBodyBytes', 'maxCombatants', 'maxAdjudicationEvents',
    'maxReferenceItemsSanity', 'maxOutputBytes', 'maxEstimatedPromptTokens',
  ],
  productParitySemanticKeys: Object.freeze(Object.entries(ARENA_PRODUCT_PARITY_SEMANTIC_KEYS)
    .flatMap(([group, keys]) => keys.map((key) => `${group}:${key}`))),
});

export const ARENA_GATE_SOURCE_CATEGORIES = Object.freeze([
  Object.freeze({
    category: 'state-machine-failure-reason',
    currentSource: 'packages/multiplayer-core/src/state-machine-model.ts',
    classifiedItems: ARENA_GATE_SOURCE_INVENTORY.stateMachineFailureReasons,
  }),
  Object.freeze({
    category: 'room-http-error-code',
    currentSource: 'packages/contracts/src/arena-error-taxonomy.ts',
    classifiedItems: ARENA_GATE_SOURCE_INVENTORY.roomHttpErrorCodes,
  }),
  Object.freeze({
    category: 'generation-readiness-code',
    currentSource: 'packages/multiplayer-core/src/generation-readiness.ts',
    classifiedItems: ARENA_GATE_SOURCE_INVENTORY.generationReadinessIssueCodes,
  }),
  Object.freeze({
    category: 'runtime-resource-budget-key',
    currentSource: 'packages/hosted-api/src/arena-generation/resource-budget.ts',
    classifiedItems: ARENA_GATE_SOURCE_INVENTORY.runtimeResourceBudgetKeys,
  }),
  Object.freeze({
    category: 'product-parity-semantic-key',
    currentSource: 'packages/multiplayer-core/src/product-parity-coverage.ts',
    classifiedItems: ARENA_GATE_SOURCE_INVENTORY.productParitySemanticKeys,
  }),
]);

export const ARENA_GATE_DOMAIN_HTTP_CODE_MAP = Object.freeze(Object.fromEntries(
  ARENA_ROOM_ERROR_TAXONOMY.map(({ domainCode, httpCode, hostedCodes }) => [
    domainCode,
    Object.freeze({ httpCode, hostedCodes }),
  ]),
));

const classifyStateReasons = (
  reasons: readonly string[],
  gateCode: string,
  testId: ArenaGateTestEvidence,
) => reasons.map((reason) => Object.freeze({ reason, gateCode, testId }));

/** Exhaustive classification of the runtime-enumerable state-machine reason inventory. */
export const ARENA_STATE_MACHINE_FAILURE_REASON_REGISTRY = Object.freeze([
  ...classifyStateReasons([
    'invalid-state', 'invalid-command', 'state-required', 'state-already-exists', 'room-closed',
  ], 'ROOM_STATE_LIFECYCLE_FENCE', ARENA_GATE_TEST_EVIDENCE[4]),
  ...classifyStateReasons([
    'invalid-authority-context', 'authority-scope-mismatch', 'authority-scope-expired',
    'room-epoch-reuse', 'invalid-trusted-time', 'command-timestamp-mismatch',
    'command-timestamp-regression',
  ], 'ROOM_RECOVERY_FENCE', ARENA_GATE_TEST_EVIDENCE[11]),
  ...classifyStateReasons([
    'room-epoch-mismatch', 'room-revision-mismatch',
  ], 'ROOM_CONFIG_PUBLISH_FENCE', ARENA_GATE_TEST_EVIDENCE[4]),
  ...classifyStateReasons(['host-required'], 'ROOM_HOST_AUTHORITY_REQUIRED', ARENA_GATE_TEST_EVIDENCE[4]),
  ...classifyStateReasons([
    'member-required', 'member-not-active',
  ], 'ROOM_MEMBER_AUTHORITY_REQUIRED', ARENA_GATE_TEST_EVIDENCE[4]),
  ...classifyStateReasons(['member-limit-reached'], 'ROOM_MEMBER_LIMIT', ARENA_GATE_TEST_EVIDENCE[28]),
  ...classifyStateReasons(['member-history-limit-reached'], 'ROOM_MEMBERSHIP_HISTORY_BOUND', ARENA_GATE_TEST_EVIDENCE[12]),
  ...classifyStateReasons(['member-id-conflict'], 'ROOM_MEMBER_IDENTITY_CONFLICT', ARENA_GATE_TEST_EVIDENCE[4]),
  ...classifyStateReasons(['proposal-id-conflict'], 'PROPOSAL_ID_CONFLICT', ARENA_GATE_TEST_EVIDENCE[5]),
  ...classifyStateReasons(['proposal-pending-limit-reached'], 'PROPOSAL_PENDING_LIMIT', ARENA_GATE_TEST_EVIDENCE[29]),
  ...classifyStateReasons([
    'proposal-history-limit-reached', 'collaborative-history-limit-reached',
  ], 'PROPOSAL_HISTORY_BOUND', ARENA_GATE_TEST_EVIDENCE[12]),
  ...classifyStateReasons([
    'proposal-not-found', 'proposal-not-submitted',
  ], 'PROPOSAL_STATE_FENCE', ARENA_GATE_TEST_EVIDENCE[5]),
  ...classifyStateReasons(['proposal-author-required'], 'PROPOSAL_ACTION_AUTHORITY', ARENA_GATE_TEST_EVIDENCE[5]),
  ...classifyStateReasons([
    'proposal-selection-invalid', 'proposal-conflict',
  ], 'PROPOSAL_REVISION_CONFLICT', ARENA_GATE_TEST_EVIDENCE[9]),
  ...classifyStateReasons(['generation-active'], 'RUNTIME_SINGLE_PRODUCER', ARENA_GATE_TEST_EVIDENCE[27]),
  ...classifyStateReasons(['generation-history-limit-reached'], 'GENERATION_HISTORY_BOUND', ARENA_GATE_TEST_EVIDENCE[12]),
  ...classifyStateReasons([
    'generation-request-conflict', 'generation-id-conflict', 'generation-identity-mismatch', 'generation-attempt-mismatch',
    'generation-transition-invalid', 'generation-terminal-conflict',
  ], 'GENERATION_RECONCILIATION', ARENA_GATE_TEST_EVIDENCE[27]),
  ...classifyStateReasons([
    'deadline-not-reached',
  ], 'ROOM_PRESENCE_AUTHORITY', ARENA_GATE_TEST_EVIDENCE[10]),
  ...classifyStateReasons([
    'room-snapshot-too-large',
  ], 'ROOM_CONFIG_FRAME_LIMIT', ARENA_GATE_TEST_EVIDENCE[12]),
]);

export const ARENA_GATE_WORKFLOW_CAPABILITY_REGISTRY = Object.freeze([
  ['room-create', 'ROOM_CREATE_AUTH_REQUIRED', 30],
  ['room-join', 'ROOM_MEMBER_LIMIT', 28],
  ['room-leave', 'ROOM_LEAVE_MEMBERSHIP_REQUIRED', 31],
  ['room-close', 'ROOM_CLOSE_HOST_REQUIRED', 31],
  ['room-presence', 'ROOM_PRESENCE_AUTHORITY', 10],
  ['room-kick', 'ROOM_KICK_HOST_REQUIRED', 41],
  ['room-recovery', 'ROOM_RECOVERY_FENCE', 11],
  ['shared-config-build', 'ROOM_CONFIG_SCHEMA', 37],
  ['shared-config-publish', 'ROOM_CONFIG_PUBLISH_FENCE', 32],
  ['shared-config-apply', 'ROOM_CONFIG_APPLY_VALIDATION', 44],
  ['proposal-submit', 'PROPOSAL_ACTION_AUTHORITY', 34],
  ['proposal-resolve', 'PROPOSAL_ACTION_AUTHORITY', 35],
  ['proposal-withdraw', 'PROPOSAL_ACTION_AUTHORITY', 5],
  ['proposal-byte-limit', 'PROPOSAL_RESOURCE_AND_ATOMICITY', 24],
  ['proposal-change-limit', 'PROPOSAL_RESOURCE_AND_ATOMICITY', 24],
  ['proposal-pending-limit', 'PROPOSAL_PENDING_LIMIT', 29],
  ['proposal-history-limit', 'PROPOSAL_HISTORY_BOUND', 38],
  ['proposal-depends-on', 'PROPOSAL_RESOURCE_AND_ATOMICITY', 9],
  ['proposal-atomic-apply', 'PROPOSAL_RESOURCE_AND_ATOMICITY', 9],
  ['proposal-precondition', 'PROPOSAL_REVISION_CONFLICT', 9],
  ['generation-readiness', 'GENERATION_COMBATANTS_EMPTY', 2],
  ['generation-reference', 'REFERENCE_STALE', 42],
  ['generation-host-local', 'HOST_LOCAL_PAYLOAD_MISSING', 43],
  ['generation-reconciliation', 'GENERATION_RECONCILIATION', 27],
  ['runtime-funding', 'RUNTIME_PROMPT_BUDGET', 47],
  ['runtime-body', 'RUNTIME_BODY_LIMIT', 39],
  ['runtime-token', 'RUNTIME_PROMPT_BUDGET', 47],
  ['runtime-output', 'RUNTIME_OUTPUT_LIMIT', 48],
  ['runtime-provider', 'RUNTIME_PROVIDER_CONFIG', 46],
  ['runtime-single-producer', 'RUNTIME_SINGLE_PRODUCER', 13],
  ['result-presentation', 'RESULT_PRESENTATION_PARITY', 26],
  ['result-save-image', 'RESULT_PRESENTATION_PARITY', 45],
  ['result-narrative-history-write', 'RESULT_HOST_WRITE_AUTHORITY', 20],
  ['result-private-write-actions-deferred', 'RESULT_PRIVATE_WRITE_ACTIONS_DEFERRED', 26],
  ['web-local-validation', 'WEB_LOCAL_VALIDATION', 18],
  ['contracts-schemas', 'CONTRACT_SCHEMA_AND_LIMITS', 37],
  ['contracts-limits', 'CONTRACT_SCHEMA_AND_LIMITS', 0],
].map(([capability, gateCode, evidenceIndex]) => Object.freeze({
  capability: String(capability),
  gateCode: String(gateCode),
  testId: ARENA_GATE_TEST_EVIDENCE[Number(evidenceIndex)]!,
})));
