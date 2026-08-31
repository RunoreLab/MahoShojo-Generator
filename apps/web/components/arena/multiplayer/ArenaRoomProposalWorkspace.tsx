'use client';

import { useMemo, useRef, useState } from 'react';

import BattleDataModal from '@/components/BattleDataModal';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';
import { ONLINE_DATA_CARD_TYPES } from '@mahoshojo/contracts/data-cards';
import type {
  ArenaProposalChange,
  ArenaRoomSharedConfig,
  DataCardRef,
} from '@mahoshojo/contracts/arena-room';

import {
  ArenaEditorSessionProvider,
  useArenaEditorSelector,
  type RoomProposalArenaEditorSession,
} from '../editor';
import { ArenaMaterialList } from '../editor/presentation/ArenaMaterialList';
import { ArenaRosterList, ArenaRosterRow } from '../editor/presentation/ArenaRoster';
import { ArenaAuxScenarioList } from '../editor/presentation/ArenaScenarioList';
import { BattleModeSwitcher } from '../components/BattleModeSwitcher';
import { BattleSettings } from '../components/BattleSettings';
import { StoryOptions } from '../components/StoryOptions';
import { useLanguagesQuery } from '../hooks/useArenaData';
import type { ArenaRoomController, ArenaRoomControllerState } from '@/lib/arena-room/controller';
import {
  ArenaProposalSelectionDetails,
  ArenaMemberProposalStatus,
  arenaProposalChangeSummary,
  arenaProposalChangeProposedSummary,
  arenaProposalSelectionError,
} from './ArenaProposalPanel';
import { ArenaRoomDialog } from './ArenaRoomDialog';
import { useArenaRoomContext } from './useArenaRoom';

type ModalKind = 'character' | 'scenario' | 'auxScenario' | 'material';
type ProposalController = Pick<
  ArenaRoomController,
  'reconnect' | 'submitProposal' | 'withdrawProposal'
>;

const buttonClass = 'rounded-lg border px-3 py-2 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass = `${buttonClass} border-fuchsia-600 bg-fuchsia-600 text-white hover:bg-fuchsia-700`;
const secondaryButtonClass = `${buttonClass} border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const dangerButtonClass = `${buttonClass} border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-gray-900 dark:text-red-300`;

const readText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const moveItem = <Item,>(
  items: readonly Item[],
  fromIndex: number,
  toIndex: number,
): Item[] => {
  const next = [...items];
  if (
    fromIndex < 0
    || fromIndex >= next.length
    || toIndex < 0
    || toIndex >= next.length
    || fromIndex === toIndex
  ) return next;
  const [item] = next.splice(fromIndex, 1);
  if (item !== undefined) next.splice(toIndex, 0, item);
  return next;
};

const toExactRef = <Kind extends DataCardRef['kind']>(
  card: unknown,
  kind: Kind,
): { readonly id: string; readonly kind: Kind; readonly versionToken: string } => {
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    throw new Error('在线数据卡选择无效');
  }
  const value = card as Record<string, unknown>;
  const id = readText(value._cardId) || readText(value.id);
  const versionToken = readText(value._updatedAt) || readText(value.updated_at) || readText(value.updatedAt);
  if (!id || !versionToken) throw new Error('在线数据卡缺少可验证版本，请刷新后重试');
  return { id, kind, versionToken };
};

const proposalId = (): string => {
  const random = globalThis.crypto?.randomUUID?.();
  return `proposal-${random ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
};

