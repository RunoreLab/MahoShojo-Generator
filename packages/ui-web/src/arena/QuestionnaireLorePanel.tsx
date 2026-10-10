'use client';
import { useRef, useState, type ReactNode } from 'react';
import type { QuestionnaireSelection } from '@mahoshojo/domain/questionnaire-selection';
import { useArenaInputLifecycle, type ArenaInputLifecyclePorts } from './input-lifecycle';

/** A stale host scope may cancel without clearing draft text or showing an obsolete error. */
export type QuestionnaireLoreActionResult = void | Readonly<{ cancelled?: boolean }>;

export type QuestionnaireLorePanelProps = ArenaInputLifecyclePorts & Readonly<{
  selectedQuestionnaires: readonly QuestionnaireSelection[];
  presets: readonly { id: string; title: string }[];
  referenceItemCount: number;
  maxReferenceItems: number;
  disabled?: boolean;
  presetError?: string | null;
  questionnairePickerError?: string | null;
  tokenIndicator?: ReactNode;
  pasteHint?: ReactNode;
  browseLabel?: string;
  sourceLabel?: (selection: QuestionnaireSelection) => string;
  onBrowse?: () => void;
  onUpload?: (file: File) => QuestionnaireLoreActionResult | Promise<QuestionnaireLoreActionResult>;
  onAddPreset: (id: string) => QuestionnaireLoreActionResult | Promise<QuestionnaireLoreActionResult>;
  onPaste: (text: string) => QuestionnaireLoreActionResult | Promise<QuestionnaireLoreActionResult>;
  onClear: () => void;
  onRemove: (id: string) => void;
  onToggleLore: (id: string, enabled: boolean) => void;
  onDetails?: (selection: QuestionnaireSelection) => void;
  onMove?: (id: string, direction: 'up' | 'down') => void;
  requestDiscard?: (message: string) => boolean | Promise<boolean>;
}>;

