'use client';

import { useMemo, useRef, useState } from 'react';

import BattleDataModal from '@/components/BattleDataModal';
import { PresetGridPicker } from '@/components/PresetGridPicker';
import { ONLINE_DATA_CARD_TYPES } from '@mahoshojo/contracts/data-cards';
import type {
  ArenaProposalChange,
  ArenaRoomSharedConfig,
  DataCardRef,
} from '@mahoshojo/contracts/arena-room';
import { MAX_COMBATANTS } from '@mahoshojo/contracts/arena-room';

import {
  ArenaEditorSessionProvider,
  useArenaEditorSelector,
  type RoomProposalArenaEditorSession,
} from '../editor';
import { ProposalArenaRosterSection } from '../editor/features/roster/ProposalArenaRosterSection';
import { ProposalArenaScenarioSection } from '../editor/features/scenario/ProposalArenaScenarioSection';
import { ArenaMaterialList } from '../editor/presentation/ArenaMaterialList';
import { BattleModeSwitcher } from '../components/BattleModeSwitcher';
import { BattleSettings } from '../components/BattleSettings';
import { StoryOptions } from '../components/StoryOptions';
import { DatabaseSelector } from '../components/DatabaseSelector';
import { ArenaEditorWorkspaceLayout } from '../editor/ArenaEditorWorkspaceLayout';
import { useLanguagesQuery } from '../hooks/useArenaData';
import type { ArenaRoomController, ArenaRoomControllerState } from '@/lib/arena-room/controller';
import { PRESET_LIST, type Preset } from '@/lib/presets';
import { ARENA_ROOM_PRESET_CATALOG } from '@/lib/arena-room/generated/arena-room-preset-catalog';
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

