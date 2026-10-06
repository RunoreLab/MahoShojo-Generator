import type { ReactNode } from 'react';

import type {
  QuestionnaireSelection,
  QuestionnaireSelectionSource,
} from '@mahoshojo/domain/questionnaire-selection';

/**
 * `/details` 问卷设置面板（多问卷/ Lore 注入/来源选择）。
 *
 * 区段结构（与 Web `DetailsPage` 问卷设置块一一对应）：
 * - 「允许同时回答多份问卷」开关与单选口径说明；
 * - 可作答问卷列表（有题目的 selection）；
 * - 设定（Lore）注入列表（声明了 loreMarkdown 的 selection，含纯设定卡）；
 * - 动作行：预设目录、上传 JSON、卡库选择（宿主注入）、粘贴导入、可选编辑器链接；
 * - 粘贴导入子块与各来源错误行。
 *
 * 组件本身不持有任何 I/O：预设取数、文件解析、卡库选择器与粘贴解析
 * 都由宿主回调完成；`onShowDetails` 缺省时「详情」入口按共享组件的
 * 「不提供即无入口」语义隐藏（DESK-PROD-001）。
 */

export interface QuestionnaireSelectionTheme {
  /** 面板外层容器。 */
  panel: string;
  /** 「问卷设置 ▲/▼」开关按钮。 */
  toggleButton: string;
  /** 展开后的内容容器。 */
  body: string;
  /** 顶部说明文字。 */
  introText: string;
  /** 多问卷 checkbox 行容器。 */
  optionsRow: string;
  /** 单选口径说明（关闭多选时的补充文案）。 */
  mutedHint: string;
  /** 非原生许可提示——警示色。 */
  warnText: string;
  /** 已超限（但保留原生许可）提示——告诫色。 */
  cautionText: string;
  /** 列表小标题（可作答问卷/设定（Lore）注入）。 */
  listLabel: string;
  /** 单个选择条目的卡片。 */
  subcard: string;
  /** 空列表占位卡。 */
  emptyCard: string;
  /** 选择条目标题。 */
  entryTitle: string;
  /** 选择条目元信息行。 */
  entryMeta: string;
  /** 条目右侧按钮区。 */
  entryActions: string;
  /** 「详情」等文字链接。 */
  textLink: string;
  /** 「移除」按钮（可点）。 */
  removeButton: string;
  /** 「移除」按钮（禁用）。 */
  removeButtonDisabled: string;
  /** 「使用设定」checkbox 行。 */
  loreToggleLabel: string;
  /** 动作行容器。 */
  actionsRow: string;
  /** 动作按钮（预设/上传/卡库）。 */
  actionButton: string;
  /** 粘贴导入切换按钮（Web 为 indigo-50 变体）。 */
  pasteToggleButton: string;
  /** 上传 label（带隐藏 file input）。 */
  uploadLabel: string;
  /** 粘贴导入子块容器。 */
  pasteCard: string;
  /** 粘贴区 label。 */
  pasteLabel: string;
  /** 「解析并载入」按钮。 */
  pasteApplyButton: string;
  /** 「清空」按钮。 */
  pasteClearButton: string;
  /** 错误文案。 */
  errorText: string;
}