/** Shared live Lore controls; parsing, presets, card selection and storage remain host ports. */
export function QuestionnaireLorePanel({ selectedQuestionnaires, presets, referenceItemCount, maxReferenceItems,
  disabled = false, presetError, questionnairePickerError, tokenIndicator, pasteHint,
  browseLabel = '选择云端问卷', sourceLabel: getSourceLabel, onBrowse, onUpload, onAddPreset, onPaste, onClear, onRemove,
  onToggleLore, onDetails, onMove, requestDiscard, ...lifecycle }: QuestionnaireLorePanelProps) {
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [pasteQuestionnaireText, setPasteQuestionnaireText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const blocked = disabled || busy;
  const hasReferenceCapacity = referenceItemCount < maxReferenceItems;
  const track = useArenaInputLifecycle(Boolean(pasteQuestionnaireText), lifecycle, busy);
  const run = async (action: () => QuestionnaireLoreActionResult | Promise<QuestionnaireLoreActionResult>) => {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setActionError(null);
    try { await track(action); }
    catch (error) { setActionError(error instanceof Error ? error.message : '操作失败，请重试'); }
    finally { pending.current = false; setBusy(false); }
  };
  const togglePaste = () => run(async () => {
    if (showPasteImport && pasteQuestionnaireText && !(await requestDiscard?.('放弃未导入的问卷 JSON？'))) return;
    if (showPasteImport) setPasteQuestionnaireText('');
    setShowPasteImport(!showPasteImport);
  });
  return (
      <div className="input-group">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="input-label">参考设定（问卷/设定卡 Lore）</label>
          <div className="flex items-center gap-2 flex-wrap">
            {selectedQuestionnaires.length > 0 ? (
              <button
                type="button"
                className="px-3 py-2 text-xs font-semibold rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                onClick={onClear}
                disabled={blocked}
              >
                清空
              </button>
            ) : null}
            {onBrowse && <button
              type="button"
              className="px-3 py-2 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              onClick={onBrowse}
              disabled={blocked || !hasReferenceCapacity}
            >
              {browseLabel}
            </button>}
            {onUpload && <label className="px-3 py-2 text-xs font-semibold rounded border cursor-pointer">上传 JSON<input aria-label="上传 Lore 问卷 JSON" type="file" accept="application/json,.json" hidden disabled={blocked || !hasReferenceCapacity} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(() => onUpload(file)); }} /></label>}
            <button
              type="button"
              className="px-3 py-2 text-xs font-semibold rounded bg-white border border-gray-200 text-gray-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
              onClick={() => {
                void togglePaste();
              }}
              disabled={blocked || !hasReferenceCapacity}
            >
              {showPasteImport ? '收起粘贴' : '粘贴 JSON'}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          选中的问卷/设定卡会把 <code className="bg-slate-200 px-1 rounded">loreMarkdown</code> 作为【参考设定】注入到战报提示词中（不是题目，不需要作答）。
        </p>

        {presets.length > 0 && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <div className="text-xs text-gray-500">快速添加预设：</div>
            <select
              className="input-field text-sm"
              style={{ cursor: 'pointer', width: 'min(420px, 100%)' }}
              disabled={blocked || !hasReferenceCapacity}
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value;
                e.target.value = '';
                if (!id) return;
                void run(() => onAddPreset(id));
              }}
            >
              <option value="">选择一个预设问卷/设定卡…</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {(presetError || actionError) && (
          <div className="mt-2 text-sm text-red-600">
            {presetError || actionError}
          </div>
        )}

        {showPasteImport && (
          <div className="mt-3">
            <textarea
              value={pasteQuestionnaireText}
              onChange={(e) => setPasteQuestionnaireText(e.target.value)}
              placeholder="在此粘贴问卷 JSON（必须包含 loreMarkdown）"
              className="w-full h-36 p-3 border rounded-lg text-xs font-mono bg-gray-50 text-gray-900"
              disabled={blocked || !hasReferenceCapacity}
            />
            <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs text-gray-500">
                {pasteHint}
              </div>
              <button
                type="button"
                className="px-3 py-2 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                onClick={() => void run(async () => {
                  const result = await onPaste(pasteQuestionnaireText);
                  if (result?.cancelled) return;
                  setPasteQuestionnaireText(''); setShowPasteImport(false);
                })}
                disabled={blocked || !hasReferenceCapacity}
              >
                导入
              </button>
            </div>
          </div>
        )}

        <div className="mt-3">
          {selectedQuestionnaires.length === 0 ? (
            <div className="text-xs text-gray-500">当前未选择任何设定卡（可选）。</div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs text-gray-600">
                  已选问卷 {selectedQuestionnaires.length}；参考项合计 {referenceItemCount}/{maxReferenceItems}
                </div>
                {tokenIndicator}
              </div>
              <ul className="space-y-2">
                {selectedQuestionnaires.map((selection, index) => {
                  const selectionId = selection.selectionId ?? selection.questionnaire.id;
                  const hasLore = Boolean(selection.questionnaire.loreMarkdown?.trim());
                  const enabled = selection.useLore !== false;
                  const sourceLabel = getSourceLabel?.(selection) ?? (selection.source === 'preset' ? '预设' : selection.source === 'database' ? '云端' : '本地');
                  const author = selection.source === 'database'
                    ? (typeof selection.dataCardAuthor === 'string' && selection.dataCardAuthor.trim() ? selection.dataCardAuthor.trim() : '—')
                    : null;

                  return (
                    <li key={selectionId} className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">
                            {selection.questionnaire.title}
                          </div>
                        <div className="mt-1 text-xs text-gray-500">
                          来源：{sourceLabel}{author ? ` · 作者：${author}` : ''}{hasLore ? '' : ' · 无设定'}
                        </div>
                      </div>
                        <div className="flex items-center gap-2">
                          {onMove && <><button type="button" aria-label={`上移 ${selection.questionnaire.title}`} disabled={blocked || index === 0} onClick={() => onMove(selectionId, 'up')}>↑</button><button type="button" aria-label={`下移 ${selection.questionnaire.title}`} disabled={blocked || index === selectedQuestionnaires.length - 1} onClick={() => onMove(selectionId, 'down')}>↓</button></>}
                          {onDetails && <button
                            type="button"
                            className="px-3 py-1.5 text-xs rounded border bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            onClick={() => onDetails?.(selection)}
                            disabled={blocked}
                          >
                            详情
                          </button>}
                          <button
                            type="button"
                            className="px-3 py-1.5 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                            onClick={() => onRemove(selectionId)}
                            disabled={blocked}
                          >
                            移除
                          </button>
                        </div>
                      </div>

                      {hasLore && (
                        <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(e) => onToggleLore(selectionId, e.target.checked)}
                              disabled={blocked}
                            />
                            注入设定
                          </label>
                          <span className="text-gray-400">·</span>
                          <span className="text-gray-500">{enabled ? '启用' : '关闭'}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {questionnairePickerError && (
          <div className="mt-2 text-sm text-red-600">{questionnairePickerError}</div>
        )}
      </div>
  );
}
