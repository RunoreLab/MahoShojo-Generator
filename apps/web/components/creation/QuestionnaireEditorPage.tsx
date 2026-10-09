'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildEditableQuestionnaire, importEditableQuestionnaire, createEmptyQuestion, type EditableQuestion } from '@mahoshojo/domain/questionnaire-editor';
import { QuestionnaireQuestionsEditor, QuestionnaireMetadataEditor, readQuestionnaireJsonFile } from '@mahoshojo/ui-web/questionnaire-editor';
import { downloadBlob } from '@/lib/client/blobUrl';
import Link from 'next/link';
import { useAppRouterAdapter } from '@/lib/app-router-adapter';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import Footer from '@/components/Footer';
import { ErrorMessage } from '@/components/ErrorMessage';
import DataCardsModal from '@/components/CharManager/DataCardsModal';
import RecycleBinModal from '@/components/CharManager/RecycleBinModal';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import { JsonSizeIndicator } from '@/components/shared/JsonSizeIndicator';
import {
  DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND,
  MAX_QUESTIONNAIRE_IMPORT_BYTES,
} from '@/lib/questionnaires';
import { dataCardApi } from '@/lib/auth';
import { useAuth } from '@/lib/useAuth';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { config } from '@/lib/config';
import { getDataCardVisibilityValue } from '@/lib/data-card-status';
import { useDataCardSummaryPage } from '@/lib/use-data-card-summary-page';
import { normalizeQuestionnaireDataCard } from '@/lib/questionnaire-data-card';
import { exceedsUtf8ByteLimit } from '@/lib/data-card-size';

