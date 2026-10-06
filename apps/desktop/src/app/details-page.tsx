import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link } from '@tanstack/react-router';
import { getModelGenerationCapabilities } from '@mahoshojo/ai-core/generation-settings';
import { getRandomFlowers } from '@mahoshojo/domain/flowers';
import { getAnswerLimitInfo, hasOverLimitQuestionnaireAnswers, isAnswerOverLimit, type QuestionnaireAnswerMatchTarget } from '@mahoshojo/domain/questionnaire';
import { buildQuestionnaireFlow, resolveQuestionnaireReferences } from '@mahoshojo/domain/questionnaire-definition';
import {
  buildQuestionnaireAnswerExportText,
  collectQuestionnaireAnswerExportItems,
} from '@mahoshojo/domain/questionnaire-answer-export';
import {
  buildQuestionnaireSelectionLoreText,
  isQuestionnaireGenerationNativeSignatureAllowed,
  isQuestionnaireSelectionNativeAllowed,
  type QuestionnaireSelection,
} from '@mahoshojo/domain/questionnaire-selection';
import { AiExecutionLocationField, AdvancedGenerationSettings } from '@mahoshojo/ui-web/ai-provider';
import {
  AiReasoningPanel,
  AnswerReviewList,
  BulkAnswerTools,
  GenerationModeSwitcher,
  QuestionNavigator,
  QuestionnaireAnswerExportPanel,
  type GenerationMode,
} from '@mahoshojo/ui-web/details-controls';
import { DETAILS_QUESTIONNAIRE_THEME, QuestionnaireQuestionPanel } from '@mahoshojo/ui-web/questionnaire';
import { MagicalGirlResultBody, type MagicalGirlResultData } from '@mahoshojo/ui-web/character-result';
import { GeneralCharacterCard, type GeneralCharacterCardData } from '@mahoshojo/ui-web/character-card';
import { CardLibraryModal, type BattleSelectionPayload, type CardLibrarySelectionContext } from '@mahoshojo/ui-web/card-library';
import { DetailsSession } from '../features/details/session';
import type { DetailsExecutionMode } from '../features/details/generation';
import {
  buildDetailsAnswers,
  buildDetailsFlowItems,
  builtinQuestionnaireSource,
  loadDefaultQuestionnaire,
  parseQuestionnaireSelection,
  toQuestionnaireSelection,
  type DetailsQuestionnaire,
  type QuestionnaireSource,
} from '../features/details/questionnaire';
import { resolveDesktopAiTarget } from '../features/ai-config/desktop-ai-config';
import { useDesktopAiConfig } from '../features/ai-config/use-desktop-ai-config';
import { useDesktopCloudSession } from '../features/account/use-desktop-cloud-session';
import { useDesktopCardLibraryHost } from '../platform/card-library-host';
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
  const cardLibraryHost = useDesktopCardLibraryHost();
  // 登录只决定是否附带会话/活动身份；System Default 公开路由对匿名放行（DESK-ONLINE-009）。
  const { store: cloudSessionStore } = useDesktopCloudSession();
  const [generationMode, setGenerationMode] = useState<GenerationMode>('non-stream');
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [questionnaire, setQuestionnaire] = useState<DetailsQuestionnaire | null>(null);
  const [questionnaireSource, setQuestionnaireSource] = useState<QuestionnaireSource | null>(null);
  const [questionnaireError, setQuestionnaireError] = useState<string | null>(null);
  const [questionnaireLoading, setQuestionnaireLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState<false | 'unsaved' | 'uncertain'>(false);
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
  // 语言清单与 Web 同一来源（content/languages.json → public 同步副本）。
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/languages.json', { signal: controller.signal, credentials: 'omit', redirect: 'error' })
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => { if (!controller.signal.aborted && Array.isArray(data)) setLanguages(data); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setQuestionnaireLoading(true);
    setQuestionnaireError(null);
    void loadDefaultQuestionnaire(controller.signal).then((questions) => {
      if (!controller.signal.aborted) {
        setQuestionnaire(questions);
        setQuestionnaireSource(builtinQuestionnaireSource(questions));
      }
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
  // 问卷流程与 Web 同一套领域语义：optionsFrom/suggestionsFrom 先解析，
  // displayIf/jump 随当前回答求值（`questionnaire-definition` 共享模块）。
  // 答案键按「选中实例」隔离（selectionId）：同一问卷的云端卡与本地副本、
  // 或切换来源后重选，各自持有独立的草稿答案（D5.0e-r1，与 Web scopeId 同口径）。
  const flowItems = useMemo(
    () => (questionnaire
      ? resolveQuestionnaireReferences(buildDetailsFlowItems(questionnaire, questionnaireSource?.selectionId))
      : []),
    [questionnaire, questionnaireSource],
  );
  const answersByKey = state.draft.answers;
  const flow = useMemo(
    () => buildQuestionnaireFlow(flowItems, answersByKey).flow,
    [flowItems, answersByKey],
  );
  // 全题目目标（含条件隐藏题）：批量解析与卡导入的元数据解析以全集为准；
  // 无元数据条目按可见流序回落——与 Web `/details` 同一口径。
  const allQuestionTargets = useMemo<QuestionnaireAnswerMatchTarget[]>(
    () => flowItems.map((item, index) => ({
      key: item.key,
      index,
      question: item.question.question,
      questionId: item.question.id,
      questionnaireId: item.questionnaireId,
      questionnaireTitle: item.questionnaireTitle,
    })),
    [flowItems],
  );
  const visibleQuestionTargets = useMemo<QuestionnaireAnswerMatchTarget[]>(
    () => flow.map((item, index) => ({
      key: item.key,
      index,
      question: item.question.question,
      questionId: item.question.id,
      questionnaireId: item.questionnaireId,
      questionnaireTitle: item.questionnaireTitle,
    })),
    [flow],
  );
  const applyImportedAnswers = (next: Record<string, string>) => {
    session.updateDraft({ ...state.draft, answers: next });
    setActionError(null);
  };
  const buildAnswerExportText = () => buildQuestionnaireAnswerExportText({
    title: '魔法少女问卷答案备份',
    items: collectQuestionnaireAnswerExportItems(visibleQuestionTargets, answersByKey),
    total: flow.length,
    questionnaireLabel: questionnaire?.title ?? '',
  });
  const currentIndex = Math.min(questionIndex, Math.max(0, flow.length - 1));
  const flowItem = flow[currentIndex];
  const question = flowItem?.question;
  const answer = flowItem ? answersByKey[flowItem.key] ?? '' : '';
  // 与 Web DetailsPage 同一口径：封闭题（allowCustom:false）没有任何可点选
  // 选项时回退为文本输入；灵感提示只在文本输入可用时出现——点击 suggestion
  // 即写入自由文本，封闭题展示它会产生提交时必遭拒绝的答案（D5.1a-r2）。
  const questionHasOptions = (question?.options?.length ?? 0) > 0;
  const showTextInput = question?.allowCustom !== false || !questionHasOptions;
  const updateAnswer = (value: string) => {
    if (!flowItem) return;
    session.updateDraft({ ...state.draft, answers: { ...answersByKey, [flowItem.key]: value } });
  };
  // 当前选择集（单问卷形态；多问卷选择 UI 随 C6 装配落地，会话/执行层已按数组建模）。
  const selections: QuestionnaireSelection[] = useMemo(
    () => (questionnaire && questionnaireSource
      ? [toQuestionnaireSelection(questionnaireSource, questionnaire)]
      : []),
    [questionnaire, questionnaireSource],
  );
  // `nativeAllowed` 是签名资格而非可用性：非原生问卷照常生成，只是不获官方签名。
  const isNativeSignatureEligible = isQuestionnaireSelectionNativeAllowed(selections);
  // 「客户端｜服务器」与「流式｜非流式」两个维度共同决定执行模式（DESK-ONLINE-009）。
  const hostedMode: DetailsExecutionMode = generationMode === 'stream' ? 'hosted-stream' : 'hosted-json';
  const executionMode: DetailsExecutionMode | null = target.location === 'server' ? hostedMode : mode;
  const generate = (discardUnsavedResult = false) => {
    if (!guard.ready || busy || !executionMode || !questionnaire || questionnaireLoading || profilesLoading || profilesError || questionnaireError || state.pendingRestore || session.isDraftBlocked()) return;
    if (target.location === 'client' && !selected) return;
    if (!discardUnsavedResult) {
      if (session.hasUnsavedResult()) { setConfirmRegenerate('unsaved'); return; }
      // hosted-json 结果不确定时再次生成 = 可能的第二次调用，必须显式确认（D5.1a-r1）。
      if (state.phase === 'uncertain') { setConfirmRegenerate('uncertain'); return; }
    }
    try {
      const answers = buildDetailsAnswers(flow, session.getSnapshot().draft.answers);
      setActionError(null);
      setActionInfo(null);
      void session.generate(
        { invoke, profileId: selected?.id ?? '' },
        {
          answers,
          language: session.getSnapshot().draft.language,
          loreText: buildQuestionnaireSelectionLoreText(selections),
          hosted: {
            selections,
            allowNativeSignature: isQuestionnaireGenerationNativeSignatureAllowed(
              selections,
              hasOverLimitQuestionnaireAnswers(flow, session.getSnapshot().draft.answers),
            ),
          },
        },
        { mode: executionMode, modelId: selected?.modelId, flowers: getRandomFlowers(), overrides: target.generationOverrides },
        discardUnsavedResult,
      );
    } catch (error) { setActionError(error instanceof Error ? error.message : '问卷无法生成。'); }
  };

  /** 打开问卷选择器：一次主动使用 → 顺手探测会话（DESK-ONLINE-013），失败只影响云端页签。 */
  const openPicker = () => {
    void cloudSessionStore.refresh();
    setPickerOpen(true);
  };

  const handleSelectQuestionnaireCard = (payload: BattleSelectionPayload, context: CardLibrarySelectionContext) => {
    const parsed = parseQuestionnaireSelection(payload, context);
    if ('error' in parsed) {
      setActionError(parsed.error);
      return;
    }
    // 切换问卷不清空已填回答：key 失配的旧回答留在草稿里但不参与生成；
    // 「切换保留」指草稿本身不丢，而不是把旧问卷的回答错投到新题。
    setQuestionnaire(parsed.questionnaire);
    setQuestionnaireSource(parsed.source);
    setQuestionIndex(0);
    setActionError(null);
  };
  const targetCapabilities = selected
    ? getModelGenerationCapabilities(selected.id, selected.modelId)
    : undefined;
  return (
    <section data-testid="page-details" className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold">魔法少女问卷生成</h1>
        <p className="mt-2 text-sm text-(--app-text-muted)">填写问卷后，直接向你配置的模型发送回答，生成未签名角色卡。问卷可以是内置默认，也可以从本地库或云端数据卡选择。</p>
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
      <section aria-label="问卷来源" className="rounded-lg border border-(--app-border) p-4">
        <p>
          当前问卷：{questionnaire ? questionnaire.title : '—'}
          {questionnaireSource && questionnaireSource.kind !== 'builtin' && (
            <span className="text-sm text-(--app-text-muted)">
              {' '}（{questionnaireSource.kind === 'local' ? '本地库' : '云端数据卡'}）
            </span>
          )}
        </p>
        {!isNativeSignatureEligible && questionnaire && (
          <p role="status" className="mt-1 text-sm text-(--app-text-muted)">
            该问卷未声明可在客户端原生运行；可正常生成，但结果不会获得官方签名。
          </p>
        )}
        <p className="mt-1 text-sm text-(--app-text-muted)">
          云端来源需要你已登录且服务可用；本地库来源离线可用。切换问卷不会删除已填写的回答。
        </p>
        <button className={`${actionClass} mt-2`} disabled={busy || blockedDraft} onClick={openPicker}>选择问卷</button>
      </section>
      <fieldset disabled={busy || blockedDraft || questionnaireLoading || !guard.ready} className="flex min-w-0 flex-col gap-4">
        <legend className="mb-2 font-semibold">生成设置</legend>
        <AiExecutionLocationField
          value={target.location}
          client={{ enabled: true }}
          server={{ enabled: true }}
          onChange={(location) => aiStore.selectExecutionLocation(location)}
        />
        <GenerationModeSwitcher value={generationMode} onChange={setGenerationMode} />
        <label className="flex flex-col gap-1">AI 连接
          <select
            aria-label="AI 连接"
            className="w-full rounded border border-(--app-border) bg-(--app-surface) px-3 py-2 text-(--app-text)"
            value={aiState.selection.clientConnectionId ?? ''}
            disabled={aiState.overlayState !== 'ready'}
            onChange={(event) => {
              // 生成入口选连接=立即用它执行：两个维度一起显式落定。
              if (event.target.value) {
                aiStore.selectClientConnection(event.target.value);
                aiStore.selectExecutionLocation('client');
              }
            }}
          >
            {aiState.selection.clientConnectionId === null && <option value="">未选择连接</option>}
            {aiState.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.modelId}</option>)}
          </select>
        </label>
        {!profilesLoading && !aiState.profiles.length && !profilesError && <p>请先在<Link to="/settings" className="underline">设置</Link>中保存 Provider。问卷可以先填写，配置加载后再生成。</p>}
        {target.location === 'server' && <div className="rounded border border-(--app-border) p-3">
          <p>服务器 · 云端：由项目服务在服务器侧生成，{generationMode === 'stream' ? 'Markdown 流式输出（未签名）' : '结构化 JSON 输出（问卷原生许可时可获官方签名）'}。</p>
          <p>不使用客户端连接与高级模型参数（由服务器侧 System Default 解析）。切换执行位置不会丢失已填写的问卷回答。</p>
        </div>}
        {target.location === 'client' && target.unavailableReason && <p role="status">{target.unavailableReason}</p>}
        {target.location === 'client' && selected && mode && <div className="rounded border border-(--app-border) p-3">
          <p>{mode === 'direct-local' ? '客户端 · 本机：发送到本机模型服务' : '客户端 · 远端：发送到你指定的外部模型服务'}</p>
          <p className="break-all">接收方：{selected.baseUrl}</p>
          <p>模型：{selected.modelId}。点击生成会发送已填写的问卷回答；结果不带官方签名。</p>
        </div>}
        {/* 高级参数只随 direct 通路下发（hosted 在服务器侧解析）：仅客户端执行时展示，
            未实现 adapter 的连接同样不显示无实际发送效果的控件。 */}
        {target.location === 'client' && selected && mode && <AdvancedGenerationSettings
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
            {/* languages.json 未加载完成前先呈现当前值，避免选择态回空。 */}
            {(languages.length ? languages : [{ code: state.draft.language, name: state.draft.language }]).map((lang) => (
              <option key={lang.code} value={lang.code}>{lang.name}</option>
            ))}
          </select>
        </label>
        {flow.length > 0 && <QuestionNavigator
          theme="app"
          items={flow.map((item) => ({ id: item.key, label: item.question.question }))}
          currentIndex={currentIndex}
          onNavigate={setQuestionIndex}
          isAnswered={(index) => Boolean(answersByKey[flow[index]!.key]?.trim())}
        />}
        {flowItem && question && questionnaire && <QuestionnaireQuestionPanel
          theme={DETAILS_QUESTIONNAIRE_THEME} progressLabel={`第 ${currentIndex + 1} / ${flow.length} 题`} progressPercent={(currentIndex + 1) / flow.length * 100}
          questionText={question.question} questionnaireTitle={questionnaire.title} noticeText="至少回答一题即可生成，其他题目可以跳过。" helperText={question.helperText}
          isRequired={question.required === true} skipText={question.required === true ? '本题为必答' : '可跳过本题'} options={question.options} optionsHintText="点击选项填写回答" onOptionSelect={updateAnswer} suggestions={showTextInput ? question.suggestions : undefined} onSuggestionSelect={updateAnswer}
          showTextInput={showTextInput} answer={answer} onAnswerChange={updateAnswer} placeholder={question.placeholder} answerLength={answer.trim().length}
          showLimitLabel limitLabel={`建议不超过 ${getAnswerLimitInfo(question.maxLength).limit ?? 500} 字，不限制生成`} isOverLimit={isAnswerOverLimit(answer, question.maxLength)} overLimitText="回答超过建议长度，仍可生成未签名角色卡。"
          prevLabel="上一题" nextButtonContent="下一题" onPrev={() => setQuestionIndex((index) => Math.max(0, index - 1))}
          onNext={() => {
            if (question.required === true && !answer.trim()) {
              setActionError('本题为必答，请填写后再继续。');
              return;
            }
            setActionError(null);
            setQuestionIndex((index) => Math.min(flow.length - 1, index + 1));
          }}
          disablePrev={currentIndex === 0} disableNext={currentIndex >= flow.length - 1} prevButtonClass={actionClass} nextButtonClass={actionClass}
        />}
      </fieldset>
      {/* 批量填充/卡导入/答案概览/备份导出——与 Web `/details` 同一套共享区段。 */}
      {!blockedDraft && <BulkAnswerTools
        variant="app"
        targets={allQuestionTargets}
        indexFallbackTargets={visibleQuestionTargets}
        answersByKey={answersByKey}
        onApplyAnswers={applyImportedAnswers}
        onInfo={setActionInfo}
        onError={(message) => setActionError(`⚠️ ${message}`)}
        disabled={busy}
      />}
      {!blockedDraft && <AnswerReviewList
        variant="app"
        items={visibleQuestionTargets.map((item) => ({
          key: item.key,
          index: item.index,
          question: item.question,
          questionnaireTitle: item.questionnaireTitle,
          answer: answersByKey[item.key] ?? '',
        }))}
        onEdit={setQuestionIndex}
      />}
      <QuestionnaireAnswerExportPanel
        variant="app"
        title="生成前备份问卷答案"
        filenameBase="魔法少女问卷_答案备份"
        hasContent={visibleQuestionTargets.some((item) => Boolean(answersByKey[item.key]?.trim()))}
        buildContent={buildAnswerExportText}
        disabled={busy}
      />
      <div className="flex flex-wrap gap-2">
        <button className={actionClass} disabled={!guard.ready || busy || questionnaireLoading || profilesLoading || !questionnaire || !executionMode || (target.location === 'client' && !selected) || blockedDraft || !!questionnaireError || !!profilesError} onClick={() => generate()}>{state.phase === 'generating' ? '正在生成…' : state.phase === 'idle' ? '发送问卷并生成' : '重新生成'}</button>
        {state.phase === 'generating' && <button className={actionClass} onClick={() => session.cancel()}>取消生成</button>}
      </div>
      <dialog ref={regenerateDialog} aria-labelledby="regenerate-title" aria-describedby="regenerate-description" className="m-auto max-w-lg rounded-lg border border-(--app-border) bg-(--app-surface) p-5 text-(--app-text) backdrop:bg-black/40" onCancel={(event) => { event.preventDefault(); if (!session.isBusy()) setConfirmRegenerate(false); }}>
        <h2 id="regenerate-title" className="text-xl font-semibold">重新生成？</h2>
        {confirmRegenerate === 'uncertain' ? (
          <p id="regenerate-description" className="my-3">无法确认上次请求是否在服务器执行——它可能已经完成并计费。再次生成会发起新的请求，可能产生重复调用与费用。</p>
        ) : (
          <p id="regenerate-description" className="my-3">当前结果尚未保存到本地卡库。重新生成将替换当前结果；即使新生成失败或取消，也无法恢复。可以先保存当前结果再生成。</p>
        )}
        {state.saveError && <p role="alert">{state.saveError}</p>}
        <div className="flex flex-wrap gap-2">
          <button autoFocus className={actionClass} disabled={busy} onClick={() => setConfirmRegenerate(false)}>取消</button>
          {confirmRegenerate === 'unsaved' && <button className={actionClass} disabled={busy} onClick={async () => { if (await session.saveResult()) { setConfirmRegenerate(false); generate(); } }}>{state.saving ? '正在保存…' : '保存后重新生成'}</button>}
          <button className={actionClass} disabled={busy} onClick={() => { setConfirmRegenerate(false); generate(true); }}>确定重新生成</button>
        </div>
      </dialog>
      {actionError && <p role="alert">{actionError}</p>}
      {actionInfo && <p role="status">{actionInfo}</p>}
      {state.message && <p role={state.phase === 'uncertain' ? 'alert' : 'status'}>{state.message}</p>}
      {state.reasoning && <AiReasoningPanel reasoning={state.reasoning} />}
      {state.card && <section aria-label="生成结果" className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">
          {state.cardKind === 'general'
            ? (typeof state.card.name === 'string' && state.card.name ? state.card.name : '未命名角色')
            : (typeof state.card.codename === 'string' && state.card.codename ? state.card.codename : '未命名魔法少女')}
          {' · '}{typeof state.card.signature === 'string' && state.card.signature
            ? (state.resultRestored ? '含签名字段（本机未验证）' : '官方签名')
            : '未签名'}
        </h2>
        {state.cardKind === 'general'
          ? <GeneralCharacterCard general={state.card as GeneralCharacterCardData} />
          : <MagicalGirlResultBody magicalGirl={state.card as unknown as MagicalGirlResultData} />}
        <button className={actionClass} disabled={!guard.ready || busy || state.saveStatus === 'saved' || state.saveStatus === 'already-present'} onClick={() => { if (guard.ready) void session.saveResult(); }}>{state.saving ? '正在保存…' : '保存到本地卡库'}</button>
        {state.saveStatus === 'saved' && <p role="status">已保存到本地卡库。</p>}
        {state.saveStatus === 'already-present' && <p role="status">本地卡库已存在相同内容，原记录保持不变。</p>}
        {state.saveError && <p role="alert">{state.saveError}</p>}
      </section>}
      {state.rawText && <details open={state.phase !== 'completed'}><summary>原始输出正文</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border p-3">{state.rawText}</pre></details>}
      <CardLibraryModal
        host={cardLibraryHost}
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelectCard={handleSelectQuestionnaireCard}
        selectedType="questionnaire"
        allowedTypes={['questionnaire']}
        titleOverride="选择问卷数据卡"
        // 本地页签离线可用且不要求登录，作为默认落点；云端页签失败只影响自身。
        initialTab="local"
        allowDeckImport={false}
      />
    </section>
  );
}

export function DesktopDetails() {
  const [session, setSession] = useState<DetailsSession | null>(null);
  useEffect(() => {
    const owner = new DetailsSession({
      storage: { getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: (key) => window.localStorage.removeItem(key) },
      repository: new IpcLocalCardRepository(invoke), initialDraft: { answers: {}, language: 'zh-CN' },
    });
    setSession(owner);
    const onPageHide = () => owner.cancel();
    window.addEventListener('pagehide', onPageHide);
    return () => { window.removeEventListener('pagehide', onPageHide); owner.dispose(); };
  }, []);
  return session ? <DetailsForm session={session} /> : <p role="status">正在准备问卷草稿…</p>;
}
