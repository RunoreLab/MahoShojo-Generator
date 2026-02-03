'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import BattleDataModal from '@/components/BattleDataModal';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import {
  normalizeQuestionnaireDefinition,
  type QuestionnairePresetEntry,
} from '@/lib/questionnaires';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState } from '../types';

const formatLoreText = (selections: BattleStoreState['selectedQuestionnaires']): string => {
  const blocks = selections
    .filter((selection) => selection.useLore !== false)
    .map((selection) => ({
      title: selection.questionnaire.title,
      lore: selection.questionnaire.loreMarkdown?.trim() ?? '',
    }))
    .filter((item) => Boolean(item.lore))
    .map((item) => `【设定来源：${item.title}】\n${item.lore}`);
  return blocks.length > 0 ? blocks.join('\n\n') : '';
};

const parseDataCardPayload = (card: any): any => {
  const rawPayload = card?.data ?? card?.dataJson ?? card?.data_json ?? card?.dataJSON ?? null;
  if (rawPayload !== null && rawPayload !== undefined) {
    return typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
  }
  if (card && typeof card === 'object') {
    if (Array.isArray(card.questions)) {
      return card;
    }
    if (card.questionnaire && Array.isArray(card.questionnaire.questions)) {
      return card.questionnaire;
    }
  }
  throw new Error('问卷数据卡内容为空或格式不受支持');
};

const requireLore = (questionnaire: { title?: string; loreMarkdown?: string | null | undefined }) => {
  const lore = typeof questionnaire.loreMarkdown === 'string' ? questionnaire.loreMarkdown.trim() : '';
  if (!lore) {
    const title = typeof questionnaire.title === 'string' ? questionnaire.title.trim() : '';
    throw new Error(title ? `「${title}」不包含 loreMarkdown，无法用于设定注入` : '该问卷不包含 loreMarkdown，无法用于设定注入');
  }
};

