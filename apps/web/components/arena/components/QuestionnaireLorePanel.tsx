'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import BattleDataModal from '@/components/BattleDataModal';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import { TokenIndicator } from '@/components/shared/TokenIndicator';
import { QuestionnaireLorePanel as SharedQuestionnaireLorePanel } from '@mahoshojo/ui-web/arena';
import { buildQuestionnaireSelectionLoreText } from '@mahoshojo/domain/questionnaire-selection';
import { mapDataCardSourceMeta } from '@/lib/data-card-read-mappers';
import {
  normalizeQuestionnaireDefinition,
  parseQuestionnaireDataCardPayload,
  type QuestionnairePresetEntry,
} from '@/lib/questionnaires';
import {
  countArenaSelectedReferenceItems,
  MAX_ARENA_REFERENCE_ITEMS,
} from '@/lib/arena/resource-budget';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState } from '../types';

const requireLore = (questionnaire: { title?: string; loreMarkdown?: string | null | undefined }) => {
  const lore = typeof questionnaire.loreMarkdown === 'string' ? questionnaire.loreMarkdown.trim() : '';
  if (!lore) {
    const title = typeof questionnaire.title === 'string' ? questionnaire.title.trim() : '';
    throw new Error(title ? `「${title}」不包含 loreMarkdown，无法用于设定注入` : '该问卷不包含 loreMarkdown，无法用于设定注入');
  }
};