export const QuestionnaireEditorPage: React.FC = () => {
  const router = useAppRouterAdapter();
  const importIntent = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; importIntent.current += 1; }; }, []);
  const { isAuthenticated, user } = useAuth();
  const [extensions, setExtensions] = useState<Record<string, unknown>>({});
  const [kind, setKind] = useState<'magical-girl' | 'canshou'>('magical-girl');
  const [questionnaireId, setQuestionnaireId] = useState('magical-girl-custom');
  const [title, setTitle] = useState('未命名问卷');
  const [description, setDescription] = useState('');
  const [loreMarkdown, setLoreMarkdown] = useState('');
  const [logoUrl, setLogoUrl] = useState(DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND['magical-girl']);
  const [version, setVersion] = useState('');
  const [questions, setQuestions] = useState<EditableQuestion[]>([createEmptyQuestion(0, 'magical-girl', 'initial-1')]);
  const [importText, setImportText] = useState('');
  const [originalSource, setOriginalSource] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [showDataCardsModal, setShowDataCardsModal] = useState(false);
  const [showRecycleBinModal, setShowRecycleBinModal] = useState(false);
  const [cardsRefresh, setCardsRefresh] = useState(0);
  const [recycleBinCards, setRecycleBinCards] = useState<any[]>([]);
  const [userCapacity, setUserCapacity] = useState<number | null>(null);
  const [userUsedSlots, setUserUsedSlots] = useState(0);
  const [editingCard, setEditingCard] = useState<any | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const cardsPerPage = 12;

  const questionnaireRecycleCards = useMemo(
    () => recycleBinCards
      .map((card) => normalizeQuestionnaireDataCard(card))
      .filter((card): card is NonNullable<typeof card> => card !== null),
    [recycleBinCards]
  );
  const questionnaireSummary = useDataCardSummaryPage('my', user?.id ?? null, isAuthenticated, {
    limit: 1, types: ['questionnaire'], includeLegacyQuestionnaires: true,
  });
  const { reload: refreshQuestionnaireSummary } = questionnaireSummary;
  const privateQuestionnaireCount = questionnaireSummary.stats?.private ?? '—';
  const publicQuestionnaireCount = questionnaireSummary.stats?.public ?? '—';
  const pendingQuestionnaireCount = questionnaireSummary.stats?.pending ?? '—';
  const defaultModalFilters = useMemo(
    () => ({ type: 'questionnaire' as const, visibility: 'private' as const }),
    []
  );

  const loadUserQuestionnaireCards = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setCardsRefresh((value) => value + 1);
      refreshQuestionnaireSummary();
      const [capacityInfo, recycleCards] = await Promise.all([
        dataCardApi.getUserCapacity(),
        dataCardApi.getRecycleBin(),
      ]);
      setRecycleBinCards(recycleCards);
      if (capacityInfo !== null) {
        setUserCapacity(capacityInfo.capacity);
        setUserUsedSlots(capacityInfo.usedSlots);
      }
    } catch (error) {
      console.error('加载问卷数据卡失败:', error);
    }
  }, [isAuthenticated, refreshQuestionnaireSummary]);

  useEffect(() => {
    if (isAuthenticated) {
      loadUserQuestionnaireCards();
    } else {
      setRecycleBinCards([]);
      setUserCapacity(null);
      setUserUsedSlots(0);
      setShowDataCardsModal(false);
      setShowRecycleBinModal(false);
    }
  }, [isAuthenticated, loadUserQuestionnaireCards]);

  const flashMessage = (message: string) => {
    setActionMessage(message);
    setTimeout(() => setActionMessage(null), 2400);
  };

  const { questionnaireData, jsonError } = useMemo(() => buildEditableQuestionnaire({ questions, questionnaireId, kind, title, description, loreMarkdown, logoUrl, version, extensions }), [questions, questionnaireId, kind, title, description, loreMarkdown, logoUrl, version, extensions]);

  const jsonPreview = useMemo(() => JSON.stringify(questionnaireData, null, 2), [questionnaireData]);

  const handleImport = (rawText?: string) => {
    importIntent.current += 1;
    const sourceText = typeof rawText === 'string' ? rawText : importText;
    if (!sourceText.trim()) {
      setEditorError('请先粘贴或上传问卷 JSON');
      return false;
    }
    // parse 前预算：逐码点计 UTF-8 字节、超限即停（与问卷选择导入同一上限）。
    if (exceedsUtf8ByteLimit(sourceText, MAX_QUESTIONNAIRE_IMPORT_BYTES)) {
      setEditorError(`问卷 JSON 超过大小上限（${MAX_QUESTIONNAIRE_IMPORT_BYTES / 1024 / 1024} MiB）。`);
      return false;
    }
    try {
      const imported = importEditableQuestionnaire(sourceText, kind);
      setEditorError(null);
      setImportText(sourceText);
      setKind(imported.kind);
      setQuestionnaireId(imported.questionnaireId);
      setTitle(imported.title);
      setDescription(imported.description);
      setLoreMarkdown(imported.loreMarkdown);
      setLogoUrl(imported.logoUrl);
      setVersion(imported.version);
      setExtensions(imported.extensions);
      setQuestions(imported.questions);
      setOriginalSource(sourceText);
      flashMessage('✅ 已导入问卷并应用');
      return true;
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : '问卷 JSON 解析失败');
      return false;
    }
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    const intent = ++importIntent.current;
    // `File.size` 不读内容即可拿到字节数：先于 file.text() 拦截超大输入。
    if (file.size > MAX_QUESTIONNAIRE_IMPORT_BYTES) {
      setEditorError(`问卷文件超过大小上限（${MAX_QUESTIONNAIRE_IMPORT_BYTES / 1024 / 1024} MiB）。`);
      return;
    }
    try {
      const text = await readQuestionnaireJsonFile(file);
      if (!mounted.current || intent !== importIntent.current) return;
      setImportText(text);
      handleImport(text);
    } catch (error) {
      if (mounted.current && intent === importIntent.current) setEditorError(error instanceof Error ? error.message : '读取文件失败');
    }
  };

  const handleImportInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    void handleImportFile(file);
    event.target.value = '';
  };

  const handlePasteFromClipboard = async () => {
    const intent = ++importIntent.current;
    try {
      const text = await navigator.clipboard.readText();
      if (!mounted.current || intent !== importIntent.current) return;
      if (!text.trim()) {
        setEditorError('剪贴板内容为空');
        return;
      }
      setImportText(text);
      handleImport(text);
    } catch (error) {
      if (mounted.current && intent === importIntent.current) setEditorError(error instanceof Error ? error.message : '读取剪贴板失败');
    }
  };

  const handleCopyJson = async () => {
    if (jsonError) {
      setEditorError(jsonError);
      return;
    }
    try {
      await navigator.clipboard.writeText(jsonPreview);
      flashMessage('✅ 已复制到剪贴板');
    } catch {
      setEditorError('复制失败，请手动选择文本');
    }
  };

  const handleDownloadJson = () => {
    if (jsonError) {
      setEditorError(jsonError);
      return;
    }
    const blob = new Blob([jsonPreview], { type: 'application/json' });
    const safeName = (title || 'questionnaire').replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
    downloadBlob(blob, `${safeName}.json`);
    flashMessage('✅ 已生成下载文件');
  };

  const handleOpenQuestionnaireLibrary = () => {
    if (!isAuthenticated) {
      setEditorError('请先登录后再访问云端问卷库');
      return;
    }
    loadUserQuestionnaireCards();
    setShowDataCardsModal(true);
  };

  const handleLoadQuestionnaireCard = async (card: any) => {
    const intent = ++importIntent.current;
    try {
      if (card?.isLegacyQuestionnaire) {
        const repairResult = await dataCardApi.repairQuestionnaireType(card.id);
        if (!repairResult.success) {
          throw new Error(repairResult.error || '恢复问卷数据卡类型失败');
        }
      }
      if (!mounted.current || intent !== importIntent.current) return;
      const raw = typeof card?.data === 'string' ? card.data : JSON.stringify(card?.data ?? {}, null, 2);
      if (!handleImport(raw)) return;
      setShowDataCardsModal(false);
      flashMessage(`✅ 已载入云端问卷：${card?.name || '未命名问卷'}`);
    } catch (error) {
      if (mounted.current && intent === importIntent.current) setEditorError(error instanceof Error ? error.message : '加载问卷数据卡失败');
    }
  };

  const handleDeleteQuestionnaireCard = async (id: string) => {
    if (!window.confirm('确定要删除这个问卷数据卡吗？')) return;
    const result = await dataCardApi.deleteCard(id);
    if (result.success) {
      flashMessage('✅ 问卷数据卡已移入回收站');
      loadUserQuestionnaireCards();
    } else {
      setEditorError(result.error || '删除失败');
    }
  };

  const handleRestoreQuestionnaireCard = async (id: string) => {
    const result = await dataCardApi.restoreCard(id);
    if (result.success) {
      flashMessage('✅ 问卷数据卡已恢复');
      loadUserQuestionnaireCards();
    } else {
      setEditorError(result.error || '恢复失败');
    }
  };

  const handleDeleteRecycleQuestionnaireCard = async (id: string) => {
    if (!window.confirm('确定要彻底删除这个问卷数据卡吗？此操作无法撤销。')) return;
    const result = await dataCardApi.deleteRecycleCard(id);
    if (result.success) {
      flashMessage('✅ 问卷数据卡已彻底删除');
      loadUserQuestionnaireCards();
    } else {
      setEditorError(result.error || '删除失败');
    }
  };

  const handleUpdateQuestionnaireCard = async (id: string, name: string, description: string, isPublic?: number) => {
    const textToCheck = `${name} ${description}`;
    const sensitiveWordResult = await quickCheck(textToCheck);
    if (sensitiveWordResult.hasSensitiveWords) {
      router.push('/arrested');
      return;
    }

    if (editingCard?.id === id && editingCard?.isLegacyQuestionnaire) {
      const repairResult = await dataCardApi.repairQuestionnaireType(id);
      if (!repairResult.success) {
        setEditorError(repairResult.error || '恢复问卷数据卡类型失败');
        return;
      }
    }

    const result = await dataCardApi.updateCard(id, name, description, isPublic);
    if (result.success) {
      setEditingCard(null);
      loadUserQuestionnaireCards();
      flashMessage('✅ 问卷信息已更新');
    } else {
      if (result.error === 'SENSITIVE_WORD_DETECTED' || (result as any).redirect === '/arrested') {
        router.push('/arrested');
        return;
      }
      setEditorError(result.error || '更新失败');
    }
  };

  const handleReplaceQuestionnaireCard = async (card: any) => {
    if (!window.confirm(`确认用当前编辑内容替换「${card.name}」吗？`)) return;
    const textToCheck = `${card.name} ${card.description} ${JSON.stringify(questionnaireData)}`;
    const sensitiveWordResult = await quickCheck(textToCheck);
    if (sensitiveWordResult.hasSensitiveWords) {
      router.push('/arrested');
      return;
    }
    if (card?.isLegacyQuestionnaire) {
      const repairResult = await dataCardApi.repairQuestionnaireType(card.id);
      if (!repairResult.success) {
        setEditorError(repairResult.error || '恢复问卷数据卡类型失败');
        return;
      }
    }
    const result = await dataCardApi.replaceCard(card.id, {
      name: card.name,
      description: card.description,
      isPublic: getDataCardVisibilityValue(card),
      data: questionnaireData,
    });
    if (result.success) {
      flashMessage(result.pendingReview ? '✅ 更新已提交审核，审核通过后生效' : '✅ 问卷已替换');
      loadUserQuestionnaireCards();
    } else {
      setEditorError(result.error || '替换失败');
    }
  };

  return (
    <>
      <div className="magic-background-white">
        <div className="container !max-w-[1100px]">
          <div className="card !max-w-none">
            <h1 className="sr-only">问卷编辑器</h1>
            <div className="text-center mb-6">
              <div className="flex justify-center">
                <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-fuchsia-500 px-6 py-3 shadow-lg">
                  <img src="/questionnaire-title.svg" alt="问卷编辑器" className="h-8 w-auto" />
                </div>
              </div>
              <p className="subtitle mt-3">把问卷当作可维护的创作工具箱</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs">
                <span className="rounded-full bg-pink-100 px-3 py-1 text-pink-700">条件显示 / 跳题</span>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">云端问卷库</span>
                <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-700">JSON 导入 / 导出</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
              <Link
                href="/details"
                className="rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-pink-700 hover:border-pink-300 hover:bg-pink-100"
              >
                前往魔法少女问卷
              </Link>
              <Link
                href="/canshou"
                className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-rose-700 hover:border-rose-300 hover:bg-rose-100"
              >
                前往残兽问卷
              </Link>
            </div>
            {actionMessage && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {actionMessage}
              </div>
            )}
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-800 mb-2">创建指引</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>问卷由「题目列表」组成，每道题可设置提示、选项与字数限制。</li>
                <li><code className="bg-slate-200 px-1 rounded">placeholder</code> 用于输入框提示，<code className="bg-slate-200 px-1 rounded">helperText</code> 用于补充说明。</li>
                <li><code className="bg-slate-200 px-1 rounded">suggestions</code> 会显示为灵感按钮（可逐条新增/删除）；<code className="bg-slate-200 px-1 rounded">options</code> 是推荐选项列表，支持设置「标签 / 内容 / 禁用」。</li>
                <li><code className="bg-slate-200 px-1 rounded">displayIf</code> 支持条件显示；<code className="bg-slate-200 px-1 rounded">jump</code> 可设置跳题规则。</li>
                <li><code className="bg-slate-200 px-1 rounded">optionsFrom</code> / <code className="bg-slate-200 px-1 rounded">suggestionsFrom</code> 可引用其他题目的选项或灵感。</li>
                <li>最大字数为建议上限，超出仍可提交但会影响原生性；留空表示不设题目上限（仍受统一原生上限影响）。</li>
                <li><code className="bg-slate-200 px-1 rounded">loreMarkdown</code> 是可选“设定文本”，会作为参考资料提供给 AI（不是题目，不需要作答）。</li>
                <li>Logo 仅支持站内路径或可信 HTTPS 外链，推荐使用下方快捷 Logo。</li>
                <li>更多高级字段可写入「额外字段 JSON」，会并入该题的最终结构。</li>
              </ul>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700">导入现有问卷</h3>
                    <p className="mt-1 text-xs text-slate-500">支持粘贴或上传 JSON，导入后会覆盖当前编辑内容。</p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePasteFromClipboard}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100"
                  >
                    从剪贴板导入
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-xs text-slate-500">上传问卷 JSON 文件</label>
                    <input
                      type="file"
                      accept="application/json"
                      onChange={handleImportInputChange}
                      className="input-field mt-1 file:mr-4 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-xs file:text-slate-600"
                    />
                    <p className="mt-1 text-xs text-slate-400">上传后会自动导入并应用。</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">粘贴问卷 JSON</label>
                    <textarea
                      value={importText}
                      onChange={(e) => { importIntent.current += 1; setImportText(e.target.value); }}
                      placeholder="在此粘贴问卷 JSON"
                      className="input-field mt-1 h-28"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => handleImport()}
                        className="rounded-lg border border-indigo-200 px-3 py-1 text-indigo-600 hover:text-indigo-700"
                      >
                        应用粘贴内容
                      </button>
                      <button
                        type="button"
                        onClick={() => { importIntent.current += 1; setImportText(''); }}
                        className="rounded-lg border border-slate-200 px-3 py-1 text-slate-500 hover:text-slate-700"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700">导出问卷</h3>
                    <p className="mt-1 text-xs text-slate-500">编辑导出会规范化字段；可另外下载未改动的导入来源。</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button onClick={handleCopyJson} className="rounded-full border border-indigo-200 px-3 py-1 text-indigo-600 hover:text-indigo-700">复制 JSON</button>
                    {originalSource !== null ? <button onClick={() => downloadBlob(new Blob([originalSource], { type: 'application/json' }), '问卷原始来源.json')} className="rounded-full border border-indigo-200 px-3 py-1 text-indigo-600 hover:text-indigo-700">下载原始来源</button> : null}
                    <button onClick={handleDownloadJson} className="rounded-full border border-indigo-200 px-3 py-1 text-indigo-600 hover:text-indigo-700">下载 JSON</button>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span>预览（{jsonPreview.length} 字符）</span>
                  <button
                    type="button"
                    onClick={() => setShowPreview((prev) => !prev)}
                    className="text-indigo-600 hover:underline"
                  >
                    {showPreview ? '收起预览' : '展开预览'}
                  </button>
                </div>
                {showPreview && (
                  <div className="mt-2 max-h-64 overflow-auto rounded-lg bg-white p-3 text-xs text-slate-600 whitespace-pre-wrap">
                    {jsonPreview}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700">云端问卷库</h3>
                  <p className="mt-1 text-xs text-slate-500">浏览、编辑你的私有问卷卡，并载入当前编辑器。</p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenQuestionnaireLibrary}
                  disabled={!isAuthenticated}
                  className={`rounded-lg border px-4 py-2 text-sm transition ${
                    isAuthenticated
                      ? 'border-pink-200 bg-pink-50 text-pink-700 hover:border-pink-300 hover:bg-pink-100'
                      : 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  打开问卷库
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 text-xs text-slate-600 md:grid-cols-3">
                <div className="rounded-lg border border-white/70 bg-white p-3">
                  <div className="text-slate-400">已保存问卷</div>
                  <div className="mt-1 text-base font-semibold text-slate-700">{questionnaireSummary.status === 'success' ? questionnaireSummary.total : '—'}</div>
                </div>
                <div className="rounded-lg border border-white/70 bg-white p-3">
                  <div className="text-slate-400">私有 / 公开</div>
                  <div className="mt-1 text-base font-semibold text-slate-700">
                    {privateQuestionnaireCount} / {publicQuestionnaireCount}
                  </div>
                </div>
                <div className="rounded-lg border border-white/70 bg-white p-3">
                  <div className="text-slate-400">待审核</div>
                  <div className="mt-1 text-base font-semibold text-slate-700">{pendingQuestionnaireCount}</div>
                </div>
              </div>
              {!isAuthenticated && (
                <p className="mt-3 text-xs text-rose-500">尚未登录，无法访问云端问卷库。</p>
              )}
              <p className="mt-2 text-xs text-slate-400">提示：默认展示私有问卷，可在筛选中切换公开状态。</p>
            </div>

            <QuestionnaireMetadataEditor value={{ questions, questionnaireId, kind, title, description, loreMarkdown, logoUrl, version, extensions }}
              onChange={(patch) => {
                importIntent.current += 1; setActionMessage(null);
                if (patch.kind !== undefined) setKind(patch.kind);
                if (patch.questionnaireId !== undefined) setQuestionnaireId(patch.questionnaireId);
                if (patch.title !== undefined) setTitle(patch.title);
                if (patch.description !== undefined) setDescription(patch.description);
                if (patch.loreMarkdown !== undefined) setLoreMarkdown(patch.loreMarkdown);
                if (patch.logoUrl !== undefined) setLogoUrl(patch.logoUrl);
                if (patch.version !== undefined) setVersion(patch.version);
              }} renderLoreStats={(text) => <TokenIndicator text={text} />} />

            <QuestionnaireQuestionsEditor questions={questions} setQuestions={(update) => { importIntent.current += 1; setActionMessage(null); setQuestions(update); }} kind={kind} />

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <SaveToCloudButton
                data={questionnaireData}
                getData={async () => {
                  if (jsonError) throw new Error(jsonError);
                  return questionnaireData;
                }}
                cardType="questionnaire"
                buttonText="保存为云端问卷"
                className="generate-button mb-0 w-full text-sm md:w-auto md:px-6 md:py-2"
              />
              <Link href="/" className="footer-link text-sm">返回首页</Link>
            </div>
            <JsonSizeIndicator
              data={questionnaireData}
              warningText="⚠️ 接近云端 300KB 上限，保存/替换可能失败，请先精简数据。"
            />

            {(editorError || jsonError) && <ErrorMessage message={editorError || jsonError || '问卷格式错误'} />}
            <p className="mt-4 text-xs text-slate-400">提示：原生许可由管理员评估标记；自建问卷默认非原生。</p>
          </div>
          <Footer />
        </div>
      </div>
      <DataCardsModal
        isOpen={showDataCardsModal}
        onClose={() => {
          importIntent.current += 1;
          setShowDataCardsModal(false);
          setEditingCard(null);
        }}
        dataCards={[]}
        summaryOwnerId={user?.id}
        refreshKey={cardsRefresh}
        editingCard={editingCard}
        currentPage={currentPage}
        cardsPerPage={cardsPerPage}
        onPageChange={setCurrentPage}
        onEditCard={setEditingCard}
        onUpdateCard={handleUpdateQuestionnaireCard}
        onDeleteCard={handleDeleteQuestionnaireCard}
        onLoadCard={handleLoadQuestionnaireCard}
        onCancelEdit={() => setEditingCard(null)}
        onReplaceCard={handleReplaceQuestionnaireCard}
        userCapacity={userCapacity ?? undefined}
        userUsedSlots={userUsedSlots}
        onOpenRecycleBin={() => {
          importIntent.current += 1;
          setShowDataCardsModal(false);
          setShowRecycleBinModal(true);
        }}
        recycleCount={questionnaireRecycleCards.length}
        title="我的问卷库"
        emptyText="暂无问卷数据卡"
        defaultFilters={defaultModalFilters}
        allowedTypes={['questionnaire']}
        hideRoleTypeFilter={true}
        showHotHint={false}
      />
      <RecycleBinModal
        isOpen={showRecycleBinModal}
        onClose={() => setShowRecycleBinModal(false)}
        recycleCards={questionnaireRecycleCards}
        onRestore={handleRestoreQuestionnaireCard}
        onDelete={handleDeleteRecycleQuestionnaireCard}
        limit={config.RECYCLE_BIN_LIMIT}
      />
    </>
  );
};
