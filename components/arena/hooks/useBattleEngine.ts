'use client';

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';

import type { NewsReport } from '@/components/BattleReportCard';
import { persistArrestedBackup, type ArrestedBackupDraftItem, type ArrestedBackupTriggerSource } from '@/lib/arrested-backup';
import { useCooldown } from '@/lib/cooldown';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { useBattleStore } from '../stores/useBattleStore';
import { BattleApiResponse, BattleStoreState, CombatantData } from '../types';
import { useBattleActions } from './useBattleActions';
import { useStreamCombatantUpdater } from './useStreamCombatantUpdater';
import { toBattleReportMarkdown } from '../utils/battleReportMarkdown';
import { precheckBattleReportForRedo, STREAM_TRUNCATED_BY_SENSITIVE_MARKER } from '@/lib/arena/redo-updates';
import { extractStreamTelemetryMeta, extractStreamUpdateMeta, stripStreamUpdateMetaComment } from '@/lib/arena/stream-meta';
import { createStreamReadWithTimeout, STREAM_READ_IDLE_TIMEOUT_MS, STREAM_READ_TOTAL_TIMEOUT_MS } from '@/lib/stream/timeout';
import { authStorage } from '@/lib/auth';
import { useNarrativeHistoryStore } from '../stores/useNarrativeHistoryStore';
import { resolveApiErrorMessage } from '@/lib/client/apiError';
import { formatHttpErrorMessage } from '@/lib/client/httpError';

const sanitizeTextByShieldWords = (text: string): string => applyShieldWords(text).filteredText;

