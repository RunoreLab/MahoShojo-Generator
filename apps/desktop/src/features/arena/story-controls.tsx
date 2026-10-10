import { useRef, useState, useSyncExternalStore } from 'react';
import {
  BattleStoryActions, BattleStoryChapterDirectory, BattleStoryChapterReader, BattleStorySessionDirectory, BattleStoryContentPreview, formatBattleStoryDisplayTitle,
  type BattleStoryChapterReadViewState,
} from '@mahoshojo/ui-web/arena-story-session';
import { StreamingBattleReportCard, type StreamingBattleReportCardProps, type BattleReportHostPorts } from '@mahoshojo/ui-web/arena-report';
import { useResultAutoScroll } from '@mahoshojo/ui-web/details-controls';
import { DENY_EXTERNAL_MEDIA } from '@mahoshojo/ui-web/markdown';
import { generationActionClassNames } from '@mahoshojo/ui-web/generation-actions';
import { ArenaCompanionAdjudicationResultSchema } from '@mahoshojo/contracts/arena-companion';
import {
  formatBattleStoryChapterProgress, isBattleStoryChapterPlanLimitReached, normalizeBattleStoryTotalChapters,
  resolveBattleStoryInitialChapterPlan, type BattleStoryChapterPlan, type BattleStoryDraftChapterPlanMode,
} from '@mahoshojo/domain/arena-battle-story-session';
import type { ArenaDraft } from './session';
import { DesktopArenaStorySession } from './story-session';

const secondary = generationActionClassNames.secondary;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** Read-only presentation. Carrier extensions stay in storage; only validated fields
 * become React/card props. No 48 KiB render-snapshot envelope is imposed on chapters. */
