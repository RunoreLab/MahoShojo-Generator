import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from '@tanstack/react-router';
import { ARENA_CANONICAL_CAPABILITIES } from '@mahoshojo/contracts/arena-capabilities';
import { PRESET_LIST } from '@mahoshojo/domain/presets';
import { SCENARIO_PRESET_LIST } from '@mahoshojo/domain/scenario-presets';
import { normalizeCustomStoryLength } from '@mahoshojo/domain/story-length';
import { parseCombatantsFromText } from '@mahoshojo/domain/arena-file-parser';
import { buildArenaMaterialState, type ArenaMaterialState } from '@mahoshojo/domain/arena-materials';
import type { NarrativeHistorySort } from '@mahoshojo/domain/narrative-history-operations';
import { BattleLitePageView, BattleLiteHeaderView, ArenaRosterSection, ArenaRosterImportPanel, ArenaMaterialSection, ArenaScenarioSection, BattleModeSelector, StoryOptionsPanel, PresetGridPicker, ArenaDataSettingsPanel, NarrativeHistorySettings, type ArenaRosterSectionModel, type ArenaScenarioSectionModel, type StoryLengthOption } from '@mahoshojo/ui-web/arena';
import { BattleReportCard, StreamingBattleReportCard } from '@mahoshojo/ui-web/arena-report';
import { CardLibraryModal, type CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import { NarrativeHistoryPicker } from '@mahoshojo/ui-web/narrative-history';
import { AiReasoningPanel, GenerationModeSwitcher, useResultAutoScroll } from '@mahoshojo/ui-web/details-controls';
import { ThemeImage } from '@mahoshojo/ui-web/media';
import { DENY_EXTERNAL_MEDIA } from '@mahoshojo/ui-web/markdown';
import { BackHomeLink, ProductFooter } from '@mahoshojo/ui-web/shell';
import { generationActionClassNames, generationSubmitClassName } from '@mahoshojo/ui-web/generation-actions';
import { DesktopArenaSession, arenaReadinessMessage, arenaReferenceCount, inheritedArenaAdjudication, type ArenaDraft } from '../features/arena/session';
import { addArenaCombatants, arenaItemName, fetchArenaPreset, moveArenaItem, parseArenaJson, parseArenaScenario, readArenaFile } from '../features/arena/input';
import { readSublimationHistorySource, type SublimationHistorySource } from '../features/sublimation/history-source';
import { useDesktopAiConfig } from '../features/ai-config/use-desktop-ai-config';
import { resolveDesktopAiTarget } from '../features/ai-config/desktop-ai-config';
import { DesktopAiProviderPanel } from '../features/ai-config/desktop-ai-provider-panel';
import { useDesktopCloudSession } from '../features/account/use-desktop-cloud-session';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import { useDesktopCardLibraryHost } from '../platform/card-library-host';
import { IpcLocalCardRepository } from '../platform/local-card-bridge';
import { downloadTextFile } from '../platform/download-text-file';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';
import { useLeaveGuard } from './useLeaveGuard';

const secondary = generationActionClassNames.secondary;
const limits = ARENA_CANONICAL_CAPABILITIES;
type LibraryPurpose = 'character' | 'scenario' | 'material';
const reject = () => { throw new Error('当前页面未开放此能力。'); };

/** Desktop owns session/IO only. The actual Web controls, layout and report are shared. */
export function DesktopBattleForm({ session, repository }: { session: DesktopArenaSession; repository: IpcLocalCardRepository }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { state: aiState, store: aiStore } = useDesktopAiConfig();
  const { state: cloudState, store: cloudStore } = useDesktopCloudSession();
  const target = resolveDesktopAiTarget(aiState.selection, aiState.profiles, aiState.generationOverrides, aiState.modelsByProfileId, aiState.presetsByProviderId);
  const router = useRouter(); const { openFixed, openContent } = useExternalLinks(); const libraryHost = useDesktopCardLibraryHost();
  const [library, setLibrary] = useState<LibraryPurpose | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [presetPage, setPresetPage] = useState(1);
  const [languages, setLanguages] = useState([{ code: 'zh-CN', name: '简体中文' }]);
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySource, setHistorySource] = useState<SublimationHistorySource | null>(null);
  const [historySort, setHistorySort] = useState<NarrativeHistorySort>('created_desc');
  const [historyRevision, setHistoryRevision] = useState(0);
  const ownerEpoch = useRef(0), preparing = useRef(false), historyLoading = useRef(false);
  const dirtyControls = useRef({ roster: false, rosterTeam: false, scenario: false, material: false, ai: false });
  const onRosterDirty = useCallback((dirty: boolean) => { dirtyControls.current.roster = dirty; }, []);
  const onRosterTeamDirty = useCallback((dirty: boolean) => { dirtyControls.current.rosterTeam = dirty; }, []);
  const onScenarioDirty = useCallback((dirty: boolean) => { dirtyControls.current.scenario = dirty; }, []);
  const onMaterialDirty = useCallback((dirty: boolean) => { dirtyControls.current.material = dirty; }, []);
  const onAiDirty = useCallback((dirty: boolean) => { dirtyControls.current.ai = dirty; }, []);
  const draft = state.draft;
  const readinessMessage = useMemo(() => arenaReadinessMessage(draft), [draft]);
  const referenceCount = useMemo(() => arenaReferenceCount(draft), [draft]);
  const inheritedAdjudication = useMemo(() => inheritedArenaAdjudication(draft), [draft]);
  // Do not include credential presence probes or preparing-state changes: they do not change target identity.
  const scope = JSON.stringify({ account: cloudState.account?.userId ?? null, selection: aiState.selection,
    profiles: aiState.profiles, models: aiState.modelsByProfileId, presets: aiState.presetsByProviderId, overrides: aiState.generationOverrides });
  useLayoutEffect(() => { ownerEpoch.current += 1; session.setScope(scope); aiStore.cancelPreparingGeneration(); setError(null); setImportWarnings([]); }, [scope, session, aiStore]);
  useEffect(() => () => { ownerEpoch.current += 1; aiStore.cancelPreparingGeneration(); }, [aiStore]);
  const guard = useLeaveGuard(
    () => session.isBusy() || preparing.current || aiStore.isPreparingGeneration() || aiStore.getSnapshot().savingConnection || aiStore.getSnapshot().savingCredential || aiStore.getSnapshot().deletingConnection || historyLoading.current || session.hasUnsavedDraft() || Object.values(dirtyControls.current).some(Boolean),
    '当前生成、读取或保存尚未完成，或仍有未保存的内容。',
    '窗口关闭保护初始化失败，生成、导入与保存暂不可用，请重新打开页面。',
    () => {
      if (session.getSnapshot().saving || session.getSnapshot().importing || preparing.current || aiStore.isPreparingGeneration() || aiStore.getSnapshot().savingConnection || aiStore.getSnapshot().savingCredential || aiStore.getSnapshot().deletingConnection || historyLoading.current) return false;
      if (!window.confirm('确认离开？正在生成的请求会取消，未保存的输入或原文可能丢失。')) return false;
      session.cancel(); return true;
    },
  );
  const busy = state.phase === 'generating' || state.saving || state.importing || aiState.generationActive;
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
    if (!guard.ready || preparing.current || aiState.generationActive) throw new Error('请等待当前操作完成。');
    const epoch = ownerEpoch.current; setError(null); try { await session.importInput(load); } catch (cause) { if (epoch === ownerEpoch.current) reportError(cause); throw cause; }
  };
  const parseCharacters = async (text: string, warnings: string[]) => {
    if (new TextEncoder().encode(text).byteLength > 12 * 1024 * 1024) throw new Error('输入超过 Arena 12 MiB 上限。');
    const parsed = await parseCombatantsFromText(text, { existingCount: 0, maxCombatants: limits.maxCombatants, onWarn: (warning) => warnings.push(warning) });
    return parsed.map((item) => ({ ...item, isValid: false, isPreset: false }));
  };
  const applyCharacters = (current: ArenaDraft, items: ArenaDraft['combatants'], warnings: string[]) => { const next = addArenaCombatants(current, items); setImportWarnings(warnings); return next; };
  const pasteCharacters = (text: string) => performImport(async () => { const warnings: string[] = []; const items = await parseCharacters(text, warnings); return (current) => applyCharacters(current, items, warnings); });
  const uploadCharacters = (files: FileList) => performImport(async (signal) => {
    const warnings: string[] = []; const items = (await Promise.all(Array.from(files).map(async (file) => parseCharacters(await readArenaFile(file, signal), warnings)))).flat();
    return (current) => applyCharacters(current, items, warnings);
  });
  const togglePreset = (filename: string) => {
    if (disabled) return;
    if (draft.combatants.some((item) => item.isPreset && item.filename === filename)) { update({ combatants: draft.combatants.filter((item) => !(item.isPreset && item.filename === filename)) }); return; }
    void performImport(async (signal) => { const warnings: string[] = []; const items = await parseCharacters(await fetchArenaPreset('character', filename, signal), warnings);
      return (current) => applyCharacters(current, items.map((item) => ({ ...item, isPreset: true, filename })), warnings); }).catch(() => undefined);
  };
  const loadScenario = (read: (signal: AbortSignal) => Promise<string>, filename: string | null = null) => performImport(async (signal) => {
    const content = parseArenaScenario(await read(signal)); return (current) => ({ ...current, scenario: { content, fileName: filename }, scenarioDisplayName: arenaItemName(content) });
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
    const action = library === 'character' ? pasteCharacters(text) : library === 'scenario' ? loadScenario(async () => text) : loadMaterials(async () => [{ text, filename: null }]);
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
      removeRow: (key) => update({ combatants: draft.combatants.filter((_, index) => index !== Number(key)) }),
      setGuidance: (key, value) => update({ combatants: draft.combatants.map((item, index) => index === Number(key) ? { ...item, characterGuidance: value } : item) }),
      addPlaceholder: reject, clearRoster: () => update({ combatants: [] }),
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
    auxScenarios: [], auxBudgetLine: null, auxBudgetExhausted: false, presets: SCENARIO_PRESET_LIST, presetsLoading: false, presetsError: null,
    selectedPresetFilenames: draft.scenario.fileName ? [draft.scenario.fileName] : [], loadingPresetFilename: null,
    capabilities: { browseMain: true, randomMatchMain: false, clearMain: true, uploadMain: true, pasteMain: true, presetRefs: true,
      auxSection: false, addAux: false, browseAux: false, randomMatchAux: false, uploadAux: false, pasteAux: false, reorderAux: false, removeAux: false, clearAux: false },
    actions: { openMainModal: () => openLibrary('scenario'), randomMatchMain: reject, clearMain: () => update({ scenario: { content: null, fileName: null }, scenarioDisplayName: null }),
      uploadMain: (file) => loadScenario((signal) => readArenaFile(file, signal), file.name), pasteMain: (text) => loadScenario(async () => text),
      togglePreset: (filename) => { if (draft.scenario.fileName === filename) { update({ scenario: { content: null, fileName: null }, scenarioDisplayName: null }); return; } void loadScenario((signal) => fetchArenaPreset('scenario', filename, signal), filename).catch(() => undefined); },
      openAuxModal: reject, randomMatchAux: reject, uploadAux: async () => reject(), pasteAux: async () => reject(), moveAux: reject, removeAux: reject, clearAux: reject },
  };
  const generate = () => {
    if (disabled || preparing.current || session.isBusy()) return;
    if (target.location !== 'client' || !target.mode || !target.modelId || !target.providerTarget || target.unavailableReason) { setError('此页面的服务器生成暂不可用，请选择受支持的客户端连接。'); return; }
    if (state.rawText && !window.confirm('开始新生成将替换当前结果，请先保存或完整导出。继续？')) return;
    const snapshot = structuredClone(session.getSnapshot().draft); const frozen = { ...snapshot, customStoryLength: normalizeCustomStoryLength(snapshot.customStoryLength) };
    const readiness = arenaReadinessMessage(frozen); if (readiness) { setError(readiness); return; }
    const epoch = ownerEpoch.current; preparing.current = true; setError(null);
    void aiStore.withPreparedGeneration(async (prepared) => {
      if (epoch !== ownerEpoch.current || prepared.location !== 'client' || !prepared.mode || !prepared.modelId || !prepared.providerTarget) return;
      await session.generate({ invoke, profileId: prepared.profile?.id ?? '', providerTarget: prepared.providerTarget }, frozen,
        { mode: prepared.mode, generationMode: frozen.generationMode, modelId: prepared.modelId,
          temperature: prepared.generationOverrides?.temperature, maxOutputTokens: prepared.generationOverrides?.maxOutputTokens });
    }).catch((cause: unknown) => { if (epoch === ownerEpoch.current) reportError(cause); }).finally(() => { preparing.current = false; });
  };
  const reasoning = state.reasoning ? { status: state.phase === 'generating' ? 'thinking' as const : 'done' as const, source: 'provider' as const, text: state.reasoning } : null;
  const download = (filename: string, text: string, mimeType: string) => { try { downloadTextFile(filename, text, mimeType); } catch (cause) { reportError(cause); } };
  const exportAll = () => download('arena-complete.json', session.exportDocument(), 'application/json');
  const result = (state.rawText || state.reasoning || state.report) ? <section ref={resultRef} className="mt-6 space-y-4" aria-label="战报结果">
    {state.report && state.activeGenerationMode !== 'stream' ? <BattleReportCard report={{ ...state.report, aiReasoning: reasoning }} mode={state.report.mode} ports={{ mediaPolicy: DENY_EXTERNAL_MEDIA, onNavigateExternal: openContent, downloadMarkdown: (text: string, filename: string) => download(filename, text, 'text/markdown;charset=utf-8') }} />
      : state.markdown && state.activeGenerationMode === 'stream' ? <StreamingBattleReportCard aiReasoning={reasoning} reporterInfo={state.report?.reporterInfo} adjudicationResults={state.generation?.adjudicationResults} content={state.markdown} mode={state.generation?.input.battleMode ?? draft.battleMode} isStreaming={state.phase === 'generating'} onStopGeneration={() => session.cancel()} ports={{ mediaPolicy: DENY_EXTERNAL_MEDIA, onNavigateExternal: openContent, downloadMarkdown: (text: string, filename: string) => download(filename, text, 'text/markdown;charset=utf-8') }} /> : null}
    {!(state.markdown && state.activeGenerationMode === 'stream') && !state.report && reasoning ? <AiReasoningPanel reasoning={reasoning} /> : null}
    <details><summary>完整原始输出（含元数据）</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">{state.rawText}</pre></details>
    <div className="flex flex-wrap gap-3">
      <button className={secondary} type="button" onClick={() => { void exportAll(); }}>完整导出 JSON</button>
      {state.candidates?.characterEffects.length ? <button className={secondary} type="button" disabled={disabled} onClick={() => { void session.save('characters'); }}>另存战后角色副本</button> : null}
      {draft.narrativeHistoryEntries.length ? <button className={secondary} type="button" disabled={disabled} onClick={() => { void session.save('history'); }}>保存叙事历史到本地库</button> : null}
    </div>
    {state.saveStatus === 'saved' ? <p role="status">已保存到本地库，可在卡库重新打开。</p> : null}
    {state.saveError ? <p role="alert">{state.saveError}</p> : null}
  </section> : null;
  return <>
    <BattleLitePageView isGenerating={disabled} presetCountLabel={String(draft.combatants.filter((item) => item.isPreset).length)} combatantCountLabel={`${draft.combatants.length}/${limits.maxCombatants}`}
      showScenario={draft.battleMode === 'scenario'} hasScenario={!!draft.scenario.content} materialCount={draft.materials.length} referenceItemCount={referenceCount} maxReferenceItems={limits.maxReferenceItemsSanity}
      copy={{ databaseTitle: '📚 角色库', databaseDescription: '选择本地卡、在线公开卡或已缓存副本', modeDescription: '不同模式决定故事风格', storyOptionsDescription: '设置故事方向、历史读写和客户端 AI' }}
      slots={{
        header: <BattleLiteHeaderView logo={<ThemeImage lightSrc="/arena-black.svg" darkSrc="/arena-white.svg" width={300} height={84} alt="魔法少女竞技场" />} description="选择角色，生成属于他们的故事。" helper="桌面简洁版 · 本机工作副本 · 客户端 Direct" />,
        rankingLinks: null, pageLinks: null,
        presets: <PresetGridPicker title="预设角色" presets={PRESET_LIST} currentPage={presetPage} onPageChange={setPresetPage} disabled={disabled} maxSelected={limits.maxCombatants} selectedCountOverride={draft.combatants.length} selectedFilenames={draft.combatants.filter((item) => item.isPreset).map((item) => item.filename)} onToggle={(preset) => togglePreset(preset.filename)} />,
        database: <button type="button" className={secondary} disabled={disabled} onClick={() => openLibrary('character')}>选择本地 / 公开角色</button>,
        localImport: <ArenaRosterImportPanel disabled={disabled} limitReached={draft.combatants.length >= limits.maxCombatants} onUpload={uploadCharacters} onPaste={pasteCharacters} onDirtyChange={onRosterDirty} />,
        roster: <ArenaRosterSection model={roster} onDirtyChange={onRosterTeamDirty} />,
        mode: <BattleModeSelector value={draft.battleMode} onChange={(battleMode) => update({ battleMode })} disabled={disabled} />,
        scenario: <ArenaScenarioSection model={scenario} presentation={{ variant: 'lite', hasMain: !!draft.scenario.content, summary: draft.scenarioDisplayName ?? '未选择' }} onDirtyChange={onScenarioDirty} />,
        materials: <ArenaMaterialSection onDirtyChange={onMaterialDirty} model={{ disabled, items: materials.map((item, index) => ({ key: String(index), name: item.name, sourceLabel: item.sourceType, fileName: item.fileName })),
          notice: '素材仅作为参考；本地与缓存来源不代表服务器认证。', hasReferenceCapacity: referenceCount < limits.maxReferenceItemsSanity,
          capabilities: { browseOnline: true, clearAll: true, upload: true, paste: true, reorder: true },
          actions: { openModal: () => openLibrary('material'), clearAll: () => update({ materials: [] }),
            upload: (files) => loadMaterials(async (signal) => Promise.all(Array.from(files ?? []).map(async (file) => ({ text: await readArenaFile(file, signal), filename: file.name })))),
            paste: (text) => loadMaterials(async () => [{ text, filename: null }]), move: (from, to) => update({ materials: moveArenaItem(draft.materials, from, to) }), remove: (key) => update({ materials: draft.materials.filter((_, index) => String(index) !== key) }) } }} />,
        storyOptions: <>
          <StoryOptionsPanel isGenerating={disabled} enableUserGuidance languages={languages} userGuidance={draft.settings.userGuidance} onUserGuidanceChange={(userGuidance) => update({ settings: { ...draft.settings, userGuidance } })}
            storyLength={draft.storyLength as StoryLengthOption} onStoryLengthChange={(storyLength) => update({ storyLength })} customStoryLength={draft.customStoryLength} onCustomStoryLengthChange={(customStoryLength) => update({ customStoryLength })} selectedLanguage={draft.selectedLanguage} onSelectedLanguageChange={(selectedLanguage) => update({ selectedLanguage })} />
          <ArenaDataSettingsPanel value={draft.settings} onChange={(patch) => update({ settings: { ...draft.settings, ...patch } })} disabled={disabled} footerNote={<p className="text-xs">设置与角色工作副本保存在本机草稿；原始库卡保持不变。</p>} />
          <NarrativeHistorySettings value={draft.settings} onChange={(patch) => update({ settings: { ...draft.settings, ...patch } })} disabled={disabled} persistenceNote="完成后追加到本机活动草稿；保存到本地库需单独操作。超限或写入失败时请完整导出。" readingNote="引用本地历史仅用于提示词，不改写原卡。" />
          <button type="button" className={secondary} disabled={disabled} onClick={() => setHistoryOpen(true)}>引用本地叙事历史</button>
          <p className="text-xs">已引用 {draft.historyReferences.length} 条；活动历史 {draft.narrativeHistoryEntries.length} 条</p>
          <p className="text-xs">角色与主情景继承 {inheritedAdjudication.events.length} 个随机判定，每次生成只在本机掷骰一次，非服务器权威；素材内判定不执行。</p>
          {inheritedAdjudication.skippedLegacy ? <p role="status">{inheritedAdjudication.skippedLegacy} 个旧版随机事件格式不受支持，保留原字段但不执行。</p> : null}
          <fieldset disabled={!guard.ready} className="min-w-0"><DesktopAiProviderPanel generationMode={draft.generationMode} onDirtyChange={onAiDirty} showConnectionTest={false} copy={{ serverOutput: { stream: '', nonStream: '' }, emptyProfilesHint: '请配置客户端连接。', serverFootnote: '服务器生成暂不可用。', payloadNoun: '角色与故事设定' }} /></fieldset>
          {target.location === 'server' ? <p role="status">此页面的服务器生成暂不可用。请选择客户端及受支持的预设或自定义连接。</p> : null}
        </>,
        generationMode: <GenerationModeSwitcher value={draft.generationMode} disabled={disabled} onChange={(generationMode) => update({ generationMode })} helper="非流式输出结构化战报；流式逐步显示 Markdown。" />,
        actions: <>
          {state.pendingRestore ? <p role="status">发现本机草稿。<button type="button" className={secondary} onClick={() => session.restoreDraft()}>恢复草稿</button><button type="button" className={secondary} onClick={() => { if (window.confirm('清除旧草稿？此操作不会删除本地库。')) session.discardDraft(); }}>清除草稿</button></p> : null}
          <button type="button" className={generationSubmitClassName} disabled={disabled || target.location !== 'client' || !!target.unavailableReason || !!readinessMessage} onClick={generate}>生成战报</button>
          {busy ? <button type="button" className={secondary} disabled={state.saving} onClick={() => { aiStore.cancelPreparingGeneration(); ownerEpoch.current += 1; session.cancel(); }}>取消生成</button> : null}
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
      }} />
    <CardLibraryModal host={libraryHost} isOpen={library !== null} onClose={() => setLibrary(null)} onSelectCard={chooseCard} selectedType={library === 'material' ? 'all' : library ?? 'character'} allowedTypes={library === 'material' ? undefined : [library ?? 'character']} initialTab="local" visibleTabs={['local', 'public']} allowDeckImport={false} titleOverride="选择本地或公开缓存副本" />
    <NarrativeHistoryPicker isOpen={historyOpen} onClose={() => setHistoryOpen(false)} entries={historySource?.entries ?? []} lastUpdatedAt={historySource?.lastUpdatedAt ?? null} sort={historySort} onSort={setHistorySort}
      readStatus={historySource?.status ?? 'loading'} formatDateTime={(value) => value} sourceHint={historySource?.message ?? '本地库只读引用，源记录保持不变。'}
      onConfirm={(entries) => { update({ historyReferences: entries }); setHistoryOpen(false); }} />
    {historyOpen && historySource?.status === 'error' ? <button type="button" onClick={() => setHistoryRevision((value) => value + 1)}>重试读取历史</button> : null}
  </>;
}

export function DesktopBattle() {
  const repository = useMemo(() => new IpcLocalCardRepository((command, args) => invoke(command, args as never)), []);
  const [session, setSession] = useState<DesktopArenaSession | null>(null);
  useEffect(() => { const owner = new DesktopArenaSession({ repository, storage: window.localStorage }); setSession(owner); return () => owner.dispose(); }, [repository]);
  return session ? <DesktopBattleForm session={session} repository={repository} /> : <p role="status">正在读取本机草稿…</p>;
}
