'use client';

import { useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';

import type {
  ArenaProposal,
  ArenaProposalChange,
  ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';
import {
  previewArenaProposalApplication,
  type ArenaProposalChangeAnalysis,
} from '@mahoshojo/multiplayer-core';

import {
  arenaRoomReferenceSourcePrefix,
  dataCardReferenceRequest,
  parseArenaRoomReferenceKey,
  presetReferenceRequest,
  resolveArenaRoomReferenceName,
  shortReferenceId,
  useArenaRoomReferenceNames,
  type ArenaRoomReferenceRequest,
} from '@/lib/arena-room/reference-presentation';

import type {
  ArenaRoomController,
  ArenaRoomControllerState,
} from '@/lib/arena-room/controller';
import {
  ArenaProposalEditorError,
  assertArenaProposalSelection,
} from '@/lib/arena-room/proposal-editor';
import { buttonClassName } from '@/components/shared/ui/Button';
import { ActionBar } from '@/components/shared/ui/ActionBar';

import type { ArenaRoomProposalWorkspace } from './useArenaRoom';
import {
  arenaBattleModeCopy,
  arenaLanguageCopy,
  arenaStoryLengthValueCopy,
} from './presentation/value-copy';

type ProposalController = Pick<
  ArenaRoomController,
  'reconnect' | 'resolveProposal' | 'submitProposal' | 'withdrawProposal'
>;

export type ArenaProposalPanelProps = {
  readonly state: ArenaRoomControllerState;
  readonly controller: ProposalController;
  readonly workspace: ArenaRoomProposalWorkspace;
};

const safeText = (value: string, max = 80): string => (
  value.length <= max ? value : `${value.slice(0, max)}…`
);

const refIdentity = (value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '空目标';
  const record = value as Record<string, unknown>;
  if (typeof record.id === 'string') return safeText(record.id);
  if (typeof record.key === 'string') return safeText(record.key);
  return '已绑定目标';
};

const namespacedRefIdentity = (ref: { readonly id: string }, key?: string): string => (
  `${key?.startsWith('preset:') ? '预设' : '在线'}:${safeText(ref.id)}`
);

/**
 * 提案摘要的可读名称解析插槽：返回 undefined 时回退到原始 key/ID 展示。
 * 名称来自统一引用 resolver（预设策展目录 + 公开卡名称缓存 + 房主本地分享名）。
 */
export type ArenaProposalChangeLabels = {
  readonly combatantKey?: (key: string) => string | undefined;
  readonly scenarioKey?: (key: string) => string | undefined;
  readonly materialKey?: (key: string) => string | undefined;
  readonly teamKey?: (key: string) => string | undefined;
  readonly ref?: (
    ref: { readonly id: string; readonly kind: string; readonly versionToken?: string },
    key?: string,
  ) => string | undefined;
};

export const arenaProposalExpectedBaseSummary = (change: ArenaProposalChange): string => {
  const expected = change.expectedBase;
  if (expected.kind === 'absent') return '提案基准：目标不存在';
  if (expected.kind === 'ref' || expected.kind === 'present') {
    return `提案基准：${typeof expected.key === 'string' ? safeText(expected.key) : refIdentity(expected.ref)}`;
  }
  return typeof expected.value === 'string'
    ? `提案基准：${safeText(expected.value || '空值')}`
    : '提案基准：已绑定安全值';
};

const safeJsonSummary = (value: unknown): string => {
  if (value === undefined) return '无';
  if (typeof value === 'string') return safeText(value || '空值', 120);
  try {
    return safeText(JSON.stringify(value), 160);
  } catch {
    return '不可序列化值';
  }
};

const combatantLabelOf = (labels: ArenaProposalChangeLabels | undefined, key: string): string => (
  labels?.combatantKey ? labels.combatantKey(key) ?? key : key
);
const teamKeyLabelOf = (labels: ArenaProposalChangeLabels | undefined, key: string): string => (
  labels?.teamKey ? labels.teamKey(key) ?? key : key
);
const scenarioKeyLabelOf = (labels: ArenaProposalChangeLabels | undefined, key: string): string => (
  labels?.scenarioKey ? labels.scenarioKey(key) ?? key : key
);
const materialKeyLabelOf = (labels: ArenaProposalChangeLabels | undefined, key: string): string => (
  labels?.materialKey ? labels.materialKey(key) ?? key : key
);

/** 从房间共享配置找回被 key 引用的在线卡版本；预设版本由策展目录提供。 */
const onlineVersionTokenOf = (
  config: ArenaRoomSharedConfig | null | undefined,
  key: string,
): string | undefined => {
  if (!config) return undefined;
  const entry = config.combatants.find((item) => item.key === key)
    ?? config.auxScenarios.find((item) => item.key === key)
    ?? config.materials.find((item) => item.key === key)
    ?? (config.scenario?.key === key ? config.scenario : undefined);
  return entry && 'ref' in entry ? entry.ref.versionToken : undefined;
};

/** key 解析为引用请求：绑定房间引用的版本；预设目录版本仅作回退。 */
const referenceRequestOfKey = (
  config: ArenaRoomSharedConfig | null | undefined,
  key: string,
  fallbackKind: ArenaRoomReferenceRequest['kind'],
): ArenaRoomReferenceRequest | null => {
  const parsed = parseArenaRoomReferenceKey(key, fallbackKind);
  if (!parsed) return null;
  if (parsed.source === 'preset') {
    return presetReferenceRequest(parsed.kind, parsed.id, onlineVersionTokenOf(config, key));
  }
  return dataCardReferenceRequest(parsed.kind, {
    id: parsed.id,
    versionToken: onlineVersionTokenOf(config, key),
  });
};

/** add/setScenario 的 ref + 可选 namespace key 解析为绑定版本的引用请求。 */
const referenceRequestOfRef = (
  kind: ArenaRoomReferenceRequest['kind'],
  ref: { readonly id: string; readonly versionToken?: string },
  key: string | undefined,
): ArenaRoomReferenceRequest => ({
  source: key !== undefined && key.startsWith('preset:') ? 'preset' : 'data-card',
  kind,
  id: ref.id,
  ...(ref.versionToken === undefined ? {} : { versionToken: ref.versionToken }),
});

/** 收集提案变更中所有可解析为预设/在线公开引用的名称请求（绑定引用版本）。 */
export const collectArenaProposalReferenceRequests = (
  changes: readonly ArenaProposalChange[],
  config?: ArenaRoomSharedConfig | null,
): ArenaRoomReferenceRequest[] => {
  const requests: ArenaRoomReferenceRequest[] = [];
  const push = (request: ArenaRoomReferenceRequest | null): void => {
    if (request) requests.push(request);
  };
  for (const change of changes) {
    switch (change.type) {
      case 'addCombatant':
        push(referenceRequestOfRef('character', change.ref, change.key));
        break;
      case 'removeCombatant':
      case 'setCharacterGuidance':
      case 'assignTeam':
        push(referenceRequestOfKey(config, change.combatantKey, 'character'));
        break;
      case 'setScenario':
        if (change.ref !== null) {
          push(referenceRequestOfRef('scenario', change.ref, change.key));
        }
        break;
      case 'addAuxScenario':
        push(referenceRequestOfRef('scenario', change.ref, change.key));
        break;
      case 'removeAuxScenario':
        push(referenceRequestOfKey(config, change.scenarioKey, 'scenario'));
        break;
      case 'addMaterial':
        push(referenceRequestOfRef('material', change.ref, change.key));
        break;
      case 'removeMaterial':
        push(referenceRequestOfKey(config, change.materialKey, 'material'));
        break;
      case 'reorderCombatants':
      case 'reorderTeamCombatants':
        change.value.forEach((key) => push(referenceRequestOfKey(config, key, 'character')));
        break;
      case 'reorderAuxScenarios':
        change.value.forEach((key) => push(referenceRequestOfKey(config, key, 'scenario')));
        break;
      case 'reorderMaterials':
        change.value.forEach((key) => push(referenceRequestOfKey(config, key, 'material')));
        break;
      default:
        break;
    }
  }
  return requests;
};

/** 由共享配置 + 统一引用名称缓存构建提案摘要标签；找不到时回退原始 key。 */
export const buildArenaProposalChangeLabels = (
  changes: readonly ArenaProposalChange[],
  config: ArenaRoomSharedConfig | null,
  onlineNames: ReadonlyMap<string, string>,
): ArenaProposalChangeLabels => {
  const prefixedName = (
    request: ArenaRoomReferenceRequest,
    fallback: string | undefined,
  ): string | undefined => {
    const name = resolveArenaRoomReferenceName(request, onlineNames);
    if (name) return `${arenaRoomReferenceSourcePrefix(request.source)}:${name}`;
    return fallback;
  };
  const fallbackOf = (request: ArenaRoomReferenceRequest): string => (
    `${arenaRoomReferenceSourcePrefix(request.source)}:${shortReferenceId(request.id)}`
  );
  const hostLocalNameOf = (key: string): string | undefined => {
    const entry = config?.combatants.find((item) => item.key === key);
    if (entry && !('ref' in entry)) return `房主本地:${entry.displayName}`;
    const scenario = config?.auxScenarios.find((item) => item.key === key)
      ?? (config?.scenario && config.scenario.key === key ? config.scenario : undefined);
    if (scenario && !('ref' in scenario)) return `房主本地:${scenario.displayName}`;
    const material = config?.materials.find((item) => item.key === key);
    if (material && !('ref' in material)) return `房主本地:${material.displayName}`;
    return undefined;
  };
  const keyLabelOf = (fallbackKind: ArenaRoomReferenceRequest['kind']) => (key: string): string | undefined => {
    const request = referenceRequestOfKey(config, key, fallbackKind);
    if (!request) return hostLocalNameOf(key);
    return prefixedName(request, fallbackOf(request));
  };
  return {
    combatantKey: keyLabelOf('character'),
    scenarioKey: keyLabelOf('scenario'),
    materialKey: keyLabelOf('material'),
    teamKey: (key) => config?.teams.find((team) => team.key === key)?.displayName,
    ref: (ref, key) => {
      const request = referenceRequestOfRef(
        ref.kind === 'scenario' ? 'scenario' : ref.kind === 'material' ? 'material' : 'character',
        ref,
        key,
      );
      return prefixedName(request, fallbackOf(request));
    },
  };
};

/** 提案摘要标签 hook：预设走策展目录，在线公开卡走共享名称缓存（按引用版本缓存）。 */
export const useArenaProposalChangeLabels = (
  config: ArenaRoomSharedConfig | null,
  changes: readonly ArenaProposalChange[],
): ArenaProposalChangeLabels => {
  const requests = useMemo(
    () => collectArenaProposalReferenceRequests(changes, config),
    [changes, config],
  );
  const onlineNames = useArenaRoomReferenceNames(requests);
  return useMemo(
    () => buildArenaProposalChangeLabels(changes, config, onlineNames),
    [changes, config, onlineNames],
  );
};

export const arenaProposalChangeSummary = (
  change: ArenaProposalChange,
  labels?: ArenaProposalChangeLabels,
): string => {
  const refLabel = (ref: { readonly id: string; readonly kind: string }, key?: string): string => (
    labels?.ref ? labels.ref(ref, key) ?? namespacedRefIdentity(ref, key) : namespacedRefIdentity(ref, key)
  );
  switch (change.type) {
    case 'addCombatant': return `新增角色 ${refLabel(change.ref, change.key)}`;
    case 'removeCombatant': return `移除角色 ${combatantLabelOf(labels, change.combatantKey)}`;
    case 'setCharacterGuidance': return `修改角色引导 ${combatantLabelOf(labels, change.combatantKey)}`;
    case 'assignTeam': return `调整队伍 ${combatantLabelOf(labels, change.combatantKey)}`;
    case 'addTeam': return `新增队伍 ${change.displayName}`;
    case 'removeTeam': return `移除队伍 ${teamKeyLabelOf(labels, change.teamKey)}`;
    case 'renameTeam': return `队伍 ${teamKeyLabelOf(labels, change.teamKey)} 改名为 ${safeText(change.value)}`;
    case 'reorderCombatants': return '调整角色顺序';
    case 'reorderTeams': return '调整队伍顺序';
    case 'reorderTeamCombatants': return `调整队伍 ${teamKeyLabelOf(labels, change.teamKey)} 内角色顺序`;
    case 'setBattleMode': return `战斗模式改为 ${arenaBattleModeCopy[change.value]}`;
    case 'setSelectedLanguage': return `语言改为 ${arenaLanguageCopy(change.value)}`;
    case 'setScenario': return change.ref === null ? '清除主情景' : `主情景改为 ${refLabel(change.ref, change.key)}`;
    case 'addAuxScenario': return `新增辅助情景 ${refLabel(change.ref, change.key)}`;
    case 'removeAuxScenario': return `移除辅助情景 ${scenarioKeyLabelOf(labels, change.scenarioKey)}`;
    case 'reorderAuxScenarios': return '调整辅助情景顺序';
    case 'addMaterial': return `新增素材 ${refLabel(change.ref, change.key)}`;
    case 'removeMaterial': return `移除素材 ${materialKeyLabelOf(labels, change.materialKey)}`;
    case 'reorderMaterials': return '调整素材顺序';
    case 'setUserGuidance': return `全局引导改为“${safeText(change.value || '空值')}”`;
    case 'setStoryLength': return `故事长度改为 ${arenaStoryLengthValueCopy(change.value, change.customStoryLength ?? null)}`;
    case 'setHistorySettings': return '修改共享历史读取/写入设置';
  }
};

const enabledSummary = (enabled: boolean): string => enabled ? '开' : '关';

const historyReadSummary = (
  enabled: boolean,
  unlimited: boolean,
  limit: number,
): string => {
  if (!enabled) return '关';
  return unlimited ? '开(无限)' : `开(${limit})`;
};

export const arenaProposalChangeProposedSummary = (
  change: ArenaProposalChange,
  labels?: ArenaProposalChangeLabels,
): string => {
  switch (change.type) {
    case 'reorderCombatants':
    case 'reorderTeamCombatants':
      return `${arenaProposalChangeSummary(change, labels)}：${change.value.map((key) => combatantLabelOf(labels, key)).join(' → ')}`;
    case 'reorderTeams':
      return `${arenaProposalChangeSummary(change, labels)}：${change.value.map((key) => teamKeyLabelOf(labels, key)).join(' → ')}`;
    case 'reorderAuxScenarios':
      return `${arenaProposalChangeSummary(change, labels)}：${change.value.map((key) => scenarioKeyLabelOf(labels, key)).join(' → ')}`;
    case 'reorderMaterials':
      return `${arenaProposalChangeSummary(change, labels)}：${change.value.map((key) => materialKeyLabelOf(labels, key)).join(' → ')}`;
    case 'setCharacterGuidance':
      return change.value === null
        ? `清空角色 ${combatantLabelOf(labels, change.combatantKey)} 引导`
        : `角色 ${combatantLabelOf(labels, change.combatantKey)} 引导改为“${safeText(change.value, 120)}”`;
    case 'assignTeam':
      return change.teamKey === null
        ? `角色 ${combatantLabelOf(labels, change.combatantKey)} 取消队伍分配`
        : `角色 ${combatantLabelOf(labels, change.combatantKey)} 分配至队伍 ${teamKeyLabelOf(labels, change.teamKey)}`;
    case 'setHistorySettings': {
      const value = change.value;
      return [
        `竞技场历史 读取=${historyReadSummary(value.readArenaHistory, value.isArenaHistoryUnlimited, value.readArenaHistoryLimit)}、写入=${enabledSummary(value.writeArenaHistory)}`,
        `当前状态 读取=${enabledSummary(value.readCurrentState)}、写入=${enabledSummary(value.writeCurrentState)}`,
        `叙事历史 读取=${historyReadSummary(value.readNarrativeHistory, value.isNarrativeHistoryUnlimited, value.readNarrativeHistoryLimit)}、写入=${enabledSummary(value.writeNarrativeHistory)}`,
      ].join('；');
    }
    default:
      return arenaProposalChangeSummary(change, labels);
  }
};

export const ArenaProposalSelectionDetails = ({ change }: { readonly change: ArenaProposalChange }) => (
  <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">
    {arenaProposalExpectedBaseSummary(change)}
    {change.dependsOn?.length ? ` · 依赖 ${change.dependsOn.join('、')}` : ''}
    {change.atomicGroupId ? ` · 联动变更组 ${change.atomicGroupId}` : ''}
  </span>
);

export const arenaProposalSelectionError = (
  changes: readonly ArenaProposalChange[],
  selected: ReadonlySet<string>,
): string | null => {
  if (selected.size === 0) return '至少选择一项变更';
  try {
    assertArenaProposalSelection(changes, [...selected]);
    return null;
  } catch (error) {
    return error instanceof ArenaProposalEditorError
      ? '所选变更缺少依赖或拆分了联动变更组'
      : '所选变更无效';
  }
};

/**
 * 悬停提示：可读名称可能被名称缓存/策展目录遮蔽原始引用身份，
 * 这里统一暴露完整原始 key（含 namespace 与完整 ID）。
 */
export const changeRefTitle = (change: ArenaProposalChange): string | undefined => {
  switch (change.type) {
    case 'addCombatant':
    case 'addAuxScenario':
    case 'addMaterial':
      return change.key ?? `data-card:${change.ref.id}`;
    case 'setScenario':
      return change.ref === null ? undefined : change.key ?? `data-card:${change.ref.id}`;
    case 'removeCombatant':
    case 'setCharacterGuidance':
    case 'assignTeam':
      return change.combatantKey;
    case 'removeAuxScenario':
      return change.scenarioKey;
    case 'removeMaterial':
      return change.materialKey;
    case 'reorderCombatants':
    case 'reorderTeams':
    case 'reorderTeamCombatants':
    case 'reorderAuxScenarios':
    case 'reorderMaterials':
      return change.value.join(' → ');
    default:
      return undefined;
  }
};

export const arenaProposalConflictSummary = (analysis: ArenaProposalChangeAnalysis): string => {
  if (analysis.outcome !== 'conflict' || !analysis.conflict) return '';
  return analysis.conflict.code === 'reference-changed'
    ? '引用的数据卡已更新版本，需要重新选择数据卡'
    : '该目标的当前值已与提案基准不一致';
};

const HostProposalCard = ({
  proposal,
  roomId,
  revision,
  roomEpoch,
  currentConfig,
  authorDisplayName,
  controller,
  disabled,
}: {
  readonly proposal: ArenaProposal;
  readonly roomId: string;
  readonly revision: number;
  readonly roomEpoch: string;
  readonly currentConfig: ArenaRoomSharedConfig;
  readonly authorDisplayName: string;
  readonly controller: ProposalController;
  readonly disabled: boolean;
}) => {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(proposal.changes.map((change) => change.changeId)),
  );
  const actionLock = useRef(false);
  const validationError = arenaProposalSelectionError(proposal.changes, selected);
  // 与服务器权威 apply 相同的依赖排序 + staged expectedBase 分析：
  // “新增角色 -> 修改该角色引导”不再误报冲突；目标已由其他修改满足的变更
  // 显示为安全跳过，而不是阻塞整份提案。
  const preview = useMemo(
    () => previewArenaProposalApplication({ roomId, config: currentConfig, revision }, proposal, [...selected]),
    [roomId, currentConfig, revision, proposal, selected],
  );
  const analysisByChangeId = new Map(preview.plan.map((item) => [item.changeId, item] as const));
  const selectedConflictCount = preview.conflicts.length;
  const labels = useArenaProposalChangeLabels(currentConfig, proposal.changes);

  const resolve = async (resolution: 'accept-selected' | 'reject'): Promise<void> => {
    if (actionLock.current || disabled) return;
    if (resolution === 'accept-selected' && validationError) return;
    actionLock.current = true;
    try {
      await controller.resolveProposal(proposal.proposalId, {
        expectedRoomEpoch: roomEpoch,
        expectedRevision: revision,
        resolution,
        ...(resolution === 'accept-selected' ? { selectedChangeIds: [...selected] } : {}),
      });
    } finally {
      actionLock.current = false;
    }
  };

  return (
    <li className="rounded-xl border border-gray-200 bg-white/80 p-3 dark:border-gray-700 dark:bg-gray-900/70">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-950 dark:text-gray-100">
            {authorDisplayName} 提出了 {proposal.changes.length} 项修改
          </p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400" title={proposal.proposalId}>
            提交于 {proposal.createdAt}
          </p>
        </div>
      </div>
      <fieldset className="mt-3 space-y-2">
        <legend className="text-sm font-semibold text-gray-950 dark:text-gray-100">逐项审阅</legend>
        {proposal.changes.map((change) => {
          const analysis = analysisByChangeId.get(change.changeId);
          const conflict = analysis?.outcome === 'conflict' ? analysis.conflict : undefined;
          const satisfied = analysis?.outcome === 'satisfied';
          return (
          <label key={change.changeId} className="flex items-start gap-2 rounded-lg border border-gray-200 p-2 text-sm dark:border-gray-700">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.has(change.changeId)}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(change.changeId);
                else next.delete(change.changeId);
                setSelected(next);
              }}
            />
            <span>
              <span
                className="font-medium text-gray-950 dark:text-gray-100"
                title={changeRefTitle(change)}
              >
                {arenaProposalChangeProposedSummary(change, labels)}
              </span>
              {satisfied ? (
                <span
                  className="mt-1 block font-medium text-emerald-700 dark:text-emerald-300"
                  data-change-outcome="satisfied"
                >
                  该项目标已由其他修改满足；接受时将自动跳过，不会重复应用。
                </span>
              ) : null}
              {conflict ? (
                <span
                  className="mt-1 block font-medium text-red-700 dark:text-red-300"
                  data-conflict-code={conflict.code}
                  data-conflict-target={conflict.target}
                >
                  {arenaProposalConflictSummary(analysis!)}。可取消勾选该项，其余变更仍可接受。
                </span>
              ) : null}
            </span>
          </label>
          );
        })}
      </fieldset>
      <div aria-live="polite" className="mt-2 min-h-5 text-xs text-red-700 dark:text-red-300">
        {validationError ?? ''}
      </div>
      {selectedConflictCount > 0 ? (
        <p role="status" className="mt-1 text-xs text-amber-700 dark:text-amber-300">
          所选变更中有 {selectedConflictCount} 项与当前房间配置冲突，直接接受会被整体拒绝；请取消勾选冲突项后接受其余变更。
        </p>
      ) : null}
      <ActionBar className="mt-2">
        <button
          type="button"
          className={buttonClassName({ variant: 'primary' })}
          disabled={disabled || Boolean(validationError)}
          onClick={() => { void resolve('accept-selected'); }}
        >
          接受所选
        </button>
        <button
          type="button"
          className={buttonClassName({ variant: 'danger' })}
          disabled={disabled}
          onClick={() => { void resolve('reject'); }}
        >
          拒绝全部
        </button>
      </ActionBar>
      <details className="mt-2 border-t pt-2 dark:border-gray-800">
        <summary className="cursor-pointer select-none text-xs text-gray-600 dark:text-gray-400">技术详情</summary>
        <div className="mt-2 space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
          <p>提案 ID：{proposal.proposalId} · 基于房间配置版本 {proposal.baseRevision}</p>
          {proposal.changes.map((change) => {
            const analysis = analysisByChangeId.get(change.changeId);
            const conflict = analysis?.outcome === 'conflict' ? analysis.conflict : undefined;
            return (
              <p key={`detail-${change.changeId}`}>
                <span className="font-mono">{change.changeId}</span>
                {' · '}{arenaProposalExpectedBaseSummary(change)}
                {change.dependsOn?.length ? ` · 依赖 ${change.dependsOn.join('、')}` : ''}
                {change.atomicGroupId ? ` · 联动变更组 ${change.atomicGroupId}` : ''}
                {conflict ? ` · 当前房间值：${safeJsonSummary(conflict.current)}` : ''}
              </p>
            );
          })}
        </div>
      </details>
    </li>
  );
};