/** Web `/details` 现行 indigo/slate 主题（原样保留页面观感）。 */
export const DETAILS_SELECTION_THEME: QuestionnaireSelectionTheme = {
  panel: 'details-questionnaire-settings-panel my-4 rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm',
  toggleButton: 'details-questionnaire-settings-toggle flex w-full items-center justify-between font-semibold text-indigo-700',
  body: 'mt-3 space-y-3 text-xs text-slate-600',
  introText: '',
  optionsRow: 'flex flex-wrap items-center gap-3',
  mutedHint: 'text-[11px] text-slate-500',
  warnText: 'text-rose-500',
  cautionText: 'text-amber-600',
  listLabel: 'text-[11px] font-semibold text-slate-500',
  subcard: 'details-questionnaire-subcard flex items-center justify-between rounded-lg border border-indigo-100 bg-white px-3 py-2',
  emptyCard: 'details-questionnaire-subcard rounded-lg border border-indigo-100 bg-white px-3 py-2 text-[11px] text-slate-500',
  entryTitle: 'font-semibold text-indigo-700',
  entryMeta: 'text-[11px] text-gray-500',
  entryActions: 'flex items-center gap-3',
  textLink: 'text-xs text-indigo-600 hover:underline',
  removeButton: 'text-xs text-rose-500 hover:underline',
  removeButtonDisabled: 'text-xs text-gray-300',
  loreToggleLabel: 'flex items-center gap-2 text-[11px] text-indigo-700',
  actionsRow: 'flex flex-wrap items-center gap-2',
  actionButton: 'details-questionnaire-action rounded-lg border border-indigo-200 bg-white px-3 py-1 text-xs text-indigo-600 hover:border-indigo-400',
  pasteToggleButton: 'details-questionnaire-action rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100',
  uploadLabel: 'details-questionnaire-action inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100 cursor-pointer',
  pasteCard: 'details-questionnaire-subcard rounded-lg border border-indigo-100 bg-white p-3 text-xs text-slate-600',
  pasteLabel: 'text-xs text-slate-500',
  pasteApplyButton: 'details-questionnaire-action rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100',
  pasteClearButton: 'text-xs text-slate-500 hover:text-slate-700',
  errorText: 'text-rose-500',
};

/** Web `/canshou` 现行 slate/emerald 深色主题（原样保留页面观感）。 */
export const CANSHOU_SELECTION_THEME: QuestionnaireSelectionTheme = {
  panel: 'my-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-200',
  toggleButton: 'flex w-full items-center justify-between font-semibold text-emerald-300',
  body: 'mt-3 space-y-3 text-xs text-slate-400',
  introText: '',
  optionsRow: 'flex flex-wrap items-center gap-3',
  mutedHint: 'text-[11px] text-slate-500',
  warnText: 'text-rose-400',
  cautionText: 'text-amber-300',
  listLabel: 'text-[11px] font-semibold text-slate-500',
  subcard: 'flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2',
  emptyCard: 'rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-[11px] text-slate-500',
  entryTitle: 'font-semibold text-emerald-200',
  entryMeta: 'text-[11px] text-slate-500',
  entryActions: 'flex items-center gap-3',
  textLink: 'text-xs text-emerald-300 hover:underline',
  removeButton: 'text-xs text-rose-400 hover:underline',
  removeButtonDisabled: 'text-xs text-slate-700',
  loreToggleLabel: 'flex items-center gap-2 text-[11px] text-emerald-200',
  actionsRow: 'flex flex-wrap items-center gap-2',
  actionButton: 'rounded-lg border border-emerald-500/40 bg-slate-900 px-3 py-1 text-xs text-emerald-300 hover:border-emerald-400',
  pasteToggleButton: 'rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200 hover:border-emerald-300 hover:bg-emerald-500/20',
  uploadLabel: 'inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200 hover:border-emerald-300 hover:bg-emerald-500/20 cursor-pointer',
  pasteCard: 'rounded-lg border border-slate-700 bg-slate-900/80 p-3 text-xs text-slate-300',
  pasteLabel: 'text-xs text-slate-500',
  pasteApplyButton: 'rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200 hover:border-emerald-300 hover:bg-emerald-500/20',
  pasteClearButton: 'text-xs text-slate-500 hover:text-slate-200',
  errorText: 'text-rose-400',
};

/**
 * Desktop app-token 主题。`details-questionnaire-*` 标记类与 Web 一致——
 * 共享 `styles.css` 里的暗色 remap 对两端生效。
 */