const buttonClass = 'min-h-10 rounded-lg border px-3 py-2 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const primaryButtonClass = `${buttonClass} border-fuchsia-600 bg-fuchsia-600 text-white hover:bg-fuchsia-700`;
const secondaryButtonClass = `${buttonClass} border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;

const proposalCharacterPresets: Preset[] = PRESET_LIST.filter((preset) => (
  ARENA_ROOM_PRESET_CATALOG.some((entry) => entry.kind === 'character' && entry.id === preset.filename)
));

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
      description={`基于房间配置版本 ${baselineRevision} · 逐项检查配置变更；依赖与联动变更组会再次校验。`}
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
                <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">提案基准：{JSON.stringify(change.expectedBase)}</span>
                <span className="block text-xs text-gray-600 dark:text-gray-400">建议值：{arenaProposalChangeProposedSummary(change)}</span>
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
            提交提案
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
  const [magicalGirlPresetPage, setMagicalGirlPresetPage] = useState(1);
  const [canshouPresetPage, setCanshouPresetPage] = useState(1);
  const [isMatching, setIsMatching] = useState(false);
  const [preview, setPreview] = useState<readonly ArenaProposalChange[] | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [localError, setLocalError] = useState<string | null>(null);
  const submitLock = useRef(false);

  const selectedIds = useMemo(() => {
    const isOnlineReference = (item: { source: string; key: string; reference: { id: string } | null }) => (
      item.source === 'data-card' || item.key.startsWith('data-card:')
    );
    if (modalKind === 'character') return snapshot.combatants.flatMap((item) => item.reference && isOnlineReference(item) ? [item.reference.id] : []);
    if (modalKind === 'scenario') return snapshot.scenario?.reference && isOnlineReference(snapshot.scenario) ? [snapshot.scenario.reference.id] : [];
    if (modalKind === 'auxScenario') return snapshot.auxScenarios.flatMap((item) => item.reference && isOnlineReference(item) ? [item.reference.id] : []);
    if (modalKind === 'material') return snapshot.materials.flatMap((item) => item.reference && isOnlineReference(item) ? [item.reference.id] : []);
    return [];
  }, [modalKind, snapshot.auxScenarios, snapshot.combatants, snapshot.materials, snapshot.scenario]);

  const selectedCharacterPresetFilenames = useMemo(
    () => snapshot.combatants
      .filter((item) => item.source === 'preset')
      .map((item) => item.key.slice('preset:'.length)),
    [snapshot.combatants],
  );

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

  const toggleCharacterPreset = (preset: Preset): void => {
    const key = `preset:${preset.filename}`;
    const entry = ARENA_ROOM_PRESET_CATALOG.find((item) => item.kind === 'character' && item.id === preset.filename);
    if (!entry) return setLocalError('预设角色元数据不可用，请刷新后重试');
    mutate((draft) => ({
      ...draft,
      combatants: draft.combatants.some((item) => item.key === key)
        ? draft.combatants.filter((item) => item.key !== key)
        : [...draft.combatants, {
            key,
            ref: { id: entry.id, kind: 'character' as const, versionToken: entry.versionToken },
          }],
      teams: draft.combatants.some((item) => item.key === key)
        ? draft.teams.map((team) => ({
            ...team,
            combatantKeys: team.combatantKeys.filter((item) => item !== key),
          }))
        : draft.teams,
    }));
  };

  const randomMatchCharacter = async (): Promise<void> => {
    if (isMatching || disabled || snapshot.combatants.length >= MAX_COMBATANTS) return;
    setIsMatching(true);
    setLocalError(null);
    try {
      const response = await fetch('/api/random-public-card?type=character');
      const result = await response.json() as {
        readonly success?: boolean;
        readonly card?: unknown;
        readonly error?: string;
      };
      if (!response.ok || result.success !== true || !result.card) {
        throw new Error(result.error || '无法获取随机公开角色');
      }
      const ref = toExactRef(result.card, 'character');
      const key = `data-card:${ref.id}`;
      mutate((draft) => ({
        ...draft,
        combatants: [
          ...draft.combatants.filter((item) => item.key !== key),
          { key, ref },
        ],
      }));
    } catch (error) {
      setLocalError(`随机匹配失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsMatching(false);
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
      setLocalError('提案提交失败，请根据最新房间配置重试');
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
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">隔离草稿 · 基于房间配置版本 {snapshot.baselineRevision} · 本地编辑不联网</p>
        </div>
        <button type="button" className={primaryButtonClass} disabled={!snapshot.dirty || disabled} onClick={buildPreview}>预览提案</button>
      </div>
      {snapshot.stale ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">房间配置已更新；当前草稿仍绑定旧基线，请重新同步后再提交。</p> : null}
      {localError ? <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{localError}</p> : null}
      <ArenaMemberProposalStatus state={state} controller={controller} />

      <ArenaEditorWorkspaceLayout
        disabled={disabled}
        sections={[
          {
            kind: 'presetCharacters',
            description: `已选 ${selectedCharacterPresetFilenames.length}`,
            defaultOpen: true,
            content: editor.capabilities.canAddPresetRefs ? (
              <>
                <PresetGridPicker
                  title="选择预设魔法少女"
                  presets={proposalCharacterPresets.filter((preset) => preset.type === 'magical-girl')}
                  currentPage={magicalGirlPresetPage}
                  onPageChange={setMagicalGirlPresetPage}
                  disabled={disabled}
                  maxSelected={MAX_COMBATANTS}
                  selectedCountOverride={snapshot.combatants.length}
                  selectedFilenames={selectedCharacterPresetFilenames}
                  onToggle={toggleCharacterPreset}
                />
                <PresetGridPicker
                  title="选择预设残兽"
                  presets={proposalCharacterPresets.filter((preset) => preset.type === 'canshou')}
                  currentPage={canshouPresetPage}
                  onPageChange={setCanshouPresetPage}
                  disabled={disabled}
                  maxSelected={MAX_COMBATANTS}
                  selectedCountOverride={snapshot.combatants.length}
                  selectedFilenames={selectedCharacterPresetFilenames}
                  onToggle={toggleCharacterPreset}
                />
              </>
            ) : <p className="text-sm text-gray-600">当前房间不支持在提案中新增预设引用。</p>,
          },
          {
            kind: 'characterDatabase',
            description: `当前已选 ${snapshot.combatants.length}/${MAX_COMBATANTS}`,
            defaultOpen: true,
            content: (
              <>
                <DatabaseSelector
                  className="!mb-0"
                  title={null}
                  onOpenCharacterModal={() => setModalKind('character')}
                  onRandomMatchCharacter={() => { void randomMatchCharacter(); }}
                  isAuthenticated
                  isGenerating={disabled}
                  isMatching={isMatching ? 'character' : null}
                  combatantCount={snapshot.combatants.length}
                  maxCombatants={MAX_COMBATANTS}
                />
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  提案仅可引用公开且审核通过的数据卡；随机匹配同样只从公开角色库抽取。
                </p>
              </>
            ),
          },
          {
            kind: 'roster',
            description: `已选 ${snapshot.combatants.length}/${MAX_COMBATANTS}`,
            defaultOpen: true,
            keepMounted: true,
            content: (
              <ProposalArenaRosterSection
                disabled={disabled}
                onActionError={setLocalError}
              />
            ),
          },
          {
            kind: 'battleMode',
            description: '不同模式会影响输出风格与计分规则',
            defaultOpen: true,
            content: <BattleModeSwitcher />,
          },
          ...(snapshot.battleMode === 'scenario' ? [{
            kind: 'scenario' as const,
            description: snapshot.scenario?.name ?? '未选择主情景',
            defaultOpen: snapshot.battleMode === 'scenario',
            autoOpen: snapshot.battleMode === 'scenario',
            content: (
              <ProposalArenaScenarioSection
                disabled={disabled}
                onActionError={setLocalError}
                onOpenMainModal={() => setModalKind('scenario')}
                onOpenAuxModal={() => setModalKind('auxScenario')}
              />
            ),
          }] : []),
          {
            kind: 'materials',
            description: `已选 ${snapshot.materials.length}`,
            defaultOpen: false,
            keepMounted: true,
            content: (
              <>
            <button type="button" className={secondaryButtonClass} onClick={() => setModalKind('material')}>浏览在线数据卡</button>
            <p className="mt-2 text-xs text-gray-500">内置素材预设暂不可用：目前没有经过服务器确认的素材目录，避免未验证的正文进入提案。</p>
            <div className="mt-3">
              <ArenaMaterialList
                items={snapshot.materials.map((item) => ({
                  key: item.key,
                  name: item.name,
                  sourceLabel: item.source === 'preset'
                    ? '内置预设'
                    : item.source === 'host-local' ? '房主本地素材' : '公开在线数据卡',
                }))}
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
              </>
            ),
          },
          {
            kind: 'settings',
            description: '建议保留默认；上下文过长或失败时可在这里精简',
            defaultOpen: false,
            keepMounted: true,
            content: <BattleSettings />,
          },
          {
            kind: 'story',
            description: '提案共享故事选项；模型服务与本地判定仍由房主控制',
            defaultOpen: true,
            keepMounted: true,
            content: <StoryOptions languages={languages} />,
          },
        ]}
      />

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
        allowDeckImport={false}
        allowCardDetails={false}
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