export function QuestionnaireLorePanel() {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const selectedQuestionnaires = useBattleSelector((state) => state.selectedQuestionnaires);
  const addQuestionnaireSelection = useBattleSelector((state) => state.addQuestionnaireSelection);
  const removeQuestionnaireSelection = useBattleSelector((state) => state.removeQuestionnaireSelection);
  const setQuestionnaireSelections = useBattleSelector((state) => state.setQuestionnaireSelections);
  const toggleQuestionnaireSelectionLore = useBattleSelector((state) => state.toggleQuestionnaireSelectionLore);
  const isGenerating = useBattleSelector((state) => state.isGenerating);

  const [showQuestionnairePicker, setShowQuestionnairePicker] = useState(false);
  const [questionnairePickerError, setQuestionnairePickerError] = useState<string | null>(null);
  const [presetEntries, setPresetEntries] = useState<QuestionnairePresetEntry[]>([]);
  const [presetError, setPresetError] = useState<string | null>(null);

  const [showPasteImport, setShowPasteImport] = useState(false);
  const [pasteQuestionnaireText, setPasteQuestionnaireText] = useState('');
  const [pasteQuestionnaireError, setPasteQuestionnaireError] = useState<string | null>(null);

  const loreText = useMemo(() => formatLoreText(selectedQuestionnaires), [selectedQuestionnaires]);

  useEffect(() => {
    let cancelled = false;
    const loadPresetIndex = async () => {
      setPresetError(null);
      try {
        const response = await fetch('/questionnaires/presets/index.json');
        if (!response.ok) throw new Error('加载预设问卷索引失败');
        const data = await response.json();
        const list = Array.isArray(data?.presets) ? (data.presets as QuestionnairePresetEntry[]) : [];
        if (!cancelled) setPresetEntries(list);
      } catch {
        if (!cancelled) {
          setPresetEntries([]);
          setPresetError('📋 预设问卷加载失败，请刷新页面重试');
        }
      }
    };
    void loadPresetIndex();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectQuestionnaireCard = useCallback((card: any) => {
    try {
      const rawData = parseDataCardPayload(card);
      const fallbackKind = rawData?.kind === 'canshou' ? 'canshou' : 'magical-girl';
      const normalized = normalizeQuestionnaireDefinition(rawData, {
        fallbackKind,
        fallbackId: typeof rawData?.id === 'string' ? rawData.id : `${fallbackKind}-card-${card?.id ?? ''}`,
        fallbackTitle: typeof rawData?.title === 'string' ? rawData.title : card?.name || '未命名问卷',
        nativeAllowed: typeof rawData?.nativeAllowed === 'boolean' ? rawData.nativeAllowed : false,
      });
      if (!normalized) throw new Error('问卷数据卡解析失败');
      requireLore(normalized);
      addQuestionnaireSelection({
        source: 'database',
        questionnaire: normalized,
        dataCardId: card?._cardId ?? card?.id,
        dataCardName: card?._cardName ?? card?.name,
        dataCardAuthor: card?._author ?? card?.username ?? card?.author,
      });
      setQuestionnairePickerError(null);
      setShowQuestionnairePicker(false);
    } catch (error) {
      setQuestionnairePickerError(error instanceof Error ? error.message : '解析问卷失败');
    }
  }, [addQuestionnaireSelection]);

  const handleAddPreset = useCallback(async (presetId: string) => {
    const matched = presetEntries.find((item) => item.id === presetId);
    if (!matched) {
      setPresetError('未找到对应预设');
      return;
    }
    try {
      const response = await fetch(matched.path);
      if (!response.ok) throw new Error('加载预设问卷失败');
      const data = await response.json();
      const nativeAllowed = typeof (data as any)?.nativeAllowed === 'boolean' ? Boolean((data as any).nativeAllowed) : true;
      const normalized = normalizeQuestionnaireDefinition(data, {
        fallbackId: matched.id,
        fallbackKind: matched.kind,
        fallbackTitle: matched.title,
        nativeAllowed,
      });
      if (!normalized) throw new Error('预设问卷解析失败');
      requireLore(normalized);
      addQuestionnaireSelection({ source: 'preset', questionnaire: normalized });
      setPresetError(null);
    } catch (error) {
      setPresetError(error instanceof Error ? error.message : '加载预设失败');
    }
  }, [addQuestionnaireSelection, presetEntries]);

  const handlePasteQuestionnaireImport = useCallback(() => {
    if (!pasteQuestionnaireText.trim()) {
      setPasteQuestionnaireError('请先粘贴问卷 JSON');
      return;
    }
    try {
      const parsed = JSON.parse(pasteQuestionnaireText);
      const fallbackKind = parsed?.kind === 'canshou' ? 'canshou' : 'magical-girl';
      const normalized = normalizeQuestionnaireDefinition(parsed, {
        fallbackKind,
        fallbackId: typeof parsed?.id === 'string' ? parsed.id : `${fallbackKind}-paste`,
        fallbackTitle: typeof parsed?.title === 'string' ? parsed.title : '未命名问卷',
        nativeAllowed: false,
      });
      if (!normalized) throw new Error('问卷 JSON 无法识别，请检查格式');
      requireLore(normalized);
      addQuestionnaireSelection({ source: 'upload', questionnaire: normalized });
      setPasteQuestionnaireError(null);
      setPasteQuestionnaireText('');
      setShowPasteImport(false);
    } catch (error) {
      setPasteQuestionnaireError(error instanceof Error ? error.message : '问卷 JSON 解析失败');
    }
  }, [addQuestionnaireSelection, pasteQuestionnaireText]);

  const handleClearAll = useCallback(() => {
    setQuestionnaireSelections([]);
    setPresetError(null);
    setPasteQuestionnaireError(null);
    setQuestionnairePickerError(null);
  }, [setQuestionnaireSelections]);

  const selectablePresets = useMemo(() => {
    return presetEntries.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.path === 'string');
  }, [presetEntries]);

  return (
    <>
      <div className="input-group">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="input-label">参考设定（问卷/设定卡 Lore）</label>
          <div className="flex items-center gap-2 flex-wrap">
            {selectedQuestionnaires.length > 0 ? (
              <button
                type="button"
                className="px-3 py-2 text-xs font-semibold rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                onClick={handleClearAll}
                disabled={isGenerating}
              >
                清空
              </button>
            ) : null}
            <button
              type="button"
              className="px-3 py-2 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              onClick={() => {
                setShowQuestionnairePicker(true);
                setQuestionnairePickerError(null);
              }}
              disabled={isGenerating}
            >
              选择云端问卷
            </button>
            <button
              type="button"
              className="px-3 py-2 text-xs font-semibold rounded bg-white border border-gray-200 text-gray-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
              onClick={() => {
                setShowPasteImport((prev) => !prev);
                setPasteQuestionnaireError(null);
              }}
              disabled={isGenerating}
            >
              {showPasteImport ? '收起粘贴' : '粘贴 JSON'}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          选中的问卷/设定卡会把 <code className="bg-slate-200 px-1 rounded">loreMarkdown</code> 作为【参考设定】注入到战报提示词中（不是题目，不需要作答）。
        </p>

        {selectablePresets.length > 0 && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <div className="text-xs text-gray-500">快速添加预设：</div>
            <select
              className="input-field text-sm"
              style={{ cursor: 'pointer', width: 'min(420px, 100%)' }}
              disabled={isGenerating}
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value;
                e.target.value = '';
                if (!id) return;
                void handleAddPreset(id);
              }}
            >
              <option value="">选择一个预设问卷/设定卡…</option>
              {selectablePresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.title}
                </option>
              ))}
            </select>
          </div>
        )}

        {(presetError || pasteQuestionnaireError) && (
          <div className="mt-2 text-sm text-red-600">
            {presetError || pasteQuestionnaireError}
          </div>
        )}

        {showPasteImport && (
          <div className="mt-3">
            <textarea
              value={pasteQuestionnaireText}
              onChange={(e) => setPasteQuestionnaireText(e.target.value)}
              placeholder="在此粘贴问卷 JSON（必须包含 loreMarkdown）"
              className="w-full h-36 p-3 border rounded-lg text-xs font-mono bg-gray-50 text-gray-900"
              disabled={isGenerating}
            />
            <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs text-gray-500">
                提示：建议先在 <code className="bg-slate-200 px-1 rounded">/questionnaire-editor</code> 编辑/保存到云端，竞技场侧作为引用使用。
              </div>
              <button
                type="button"
                className="px-3 py-2 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                onClick={handlePasteQuestionnaireImport}
                disabled={isGenerating}
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
                <div className="text-xs text-gray-600">已选 {selectedQuestionnaires.length} 张</div>
                <TokenIndicator text={loreText} />
              </div>
              <ul className="space-y-2">
                {selectedQuestionnaires.map((selection) => {
                  const selectionId = selection.selectionId ?? selection.questionnaire.id;
                  const hasLore = Boolean(selection.questionnaire.loreMarkdown?.trim());
                  const enabled = selection.useLore !== false;
                  const sourceLabel = selection.source === 'preset' ? '预设' : selection.source === 'database' ? '云端' : '本地';
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
                        <button
                          type="button"
                          className="px-3 py-1.5 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                          onClick={() => removeQuestionnaireSelection(selectionId)}
                          disabled={isGenerating}
                        >
                          移除
                        </button>
                      </div>

                      {hasLore && (
                        <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(e) => toggleQuestionnaireSelectionLore(selectionId, e.target.checked)}
                              disabled={isGenerating}
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

      <BattleDataModal
        isOpen={showQuestionnairePicker}
        onClose={() => {
          setShowQuestionnairePicker(false);
          setQuestionnairePickerError(null);
        }}
        selectedType="questionnaire"
        initialTab="public"
        titleOverride="选择云端问卷/设定卡"
        onSelectCard={handleSelectQuestionnaireCard}
        externalError={questionnairePickerError}
      />
    </>
  );
}