export const APP_SELECTION_THEME: QuestionnaireSelectionTheme = {
  panel: 'details-questionnaire-settings-panel my-4 rounded-xl border border-(--app-border) bg-(--app-surface-70) p-4 text-sm',
  toggleButton: 'details-questionnaire-settings-toggle flex w-full items-center justify-between font-semibold text-(--app-accent-strong)',
  body: 'mt-3 space-y-3 text-xs text-(--app-text-muted)',
  introText: '',
  optionsRow: 'flex flex-wrap items-center gap-3',
  mutedHint: 'text-[11px] text-(--app-text-subtle)',
  warnText: 'text-rose-500',
  cautionText: 'text-amber-600',
  listLabel: 'text-[11px] font-semibold text-(--app-text-subtle)',
  subcard: 'details-questionnaire-subcard flex items-center justify-between rounded-lg border border-(--app-border) bg-(--app-surface) px-3 py-2',
  emptyCard: 'details-questionnaire-subcard rounded-lg border border-(--app-border) bg-(--app-surface) px-3 py-2 text-[11px] text-(--app-text-subtle)',
  entryTitle: 'font-semibold text-(--app-accent-strong)',
  entryMeta: 'text-[11px] text-(--app-text-subtle)',
  entryActions: 'flex items-center gap-3',
  textLink: 'text-xs text-(--app-accent-strong) hover:underline',
  removeButton: 'text-xs text-rose-500 hover:underline',
  removeButtonDisabled: 'text-xs text-(--app-text-subtle) opacity-60',
  loreToggleLabel: 'flex items-center gap-2 text-[11px] text-(--app-accent-strong)',
  actionsRow: 'flex flex-wrap items-center gap-2',
  actionButton: 'details-questionnaire-action rounded-lg border border-(--app-border) bg-(--app-surface) px-3 py-1 text-xs text-(--app-accent-strong) hover:border-(--app-accent-strong)',
  pasteToggleButton: 'details-questionnaire-action rounded-lg border border-(--app-border) bg-(--app-surface-80) px-3 py-1 text-xs text-(--app-accent-strong) hover:bg-(--app-surface)',
  uploadLabel: 'details-questionnaire-action inline-flex items-center gap-2 rounded-lg border border-(--app-border) bg-(--app-surface-80) px-3 py-1 text-xs font-medium text-(--app-accent-strong) hover:bg-(--app-surface) cursor-pointer',
  pasteCard: 'details-questionnaire-subcard rounded-lg border border-(--app-border) bg-(--app-surface) p-3 text-xs text-(--app-text-muted)',
  pasteLabel: 'text-xs text-(--app-text-subtle)',
  pasteApplyButton: 'details-questionnaire-action rounded-lg border border-(--app-border) bg-(--app-surface-80) px-3 py-1 text-xs text-(--app-accent-strong) hover:bg-(--app-surface)',
  pasteClearButton: 'text-xs text-(--app-text-subtle) hover:text-(--app-text-muted)',
  errorText: 'text-rose-500',
};

export interface QuestionnairePresetOption {
  readonly id: string;
  readonly title: string;
}

export interface QuestionnaireSelectionPanelProps {
  theme?: QuestionnaireSelectionTheme;
  expanded: boolean;
  onToggleExpanded: () => void;
  allowMultiple: boolean;
  onAllowMultipleChange: (next: boolean) => void;
  /** 当前完整选择集（组件内部拆出可作答/Lore 两个列表）。 */
  selections: readonly QuestionnaireSelection[];
  /** 是否禁用所有「移除」入口（宿主口径：仅剩一个选择时禁删）。 */
  shouldDisableRemove: boolean;
  onRemoveSelection: (selectionId: string) => void;
  onToggleLore: (selectionId: string, enabled: boolean) => void;
  /** 提供时渲染「详情」入口；缺省时隐藏。 */
  onShowDetails?: (selection: QuestionnaireSelection) => void;
  /** 当前选择集是否整体具备原生许可。 */
  nativeAllowed: boolean;
  /** 是否有答案超过原生统一上限（仅 nativeAllowed 时展示提示）。 */
  hasOverLimitAnswer: boolean;
  nativeMaxAnswerChars: number;
  presets: readonly QuestionnairePresetOption[];
  onSelectPreset: (presetId: string) => void;
  onUploadFile: (file: File) => void;
  /** 卡库选择器入口；缺省时整条按钮隐藏。 */
  pickerLabel?: string;
  onOpenPicker?: () => void;
  /** 「打开问卷编辑器」等宿主链接节点；缺省隐藏。 */
  editorLink?: ReactNode;
  pasteExpanded: boolean;
  onTogglePasteExpanded: () => void;
  pasteText: string;
  onPasteTextChange: (text: string) => void;
  onApplyPaste: () => void;
  onClearPaste: () => void;
  pasteError?: string | null;
  error?: string | null;
  disabled?: boolean;
  /** 面板顶部说明文案；缺省为 Web 口径（含云端问卷库表述）。 */
  description?: ReactNode;
}

