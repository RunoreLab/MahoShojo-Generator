import React, { useMemo, useState } from 'react';
import {
  buildQuestionnaireAnswerLookup,
  resolveQuestionnaireAnswerTarget,
  type QuestionnaireAnswerMatchTarget,
} from '@mahoshojo/domain/questionnaire';
import { parseBulkQuestionnaireAnswers, type BulkParseFormat } from '@mahoshojo/domain/questionnaire-bulk-parser';
import {
  applyQuestionnaireAnswerImportEntries,
  extractQuestionnaireAnswersFromCharacterCard,
  type QuestionnaireAnswerMergeMode,
} from '@mahoshojo/domain/questionnaire-answer-import';

export type BulkAnswerToolsVariant = 'light' | 'dark' | 'app';

export interface BulkAnswerToolsProps<T extends QuestionnaireAnswerMatchTarget = QuestionnaireAnswerMatchTarget> {
  /**
   * 全部题目的匹配目标（含 displayIf/jump 隐藏的题）：批量解析的
   * expectedCount/有序键与元数据键解析都以全集为准。
   */
  targets: T[];
  /**
   * 无元数据条目的序号回落目标——可见流序（求值后的 mergedQuestions）。
   * 与 Web `/details` handleBulkFill 同口径；缺省回退到 `targets`。
   */
  indexFallbackTargets?: T[];
  answersByKey: Record<string, string>;
  /** 填充/导入成功后回传新的按键回答集，页面负责同步当前题输入框。 */
  onApplyAnswers: (next: Record<string, string>) => void;
  /** 成功/统计提示（Web 用 alert；Desktop 用页面状态文案）。 */
  onInfo?: (message: string) => void;
  onError?: (message: string) => void;
  /** 可选的「清空存档」按钮：存档语义各端不同，由页面注入。 */
  onClearDraft?: () => void;
  /** 受控折叠（Web 把 UI 折叠态写进草稿）；缺省为非受控内部状态。 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  variant?: BulkAnswerToolsVariant;
}

type ThemeClasses = {
  container: string;
  toggle: string;
  textarea: string;
  fillButton: string;
  clearButton: string;
  importBox: string;
  importTitle: string;
  importHint: string;
  mergeSelect: string;
  fileLabel: string;
};

const THEMES: Record<BulkAnswerToolsVariant, ThemeClasses> = {
  light: {
    container: 'my-4 bg-gray-100 rounded-lg p-3',
    toggle: 'flex items-center justify-between w-full text-left font-medium text-gray-700 hover:text-blue-600',
    textarea: 'input-field h-20',
    fillButton: 'text-sm text-blue-600 hover:underline',
    clearButton: 'text-sm text-red-600 hover:underline',
    importBox: 'mt-4 rounded-lg border border-blue-100 bg-white p-3',
    importTitle: 'text-sm font-medium text-gray-700',
    importHint: 'mt-1 text-xs text-gray-500',
    mergeSelect: 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700',
    fileLabel: 'mt-3 inline-flex cursor-pointer items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:border-blue-300 hover:bg-blue-100',
  },
  dark: {
    container: 'my-4 rounded-lg border border-slate-700 bg-slate-900/60 p-3',
    toggle: 'flex items-center justify-between w-full text-left font-medium text-slate-200 hover:text-emerald-300',
    textarea: 'h-20 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100',
    fillButton: 'text-sm text-emerald-300 hover:underline',
    clearButton: 'text-sm text-rose-300 hover:underline',
    importBox: 'mt-4 rounded-lg border border-slate-700 bg-slate-950/40 p-3',
    importTitle: 'text-sm font-medium text-slate-200',
    importHint: 'mt-1 text-xs text-slate-400',
    mergeSelect: 'rounded-lg border border-slate-600 bg-slate-950/40 px-3 py-2 text-xs text-slate-200',
    fileLabel: 'mt-3 inline-flex cursor-pointer items-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200 hover:border-emerald-300 hover:bg-emerald-500/20',
  },
  app: {
    container: 'my-4 rounded-lg border border-(--app-border) bg-(--app-surface) p-3',
    toggle: 'flex items-center justify-between w-full text-left font-medium text-(--app-text) hover:opacity-80',
    textarea: 'h-20 w-full rounded border border-(--app-border) bg-(--app-surface) px-3 py-2 text-sm text-(--app-text)',
    fillButton: 'text-sm text-(--app-text) underline',
    clearButton: 'text-sm text-red-500 hover:underline',
    importBox: 'mt-4 rounded-lg border border-(--app-border) p-3',
    importTitle: 'text-sm font-medium text-(--app-text)',
    importHint: 'mt-1 text-xs text-(--app-text-muted)',
    mergeSelect: 'rounded-lg border border-(--app-border) bg-(--app-surface) px-3 py-2 text-xs text-(--app-text)',
    fileLabel: 'mt-3 inline-flex cursor-pointer items-center rounded-lg border border-(--app-border) px-3 py-2 text-sm font-medium text-(--app-text) hover:opacity-80',
  },
};

const FORMAT_LABELS: Record<BulkParseFormat, string> = {
  qa: 'Q/A',
  json: 'JSON',
  paragraphs: '段落',
  lines: '逐行',
  unknown: '未知',
};

/**
 * 「一键填充答案」+「角色卡 JSON 导入」共享区段。
 *
 * 处理逻辑与 Web `/details` 的 handleBulkFill/handleCharacterCardAnswerImport
 * 同一语义，全部走 domain 纯函数；区别只在成功/失败消息经回调交给宿主呈现。
 */
export function BulkAnswerTools<T extends QuestionnaireAnswerMatchTarget>({
  targets,
  indexFallbackTargets,
  answersByKey,
  onApplyAnswers,
  onInfo,
  onError,
  onClearDraft,
  open: openProp,
  onOpenChange,
  disabled = false,
  variant = 'light',
}: BulkAnswerToolsProps<T>) {
  const classes = THEMES[variant];
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };
  const [bulkAnswers, setBulkAnswers] = useState('');
  const [mergeMode, setMergeMode] = useState<QuestionnaireAnswerMergeMode>('fill-empty');
  const lookup = useMemo(() => buildQuestionnaireAnswerLookup(targets), [targets]);

