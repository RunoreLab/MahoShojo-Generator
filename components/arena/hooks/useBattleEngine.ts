'use client';

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';

import { NewsReport } from '@/components/BattleReportCard';
import { persistArrestedBackup, type ArrestedBackupDraftItem, type ArrestedBackupTriggerSource } from '@/lib/arrested-backup';
import { useCooldown } from '@/lib/cooldown';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { useBattleStore } from '../stores/useBattleStore';
import { BattleApiResponse, BattleStoreState, CombatantData } from '../types';
import { useBattleActions } from './useBattleActions';

const buildBattleBackupItems = (
  combatants: CombatantData[],
  scenarioContent: Record<string, unknown> | null,
  scenarioFileName: string | null,
  isScenarioNative: boolean,
  scenarioDisplayName: string | null,
  userGuidance: string,
  adjudicationEvents: any[],
  adjudicationResults?: any[] | null
): ArrestedBackupDraftItem[] => {
  const items: ArrestedBackupDraftItem[] = [];

  combatants.forEach((combatant, index) => {
    items.push({
      id: `combatant-${index}`,
      label: `参战者：${combatant.data.codename || combatant.data.name || combatant.filename}`,
      filename: combatant.filename,
      content: combatant.data,
      description: combatant.isPreset ? '预设角色' : '用户上传角色',
    });
  });

  if (scenarioContent) {
    items.push({
      id: 'scenario',
      label: scenarioDisplayName ? `情景：${scenarioDisplayName}` : '情景设定',
      filename: scenarioFileName || 'scenario.json',
      content: scenarioContent,
      description: isScenarioNative ? '原生情景文件' : '用户自定义情景',
    });
  }

  if (userGuidance.trim()) {
    items.push({
      id: 'user-guidance',
      label: '故事引导文本',
      filename: 'user-guidance.txt',
      mimeType: 'text/plain',
      content: userGuidance.trim(),
    });
  }

  if (adjudicationEvents.length > 0) {
    items.push({
      id: 'adjudication-events',
      label: '随机判定器配置',
      filename: 'adjudication-events.json',
      content: adjudicationEvents,
      description: '用户设置的随机事件链',
    });
  }

  if (adjudicationResults?.length) {
    items.push({
      id: 'adjudication-results',
      label: '随机判定结果',
      filename: 'adjudication-results.json',
      content: adjudicationResults,
      description: '本次生成返回的判定结果',
    });
  }

  return items;
};

const checkSensitivePayload = async (
  payload: string,
  options: {
    source?: ArrestedBackupTriggerSource;
    reason?: string;
    origin?: string;
    backupItems?: ArrestedBackupDraftItem[];
    onRedirect?: (reason?: string, withBackup?: boolean) => void;
  }
): Promise<boolean> => {
  const result = await quickCheck(payload);
  if (!result.hasSensitiveWords) {
    return false;
  }

  if (options.source === 'output') {
    const backupItems = options.backupItems ?? [];
    if (backupItems.length > 0) {
      persistArrestedBackup({
        triggerSource: 'output',
        origin: options.origin || 'battle',
        reason: options.reason,
        items: backupItems,
      });
    }
    options.onRedirect?.(options.reason, (options.backupItems?.length ?? 0) > 0);
    return true;
  }

  options.onRedirect?.(options.reason);
  return true;
};

