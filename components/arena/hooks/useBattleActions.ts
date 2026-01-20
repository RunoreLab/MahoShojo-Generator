'use client';

import { useCallback } from 'react';

import { inferTemplate } from '@/lib/data-card-converter';
import { generateRandomCanshou, generateRandomMagicalGirl } from '@/lib/random-character-generator';

import { useBattleStore } from '../stores/useBattleStore';
import {
  AuxiliaryScenarioState,
  BattleStoreState,
  CombatantData,
  MAX_AUX_SCENARIOS,
  MAX_COMBATANTS,
  RandomCombatantPlaceholder,
} from '../types';
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

const createClientId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const useBattleActions = () => {
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const auxScenarios = useBattleSelector((state) => state.auxScenarios);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const setError = useBattleSelector((state) => state.setError);
  const addCombatant = useBattleSelector((state) => state.addCombatant);
  const setCombatants = useBattleSelector((state) => state.setCombatants);
  const setScenario = useBattleSelector((state) => state.setScenario);
  const addAuxScenario = useBattleSelector((state) => state.addAuxScenario);
  const removeAuxScenario = useBattleSelector((state) => state.removeAuxScenario);
  const moveAuxScenario = useBattleSelector((state) => state.moveAuxScenario);
  const clearAuxScenarios = useBattleSelector((state) => state.clearAuxScenarios);
  const setAuxScenarios = useBattleSelector((state) => state.setAuxScenarios);
  const setAdjudicationEvents = useBattleSelector((state) => state.setAdjudicationEvents);
  const scenario = useBattleSelector((state) => state.scenario);

  const buildAuxScenario = useCallback(
    async (input: {
      id?: string;
      rawScenario: any;
      fileName: string;
      sourceDataCardId?: string;
      sourceDataCardName?: string;
      sourceDataCardUpdatedAt?: string;
      sourceIsPublic?: boolean;
      sourceAuthor?: string;
    }): Promise<AuxiliaryScenarioState> => {
      const parsed = ScenarioSchema.safeParse(input.rawScenario);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || '情景文件缺少必需字段');
      }

      const isNative = await verifyOrigin(parsed.data);
      return {
        id: input.id || createClientId('aux-scenario'),
        content: parsed.data,
        fileName: input.fileName,
        isNative,
        sourceDataCardId: input.sourceDataCardId,
        sourceDataCardUpdatedAt: input.sourceDataCardUpdatedAt,
        sourceDataCardName: input.sourceDataCardName,
        sourceIsPublic: input.sourceIsPublic,
        sourceAuthor: input.sourceAuthor,
      };
    },
    []
  );

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

  const handleSelectDataCard = useCallback(
    async (cardData: any) => {
      const sourceDataCardId = typeof cardData?._cardId === 'string' ? cardData._cardId : undefined;
      const sourceDataCardName = typeof cardData?._cardName === 'string' ? cardData._cardName : undefined;
      const sourceDataCardDescription =
        typeof cardData?._cardDescription === 'string' ? cardData._cardDescription : undefined;
      const sourceDataCardCreatedAt = typeof cardData?._createdAt === 'string' ? cardData._createdAt : undefined;
      const sourceDataCardUpdatedAt = typeof cardData?._updatedAt === 'string' ? cardData._updatedAt : undefined;
      const sourceIsPublic = typeof cardData?._isPublic === 'boolean'
        ? cardData._isPublic
        : (typeof cardData?._isPublic === 'number' ? cardData._isPublic === 1 : undefined);
      const sourceAuthor = typeof cardData?._author === 'string' ? cardData._author : undefined;
      const sourceDataCardLikeCount = typeof cardData?._likeCount === 'number' ? cardData._likeCount : undefined;
      const sourceDataCardFavoriteCount =
        typeof cardData?._favoriteCount === 'number' ? cardData._favoriteCount : undefined;
      const sourceDataCardUsageCount = typeof cardData?._usageCount === 'number' ? cardData._usageCount : undefined;

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
        if (inferredTemplate === 'scenario' || inferredTemplate === 'general-scenario') {
          if (useBattleStore.getState().battleMode !== 'scenario') {
            setError('❌ 情景数据卡只能在情景模式下使用。');
            return;
          }

          const isNative = await verifyOrigin(cleanedCardData);
          setScenario({
            content: cleanedCardData,
            fileName: `${cardData._cardName || resolvedName}.json`,
            isNative,
            sourceDataCardId,
            sourceDataCardDescription,
            sourceDataCardCreatedAt,
            sourceDataCardUpdatedAt,
            sourceDataCardName,
            sourceIsPublic,
            sourceAuthor,
            sourceDataCardUsageCount,
            sourceDataCardLikeCount,
            sourceDataCardFavoriteCount,
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
          sourceDataCardId,
          sourceDataCardDescription,
          sourceDataCardCreatedAt,
          sourceDataCardUpdatedAt,
          sourceDataCardName,
          sourceIsPublic,
          sourceAuthor,
          sourceDataCardUsageCount,
          sourceDataCardLikeCount,
          sourceDataCardFavoriteCount,
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
          _cardDescription: result.card.description || '',
          _isPublic: result.card.is_public,
          _updatedAt: result.card.updated_at,
          _createdAt: result.card.created_at,
          _author: result.card.username || '未知',
          _likeCount: typeof result.card.like_count === 'number' ? result.card.like_count : undefined,
          _favoriteCount: typeof result.card.favorite_count === 'number' ? result.card.favorite_count : undefined,
          _usageCount: typeof result.card.usage_count === 'number' ? result.card.usage_count : undefined,
        });
      } catch (error) {
        setError(`❌ 随机匹配失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        useBattleStore.getState().setIsMatching(null);
      }
    },
    [combatants.length, handleSelectDataCard, setError]
  );

  const handleToggleAuxScenarioDataCard = useCallback(
    async (cardData: any, nextSelected: boolean) => {
      if (useBattleStore.getState().battleMode !== 'scenario') {
        setError('❌ 仅在情景模式下可添加辅助情景。');
        return;
      }
      if (!useBattleStore.getState().scenario.content) {
        setError('❌ 请先选择主情景，再添加辅助情景。');
        return;
      }

      const sourceDataCardId = typeof cardData?._cardId === 'string' ? cardData._cardId : undefined;
      const sourceDataCardName = typeof cardData?._cardName === 'string' ? cardData._cardName : undefined;
      const sourceDataCardUpdatedAt = typeof cardData?._updatedAt === 'string' ? cardData._updatedAt : undefined;
      const sourceIsPublic = typeof cardData?._isPublic === 'boolean'
        ? cardData._isPublic
        : (typeof cardData?._isPublic === 'number' ? cardData._isPublic === 1 : undefined);
      const sourceAuthor = typeof cardData?._author === 'string' ? cardData._author : undefined;

      const cleanedCardData = removePrivateKeys(cardData);
      const inferredTemplate = inferTemplate(cleanedCardData);
      if (inferredTemplate !== 'scenario' && inferredTemplate !== 'general-scenario') {
        setError('❌ 请选择“情景”类型的数据卡。');
        return;
      }

      const auxId = sourceDataCardId ? `aux-scenario-card-${sourceDataCardId}` : createClientId('aux-scenario');

      if (!nextSelected) {
        // 多选模式中取消：优先按 sourceDataCardId 匹配，否则按 id 匹配
        setAuxScenarios(
          useBattleStore
            .getState()
            .auxScenarios.filter((item) =>
              sourceDataCardId ? item.sourceDataCardId !== sourceDataCardId : item.id !== auxId
            )
        );
        setError(null);
        return;
      }

      if (useBattleStore.getState().auxScenarios.length >= MAX_AUX_SCENARIOS) {
        setError(`❌ 最多只能添加 ${MAX_AUX_SCENARIOS} 个辅助情景。`);
        return;
      }
      if (sourceDataCardId && useBattleStore.getState().auxScenarios.some((item) => item.sourceDataCardId === sourceDataCardId)) {
        return;
      }

      // 检查是否已在加载中（防止重复点击）
      if (loadingCards.has(auxId)) {
        return;
      }
      loadingCards.add(auxId);

      try {
        const resolvedName = getCombatantDisplayName(cleanedCardData);
        const built = await buildAuxScenario({
          id: auxId,
          rawScenario: cleanedCardData,
          fileName: `${sourceDataCardName || resolvedName}.json`,
          sourceDataCardId,
          sourceDataCardName,
          sourceDataCardUpdatedAt,
          sourceIsPublic,
          sourceAuthor,
        });
        addAuxScenario(built);
        setError(null);
      } catch (error) {
        setError(`❌ 添加辅助情景失败: ${error instanceof Error ? error.message : '未知错误'}`);
      } finally {
        loadingCards.delete(auxId);
      }
    },
    [addAuxScenario, buildAuxScenario, setAuxScenarios, setError]
  );

  const handleToggleCombatantDataCard = useCallback(
    async (cardData: any, nextSelected: boolean) => {
      const sourceDataCardId = typeof cardData?._cardId === 'string' ? cardData._cardId : '';
      if (!sourceDataCardId) return;

      if (!nextSelected) {
        const currentCombatants = useBattleStore.getState().combatants;
        setCombatants(
          currentCombatants.filter((combatant) => {
            if (!('sourceDataCardId' in combatant)) return true;
            if (typeof combatant.sourceDataCardId !== 'string') return true;
            return combatant.sourceDataCardId !== sourceDataCardId;
          })
        );
        setError(null);
        return;
      }

      await handleSelectDataCard(cardData);
    },
    [handleSelectDataCard, setCombatants, setError]
  );

  const handleRandomMatchAuxScenario = useCallback(async () => {
    if (!useBattleStore.getState().scenario.content) {
      setError('❌ 请先选择主情景，再添加辅助情景。');
      return;
    }
    if (useBattleStore.getState().auxScenarios.length >= MAX_AUX_SCENARIOS) {
      setError(`最多只能选择 ${MAX_AUX_SCENARIOS} 个辅助情景。`);
      return;
    }
    useBattleStore.getState().setIsMatching('scenario');
    setError('正在从数据库中随机寻找一份公开的辅助情景...');
    try {
      const response = await fetch('/api/random-public-card?type=scenario');
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '无法获取随机数据');
      }
      const cardData = JSON.parse(result.card.data);
      await handleToggleAuxScenarioDataCard(
        {
          ...cardData,
          _cardId: result.card.id,
          _cardName: result.card.name,
          _cardDescription: result.card.description || '',
          _isPublic: result.card.is_public,
          _updatedAt: result.card.updated_at,
          _createdAt: result.card.created_at,
          _author: result.card.username || '未知',
          _likeCount: typeof result.card.like_count === 'number' ? result.card.like_count : undefined,
          _favoriteCount: typeof result.card.favorite_count === 'number' ? result.card.favorite_count : undefined,
          _usageCount: typeof result.card.usage_count === 'number' ? result.card.usage_count : undefined,
        },
        true
      );
    } catch (error) {
      setError(`❌ 随机匹配失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      useBattleStore.getState().setIsMatching(null);
    }
  }, [handleToggleAuxScenarioDataCard, setError]);

  const handleScenarioUpload = useCallback(
    async (file: File) => {
      const text = await file.text();
      const json = JSON.parse(text);
      const parsed = ScenarioSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || '情景文件缺少必需字段');
      }
      const isNative = await verifyOrigin(parsed.data);
      const scenarioLabel = (parsed.data as any)?.title || (parsed.data as any)?.name || file.name;
      setScenario({
        content: parsed.data,
        fileName: file.name,
        isNative,
      });
      appendAdjudicationEvents((parsed.data as any).adjudicationEvents, scenarioLabel);
      setError(null);
    },
    [appendAdjudicationEvents, setError, setScenario]
  );

  const handleAuxScenarioUpload = useCallback(
    async (file: File) => {
      if (useBattleStore.getState().battleMode !== 'scenario') {
        throw new Error('仅在情景模式下可添加辅助情景。');
      }
      if (!useBattleStore.getState().scenario.content) {
        throw new Error('请先选择主情景，再添加辅助情景。');
      }
      if (useBattleStore.getState().auxScenarios.length >= MAX_AUX_SCENARIOS) {
        throw new Error(`最多只能添加 ${MAX_AUX_SCENARIOS} 个辅助情景。`);
      }

      const text = await file.text();
      const json = JSON.parse(text);
      const built = await buildAuxScenario({
        rawScenario: json,
        fileName: file.name,
      });
      addAuxScenario(built);
      setError(null);
    },
    [addAuxScenario, buildAuxScenario, setError]
  );

  const handleScenarioPaste = useCallback(
    async (text: string, options?: { fileName?: string }) => {
      const parsed = ScenarioSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || '情景文件缺少必需字段');
      }
      const isNative = await verifyOrigin(parsed.data);
      const scenarioLabel = (parsed.data as any)?.title || (parsed.data as any)?.name || '粘贴的情景';
      const scenarioFileName = options?.fileName || scenarioLabel;
      setScenario({
        content: parsed.data,
        fileName: scenarioFileName,
        isNative,
      });
      appendAdjudicationEvents((parsed.data as any).adjudicationEvents, scenarioLabel);
      setError(null);
    },
    [appendAdjudicationEvents, setError, setScenario]
  );

  const handleAuxScenarioPaste = useCallback(
    async (text: string, options?: { fileName?: string }) => {
      if (useBattleStore.getState().battleMode !== 'scenario') {
        throw new Error('仅在情景模式下可添加辅助情景。');
      }
      if (!useBattleStore.getState().scenario.content) {
        throw new Error('请先选择主情景，再添加辅助情景。');
      }
      if (useBattleStore.getState().auxScenarios.length >= MAX_AUX_SCENARIOS) {
        throw new Error(`最多只能添加 ${MAX_AUX_SCENARIOS} 个辅助情景。`);
      }

      const parsed = ScenarioSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || '情景文件缺少必需字段');
      }

      const scenarioLabel = (parsed.data as any)?.title || (parsed.data as any)?.name || `辅助情景 ${useBattleStore.getState().auxScenarios.length + 1}`;
      const scenarioFileName =
        options?.fileName || (scenarioLabel ? `${scenarioLabel}.json` : '粘贴的辅助情景.json');
      const built = await buildAuxScenario({
        rawScenario: parsed.data,
        fileName: scenarioFileName,
      });
      addAuxScenario(built);
      setError(null);
    },
    [addAuxScenario, buildAuxScenario, setError]
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
      teamId: placeholders[index].teamId,
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
    handleRandomMatch,
    handleScenarioUpload,
    handleScenarioPaste,
    handleAuxScenarioUpload,
    handleAuxScenarioPaste,
    handleToggleAuxScenarioDataCard,
    handleToggleCombatantDataCard,
    handleRandomMatchAuxScenario,
    handleSelectDataCard,
    handleResolveRandomPlaceholders,
    handleClearRoster,
    auxScenarios,
    removeAuxScenario,
    moveAuxScenario,
    clearAuxScenarios,
    scenario,
  };
};