const ProposalPreviewDialog = ({
  baselineRevision,
  changes,
  selected,
  disabled,
  onSelectedChange,
  onClose,
  onSubmit,
}: {
  readonly baselineRevision: number;
  readonly changes: readonly ArenaProposalChange[];
  readonly selected: ReadonlySet<string>;
  readonly disabled: boolean;
  readonly onSelectedChange: (value: ReadonlySet<string>) => void;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
}) => {
  const validationError = arenaProposalSelectionError(changes, selected);
  return (
    <ArenaRoomDialog
      open
      titleId="arena-proposal-preview-heading"
      title="预览提案"
      description={`BASE revision ${baselineRevision} · 逐项检查 typed diff；依赖与原子组会再次校验。`}
      onClose={onClose}
      widthClassName="max-w-3xl"
    >
        <fieldset className="space-y-2">
          <legend className="sr-only">选择提交变更</legend>
          {changes.map((change) => (
            <label key={change.changeId} className="flex items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.has(change.changeId)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(change.changeId);
                  else next.delete(change.changeId);
                  onSelectedChange(next);
                }}
              />
              <span>
                <span className="font-medium text-gray-950 dark:text-gray-100">{arenaProposalChangeSummary(change)}</span>
                <ArenaProposalSelectionDetails change={change} />
                <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">BASE：{JSON.stringify(change.expectedBase)}</span>
                <span className="block text-xs text-gray-600 dark:text-gray-400">PROPOSED：{arenaProposalChangeProposedSummary(change)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="mt-4 border-t pt-4 dark:border-gray-800">
          <div className="text-xs text-gray-600 dark:text-gray-400">将提交 {selected.size} / {changes.length} 项变更</div>
          <div aria-live="polite" className="mt-1 min-h-5 text-xs text-red-700 dark:text-red-300">{validationError ?? ''}</div>
          <button
            type="button"
            className={`${primaryButtonClass} mt-2`}
            disabled={disabled || Boolean(validationError)}
            onClick={onSubmit}
          >
            提交 Proposal
          </button>
        </div>
    </ArenaRoomDialog>
  );
};

const ProposalWorkspaceInner = ({
  editor,
  state,
  controller,
}: {
  readonly editor: RoomProposalArenaEditorSession;
  readonly state: ArenaRoomControllerState;
  readonly controller: ProposalController;
}) => {
  const snapshot = useArenaEditorSelector((value) => value);
  const { data: languages } = useLanguagesQuery();
  const [modalKind, setModalKind] = useState<ModalKind | null>(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [preview, setPreview] = useState<readonly ArenaProposalChange[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [localError, setLocalError] = useState<string | null>(null);
  const submitLock = useRef(false);

  const selectedIds = useMemo(() => {
    if (modalKind === 'character') return snapshot.combatants.flatMap((item) => item.reference ? [item.reference.id] : []);
    if (modalKind === 'scenario') return snapshot.scenario?.reference ? [snapshot.scenario.reference.id] : [];
    if (modalKind === 'auxScenario') return snapshot.auxScenarios.flatMap((item) => item.reference ? [item.reference.id] : []);
    if (modalKind === 'material') return snapshot.materials.flatMap((item) => item.reference ? [item.reference.id] : []);
    return [];
  }, [modalKind, snapshot.auxScenarios, snapshot.combatants, snapshot.materials, snapshot.scenario]);

  const mutate = (update: (draft: ArenaRoomSharedConfig) => ArenaRoomSharedConfig): void => {
    try {
      editor.update(update);
      setPreview(null);
      setSelected(new Set());
      setLocalError(null);
    } catch {
      setLocalError('该修改不满足房间安全配置约束');
    }
  };

  const addTeam = (): void => {
    const displayName = newTeamName.trim();
    if (!displayName) return;
    const key = `team:${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
    mutate((draft) => ({
      ...draft,
      teams: [...draft.teams, { key, displayName, combatantKeys: [] }],
    }));
    setNewTeamName('');
  };

  const toggleCard = (card: unknown, nextSelected: boolean): void => {
    if (!modalKind) return;
    try {
      if (modalKind === 'character') {
        const ref = toExactRef(card, 'character');
        const key = `data-card:${ref.id}`;
        mutate((draft) => ({
          ...draft,
          combatants: nextSelected
            ? [...draft.combatants.filter((item) => item.key !== key), { key, ref }]
            : draft.combatants.filter((item) => item.key !== key),
          teams: nextSelected ? draft.teams : draft.teams.map((team) => ({
            ...team,
            combatantKeys: team.combatantKeys.filter((item) => item !== key),
          })),
        }));
        return;
      }
      if (modalKind === 'auxScenario') {
        const ref = toExactRef(card, 'scenario');
        const key = `data-card:${ref.id}`;
        mutate((draft) => ({
          ...draft,
          auxScenarios: nextSelected
            ? [...draft.auxScenarios.filter((item) => item.key !== key), { key, ref }]
            : draft.auxScenarios.filter((item) => item.key !== key),
        }));
        return;
      }
      const ref = toExactRef(card, 'material');
      const key = `data-card:${ref.id}`;
      mutate((draft) => ({
        ...draft,
        materials: nextSelected
          ? [...draft.materials.filter((item) => item.key !== key), { key, ref }]
          : draft.materials.filter((item) => item.key !== key),
      }));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '在线数据卡选择无效');
    }
  };

  const selectMainScenario = (card: unknown): void => {
    try {
      const ref = toExactRef(card, 'scenario');
      mutate((draft) => ({
        ...draft,
        scenario: { key: `data-card:${ref.id}`, ref },
      }));
      setModalKind(null);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '在线情景选择无效');
    }
  };

  const buildPreview = (): void => {
    try {
      const result = editor.preview();
      setPreview(result.changes);
      setSelected(new Set(result.selectedChangeIds));
      setLocalError(null);
    } catch {
      setLocalError(snapshot.dirty ? '草稿包含暂不支持的变更，请检查后重试' : '草稿没有可提交的变更');
    }
  };

  const submit = async (): Promise<void> => {
    if (!preview || submitLock.current || state.proposalOperation !== null || state.proposalResultUnknown) return;
    submitLock.current = true;
    try {
      await controller.submitProposal(editor.buildSubmitIntent(proposalId(), [...selected]));
      setPreview(null);
      setLocalError(null);
    } catch {
      setLocalError('Proposal 提交失败，请根据房间权威状态重试');
    } finally {
      submitLock.current = false;
    }
  };

  const disabled = snapshot.replacementRequired || state.proposalOperation !== null || state.proposalResultUnknown;

  return (
    <section aria-labelledby="arena-room-proposal-workspace-heading" className="mt-6 rounded-2xl border border-fuchsia-200 bg-fuchsia-50/40 p-4 dark:border-fuchsia-900 dark:bg-fuchsia-950/10 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="arena-room-proposal-workspace-heading" className="text-lg font-semibold text-gray-950 dark:text-gray-100">Arena 提案编辑模式</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">隔离草稿 · BASE revision {snapshot.baselineRevision} · 本地编辑不联网</p>
        </div>
        <button type="button" className={primaryButtonClass} disabled={!snapshot.dirty || disabled} onClick={buildPreview}>预览提案</button>
      </div>
      {snapshot.stale ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">房间配置已更新；当前草稿仍绑定旧基线，请重新同步后再提交。</p> : null}
      {localError ? <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{localError}</p> : null}
      <ArenaMemberProposalStatus state={state} controller={controller} />

      <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <CollapsibleSection title="🌐 在线角色库" description="仅公开且审核通过的数据卡" defaultOpen>
            <button type="button" className={primaryButtonClass} onClick={() => setModalKind('character')}>浏览在线角色库</button>
          </CollapsibleSection>
          <CollapsibleSection title="👥 已选角色 / 分队" description={`已选 ${snapshot.combatants.length}`} defaultOpen keepMounted>
            <div className="mb-3 flex gap-2">
              <input
                value={newTeamName}
                onChange={(event) => setNewTeamName(event.target.value)}
                maxLength={80}
                placeholder="新队伍名称"
                className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
              />
              <button type="button" className={secondaryButtonClass} disabled={!newTeamName.trim()} onClick={addTeam}>新增队伍</button>
            </div>
            {snapshot.teams.length > 0 ? (
              <ul className="mb-3 space-y-2" aria-label="提案队伍">
                {snapshot.teams.map((team, teamIndex) => (
                  <li key={team.key} className="rounded-lg border bg-white/80 p-2">
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          className="min-h-10 min-w-10 rounded border text-xs disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`上移队伍 ${team.name}`}
                          disabled={disabled || teamIndex === 0}
                          onClick={() => mutate((draft) => ({
                            ...draft,
                            teams: moveItem(draft.teams, teamIndex, teamIndex - 1),
                          }))}
                        >↑</button>
                        <button
                          type="button"
                          className="min-h-10 min-w-10 rounded border text-xs disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`下移队伍 ${team.name}`}
                          disabled={disabled || teamIndex === snapshot.teams.length - 1}
                          onClick={() => mutate((draft) => ({
                            ...draft,
                            teams: moveItem(draft.teams, teamIndex, teamIndex + 1),
                          }))}
                        >↓</button>
                      </div>
                      <input
                        aria-label={`队伍 ${team.name} 名称`}
                        className="min-w-0 flex-1 rounded border px-2 py-1 text-sm"
                        value={team.name}
                        onChange={(event) => mutate((draft) => ({
                          ...draft,
                          teams: draft.teams.map((item) => item.key === team.key
                            ? { ...item, displayName: event.target.value }
                            : item),
                        }))}
                      />
                      <button type="button" className={dangerButtonClass} onClick={() => mutate((draft) => ({
                        ...draft,
                        teams: draft.teams.filter((item) => item.key !== team.key),
                      }))}>移除</button>
                    </div>
                    {team.combatantKeys.length > 0 ? (
                      <ul className="mt-2 space-y-1" aria-label={`${team.name} 队内角色顺序`}>
                        {team.combatantKeys.map((combatantKey, combatantIndex) => {
                          const combatantName = snapshot.combatants.find((item) => item.key === combatantKey)?.name
                            ?? combatantKey;
                          return (
                            <li key={combatantKey} className="flex items-center justify-between gap-2 text-xs">
                              <span className="min-w-0 truncate">{combatantName}</span>
                              <span className="flex shrink-0 gap-1">
                                <button
                                  type="button"
                                  className="min-h-10 min-w-10 rounded border disabled:cursor-not-allowed disabled:opacity-40"
                                  aria-label={`上移 ${team.name}内 ${combatantName}`}
                                  disabled={disabled || combatantIndex === 0}
                                  onClick={() => mutate((draft) => ({
                                    ...draft,
                                    teams: draft.teams.map((entry) => entry.key === team.key
                                      ? { ...entry, combatantKeys: moveItem(entry.combatantKeys, combatantIndex, combatantIndex - 1) }
                                      : entry),
                                  }))}
                                >↑</button>
                                <button
                                  type="button"
                                  className="min-h-10 min-w-10 rounded border disabled:cursor-not-allowed disabled:opacity-40"
                                  aria-label={`下移 ${team.name}内 ${combatantName}`}
                                  disabled={disabled || combatantIndex === team.combatantKeys.length - 1}
                                  onClick={() => mutate((draft) => ({
                                    ...draft,
                                    teams: draft.teams.map((entry) => entry.key === team.key
                                      ? { ...entry, combatantKeys: moveItem(entry.combatantKeys, combatantIndex, combatantIndex + 1) }
                                      : entry),
                                  }))}
                                >↓</button>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <ArenaRosterList
              items={snapshot.combatants.map((item) => ({
                ...item,
                displayName: item.name,
                typeLabel: item.type ?? (item.access === 'stub' ? '房主本地角色' : '在线角色'),
                guidance: item.characterGuidance,
              }))}
              emptyLabel="房间配置没有角色"
              renderItem={(item, index) => (
                <ArenaRosterRow
                  key={item.key}
                  item={item}
                  index={index}
                  total={snapshot.combatants.length}
                  capabilities={{ guidance: true, remove: true, reorder: true }}
                  guidanceExpanded
                  onToggleGuidance={() => undefined}
                  onGuidanceChange={(value) => mutate((draft) => ({
                    ...draft,
                    combatants: draft.combatants.map((entry) => entry.key === item.key
                      ? { ...entry, ...(value.trim() ? { characterGuidance: value } : { characterGuidance: undefined }) }
                      : entry),
                  }))}
                  onMove={(fromIndex, toIndex) => mutate((draft) => ({
                    ...draft,
                    combatants: moveItem(draft.combatants, fromIndex, toIndex),
                  }))}
                  onRemove={() => mutate((draft) => ({
                    ...draft,
                    combatants: draft.combatants.filter((entry) => entry.key !== item.key),
                    teams: draft.teams.map((team) => ({
                      ...team,
                      combatantKeys: team.combatantKeys.filter((key) => key !== item.key),
                    })),
                  }))}
                />
              )}
            />
            {snapshot.combatants.map((combatant) => (
              <label key={`team:${combatant.key}`} className="mt-2 flex items-center gap-2 text-xs">
                <span className="min-w-24 truncate">{combatant.name}</span>
                <select
                  value={combatant.teamKey ?? ''}
                  className="rounded border px-2 py-1"
                  onChange={(event) => mutate((draft) => ({
                    ...draft,
                    teams: draft.teams.map((team) => ({
                      ...team,
                      combatantKeys: team.key === event.target.value
                        ? [...team.combatantKeys.filter((key) => key !== combatant.key), combatant.key]
                        : team.combatantKeys.filter((key) => key !== combatant.key),
                    })),
                  }))}
                >
                  <option value="">未分队</option>
                  {snapshot.teams.map((team) => <option key={team.key} value={team.key}>{team.name}</option>)}
                </select>
              </label>
            ))}
          </CollapsibleSection>
        </div>

        <div className="min-w-0 space-y-4">
          <CollapsibleSection title="🎮 模式选择" description="复用 Arena 模式控件" defaultOpen>
            <BattleModeSwitcher />
          </CollapsibleSection>
          <CollapsibleSection
            title="🎭 情景设置"
            description={snapshot.scenario?.name ?? '未选择主情景'}
            defaultOpen={snapshot.battleMode === 'scenario'}
            autoOpen={snapshot.battleMode === 'scenario'}
          >
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondaryButtonClass} onClick={() => setModalKind('scenario')}>浏览在线情景库</button>
              {snapshot.scenario ? <button type="button" className={dangerButtonClass} onClick={() => mutate((draft) => ({ ...draft, scenario: null }))}>清除主情景</button> : null}
              <button type="button" className={secondaryButtonClass} onClick={() => setModalKind('auxScenario')}>选择辅助情景</button>
            </div>
            <ArenaAuxScenarioList
              items={snapshot.auxScenarios.map((item) => ({ key: item.key, title: item.name }))}
              disabled={disabled}
              onMove={(fromIndex, toIndex) => mutate((draft) => ({
                ...draft,
                auxScenarios: moveItem(draft.auxScenarios, fromIndex, toIndex),
              }))}
              onRemove={(key) => mutate((draft) => ({
                ...draft,
                auxScenarios: draft.auxScenarios.filter((item) => item.key !== key),
              }))}
            />
          </CollapsibleSection>
          <CollapsibleSection title="📎 素材注入" description={`已选 ${snapshot.materials.length}`} defaultOpen={false} keepMounted>
            <button type="button" className={secondaryButtonClass} onClick={() => setModalKind('material')}>浏览在线数据卡</button>
            <div className="mt-3">
              <ArenaMaterialList
                items={snapshot.materials.map((item) => ({ key: item.key, name: item.name, sourceLabel: '公开在线数据卡' }))}
                disabled={disabled}
                onMove={(fromIndex, toIndex) => mutate((draft) => ({
                  ...draft,
                  materials: moveItem(draft.materials, fromIndex, toIndex),
                }))}
                onRemove={(key) => mutate((draft) => ({
                  ...draft,
                  materials: draft.materials.filter((item) => item.key !== key),
                }))}
              />
            </div>
          </CollapsibleSection>
          <CollapsibleSection title="⚙️ 读写设置" description="复用 Arena 历史设置" defaultOpen={false} keepMounted>
            <BattleSettings />
          </CollapsibleSection>
          <CollapsibleSection title="🧠 故事引导" description="Provider 与本地判定能力在提案模式中不可用" defaultOpen keepMounted>
            <StoryOptions languages={languages} />
          </CollapsibleSection>
        </div>
      </div>

      <BattleDataModal
        isOpen={modalKind !== null}
        onClose={() => setModalKind(null)}
        visibleTabs={['public', 'recommended']}
        initialTab="public"
        selectedType={modalKind === 'character' ? 'character' : modalKind === 'material' ? 'all' : 'scenario'}
        allowedTypes={modalKind === 'material' ? [...ONLINE_DATA_CARD_TYPES] : undefined}
        titleOverride={modalKind === 'auxScenario' ? '选择辅助情景' : modalKind === 'material' ? '选择素材' : undefined}
        selectionMode={modalKind === 'scenario' ? 'single' : 'multi'}
        selectedCardIds={selectedIds}
        selectedCountOverride={selectedIds.length}
        onSelectCard={modalKind === 'scenario' ? selectMainScenario : undefined}
        onToggleCard={modalKind && modalKind !== 'scenario' ? toggleCard : undefined}
        externalError={localError}
      />

      {preview ? (
        <ProposalPreviewDialog
          baselineRevision={snapshot.baselineRevision ?? 0}
          changes={preview}
          selected={selected}
          disabled={disabled}
          onSelectedChange={setSelected}
          onClose={() => setPreview(null)}
          onSubmit={() => { void submit(); }}
        />
      ) : null}
    </section>
  );
};

export function ArenaRoomProposalWorkspace() {
  const runtime = useArenaRoomContext();
  const editor = runtime?.proposalWorkspace.editor;
  if (!runtime || !editor || runtime.state.session?.self.role !== 'member') return null;
  return (
    <ArenaRoomProposalWorkspaceView
      editor={editor}
      state={runtime.state}
      controller={runtime.controller}
    />
  );
}

export function ArenaRoomProposalWorkspaceView({
  editor,
  state,
  controller,
}: {
  readonly editor: RoomProposalArenaEditorSession;
  readonly state: ArenaRoomControllerState;
  readonly controller: ProposalController;
}) {
  return (
    <ArenaEditorSessionProvider session={editor}>
      <ProposalWorkspaceInner
        editor={editor}
        state={state}
        controller={controller}
      />
    </ArenaEditorSessionProvider>
  );
}

export function ArenaEditorWorkspaceBoundary({ children }: { readonly children: React.ReactNode }) {
  const runtime = useArenaRoomContext();
  if (runtime?.proposalWorkspace.editor && runtime.state.session?.self.role === 'member') {
    return <ArenaRoomProposalWorkspace />;
  }
  return children;
}