export const useBattleEngine = () => {
  const router = useRouter();
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const scenario = useBattleSelector((state) => state.scenario);
  const selectedLevel = useBattleSelector((state) => state.selectedLevel);
  const selectedLanguage = useBattleSelector((state) => state.selectedLanguage);
  const storyLength = useBattleSelector((state) => state.storyLength);
  const settings = useBattleSelector((state) => state.settings);
  const adjudicationEvents = useBattleSelector((state) => state.adjudicationEvents);
  const userProviderConfig = useBattleSelector((state) => state.userProviderConfig);
  const setError = useBattleSelector((state) => state.setError);
  const setNewsReport = useBattleSelector((state) => state.setNewsReport);
  const setUpdatedCombatants = useBattleSelector((state) => state.setUpdatedCombatants);
  const setAdjudicationResults = useBattleSelector((state) => state.setAdjudicationResults);
  const setIsGenerating = useBattleSelector((state) => state.setIsGenerating);
  const setCombatants = useBattleSelector((state) => state.setCombatants);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const { handleResolveRandomPlaceholders } = useBattleActions();

  const isUserCustomKey =
    userProviderConfig?.providerId !== 'system' && Boolean(userProviderConfig?.apiKey?.trim());
  const battleCooldownMs = isUserCustomKey ? 3000 : 120000;
  const battleCooldownStorageKey = isUserCustomKey ? 'generateBattleCooldown:custom' : 'generateBattleCooldown:system';
  const { isCooldown, startCooldown, remainingTime } = useCooldown(battleCooldownStorageKey, battleCooldownMs);

  const scenarioDisplayName = useMemo(() => {
    // 只有在情景模式下才需要展示情景标题，避免切换到其他模式后沿用上一次的情景小标题
    if (battleMode !== 'scenario') return null;
    const content = scenario.content;
    if (content) {
      const title = (content as any).title;
      if (typeof title === 'string' && title.trim()) {
        return title.trim();
      }
    }
    if (scenario.fileName) {
      return scenario.fileName.replace(/\.json$/i, '');
    }
    return null;
  }, [battleMode, scenario.content, scenario.fileName]);

  const redirectToArrested = useCallback(
    (reason?: string, withBackup?: boolean) => {
      const query: Record<string, string> = {};
      if (reason) query.reason = reason;
      if (withBackup) query.backup = '1';
      router.push({ pathname: '/arrested', query });
    },
    [router]
  );

  const handleGenerate = useCallback(async () => {
    if (isCooldown) {
      setError(`冷却中，请等待 ${remainingTime} 秒后再生成。`);
      return;
    }

    const minParticipants = battleMode === 'daily' || battleMode === 'scenario' ? 1 : 2;
    const shouldUseScenario = battleMode === 'scenario' && Boolean(scenario.content);

    // 计算总角色数（包括占位符，因为它们会被解析为真实角色）
    const totalCombatants = combatants.length;

    if (totalCombatants < minParticipants || totalCombatants > 10) {
      setError(`⚠️ 该模式需要 ${minParticipants} 到 10 位角色。`);
      return;
    }

    if (battleMode === 'scenario' && !scenario.content) {
      setError('⚠️ 情景模式下，请先上传一个情景文件。');
      return;
    }

    if (userProviderConfig && userProviderConfig.providerId !== 'system' && !userProviderConfig.apiKey) {
      setError('⚠️ 已选择自定义 AI 供应商，但尚未填写 API Key。');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setNewsReport(null);
    setUpdatedCombatants([]);
    setAdjudicationResults(null);

    try {
      await handleResolveRandomPlaceholders();

      const freshCombatants = useBattleStore.getState().combatants.filter((item): item is CombatantData => 'data' in item);

      const sensitiveTargets = [
        JSON.stringify(freshCombatants.map((c) => c.data)),
        settings.userGuidance,
        shouldUseScenario ? JSON.stringify(scenario.content) : '',
      ];

      for (const payload of sensitiveTargets) {
        if (payload && (await checkSensitivePayload(payload, { onRedirect: redirectToArrested }))) {
          return;
        }
      }

      const teams: Record<number, string[]> = {};
      freshCombatants.forEach((combatant) => {
        if (combatant.teamId) {
          if (!teams[combatant.teamId]) teams[combatant.teamId] = [];
          teams[combatant.teamId].push(combatant.data.codename || combatant.data.name);
        }
      });

      const numericLimit = settings.isArenaHistoryUnlimited ? null : Math.max(1, settings.readArenaHistoryLimit);
      const arenaHistoryReadLimit = settings.readArenaHistory ? numericLimit ?? null : undefined;

      const requestBody: Record<string, unknown> = {
        combatants: freshCombatants.map((combatant) => ({
          type: combatant.type,
          data: combatant.data,
          isNative: combatant.isValid,
          isPreset: combatant.isPreset,
        })),
        selectedLevel,
        mode: battleMode,
        userGuidance: settings.userGuidance,
        scenario: shouldUseScenario ? scenario.content : undefined,
        teams: Object.keys(teams).length > 0 ? teams : undefined,
        language: selectedLanguage,
        readArenaHistory: settings.readArenaHistory,
        arenaHistoryReadLimit,
        writeArenaHistory: settings.writeArenaHistory,
        readCurrentState: settings.readCurrentState,
        writeCurrentState: settings.writeCurrentState,
        isDowngrade: false,
        adjudicationEvents,
        storyLength,
      };

      if (
        userProviderConfig &&
        (userProviderConfig.apiKey || userProviderConfig.providerId === 'system') &&
        userProviderConfig.modelId !== 'default'
      ) {
        requestBody.customProvider = {
          providerId: userProviderConfig.providerId,
          modelId: userProviderConfig.modelId,
          apiKey: userProviderConfig.apiKey,
        };
      }

      const response = await fetch('/api/generate-battle-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const text = await response.text();
        try {
          const json = JSON.parse(text);
          if (json.shouldRedirect) {
            redirectToArrested(json.reason || '使用危险符文');
            return;
          }
          throw new Error(json.message || json.error || text);
        } catch {
          throw new Error('服务器响应异常，可能是服务暂时不可用，请稍后再试。');
        }
      }

      const result: BattleApiResponse = await response.json();

      const backupItems = buildBattleBackupItems(
        freshCombatants,
        shouldUseScenario ? scenario.content : null,
        shouldUseScenario ? scenario.fileName : null,
        shouldUseScenario ? scenario.isNative : false,
        shouldUseScenario ? scenarioDisplayName : null,
        settings.userGuidance,
        adjudicationEvents,
        result.adjudicationResults
      );

      if (
        await checkSensitivePayload(JSON.stringify(result.report), {
          source: 'output',
          origin: 'battle',
          reason: '使用危险符文',
          backupItems,
          onRedirect: redirectToArrested,
        })
      ) {
        return;
      }

      const reportWithScenario: NewsReport = {
        ...result.report,
        adjudicationResults: result.adjudicationResults,
      };

      // 仅在情景模式时附加情景标题，避免其它模式复用上一场情景标题
      if (battleMode === 'scenario' && scenarioDisplayName) {
        reportWithScenario.scenario = scenarioDisplayName;
      } else {
        // 非情景模式下显式移除 scenario 字段，杜绝旧标题残留
        delete (reportWithScenario as any).scenario;
      }

      setNewsReport(reportWithScenario);
      setUpdatedCombatants(result.updatedCombatants);
      if (result.adjudicationResults) {
        setAdjudicationResults(result.adjudicationResults);
      }

      const updatedRoster = freshCombatants.map((combatant) => {
        const updated = result.updatedCombatants.find(
          (item) => (item.codename || item.name) === (combatant.data.codename || combatant.data.name)
        );
        return updated ? { ...combatant, data: updated } : combatant;
      });
      setCombatants(updatedRoster);

      startCooldown();
    } catch (error) {
      setError(`✨ 魔法失效了！${error instanceof Error ? error.message : '发生未知错误，请重试。'}`);
    } finally {
      setIsGenerating(false);
    }
  }, [
    isCooldown,
    remainingTime,
    battleMode,
    combatants,
    scenario,
    userProviderConfig,
    settings,
    selectedLevel,
    selectedLanguage,
    storyLength,
    adjudicationEvents,
    scenarioDisplayName,
    setError,
    setNewsReport,
    setUpdatedCombatants,
    setAdjudicationResults,
    setIsGenerating,
    setCombatants,
    handleResolveRandomPlaceholders,
    redirectToArrested,
    startCooldown,
  ]);

  return {
    handleGenerate,
    isGenerating,
    isCooldown,
    remainingTime,
  };
};