export function QuestionnaireLorePanel() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const selectedQuestionnaires = useBattleSelector((state) => state.selectedQuestionnaires);
  const auxScenarios = useBattleSelector((state) => state.auxScenarios);
  const materials = useBattleSelector((state) => state.materials);
  const addQuestionnaireSelection = useBattleSelector((state) => state.addQuestionnaireSelection);
  const removeQuestionnaireSelection = useBattleSelector((state) => state.removeQuestionnaireSelection);
  const setQuestionnaireSelections = useBattleSelector((state) => state.setQuestionnaireSelections);
  const toggleQuestionnaireSelectionLore = useBattleSelector((state) => state.toggleQuestionnaireSelectionLore);
  const isGenerating = useBattleSelector((state) => state.isGenerating);

  const [showQuestionnairePicker, setShowQuestionnairePicker] = useState(false);
  const [questionnairePickerError, setQuestionnairePickerError] = useState<string | null>(null);
  const [questionnaireDetailsCard, setQuestionnaireDetailsCard] = useState<{
    id: string;
    name: string;
    description: string;
    type: 'questionnaire';
    data: string;
    isPublic: boolean;
    author?: string;
  } | null>(null);
  const [showQuestionnaireDetailsModal, setShowQuestionnaireDetailsModal] = useState(false);
  const [presetEntries, setPresetEntries] = useState<QuestionnairePresetEntry[]>([]);
  const [presetError, setPresetError] = useState<string | null>(null);


  const loreText = useMemo(() => buildQuestionnaireSelectionLoreText(selectedQuestionnaires), [selectedQuestionnaires]);
  const referenceItemCount = countArenaSelectedReferenceItems({
    auxScenarios,
    materials,
    selectedQuestionnaires,
  });
  const hasReferenceCapacity = referenceItemCount < MAX_ARENA_REFERENCE_ITEMS;
  const referenceLimitMessage = `参考项（辅助情景、素材和问卷）合计最多 ${MAX_ARENA_REFERENCE_ITEMS} 项。`;

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
      if (!hasReferenceCapacity) throw new Error(referenceLimitMessage);
      const rawData = parseQuestionnaireDataCardPayload(card);
      const cardSourceMeta = mapDataCardSourceMeta(card);
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
        ...cardSourceMeta,
      });
      setQuestionnairePickerError(null);
      setShowQuestionnairePicker(false);
    } catch (error) {
      setQuestionnairePickerError(error instanceof Error ? error.message : '解析问卷失败');
    }
  }, [addQuestionnaireSelection, hasReferenceCapacity, referenceLimitMessage]);

  const handleOpenQuestionnaireDetails = useCallback((selection: BattleStoreState['selectedQuestionnaires'][number]) => {
    const baseId = selection.source === 'database'
      ? (selection.dataCardId ?? selection.questionnaire.id)
      : (selection.questionnaire.id ?? '');
    const cardId = selection.source === 'database'
      ? baseId
      : `questionnaire:${selection.source}:${baseId}`;
    const name = (selection.dataCardName ?? selection.questionnaire.title ?? '未命名问卷').trim() || '未命名问卷';
    const description = selection.questionnaire.description?.trim() || '暂无简介';

    setQuestionnaireDetailsCard({
      id: cardId,
      name,
      description,
      type: 'questionnaire',
      data: JSON.stringify(selection.questionnaire, null, 2),
      isPublic: selection.source === 'database',
      author: selection.dataCardAuthor,
    });
    setShowQuestionnaireDetailsModal(true);
  }, []);

  const handleAddPreset = useCallback(async (presetId: string) => {
    if (!hasReferenceCapacity) {
      setPresetError(referenceLimitMessage);
      return;
    }
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
      if (!mounted.current) return;
      addQuestionnaireSelection({ source: 'preset', questionnaire: normalized });
      setPresetError(null);
    } catch (error) {
      setPresetError(error instanceof Error ? error.message : '加载预设失败');
    }
  }, [addQuestionnaireSelection, hasReferenceCapacity, presetEntries, referenceLimitMessage]);

  const handlePasteQuestionnaireImport = useCallback((text: string) => {
    if (!hasReferenceCapacity) throw new Error(referenceLimitMessage);
    if (!text.trim()) throw new Error('请先粘贴问卷 JSON');
    const parsed = JSON.parse(text);
    const fallbackKind = parsed?.kind === 'canshou' ? 'canshou' : 'magical-girl';
    const normalized = normalizeQuestionnaireDefinition(parsed, {
      fallbackKind, fallbackId: typeof parsed?.id === 'string' ? parsed.id : `${fallbackKind}-paste`,
      fallbackTitle: typeof parsed?.title === 'string' ? parsed.title : '未命名问卷', nativeAllowed: false,
    });
    if (!normalized) throw new Error('问卷 JSON 无法识别，请检查格式');
    requireLore(normalized);
    addQuestionnaireSelection({ source: 'upload', questionnaire: normalized });
  }, [addQuestionnaireSelection, hasReferenceCapacity, referenceLimitMessage]);

  const handleClearAll = useCallback(() => {
    setQuestionnaireSelections([]);
    setPresetError(null);
    setQuestionnairePickerError(null);
  }, [setQuestionnaireSelections]);

  const selectablePresets = useMemo(() => {
    return presetEntries.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.path === 'string');
  }, [presetEntries]);

  return (
    <>
      <SharedQuestionnaireLorePanel
        selectedQuestionnaires={selectedQuestionnaires} presets={selectablePresets}
        referenceItemCount={referenceItemCount} maxReferenceItems={MAX_ARENA_REFERENCE_ITEMS}
        disabled={isGenerating} presetError={presetError} questionnairePickerError={questionnairePickerError}
        tokenIndicator={<TokenIndicator text={loreText} />}
        pasteHint={<>提示：建议先在 <code className="bg-slate-200 px-1 rounded">/questionnaire-editor</code> 编辑/保存到云端，竞技场侧作为引用使用。</>}
        onBrowse={() => { setShowQuestionnairePicker(true); setQuestionnairePickerError(null); }}
        onAddPreset={handleAddPreset} onPaste={handlePasteQuestionnaireImport} onClear={handleClearAll}
        onRemove={removeQuestionnaireSelection} onToggleLore={toggleQuestionnaireSelectionLore}
        onDetails={handleOpenQuestionnaireDetails}
        onMove={(id, direction) => {
          const next = [...selectedQuestionnaires];
          const index = next.findIndex((item) => (item.selectionId ?? item.questionnaire.id) === id);
          const target = index + (direction === 'up' ? -1 : 1);
          if (index < 0 || target < 0 || target >= next.length) return;
          [next[index], next[target]] = [next[target], next[index]];
          setQuestionnaireSelections(next);
        }}
        requestDiscard={(message) => window.confirm(message)}
      />

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

      {questionnaireDetailsCard && (
        <DataCardDetailsModal
          isOpen={showQuestionnaireDetailsModal}
          onClose={() => {
            setShowQuestionnaireDetailsModal(false);
            setQuestionnaireDetailsCard(null);
          }}
          card={{
            id: questionnaireDetailsCard.id,
            name: questionnaireDetailsCard.name,
            description: questionnaireDetailsCard.description,
            type: 'questionnaire',
            data: questionnaireDetailsCard.data,
            isPublic: questionnaireDetailsCard.isPublic,
            author: questionnaireDetailsCard.author,
          }}
        />
      )}
    </>
  );
}
