'use client';

import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';

import type {
  ArenaProposal,
  ArenaProposalChange,
  ArenaRoomSharedConfig,
} from '@mahoshojo/contracts/arena-room';

import type {
  ArenaRoomController,
  ArenaRoomControllerState,
} from '@/lib/arena-room/controller';
import {
  ArenaProposalEditorError,
  assertArenaProposalSelection,
  buildArenaProposalSubmitIntent,
  editWorkingConfig,
  previewArenaProposal,
  resetArenaProposalEditor,
  syncArenaProposalEditor,
  type ArenaProposalEditorState,
} from '@/lib/arena-room/proposal-editor';

type ProposalController = Pick<
  ArenaRoomController,
  'reconnect' | 'resolveProposal' | 'submitProposal' | 'withdrawProposal'
>;

export type ArenaProposalPanelProps = {
  readonly state: ArenaRoomControllerState;
  readonly controller: ProposalController;
  readonly createProposalId?: () => string;
};

const buttonClass = 'rounded-lg border px-3 py-2 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass = `${buttonClass} border-fuchsia-600 bg-fuchsia-600 text-white hover:bg-fuchsia-700`;
const secondaryButtonClass = `${buttonClass} border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const dangerButtonClass = `${buttonClass} border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-gray-900 dark:text-red-300`;
const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100';

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

const changeSummary = (change: ArenaProposalChange): string => {
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

const SelectionDetails = ({ change }: { readonly change: ArenaProposalChange }) => (
  <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">
    {expectedBaseSummary(change)}
    {change.dependsOn?.length ? ` · 依赖 ${change.dependsOn.join('、')}` : ''}
    {change.atomicGroupId ? ` · 原子组 ${change.atomicGroupId}` : ''}
  </span>
);

const selectionError = (
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
  controller,
  disabled,
}: {
  readonly proposal: ArenaProposal;
  readonly revision: number;
  readonly roomEpoch: string;
  readonly controller: ProposalController;
  readonly disabled: boolean;
}) => {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(proposal.changes.map((change) => change.changeId)),
  );
  const actionLock = useRef(false);
  const validationError = selectionError(proposal.changes, selected);

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-gray-700 dark:text-gray-300">
          {proposal.proposalId}
        </p>
        <span className="text-xs text-gray-600 dark:text-gray-400">
          基线 revision {proposal.baseRevision}
        </span>
      </div>
      <fieldset className="mt-3 space-y-2">
        <legend className="text-sm font-semibold text-gray-950 dark:text-gray-100">逐项审阅</legend>
        {proposal.changes.map((change) => (
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
              <span className="font-medium text-gray-950 dark:text-gray-100">{changeSummary(change)}</span>
              <SelectionDetails change={change} />
            </span>
          </label>
        ))}
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
  if (!session) return null;
  const disabled = state.proposalOperation !== null || state.proposalResultUnknown;
  return (
    <section aria-labelledby="arena-proposal-inbox-heading" className="rounded-xl border border-gray-200 bg-white/50 p-4 dark:border-gray-700 dark:bg-gray-950/20">
      <h3 id="arena-proposal-inbox-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">
        Proposal 审阅箱
      </h3>
      <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
        客户端选择只用于表达意图；服务器会再次校验 revision、引用权限与 expectedBase。
      </p>
      {state.proposalResultUnknown ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <p>上次审阅结果未知，已冻结重复处理。</p>
          <button type="button" className={`${secondaryButtonClass} mt-2`} onClick={controller.reconnect}>
            重新连接并对账
          </button>
        </div>
      ) : null}
      {session.snapshot.proposals.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">暂无待处理 Proposal</p>
      ) : (
        <ul className="mt-3 space-y-3" aria-label="待审阅 Proposal">
          {session.snapshot.proposals.map((proposal) => (
            <HostProposalCard
              key={`${proposal.proposalId}:${proposal.updatedAt ?? proposal.createdAt}`}
              proposal={proposal}
              revision={session.snapshot.revision}
              roomEpoch={session.roomEpoch}
              controller={controller}
              disabled={disabled}
            />
          ))}
        </ul>
      )}
    </section>
  );
};

type MemberPreview = {
  readonly baselineEpoch: string;
  readonly baselineRevision: number;
  readonly changes: readonly ArenaProposalChange[];
};

const MemberProposalEditor = ({
  state,
  controller,
  createProposalId,
}: {
  readonly state: ArenaRoomControllerState;
  readonly controller: ProposalController;
  readonly createProposalId: () => string;
}) => {
  const session = state.session;
  const [editor, setEditor] = useState<ArenaProposalEditorState | null>(null);
  const [preview, setPreview] = useState<MemberPreview | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [localError, setLocalError] = useState<string | null>(null);
  const submitLock = useRef(false);
  const currentEditor = useMemo(() => {
    if (!editor || !session) return editor;
    try {
      return syncArenaProposalEditor(editor, session.snapshot);
    } catch {
      return { ...editor, stale: true, replacementRequired: true };
    }
  }, [editor, session]);
  if (!session) return null;

  const visiblePreview = preview
    && currentEditor
    && preview.baselineEpoch === currentEditor.baselineEpoch
    && preview.baselineRevision === currentEditor.baselineRevision
      ? preview
      : null;
  const validationError = visiblePreview
    ? selectionError(visiblePreview.changes, selected)
    : null;
  const disabled = state.proposalOperation !== null || state.proposalResultUnknown;

  const sync = (): void => {
    setEditor(resetArenaProposalEditor(session.snapshot));
    setPreview(null);
    setSelected(new Set());
    setLocalError(null);
  };

  const edit = (update: (config: ArenaRoomSharedConfig) => ArenaRoomSharedConfig): void => {
    if (!currentEditor) return;
    try {
      setEditor(editWorkingConfig(currentEditor, update));
      setPreview(null);
      setSelected(new Set());
      setLocalError(null);
    } catch {
      setLocalError('此安全配置修改无效');
    }
  };

  const buildPreview = (): void => {
    if (!currentEditor) return;
    try {
      const result = previewArenaProposal(currentEditor);
      setPreview({
        baselineEpoch: currentEditor.baselineEpoch,
        baselineRevision: currentEditor.baselineRevision,
        changes: result.changes,
      });
      setSelected(new Set(result.selectedChangeIds));
      setLocalError(null);
    } catch (error) {
      setLocalError(error instanceof ArenaProposalEditorError && error.code === 'empty-proposal'
        ? '草稿没有可提交的变更'
        : '草稿无法生成安全 Proposal，请重新同步');
    }
  };

  const submit = async (): Promise<void> => {
    if (
      !currentEditor
      || !visiblePreview
      || validationError
      || disabled
      || submitLock.current
    ) return;
    submitLock.current = true;
    try {
      const intent = buildArenaProposalSubmitIntent(
        currentEditor,
        createProposalId(),
        [...selected],
      );
      await controller.submitProposal(intent);
      setLocalError(null);
    } catch {
      setLocalError('Proposal 意图无效，请重新预览');
    } finally {
      submitLock.current = false;
    }
  };

  return (
    <section aria-labelledby="arena-proposal-editor-heading" className="rounded-xl border border-gray-200 bg-white/50 p-4 dark:border-gray-700 dark:bg-gray-950/20">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="arena-proposal-editor-heading" className="text-sm font-semibold text-gray-950 dark:text-gray-100">
            Shared Config 草稿
          </h3>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            草稿与单人竞技场状态完全分离；编辑过程不会联网。
          </p>
        </div>
        <button type="button" className={secondaryButtonClass} onClick={sync}>
          {currentEditor ? '丢弃草稿并同步' : '同步当前房间配置'}
        </button>
      </div>

      {currentEditor ? (
        <div className="mt-4 space-y-3">
          {currentEditor.replacementRequired ? (
            <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
              房间 incarnation 已变化，旧草稿禁止提交；请重新同步。
            </p>
          ) : currentEditor.stale ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              房间 revision 已更新；当前草稿仍绑定旧基线 {currentEditor.baselineRevision}。
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="arena-proposal-battle-mode" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-200">
                战斗模式
              </label>
              <select
                id="arena-proposal-battle-mode"
                className={inputClass}
                value={currentEditor.workingConfig.battleMode}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => edit((config) => ({
                  ...config,
                  battleMode: event.target.value as ArenaRoomSharedConfig['battleMode'],
                }))}
              >
                <option value="classic">classic</option>
                <option value="kizuna">kizuna</option>
                <option value="daily">daily</option>
                <option value="scenario">scenario</option>
              </select>
            </div>
            <div>
              <label htmlFor="arena-proposal-story-length" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-200">
                故事长度
              </label>
              <select
                id="arena-proposal-story-length"
                className={inputClass}
                value={currentEditor.workingConfig.storyLength}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => edit((config) => ({
                  ...config,
                  storyLength: event.target.value as ArenaRoomSharedConfig['storyLength'],
                  customStoryLength: null,
                }))}
              >
                <option value="default">default</option>
                <option value="short">short</option>
                <option value="standard">standard</option>
                <option value="detailed">detailed</option>
                <option value="long">long</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="arena-proposal-user-guidance" className="mb-1 block text-sm font-medium text-gray-800 dark:text-gray-200">
              全局引导
            </label>
            <textarea
              id="arena-proposal-user-guidance"
              className={`${inputClass} min-h-24 resize-y`}
              value={currentEditor.workingConfig.userGuidance}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => edit((config) => ({
                ...config,
                userGuidance: event.target.value,
              }))}
            />
          </div>
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={!currentEditor.dirty || currentEditor.replacementRequired}
            onClick={buildPreview}
          >
            预览 typed diff
          </button>

          {visiblePreview ? (
            <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <legend className="px-1 text-sm font-semibold text-gray-950 dark:text-gray-100">选择提交变更</legend>
              {visiblePreview.changes.map((change) => (
                <label key={change.changeId} className="flex items-start gap-2 text-sm">
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
                    <span className="font-medium text-gray-950 dark:text-gray-100">{changeSummary(change)}</span>
                    <SelectionDetails change={change} />
                  </span>
                </label>
              ))}
              <div aria-live="polite" className="min-h-5 text-xs text-red-700 dark:text-red-300">
                {validationError ?? ''}
              </div>
              <button
                type="button"
                className={primaryButtonClass}
                disabled={disabled || Boolean(validationError) || currentEditor.replacementRequired}
                onClick={() => { void submit(); }}
              >
                提交 Proposal
              </button>
            </fieldset>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          先同步当前权威 snapshot，再建立本地草稿。
        </p>
      )}

      {localError ? <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{localError}</p> : null}
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

const defaultProposalId = (): string => {
  const random = globalThis.crypto?.randomUUID?.();
  return `proposal-${random ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
};

export function ArenaProposalPanel(props: ArenaProposalPanelProps) {
  const session = props.state.session;
  if (!session || props.state.phase === 'closed' || props.state.phase === 'replacement') return null;
  return session.self.role === 'host' ? (
    <HostProposalInbox state={props.state} controller={props.controller} />
  ) : (
    <MemberProposalEditor
      state={props.state}
      controller={props.controller}
      createProposalId={props.createProposalId ?? defaultProposalId}
    />
  );
}
