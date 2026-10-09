import { useId, type ReactNode } from 'react';
import type { QuestionnairePresetEntry } from '@mahoshojo/domain/questionnaire-definition';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import { shouldInterceptInternalLinkClick } from '../link-click';

export interface SublimationLoreSelectionProps {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  disabled: boolean;
  selections: readonly QuestionnaireSelection[];
  presets: readonly Pick<QuestionnairePresetEntry, 'id' | 'kind' | 'title'>[];
  onSelectPreset: (id: string) => void;
  onUpload: (file: File | null) => void;
  onOpenPicker: () => void;
  pickerLabel?: string;
  onToggleLore: (selectionId: string, enabled: boolean) => void;
  onRemove: (selectionId: string) => void;
  onDetails: (selection: QuestionnaireSelection) => void;
  pasteExpanded: boolean;
  onPasteExpandedChange: (expanded: boolean) => void;
  pasteText: string;
  onPasteTextChange: (value: string) => void;
  onPasteImport: () => void;
  onPasteClear: () => void;
  loadError?: string | null;
  pasteError?: string | null;
  tokenIndicator?: ReactNode;
  warnNonNative?: boolean;
  /** Optional host-owned free-text Lore, including legacy restored drafts. */
  supplementalLore?: { text: string; onChange: (text: string) => void };
  /** 只有已提供编辑器入口的宿主才传入，避免生成不可用的链接。 */
  editorNavigation?: { href?: string; onNavigate?: (href: string) => void };
}

