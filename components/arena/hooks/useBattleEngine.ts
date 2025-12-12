'use client';

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';

import { NewsReport } from '@/components/BattleReportCard';
import { persistArrestedBackup, type ArrestedBackupDraftItem, type ArrestedBackupTriggerSource } from '@/lib/arrested-backup';
import { useCooldown } from '@/lib/cooldown';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { useBattleStore } from '../stores/useBattleStore';
import { BattleApiResponse, CombatantData } from '../types';
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
  const combatants = useBattleStore((state) => state.combatants);
  const battleMode = useBattleStore((state) => state.battleMode);
  const scenario = useBattleStore((state) => state.scenario);
  const selectedLevel = useBattleStore((state) => state.selectedLevel);
  const selectedLanguage = useBattleStore((state) => state.selectedLanguage);
  const storyLength = useBattleStore((state) => state.storyLength);
  const settings = useBattleStore((state) => state.settings);
  const adjudicationEvents = useBattleStore((state) => state.adjudicationEvents);
  const userProviderConfig = useBattleStore((state) => state.userProviderConfig);
  const setError = useBattleStore((state) => state.setError);
  const setNewsReport = useBattleStore((state) => state.setNewsReport);
  const setUpdatedCombatants = useBattleStore((state) => state.setUpdatedCombatants);
  const setAdjudicationResults = useBattleStore((state) => state.setAdjudicationResults);
  const setIsGenerating = useBattleStore((state) => state.setIsGenerating);
  const setCombatants = useBattleStore((state) => state.setCombatants);
  const isGenerating = useBattleStore((state) => state.isGenerating);
  const { handleResolveRandomPlaceholders } = useBattleActions();

  const isUserCustomKey =
    userProviderConfig?.providerId !== 'system' && Boolean(userProviderConfig?.apiKey?.trim());
  const battleCooldownMs = isUserCustomKey ? 3000 : 120000;
  const battleCooldownStorageKey = isUserCustomKey ? 'generateBattleCooldown:custom' : 'generateBattleCooldown:system';
  const { isCooldown, startCooldown, remainingTime } = useCooldown(battleCooldownStorageKey, battleCooldownMs);

  const scenarioDisplayName = useMemo(() => {
    const content = scenario.content;
    if (content) {
      const title = content.title;
      if (typeof title === 'string' && title.trim()) {
        return title.trim();
      }
    }
    if (scenario.fileName) {
      return scenario.fileName.replace(/\.json$/i, '');
    }
    return null;
  }, [scenario.content, scenario.fileName]);

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
    const playableCombatants = combatants.filter((item): item is CombatantData => 'data' in item);

    if (playableCombatants.length < minParticipants || playableCombatants.length > 10) {
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
        scenario.content ? JSON.stringify(scenario.content) : '',
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
        scenario: scenario.content,
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
        scenario.content,
        scenario.fileName,
        scenario.isNative,
        scenarioDisplayName,
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
        scenario: scenarioDisplayName ?? result.report.scenario,
      };

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