const sourceLabel = (source: QuestionnaireSelectionSource): string =>
  source === 'preset' ? '预设' : source === 'upload' ? '本地上传' : '云端问卷';

const selectionScopeId = (selection: QuestionnaireSelection): string =>
  selection.selectionId ?? selection.questionnaire.id;

const selectionMeta = (selection: QuestionnaireSelection, loreStatus: string): string => {
  const parts = [
    `来源：${sourceLabel(selection.source)}`,
    ...(selection.dataCardAuthor ? [`作者：${selection.dataCardAuthor}`] : []),
    selection.questionnaire.nativeAllowed ? '原生许可' : '非原生',
    ...(loreStatus ? [loreStatus] : []),
  ];
  return parts.join(' · ');
};

export function QuestionnaireSelectionPanel({
  theme = DETAILS_SELECTION_THEME,
  expanded,
  onToggleExpanded,
  allowMultiple,
  onAllowMultipleChange,
  selections,
  shouldDisableRemove,
  onRemoveSelection,
  onToggleLore,
  onShowDetails,
  nativeAllowed,
  hasOverLimitAnswer,
  nativeMaxAnswerChars,
  presets,
  onSelectPreset,
  onUploadFile,
  pickerLabel,
  onOpenPicker,
  editorLink,
  pasteExpanded,
  onTogglePasteExpanded,
  pasteText,
  onPasteTextChange,
  onApplyPaste,
  onClearPaste,
  pasteError,
  error,
  disabled = false,
  description,
}: QuestionnaireSelectionPanelProps) {
  const answerableSelections = selections.filter(
    (selection) => selection.questionnaire.questions.length > 0,
  );
  const loreSelections = selections.filter(
    (selection) => Boolean(selection.questionnaire.loreMarkdown?.trim()),
  );

  return (
    <div className={theme.panel}>
      <button type="button" onClick={onToggleExpanded} className={theme.toggleButton}>
        <span>问卷设置</span>
        <span>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className={theme.body}>
          <p className={theme.introText}>
            {description ?? '你可以选择预设、上传或从云端问卷库挑选。多问卷只影响题目顺序；设定（Lore）可单独启用/禁用。'}
          </p>
          <div className={theme.optionsRow}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allowMultiple}
                disabled={disabled}
                onChange={(event) => onAllowMultipleChange(event.target.checked)}
              />
              允许同时回答多份问卷
            </label>
            {!allowMultiple && (
              <span className={theme.mutedHint}>关闭时：仅允许 1 份可作答问卷，但仍可叠加纯设定卡。</span>
            )}
            {!nativeAllowed && (
              <span className={theme.warnText}>提示：当前问卷未获得原生许可，生成结果将不具备原生性。</span>
            )}
            {nativeAllowed && hasOverLimitAnswer && (
              <span className={theme.cautionText}>提示：已有答案超过字数上限（原生统一上限 {nativeMaxAnswerChars} 字），生成结果将不具备原生性。</span>
            )}
          </div>
          <div className="space-y-2">
            <div className={theme.listLabel}>可作答问卷（题目）</div>
            {answerableSelections.length === 0 ? (
              <div className={theme.emptyCard}>暂无可作答问卷</div>
            ) : (
              answerableSelections.map((selection) => {
                const selectionId = selectionScopeId(selection);
                const hasLore = Boolean(selection.questionnaire.loreMarkdown?.trim());
                const loreStatus = hasLore ? (selection.useLore !== false ? '设定：启用' : '设定：关闭') : '';
                return (
                  <div key={selectionId} className={theme.subcard}>
                    <div>
                      <div className={theme.entryTitle}>{selection.questionnaire.title}</div>
                      <div className={theme.entryMeta}>{selectionMeta(selection, loreStatus)}</div>
                    </div>
                    <div className={theme.entryActions}>
                      {onShowDetails && (
                        <button type="button" onClick={() => onShowDetails(selection)} className={theme.textLink}>
                          详情
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={disabled || shouldDisableRemove}
                        onClick={() => onRemoveSelection(selectionId)}
                        className={shouldDisableRemove ? theme.removeButtonDisabled : theme.removeButton}
                      >
                        移除
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="space-y-2">
            <div className={theme.listLabel}>设定（Lore）注入</div>
            {loreSelections.length === 0 ? (
              <div className={theme.emptyCard}>暂无设定来源</div>
            ) : (
              loreSelections.map((selection) => {
                const selectionId = selectionScopeId(selection);
                const isLoreOnly = selection.questionnaire.questions.length === 0;
                return (
                  <div key={selectionId} className={theme.subcard}>
                    <div>
                      <div className={theme.entryTitle}>{selection.questionnaire.title}</div>
                      <div className={theme.entryMeta}>
                        {selectionMeta(selection, isLoreOnly ? '仅设定' : '来自问卷')}
                      </div>
                    </div>
                    <div className={theme.entryActions}>
                      <label className={theme.loreToggleLabel}>
                        <input
                          type="checkbox"
                          checked={selection.useLore !== false}
                          disabled={disabled}
                          onChange={(event) => onToggleLore(selectionId, event.target.checked)}
                        />
                        使用设定
                      </label>
                      {onShowDetails && (
                        <button type="button" onClick={() => onShowDetails(selection)} className={theme.textLink}>
                          详情
                        </button>
                      )}
                      {isLoreOnly && (
                        <button
                          type="button"
                          disabled={disabled || shouldDisableRemove}
                          onClick={() => onRemoveSelection(selectionId)}
                          className={shouldDisableRemove ? theme.removeButtonDisabled : theme.removeButton}
                        >
                          移除
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className={theme.actionsRow}>
            <select
              className="input-field text-xs"
              disabled={disabled}
              onChange={(event) => {
                if (event.target.value) {
                  onSelectPreset(event.target.value);
                  event.currentTarget.value = '';
                }
              }}
              defaultValue=""
            >
              <option value="" disabled>选择预设问卷</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.title}</option>
              ))}
            </select>
            <label className={theme.uploadLabel}>
              上传问卷 JSON
              <input
                type="file"
                accept="application/json"
                disabled={disabled}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.currentTarget.value = '';
                  if (file) onUploadFile(file);
                }}
                className="hidden"
              />
            </label>
            {onOpenPicker && (
              <button type="button" disabled={disabled} onClick={onOpenPicker} className={theme.actionButton}>
                {pickerLabel ?? '从云端问卷库选择'}
              </button>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={onTogglePasteExpanded}
              className={theme.pasteToggleButton}
            >
              {pasteExpanded ? '收起粘贴导入' : '粘贴导入 JSON'}
            </button>
            {editorLink}
          </div>
          {pasteExpanded && (
            <div className={theme.pasteCard}>
              <label className={theme.pasteLabel}>粘贴问卷 JSON</label>
              <textarea
                value={pasteText}
                onChange={(event) => onPasteTextChange(event.target.value)}
                placeholder="在此粘贴问卷 JSON"
                className="input-field mt-2 h-28"
                rows={6}
                disabled={disabled}
              />
              <div className="mt-2 flex items-center justify-between">
                <button type="button" disabled={disabled} onClick={onApplyPaste} className={theme.pasteApplyButton}>
                  解析并载入
                </button>
                <button type="button" disabled={disabled} onClick={onClearPaste} className={theme.pasteClearButton}>
                  清空
                </button>
              </div>
              {pasteError && <p className={`mt-2 ${theme.errorText}`}>{pasteError}</p>}
            </div>
          )}
          {error && <p className={theme.errorText}>{error}</p>}
        </div>
      )}
    </div>
  );
}