/** Web/Desktop 共用 Lore 选择面；解析、来源读取与选择状态均由宿主持有。 */
export function SublimationLoreSelection({
  expanded,
  onExpandedChange,
  disabled,
  selections,
  presets,
  onSelectPreset,
  onUpload,
  onOpenPicker,
  pickerLabel = '从云端问卷库选择',
  onToggleLore,
  onRemove,
  onDetails,
  pasteExpanded,
  onPasteExpandedChange,
  pasteText,
  onPasteTextChange,
  onPasteImport,
  onPasteClear,
  loadError,
  pasteError,
  tokenIndicator,
  warnNonNative = false,
  supplementalLore,
  editorNavigation,
}: SublimationLoreSelectionProps) {
  const id = useId();
  const panelId = `${id}-lore`;
  const pastePanelId = `${id}-paste`;
  const supplementalInputId = `${id}-supplemental-lore`;
  const pasteInputId = `${id}-paste-json`;
  const pasteErrorId = `${id}-paste-error`;
  const editorHref = editorNavigation?.href ?? '/questionnaire-editor';

  return (
    <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-900">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => onExpandedChange(!expanded)}
        className="flex items-center justify-between w-full text-left font-medium text-purple-800 hover:text-purple-900"
        disabled={disabled}
      >
        <span>设定（Lore）注入：选择问卷/设定卡{supplementalLore?.text.trim() ? ' · 含补充设定' : ''}</span>
        <span className="ml-2" aria-hidden="true">{expanded ? '▼' : '▶'}</span>
      </button>
      <div id={panelId} hidden={!expanded}>
        {expanded && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-purple-700">
              选择问卷/设定卡，将其中的 <code>loreMarkdown</code> 作为【参考设定】注入到升华提示词中（不是题目，不需要作答）。
            </p>
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-purple-700">已选择的设定来源</div>
              {selections.length === 0 ? (
                <div className="rounded-lg border border-purple-200 bg-white px-3 py-2 text-[11px] text-gray-500">
                  暂无设定来源
                </div>
              ) : selections.map((selection) => {
                const selectionId = selection.selectionId ?? selection.questionnaire.id;
                const hasLore = Boolean(selection.questionnaire.loreMarkdown?.trim());
                const sourceLabel = selection.source === 'preset' ? '预设' : selection.source === 'upload' ? '本地上传' : '云端问卷';
                // 上传卡内的自报许可不能成为官方原生许可的展示依据。
                const nativeLabel = selection.source !== 'upload' && selection.questionnaire.nativeAllowed === true ? '原生许可' : '非原生';
                return (
                  <div key={selectionId} className="flex items-center justify-between rounded-lg border border-purple-200 bg-white px-3 py-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-purple-800 truncate">{selection.questionnaire.title}</div>
                      <div className="text-[11px] text-gray-500">
                        来源：{sourceLabel}
                        {selection.dataCardAuthor ? ` · 作者：${selection.dataCardAuthor}` : ''}
                        {` · ${nativeLabel}`}
                        {!hasLore ? ' · 无设定' : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className={`flex items-center gap-2 text-[11px] ${hasLore ? 'text-purple-800' : 'text-gray-400'}`}>
                        <input
                          type="checkbox"
                          aria-label={`使用设定：${selection.questionnaire.title}`}
                          checked={selection.useLore !== false && hasLore}
                          disabled={!hasLore || disabled}
                          onChange={(event) => onToggleLore(selectionId, event.target.checked)}
                        />
                        使用设定
                      </label>
                      <button
                        type="button"
                        aria-label={`查看${selection.questionnaire.title}详情`}
                        onClick={() => onDetails(selection)}
                        disabled={disabled}
                        className="text-xs text-purple-700 hover:underline disabled:text-gray-300"
                      >
                        详情
                      </button>
                      <button
                        type="button"
                        aria-label={`移除${selection.questionnaire.title}`}
                        onClick={() => onRemove(selectionId)}
                        disabled={disabled}
                        className="text-xs text-rose-500 hover:underline disabled:text-gray-300"
                      >
                        移除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="选择预设问卷/设定卡"
                className="input-field text-xs"
                onChange={(event) => {
                  if (event.target.value) {
                    onSelectPreset(event.target.value);
                    event.currentTarget.value = '';
                  }
                }}
                defaultValue=""
                disabled={disabled}
              >
                <option value="" disabled>选择预设问卷/设定卡</option>
                {presets.map((preset) => (
                  <option key={`${preset.kind}:${preset.id}`} value={preset.id}>
                    {preset.kind === 'canshou' ? '残兽' : '魔法少女'} · {preset.title}
                  </option>
                ))}
              </select>
              <label className={`relative inline-flex items-center gap-2 rounded-lg border border-purple-200 bg-white px-3 py-1 text-xs font-medium text-purple-700 hover:border-purple-300 focus-within:outline focus-within:outline-2 focus-within:outline-purple-500 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                上传问卷 JSON
                <input
                  type="file"
                  accept="application/json"
                  onChange={(event) => {
                    onUpload(event.target.files?.[0] ?? null);
                    event.currentTarget.value = '';
                  }}
                  className="sr-only"
                  disabled={disabled}
                />
              </label>
              <button
                type="button"
                onClick={onOpenPicker}
                className="rounded-lg border border-purple-200 bg-white px-3 py-1 text-xs text-purple-700 hover:border-purple-300 disabled:opacity-50"
                disabled={disabled}
              >
                {pickerLabel}
              </button>
              <button
                type="button"
                aria-expanded={pasteExpanded}
                aria-controls={pastePanelId}
                onClick={() => onPasteExpandedChange(!pasteExpanded)}
                className="rounded-lg border border-purple-200 bg-purple-100 px-3 py-1 text-xs text-purple-800 hover:border-purple-300 hover:bg-purple-200 disabled:opacity-50"
                disabled={disabled}
              >
                {pasteExpanded ? '收起粘贴导入' : '粘贴导入 JSON'}
              </button>
              {editorNavigation && (
                <a
                  href={editorHref}
                  onClick={(event) => {
                    if (!editorNavigation.onNavigate || !shouldInterceptInternalLinkClick(event)) return;
                    event.preventDefault();
                    editorNavigation.onNavigate(editorHref);
                  }}
                  className="text-xs text-purple-700 hover:underline"
                >
                  打开问卷编辑器
                </a>
              )}
            </div>

            <div id={pastePanelId} hidden={!pasteExpanded}>
              {pasteExpanded && (
                <div className="rounded-lg border border-purple-200 bg-white p-3 text-xs text-gray-700">
                  <label htmlFor={pasteInputId} className="text-xs text-gray-600">粘贴问卷 JSON</label>
                  <textarea
                    id={pasteInputId}
                    value={pasteText}
                    onChange={(event) => onPasteTextChange(event.target.value)}
                    placeholder="在此粘贴问卷 JSON（可包含 loreMarkdown）"
                    className="input-field mt-2 h-28"
                    rows={6}
                    disabled={disabled}
                    aria-invalid={pasteError ? true : undefined}
                    aria-describedby={pasteError ? pasteErrorId : undefined}
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <button type="button" onClick={onPasteImport} className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-1 text-xs text-purple-800 hover:border-purple-300 hover:bg-purple-100 disabled:opacity-50" disabled={disabled}>
                      解析并载入
                    </button>
                    <button type="button" onClick={onPasteClear} className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50" disabled={disabled}>
                      清空
                    </button>
                  </div>
                  {pasteError && <p id={pasteErrorId} role="alert" className="mt-2 text-rose-500">{pasteError}</p>}
                </div>
              )}
            </div>

            {supplementalLore && <div>
              <label htmlFor={supplementalInputId} className="text-xs font-semibold">补充设定</label>
              <textarea id={supplementalInputId} aria-label="补充设定" className="input-field mt-2 h-28" rows={6}
                value={supplementalLore.text} disabled={disabled} onChange={(event) => supplementalLore.onChange(event.target.value)} />
              <p className="mt-1 text-xs text-purple-700">与已选来源一起注入；清空只移除这段补充设定。手写补充设定不授予原生许可。</p>
            </div>}
            {loadError && <p role="alert" className="text-xs text-rose-500">{loadError}</p>}
            {tokenIndicator}
            {warnNonNative && (
              <p className="text-xs text-yellow-700">
                ⚠️ 已注入非原生许可的问卷设定，本次升华结果将标记为“衍生数据”（非原生），并移除/不生成原生签名。
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
