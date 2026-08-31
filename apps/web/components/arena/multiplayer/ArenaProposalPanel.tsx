'use client';

import {
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
} from 'react';

import type {
  ArenaProposal,
  ArenaProposalChange,
  ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';
import { detectProposalConflicts } from '@mahoshojo/multiplayer-core';

import type {
  ArenaRoomController,
  ArenaRoomControllerState,
} from '@/lib/arena-room/controller';
import {
  ArenaProposalEditorError,
  assertArenaProposalSelection,
} from '@/lib/arena-room/proposal-editor';
import type { ArenaRoomProposalWorkspace } from './useArenaRoom';

type ProposalController = Pick<
  ArenaRoomController,
  'reconnect' | 'resolveProposal' | 'submitProposal' | 'withdrawProposal'
>;

export type ArenaProposalPanelProps = {
  readonly state: ArenaRoomControllerState;
  readonly controller: ProposalController;
  readonly workspace: ArenaRoomProposalWorkspace;
};

const buttonClass = 'rounded-lg border px-3 py-2 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass = `${buttonClass} border-fuchsia-600 bg-fuchsia-600 text-white hover:bg-fuchsia-700`;
const secondaryButtonClass = `${buttonClass} border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const dangerButtonClass = `${buttonClass} border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-gray-900 dark:text-red-300`;
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

const expectedBaseSummary = (change: ArenaProposalChange): string => {
  const expected = change.expectedBase;
  if (expected.kind === 'absent') return '预期基线：目标不存在';
  if (expected.kind === 'ref') return `预期基线：${refIdentity(expected.ref)}`;
  if (expected.kind === 'present') return `预期基线：${refIdentity(expected.ref)}`;
  return typeof expected.value === 'string'
    ? `预期基线：${safeText(expected.value || '空值')}`
    : '预期基线：已绑定安全值';
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

export const arenaProposalChangeSummary = (change: ArenaProposalChange): string => {
  switch (change.type) {
    case 'addCombatant': return `新增角色 ${change.ref.id}`;
    case 'removeCombatant': return `移除角色 ${change.combatantKey}`;
    case 'setCharacterGuidance': return `修改角色引导 ${change.combatantKey}`;
    case 'assignTeam': return `调整队伍 ${change.combatantKey}`;
    case 'addTeam': return `新增队伍 ${change.displayName}`;
    case 'removeTeam': return `移除队伍 ${change.teamKey}`;
    case 'renameTeam': return `队伍 ${change.teamKey} 改名为 ${safeText(change.value)}`;
    case 'setBattleMode': return `战斗模式改为 ${change.value}`;
    case 'setSelectedLanguage': return `语言改为 ${change.value}`;
    case 'setScenario': return change.ref === null ? '清除主情景' : `主情景改为 ${change.ref.id}`;
    case 'addAuxScenario': return `新增辅助情景 ${change.ref.id}`;
    case 'removeAuxScenario': return `移除辅助情景 ${change.scenarioKey}`;
    case 'addMaterial': return `新增素材 ${change.ref.id}`;
    case 'removeMaterial': return `移除素材 ${change.materialKey}`;
    case 'setUserGuidance': return `全局引导改为“${safeText(change.value || '空值')}”`;
    case 'setStoryLength': return `故事长度改为 ${change.value}`;
    case 'setHistorySettings': return '修改共享历史读取/写入设置';
  }
};

export const ArenaProposalSelectionDetails = ({ change }: { readonly change: ArenaProposalChange }) => (
  <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">
    {expectedBaseSummary(change)}
    {change.dependsOn?.length ? ` · 依赖 ${change.dependsOn.join('、')}` : ''}
    {change.atomicGroupId ? ` · 原子组 ${change.atomicGroupId}` : ''}
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
      ? '所选变更缺少依赖或拆分了原子组'
      : '所选变更无效';
  }
};

const HostProposalCard = ({
  proposal,
  revision,
  roomEpoch,
  currentConfig,
  authorDisplayName,
  controller,
  disabled,
}: {
  readonly proposal: ArenaProposal;
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
  const conflictByChangeId = new Map(
    detectProposalConflicts(currentConfig, proposal.changes)
      .map((conflict) => [conflict.changeId, conflict] as const),
  );

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
          <p className="text-sm font-semibold text-gray-950 dark:text-gray-100">{authorDisplayName}</p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            提交于 {proposal.createdAt} · BASE revision {proposal.baseRevision}
          </p>
        </div>
        <p className="font-mono text-xs text-gray-500 dark:text-gray-400">{proposal.proposalId}</p>
      </div>
      <fieldset className="mt-3 space-y-2">
        <legend className="text-sm font-semibold text-gray-950 dark:text-gray-100">逐项审阅</legend>
        {proposal.changes.map((change) => {
          const conflict = conflictByChangeId.get(change.changeId);
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
              <span className="font-medium text-gray-950 dark:text-gray-100">{arenaProposalChangeSummary(change)}</span>
              <ArenaProposalSelectionDetails change={change} />
              <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">
                BASE：{safeJsonSummary(change.expectedBase)}
              </span>
              <span className="block text-xs text-gray-600 dark:text-gray-400">
                CURRENT：{conflict ? safeJsonSummary(conflict.current) : '与 BASE 一致'}
              </span>
              <span className="block text-xs text-gray-600 dark:text-gray-400">
                PROPOSED：{arenaProposalChangeSummary(change)}
              </span>
              {conflict ? (
                <span className="mt-1 block font-medium text-red-700 dark:text-red-300">
                  same-target conflict · {conflict.code} · {conflict.target}
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
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={primaryButtonClass}
          disabled={disabled || Boolean(validationError)}
          onClick={() => { void resolve('accept-selected'); }}
        >
          接受所选
        </button>
        <button
          type="button"
          className={dangerButtonClass}
          disabled={disabled}
          onClick={() => { void resolve('reject'); }}
        >
          拒绝全部
        </button>
      </div>
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
  const [open, setOpen] = useState(false);
  if (!session) return null;
  const disabled = state.proposalOperation !== null || state.proposalResultUnknown;
  const proposals = session.snapshot.proposals;
  return (
    <section aria-labelledby="arena-proposal-inbox-heading" className="rounded-xl border border-gray-200 bg-white/50 p-3 dark:border-gray-700 dark:bg-gray-950/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="arena-proposal-inbox-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">待处理提案</h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">审阅在 Modal 中完成，不占用 Arena 主编辑区。</p>
        </div>
        <button type="button" className={secondaryButtonClass} onClick={() => setOpen(true)}>
          待处理提案 ({proposals.length})
        </button>
      </div>
      {state.proposalResultUnknown ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <p>上次审阅结果未知，已冻结重复处理。</p>
          <button type="button" className={`${secondaryButtonClass} mt-2`} onClick={controller.reconnect}>
            重新连接并对账
          </button>
        </div>
      ) : null}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6">
          <section role="dialog" aria-modal="true" aria-labelledby="arena-proposal-review-heading" className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-950">
            <div className="flex items-start justify-between gap-3 border-b p-4 dark:border-gray-800">
              <div>
                <h3 id="arena-proposal-review-heading" className="font-semibold text-gray-950 dark:text-gray-100">Proposal Review</h3>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">服务器仍会校验 revision、引用权限、expectedBase、依赖与原子组。</p>
              </div>
              <button type="button" className={secondaryButtonClass} onClick={() => setOpen(false)}>关闭</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {proposals.length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">暂无待处理 Proposal</p>
              ) : (
                <ul className="space-y-3" aria-label="待审阅 Proposal">
                  {proposals.map((proposal) => (
                    <HostProposalCard
                      key={`${proposal.proposalId}:${proposal.updatedAt ?? proposal.createdAt}`}
                      proposal={proposal}
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
            </div>
          </section>
        </div>
      ) : null}
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
  const session = state.session;
  const editor = workspace.editor;
  const editorState = useSyncExternalStore(
    editor?.store.subscribe ?? (() => () => undefined),
    editor?.store.getState ?? (() => null),
    editor?.store.getInitialState ?? (() => null),
  );
  if (!session) return null;
  const disabled = state.proposalOperation !== null || state.proposalResultUnknown;

  return (
    <section aria-labelledby="arena-proposal-editor-heading" className="rounded-xl border border-gray-200 bg-white/50 p-3 dark:border-gray-700 dark:bg-gray-950/20">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="arena-proposal-editor-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">
            配置提案
          </h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {editorState
              ? `Arena 主编辑区已进入提案模式 · BASE revision ${editorState.baselineRevision}`
              : '同步权威配置后，Arena 主编辑区会切换到隔离的提案模式。'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButtonClass} onClick={workspace.syncFromRoom}>
            {editorState ? '丢弃并重新同步' : '同步房间配置'}
          </button>
          {editorState ? (
            <button type="button" className={dangerButtonClass} onClick={workspace.discard}>
              退出提案模式
            </button>
          ) : null}
        </div>
      </div>
      {editorState?.replacementRequired ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          房间 incarnation 已变化，旧草稿禁止提交；请重新同步。
        </p>
      ) : editorState?.stale ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          房间 revision 已更新；当前草稿仍绑定旧基线 {editorState.baselineRevision}。
        </p>
      ) : null}
      {state.proposalResultUnknown ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <p>上次 Proposal 请求结果未知，已冻结重复提交。</p>
          <button type="button" className={`${secondaryButtonClass} mt-2`} onClick={controller.reconnect}>
            重新连接并对账
          </button>
        </div>
      ) : null}

      {session.snapshot.proposals.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-gray-950 dark:text-gray-100">我的待处理 Proposal</h4>
          <ul className="mt-2 space-y-2">
            {session.snapshot.proposals.map((proposal) => (
              <li key={proposal.proposalId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
                <span className="font-mono text-xs">{proposal.proposalId}</span>
                <button
                  type="button"
                  className={dangerButtonClass}
                  disabled={disabled}
                  onClick={() => { void controller.withdrawProposal(proposal.proposalId); }}
                >
                  撤回 Proposal
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
};

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