  const handleBulkFill = () => {
    if (targets.length === 0) {
      onError?.('当前没有可填充的题目，请先选择问卷。');
      return;
    }
    const parsed = parseBulkQuestionnaireAnswers(bulkAnswers, {
      expectedCount: targets.length,
      orderedQuestionIds: targets.map((item) => item.questionId ?? ''),
      orderedQuestionKeys: targets.map((item) => item.key),
    });
    if (parsed.entries.length === 0) {
      onError?.('未识别到可填充的答案。支持逐行答案、Q/A 格式、编号列表，以及 JSON（数组/含 userAnswers/问卷回答）。');
      return;
    }

    const nextAnswers = { ...answersByKey };
    let appliedCount = 0;
    let ignoredCount = 0;
    for (const entry of parsed.entries) {
      const hasMetadata = Boolean(
        entry.key || entry.question || entry.questionId || entry.questionnaireId || entry.questionnaireTitle,
      );
      const target = hasMetadata
        ? resolveQuestionnaireAnswerTarget(lookup, entry, { allowIndexFallback: false })
        : (indexFallbackTargets ?? targets)[entry.index] ?? null;
      if (!target) {
        ignoredCount += 1;
        continue;
      }
      if (!entry.value.trim()) {
        ignoredCount += 1;
        continue;
      }
      nextAnswers[target.key] = entry.value;
      appliedCount += 1;
    }
    onApplyAnswers(nextAnswers);
    onInfo?.(`成功填充了 ${appliedCount} 个答案（识别格式：${FORMAT_LABELS[parsed.format]}${ignoredCount > 0 ? `，忽略了 ${ignoredCount} 条无效或超出范围的内容` : ''}）！`);
    setBulkAnswers('');
  };

  const handleCharacterCardAnswerImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (targets.length === 0) {
      onError?.('当前没有可填充的题目，请先选择问卷。');
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const extracted = extractQuestionnaireAnswersFromCharacterCard(parsed);
      if (!extracted.success) {
        onError?.(extracted.error);
        return;
      }
      const applied = applyQuestionnaireAnswerImportEntries({
        currentAnswersByKey: answersByKey,
        targets,
        lookup,
        entries: extracted.entries,
        mergeMode,
      });
      onApplyAnswers(applied.answersByKey);
      const skippedExisting = extracted.entries.length - applied.appliedCount - applied.ignoredCount;
      const modeLabel = mergeMode === 'overwrite' ? '覆盖匹配题' : '只填空题';
      onInfo?.(
        `已从${extracted.sourceLabel}导入问卷答案（${modeLabel}）：成功填充 ${applied.appliedCount} 条` +
        `${applied.overwrittenCount > 0 ? `，覆盖 ${applied.overwrittenCount} 条` : ''}` +
        `${skippedExisting > 0 ? `，保留已有 ${skippedExisting} 条` : ''}` +
        `${applied.ignoredCount > 0 ? `，忽略 ${applied.ignoredCount} 条未匹配内容` : ''}。`,
      );
    } catch (error) {
      const message = error instanceof SyntaxError
        ? '角色卡 JSON 无法解析：请检查文件内容是否为有效 JSON。'
        : error instanceof Error
          ? error.message
          : '导入角色卡答案失败。';
      onError?.(message);
    }
  };

  return (
    <div className={classes.container}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={classes.toggle}
      >
        <span>一键填充答案</span>
        <span className="ml-2">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div className="mt-3">
          <textarea
            value={bulkAnswers}
            onChange={(event) => setBulkAnswers(event.target.value)}
            placeholder="在此处粘贴所有答案：支持每行一个、Q/A 复制内容、编号列表、JSON。"
            className={classes.textarea}
            rows={4}
            disabled={disabled}
          />
          <div className="flex justify-between items-center mt-2">
            <button type="button" onClick={handleBulkFill} disabled={disabled} className={classes.fillButton}>填充</button>
            {onClearDraft && (
              <button type="button" onClick={onClearDraft} disabled={disabled} className={classes.clearButton}>清空存档</button>
            )}
          </div>
          <div className={classes.importBox}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className={classes.importTitle}>从角色卡 JSON 导入答案</p>
                <p className={classes.importHint}>支持本仓库角色 JSON、万途互通 JSON 与万途往返 JSON。</p>
              </div>
              <select
                aria-label="导入合并方式"
                value={mergeMode}
                onChange={(event) => setMergeMode(event.target.value as QuestionnaireAnswerMergeMode)}
                className={classes.mergeSelect}
                disabled={disabled}
              >
                <option value="fill-empty">只填空题</option>
                <option value="overwrite">覆盖匹配题</option>
              </select>
            </div>
            <label className={classes.fileLabel}>
              选择角色卡 JSON
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                disabled={disabled}
                onChange={(event) => { void handleCharacterCardAnswerImport(event); }}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