const extractTitleFromBattleMarkdown = (markdown: string): string => {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  for (const line of lines) {
    if (!line) continue;
    const m = line.match(/^#{1,3}\s*(.+)$/);
    if (m?.[1]) return m[1].trim().slice(0, 120);
    return line.slice(0, 120);
  }
  return '未命名战报';
};

const appendNarrativeHistoryIfEnabled = async (payload: {
  enabled: boolean;
  title: string;
  contentMarkdown: string;
}): Promise<void> => {
  try {
    if (!payload.enabled) return;
    const title = (payload.title ?? '').toString().trim();
    const content = (payload.contentMarkdown ?? '').toString().trim();
    if (!content) return;

    const [titleCheck, contentCheck] = await Promise.all([
      quickCheck(title || '未命名战报'),
      quickCheck(content),
    ]);

    useNarrativeHistoryStore.getState().appendEntry({
      title: (titleCheck.filteredText || title || '未命名战报').trim(),
      content: (contentCheck.filteredText || content).trim(),
    });
  } catch (error) {
    // 叙事历史是“增强功能”，失败不应影响战报生成主流程（localStorage 配额/浏览器异常等）
    console.warn('写入叙事历史失败（已忽略）', error);
  }
};

const buildStreamSensitiveArrestWarrantMarkdown = (reason?: string): string => {
  const safeReason = reason?.trim() ? `（原因：${reason.trim()}）` : '';
  return [
    '',
    '',
    '---',
    '',
    '<!-- ' + STREAM_TRUNCATED_BY_SENSITIVE_MARKER + ' -->',
    '',
    '## 逮捕令',
    '',
    '**批 准 逮 捕**',
    '',
    `内容违反调查院规定${safeReason}，系统已自动截断。`,
    '',
    '⚠️ **金绿猫眼权杖严正声明** ⚠️',
    '',
    '城际网络并非法外之地！',
    '',
  ].join('\n');
};

const sanitizeReportByShieldWords = (report: NewsReport): NewsReport => ({
  ...report,
  headline: sanitizeTextByShieldWords(report.headline),
  scenario: report.scenario ? sanitizeTextByShieldWords(report.scenario) : undefined,
  aiModel: typeof report.aiModel === 'string' ? sanitizeTextByShieldWords(report.aiModel) : report.aiModel,
  reporterInfo: {
    ...report.reporterInfo,
    name: sanitizeTextByShieldWords(report.reporterInfo.name),
    publication: sanitizeTextByShieldWords(report.reporterInfo.publication),
  },
  article: {
    ...report.article,
    body: sanitizeTextByShieldWords(report.article.body),
    analysis: sanitizeTextByShieldWords(report.article.analysis),
  },
  officialReport: {
    ...report.officialReport,
    winner: sanitizeTextByShieldWords(report.officialReport.winner),
    conclusion: sanitizeTextByShieldWords(report.officialReport.conclusion),
  },
  userGuidance: report.userGuidance ? sanitizeTextByShieldWords(report.userGuidance) : undefined,
  characterGuidances: Array.isArray((report as any).characterGuidances)
    ? ((report as any).characterGuidances as any[])
        .map((item) => {
          const characterName = typeof item?.characterName === 'string' ? item.characterName.trim() : '';
          const guidance = typeof item?.guidance === 'string' ? item.guidance.trim() : '';
          if (!characterName || !guidance) return null;
          return { characterName: sanitizeTextByShieldWords(characterName), guidance: sanitizeTextByShieldWords(guidance) };
        })
        .filter((item): item is { characterName: string; guidance: string } => Boolean(item))
    : undefined,
});

const buildBattleBackupItems = (
  combatants: CombatantData[],
  scenarioContent: Record<string, unknown> | null,
  scenarioFileName: string | null,
  isScenarioNative: boolean,
  scenarioDisplayName: string | null,
  auxScenarios: { content: Record<string, unknown>; fileName: string | null; isNative: boolean }[],
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

  auxScenarios.forEach((aux, index) => {
    const title = typeof (aux.content as any)?.title === 'string' ? (aux.content as any).title.trim() : '';
    items.push({
      id: `aux-scenario-${index}`,
      label: title ? `辅助情景：${title}` : `辅助情景 #${index + 1}`,
      filename: aux.fileName || `aux-scenario-${index + 1}.json`,
      content: aux.content,
      description: aux.isNative ? '原生辅助情景文件' : '用户自定义辅助情景',
    });
  });

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
  const { updateFromMarkdown } = useStreamCombatantUpdater();
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const generationMode = useBattleSelector((state) => state.generationMode);
  const arenaFreeRankingEnabled = useBattleSelector((state) => state.arenaFreeRankingEnabled);
  const scenario = useBattleSelector((state) => state.scenario);
  const auxScenarios = useBattleSelector((state) => state.auxScenarios);
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
  const setIsRedoingUpdates = useBattleSelector((state) => state.setIsRedoingUpdates);
  const setIsStreaming = useBattleSelector((state) => state.setIsStreaming);
  const setStreamingMarkdown = useBattleSelector((state) => state.setStreamingMarkdown);
  const setStreamReporterInfo = useBattleSelector((state) => state.setStreamReporterInfo);
  const setStreamUserGuidance = useBattleSelector((state) => state.setStreamUserGuidance);
  const setStreamCharacterGuidances = useBattleSelector((state) => state.setStreamCharacterGuidances);
  const setStreamAiUsage = useBattleSelector((state) => state.setStreamAiUsage);
  const setStreamAiModel = useBattleSelector((state) => state.setStreamAiModel);
  const setStreamNarrativeHistoryReadCount = useBattleSelector((state) => state.setStreamNarrativeHistoryReadCount);
  const setStreamUpdateMetaDebug = useBattleSelector((state) => state.setStreamUpdateMetaDebug);
  const setLastGenerationId = useBattleSelector((state) => state.setLastGenerationId);
  const setCombatants = useBattleSelector((state) => state.setCombatants);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const isRedoingUpdates = useBattleSelector((state) => state.isRedoingUpdates);
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
    setIsStreaming(false);
    setStreamingMarkdown(null);
    setError(null);
    setNewsReport(null);
    setUpdatedCombatants([]);
    setAdjudicationResults(null);
    setStreamReporterInfo(null);
    setStreamUserGuidance(null);
    setStreamAiUsage(null);
    setStreamAiModel(null);
    setStreamNarrativeHistoryReadCount(null);
    setStreamUpdateMetaDebug(null);
    setLastGenerationId(null);

    try {
      await handleResolveRandomPlaceholders();

      const freshCombatants = useBattleStore.getState().combatants.filter((item): item is CombatantData => 'data' in item);

      const sensitiveTargets = [
        JSON.stringify(freshCombatants.map((c) => c.data)),
        settings.userGuidance,
        JSON.stringify(freshCombatants.map((c) => (typeof (c as any).characterGuidance === 'string' ? (c as any).characterGuidance : ''))),
        shouldUseScenario ? JSON.stringify(scenario.content) : '',
        shouldUseScenario && auxScenarios.length > 0 ? JSON.stringify(auxScenarios.map((s) => s.content)) : '',
      ];

      for (const payload of sensitiveTargets) {
        if (payload && (await checkSensitivePayload(payload, { onRedirect: redirectToArrested }))) {
          return;
        }
      }

      const teams: Record<number, string[]> = {};
      const teamNamesById = new Map<number, string>(
        useBattleStore
          .getState()
          .teams.map((team) => [team.id, typeof team.name === 'string' ? team.name.trim() : ''] as const)
      );

      freshCombatants.forEach((combatant) => {
        if (!combatant.teamId) return;
        if (!teams[combatant.teamId]) teams[combatant.teamId] = [];
        teams[combatant.teamId].push(combatant.data.codename || combatant.data.name);
      });

      const teamNames: Record<number, string> = {};
      Object.keys(teams).forEach((key) => {
        const teamId = Number(key);
        const name = teamNamesById.get(teamId);
        if (name) teamNames[teamId] = name;
      });

      const numericLimit = settings.isArenaHistoryUnlimited ? null : Math.max(1, settings.readArenaHistoryLimit);
      const arenaHistoryReadLimit = settings.readArenaHistory ? numericLimit ?? null : undefined;
      const narrativeHistoryForRequest = settings.readNarrativeHistory
        ? [...useNarrativeHistoryStore.getState().entries]
          .filter((entry) => typeof entry?.content === 'string' && entry.content.trim())
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
          .map((entry) => ({
            title: entry.title,
            content: entry.content,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          }))
        : undefined;

      const requestBody: Record<string, unknown> = {
        combatants: freshCombatants.map((combatant) => ({
          type: combatant.type,
          data: combatant.data,
          isNative: combatant.isValid,
          isPreset: combatant.isPreset,
          filename: combatant.isPreset ? combatant.filename : null,
          teamId: typeof combatant.teamId === 'number' ? combatant.teamId : null,
          characterGuidance: typeof (combatant as any).characterGuidance === 'string' ? (combatant as any).characterGuidance : null,
          sourceDataCardId: combatant.sourceDataCardId,
          sourceDataCardUpdatedAt: combatant.sourceDataCardUpdatedAt,
        })),
        selectedLevel,
        mode: battleMode,
        arenaFreeRankingEnabled,
        userGuidance: settings.userGuidance,
        scenario: shouldUseScenario ? scenario.content : undefined,
        auxScenarios: shouldUseScenario && auxScenarios.length > 0 ? auxScenarios.map((s) => s.content) : undefined,
        scenarioTitle: shouldUseScenario ? scenarioDisplayName : undefined,
        scenarioFileName: shouldUseScenario ? scenario.fileName : undefined,
        scenarioSourceDataCardId: shouldUseScenario ? scenario.sourceDataCardId : undefined,
        scenarioSourceDataCardUpdatedAt: shouldUseScenario ? scenario.sourceDataCardUpdatedAt : undefined,
        teams: Object.keys(teams).length > 0 ? teams : undefined,
        teamNames: Object.keys(teamNames).length > 0 ? teamNames : undefined,
        language: selectedLanguage,
        readArenaHistory: settings.readArenaHistory,
        arenaHistoryReadLimit,
        writeArenaHistory: settings.writeArenaHistory,
        readCurrentState: settings.readCurrentState,
        writeCurrentState: settings.writeCurrentState,
        readNarrativeHistory: settings.readNarrativeHistory,
        writeNarrativeHistory: settings.writeNarrativeHistory,
        narrativeHistory: narrativeHistoryForRequest,
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

      const authHeader = await authStorage.getAuthHeader();
      const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) requestHeaders.Authorization = authHeader;

      const applyBattleResult = async (result: BattleApiResponse, origin: 'battle' | 'battle-stream') => {
        if (typeof result.generationId === 'string' && result.generationId.trim()) {
          setLastGenerationId(result.generationId.trim());
        }

        const backupItems = buildBattleBackupItems(
          freshCombatants,
          shouldUseScenario ? scenario.content : null,
          shouldUseScenario ? scenario.fileName : null,
          shouldUseScenario ? scenario.isNative : false,
          shouldUseScenario ? scenarioDisplayName : null,
          shouldUseScenario ? auxScenarios.map((s) => ({ content: s.content, fileName: s.fileName, isNative: s.isNative })) : [],
          settings.userGuidance,
          adjudicationEvents,
          result.adjudicationResults
        );

        if (
          await checkSensitivePayload(JSON.stringify(result.report), {
            source: 'output',
            origin,
            reason: '使用危险符文',
            backupItems,
            onRedirect: redirectToArrested,
          })
        ) {
          return true;
        }

        const safeScenarioDisplayName = scenarioDisplayName ? sanitizeTextByShieldWords(scenarioDisplayName) : null;

        const reportWithScenario: NewsReport = {
          ...sanitizeReportByShieldWords(result.report),
          adjudicationResults: result.adjudicationResults,
        };

        // 仅在情景模式时附加情景标题，避免其它模式复用上一场情景标题
        if (battleMode === 'scenario' && safeScenarioDisplayName) {
          reportWithScenario.scenario = safeScenarioDisplayName;
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

        try {
          await appendNarrativeHistoryIfEnabled({
            enabled: settings.writeNarrativeHistory,
            title: reportWithScenario.headline,
            contentMarkdown: toBattleReportMarkdown(reportWithScenario),
          });
        } catch (error) {
          console.warn('写入叙事历史失败（已忽略）', error);
        }

        return false;
      };

      if (generationMode === 'stream') {
        const abortController = new AbortController();
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

	        try {
	          setStreamCharacterGuidances(null);
	          const debugSseQuery = (() => {
	            try {
	              if (typeof window === 'undefined') return '';
	              const raw = new URLSearchParams(window.location.search).get('debugSse') || '';
	              const normalized = raw.trim().toLowerCase();
	              if (normalized === '1' || normalized === 'true') return '&debugSse=1';
	              return '';
	            } catch {
	              return '';
	            }
	          })();
	          const debugSseEnabled = Boolean(debugSseQuery);
	          const response = await fetch(`/api/arena/generate-stream?format=sse${debugSseQuery}`, {
	            method: 'POST',
	            headers: requestHeaders,
	            body: JSON.stringify(requestBody),
	            signal: abortController.signal,
	          });

          if (!response.ok) {
            const text = await response.text();
            let json: any = null;
            try {
              json = JSON.parse(text);
            } catch {
              if (response.status === 524) {
                throw new Error('Cloudflare 超时（HTTP 524），请稍后重试。');
              }
              const serverMessage = resolveApiErrorMessage({ payload: text, fallback: '服务器响应异常' });
              throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '服务器响应异常' }));
            }

            if (json.shouldRedirect) {
              redirectToArrested(json.reason || '使用危险符文');
              return;
            }
            const serverMessage = resolveApiErrorMessage({ payload: json, fallback: '生成失败' });
            throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '生成失败' }));
          }

	          reader = response.body?.getReader() ?? null;
	          if (!reader) {
	            throw new Error('无法读取响应流，请使用最新版本的浏览器。');
	          }

	          const contentType = response.headers.get('content-type') || '';
	          const isSseResponse = contentType.includes('text/event-stream');
	          if (debugSseEnabled) {
	            console.info('SSE 调试：响应信息', {
	              status: response.status,
	              contentType,
	              isSseResponse,
	              clientReadIdleTimeoutMs: STREAM_READ_IDLE_TIMEOUT_MS,
	              clientReadTotalTimeoutMs: STREAM_READ_TOTAL_TIMEOUT_MS,
	            });
	          }

	          const metaHeader = response.headers.get('x-mahoshojo-stream-meta');
          if (metaHeader) {
            try {
              const parsed = JSON.parse(decodeURIComponent(metaHeader));
              const generationId = typeof parsed?.generationId === 'string' ? parsed.generationId.trim() : '';
              if (generationId) {
                setLastGenerationId(generationId);
              }

              const reporterInfo = parsed?.reporterInfo;
              if (reporterInfo && typeof reporterInfo === 'object') {
                const name = typeof reporterInfo.name === 'string' ? reporterInfo.name : '';
                const publication = typeof reporterInfo.publication === 'string' ? reporterInfo.publication : '';
                if (name && publication) {
                  setStreamReporterInfo({ name: sanitizeTextByShieldWords(name), publication: sanitizeTextByShieldWords(publication) });
                }
              }

              const userGuidance = typeof parsed?.userGuidance === 'string' ? parsed.userGuidance.trim() : '';
              if (userGuidance) {
                setStreamUserGuidance(sanitizeTextByShieldWords(userGuidance));
              }

              const characterGuidancesRaw = Array.isArray(parsed?.characterGuidances) ? parsed.characterGuidances : null;
              if (characterGuidancesRaw && characterGuidancesRaw.length > 0) {
                const normalized = characterGuidancesRaw
                  .map((item: any) => {
                    const characterName = typeof item?.characterName === 'string' ? item.characterName.trim() : '';
                    const guidance = typeof item?.guidance === 'string' ? item.guidance.trim() : '';
                    if (!characterName || !guidance) return null;
                    return { characterName: sanitizeTextByShieldWords(characterName), guidance: sanitizeTextByShieldWords(guidance) };
                  })
                  .filter(Boolean);
                if (normalized.length > 0) {
                  setStreamCharacterGuidances(normalized as any);
                }
              }

              const adjudicationResults = Array.isArray(parsed?.adjudicationResults) ? parsed.adjudicationResults : null;
              if (adjudicationResults && adjudicationResults.length > 0) {
                setAdjudicationResults(adjudicationResults);
              }

              const aiModel = typeof parsed?.ai?.model === 'string' ? parsed.ai.model.trim() : '';
              if (aiModel) {
                setStreamAiModel(sanitizeTextByShieldWords(aiModel));
              }
            } catch (metaError) {
              // 元信息解析失败不影响正文流式展示
              console.warn('解析流式战报元信息失败，将继续渲染正文', metaError);
            }
          } else {
            const snapshotGuidance = settings.userGuidance.trim();
            if (snapshotGuidance) {
              setStreamUserGuidance(sanitizeTextByShieldWords(snapshotGuidance));
            }
            const snapshotCharacterGuidances = freshCombatants
              .map((c) => {
                const characterName = (c.data.codename || c.data.name || '').toString().trim();
                const guidance = typeof (c as any).characterGuidance === 'string' ? String((c as any).characterGuidance).trim() : '';
                if (!characterName || !guidance) return null;
                return { characterName: sanitizeTextByShieldWords(characterName), guidance: sanitizeTextByShieldWords(guidance) };
              })
              .filter(Boolean);
            if (snapshotCharacterGuidances.length > 0) {
              setStreamCharacterGuidances(snapshotCharacterGuidances as any);
            }
          }

          const decoder = new TextDecoder();
          let accumulatedText = '';
          let shouldAbort = false;
          let metaOverrideFromSse:
            | {
              report?: { headline?: string; winner?: string };
              impacts?: Array<{ characterName: string; impact?: string; currentStateSummary?: string }>;
            }
            | undefined;
          const shouldTerminateByTelemetry = (text: string) => {
            const marker = '<!-- MAHOSHOJO_TELEMETRY_META';
            const trimmed = text.trimEnd();
            const idx = trimmed.lastIndexOf(marker);
            if (idx < 0) return false;
            if (!trimmed.endsWith('-->')) return false;
            return trimmed.length - idx < 4096;
          };
	          const readWithTimeout = createStreamReadWithTimeout({
	            label: '战报流式生成',
	            idleTimeoutMs: STREAM_READ_IDLE_TIMEOUT_MS,
	            totalTimeoutMs: STREAM_READ_TOTAL_TIMEOUT_MS,
	            onTimeout: (timeoutError) => {
	              if (debugSseEnabled) {
	                console.warn('SSE 调试：读流超时', {
	                  kind: (timeoutError as any)?.kind ?? null,
	                  timeoutMs: (timeoutError as any)?.timeoutMs ?? null,
	                  message: timeoutError instanceof Error ? timeoutError.message : String(timeoutError ?? 'timeout'),
	                });
	              }
	              try {
	                abortController.abort();
	              } catch {
	                // ignore
	              }
	              if (reader) {
	                try {
	                  void reader.cancel('timeout').catch(() => {});
	                } catch {
	                  // ignore
	                }
	              }
	            },
	          });
          const streamBackupItems = buildBattleBackupItems(
            freshCombatants,
            shouldUseScenario ? scenario.content : null,
            shouldUseScenario ? scenario.fileName : null,
            shouldUseScenario ? scenario.isNative : false,
            shouldUseScenario && scenarioDisplayName ? sanitizeTextByShieldWords(scenarioDisplayName) : null,
            shouldUseScenario ? auxScenarios.map((s) => ({ content: s.content, fileName: s.fileName, isNative: s.isNative })) : [],
            settings.userGuidance,
            adjudicationEvents
          );
          let lastCheckedLength = 0;

          setStreamingMarkdown(accumulatedText);
          setIsStreaming(true);

          const getIncrementalCheckSlice = (fullText: string): { slice: string; startIndex: number } => {
            if (fullText.length < lastCheckedLength) {
              lastCheckedLength = 0;
            }
            const overlap = 256;
            const start = Math.max(0, lastCheckedLength - overlap);
            const slice = fullText.slice(start);
            lastCheckedLength = fullText.length;
            return { slice, startIndex: start };
          };

          if (isSseResponse) {
            let sseBuffer = '';
            let sawDoneEvent = false;
            let sseBytesRead = 0;
            let sseChunksRead = 0;
            let sseEventsParsed = 0;

            const parseSseBlock = (block: string): { event: string; data: string } | null => {
              const lines = block.split('\n');
              let event = 'message';
              const dataLines: string[] = [];
              for (const line of lines) {
                if (!line) continue;
                if (line.startsWith(':')) continue;
                if (line.startsWith('event:')) {
                  event = line.slice('event:'.length).trim() || 'message';
                  continue;
                }
                if (line.startsWith('data:')) {
                  dataLines.push(line.slice('data:'.length).trimStart());
                  continue;
                }
              }
              if (dataLines.length === 0) return null;
              return { event, data: dataLines.join('\n') };
            };

            const handleSensitiveIfNeeded = async () => {
              const { slice: sliceToCheck, startIndex: sliceStartIndex } = getIncrementalCheckSlice(accumulatedText);
              const sensitiveCheck = await quickCheck(sliceToCheck);
              if (!sensitiveCheck.hasSensitiveWords) return false;

              if (streamBackupItems.length > 0) {
                persistArrestedBackup({
                  triggerSource: 'output',
                  origin: 'battle-stream',
                  reason: '使用危险符文',
                  items: streamBackupItems,
                });
              }

              const firstMatch = sensitiveCheck.matchDetails.reduce<null | { startIndex: number }>((picked, item) => {
                if (!picked) return { startIndex: item.startIndex };
                return item.startIndex < picked.startIndex ? { startIndex: item.startIndex } : picked;
              }, null);

              const fallbackMatchIndex = (() => {
                const candidates = sensitiveCheck.detectedWords
                  .filter((word) => typeof word === 'string' && word.trim() && !word.includes('变体'))
                  .map((word) => sliceToCheck.indexOf(word))
                  .filter((index) => index >= 0);
                return candidates.length > 0 ? Math.min(...candidates) : 0;
              })();

              const cutStartInSlice = firstMatch?.startIndex ?? fallbackMatchIndex;
              const cutIndex = Math.max(0, Math.min(accumulatedText.length, sliceStartIndex + cutStartInSlice));
              accumulatedText = accumulatedText.slice(0, cutIndex);
              accumulatedText += buildStreamSensitiveArrestWarrantMarkdown('使用危险符文');

              setStreamingMarkdown(sanitizeTextByShieldWords(accumulatedText));

              shouldAbort = true;
              try {
                void reader!.cancel('sensitive').catch(() => {});
              } catch {
                // ignore
              }
              return true;
            };

            const handleSseEvent = async (event: string, data: string) => {
              let payload: any = null;
              try {
                payload = data ? JSON.parse(data) : null;
              } catch {
                payload = null;
              }

              if (event === 'markdown') {
                const chunk = typeof payload?.chunk === 'string' ? payload.chunk : '';
                if (chunk) {
                  accumulatedText += chunk;
                  if (await handleSensitiveIfNeeded()) return;
                  setStreamingMarkdown(sanitizeTextByShieldWords(accumulatedText));
                }
                return;
              }

              if (event === 'telemetry') {
                const usage = payload?.usage ?? null;
                setStreamAiUsage((usage ?? null) as NewsReport['aiUsage'] | null);
                const narrativeCount =
                  typeof payload?.narrativeHistoryReadCount === 'number' ? payload.narrativeHistoryReadCount : null;
                setStreamNarrativeHistoryReadCount(narrativeCount);
                const aiModel = typeof payload?.aiModel === 'string' ? payload.aiModel.trim() : '';
                if (aiModel) {
                  setStreamAiModel(sanitizeTextByShieldWords(aiModel));
                }
                return;
              }

              if (event === 'meta') {
                if (payload?.parseOk && payload?.meta && typeof payload.meta === 'object') {
                  const meta = payload.meta as any;
                  metaOverrideFromSse = {
                    ...(meta.report ? { report: meta.report } : {}),
                    ...(Array.isArray(meta.impacts) && meta.impacts.length > 0 ? { impacts: meta.impacts } : {}),
                  };
                  setStreamUpdateMetaDebug({
                    source: 'sse',
                    parseOk: true,
                    error: null,
                    meta: meta,
                    raw: typeof payload?.raw === 'string' ? payload.raw : null,
                    rawTruncated: Boolean(payload?.rawTruncated),
                  });
                }
                return;
              }

              if (event === 'meta_error') {
                setStreamUpdateMetaDebug({
                  source: 'sse',
                  parseOk: false,
                  error: typeof payload?.error === 'string' ? payload.error : 'meta_error',
                  meta: null,
                  raw: typeof payload?.raw === 'string' ? payload.raw : null,
                  rawTruncated: Boolean(payload?.rawTruncated),
                });
                return;
              }

              if (event === 'debug') {
                if (payload && typeof payload === 'object') {
                  console.info('SSE 调试事件', payload);
                } else if (typeof payload !== 'undefined') {
                  console.info('SSE 调试事件', payload);
                }
                return;
              }

              if (event === 'error') {
                const message = typeof payload?.error === 'string' ? payload.error : '服务器流式响应异常';
                setError(`✨ 生成失败：${sanitizeTextByShieldWords(message)}`);
                shouldAbort = true;
                sawDoneEvent = true;
                try {
                  void reader!.cancel('server-error-event').catch(() => {});
                } catch {
                  // ignore
                }
                return;
              }

              if (event === 'done') {
                sawDoneEvent = true;
                return;
              }
            };

            while (true) {
              const { value, done } = await readWithTimeout(reader);
              if (done) break;
              if (!value) continue;

              sseChunksRead += 1;
              sseBytesRead += value.byteLength;

              const decodedChunkRaw = decoder.decode(value, { stream: true });
              const decoded = decodedChunkRaw.replace(/\r\n/g, '\n');

              sseBuffer += decoded;

              let idx = sseBuffer.indexOf('\n\n');
              while (idx !== -1) {
                const block = sseBuffer.slice(0, idx);
                sseBuffer = sseBuffer.slice(idx + 2);
                const parsed = parseSseBlock(block);
                if (parsed) {
                  sseEventsParsed += 1;
                  await handleSseEvent(parsed.event, parsed.data);
                }
                if (shouldAbort || sawDoneEvent) break;
                idx = sseBuffer.indexOf('\n\n');
              }

              if (shouldAbort || sawDoneEvent) {
                break;
              }
            }

            // flush TextDecoder：避免最后一个 chunk 以多字节字符结尾时丢字
            sseBuffer += decoder.decode().replace(/\r\n/g, '\n');

            // 尝试消费尾部的完整事件块（若存在）；残余不完整块忽略即可
            let idx = sseBuffer.indexOf('\n\n');
            while (idx !== -1) {
              const block = sseBuffer.slice(0, idx);
              sseBuffer = sseBuffer.slice(idx + 2);
              const parsed = parseSseBlock(block);
              if (parsed) {
                sseEventsParsed += 1;
                await handleSseEvent(parsed.event, parsed.data);
              }
              if (shouldAbort || sawDoneEvent) break;
              idx = sseBuffer.indexOf('\n\n');
            }

            if (debugSseEnabled) {
              const previewMax = 400;
              const remainingPreview = sseBuffer.length > previewMax ? sseBuffer.slice(0, previewMax) : sseBuffer;
              console.info('SSE 调试：读取结束', {
                chunks: sseChunksRead,
                bytes: sseBytesRead,
                parsedEvents: sseEventsParsed,
                sawDoneEvent,
                remainingBufferChars: sseBuffer.length,
                remainingPreview,
                remainingTruncated: sseBuffer.length > previewMax,
              });
              if (sseBytesRead === 0) {
                console.warn('SSE 调试：响应流为 0 字节（服务端可能提前结束，或中间层吞掉了流式内容）');
              } else if (sseEventsParsed === 0) {
                console.warn('SSE 调试：收到 SSE 字节但未解析出任何事件（可能是分隔符/格式不符合 SSE）');
              }
            }
          } else {
            while (true) {
              const { value, done } = await readWithTimeout(reader);
              if (done) {
                break;
              }
              if (!value) {
                continue;
              }

              const chunk = decoder.decode(value, { stream: true });
              accumulatedText += chunk;

              const { slice: sliceToCheck, startIndex: sliceStartIndex } = getIncrementalCheckSlice(accumulatedText);
              const sensitiveCheck = await quickCheck(sliceToCheck);
              if (sensitiveCheck.hasSensitiveWords) {
                if (streamBackupItems.length > 0) {
                  persistArrestedBackup({
                    triggerSource: 'output',
                    origin: 'battle-stream',
                    reason: '使用危险符文',
                    items: streamBackupItems,
                  });
                }

                const firstMatch = sensitiveCheck.matchDetails.reduce<null | { startIndex: number }>((picked, item) => {
                  if (!picked) return { startIndex: item.startIndex };
                  return item.startIndex < picked.startIndex ? { startIndex: item.startIndex } : picked;
                }, null);

                const fallbackMatchIndex = (() => {
                  const candidates = sensitiveCheck.detectedWords
                    .filter((word) => typeof word === 'string' && word.trim() && !word.includes('变体'))
                    .map((word) => sliceToCheck.indexOf(word))
                    .filter((index) => index >= 0);
                  return candidates.length > 0 ? Math.min(...candidates) : 0;
                })();

                const cutStartInSlice = firstMatch?.startIndex ?? fallbackMatchIndex;

                const cutIndex = Math.max(0, Math.min(accumulatedText.length, sliceStartIndex + cutStartInSlice));
                accumulatedText = accumulatedText.slice(0, cutIndex);
                accumulatedText += buildStreamSensitiveArrestWarrantMarkdown('使用危险符文');

                setStreamingMarkdown(sanitizeTextByShieldWords(accumulatedText));

                shouldAbort = true;
                try {
                  void reader.cancel('sensitive').catch(() => {});
                } catch {
                  // ignore
                }
                break;
              }

              setStreamingMarkdown(sanitizeTextByShieldWords(accumulatedText));

                if (shouldTerminateByTelemetry(accumulatedText)) {
                  try {
                    void reader.cancel('telemetry-meta-received').catch(() => {});
                  } catch {
                    // ignore
                  }
                  break;
                }

              if (shouldAbort) {
                break;
              }
            }
          }

          if (shouldAbort) {
            setNewsReport(null);
            return;
          }

          let markdownForUi = accumulatedText;
          let metaOverride =
            isSseResponse ? metaOverrideFromSse : undefined;

          if (!isSseResponse) {
            // flush TextDecoder：避免最后一个 chunk 以多字节字符结尾时丢字
            accumulatedText += decoder.decode();
            setStreamingMarkdown(sanitizeTextByShieldWords(accumulatedText));

            // 流式正文末尾可能包含 HTML 注释 JSON 元数据（用于角色更新的 impacts/currentStateSummary）。
            // 此处尽量提取并修复解析；失败时回退到仅基于 Markdown 的更新逻辑。
            markdownForUi = accumulatedText;

            try {
              // 先移除并提取系统追加的 telemetry 注释（token/叙事历史读取条数），避免影响后续更新元数据解析。
              const telemetryExtracted = await extractStreamTelemetryMeta(accumulatedText);
              if (telemetryExtracted?.meta) {
                const usage = telemetryExtracted.meta.usage ?? null;
                const narrativeCount =
                  typeof telemetryExtracted.meta.narrativeHistoryReadCount === 'number'
                    ? telemetryExtracted.meta.narrativeHistoryReadCount
                    : null;
                setStreamAiUsage((usage ?? null) as NewsReport['aiUsage'] | null);
                setStreamNarrativeHistoryReadCount(narrativeCount);
                const aiModel = typeof telemetryExtracted.meta.aiModel === 'string' ? telemetryExtracted.meta.aiModel.trim() : '';
                if (aiModel) {
                  setStreamAiModel(sanitizeTextByShieldWords(aiModel));
                }
              }
              if (telemetryExtracted && typeof telemetryExtracted.strippedMarkdown === 'string') {
                markdownForUi = telemetryExtracted.strippedMarkdown;
              }

              const allowStreamMeta = settings.writeArenaHistory || settings.writeCurrentState;

              if (allowStreamMeta) {
                const extracted = await extractStreamUpdateMeta(markdownForUi);
                if (extracted?.meta && (extracted.meta.report || (extracted.meta.impacts && extracted.meta.impacts.length > 0))) {
                  metaOverride = {
                    ...(extracted.meta.report ? { report: extracted.meta.report } : {}),
                    ...(extracted.meta.impacts && extracted.meta.impacts.length > 0 ? { impacts: extracted.meta.impacts } : {}),
                  };
                  const rawMax = 8_000;
                  const raw = extracted.rawComment ?? '';
                  setStreamUpdateMetaDebug({
                    source: 'inline',
                    parseOk: true,
                    error: null,
                    meta: extracted.meta as any,
                    raw: raw.length > rawMax ? raw.slice(0, rawMax) : raw,
                    rawTruncated: raw.length > rawMax,
                  });
                } else {
                  setStreamUpdateMetaDebug({
                    source: 'inline',
                    parseOk: false,
                    error: '未检测到 MAHOSHOJO_*_META（模型可能漏写或格式不匹配）',
                    meta: null,
                    raw: null,
                    rawTruncated: false,
                  });
                }
                if (extracted && typeof extracted.strippedMarkdown === 'string') {
                  markdownForUi = extracted.strippedMarkdown;
                }
              } else {
                // 未开启任何写入：仍然移除潜在的元数据注释，避免用户看到“系统专用内容”
                const stripped = stripStreamUpdateMetaComment(markdownForUi);
                if (stripped && typeof stripped.strippedMarkdown === 'string') {
                  markdownForUi = stripped.strippedMarkdown;
                }
              }
            } catch (metaError) {
              console.warn('解析流式战报元数据失败，将回退到 Markdown 解析更新', metaError);
              if (settings.writeArenaHistory || settings.writeCurrentState) {
                setStreamUpdateMetaDebug({
                  source: 'inline',
                  parseOk: false,
                  error: metaError instanceof Error ? metaError.message : 'meta parse failed',
                  meta: null,
                  raw: null,
                  rawTruncated: false,
                });
              }
            }
          } else {
            // SSE 模式下：正文与 meta/telemetry 已分通道，但仍做一次兜底剥离（防止异常情况下 meta 泄漏进正文）
            const stripped = stripStreamUpdateMetaComment(markdownForUi);
            if (stripped && typeof stripped.strippedMarkdown === 'string') {
              markdownForUi = stripped.strippedMarkdown;
            }
          }

          setStreamingMarkdown(sanitizeTextByShieldWords(markdownForUi));

          const trimmedForValidation = markdownForUi.trim();
          const allowStreamMeta = settings.writeArenaHistory || settings.writeCurrentState;
          const hasMetaImpacts = allowStreamMeta && Boolean(metaOverride?.impacts?.length);
          const looksLikeCompleteReport = hasMetaImpacts
            ? true
            : trimmedForValidation.length >= 120 && /^#{2,6}\s*/m.test(trimmedForValidation);

          // 与非流式保持一致：生成失败/中断时不进入冷却，并优先展示“生成失败”而不是“角色更新失败”。
          if (!looksLikeCompleteReport) {
            if (!trimmedForValidation) {
              setStreamingMarkdown(null);
              setError('✨ 魔法失效了！服务端响应为空，未收到有效内容。');
            } else {
              // 尝试判断内容是否是一段纯文本报错（通常比较短，且不包含 Markdown 标题符）
              const isLikelyErrorMessage = trimmedForValidation.length < 300 && !trimmedForValidation.includes('# ');

              if (isLikelyErrorMessage) {
                // 直接显示服务端返回的错误文字
                setError(`✨ 生成失败，服务端返回信息：${trimmedForValidation}`);
              } else {
                // 内容很长但格式不对，或者是半截战报
                setError(`✨ 魔法失效了！战报生成中断或格式校验失败（当前长度 ${trimmedForValidation.length} 字符）。`);
              }
            }
            return;
          }

          if (hasMetaImpacts && !trimmedForValidation) {
            setError('⚠️ 战报正文为空，但检测到角色更新元数据，已尝试继续更新角色数据。');
          }

          try {
            await appendNarrativeHistoryIfEnabled({
              enabled: settings.writeNarrativeHistory,
              title: extractTitleFromBattleMarkdown(markdownForUi),
              contentMarkdown: markdownForUi,
            });
          } catch (error) {
            console.warn('写入叙事历史失败（已忽略）', error);
          }

          startCooldown();

          if (settings.writeArenaHistory || settings.writeCurrentState) {
            try {
              await updateFromMarkdown(
                markdownForUi,
                freshCombatants,
                battleMode,
                {
                  userGuidance: settings.userGuidance,
                  writeArenaHistory: settings.writeArenaHistory,
                  writeCurrentState: settings.writeCurrentState,
                },
                shouldUseScenario ? scenario.content : null,
                metaOverride
              );
            } catch (updateError) {
              const message = updateError instanceof Error ? updateError.message : '发生未知错误，请重试。';
              setError(`⚠️ 流式战报已生成，但角色更新失败：${message}`);
            }
          }

          return;
        } finally {
          if (reader) {
            try {
              void reader.cancel().catch(() => {});
            } catch {
              // ignore
            }
          }
          abortController.abort();
        }
      }

      const response = await fetch('/api/generate-battle-story', {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const text = await response.text();
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          if (response.status === 524) {
            throw new Error('Cloudflare 超时（HTTP 524），请稍后重试。');
          }
          const serverMessage = resolveApiErrorMessage({ payload: text, fallback: '服务器响应异常' });
          throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '服务器响应异常' }));
        }

        if (json.shouldRedirect) {
          redirectToArrested(json.reason || '使用危险符文');
          return;
        }
        const serverMessage = resolveApiErrorMessage({ payload: json, fallback: '生成失败' });
        throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '生成失败' }));
      }

      const result: BattleApiResponse = await response.json();

      if (await applyBattleResult(result, 'battle')) {
        return;
      }

      startCooldown();
    } catch (error) {
      setError(`✨ 魔法失效了！${error instanceof Error ? error.message : '发生未知错误，请重试。'}`);
      setNewsReport(null);
    } finally {
      setIsGenerating(false);
      setIsStreaming(false);
    }
  }, [
    isCooldown,
    remainingTime,
    battleMode,
    generationMode,
    arenaFreeRankingEnabled,
    combatants,
    scenario,
    auxScenarios,
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
    setIsStreaming,
    setStreamingMarkdown,
	    setStreamReporterInfo,
	    setStreamUserGuidance,
	    setStreamCharacterGuidances,
	    setStreamAiUsage,
	    setStreamAiModel,
	    setStreamNarrativeHistoryReadCount,
      setStreamUpdateMetaDebug,
      setLastGenerationId,
		    setCombatants,
		    handleResolveRandomPlaceholders,
	    redirectToArrested,
	    startCooldown,
    updateFromMarkdown,
  ]);

  const handleRedoUpdates = useCallback(async () => {
    if (isCooldown) {
      setError(`冷却中，请等待 ${remainingTime} 秒后再重做更新。`);
      return;
    }

    const shouldUseScenario = battleMode === 'scenario' && Boolean(scenario.content);
    const roster = useBattleStore.getState().combatants.filter((item): item is CombatantData => 'data' in item);

    if (roster.length === 0) {
      setError('⚠️ 没有可更新的参战角色。');
      return;
    }

    if (!(settings.writeArenaHistory || settings.writeCurrentState)) {
      setError('⚠️ 已关闭历战记录/当前状态写入，本次无需重做角色更新。');
      return;
    }

    const state = useBattleStore.getState();
    const reportMarkdown =
      generationMode === 'stream'
        ? (state.streamingMarkdown ?? '').trim()
        : (state.newsReport ? toBattleReportMarkdown(state.newsReport) : '').trim();

    const redoPrecheck = precheckBattleReportForRedo(reportMarkdown, battleMode);
    if (!redoPrecheck.ok) {
      setError(`⚠️ ${redoPrecheck.error}`);
      return;
    }

    setIsRedoingUpdates(true);
    setError(null);

    try {
      const requestBody: Record<string, unknown> = {
        combatants: roster.map((combatant) => ({
          type: combatant.type,
          data: combatant.data,
          isNative: combatant.isValid,
          isPreset: combatant.isPreset,
        })),
        battleReportMarkdown: reportMarkdown,
        mode: battleMode,
        userGuidance: settings.userGuidance,
        scenario: shouldUseScenario ? scenario.content : undefined,
        writeArenaHistory: settings.writeArenaHistory,
        writeCurrentState: settings.writeCurrentState,
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

      const response = await fetch('/api/arena/redo-combatant-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const text = await response.text();
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          if (response.status === 524) {
            throw new Error('Cloudflare 超时（HTTP 524），请稍后重试。');
          }
          const serverMessage = resolveApiErrorMessage({ payload: text, fallback: '服务器响应异常' });
          throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '服务器响应异常' }));
        }

        if (json.shouldRedirect) {
          redirectToArrested(json.reason || '使用危险符文');
          return;
        }
        const serverMessage = resolveApiErrorMessage({ payload: json, fallback: '生成失败' });
        throw new Error(formatHttpErrorMessage({ serverMessage, status: response.status, fallback: '生成失败' }));
      }

      const result = await response.json();
      const updated = Array.isArray(result.updatedCombatants) ? result.updatedCombatants : [];

      setUpdatedCombatants(updated);
      const updatedRoster = roster.map((combatant) => {
        const next = updated.find(
          (item: any) => (item.codename || item.name) === (combatant.data.codename || combatant.data.name)
        );
        return next ? { ...combatant, data: next } : combatant;
      });
      setCombatants(updatedRoster);

      startCooldown();
    } catch (error) {
      setError(`⚠️ 重做角色更新失败：${error instanceof Error ? error.message : '发生未知错误，请重试。'}`);
    } finally {
      setIsRedoingUpdates(false);
    }
  }, [
    isCooldown,
    remainingTime,
    battleMode,
    generationMode,
    scenario.content,
    settings.userGuidance,
    settings.writeArenaHistory,
    settings.writeCurrentState,
    userProviderConfig,
    setCombatants,
    setError,
    setUpdatedCombatants,
    setIsRedoingUpdates,
    redirectToArrested,
    startCooldown,
  ]);

  return {
    handleGenerate,
    handleRedoUpdates,
    isGenerating,
    isRedoingUpdates,
    isCooldown,
    remainingTime,
  };
};
