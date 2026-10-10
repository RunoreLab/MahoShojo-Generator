import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from '@tanstack/react-router';
import type { DesktopArenaHostedRecoveryHint } from '@mahoshojo/contracts/desktop-arena-hosted';
import type { ArenaHostedRecoveryReplacement } from '../features/arena/hosted-recovery';
import { readArenaHostedRecoveryHint } from '../platform/arena-hosted-bridge';
import { ARENA_CANONICAL_CAPABILITIES } from '@mahoshojo/contracts/arena-capabilities';
import { PRESET_LIST } from '@mahoshojo/domain/presets';
import { SCENARIO_PRESET_LIST } from '@mahoshojo/domain/scenario-presets';
import { normalizeCustomStoryLength } from '@mahoshojo/domain/story-length';
import { parseCombatantsFromText } from '@mahoshojo/domain/arena-file-parser';
import { buildArenaMaterialState, type ArenaMaterialState } from '@mahoshojo/domain/arena-materials';
import type { NarrativeHistorySort } from '@mahoshojo/domain/narrative-history-operations';
import { AdvancedArenaHeaderView, AdvancedArenaPageView, ArenaEditorWorkspaceLayout, BattleLitePageView, BattleLiteHeaderView, ArenaRosterSection, ArenaRosterImportPanel, ArenaMaterialSection, ArenaScenarioSection, BattleModeSelector, StoryOptionsPanel, PresetGridPicker, ArenaDataSettingsPanel, NarrativeHistorySettings, type ArenaRosterSectionModel, type ArenaScenarioSectionModel, type StoryLengthOption } from '@mahoshojo/ui-web/arena';
import { ArenaReportFormatSelectorView, BattleReportCard, StreamingBattleReportCard } from '@mahoshojo/ui-web/arena-report';
import { CardLibraryModal, type CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import { NarrativeHistoryPicker } from '@mahoshojo/ui-web/narrative-history';
import { AiReasoningPanel, GenerationModeSwitcher, useResultAutoScroll } from '@mahoshojo/ui-web/details-controls';
import { ThemeImage } from '@mahoshojo/ui-web/media';
import { DENY_EXTERNAL_MEDIA } from '@mahoshojo/ui-web/markdown';
import { BackHomeLink, ProductFooter } from '@mahoshojo/ui-web/shell';
import { generationActionClassNames, generationSubmitClassName } from '@mahoshojo/ui-web/generation-actions';
import { DesktopArenaSession, arenaReadinessMessage, arenaReferenceCount, inheritedArenaAdjudication, type ArenaDraft, type DesktopArenaProduct } from '../features/arena/session';
import { buildAdjudicationSourceKey } from '@mahoshojo/domain/arena-adjudication-events';
import { AdvancedArenaControls } from '../features/arena/advanced-controls';
import { addAdvancedCombatants, addAdvancedAuxScenario, removeAdvancedCombatants, removeAdvancedAuxScenarios, setAdvancedMainScenario } from '../features/arena/advanced-input';
import { addArenaCombatants, arenaItemName, fetchArenaPreset, moveArenaItem, parseArenaJson, parseArenaScenario, readArenaFile } from '../features/arena/input';
import { readSublimationHistorySource, type SublimationHistorySource } from '../features/sublimation/history-source';
import { useDesktopAiConfig } from '../features/ai-config/use-desktop-ai-config';
import { resolveDesktopAiTarget } from '../features/ai-config/desktop-ai-config';
import { DesktopAiProviderPanel } from '../features/ai-config/desktop-ai-provider-panel';
import { useDesktopCloudSession } from '../features/account/use-desktop-cloud-session';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import { useDesktopCardLibraryHost } from '../platform/card-library-host';
import { IpcLocalCardRepository } from '../platform/local-card-bridge';
import { DesktopArenaWebPackages } from '../features/arena/web-packages';
import { DesktopArenaWebPackageControls, DesktopArenaWebResult } from '../features/arena/web-controls';
import { IpcWebPackageRepository } from '../platform/web-package-bridge';
import { downloadTextFile } from '../platform/download-text-file';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';
import { useLeaveGuard } from './useLeaveGuard';

const secondary = generationActionClassNames.secondary;
const limits = ARENA_CANONICAL_CAPABILITIES;
type LibraryPurpose = 'character' | 'scenario' | 'auxScenario' | 'material';
const reject = () => { throw new Error('当前页面未开放此能力。'); };

const createWebPackages = () => {
  const repository = new IpcWebPackageRepository((command, args) => invoke(command, args as never));
  return new DesktopArenaWebPackages({ repository, confirmRestore: (title) => window.confirm(`「${title}」已在回收站。确认恢复并导入这份包？`),
    write: async (record, archive) => ({ repaired: (await repository.putWithOutcome(record, archive)).blobOutcome === 'repaired' }) });
};

/** Desktop owns session/IO only. The actual Web controls, layout and report are shared. */
export function DesktopBattleForm({ session, repository, product = 'battle', webPackages }: { session: DesktopArenaSession; repository: IpcLocalCardRepository; product?: DesktopArenaProduct; webPackages?: DesktopArenaWebPackages }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const packageOwner = useMemo(() => webPackages ?? createWebPackages(), [webPackages]);
  const packageState = useSyncExternalStore(packageOwner.subscribe, packageOwner.getSnapshot);
  const recovery = useSyncExternalStore(session.hostedRecovery.subscribe, session.hostedRecovery.getSnapshot);
  useEffect(() => () => { if (!webPackages) packageOwner.dispose(); }, [packageOwner, webPackages]);
  const { state: aiState, store: aiStore } = useDesktopAiConfig();
  const { state: cloudState, store: cloudStore } = useDesktopCloudSession();
  const target = resolveDesktopAiTarget(aiState.selection, aiState.profiles, aiState.generationOverrides, aiState.modelsByProfileId, aiState.presetsByProviderId);
  const hostedTarget = target.location === 'server';
  const hostedUnavailable = !hostedTarget ? null : (!cloudState.bootstrapped ? '正在确认本机账号身份，请稍后。' : state.draft.generationMode !== 'stream' ? '服务器 Arena 当前仅支持流式输出，请明确选择流式。' : null);
  const router = useRouter(); const { openFixed, openContent } = useExternalLinks(); const libraryHost = useDesktopCardLibraryHost();
  const [library, setLibrary] = useState<LibraryPurpose | null>(null);
  const [recoveryHint, setRecoveryHint] = useState<{ value: DesktopArenaHostedRecoveryHint; repair: ArenaHostedRecoveryReplacement; epoch: number } | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const diagnosisFlight = useRef<symbol | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [presetPage, setPresetPage] = useState(1);
  const [languages, setLanguages] = useState([{ code: 'zh-CN', name: '简体中文' }]);
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySource, setHistorySource] = useState<SublimationHistorySource | null>(null);
  const [historySort, setHistorySort] = useState<NarrativeHistorySort>('created_desc');
  const [historyRevision, setHistoryRevision] = useState(0);
  const [advancedBusy, setAdvancedBusy] = useState(false);
  const advancedBusyRef = useRef(false);
  const onAdvancedBusy = useCallback((value: boolean) => { advancedBusyRef.current = value; setAdvancedBusy(value); }, []);
  const ownerEpoch = useRef(0), preparing = useRef(false), historyLoading = useRef(false);
  const dirtyControls = useRef({ roster: false, rosterTeam: false, scenario: false, material: false, ai: false, advanced: false });
  const onRosterDirty = useCallback((dirty: boolean) => { dirtyControls.current.roster = dirty; }, []);
  const onRosterTeamDirty = useCallback((dirty: boolean) => { dirtyControls.current.rosterTeam = dirty; }, []);
  const onScenarioDirty = useCallback((dirty: boolean) => { dirtyControls.current.scenario = dirty; }, []);
  const onMaterialDirty = useCallback((dirty: boolean) => { dirtyControls.current.material = dirty; }, []);
  const onAiDirty = useCallback((dirty: boolean) => { dirtyControls.current.ai = dirty; }, []);
  const onAdvancedDirty = useCallback((value: boolean) => { dirtyControls.current.advanced = value; }, []);
  const draft = state.draft;
  const readinessMessage = useMemo(() => arenaReadinessMessage(draft, product), [draft, product]);
  const referenceCount = useMemo(() => arenaReferenceCount(draft), [draft]);
  const inheritedAdjudication = useMemo(() => inheritedArenaAdjudication(draft, product), [draft, product]);
  // Do not include credential presence probes or preparing-state changes: they do not change target identity.
  const scope = JSON.stringify({ account: cloudState.account?.userId ?? null, credentialEpoch: cloudStore.getCredentialEpoch(), selection: aiState.selection,
    profiles: aiState.profiles, models: aiState.modelsByProfileId, presets: aiState.presetsByProviderId, overrides: aiState.generationOverrides });
  useLayoutEffect(() => { ownerEpoch.current += 1; session.setScope(scope); packageOwner.setScope(scope); aiStore.cancelPreparingGeneration(); setError(null); setImportWarnings([]); setRecoveryHint(null); diagnosisFlight.current = null; setDiagnosing(false); }, [scope, session, aiStore, packageOwner]);
  useEffect(() => () => { ownerEpoch.current += 1; diagnosisFlight.current = null; aiStore.cancelPreparingGeneration(); }, [aiStore]);
  const guard = useLeaveGuard(
    () => Boolean(diagnosisFlight.current) || session.isBusy() || packageOwner.isBusy() || preparing.current || aiStore.isPreparingGeneration() || aiStore.getSnapshot().savingConnection || aiStore.getSnapshot().savingCredential || aiStore.getSnapshot().deletingConnection || historyLoading.current || advancedBusyRef.current || packageOwner.getSnapshot().temporary.length > 0 || session.hasUnsavedDraft() || Object.values(dirtyControls.current).some(Boolean),
    '当前生成、读取或保存尚未完成，或仍有未保存的内容。',
    '窗口关闭保护初始化失败，生成、导入与保存暂不可用，请重新打开页面。',
    () => {
      if (diagnosisFlight.current || packageOwner.isBusy() || session.getSnapshot().saving || session.getSnapshot().importing || preparing.current || aiStore.isPreparingGeneration() || aiStore.getSnapshot().savingConnection || aiStore.getSnapshot().savingCredential || aiStore.getSnapshot().deletingConnection || historyLoading.current || advancedBusyRef.current) return false;
      if (!window.confirm(session.getSnapshot().hosted || session.getSnapshot().generation?.intent.mode === 'hosted' ? '确认离开？只停止本机订阅，服务器可能继续生成；原请求可从此页面恢复。未保存内容可能丢失。' : '确认离开？正在生成的请求会取消，未保存的输入或原文可能丢失。')) return false;
      session.detach(); return true;
    },
  );
  const busy = diagnosing || state.phase === 'generating' || state.saving || state.importing || aiState.generationActive || advancedBusy || packageState.busy;
  const disabled = !guard.ready || busy || state.pendingRestore;
  const update = (patch: Partial<ArenaDraft>) => { if (!disabled) session.updateDraft({ ...session.getSnapshot().draft, ...patch }); };
  const resultRef = useRef<HTMLDivElement>(null);
  useResultAutoScroll(resultRef, state.phase === 'completed' || (state.phase === 'generating' && state.activeGenerationMode === 'stream' && !!state.markdown.trim()), { restored: state.restored });
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/languages.json', { signal: controller.signal, credentials: 'omit', redirect: 'error' }).then((response) => response.ok ? response.json() : null)
      .then((value: unknown) => { if (!controller.signal.aborted && Array.isArray(value)) setLanguages(value.filter((entry) => entry && typeof entry.code === 'string' && typeof entry.name === 'string')); }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!historyOpen) return;
    const controller = new AbortController(); historyLoading.current = true; setHistorySource(null);
    void readSublimationHistorySource(repository, controller.signal).then((source) => { if (!controller.signal.aborted) setHistorySource(source); }).catch(() => undefined)
      .finally(() => { if (!controller.signal.aborted) historyLoading.current = false; });
    return () => { controller.abort(); historyLoading.current = false; };
  }, [historyOpen, historyRevision, repository, scope]);
  const reportError = (cause: unknown) => { setError(cause instanceof Error ? cause.message : '操作失败，原输入仍保留。'); };
  const performImport = async (load: Parameters<DesktopArenaSession['importInput']>[0]) => {
    if (!guard.ready || diagnosisFlight.current || preparing.current || aiState.generationActive || packageOwner.isBusy()) throw new Error('请等待当前操作完成。');
    const epoch = ownerEpoch.current; setError(null); try { await session.importInput(load); } catch (cause) { if (epoch === ownerEpoch.current) reportError(cause); throw cause; }
  };
  const parseCharacters = async (text: string, warnings: string[]) => {
    if (new TextEncoder().encode(text).byteLength > 12 * 1024 * 1024) throw new Error('输入超过 Arena 12 MiB 上限。');
    const parsed = await parseCombatantsFromText(text, { existingCount: 0, maxCombatants: product === 'arena' ? null : limits.maxCombatants, onWarn: (warning) => warnings.push(warning) });
    return parsed.map((item) => ({ ...item, isValid: false, isPreset: false }));
  };
  const applyCharacters = (current: ArenaDraft, items: ArenaDraft['combatants'], warnings: string[], textImport = false) => { const next = product === 'arena' ? addAdvancedCombatants(current, items, (message) => warnings.push(message), textImport) : addArenaCombatants(current, items); setImportWarnings(warnings); return next; };
  const pasteCharacters = (text: string) => performImport(async () => { const warnings: string[] = []; const items = await parseCharacters(text, warnings); return (current) => applyCharacters(current, items, warnings, true); });
  const uploadCharacters = (files: FileList) => performImport(async (signal) => {
    const warnings: string[] = []; const items = (await Promise.all(Array.from(files).map(async (file) => parseCharacters(await readArenaFile(file, signal), warnings)))).flat();
    return (current) => applyCharacters(current, items, warnings, true);
  });
  const togglePreset = (filename: string) => {
    if (disabled) return;
    if (draft.combatants.some((item) => item.isPreset && item.filename === filename)) { update(product === 'arena' ? removeAdvancedCombatants(draft, draft.combatants.flatMap((item, index) => item.isPreset && item.filename === filename ? [index] : [])) : { combatants: draft.combatants.filter((item) => !(item.isPreset && item.filename === filename)) }); return; }
    void performImport(async (signal) => { const warnings: string[] = []; const items = await parseCharacters(await fetchArenaPreset('character', filename, signal), warnings);
      return (current) => applyCharacters(current, items.map((item) => ({ ...item, isPreset: true, filename })), warnings); }).catch(() => undefined);
  };
  const loadScenario = (read: (signal: AbortSignal) => Promise<string>, filename: string | null = null, auxiliary = false, sourceIdentity?: string) => performImport(async (signal) => {
    const content = parseArenaScenario(await read(signal)); return (current) => {
      const warnings: string[] = [];
      const next = product === 'arena' ? auxiliary ? addAdvancedAuxScenario(current, content, filename, crypto.randomUUID(), (warning) => warnings.push(warning), sourceIdentity) : setAdvancedMainScenario(current, content, filename, (warning) => warnings.push(warning), sourceIdentity) : { ...current, scenario: { content, fileName: filename }, scenarioDisplayName: arenaItemName(content) };
      setImportWarnings(warnings); return next;
    };
  });
  const uploadAuxScenarios = (files: FileList | null) => performImport(async (signal) => {
    const inputs = await Promise.all(Array.from(files ?? []).map(async (file) => ({ content: parseArenaScenario(await readArenaFile(file, signal)), filename: file.name })));
    return (current) => { const warnings: string[] = []; const next = inputs.reduce((value, item) => addAdvancedAuxScenario(value, item.content, item.filename, crypto.randomUUID(), (warning) => warnings.push(warning)), current); setImportWarnings(warnings); return next; };
  });
  const materials = draft.materials as ArenaMaterialState[];
  const loadMaterials = (read: (signal: AbortSignal) => Promise<{ text: string; filename: string | null }[]>) => performImport(async (signal) => {
    const source = await read(signal); const items = source.map(({ text, filename }) => buildArenaMaterialState({ payload: parseArenaJson(text), fileName: filename, isNative: false }));
    return (current) => {
      if (arenaReferenceCount(current) + items.length > limits.maxReferenceItemsSanity) throw new Error('参考项超过 256 项，未导入新素材。');
      return { ...current, materials: [...current.materials, ...items] };
    };
  });
  const chooseCard = (_payload: unknown, context: CardLibrarySelectionContext) => {
    if (!context.rawSourceData || disabled || !library) return;
    const text = JSON.stringify(context.rawSourceData);
    const sourceIdentity = buildAdjudicationSourceKey({ sourceDataCardId: context.cloudCardId ?? context.selectionId }) ?? undefined;
    const action = library === 'character' ? product === 'arena' ? performImport(async () => { const warnings: string[] = []; const items = (await parseCharacters(text, warnings)).map((item) => ({ ...item, adjudicationSourceKey: sourceIdentity })); return (current) => applyCharacters(current, items, warnings); }) : pasteCharacters(text) : library === 'scenario' || library === 'auxScenario' ? loadScenario(async () => text, null, library === 'auxScenario', sourceIdentity) : loadMaterials(async () => [{ text, filename: null }]);
    void action.then(() => setLibrary(null)).catch(() => undefined);
  };
  const openLibrary = (purpose: LibraryPurpose) => { if (disabled) return; setLibrary(purpose); void cloudStore.refresh(); };
  const roster: ArenaRosterSectionModel = {
    rows: draft.combatants.map((item, index) => ({ key: String(index), displayName: arenaItemName(item.data), typeLabel: item.type, guidance: item.characterGuidance ?? '', index, teamKey: item.teamId ? String(item.teamId) : null, isPlaceholder: false })),
    teams: draft.teams.map((team) => ({ key: String(team.id), name: team.name, memberKeys: draft.combatants.flatMap((item, index) => item.teamId === team.id ? [String(index)] : []), collapsed: collapsedTeams.has(String(team.id)) })),
    disabled, combatantCountLabel: `${draft.combatants.length}/${limits.maxCombatants}`, combatantCapReached: draft.combatants.length >= limits.maxCombatants,
    capabilities: { reorderRows: true, removeRows: true, editGuidance: true, ranking: false, addPlaceholders: false, clearRoster: true, createTeams: true, renameTeams: true, removeTeams: true, reorderTeams: true, assignTeamMembers: true, reorderTeamMembers: true, collapseTeams: true },
    actions: {
      moveRow: (from, to) => update({ combatants: moveArenaItem(draft.combatants, from, to) }),
      removeRow: (key) => update(product === 'arena' ? removeAdvancedCombatants(draft, [Number(key)]) : { combatants: draft.combatants.filter((_, index) => index !== Number(key)) }),
      setGuidance: (key, value) => update({ combatants: draft.combatants.map((item, index) => index === Number(key) ? { ...item, characterGuidance: value } : item) }),
      addPlaceholder: reject, clearRoster: () => update(product === 'arena' ? removeAdvancedCombatants(draft, draft.combatants.map((_, index) => index)) : { combatants: [] }),
      createTeam: () => { const id = Math.max(0, ...draft.teams.map((team) => team.id)) + 1; update({ teams: [...draft.teams, { id, name: `分队 ${id}` }] }); return String(id); },
      renameTeam: (key, name) => update({ teams: draft.teams.map((team) => String(team.id) === key ? { ...team, name } : team) }),
      removeTeam: (key) => update({ teams: draft.teams.filter((team) => String(team.id) !== key), combatants: draft.combatants.map((item) => String(item.teamId) === key ? Object.fromEntries(Object.entries(item).filter(([field]) => field !== 'teamId')) as typeof item : item) }),
      moveTeam: (key, direction) => { const index = draft.teams.findIndex((team) => String(team.id) === key); update({ teams: moveArenaItem(draft.teams, index, index + direction) }); },
      assignCombatant: (key, teamKey) => update({ combatants: draft.combatants.map((item, index) => index === Number(key) ? teamKey ? { ...item, teamId: Number(teamKey) } : Object.fromEntries(Object.entries(item).filter(([field]) => field !== 'teamId')) as typeof item : item) }),
      moveTeamMember: (key, from, to) => { const indices = draft.combatants.flatMap((item, index) => String(item.teamId) === key ? [index] : []); const reordered = moveArenaItem(indices.map((index) => draft.combatants[index]!), from, to); const next = [...draft.combatants]; indices.forEach((index, i) => { next[index] = reordered[i]!; }); update({ combatants: next }); },
      toggleTeamCollapsed: (key) => setCollapsedTeams((prior) => { const next = new Set(prior); if (next.has(key)) next.delete(key); else next.add(key); return next; }),
    },
  };
  const scenario: ArenaScenarioSectionModel = {
    disabled, isAuthenticated: !!cloudState.account, isMatchingBlocked: true, isMatchingScenario: false, mainName: draft.scenarioDisplayName, mainIsNative: false,
    auxScenarios: product === 'arena' ? draft.auxScenarios.map((item, index) => ({ key: String(index), title: arenaItemName(item.content), isNative: false })) : [], auxBudgetLine: `参考项合计 ${referenceCount}/256`, auxBudgetExhausted: referenceCount >= limits.maxReferenceItemsSanity, presets: SCENARIO_PRESET_LIST, presetsLoading: false, presetsError: null,
    selectedPresetFilenames: [...(draft.scenario.fileName ? [draft.scenario.fileName] : []), ...(product === 'arena' ? draft.auxScenarios.flatMap((item) => item.fileName ? [item.fileName] : []) : [])], loadingPresetFilename: null,
    capabilities: { browseMain: true, randomMatchMain: false, clearMain: true, uploadMain: true, pasteMain: true, presetRefs: true,
      auxSection: product === 'arena', addAux: product === 'arena', browseAux: product === 'arena', randomMatchAux: false, uploadAux: product === 'arena', pasteAux: product === 'arena', reorderAux: product === 'arena', removeAux: product === 'arena', clearAux: product === 'arena' },
    actions: { openMainModal: () => openLibrary('scenario'), randomMatchMain: reject, clearMain: () => update(product === 'arena' ? setAdvancedMainScenario(draft, null, null) : { scenario: { content: null, fileName: null }, scenarioDisplayName: null }),
      uploadMain: (file) => loadScenario((signal) => readArenaFile(file, signal), file.name), pasteMain: (text) => loadScenario(async () => text),
      togglePreset: (filename) => { if (draft.scenario.fileName === filename) { update(product === 'arena' ? setAdvancedMainScenario(draft, null, null) : { scenario: { content: null, fileName: null }, scenarioDisplayName: null }); return; }
        const auxIndex = draft.auxScenarios.findIndex((item) => item.fileName === filename); if (product === 'arena' && auxIndex >= 0) { update(removeAdvancedAuxScenarios(draft, [auxIndex])); return; }
        void loadScenario((signal) => fetchArenaPreset('scenario', filename, signal), filename, product === 'arena' && !!draft.scenario.content).catch(() => undefined); },
      openAuxModal: () => openLibrary('auxScenario'), randomMatchAux: reject, uploadAux: uploadAuxScenarios, pasteAux: (text) => loadScenario(async () => text, null, true), moveAux: (from, to) => update({ auxScenarios: moveArenaItem(draft.auxScenarios, from, to) }), removeAux: (key) => update(removeAdvancedAuxScenarios(draft, [Number(key)])), clearAux: () => update(removeAdvancedAuxScenarios(draft, draft.auxScenarios.map((_, index) => index))) },
  };
  const diagnoseRecovery = async () => {
    if (disabled || preparing.current || diagnosisFlight.current || !cloudState.bootstrapped) return;
    const flight = Symbol(), epoch = ownerEpoch.current, repair = session.hostedRecovery.captureReplacement();
    diagnosisFlight.current = flight; setDiagnosing(true); setError(null); setRecoveryHint(null);
    try {
      const value = await readArenaHostedRecoveryHint(invoke, { product });
      if (epoch === ownerEpoch.current && session.hostedRecovery.isReplacementCurrent(repair)) setRecoveryHint({ value, repair, epoch });
    } catch (cause) { if (epoch === ownerEpoch.current) reportError(cause); }
    finally { if (diagnosisFlight.current === flight) { diagnosisFlight.current = null; setDiagnosing(false); } }
  };
  const currentHint = recoveryHint?.epoch === ownerEpoch.current && session.hostedRecovery.isReplacementCurrent(recoveryHint.repair) ? recoveryHint : null;
  const repairHint = currentHint && (currentHint.value.state === 'available' || currentHint.value.state === 'expired') ? currentHint : null;
  const generate = () => {
    if (disabled || diagnosisFlight.current || preparing.current || session.isBusy() || packageOwner.isBusy()) return;
    if (!target.modelId || !target.providerTarget || target.unavailableReason || hostedUnavailable) { setError(hostedUnavailable ?? target.unavailableReason ?? '请选择受支持的 AI 目标。'); return; }
    const actor = cloudState.account ? { kind: 'account' as const, expectedUserId: cloudState.account.userId } : { kind: 'anonymous' as const };
    const repair = hostedTarget ? repairHint?.repair : undefined;
    const previousRequest = hostedTarget ? repairHint && 'requestId' in repairHint.value ? repairHint.value.requestId : recovery.pointer?.requestId : undefined;
    if (hostedTarget && recovery.blocked && !repair) { setError(recovery.error); return; }
    if (previousRequest && !window.confirm(repair ? `本机诊断到原请求 ${previousRequest}。确认放弃其本机恢复并开始新请求？不会停止旧服务器任务；本机原指针仅在新指针保存成功后替换。` : '已有服务器恢复记录。确认以新请求替换？这会放弃原记录的页面恢复入口，不会停止旧服务器任务。')) return;
    if (state.rawText && !window.confirm('开始新生成将替换当前结果，请先保存或完整导出。继续？')) return;
    const snapshot = structuredClone(session.getSnapshot().draft); const frozen = { ...snapshot, customStoryLength: normalizeCustomStoryLength(snapshot.customStoryLength) };
    const readiness = arenaReadinessMessage(frozen, product); if (readiness) { setError(readiness); return; }
    const epoch = ownerEpoch.current; preparing.current = true; setError(null);
    void aiStore.withPreparedGeneration(async (prepared) => {
      if (epoch !== ownerEpoch.current || !prepared.modelId || !prepared.providerTarget) return;
      // Credential preparation is finished; the session now owns the generation/leave flight.
      preparing.current = false;
      if (prepared.location === 'server') {
        if (prepared.providerTarget.kind === 'custom') throw new Error('自定义连接仅支持客户端。');
        const config = prepared.providerTarget.kind === 'preset'
          ? { presetConfig: { providerId: prepared.providerTarget.providerId, modelId: prepared.modelId, generationOverrides: prepared.generationOverrides } }
          : { systemConfig: { ...(prepared.modelId !== 'default' ? { modelId: prepared.modelId } : {}), generationOverrides: prepared.generationOverrides } };
        await session.generateHosted({ invoke }, frozen, { mode: 'hosted', generationMode: 'stream', modelId: prepared.modelId, ...config }, actor, previousRequest, repair);
        return;
      }
      if (!prepared.mode) return;
      await session.generate({ invoke, profileId: prepared.profile?.id ?? '', providerTarget: prepared.providerTarget }, frozen,
        { mode: prepared.mode, generationMode: frozen.generationMode, modelId: prepared.modelId,
          temperature: prepared.generationOverrides?.temperature, maxOutputTokens: prepared.generationOverrides?.maxOutputTokens });
    }).catch((cause: unknown) => { if (epoch === ownerEpoch.current) reportError(cause); }).finally(() => { preparing.current = false; });
  };
  const restoreHosted = () => {
    const pointer = session.hostedRecovery.getSnapshot().pointer;
    if (!pointer || disabled || diagnosisFlight.current || preparing.current || session.isBusy() || !cloudState.bootstrapped) return;
    if (pointer.actor.kind === 'account' && cloudState.account?.userId !== pointer.actor.expectedUserId) { setError('请先登录原生成账号，再显式恢复。不会切换到当前账号或匿名身份。'); return; }
    if (!window.confirm(`${pointer.actor.kind === 'anonymous' ? '以原匿名身份' : '以原账号'}恢复服务器请求？不会重新创建或携带供应商 Key；当前结果将被恢复正文替换。`)) return;
    void session.restoreHosted({ invoke }, pointer.requestId);
  };
  const reasoning = state.reasoning ? { status: state.phase === 'generating' ? 'thinking' as const : 'done' as const, source: 'provider' as const, text: state.reasoning } : null;
  const download = (filename: string, text: string, mimeType: string) => { try { downloadTextFile(filename, text, mimeType); } catch (cause) { reportError(cause); } };
  const exportAll = () => download('arena-complete.json', session.exportDocument(), 'application/json');
  const result = (state.rawText || state.reasoning || state.report) ? <section ref={resultRef} className="mt-6 space-y-4" aria-label="战报结果">
    {state.resultFormat === 'web' ? <><DesktopArenaWebResult key={`${scope}:${state.generation?.intent.requestId ?? 'restored'}`} state={state} owner={packageOwner} disabled={disabled} />{reasoning ? <AiReasoningPanel reasoning={reasoning} /> : null}</> : state.report && state.activeGenerationMode !== 'stream' ? <BattleReportCard report={{ ...state.report, aiReasoning: reasoning }} mode={state.report.mode} ports={{ mediaPolicy: DENY_EXTERNAL_MEDIA, onNavigateExternal: openContent, downloadMarkdown: (text: string, filename: string) => download(filename, text, 'text/markdown;charset=utf-8') }} />
      : state.markdown && state.activeGenerationMode === 'stream' ? <StreamingBattleReportCard aiReasoning={reasoning} reporterInfo={state.report?.reporterInfo} adjudicationResults={state.generation?.adjudicationResults} content={state.markdown} mode={state.generation?.input.battleMode ?? draft.battleMode} isStreaming={state.phase === 'generating'} onStopGeneration={() => session.cancel()} ports={{ mediaPolicy: DENY_EXTERNAL_MEDIA, onNavigateExternal: openContent, downloadMarkdown: (text: string, filename: string) => download(filename, text, 'text/markdown;charset=utf-8') }} /> : null}
    {state.resultFormat !== 'web' && !(state.markdown && state.activeGenerationMode === 'stream') && !state.report && reasoning ? <AiReasoningPanel reasoning={reasoning} /> : null}
    <details><summary>{state.hosted ? '服务器收到的正文（控制元数据单独保留）' : '完整原始输出（含元数据）'}</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">{state.rawText}</pre></details>
    {state.hosted ? <div className="space-y-2" aria-label="服务器生成状态">
      <p role="status">连接：{state.hosted.connectionState}；{state.hosted.terminal?.event === 'done' ? '服务器任务终态' : '最近服务响应状态'}：{state.hosted.serverStatus ?? '尚未确认'}。角色签名更新尚未接入；连接或恢复错误不表示任务已取消。</p>
      {state.hosted.metadataState !== 'available' ? <p role="status">本次判定、记者等附加元数据未取得；服务器可能已经执行判定，恢复时不会在本机重掷。</p> : null}
      {state.hosted.recoveryCredentialState === 'memory-only' ? <p role="alert">匿名恢复凭据保存失败，当前任务可继续；关闭应用后可能无法恢复，请完整导出。</p> : null}
      {state.hosted.validationMessage ? <p role="status">{state.hosted.validationMessage}</p> : null}
      <details><summary>服务器公开元数据与终态</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(state.hosted, null, 2)}</pre></details>
    </div> : null}
    <div className="flex flex-wrap gap-3">
      {session.canAppendHostedHistory() ? <button className={secondary} type="button" disabled={disabled} onClick={() => session.appendHostedHistory()}>将本次正文加入活动历史</button> : null}
      <button className={secondary} type="button" onClick={() => { void exportAll(); }}>完整导出 JSON</button>
      {state.candidates?.characterEffects.length ? <button className={secondary} type="button" disabled={disabled} onClick={() => { void session.save('characters'); }}>另存战后角色副本</button> : null}
      {draft.narrativeHistoryEntries.length ? <button className={secondary} type="button" disabled={disabled} onClick={() => { void session.save('history'); }}>保存叙事历史到本地库</button> : null}
    </div>
    {state.saveStatus === 'saved' ? <p role="status">已保存到本地库，可在卡库重新打开。</p> : null}
    {state.saveError ? <p role="alert">{state.saveError}</p> : null}
  </section> : null;
  const settings = <>
          <ArenaDataSettingsPanel value={hostedTarget ? { ...draft.settings, writeArenaHistory: false, writeCurrentState: false } : draft.settings} writeDisabledReason={hostedTarget ? '服务器签名角色更新尚未接入，本次不会写入角色历史或当前状态；客户端偏好保持不变。' : undefined} onChange={(patch) => update({ settings: { ...draft.settings, ...patch } })} disabled={disabled} footerNote={<p className="text-xs">设置与角色工作副本保存在本机草稿；原始库卡保持不变。</p>} />
          <NarrativeHistorySettings value={draft.settings} onChange={(patch) => update({ settings: { ...draft.settings, ...patch } })} disabled={disabled} persistenceNote="完成后追加到本机活动草稿；保存到本地库需单独操作。超限或写入失败时请完整导出。" readingNote="引用本地历史仅用于提示词，不改写原卡。" />
          <button type="button" className={secondary} disabled={disabled} onClick={() => setHistoryOpen(true)}>引用本地叙事历史</button>
          <p className="text-xs">已引用 {draft.historyReferences.length} 条；活动历史 {draft.narrativeHistoryEntries.length} 条</p>
  </>;
  const slots = {
        header: <BattleLiteHeaderView logo={<ThemeImage lightSrc="/arena-black.svg" darkSrc="/arena-white.svg" width={300} height={84} alt="魔法少女竞技场" />} description="选择角色，生成属于他们的故事。" helper={product === 'arena' ? '桌面高级单次 · 本机独立工作稿 · 客户端 Direct' : '桌面简洁版 · 本机工作副本 · Direct / 服务器流式'} />,
        rankingLinks: null, pageLinks: product === 'battle' ? <a className="footer-link" href="#/arena" onClick={(event) => { event.preventDefault(); navigateByProductHref(router, '/arena'); }}>高级单次配置</a> : null,
        presets: <PresetGridPicker title="预设角色" presets={PRESET_LIST} currentPage={presetPage} onPageChange={setPresetPage} disabled={disabled} maxSelected={limits.maxCombatants} selectedCountOverride={draft.combatants.length} selectedFilenames={draft.combatants.filter((item) => item.isPreset).map((item) => item.filename)} onToggle={(preset) => togglePreset(preset.filename)} />,
        database: <button type="button" className={secondary} disabled={disabled} onClick={() => openLibrary('character')}>选择本地 / 公开角色</button>,
        localImport: <ArenaRosterImportPanel disabled={disabled} limitReached={draft.combatants.length >= limits.maxCombatants} onUpload={uploadCharacters} onPaste={pasteCharacters} onDirtyChange={onRosterDirty} />,
        roster: <ArenaRosterSection model={roster} onDirtyChange={onRosterTeamDirty} />,
        mode: <BattleModeSelector value={draft.battleMode} onChange={(battleMode) => { if (product === 'arena' && draft.battleMode === 'scenario' && battleMode !== 'scenario' && dirtyControls.current.scenario && !window.confirm('切换模式会关闭情景编辑，放弃尚未导入的情景文本？')) return; update({ battleMode }); }} disabled={disabled} />,
        scenario: <ArenaScenarioSection model={scenario} presentation={product === 'battle' ? { variant: 'lite', hasMain: !!draft.scenario.content, summary: draft.scenarioDisplayName ?? '未选择' } : undefined} onDirtyChange={onScenarioDirty} />,
        materials: <ArenaMaterialSection onDirtyChange={onMaterialDirty} model={{ disabled, items: materials.map((item, index) => ({ key: String(index), name: item.name, sourceLabel: item.sourceType, fileName: item.fileName })),
          notice: '素材仅作为参考；本地与缓存来源不代表服务器认证。', hasReferenceCapacity: referenceCount < limits.maxReferenceItemsSanity,
          capabilities: { browseOnline: true, clearAll: true, upload: true, paste: true, reorder: true },
          actions: { openModal: () => openLibrary('material'), clearAll: () => update({ materials: [] }),
            upload: (files) => loadMaterials(async (signal) => Promise.all(Array.from(files ?? []).map(async (file) => ({ text: await readArenaFile(file, signal), filename: file.name })))),
            paste: (text) => loadMaterials(async () => [{ text, filename: null }]), move: (from, to) => update({ materials: moveArenaItem(draft.materials, from, to) }), remove: (key) => update({ materials: draft.materials.filter((_, index) => String(index) !== key) }) } }} />,
        storyOptions: <>
          <StoryOptionsPanel isGenerating={disabled} enableUserGuidance afterUserGuidance={product === 'arena' ? <AdvancedArenaControls session={session} draft={draft} scope={scope} disabled={disabled} importInput={performImport} onDirtyChange={onAdvancedDirty} onBusyChange={onAdvancedBusy} /> : undefined} languages={languages} userGuidance={draft.settings.userGuidance} onUserGuidanceChange={(userGuidance) => update({ settings: { ...draft.settings, userGuidance } })}
            storyLength={draft.storyLength as StoryLengthOption} onStoryLengthChange={(storyLength) => update({ storyLength })} customStoryLength={draft.customStoryLength} onCustomStoryLengthChange={(customStoryLength) => update({ customStoryLength })} selectedLanguage={draft.selectedLanguage} onSelectedLanguageChange={(selectedLanguage) => update({ selectedLanguage })} />
          {product === 'battle' ? settings : null}
          <p className="text-xs">{product === 'arena' ? '手动及角色、主辅情景' : '角色与主情景继承'} {inheritedAdjudication.events.length} {hostedTarget ? '个随机判定由服务器在创建时执行，本机不会重掷；素材内判定不执行。' : '个随机判定每次生成只在本机掷骰一次，非服务器权威；素材内判定不执行。'}</p>
          {inheritedAdjudication.skippedLegacy ? <p role="status">{inheritedAdjudication.skippedLegacy} 个旧版随机事件格式不受支持，保留原字段但不执行。</p> : null}
          <fieldset disabled={!guard.ready} className="min-w-0"><DesktopAiProviderPanel generationMode={draft.generationMode} onDirtyChange={onAiDirty} showConnectionTest={false} copy={{ serverOutput: { stream: '', nonStream: '' }, emptyProfilesHint: '请配置客户端连接。', serverFootnote: 'Arena 服务器目前仅支持流式创建、恢复与停止；角色签名更新和非流式 JSON 待接入。', payloadNoun: '角色与故事设定' }} /></fieldset>
          {hostedTarget ? <p role="status">官方服务器流式生成。创建前验证支持与原账号；不会自动改为客户端执行。</p> : null}
        </>,
        generationMode: <>
          <ArenaReportFormatSelectorView value={draft.reportFormat} disabled={disabled} onChange={(reportFormat) => update({ reportFormat })} webDescription="生成网页或包目标源码；本片仅验证、保存与导出，隔离运行待 D4 验收。" />
          {draft.reportFormat === 'web' ? <DesktopArenaWebPackageControls key={`${product}:${scope}`} owner={packageOwner} selectedRef={draft.webPackageRef} disabled={disabled} onSelect={(webPackageRef) => { const next = { ...session.getSnapshot().draft, webPackageRef }; delete next.webPackagePromptProjection; session.updateDraft(next); }} /> : null}
          <GenerationModeSwitcher optionDescriptions={{ stream: '生成时逐步显示正文；Web 输出仅显示安全源码，隔离运行仍待验。' }} value={draft.generationMode} disabled={disabled} disabledReasons={hostedTarget ? { 'non-stream': '服务器 Arena 非流式 JSON 尚待接入，请明确选择流式。' } : undefined} onChange={(generationMode) => update({ generationMode })} helper={hostedTarget ? '服务器逐步返回战报；流断开可按原请求恢复，停止需服务器确认。' : draft.reportFormat === 'web' ? '两种方式都生成相同 Web 目标；流式期间只显示安全源码，不执行内容。' : '非流式输出结构化战报；流式逐步显示 Markdown。'} />
        </>,
        actions: <>
          {state.pendingRestore ? <p role="status">发现本机草稿。<button type="button" className={secondary} onClick={() => session.restoreDraft()}>恢复草稿</button><button type="button" className={secondary} onClick={() => { if (window.confirm('清除旧草稿？此操作不会删除本地库。')) session.discardDraft(); }}>清除草稿</button></p> : null}
          <button type="button" className={generationSubmitClassName} disabled={disabled || !!hostedUnavailable || !!target.unavailableReason || !!readinessMessage || (hostedTarget && recovery.blocked && !repairHint)} onClick={generate}>生成战报</button>
          {busy ? <button type="button" className={secondary} disabled={state.saving || packageState.busy} onClick={() => { aiStore.cancelPreparingGeneration(); ownerEpoch.current += 1; session.cancel(); }}>{state.generation?.intent.mode === 'hosted' || state.hosted ? '请求服务器停止' : '取消生成'}</button> : null}
          {recovery.pointer ? <section aria-label="服务器恢复记录" className="space-y-2"><p>原服务器请求：{recovery.pointer.requestId} · {recovery.pointer.actor.kind === 'anonymous' ? '原匿名身份' : `账号 ${recovery.pointer.actor.expectedUserId}`} · {recovery.pointer.state}</p>
            <button type="button" className={secondary} disabled={disabled || !cloudState.bootstrapped} onClick={restoreHosted}>恢复原服务器战报</button>
</section> : null}
          {recovery.error ? <p role="alert">{recovery.error}{recovery.blocked ? <button type="button" className={secondary} disabled={disabled} onClick={() => { if (window.confirm('清除无法读取的原恢复指针？不会停止服务器任务。')) session.hostedRecovery.discard(); }}>清除损坏恢复指针</button> : null}</p> : null}
          {hostedTarget || recovery.pointer || recovery.blocked ? <section aria-label="本机恢复身份诊断" className="space-y-2">
            <button type="button" className={secondary} disabled={disabled || !cloudState.bootstrapped} onClick={() => { void diagnoseRecovery(); }}>检查本机恢复身份</button>
            {currentHint ? <p role="status">{currentHint.value.state === 'none' ? '当前身份下未找到可显示的原生恢复记录；这不证明服务器没有任务。' : currentHint.value.state === 'unavailable' ? '原生恢复凭据无法读取，无法确认原请求；不会清除凭据或猜测身份。' : <>原生记录：{currentHint.value.requestId} · {currentHint.value.actorKind === 'anonymous' ? '原匿名身份' : '当前账号'} · {currentHint.value.state === 'expired' ? '凭据已到期' : '本机身份可用'}。此提示不保证服务器仍保留结果。点击生成时可明确确认放弃此记录的本机恢复，不会停止服务器任务。</>}</p> : null}
          </section> : null}
          {state.phase === 'generating' && state.hosted?.softTimeoutWarning ? <p role="status">{state.hosted.softTimeoutWarning} 此提示不会自动停止或重新创建请求。</p> : null}
          {hostedUnavailable ? <p role="status">{hostedUnavailable}</p> : null}
          <button type="button" className={secondary} onClick={() => { void exportAll(); }}>导出当前会话</button>
          {state.draftError ? <p role="alert">{state.draftError}<button type="button" disabled={busy} onClick={() => session.retryDraftSave()}>重试保存草稿</button><button type="button" disabled={busy} onClick={() => { if (window.confirm('清除旧草稿及当前页面内容？请先导出。')) session.discardDraft(); }}>清除草稿</button></p> : null}
          {readinessMessage ? <p>{readinessMessage}</p> : null}
          {importWarnings.length ? <ul role="status">{importWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
          {error || guard.message ? <p role="alert">{error ?? guard.message}</p> : null}
          {state.message ? <p role="status">{state.message}</p> : null}
        </>,
        community: null, result, storySession: null,
        homeLink: <BackHomeLink href="#/" onNavigate={() => navigateByProductHref(router, '/')} />,
        footer: <ProductFooter assetSource={{ baseUrl: '/' }} onNavigateInternal={(href) => navigateByProductHref(router, href)} resolveInternalHref={resolveInternalHrefForHashHistory} onNavigateExternal={openFixed} />,
  };
  return <>
    {product === 'arena' ? <AdvancedArenaPageView header={<AdvancedArenaHeaderView logo={<ThemeImage lightSrc="/arena-black.svg" darkSrc="/arena-white.svg" width={320} height={90} alt="魔法少女竞技场" />} description="桌面高级单次 · 角色、主辅情景与故事设定" guideChildren={<p>配置输入后生成单次战报。此页使用独立本机草稿，支持客户端 Direct、官方服务器流式与 Web 源码生成/验证/导出；隔离运行、连续故事、插图和服务器角色签名更新尚未开放。<button className="footer-link" type="button" onClick={() => navigateByProductHref(router, '/battle')}>前往简洁版</button></p>} />} result={result} homeLink={slots.homeLink} footer={slots.footer}>
      <ArenaEditorWorkspaceLayout disabled={disabled} sections={[
        { kind: 'presets', title: '🎴 预设角色', column: 'left', description: '选择内置角色', defaultOpen: true, content: slots.presets },
        { kind: 'database', title: '📚 角色库', column: 'left', description: '本地、公开或缓存副本', defaultOpen: true, content: slots.database },
        { kind: 'import', title: '📁 本地导入', column: 'left', description: '上传或粘贴角色 JSON', defaultOpen: true, keepMounted: true, content: slots.localImport },
        { kind: 'roster', title: '👥 已选角色 / 分队', column: 'left', description: `${draft.combatants.length}/32`, defaultOpen: true, keepMounted: true, content: slots.roster },
        { kind: 'mode', title: '🎮 模式选择', column: 'right', description: '普通单次故事模式', defaultOpen: true, content: slots.mode },
        ...(draft.battleMode === 'scenario' ? [{ kind: 'scenario', title: '🎭 情景设置', column: 'right' as const, description: `主情景与 ${draft.auxScenarios.length} 个辅助情景`, defaultOpen: true, keepMounted: true, content: slots.scenario }] : []),
        { kind: 'materials', title: '📎 素材注入', column: 'right', description: `参考项 ${referenceCount}/256`, defaultOpen: false, keepMounted: true, content: slots.materials },
        { kind: 'settings', title: '⚙️ 读写设置', column: 'right', description: '角色工作副本与叙事历史', defaultOpen: false, keepMounted: true, content: settings },
        { kind: 'story', title: '🧠 故事引导 / 判定 / AI 模型', column: 'right', description: '辅助设定、活动历史编辑与 AI 目标', defaultOpen: true, keepMounted: true, content: slots.storyOptions },
        { kind: 'generation', title: '⚡ 生成方式', column: 'right', description: 'Markdown 或 Web 源码；流式/非流式', defaultOpen: true, content: slots.generationMode },
        { kind: 'actions', title: '🚀 开始生成', column: 'right', description: '一次冻结，一个请求', collapsible: false, content: slots.actions },
      ]} />
    </AdvancedArenaPageView> : <BattleLitePageView isGenerating={disabled} presetCountLabel={String(draft.combatants.filter((item) => item.isPreset).length)} combatantCountLabel={`${draft.combatants.length}/${limits.maxCombatants}`}
      showScenario={draft.battleMode === 'scenario'} hasScenario={!!draft.scenario.content} materialCount={draft.materials.length} referenceItemCount={referenceCount} maxReferenceItems={limits.maxReferenceItemsSanity}
      copy={{ databaseTitle: '📚 角色库', databaseDescription: '选择本地卡、在线公开卡或已缓存副本', modeDescription: '不同模式决定故事风格', storyOptionsDescription: '设置故事方向、历史读写和 AI 目标' }} slots={slots} />}
    <CardLibraryModal host={libraryHost} isOpen={library !== null} onClose={() => setLibrary(null)} onSelectCard={chooseCard} selectedType={library === 'material' ? 'all' : library === 'auxScenario' ? 'scenario' : library ?? 'character'} allowedTypes={library === 'material' ? undefined : [library === 'auxScenario' ? 'scenario' : library ?? 'character']} initialTab="local" visibleTabs={['local', 'public']} allowDeckImport={false} titleOverride="选择本地或公开缓存副本" />
    <NarrativeHistoryPicker isOpen={historyOpen} onClose={() => setHistoryOpen(false)} entries={historySource?.entries ?? []} lastUpdatedAt={historySource?.lastUpdatedAt ?? null} sort={historySort} onSort={setHistorySort}
      readStatus={historySource?.status ?? 'loading'} formatDateTime={(value) => value} sourceHint={historySource?.message ?? '本地库只读引用，源记录保持不变。'}
      onConfirm={(entries) => { update({ historyReferences: entries }); setHistoryOpen(false); }} />
    {historyOpen && historySource?.status === 'error' ? <button type="button" onClick={() => setHistoryRevision((value) => value + 1)}>重试读取历史</button> : null}
  </>;
}

function DesktopArenaHost({ product }: { product: DesktopArenaProduct }) {
  const repository = useMemo(() => new IpcLocalCardRepository((command, args) => invoke(command, args as never)), []);
  const [owners, setOwners] = useState<{ session: DesktopArenaSession; packages: DesktopArenaWebPackages } | null>(null);
  useEffect(() => { const packages = createWebPackages(); const session = new DesktopArenaSession({ product, repository, storage: window.localStorage, resolveWebPackage: packages.resolveExact }); setOwners({ session, packages }); return () => { session.dispose(); packages.dispose(); }; }, [repository, product]);
  return owners ? <DesktopBattleForm session={owners.session} webPackages={owners.packages} repository={repository} product={product} /> : <p role="status">正在读取本机草稿…</p>;
}

export function DesktopBattle() { return <DesktopArenaHost product="battle" />; }
export function DesktopAdvancedArena() { return <DesktopArenaHost product="arena" />; }
