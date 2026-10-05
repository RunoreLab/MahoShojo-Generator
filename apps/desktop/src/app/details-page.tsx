import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link } from '@tanstack/react-router';
import { getModelGenerationCapabilities } from '@mahoshojo/ai-core/generation-settings';
import { getRandomFlowers } from '@mahoshojo/domain/flowers';
import { getAnswerLimitInfo, isAnswerOverLimit } from '@mahoshojo/domain/questionnaire';
import { AiExecutionLocationField, AdvancedGenerationSettings } from '@mahoshojo/ui-web/ai-provider';
import { DETAILS_QUESTIONNAIRE_THEME, QuestionnaireQuestionPanel } from '@mahoshojo/ui-web/questionnaire';
import { MagicalGirlResultBody } from '@mahoshojo/ui-web/character-result';
import { DetailsSession } from '../features/details/session';
import { buildDetailsAnswers, loadDefaultQuestionnaire, type DetailsQuestionnaire } from '../features/details/questionnaire';
import { resolveDesktopAiTarget } from '../features/ai-config/desktop-ai-config';
import { useDesktopAiConfig } from '../features/ai-config/use-desktop-ai-config';
import { IpcLocalCardRepository } from '../platform/local-card-bridge';
import { useLeaveGuard } from './useLeaveGuard';

const actionClass = 'rounded-lg border border-(--app-border) px-4 py-2 disabled:opacity-50';

