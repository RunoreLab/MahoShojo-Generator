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
import { ProposalArenaMaterialSection } from '../editor/features/material/ProposalArenaMaterialSection';
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
  arenaProposalChangeProposedSummary,
  arenaProposalSelectionError,
  changeRefTitle,
  useArenaProposalChangeLabels,
  type ArenaProposalChangeLabels,
} from './ArenaProposalPanel';
import { buttonClassName } from '@/components/shared/ui/Button';
import { ArenaRoomDialog } from './ArenaRoomDialog';
import { useArenaRoomContext } from './useArenaRoom';

type ModalKind = 'character' | 'scenario' | 'auxScenario' | 'material';
type ProposalController = Pick<
  ArenaRoomController,
  'reconnect' | 'submitProposal' | 'withdrawProposal'
>;

const ResyncConfirmDialog = ({
  onConfirm,
  onCancel,
}: {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) => (
  <ArenaRoomDialog
    open
    titleId="arena-proposal-resync-confirm-heading"
    title="确认同步房间配置？"
    description="当前未提交修改将被丢弃，并以房间最新配置重新建立提案草稿。"
    onClose={onCancel}
    widthClassName="max-w-md"
  >
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className={buttonClassName()} onClick={onCancel}>
        保留草稿
      </button>
      <button type="button" className={buttonClassName({ variant: 'danger' })} onClick={onConfirm}>
        确认丢弃并同步
      </button>
    </div>
  </ArenaRoomDialog>
);


const proposalCharacterPresets: Preset[] = PRESET_LIST.filter((preset) => (
  ARENA_ROOM_PRESET_CATALOG.some((entry) => entry.kind === 'character' && entry.id === preset.filename)
));

const readText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

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
  changes,
  labels,
  selected,
  disabled,
  onSelectedChange,
  onClose,
  onSubmit,
}: {
  readonly changes: readonly ArenaProposalChange[];
  readonly labels: ArenaProposalChangeLabels;
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
      description="逐项检查后将提交给房主审阅；相关联的修改会一起校验。"
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
                <span
                  className="font-medium text-gray-950 dark:text-gray-100"
                  title={changeRefTitle(change)}
                >
                  {arenaProposalChangeProposedSummary(change, labels)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <details className="mt-3">
          <summary className="cursor-pointer select-none text-xs text-gray-600 dark:text-gray-400">技术详情</summary>
          <div className="mt-2 space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
            {changes.map((change) => (
              <p key={`detail-${change.changeId}`}>
                <span className="font-mono">{change.changeId}</span>
                {' · '}
                <ArenaProposalSelectionDetails change={change} />
              </p>
            ))}
          </div>
        </details>
        <div className="mt-4 border-t pt-4 dark:border-gray-800">
          <div className="text-xs text-gray-600 dark:text-gray-400">将提交 {selected.size} / {changes.length} 项变更</div>
          <div aria-live="polite" className="mt-1 min-h-5 text-xs text-red-700 dark:text-red-300">{validationError ?? ''}</div>
          <button
            type="button"
            className={buttonClassName({ variant: 'primary', className: 'mt-2' })}
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
  onSyncFromRoom,
}: {
  readonly editor: RoomProposalArenaEditorSession;
  readonly state: ArenaRoomControllerState;
  readonly controller: ProposalController;
  readonly onSyncFromRoom?: () => void;
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
  const [confirmSync, setConfirmSync] = useState(false);
  const submitLock = useRef(false);
  const previewLabels = useArenaProposalChangeLabels(null, preview ?? []);
  const previewDialogLabels: ArenaProposalChangeLabels = useMemo(() => ({
    ...previewLabels,
    teamKey: (key) => snapshot.teams.find((team) => team.key === key)?.name ?? previewLabels.teamKey?.(key),
  }), [previewLabels, snapshot.teams]);

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

  const requestSync = (): void => {
    if (!onSyncFromRoom) return;
    if (snapshot.dirty) {
      setConfirmSync(true);
      return;
    }
    performSync();
  };

  const performSync = (): void => {
    setPreview(null);
    setSelected(new Set());
    setLocalError(null);
    setConfirmSync(false);
    onSyncFromRoom?.();
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
          <h2 id="arena-room-proposal-workspace-heading" className="text-lg font-semibold text-gray-950 dark:text-gray-100">竞技场提案编辑模式</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">提案草稿与主编辑区隔离 · 本地编辑不联网</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onSyncFromRoom ? (
            <button type="button" className={buttonClassName()} disabled={isMatching} onClick={requestSync}>同步配置</button>
          ) : null}
          <button type="button" className={buttonClassName({ variant: 'primary' })} disabled={!snapshot.dirty || disabled} onClick={buildPreview}>预览提案</button>
        </div>
      </div>
      {snapshot.stale ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">房间设置已更新；请重新同步后再提交提案。</p> : null}
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
              <ProposalArenaMaterialSection
                disabled={disabled}
                onActionError={setLocalError}
                onOpenModal={() => setModalKind('material')}
              />
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

      <section
        aria-labelledby="arena-room-proposal-actions-heading"
        className="mt-6 rounded-2xl border border-fuchsia-200 bg-white/70 p-4 dark:border-fuchsia-900 dark:bg-gray-900/60 sm:p-5"
      >
        <h3 id="arena-room-proposal-actions-heading" className="text-center text-base font-semibold text-gray-950 dark:text-gray-100">
          提案完成后由房主开始生成
        </h3>
        <p className="mt-1 text-center text-sm text-gray-600 dark:text-gray-400">
          多人生成只能由房主启动；把你的调整整理成提案，接受后会进入房间配置。
        </p>
        <div className="mt-4">
          <button
            type="button"
            className="arena-cta-button arena-cta-button--preview"
            disabled={!snapshot.dirty || disabled}
            onClick={buildPreview}
          >
            🖆 预览提案
          </button>
          {onSyncFromRoom ? (
            <button
              type="button"
              className="arena-cta-button arena-cta-button--sync"
              disabled={isMatching}
              onClick={requestSync}
            >
              ↻‌ 同步配置
            </button>
          ) : null}
        </div>
        {!snapshot.dirty ? (
          <p className="mt-1 text-center text-xs text-gray-500 dark:text-gray-400">
            当前草稿还没有可提交的修改；在上方调整配置后即可提交提案。
          </p>
        ) : null}
      </section>

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
          changes={preview}
          labels={previewDialogLabels}
          selected={selected}
          disabled={disabled}
          onSelectedChange={setSelected}
          onClose={() => setPreview(null)}
          onSubmit={() => { void submit(); }}
        />
      ) : null}

      {confirmSync ? (
        <ResyncConfirmDialog
          onConfirm={performSync}
          onCancel={() => setConfirmSync(false)}
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
      onSyncFromRoom={runtime.proposalWorkspace.syncFromRoom}
    />
  );
}

export function ArenaRoomProposalWorkspaceView({
  editor,
  state,
  controller,
  onSyncFromRoom,
}: {
  readonly editor: RoomProposalArenaEditorSession;
  readonly state: ArenaRoomControllerState;
  readonly controller: ProposalController;
  readonly onSyncFromRoom?: () => void;
}) {
  return (
    <ArenaEditorSessionProvider session={editor}>
      <ProposalWorkspaceInner
        editor={editor}
        state={state}
        controller={controller}
        onSyncFromRoom={onSyncFromRoom}
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