const cardProps = (value: unknown): Partial<StreamingBattleReportCardProps> => {
  const snapshot = record(value); if (!snapshot) return {};
  const reporter = record(snapshot.reporterInfo), reasoning = record(snapshot.aiReasoning), usage = record(snapshot.aiUsage);
  const adjudications = ArenaCompanionAdjudicationResultSchema.array().safeParse(snapshot.adjudicationResults);
  return {
    ...(reporter && typeof reporter.name === 'string' && typeof reporter.publication === 'string' ? { reporterInfo: { name: reporter.name, publication: reporter.publication } } : {}),
    ...(typeof snapshot.userGuidance === 'string' ? { userGuidance: snapshot.userGuidance } : {}),
    ...(typeof snapshot.aiModel === 'string' ? { aiModel: snapshot.aiModel } : {}),
    ...(reasoning && typeof reasoning.text === 'string' ? { aiReasoning: { status: 'done', source: 'provider', text: reasoning.text } } : {}),
    ...(adjudications.success ? { adjudicationResults: adjudications.data } : {}),
    ...(usage ? { aiUsage: Object.fromEntries(Object.entries(usage).filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0)) } : {}),
    ...(Array.isArray(snapshot.characterGuidances) ? { characterGuidances: snapshot.characterGuidances.flatMap((item) => {
      const entry = record(item); return entry && typeof entry.characterName === 'string' && typeof entry.guidance === 'string' ? [{ characterName: entry.characterName, guidance: entry.guidance }] : [];
    }) } : {}),
  };
};
export function DesktopArenaStoryControls(props: {
  owner: DesktopArenaStorySession; draft: ArenaDraft; disabled: boolean; unavailableReason: string | null;
  onStart(plan?: BattleStoryChapterPlan): void; onContinue(userGuidance: string): void;
  download(fileName: string, text: string, mimeType: string): void;
  onNavigateExternal: BattleReportHostPorts['onNavigateExternal'];
}) {
  const { owner, draft } = props;
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const [planMode, setPlanMode] = useState<BattleStoryDraftChapterPlanMode>('auto');
  const [planInput, setPlanInput] = useState('');
  const [guidance, setGuidance] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);
  const generating = state.phase === 'preparing' || state.phase === 'generating';
  useResultAutoScroll(resultRef, !!state.result?.markdown && (state.phase === 'generating' || state.phase === 'completed'), { restored: false });
  const plan = resolveBattleStoryInitialChapterPlan({ scenario: draft.battleMode === 'scenario' ? draft.scenario.content : null,
    userSelectionMode: planMode, userDesiredTotalChapters: planInput });
  const fixed = plan?.locked === true;
  const planError = !fixed && planMode === 'custom' && !normalizeBattleStoryTotalChapters(planInput);
  const busy = props.disabled || owner.isBusy();
  const canGenerate = !busy && !state.pending && !props.unavailableReason;
  const reached = !!state.active && isBattleStoryChapterPlanLimitReached({ chapterPlan: state.active.chapterPlan, completedChapterCount: state.active.chapterCount });
  const ports: BattleReportHostPorts = { mediaPolicy: DENY_EXTERNAL_MEDIA, onNavigateExternal: props.onNavigateExternal,
    downloadMarkdown: (text, fileName) => props.download(fileName, text, 'text/markdown;charset=utf-8') };
  const selection = state.selected;
  const readState: BattleStoryChapterReadViewState = selection.status === 'unloaded' ? { status: 'unloaded' }
    : selection.status === 'loaded' ? {
      status: 'loaded', identity: { sessionId: selection.sessionId, chapterId: selection.chapterId },
      title: `章节预览｜第 ${selection.chapter.index} 章 · ${formatBattleStoryDisplayTitle(selection.chapter.title)}`,
      content: <BattleStoryContentPreview key={selection.chapterId} characterCount={selection.chapter.markdown.length}
        exportAction={<button type="button" className={secondary} onClick={() => props.download(`第${selection.chapter.index}章.md`, selection.chapter.markdown, 'text/markdown;charset=utf-8')}>导出本章完整正文</button>}>
        <StreamingBattleReportCard {...cardProps(selection.chapter.cardSnapshot)} content={selection.chapter.markdown} mode={state.active?.mode} ports={ports} />
      </BattleStoryContentPreview>,
      footer: <p className="text-xs text-gray-500">本章保存在当前设备；角色变化仅属于本故事的工作副本。</p>,
    } : selection.status === 'loading' ? { status: 'loading', identity: { sessionId: selection.sessionId, chapterId: selection.chapterId } }
      : { status: 'error', identity: { sessionId: selection.sessionId, chapterId: selection.chapterId }, message: selection.message };
  const exportResult = () => { if (state.result) props.download(state.resultSaved ? '本次章节.md' : '未保存章节.md', state.result.markdown, 'text/markdown;charset=utf-8'); };
  const exportRaw = () => { if (state.result) props.download('连续故事原始输出.json', JSON.stringify({ rawText: state.result.rawText, reasoning: state.result.reasoning, usage: state.result.usage }, null, 2), 'application/json'); };
  return <section aria-label="连续战报会话" className="mt-6 space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
    <div><h2 className="text-xl font-semibold text-gray-900">连续战报会话</h2>
      <p className="mt-1 text-sm text-gray-600">简洁版与高级版共用本机故事。首章冻结当前页配置；续写沿用故事种子与章末角色，并使用当前显式选择的 Direct 模型。</p>
      <p className="mt-1 text-xs text-gray-500">仅线性 Markdown 流式章节；确定性摘要不额外调用 AI。Hosted、分支、重写和删除暂未开放。单次草稿、活动历史与原卡各自独立；退出账号不会隐藏本机故事。</p>
      <p className="mt-1 text-xs text-gray-500">当前连续请求沿用 Web 的种子字段：分队显示名称、活动历史及历史引用不会额外注入章节。读取／写入角色历战与当前状态按冻结设置生效。</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">新故事章节规划
        <select aria-label="新故事章节规划" className="ml-2 rounded border p-2" value={planMode} disabled={busy || fixed} onChange={(event) => setPlanMode(event.target.value as BattleStoryDraftChapterPlanMode)}>
          <option value="auto">沿用情景规划</option><option value="none">不限制</option><option value="custom">自定义</option>
        </select>
      </label>
      {(planMode === 'custom' || fixed) && <label className="text-sm">计划总章节数
        <input aria-label="计划总章节数" className="ml-2 w-24 rounded border p-2" type="number" min={1} max={20} value={fixed ? plan.totalChapters : planInput} disabled={busy || fixed} onChange={(event) => setPlanInput(event.target.value)} />
      </label>}
    </div>
    <p className="text-xs text-gray-500">{plan ? `本次新故事计划 ${plan.totalChapters} 章${fixed ? '（情景固定）' : ''}。` : '未设置章节计划，可按需持续续写，没有 20 章总存储限制。'}</p>
    {planError ? <p role="alert">自定义章节计划须为 1–20 的整数。</p> : null}
    <label className="block text-sm">下一章故事引导（独立于单次草稿；首章使用当前页引导）
      <textarea aria-label="下一章故事引导" className="mt-1 block w-full rounded-lg border p-2" value={guidance} disabled={busy} onChange={(event) => setGuidance(event.target.value)} />
    </label>
    <BattleStoryActions>
      <button className={secondary} type="button" disabled={!canGenerate || !!planError} title={props.unavailableReason ?? undefined} onClick={() => props.onStart(plan ?? undefined)}>新建连续战报</button>
      <button className={secondary} type="button" disabled={!canGenerate || !state.active || reached} title={props.unavailableReason ?? undefined} onClick={() => props.onContinue(guidance)}>继续续写</button>
      <button className={secondary} type="button" disabled={!state.active || busy} onClick={() => void owner.exportSelectedStory()}>导出完整 Markdown</button>
      {generating ? <button className={secondary} type="button" onClick={() => owner.cancel()}>停止章节生成</button> : null}
      {state.exporting ? <button className={secondary} type="button" onClick={() => owner.cancelExport()}>取消故事导出</button> : null}
    </BattleStoryActions>
    {props.unavailableReason ? <p role="status">{props.unavailableReason} 已保存故事仍可阅读和导出。</p> : null}
    {reached ? <p role="status">已完成本故事的显式章节计划。</p> : null}
    {state.message ? <p role="status" className="text-sm text-amber-800">{state.message}</p> : null}
    {state.pending ? <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4" role="status">
      <p className="font-semibold">{state.saving ? '正在保存已完成章节…' : state.pending.evidence === 'unknown' ? '生成完成，保存状态待确认' : '生成完成，未保存到会话'}</p>
      <p className="text-sm">完整结果只保留在当前窗口，关闭后可能丢失。先导出正文和原始输出可保留本次结果。</p>
      <BattleStoryActions>
        {state.pending.retryable ? <button className={secondary} type="button" disabled={state.saving} onClick={() => void owner.savePending()}>{state.pending.evidence === 'unknown' ? '查询原保存结果' : '重试本地保存'}</button> : null}
        <button className={secondary} type="button" onClick={exportResult}>导出未保存章节</button><button className={secondary} type="button" onClick={exportRaw}>导出完整原始输出</button>
        <button className={secondary} type="button" disabled={owner.isBusy()} onClick={() => { if (window.confirm('丢弃当前未保存结果？请先导出。保存待确认时，本机可能已有此章。')) owner.discardResult(); }}>丢弃当前结果</button>
      </BattleStoryActions>
    </div> : null}
    {state.savedUnread ? <button className={secondary} type="button" onClick={() => void owner.readSavedResult()}>读取刚保存的章节</button> : null}
    {state.exporting ? <p role="status">{state.exportProgress?.phase === 'writing' ? '正在写出完整故事' : '正在核对完整故事'}：{state.exportProgress?.bytes ?? 0} 字节；未完成核验前不会发布文件。</p> : null}
    {state.exportError ? <p role="alert">{state.exportError}</p> : null}
    {state.exportResult ? <p role="status" className="break-all">完整故事已导出：{state.exportResult.absolutePath}（{state.exportResult.byteLength} 字节）</p> : null}
    <div className="grid gap-5 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <BattleStorySessionDirectory rows={state.sessions.map((row) => ({ id: row.id, title: `${row.titlePreview}${row.titleTruncated ? '…' : ''}`,
          description: `${new Date(row.updatedAt).toLocaleString()}｜${formatBattleStoryChapterProgress({ completedChapterCount: row.chapterCount, chapterPlan: row.chapterPlan })}` }))}
          selectedId={state.active?.id ?? null} onSelect={(id) => { const head = state.sessions.find((row) => row.id === id); if (head) void owner.selectSession(head); }}
          loading={state.listLoading} error={state.listError} footer={<BattleStoryActions className="mt-3 flex flex-wrap gap-2"><button type="button" className={secondary} disabled={state.listLoading} onClick={() => void owner.refreshSessions()}>刷新故事目录</button>{state.sessionCursor ? <button type="button" className={secondary} disabled={state.listLoading} onClick={() => void owner.refreshSessions(true)}>更多故事</button> : null}</BattleStoryActions>} />
        <BattleStoryChapterDirectory rows={state.chapters.map((row) => ({ id: row.id, title: `第 ${row.index} 章 · ${row.titlePreview}${row.titleTruncated ? '…' : ''}`,
          description: `${row.action === 'start' ? '首章' : '续写'}｜${new Date(row.createdAt).toLocaleString()}` }))}
          selectedId={selection.status === 'unloaded' ? null : selection.chapterId} count={state.active?.chapterCount ?? 0} onSelect={(id) => void owner.selectChapter(id)}
          loading={state.chaptersLoading} error={state.chaptersError} footer={<BattleStoryActions className="mt-3 flex flex-wrap gap-2">{state.chaptersError && state.active ? <button type="button" className={secondary} onClick={() => { if (state.active) void owner.selectSession(state.active); }}>重读章节目录</button> : null}{state.chapterCursor ? <button type="button" className={secondary} disabled={state.chaptersLoading} onClick={() => void owner.loadMoreChapters()}>更多章节</button> : null}</BattleStoryActions>} />
      </div>
      <div className="min-w-0 space-y-4">
        <div ref={resultRef}>
          {state.result && (state.result.rawText || state.result.markdown || state.result.reasoning) ? <section aria-label="本次章节结果" className="space-y-3">
            <p className="font-semibold">本次第 {state.resultChapterIndex} 章 · {state.resultSaved ? '已保存' : generating ? '生成中' : '尚未保存'}</p>
            <BattleStoryContentPreview key={state.resultChapterIndex} characterCount={state.result.markdown.length}
              exportAction={<button type="button" className={secondary} onClick={exportResult}>导出当前完整正文</button>}>
              <StreamingBattleReportCard content={state.result.markdown} isStreaming={state.phase === 'generating'} onStopGeneration={() => owner.cancel()}
                aiReasoning={state.result.reasoning ? { status: generating ? 'thinking' : 'done', source: 'provider', text: state.result.reasoning } : null} ports={ports} />
            </BattleStoryContentPreview>
            <details><summary>完整原始输出</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all">{state.result.rawText}</pre></details>
            <BattleStoryActions><button type="button" className={secondary} onClick={exportRaw}>导出完整原始输出</button>{!state.pending && !generating ? <button type="button" className={secondary} disabled={owner.isBusy()} onClick={() => { if (!owner.hasUnsavedResult() || window.confirm('清除当前未保存原文？请先导出。')) owner.discardResult(); }}>清除本次预览</button> : null}</BattleStoryActions>
          </section> : null}
        </div>
        <BattleStoryChapterReader state={readState} description="按需读取所选章节全文；目录页数不会限制完整故事导出。" emptyContent={<p>选择故事后可阅读任意章节。</p>}
          errorActions={selection.status === 'error' ? <button className={secondary} type="button" onClick={() => void owner.selectChapter(selection.chapterId)}>重试读取本章</button> : null} />
      </div>
    </div>
  </section>;
}
