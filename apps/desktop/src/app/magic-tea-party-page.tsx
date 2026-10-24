import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { ChevronRight, ChevronUp, Download, GitMerge, RefreshCw, Save, Search, Trash2, X } from 'lucide-react';
import { Button, CardLibraryModal, type CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import { MarkdownBlock } from '@mahoshojo/ui-web/markdown';
import {
  useSessionSidebarPreference, MagicTeaPartyPageView, MagicTeaPartyHero, MagicTeaPartySessionList, MagicTeaPartySessionSetupPanel,
  MagicTeaPartyOutputPreferencesPanel, MagicTeaPartyTransferPanel, MagicTeaPartyChatTimeline,
  MagicTeaPartyChatComposer, MagicTeaPartyChatMessage, MagicTeaPartySummaryBody, MagicTeaPartyRoleEditor, MagicTeaPartyPresetPicker,
} from '@mahoshojo/ui-web/magic-tea-party';
import { applyMagicTeaPartyRoleDraft, sameMagicTeaPartyRoleSource } from '@mahoshojo/domain/magic-tea-party/role-editor';
import { projectMagicTeaPartyPreset, type MagicTeaPartyPresetId } from '@mahoshojo/ai-core/magic-tea-party';
import { DesktopTeaSession, type DesktopTeaIntent, type TeaCleanupSelection } from '../features/magic-tea-party/session';
import { TEA_PREFERENCES, teaMessageView, teaSessionView } from '../features/magic-tea-party/direct';
import { parseDesktopTeaRoles, parseDesktopTeaScenarios } from '../features/magic-tea-party/source';
import { createIpcTeaNativePort } from '../platform/magic-tea-party-native';
import { downloadTextFile } from '../platform/download-text-file';
import { useDesktopCardLibraryHost } from '../platform/card-library-host';
import { useDesktopAiConfig } from '../features/ai-config/use-desktop-ai-config';
import { DesktopAiProviderPanel } from '../features/ai-config/desktop-ai-provider-panel';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import { useLeaveGuard } from './useLeaveGuard';

export default function MagicTeaPartyPage() {
  const [owner] = useState(() => new DesktopTeaSession(createIpcTeaNativePort()));
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const { store: aiStore } = useDesktopAiConfig();
  const libraryHost = useDesktopCardLibraryHost(); const { openContent } = useExternalLinks();
  const [library, setLibrary] = useState<'character' | 'scenario' | null>(null);
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [outputView, setOutputView] = useState<'raw' | 'rendered'>('rendered');
  const { pinnedCollapsed, setPinnedCollapsed, recentCollapsed, setRecentCollapsed } = useSessionSidebarPreference();
  const [importBusy, setImportBusy] = useState(false); const importRunning = useRef(false);
  const [providerDirty, setProviderDirty] = useState(false);
  const preparing = useRef(false); const [preparingView, setPreparingView] = useState(false); const pasteDirty = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; incarnation: number; instance: string; revision: number } | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [cleanup, setCleanup] = useState<TeaCleanupSelection | null>(null);
  const [presetPreview, setPresetPreview] = useState<{ id: MagicTeaPartyPresetId; record: NonNullable<typeof state.record>; incarnation: number } | null>(null);
  useEffect(() => { setSelectedSessions([]); setCleanup(null); }, [state.directory, state.incarnation]);
  const mounted = useRef(true);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleHasDraft, setRoleHasDraft] = useState(false);
  const roleDirty = useRef(false); const roleSaving = useRef(false);
  const roleTrigger = useRef<HTMLButtonElement | null>(null); const roleHeading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { if (editingRoleId) roleHeading.current?.focus(); }, [editingRoleId]);
  const guard = useLeaveGuard(() => owner.isBusy() || importRunning.current || providerDirty || preparing.current || pasteDirty.current || roleDirty.current || roleSaving.current,
    '茶会仍有生成、未保存输入或待核对保存，请先停止并保存，或明确放弃易失结果后离开');
  useEffect(() => {
    mounted.current = true; owner.activate(); void owner.refreshDirectory();
    return () => { mounted.current = false; owner.dispose(); aiStore.cancelPreparingGeneration(); };
  }, [owner, aiStore]);
  const session = state.record ? teaSessionView({ ...state.record.session, ...(state.titleDraft === null ? {} : { title: state.titleDraft }),
    settings: { ...state.record.session.settings, ...(state.nameDraft === null ? {} : { userDisplayName: state.nameDraft }) } }) : null;
  const editingRole = session?.roles.find(role => role.id === editingRoleId) ?? null;
  const editDisabled = !guard.ready || state.busy || state.pending !== 'none' || importBusy || preparingView;
  const disabled = editDisabled || state.editingMessageId !== null || state.mergePreview !== null;
  const run = (work: () => Promise<unknown>) => { void work().catch(error => owner.report(error)); };
  const renderScope = `${state.incarnation}:${state.record?.session.id ?? ''}`;
  const currentScope = () => `${owner.getSnapshot().incarnation}:${owner.getSnapshot().record?.session.id ?? ''}`;
  const importCards = async (text: string, kind: 'character' | 'scenario'): Promise<boolean> => {
    if (disabled || preparing.current || !session || currentScope() !== renderScope) return false;
    try {
      if (kind === 'character') return await owner.update({ roles: [...session.roles, ...parseDesktopTeaRoles(text, () => crypto.randomUUID())] });
      const scenarios = parseDesktopTeaScenarios(text, () => crypto.randomUUID());
      return await owner.update(session.scenario ? { auxScenarios: [...(session.auxScenarios ?? []), ...scenarios] }
        : { scenario: scenarios[0], auxScenarios: [...(session.auxScenarios ?? []), ...scenarios.slice(1)] });
    } catch (error) { owner.report(error); return false; }
  };
  const importFiles = async (files: File[], kind: 'character' | 'scenario') => {
    if (disabled || importRunning.current || !session) return;
    const scope = currentScope(); importRunning.current = true; setImportBusy(true);
    try {
      const values: unknown[] = [];
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.json') || file.size > 4 * 1024 * 1024) throw new Error('此阶段只导入 4 MiB 内的角色或情景 JSON，原文件保持不变');
        const value: unknown = JSON.parse(await file.text());
        if (!mounted.current || currentScope() !== scope) return;
        if (Array.isArray(value)) values.push(...value); else values.push(value);
      }
      if (mounted.current && currentScope() === scope) await importCards(JSON.stringify(values), kind);
    } catch (error) { if (mounted.current && currentScope() === scope) owner.report(error); }
    finally { importRunning.current = false; if (mounted.current) setImportBusy(false); }
  };
  const chooseCard = (_value: unknown, context: CardLibrarySelectionContext) => {
    if (disabled || !library || !context.rawSourceData) return;
    const kind = library; setLibrary(null); run(() => importCards(JSON.stringify(context.rawSourceData), kind));
  };
  const importArchive = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || disabled || importRunning.current) return;
    const scope = currentScope(); importRunning.current = true; setImportBusy(true);
    run(async () => {
      try {
        if (!/\.(json|jsonl)$/iu.test(file.name) || file.size > 64 * 1024 * 1024) throw new Error('请选择 64 MiB 内的 JSON / JSONL；ZIP 和媒体归档暂不支持');
        const text = await file.text();
        if (mounted.current && currentScope() === scope) await owner.importText(text, file.name.toLowerCase().endsWith('.jsonl') ? 'jsonl' : 'json', warnings => window.confirm(`${warnings.join('\n')}\n仍按这些已说明的边界导入？`));
      } finally { importRunning.current = false; if (mounted.current) setImportBusy(false); }
    });
  };
  const exportArchive = (format: 'json' | 'jsonl' | 'archive') => run(async () => {
    const text = await owner.export(format);
    if (mounted.current) downloadTextFile(format === 'archive' ? 'magic-tea-party.archive.json' : `magic-tea-party.${format}`, text, format === 'jsonl' ? 'application/x-ndjson' : 'application/json');
  });
  const start = (generationIntent: DesktopTeaIntent) => {
    if (disabled || preparing.current || currentScope() !== renderScope) return;
    const scope = currentScope(); const intent = owner.getSnapshot();
    preparing.current = true; setPreparingView(true);
    run(async () => { try { await aiStore.withPreparedGeneration(async target => {
      const now = owner.getSnapshot();
      if (!mounted.current || currentScope() !== scope || now.record !== intent.record || now.input !== intent.input || now.titleDraft !== intent.titleDraft || now.nameDraft !== intent.nameDraft || now.summaryDraft !== intent.summaryDraft) return;
      const snapshot = aiStore.getSnapshot();
      const credentialIntent = snapshot.credentialDraftRevision;
      const selection = snapshot.selection; const profiles = snapshot.profiles;
      await owner.start(target, { invoke, profileId: target.profile?.id ?? '', providerTarget: target.providerTarget }, () => mounted.current && currentScope() === scope
        && aiStore.getSnapshot().credentialDraftRevision === credentialIntent && aiStore.getSnapshot().selection === selection
        && aiStore.getSnapshot().profiles === profiles, generationIntent);
    }); } finally { preparing.current = false; if (mounted.current) setPreparingView(false); } });
  };
  const deleteActive = (id: string) => {
    if (disabled) return;
    if (state.record?.session.id !== id) { owner.report(new Error('请先打开要删除的会话，再确认删除')); return; }
    const incarnation = state.incarnation;
    run(async () => {
      if (!await owner.saveDraft()) return;
      const current = owner.getSnapshot();
      if (!mounted.current || current.incarnation !== incarnation || current.record?.session.id !== id || owner.isBusy()) return;
      setConfirmDelete({ id, incarnation, instance: current.record.instance, revision: current.record.revision });
    });
  };
  const confirmed = confirmDelete && confirmDelete.id === state.record?.session.id && confirmDelete.incarnation === state.incarnation
    && confirmDelete.instance === state.record.instance && confirmDelete.revision === state.record.revision;
  return <MagicTeaPartyPageView
    hero={<MagicTeaPartyHero globalError={state.error ?? guard.message} description="本地文本茶会 · 角色与情景、Direct 发送 / 停止 / 续写、事务保存与 JSON / JSONL 导入导出" homeLink={<Link to="/" className="text-sm text-pink-700 hover:underline">返回首页</Link>} />}
    sidebar={<aside className="space-y-4">
      <MagicTeaPartyPresetPicker selectedPresetId={session?.settings.presetId} disabled={disabled || providerDirty || roleHasDraft}
        onCreateSession={id => { if (!disabled && !providerDirty && !roleDirty.current && !pasteDirty.current) run(() => owner.create(id)); }}
        onSelectPreset={state.record ? id => { if (!disabled && !providerDirty && !roleDirty.current && !pasteDirty.current && state.record) setPresetPreview({ id, record: state.record, incarnation: state.incarnation }); } : undefined}
        preview={presetPreview && presetPreview.record === state.record && presetPreview.incarnation === state.incarnation
          ? projectMagicTeaPartyPreset(presetPreview.record.session, presetPreview.id) : null}
        onCancelPreset={() => setPresetPreview(null)} onConfirmPreset={() => {
          if (disabled || providerDirty || roleDirty.current || pasteDirty.current || !presetPreview) return;
          const preview = presetPreview; setPresetPreview(null); run(() => owner.applyPreset(preview.id, preview.record, preview.incarnation));
        }} />
      <MagicTeaPartySessionList sessions={state.directory.map(head => ({ id: head.id, title: head.title, updatedAt: head.updatedAt, pinnedAt: head.pinnedAt,
        roles: head.roleNames.map(name => ({ name })), ...(head.scenarioTitle ? { scenario: { title: head.scenarioTitle } } : {}) }))}
        activeSessionId={session?.id ?? null} onCreateSession={() => { if (!providerDirty && !roleDirty.current && !pasteDirty.current) run(() => owner.create()); }} onSelectSession={id => { if (!providerDirty && !roleDirty.current && !pasteDirty.current) run(() => owner.select(id)); }}
        onDeleteSession={deleteActive} onToggleSessionPin={id => { const head = state.directory.find(row => row.id === id); if (head) run(() => owner.setPin(id, head.pinnedAt === 0)); }}
        selectedSessionIds={selectedSessions} onSelectionChange={ids => { setSelectedSessions(ids); setCleanup(null); }}
        onSelectionViewChange={() => { setSelectedSessions([]); setCleanup(null); }} pinnedCollapsed={pinnedCollapsed} recentCollapsed={recentCollapsed}
        onPinnedCollapsedChange={setPinnedCollapsed} onRecentCollapsedChange={setRecentCollapsed} busy={disabled} listScope="loaded"
        pagination={<div className="space-y-3">
          <p className="text-xs text-(--app-text-muted)">清理仅限当前已加载的最多 50 个会话，默认保护置顶及当前会话。不自动清理，也不调整置顶拖拽顺序。</p>
          <Button size="sm" disabled={disabled || !selectedSessions.length} onClick={() => setCleanup(owner.prepareCleanup(selectedSessions))}>预览清理 {selectedSessions.length} 个会话</Button>
          {cleanup && cleanup.directory === state.directory && cleanup.incarnation === state.incarnation ? <div role="alert" className="space-y-2 rounded-lg border border-red-200 p-3 text-sm">
            <p>将永久删除以下 {cleanup.targets.length} 个会话及全部消息，不能撤销；恢复需要已有整库备份：</p>
            <ul>{cleanup.targets.map((target, index) => <li key={target.sessionId}>{cleanup.titles[index]}（{target.sessionId}）</li>)}</ul>
            <Button variant="danger" size="sm" disabled={disabled} onClick={() => { const selection = cleanup; setCleanup(null); setSelectedSessions([]); run(() => owner.deleteSelected(selection)); }}>确认清理所选会话</Button>
            <Button size="sm" onClick={() => setCleanup(null)}>取消清理</Button>
          </div> : null}
          <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={disabled} onClick={() => run(() => owner.refreshDirectory())}><RefreshCw className="size-4 shrink-0" aria-hidden="true" />刷新首页</Button>
          <Button size="sm" disabled={disabled || !state.directoryCursor} onClick={() => run(() => owner.refreshDirectory(true))}><ChevronRight className="size-4 shrink-0" aria-hidden="true" />下一批会话</Button>
        </div></div>} />
      <MagicTeaPartyTransferPanel activeTitle={session?.title ?? null} busy={disabled} error={null} notice={state.notice}
        onImportFile={importArchive} onExportSession={() => exportArchive('json')} onExportSessionJsonl={() => exportArchive('jsonl')} onExportArchive={() => exportArchive('archive')} />
      <fieldset disabled={disabled} className="min-w-0"><DesktopAiProviderPanel generationMode="stream" showConnectionTest={false} onDirtyChange={setProviderDirty}
        copy={{ serverOutput: { stream: '茶会使用客户端连接', nonStream: '茶会使用客户端连接' }, emptyProfilesHint: '选择客户端 Direct 连接', serverFootnote: '文本茶会尚不支持服务器执行', payloadNoun: '茶会正文' }} /></fieldset>
      <div className="text-xs text-(--app-text-muted)">请主动选择客户端执行位置。生成选项会调用当前模型并消耗 Token；点选行动会直接发送，保留输入框草稿。手动生成摘要也会消耗 Token；自动摘要需在当前会话单独开启，不自动补充更新草案或选项请求。媒体附件导入会在写入前拒绝。卡片图片与链接只作资料保存，不自动下载。Tavern 额外系统提示等仅保留原件，沿现有通用卡正文投影。</div>
      <MagicTeaPartyOutputPreferencesPanel activeSession={session} preferences={TEA_PREFERENCES} disabled={disabled || !session}
        outputPlanSupported={false} choicesHint="控制同次 JSONL 输出；两种正文模式均可手动生成选项" onChange={patch => { if (currentScope() !== renderScope || disabled) return; if (patch.userDisplayName !== undefined) owner.stageName(patch.userDisplayName); else run(() => owner.updateSettings(patch)); }} />
    </aside>}
    setup={<MagicTeaPartySessionSetupPanel activeSession={session} importScope={currentScope()} disabled={disabled} onDirtyChange={value => { pasteDirty.current = value; }}
      roleFileAccept=".json" roleImportHint="粘贴或拖入角色 JSON；PNG 与媒体附件暂不支持"
      playerOptions={[{ value: '', label: session?.settings.userDisplayName || '旅人' }, ...(session?.roles ?? []).map(role => ({ value: role.id, label: role.name }))]}
      onOpenRoleModal={() => { if (!disabled) setLibrary('character'); }} onOpenScenarioModal={() => { if (!disabled) setLibrary('scenario'); }}
      onUploadRoles={event => run(() => importFiles(Array.from(event.target.files ?? []), 'character'))}
      onUploadScenarios={event => run(() => importFiles(Array.from(event.target.files ?? []), 'scenario'))}
      onDropRoles={files => run(() => importFiles(files, 'character'))} onDropScenarios={files => run(() => importFiles(files, 'scenario'))}
      onImportRolesText={text => importCards(text, 'character')} onImportScenariosText={text => importCards(text, 'scenario')}
      onEditRole={(id, trigger) => { if (!disabled) { roleTrigger.current = trigger; setEditingRoleId(id); } }}
      onUpdateRoles={roles => { if (currentScope() === renderScope && !disabled) run(() => owner.update({ roles })); }} onUpdateScenarios={(scenario, auxScenarios) => { if (currentScope() === renderScope && !disabled) run(() => owner.update({ scenario, auxScenarios })); }}
      onUpdatePlayerRole={playerRoleId => { if (currentScope() === renderScope && !disabled) run(() => owner.update({ playerRoleId })); }} onUpdateTitle={title => { if (currentScope() === renderScope && !disabled) owner.stageTitle(title); }}
      onLockTitle={() => run(() => owner.update({ titleMeta: { source: 'manual' } }))} onCreateSession={() => { if (!providerDirty && !roleDirty.current && !pasteDirty.current) run(() => owner.create()); }} />}
    beforeChat={<>
      {session?.forkedFrom ? <p className="break-all text-xs text-(--app-text-muted)">
        分支来源{session.branchLabel ? `（${session.branchLabel}）` : ''}：会话 {session.forkedFrom.sessionId} · 消息 {session.forkedFrom.messageId}。原会话与分支保持独立；可先审阅，再明确确认合并到原会话。
      </p> : null}
      {session?.forkedFrom ? <Button size="sm" disabled={disabled} onClick={() => {
        if (disabled || preparing.current || currentScope() !== renderScope) return;
        if (providerDirty || roleDirty.current || roleSaving.current || pasteDirty.current) { owner.report(new Error('请先保存或取消连接、角色和粘贴导入草稿，再审阅合并')); return; }
        run(owner.prepareMerge);
      }}><GitMerge className="size-4 shrink-0" aria-hidden="true" />审阅合并到原会话</Button> : null}
      {state.mergePreview ? <section aria-label="审阅分支合并" className="space-y-3 rounded-xl border border-(--app-border-strong) bg-(--app-surface) p-4 text-sm">
        <h2 className="font-semibold">合并到原会话前请核对</h2>
        <p className="break-all">来源分支：{state.mergePreview.sourceTitle}（{state.mergePreview.source.sessionId}）</p>
        <p className="break-all">目标原会话：{state.mergePreview.parentTitle}（{state.mergePreview.parent.sessionId}）</p>
        <p className="whitespace-pre-wrap break-all">原锚点：{state.mergePreview.anchorPreview}</p>
        <p className="whitespace-pre-wrap break-all">分支改写：{state.mergePreview.editedPreview}</p>
        <p>将从原锚点起替换 {state.mergePreview.replacedMessageCount} 条历史消息，并复制分支尾部 {state.mergePreview.copiedMessageCount} 条消息。旧历史仍保留并标为已替换，来源分支不变。受影响的摘要、旧行动选项和自动摘要进度会失效，不会调用模型。</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" disabled={editDisabled} onClick={() => {
            if (editDisabled || preparing.current || currentScope() !== renderScope || !state.mergePreview) return;
            if (providerDirty || roleDirty.current || roleSaving.current || pasteDirty.current) { owner.report(new Error('请先保存或取消连接、角色和粘贴导入草稿，再确认合并')); return; }
            const preview = state.mergePreview; run(() => owner.confirmMerge(preview));
          }}><GitMerge className="size-4 shrink-0" aria-hidden="true" />确认合并到原会话</Button>
          <Button size="sm" disabled={state.busy || state.pending !== 'none'} onClick={owner.cancelMerge}><X className="size-4 shrink-0" aria-hidden="true" />取消合并</Button>
        </div>
      </section> : null}
      {roleHasDraft && !editingRole ? <p role="status" className="text-sm text-(--app-text-muted)">有未保存的角色修改，重新打开对应角色可继续编辑。</p> : null}
      <section hidden={!editingRole && !roleHasDraft} className="rounded-xl border border-(--app-border-strong) bg-(--app-surface) p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 ref={roleHeading} tabIndex={-1} className="text-sm font-semibold text-(--app-text)">会话角色编辑</h2>
          <Button size="sm" disabled={state.busy} onClick={() => { setEditingRoleId(null); roleTrigger.current?.focus(); }}><ChevronUp className="size-4 shrink-0" aria-hidden="true" />收起角色编辑</Button></div>
        <MagicTeaPartyRoleEditor scope={JSON.stringify([session?.id, state.record?.instance])}
          role={editingRole} disabled={disabled} allowDiscardAll
          onDirtyChange={dirty => { roleDirty.current = dirty; setRoleHasDraft(dirty); }} onBusyChange={busy => { roleSaving.current = busy; }}
          onSave={async (source, draft) => {
            if (disabled || currentScope() !== renderScope) return null;
            const latest = owner.getSnapshot().record;
            const matches = latest?.session.roles.filter(item => item.id === source.id) ?? [];
            if (!latest || matches.length !== 1 || !sameMagicTeaPartyRoleSource(matches[0], source)) throw new Error('角色已变化，请保留草稿并重置到最新角色后再编辑。');
            const next = applyMagicTeaPartyRoleDraft(source, draft, new Date().toISOString());
            if (!await owner.update({ roles: latest.session.roles.map(item => item.id === source.id ? next : item) })) return null;
            const saved = owner.getSnapshot().record;
            const savedRoles = saved?.session.roles.filter(item => item.id === source.id) ?? [];
            if (currentScope() !== renderScope || !saved || saved.instance !== latest.instance || saved.revision !== latest.revision + 1 || savedRoles.length !== 1) {
              throw new Error('角色保存已确认，但重新读取未完成；草稿已保留，请刷新会话后核对。');
            }
            return savedRoles[0];
          }} />
      </section>
      <MagicTeaPartySummaryBody active={Boolean(session)} summary={state.summaryDraft ?? session?.summary ?? ''} updatedAt={session?.summaryMeta?.updatedAt}
        disabled={disabled} isSummarizing={state.generationKind === 'summary' && state.generating} hasMessages={state.messages.length > 0}
        editingDisabled={disabled && !state.isAutoSummarizing}
        error={state.messages.at(-1)?.meta?.kind === 'summary' ? state.messages.at(-1)?.error?.message ?? null : null}
        description="用于长对话压缩（保存在本机）。生成摘要会消耗额外 Token。后续剧情最多读取摘要前 10000 字，保存正文不截断。"
        collapsed={summaryCollapsed} onCollapsedChange={setSummaryCollapsed} onGenerate={() => start({ kind: 'summary' })}
        onStopSummary={owner.stop}
        autoSummaryEnabled={session?.settings.autoSummaryEnabled === true}
        onAutoSummaryEnabledChange={value => { if (!disabled && currentScope() === renderScope) run(() => owner.updateSettings({ autoSummaryEnabled: value })); }}
        onClear={() => { if (!disabled && currentScope() === renderScope) run(owner.clearSummary); }}
        onChange={value => { if ((!disabled || state.isAutoSummarizing) && (!preparing.current || state.isAutoSummarizing) && currentScope() === renderScope) owner.stageSummary(value); }}
        onSave={() => { if (!disabled && currentScope() === renderScope) run(owner.saveDraft); }} dirty={state.summaryDraft !== null}>
        {state.summaryDraft !== null ? <Button size="sm" onClick={() => downloadTextFile('magic-tea-party.unsaved-summary.txt', owner.unsavedSummaryText(), 'text/plain')}><Download className="size-4 shrink-0" aria-hidden="true" />导出未保存摘要</Button> : null}
      </MagicTeaPartySummaryBody>
      {confirmed ? <div role="alert" className="space-y-3 rounded-xl border border-(--app-border-strong) bg-(--app-surface) p-4 text-sm">确认删除当前会话及全部消息？整库备份是恢复来源。
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" size="sm" disabled={disabled} onClick={() => { const confirmation = confirmDelete; setConfirmDelete(null); if (confirmation) run(() => owner.delete(confirmation.incarnation, confirmation.id, confirmation.instance, confirmation.revision)); }}><Trash2 className="size-4 shrink-0" aria-hidden="true" />确认删除</Button>
          <Button size="sm" onClick={() => setConfirmDelete(null)}><X className="size-4 shrink-0" aria-hidden="true" />取消</Button>
        </div>
      </div> : null}
      {state.pending !== 'none' ? <div role="alert" className="space-y-3 rounded-xl border border-(--app-border-strong) bg-(--app-surface) p-4 text-sm">
        {state.pending === 'unknown' ? '保存回执未知：先核对原操作，不会重复调用模型。' : '有未保存结果，保留于当前页面。'}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={state.busy} onClick={() => run(owner.resolvePending)}><Search className="size-4 shrink-0" aria-hidden="true" />核对原保存</Button>
          <Button size="sm" disabled={state.busy || state.pending === 'unknown'} onClick={() => run(owner.retryPending)}><RefreshCw className="size-4 shrink-0" aria-hidden="true" />重试原保存</Button>
          <Button variant="danger" size="sm" disabled={state.busy || state.pending === 'unknown'} onClick={() => { if (window.confirm('确认放弃当前易失结果？已提交的数据库内容不会删除。')) run(owner.abandonPending); }}><Trash2 className="size-4 shrink-0" aria-hidden="true" />明确放弃易失结果</Button>
          <Button size="sm" onClick={() => downloadTextFile('magic-tea-party.unsaved.txt', owner.unsavedText(), 'text/plain')}><Download className="size-4 shrink-0" aria-hidden="true" />导出未保存内容</Button>
        </div>
      </div> : null}
      <div className="space-y-2">
        <p className="text-xs text-(--app-text-muted)">消息分批显示，完整导出会包含全部消息。</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={disabled || !session} onClick={() => run(() => owner.nextMessages(true))}><ChevronUp className="size-4 shrink-0" aria-hidden="true" />首批消息</Button>
          <Button size="sm" disabled={disabled || !state.messageCursor} onClick={() => run(() => owner.nextMessages())}><ChevronRight className="size-4 shrink-0" aria-hidden="true" />下一批消息</Button>
          <Button variant="primary" size="sm" disabled={disabled || !session} onClick={() => run(owner.saveDraft)}><Save className="size-4 shrink-0" aria-hidden="true" />保存会话草稿</Button>
        </div>
      </div>
    </>}
    chat={<>
      <MagicTeaPartyChatTimeline activeSession={session} preferences={TEA_PREFERENCES} messages={state.messages.map(teaMessageView)}
        isGenerating={state.generating || preparingView}
        editingMessageId={state.editingMessageId} editingDraft={state.editingDraft}
        onStartEdit={message => {
          if (editDisabled || preparing.current || currentScope() !== renderScope) return;
          if (providerDirty || roleDirty.current || roleSaving.current || pasteDirty.current) { owner.report(new Error('请先保存或取消连接、角色和粘贴导入草稿，再编辑消息创建分支')); return; }
          owner.startMessageEdit(message.id);
        }}
        onEditDraftChange={owner.setMessageEditDraft} onCancelEdit={owner.cancelMessageEdit}
        onConfirmEdit={message => {
          if (editDisabled || preparing.current || currentScope() !== renderScope || message.id !== owner.getSnapshot().editingMessageId) return;
          if (providerDirty || roleDirty.current || roleSaving.current || pasteDirty.current) { owner.report(new Error('请先保存或取消连接、角色和粘贴导入草稿，再创建分支')); return; }
          run(owner.forkMessageEdit);
        }} outputView={outputView} onOutputViewChange={setOutputView}
        onStopGenerating={() => { aiStore.cancelPreparingGeneration(); owner.stop(); }} onSelectChoice={text => start({ kind: 'selected-choice', text })}
        renderMessage={props => <MagicTeaPartyChatMessage {...props} renderBudget={{ segments: 2000, characters: 100_000, rawPreviewCharacters: 100_000 }}
          renderMarkdown={markdown => <MarkdownBlock {...markdown} onNavigateExternal={openContent} renderInternalLink={({ children }) => <span>{children}</span>} />} />} />
      {state.editingMessageId !== null ? <Button size="sm" onClick={() => downloadTextFile('magic-tea-party.unsaved-edit.txt', owner.unsavedText(), 'text/plain')}><Download className="size-4 shrink-0" aria-hidden="true" />导出消息编辑草稿</Button> : null}
      <MagicTeaPartyChatComposer activeSession={session} preferences={TEA_PREFERENCES} draft={state.input} onDraftChange={value => { if (!preparing.current) owner.setInput(value); }}
        onSend={text => start({ kind: 'reply', text })} onContinue={() => start({ kind: 'continue' })} onGenerateChoices={() => start({ kind: 'choices' })}
        isGenerating={state.generating || preparingView} hasMessages={state.messages.length > 0} disabled={disabled}
        markdownHint="Markdown 正文与手动 JSONL 行动选项分别保存" />
    </>}
    afterChat={<p className="text-xs text-gray-500">文本存储上限：单消息 32 MiB、会话资料 8 MiB、单次导入 / 导出 64 MiB。整库备份含茶会表。停止与重启中断会明确标记，绝不自动重发生成。JSONL 使用原有交换格式，不能保全 JSON 的全部会话资料；需要完整文本归档时请选择 JSON。</p>}
    modals={<CardLibraryModal host={libraryHost} isOpen={library !== null} onClose={() => setLibrary(null)} onSelectCard={chooseCard}
      selectedType={library ?? 'character'} allowedTypes={[library ?? 'character']} initialTab="local" visibleTabs={['local']} allowDeckImport={false} titleOverride="选择本地数据卡" />} />;
}
