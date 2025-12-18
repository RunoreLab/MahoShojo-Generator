'use client';

import { useCallback } from 'react';

import { inferTemplate } from '@/lib/data-card-converter';
import { generateRandomCanshou, generateRandomMagicalGirl } from '@/lib/random-character-generator';

import { useBattleStore } from '../stores/useBattleStore';
import { BattleStoreState, CombatantData, MAX_COMBATANTS, RandomCombatantPlaceholder } from '../types';
import {
  getCombatantDisplayName,
  inferCombatantType,
  isLegacyAdjudicatorFormat,
} from '../utils/characterValidator';
import { parseCombatantsFromText } from '../utils/fileParser';
import { ScenarioSchema } from '../utils/schemas';

const removePrivateKeys = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(removePrivateKeys);
  }
  const cleaned: any = {};
  for (const key of Object.keys(obj)) {
    if (!key.startsWith('_')) {
      cleaned[key] = removePrivateKeys(obj[key]);
    }
  }
  return cleaned;
};

const verifyOrigin = async (payload: any): Promise<boolean> => {
  const response = await fetch('/api/verify-origin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) return false;
  const { isValid } = await response.json();
  return Boolean(isValid);
};

// 追踪正在处理中的卡片，防止重复点击
const loadingCards = new Set<string>();

export const useBattleActions = () => {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setError = useBattleSelector((state) => state.setError);
  const addCombatant = useBattleSelector((state) => state.addCombatant);
  const setCombatants = useBattleSelector((state) => state.setCombatants);
  const setScenario = useBattleSelector((state) => state.setScenario);
  const setAdjudicationEvents = useBattleSelector((state) => state.setAdjudicationEvents);
  const scenario = useBattleSelector((state) => state.scenario);

  const appendAdjudicationEvents = useCallback(
    (events: unknown, label: string) => {
      if (!Array.isArray(events) || events.length === 0) return;
      if (isLegacyAdjudicatorFormat(events as any[])) {
        setError(`⚠️ 文件 "${label}" 包含旧版随机事件，已被忽略。`);
        return;
      }
      const current = useBattleStore.getState().adjudicationEvents;
      const merged = [...current];
      events.forEach((evt) => merged.push(evt as any));
      setAdjudicationEvents(merged);
    },
    [setAdjudicationEvents, setError]
  );

  const importFromText = useCallback(
    async (text: string) => {
      const results = await parseCombatantsFromText(text, {
        existingCount: combatants.length,
        onWarn: setError,
        onError: setError,
        onAdjudicationEvents: appendAdjudicationEvents,
        verifyOrigin,
      });

      // 检查同名角色并过滤
      const existingFilenames = new Set(
        combatants.filter((c): c is CombatantData => 'filename' in c).map((c) => c.filename)
      );
      const duplicates: string[] = [];
      const uniqueResults = results.filter((result) => {
        if (existingFilenames.has(result.filename)) {
          duplicates.push(result.filename);
          return false;
        }
        return true;
      });

      // 添加唯一的角色
      uniqueResults.forEach(addCombatant);

      // 显示重复角色的警告信息
      if (duplicates.length > 0) {
        setError(`❌ 已忽略 ${duplicates.length} 个同名角色: ${duplicates.join(', ')}`);
      } else {
        setError(null);
      }
    },
    [addCombatant, appendAdjudicationEvents, combatants, setError]
  );

  const handleFileUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || isGenerating) return;
      const texts = await Promise.all(Array.from(files).map((file) => file.text()));
      await importFromText(texts.join('\n'));
    },
    [importFromText, isGenerating]
  );

  const handlePaste = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      await importFromText(trimmed);
    },
    [importFromText]
  );

  const handleAddRandomPlaceholder = useCallback(
    (type: 'random-magical-girl' | 'random-canshou') => {
      if (combatants.length >= MAX_COMBATANTS || isGenerating) {
        setError(`最多只能选择 ${MAX_COMBATANTS} 位参战者。`);
        return;
      }
      const placeholder: RandomCombatantPlaceholder = {
        type,
        id: `${type}-${Date.now()}`,
        filename: type === 'random-magical-girl' ? '随机魔法少女' : '随机残兽',
      };
      addCombatant(placeholder);
    },
    [addCombatant, combatants.length, isGenerating, setError]
  );

  const handleTeamChange = useBattleSelector((state) => state.updateCombatantTeam);

  const handleSelectDataCard = useCallback(
    async (cardData: any) => {
      const cleanedCardData = removePrivateKeys(cardData);
      const resolvedName = getCombatantDisplayName(cleanedCardData);
      const inferredTemplate = inferTemplate(cleanedCardData);
      const targetFilename = `${cardData._cardName || resolvedName}.json`;

      // 检查是否已在加载中或已存在（防止重复点击）
      if (loadingCards.has(targetFilename)) {
        return; // 直接忽略，不显示错误信息
      }

      // 立即标记为正在加载，防止并发请求
      loadingCards.add(targetFilename);

      try {
        if (inferredTemplate === 'scenario') {
          if (useBattleStore.getState().battleMode !== 'scenario') {
            setError('❌ 情景数据卡只能在情景模式下使用。');
            return;
          }

          const isNative = await verifyOrigin(cleanedCardData);
          setScenario({
            content: cleanedCardData,
            fileName: `${cardData._cardName || resolvedName}.json`,
            isNative,
          });
          appendAdjudicationEvents(cleanedCardData.adjudicationEvents, resolvedName);
          setError(null);
          return;
        }

        if (combatants.length >= MAX_COMBATANTS) {
          setError(`❌ 最多只能添加 ${MAX_COMBATANTS} 位角色。`);
          return;
        }
        if (combatants.some((c) => 'filename' in c && c.filename === targetFilename)) {
          setError(`❌ 已添加同名角色: ${resolvedName}`);
          return;
        }

        const type = inferCombatantType(cleanedCardData);
        const isValid = await verifyOrigin(cleanedCardData);

        addCombatant({
          type,
          data: cleanedCardData,
          filename: targetFilename,
          isValid,
          isPreset: false,
          isNonStandard: false,
        });
        appendAdjudicationEvents(cleanedCardData.adjudicationEvents, resolvedName);
        setError(null);
      } finally {
        // 无论成功还是失败，都要移除加载标记
        loadingCards.delete(targetFilename);
      }
    },
    [addCombatant, appendAdjudicationEvents, combatants, setError, setScenario]
  );

  const handleRandomMatch = useCallback(
    async (type: 'character' | 'scenario') => {
      if (type === 'character' && combatants.length >= MAX_COMBATANTS) {
        setError(`最多只能选择 ${MAX_COMBATANTS} 位参战者。`);
        return;
      }
      useBattleStore.getState().setIsMatching(type);
      setError(`正在从数据库中随机寻找一位公开的${type === 'character' ? '角色' : '情景'}...`);
      try {
        const response = await fetch(`/api/random-public-card?type=${type}`);
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error || '无法获取随机数据');
        }
        const cardData = JSON.parse(result.card.data);
        await handleSelectDataCard({
          ...cardData,
          _cardId: result.card.id,
          _cardName: result.card.name,
          _isPublic: result.card.is_public,
          _author: result.card.username || '未知',
        });
      } catch (error) {
        setError(`❌ 随机匹配失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        useBattleStore.getState().setIsMatching(null);
      }
    },
    [combatants.length, handleSelectDataCard, setError]
  );

  const handleScenarioUpload = useCallback(
    async (file: File) => {
      const text = await file.text();
      const json = JSON.parse(text);
      const parsed = ScenarioSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || '情景文件缺少必需字段');
      }
      const isNative = await verifyOrigin(parsed.data);
      setScenario({
        content: parsed.data,
        fileName: file.name,
        isNative,
      });
      appendAdjudicationEvents(parsed.data.adjudicationEvents, parsed.data.title);
      setError(null);
    },
    [appendAdjudicationEvents, setError, setScenario]
  );

  const handleScenarioPaste = useCallback(
    async (text: string) => {
      const parsed = ScenarioSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || '情景文件缺少必需字段');
      }
      const isNative = await verifyOrigin(parsed.data);
      setScenario({
        content: parsed.data,
        fileName: parsed.data.title || '粘贴的情景',
        isNative,
      });
      appendAdjudicationEvents(parsed.data.adjudicationEvents, parsed.data.title);
      setError(null);
    },
    [appendAdjudicationEvents, setError, setScenario]
  );

  const handleResolveRandomPlaceholders = useCallback(async () => {
    const placeholders = combatants.filter((item): item is RandomCombatantPlaceholder => 'id' in item);
    if (placeholders.length === 0) return;
    setError('正在生成随机角色...');
    const generatedCharacters = placeholders.map((placeholder) =>
      placeholder.type === 'random-magical-girl' ? generateRandomMagicalGirl() : generateRandomCanshou()
    );
    const newCombatantData: CombatantData[] = generatedCharacters.map((data, index) => ({
      type: data.codename ? 'magical-girl' : 'canshou',
      data,
      filename: `${placeholders[index].filename} - ${data.codename || data.name}`,
      isValid: true,
      isPreset: false,
      isNonStandard: false,
    }));
    const existing = combatants.filter((item): item is CombatantData => !('id' in item));
    setCombatants([...existing, ...newCombatantData]);
    setError(null);
  }, [combatants, setCombatants, setError]);

  const handleClearRoster = useCallback(() => {
    useBattleStore.getState().clearCombatants();
    setError(null);
  }, [setError]);

  return {
    handleFileUpload,
    handlePaste,
    handleAddRandomPlaceholder,
    handleTeamChange,
    handleRandomMatch,
    handleScenarioUpload,
    handleScenarioPaste,
    handleSelectDataCard,
    handleResolveRandomPlaceholders,
    handleClearRoster,
    scenario,
  };
};