function DetailsForm({ session }: { session: DetailsSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  // AI 连接与执行位置与设置页共用同一份 overlay/profiles 状态（D5.0b）。
  const { state: aiState, store: aiStore } = useDesktopAiConfig();
  const target = resolveDesktopAiTarget(
    aiState.selection,
    aiState.profiles,
    aiState.generationOverrides,
  );
  const profilesLoading = aiState.profilesState === 'idle' || aiState.profilesState === 'loading';
  const profilesError = aiState.profilesState === 'failed' ? aiState.profilesError : null;
  const [questionnaire, setQuestionnaire] = useState<DetailsQuestionnaire | null>(null);
  const [questionnaireError, setQuestionnaireError] = useState<string | null>(null);
  const [questionnaireLoading, setQuestionnaireLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const regenerateDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = regenerateDialog.current;
    if (confirmRegenerate && !dialog?.open) dialog?.showModal();
    else if (!confirmRegenerate && dialog?.open) dialog.close();
  }, [confirmRegenerate]);
  const guard = useLeaveGuard(
    () => session.isBusy() || (!session.getSnapshot().draftSaved && !session.getSnapshot().pendingRestore && !session.isDraftBlocked()),
    '生成或保存尚未完成，或当前草稿未能保存。请等待、取消生成，或重试保存草稿后再离开。也可以确认清除草稿以放弃当前内容。',
    '窗口关闭保护初始化失败，生成与保存暂不可用。请重新打开页面后重试。',
    () => {
      const current = session.getSnapshot();
      if (current.saving || current.phase !== 'generating') return false;
      if (!window.confirm('生成尚未完成。确认终止生成并离开？已收到的正文将保留在本机草稿中。')) return false;
      session.cancel();
      return session.getSnapshot().draftSaved;
    },
  );
  useEffect(() => {
    const controller = new AbortController();
    setQuestionnaireLoading(true);
    setQuestionnaireError(null);
    void loadDefaultQuestionnaire(controller.signal).then((questions) => {
      if (!controller.signal.aborted) setQuestionnaire(questions);
    }).catch(() => {
      if (!controller.signal.aborted) setQuestionnaireError('内置问卷加载失败，请重试。');
    }).finally(() => { if (!controller.signal.aborted) setQuestionnaireLoading(false); });
    return () => controller.abort();
  }, [reload]);
  const selected = target.profile;
  const mode = target.mode;
  const busy = state.phase === 'generating' || state.saving;
  const blockedDraft = state.pendingRestore || session.isDraftBlocked();
  // 写入失败仍允许编辑/重试；读取失败由 session 拒绝覆盖，页面明确要求清除。
  const question = questionnaire?.questions[questionIndex];
  const answer = question ? state.draft.answers[question.id] ?? '' : '';
  const updateAnswer = (value: string) => {
    if (!question) return;
    session.updateDraft({ ...state.draft, answers: { ...state.draft.answers, [question.id]: value } });
  };
  const generate = (discardUnsavedResult = false) => {
    if (!guard.ready || busy || !selected || !mode || !questionnaire || questionnaireLoading || profilesLoading || profilesError || questionnaireError || state.pendingRestore || session.isDraftBlocked()) return;
    if (session.hasUnsavedResult() && !discardUnsavedResult) { setConfirmRegenerate(true); return; }
    try {
      const answers = buildDetailsAnswers(questionnaire, session.getSnapshot().draft.answers);
      setActionError(null);
      void session.generate({ invoke, profileId: selected.id }, { answers, language: session.getSnapshot().draft.language, loreText: '' }, { mode, modelId: selected.modelId, flowers: getRandomFlowers(), overrides: target.generationOverrides }, discardUnsavedResult);
    } catch (error) { setActionError(error instanceof Error ? error.message : '问卷无法生成。'); }
  };
  const targetCapabilities = selected
    ? getModelGenerationCapabilities(selected.id, selected.modelId)
    : undefined;
  return (
    <section data-testid="page-details" className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">魔法少女问卷生成</h1>
        <p className="mt-2 text-sm text-(--app-text-muted)">填写内置问卷后，直接向你配置的模型发送回答，生成未签名角色卡。当前支持默认问卷，不提供自定义问卷或账号存档。</p>
      </header>
      <section aria-label="草稿" className="rounded-lg border border-(--app-border) p-4">
        <p>问卷、结果与中断正文自动保存在本机页面草稿中，恢复草稿不会自动重新生成。</p>
        <p className="text-sm text-(--app-text-muted)">草稿不参与本地库整库备份或归档；保存到本地卡库的角色卡参与。草稿上限为序列化后 4 Mi 字符，超出或写入失败时请保留当前页面。</p>
        {state.pendingRestore && <div role="status" className="mt-2 flex flex-wrap items-center gap-2"><span>发现上次草稿，请选择恢复或清除。</span><button className={actionClass} onClick={() => session.restoreDraft()}>恢复草稿</button></div>}
        {state.draftError && <p role="alert">{state.draftError}</p>}
        {!state.pendingRestore && <p role="status">{state.draftSaved ? '当前内容已保存或无待保存变更。' : '当前内容尚未保存到草稿。'}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {state.draftError && !session.isDraftBlocked() && <button className={actionClass} disabled={busy || state.pendingRestore} onClick={() => session.retryDraftSave()}>重试保存草稿</button>}
          <button className={actionClass} disabled={busy} onClick={() => setConfirmClear(true)}>清除草稿</button>
        </div>
        {confirmClear && <div role="group" aria-label="确认清除草稿" className="mt-3 rounded border p-3">
          <p>确认清除本页回答、生成结果和中断正文？已保存的本地卡不受影响。此操作无法撤销。</p>
          <button className={actionClass} disabled={busy} onClick={() => { session.discardDraft(); setConfirmClear(false); setQuestionIndex(0); }}>确认清除</button>
          <button className={actionClass} onClick={() => setConfirmClear(false)}>保留草稿</button>
        </div>}
      </section>
      {!guard.ready && !guard.message && <p role="status">正在初始化窗口关闭保护…</p>}
      {guard.message && <p role="alert">{guard.message}</p>}
      {questionnaireLoading && <p role="status">正在读取内置问卷…</p>}
      {questionnaireError && <p role="alert">{questionnaireError}</p>}
      {profilesLoading && <p role="status">正在读取本地 Provider 配置…</p>}
      {profilesError && <p role="alert">{profilesError}</p>}
      <button className={`${actionClass} self-start`} disabled={busy} onClick={() => { setReload((value) => value + 1); void aiStore.refreshProfiles(); }}>重新加载问卷与配置</button>
      <fieldset disabled={busy || blockedDraft || questionnaireLoading || !guard.ready} className="flex min-w-0 flex-col gap-4">
        <legend className="mb-2 font-semibold">生成设置</legend>
        <AiExecutionLocationField
          value={target.location}
          client={{ enabled: true }}
          server={{ enabled: false, reason: '服务器执行将在接入在线能力后开放' }}
          onChange={(location) => aiStore.selectExecutionLocation(location)}
        />
        <label className="flex flex-col gap-1">AI 连接
          <select
            aria-label="AI 连接"
            className="w-full rounded border border-(--app-border) bg-(--app-surface) px-3 py-2 text-(--app-text)"
            value={aiState.selection.clientConnectionId ?? ''}
            disabled={aiState.overlayState !== 'ready'}
            onChange={(event) => { if (event.target.value) aiStore.selectConnection(event.target.value); }}
          >
            {aiState.selection.clientConnectionId === null && <option value="">未选择连接</option>}
            {aiState.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.modelId}</option>)}
          </select>
        </label>
        {!profilesLoading && !aiState.profiles.length && !profilesError && <p>请先在<Link to="/settings" className="underline">设置</Link>中保存 Provider。问卷可以先填写，配置加载后再生成。</p>}
        {target.unavailableReason && <p role="status">{target.unavailableReason}</p>}
        {selected && mode && <div className="rounded border border-(--app-border) p-3">
          <p>{mode === 'direct-local' ? '客户端 · 本机：发送到本机模型服务' : '客户端 · 远端：发送到你指定的外部模型服务'}</p>
          <p className="break-all">接收方：{selected.baseUrl}</p>
          <p>模型：{selected.modelId}。点击生成会发送已填写的问卷回答；结果不带官方签名。</p>
        </div>}
        {/* 未实现 adapter 的连接不展示高级参数——不显示无实际发送效果的控件。 */}
        {selected && mode && <AdvancedGenerationSettings
          value={target.generationOverrides}
          onChange={(next) => aiStore.setGenerationOverrides(selected.id, selected.modelId, next)}
          temperatureSupported={targetCapabilities ? targetCapabilities.temperature.support !== 'unsupported' : true}
          temperatureMax={targetCapabilities?.temperature.max}
          maxOutputTokensMax={targetCapabilities?.maxOutputTokens.max}
          thinkingSupport={targetCapabilities?.thinking.support ?? 'unknown'}
          thinkingEfforts={targetCapabilities?.thinking.efforts}
          canDisableThinking={targetCapabilities
            ? targetCapabilities.thinking.support === 'supported' && targetCapabilities.thinking.canDisable !== false
            : true}
        />}
        <label className="flex flex-col gap-1">输出语言
          <select aria-label="输出语言" className="w-full rounded border border-(--app-border) bg-(--app-surface) px-3 py-2 text-(--app-text)" value={state.draft.language} onChange={(event) => session.updateDraft({ ...state.draft, language: event.target.value })}>
            {['简体中文', '繁體中文', 'English', '日本語'].map((language) => <option key={language}>{language}</option>)}
          </select>
        </label>
        {question && questionnaire && <QuestionnaireQuestionPanel
          theme={DETAILS_QUESTIONNAIRE_THEME} progressLabel={`第 ${questionIndex + 1} / ${questionnaire.questions.length} 题`} progressPercent={(questionIndex + 1) / questionnaire.questions.length * 100}
          questionText={question.question} questionnaireTitle={questionnaire.title} noticeText="至少回答一题即可生成，其他题目可以跳过。" helperText={question.helperText}
          isRequired={false} skipText="可跳过本题" options={question.options} optionsHintText="点击选项填写回答" onOptionSelect={updateAnswer} suggestions={question.suggestions} onSuggestionSelect={updateAnswer}
          showTextInput={question.allowCustom !== false} answer={answer} onAnswerChange={updateAnswer} placeholder={question.placeholder} answerLength={answer.trim().length}
          showLimitLabel limitLabel={`建议不超过 ${getAnswerLimitInfo(question.maxLength).limit ?? 500} 字，不限制生成`} isOverLimit={isAnswerOverLimit(answer, question.maxLength)} overLimitText="回答超过建议长度，仍可生成未签名角色卡。"
          prevLabel="上一题" nextButtonContent="下一题" onPrev={() => setQuestionIndex((index) => Math.max(0, index - 1))} onNext={() => setQuestionIndex((index) => Math.min(questionnaire.questions.length - 1, index + 1))}
          disablePrev={questionIndex === 0} disableNext={questionIndex === questionnaire.questions.length - 1} prevButtonClass={actionClass} nextButtonClass={actionClass}
        />}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button className={actionClass} disabled={!guard.ready || busy || questionnaireLoading || profilesLoading || !questionnaire || !selected || !mode || blockedDraft || !!questionnaireError || !!profilesError} onClick={() => generate()}>{state.phase === 'generating' ? '正在生成…' : state.phase === 'idle' ? '发送问卷并生成' : '重新生成'}</button>
        {state.phase === 'generating' && <button className={actionClass} onClick={() => session.cancel()}>取消生成</button>}
      </div>
      <dialog ref={regenerateDialog} aria-labelledby="regenerate-title" aria-describedby="regenerate-description" className="m-auto max-w-lg rounded-lg border border-(--app-border) bg-(--app-surface) p-5 text-(--app-text) backdrop:bg-black/40" onCancel={(event) => { event.preventDefault(); if (!session.isBusy()) setConfirmRegenerate(false); }}>
        <h2 id="regenerate-title" className="text-xl font-semibold">重新生成？</h2>
        <p id="regenerate-description" className="my-3">当前结果尚未保存到本地卡库。重新生成将替换当前结果；即使新生成失败或取消，也无法恢复。可以先保存当前结果再生成。</p>
        {state.saveError && <p role="alert">{state.saveError}</p>}
        <div className="flex flex-wrap gap-2">
          <button autoFocus className={actionClass} disabled={busy} onClick={() => setConfirmRegenerate(false)}>取消</button>
          <button className={actionClass} disabled={busy} onClick={async () => { if (await session.saveResult()) { setConfirmRegenerate(false); generate(); } }}>{state.saving ? '正在保存…' : '保存后重新生成'}</button>
          <button className={actionClass} disabled={busy} onClick={() => { setConfirmRegenerate(false); generate(true); }}>确定重新生成</button>
        </div>
      </dialog>
      {actionError && <p role="alert">{actionError}</p>}
      {state.message && <p role="status">{state.message}</p>}
      {state.card && <section aria-label="生成结果" className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{state.card.codename || '未命名魔法少女'} · 未签名</h2>
        <MagicalGirlResultBody magicalGirl={state.card} />
        <button className={actionClass} disabled={!guard.ready || busy || state.saveStatus === 'saved' || state.saveStatus === 'already-present'} onClick={() => { if (guard.ready) void session.saveResult(); }}>{state.saving ? '正在保存…' : '保存到本地卡库'}</button>
        {state.saveStatus === 'saved' && <p role="status">已保存到本地卡库。</p>}
        {state.saveStatus === 'already-present' && <p role="status">本地卡库已存在相同内容，原记录保持不变。</p>}
        {state.saveError && <p role="alert">{state.saveError}</p>}
      </section>}
      {state.rawText && <details open={state.phase !== 'completed'}><summary>原始输出正文</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border p-3">{state.rawText}</pre></details>}
    </section>
  );
}

export function DesktopDetails() {
  const [session, setSession] = useState<DetailsSession | null>(null);
  useEffect(() => {
    const owner = new DetailsSession({
      storage: { getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: (key) => window.localStorage.removeItem(key) },
      repository: new IpcLocalCardRepository(invoke), initialDraft: { answers: {}, language: '简体中文' },
    });
    setSession(owner);
    const onPageHide = () => owner.cancel();
    window.addEventListener('pagehide', onPageHide);
    return () => { window.removeEventListener('pagehide', onPageHide); owner.dispose(); };
  }, []);
  return session ? <DetailsForm session={session} /> : <p role="status">正在准备问卷草稿…</p>;
}