const HostProposalInbox = ({
  state,
  controller,
}: {
  readonly state: ArenaRoomControllerState;
  readonly controller: ProposalController;
}) => {
  const session = state.session;
  if (!session) return null;
  const disabled = state.proposalOperation !== null || state.proposalResultUnknown;
  const proposals = session.snapshot.proposals;
  return (
    <section aria-labelledby="arena-proposal-inbox-heading" className="rounded-xl border border-gray-200 bg-white/50 p-3 dark:border-gray-700 dark:bg-gray-950/20">
      <div>
        <h3 id="arena-proposal-inbox-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">
          待处理提案 ({proposals.length})
        </h3>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          在当前房间提案窗口逐项审阅配置变更，不占用主编辑区。
        </p>
      </div>
      {state.proposalResultUnknown ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <p>上次审阅结果未知，已冻结重复处理。</p>
          <button type="button" className={buttonClassName({ className: 'mt-2' })} onClick={controller.reconnect}>
            重新连接并对账
          </button>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
        接受时服务器会再次校验这些修改是否仍然适用。
      </p>
      {proposals.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          暂无待处理提案。成员在主编辑区编辑并提交提案后会出现在这里；接受后的内容才会进入本局配置。
        </p>
      ) : (
        <ul className="mt-3 space-y-3" aria-label="待审阅提案">
          {proposals.map((proposal) => (
            <HostProposalCard
              key={`${proposal.proposalId}:${proposal.updatedAt ?? proposal.createdAt}`}
              proposal={proposal}
              roomId={session.snapshot.roomId}
              revision={session.snapshot.revision}
              roomEpoch={session.roomEpoch}
              currentConfig={session.snapshot.sharedConfig}
              authorDisplayName={session.snapshot.members.find((member) => member.userId === proposal.authorUserId)?.displayName ?? '未知成员'}
              controller={controller}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

const MemberProposalEntry = ({
  state,
  controller,
  workspace,
}: {
  readonly state: ArenaRoomControllerState;
  readonly controller: ProposalController;
  readonly workspace: ArenaRoomProposalWorkspace;
}) => {
  const [confirmResync, setConfirmResync] = useState(false);
  const session = state.session;
  const editor = workspace.editor;
  const editorState = useSyncExternalStore(
    editor?.store.subscribe ?? (() => () => undefined),
    editor?.store.getState ?? (() => null),
    editor?.store.getInitialState ?? (() => null),
  );
  if (!session) return null;

  return (
    <section aria-labelledby="arena-proposal-editor-heading" className="rounded-xl border border-gray-200 bg-white/50 p-3 dark:border-gray-700 dark:bg-gray-950/20">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="arena-proposal-editor-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">
            配置提案
          </h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {editorState
              ? '主编辑区已进入提案模式'
              : '同步房间当前设置后，主编辑区会切换到提案模式。'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClassName()}
            onClick={() => {
              if (editorState?.dirty) {
                setConfirmResync(true);
                return;
              }
              workspace.syncFromRoom();
            }}
          >
            {editorState?.dirty
              ? '丢弃草稿并重新同步'
              : editorState ? '重新同步房间配置' : '同步房间配置'}
          </button>
        </div>
      </div>
      {confirmResync ? (
        <div
          role="alertdialog"
          aria-labelledby="arena-proposal-resync-confirm-heading"
          aria-describedby="arena-proposal-resync-confirm-description"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100"
        >
          <p id="arena-proposal-resync-confirm-heading" className="font-semibold">确认重新同步？</p>
          <p id="arena-proposal-resync-confirm-description" className="mt-1">
            当前未提交修改将被丢弃，并以房间最新配置重新建立提案草稿。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClassName({ variant: 'danger' })}
              onClick={() => {
                setConfirmResync(false);
                workspace.syncFromRoom();
              }}
            >
              确认丢弃并同步
            </button>
            <button type="button" className={buttonClassName()} onClick={() => setConfirmResync(false)}>
              保留草稿
            </button>
          </div>
        </div>
      ) : null}
      {editorState?.replacementRequired ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          房间实例已变化，旧草稿禁止提交；请重新同步。
        </p>
      ) : editorState?.stale ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          房间设置已更新；当前草稿基于旧版本，请重新同步后再提交。
        </p>
      ) : null}
      <ArenaMemberProposalStatus state={state} controller={controller} />
      <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
        只想围观也完全可以：不提交提案，等房主开始生成即可。
      </p>
    </section>
  );
};

export function ArenaMemberProposalStatus({
  state,
  controller,
}: {
  readonly state: ArenaRoomControllerState;
  readonly controller: Pick<ArenaRoomController, 'reconnect' | 'withdrawProposal'>;
}) {
  const session = state.session;
  if (!session || session.self.role !== 'member') return null;
  const disabled = state.proposalOperation !== null || state.proposalResultUnknown;
  const proposals = session.snapshot.proposals.filter((proposal) => (
    proposal.authorUserId === session.self.userId
  ));
  return (
    <>
      {state.proposalResultUnknown ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <p>上次提案请求结果未知，已冻结重复提交。</p>
          <button type="button" className={buttonClassName({ className: 'mt-2' })} onClick={controller.reconnect}>
            重新连接并对账
          </button>
        </div>
      ) : null}

      {proposals.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-gray-950 dark:text-gray-100">我的待处理提案</h4>
          <ul className="mt-2 space-y-2">
            {proposals.map((proposal) => (
              <li key={proposal.proposalId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
                <span className="text-xs text-gray-600 dark:text-gray-400" title={proposal.proposalId}>
                  提交于 {proposal.createdAt}
                </span>
                <button
                  type="button"
                  className={buttonClassName({ variant: 'danger' })}
                  disabled={disabled}
                  onClick={() => { void controller.withdrawProposal(proposal.proposalId); }}
                >
                  撤回提案
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

export function ArenaProposalPanel(props: ArenaProposalPanelProps) {
  const session = props.state.session;
  if (!session || props.state.phase === 'closed' || props.state.phase === 'replacement') return null;
  return session.self.role === 'host' ? (
    <HostProposalInbox state={props.state} controller={props.controller} />
  ) : (
    <MemberProposalEntry
      state={props.state}
      controller={props.controller}
      workspace={props.workspace}
    />
  );
}
