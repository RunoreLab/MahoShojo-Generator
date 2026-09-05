'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArenaRoomHostRuntimeGenerationSchema } from '@mahoshojo/contracts/arena-room';
import {
  ARENA_CANONICAL_CAPABILITIES,
  evaluateArenaBasicGenerationReadiness,
} from '@mahoshojo/contracts/arena-capabilities';

import type { NewsReport } from '@/components/BattleReportCard';
import { persistArrestedBackup, type ArrestedBackupDraftItem, type ArrestedBackupTriggerSource } from '@/lib/arrested-backup';
import { useClientRouteAdapter } from '@/lib/client-route-adapter';
import { useProviderModeCooldown } from '@/lib/cooldown';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { buildStreamSensitiveArrestWarrantMarkdown } from '@/lib/stream/arrest-warrant';
import {
  STREAM_ABORT_REASON_CONTENT_POLICY,
  STREAM_ABORT_REASON_USER,
} from '@/lib/stream/abort';
import { useBattleStore } from '../stores/useBattleStore';
import { BattleAiImpact, BattleApiResponse, BattleStoreState, CombatantData } from '../types';
import { useBattleActions } from './useBattleActions';
import { useStreamCombatantUpdater } from './useStreamCombatantUpdater';
import { toBattleReportMarkdown } from '../utils/battleReportMarkdown';
import { extractStreamTelemetryMeta, extractStreamUpdateMeta, stripStreamUpdateMetaComment } from '@/lib/arena/stream-meta';
import { normalizeUsage } from '@/lib/arena/battle-report-log-utils';
import {
  buildStreamSoftTimeoutMessage,
  createStreamReadWithTimeout,
  STREAM_READ_IDLE_TIMEOUT_MS,
  STREAM_READ_TOTAL_TIMEOUT_MS,
  StreamReadTimeoutError,
} from '@/lib/stream/timeout';
import { authStorage } from '@/lib/auth';
import {
  createPinnedGenerationApiSafeReadDispatcher,
  createGenerationApiIntent,
  isGenerationApiClientErrorCode,
  type GenerationApiIntent,
} from '@/lib/hono-api-client';
import { useGenerationApiIntentLatch } from '@/lib/use-generation-api-intent-latch';
import { useNarrativeHistoryStore } from '../stores/useNarrativeHistoryStore';
import { resolveApiErrorMessage } from '@/lib/client/apiError';
import { formatHttpErrorMessage } from '@/lib/client/httpError';
import { appendReasoningDelta, normalizeReasoningSource, updateReasoningStatus } from '@/lib/ai/reasoning-normalizer';
import {
  appendArenaNarrativeHistoryResult,
  materializeArenaNarrativeHistoryForRequest,
} from '@/lib/arena-room/narrative-history-runtime';
import type { AIReasoningSource } from '@/types/ai-reasoning';
import {
  ARENA_PROVIDER_COOLDOWN_BASE_KEY,
  resolveArenaProviderCooldownConfig,
} from '../utils/providerCooldown';
import { normalizeCustomStoryLength } from '@/lib/story-length';
import { buildCustomProviderRequestPayload } from '@/lib/ai/custom-provider';
import {
  parseGenerationRankingResponse,
  type GenerationRankingResponse,
} from '@/lib/arena/generation-ranking';
import {
  arenaGenerationConnectionNotice,
  captureArenaGenerationActorToken,
  mergeArenaGenerationSnapshotMarkdown,
  openArenaGenerationStream,
  type ArenaGenerationConnectionState,
  withArenaGenerationActorToken,
} from '@/lib/arena/resumable-generation-client';
import { buildArenaRoomHostWorkspaceBundleFromBattleState } from '@/lib/arena-room/shared-config';
import {
  areArenaRoomSharedConfigsEqual,
  arenaRoomHostWorkspaceAuthorityFromSession,
  type ArenaRoomGenerationStartInputs,
  type ArenaRoomHostWorkspaceDirtyReason,
} from '@/lib/arena-room/host-workspace';
import {
  assertArenaRoomGenerationReady,
  dispatchArenaRoomGenerationRetry,
  dispatchArenaRoomGenerationStart,
  resolveArenaRoomGenerationAction,
} from '../multiplayer/generation-bridge';
import { useArenaRoomContext } from '../multiplayer/useArenaRoom';
import {
  arenaRoomGenerationSyncGateMessage,
  canAutoPublishArenaRoomHostDraft,
  canPublishArenaRoomGenerationDraft,
  isArenaRoomGenerationFenceCurrent,
  isArenaRoomGenerationSyncSettled,
  pendingProposalFingerprint,
} from '../multiplayer/generation-preflight';

const sanitizeTextByShieldWords = (text: string): string => applyShieldWords(text).filteredText;

export type ArenaRoomGenerationPreflightChoice = 'cancel' | 'publish' | 'sync-room' | 'confirm-start';

export type ArenaRoomGenerationPreflightPrompt = Readonly<{
  reasons: readonly ArenaRoomHostWorkspaceDirtyReason[];
  canPublish: boolean;
  canConfirmStart: boolean;
  pendingProposalCount: number;
  busy: boolean;
}>;

let sharedGenerationAbortController: AbortController | null = null;

const isStreamInterruptedError = (error: unknown): boolean => {
  if (error instanceof StreamReadTimeoutError) return true;
  if (!error) return false;
  const errorRecord = error as { name?: unknown; message?: unknown };
  const name = typeof errorRecord.name === 'string' ? errorRecord.name.toLowerCase() : '';
  const message = typeof errorRecord.message === 'string' ? errorRecord.message.toLowerCase() : '';
  if (name === 'aborterror' || name === 'streamreadtimeouterror') return true;
  if (message.includes('流式读取超时') || message.includes('流式生成超时')) return true;
  if (message.includes('timeout') || message.includes('timed out')) return true;
  if (message.includes('aborted') || message.includes('中断')) return true;
  if (message.includes('arena_resume_attempts_exhausted')) return true;
  return false;
};

const buildStreamInterruptedMessage = (details?: string): string => {
  const tail = typeof details === 'string' && details.trim() ? `：${details.trim()}` : '';
  return `⚠️ 战报流中断${tail}，请稍后再试。`;
};

const normalizeBattleAiImpacts = (input: unknown): BattleAiImpact[] => {
  if (!Array.isArray(input)) return [];

  const normalized = input
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const record = raw as Record<string, unknown>;
      const characterName = typeof record.characterName === 'string' ? record.characterName.trim() : '';
      if (!characterName) return null;

      const impact = typeof record.impact === 'string' ? record.impact.trim() : '';
      const currentStateSummary =
        typeof record.currentStateSummary === 'string' ? record.currentStateSummary.trim() : '';

      return {
        characterName: sanitizeTextByShieldWords(characterName),
        ...(impact ? { impact: sanitizeTextByShieldWords(impact) } : {}),
        ...(currentStateSummary ? { currentStateSummary: sanitizeTextByShieldWords(currentStateSummary) } : {}),
      } satisfies BattleAiImpact;
    })
    .filter((item): item is BattleAiImpact => Boolean(item));

  if (normalized.length === 0) return [];

  const deduped = new Map<string, BattleAiImpact>();
  for (const item of normalized) {
    if (!deduped.has(item.characterName)) {
      deduped.set(item.characterName, item);
      continue;
    }
    const previous = deduped.get(item.characterName)!;
    deduped.set(item.characterName, {
      characterName: item.characterName,
      impact: item.impact ?? previous.impact,
      currentStateSummary: item.currentStateSummary ?? previous.currentStateSummary,
    });
  }

  return Array.from(deduped.values());
};

const isServerInterruptedPayload = (payload: any, fallbackMessage: string): boolean => {
  const status = typeof payload?.status === 'string' ? payload.status.trim().toLowerCase() : '';
  if (status === 'aborted' || status === 'interrupted') return true;
  if (payload?.interrupted === true) return true;
  if (typeof payload?.errorCode === 'string' && payload.errorCode === 'stream_interrupted') return true;
  return isStreamInterruptedError({ message: fallbackMessage });
};

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
  aiReasoning: (() => {
    const reasoning = report.aiReasoning;
    if (!reasoning || typeof reasoning !== 'object') return reasoning;

    const sanitizedParts = Array.isArray(reasoning.parts)
      ? reasoning.parts.map((part) => ({
          ...part,
          text: typeof part?.text === 'string' ? sanitizeTextByShieldWords(part.text) : part?.text,
        }))
      : reasoning.parts;

    return {
      ...reasoning,
      summary: typeof reasoning.summary === 'string' ? sanitizeTextByShieldWords(reasoning.summary) : reasoning.summary,
      text: typeof reasoning.text === 'string' ? sanitizeTextByShieldWords(reasoning.text) : reasoning.text,
      errorMessage:
        typeof reasoning.errorMessage === 'string' ? sanitizeTextByShieldWords(reasoning.errorMessage) : reasoning.errorMessage,
      parts: sanitizedParts,
    };
  })(),
});

const buildBattleBackupItems = (
  combatants: CombatantData[],
  scenarioContent: Record<string, unknown> | null,
  scenarioFileName: string | null,
  isScenarioNative: boolean,
  scenarioDisplayName: string | null,
  auxScenarios: { content: Record<string, unknown>; fileName: string | null; isNative: boolean }[],
  materials: { content: unknown; fileName: string | null; isNative: boolean; name: string }[],
  userGuidance: string,
  adjudicationEvents: any[],
  adjudicationResults?: any[] | null
): ArrestedBackupDraftItem[] => {
  const items: ArrestedBackupDraftItem[] = [];
  const toBackupContent = (value: unknown): ArrestedBackupDraftItem['content'] => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return value as Record<string, unknown>;
    return String(value ?? '');
  };

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

  materials.forEach((material, index) => {
    items.push({
      id: `material-${index}`,
      label: material.name ? `素材：${material.name}` : `素材 #${index + 1}`,
      filename: material.fileName || `material-${index + 1}.json`,
      content: toBackupContent(material.content),
      description: material.isNative ? '原生素材' : '用户素材',
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
  const generationApiIntentLatch = useGenerationApiIntentLatch();
  const queryClient = useQueryClient();
  const router = useClientRouteAdapter();
  const { updateFromMarkdown, retryGenerationUpdate } = useStreamCombatantUpdater();
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const battleMode = useBattleSelector((state) => state.battleMode);
  const generationMode = useBattleSelector((state) => state.generationMode);
  const arenaFreeRankingEnabled = useBattleSelector((state) => state.arenaFreeRankingEnabled);
  const scenario = useBattleSelector((state) => state.scenario);
  const auxScenarios = useBattleSelector((state) => state.auxScenarios);
  const materials = useBattleSelector((state) => state.materials);
  const selectedQuestionnaires = useBattleSelector((state) => state.selectedQuestionnaires);
  const selectedLanguage = useBattleSelector((state) => state.selectedLanguage);
  const storyLength = useBattleSelector((state) => state.storyLength);
  const customStoryLength = useBattleSelector((state) => state.customStoryLength);
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
  const setStreamReasoning = useBattleSelector((state) => state.setStreamReasoning);
  const setStreamUpdateMetaDebug = useBattleSelector((state) => state.setStreamUpdateMetaDebug);
  const setStreamSoftTimeoutWarning = useBattleSelector((state) => state.setStreamSoftTimeoutWarning);
  const setLatestAiImpacts = useBattleSelector((state) => state.setLatestAiImpacts);
  const setLastGenerationRepairContext = useBattleSelector(
    (state) => state.setLastGenerationRepairContext,
  );
  const setCombatants = useBattleSelector((state) => state.setCombatants);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const streamSoftTimeoutWarning = useBattleSelector((state) => state.streamSoftTimeoutWarning);
  const isRedoingUpdates = useBattleSelector((state) => state.isRedoingUpdates);
  const { handleResolveRandomPlaceholders } = useBattleActions();
  const arenaRoomRuntime = useArenaRoomContext();
  const [arenaRoomGenerationPreflight, setArenaRoomGenerationPreflight] = useState<ArenaRoomGenerationPreflightPrompt | null>(null);
  const pendingArenaRoomGenerationPreflight = useRef<{
    resolve: (choice: ArenaRoomGenerationPreflightChoice) => void;
  } | null>(null);

  const requestArenaRoomGenerationPreflight = useCallback((
    input: Readonly<{
      reasons: readonly ArenaRoomHostWorkspaceDirtyReason[];
      canPublish: boolean;
      canConfirmStart?: boolean;
      pendingProposalCount?: number;
    }>,
  ): Promise<ArenaRoomGenerationPreflightChoice> => {
    pendingArenaRoomGenerationPreflight.current?.resolve('cancel');
    return new Promise((resolve) => {
      pendingArenaRoomGenerationPreflight.current = { resolve };
      setArenaRoomGenerationPreflight({
        reasons: input.reasons,
        canPublish: input.canPublish,
        canConfirmStart: input.canConfirmStart ?? false,
        pendingProposalCount: input.pendingProposalCount ?? 0,
        busy: false,
      });
    });
  }, []);

  const resolveArenaRoomGenerationPreflight = useCallback((choice: ArenaRoomGenerationPreflightChoice) => {
    const pending = pendingArenaRoomGenerationPreflight.current;
    if (!pending) return;
    pendingArenaRoomGenerationPreflight.current = null;
    if (choice === 'publish') {
      setArenaRoomGenerationPreflight((current) => current ? { ...current, busy: true } : null);
    } else {
      setArenaRoomGenerationPreflight(null);
    }
    pending.resolve(choice);
  }, []);

  useEffect(() => () => {
    const pending = pendingArenaRoomGenerationPreflight.current;
    pendingArenaRoomGenerationPreflight.current = null;
    pending?.resolve('cancel');
  }, []);

  const providerCooldownConfig = resolveArenaProviderCooldownConfig(userProviderConfig);
  const { currentMode: providerCooldownMode } = providerCooldownConfig;
  const { isCooldown, startCooldown, remainingTime, otherRemainingTime } = useProviderModeCooldown({
    baseKey: ARENA_PROVIDER_COOLDOWN_BASE_KEY,
    ...providerCooldownConfig,
  });

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
    let lastArenaConnectionState: ArenaGenerationConnectionState | null = null;
    let recoveryNoticeActive = false;
    const roomAction = arenaRoomRuntime
      ? resolveArenaRoomGenerationAction(arenaRoomRuntime.state)
      : { inRoom: false, canStart: true, canRetry: false, reason: null } as const;
    if (roomAction.inRoom && roomAction.canRetry && arenaRoomRuntime) {
      const outcome = await dispatchArenaRoomGenerationRetry({
        controller: arenaRoomRuntime.controller,
        state: arenaRoomRuntime.state,
      });
      if (outcome !== 'submitted') {
        setError(outcome === 'stale'
          ? '⚠️ 房间状态已变化，请确认最新状态后再重试。'
          : '⚠️ 当前没有可安全重试的多人生成请求。');
      }
      return;
    }
    if (roomAction.inRoom && !roomAction.canStart) {
      const message = roomAction.reason === 'member'
        ? '⚠️ 多人房间仅房主可以启动生成，请等待房主操作。'
        : roomAction.reason === 'config-unknown'
          ? '⚠️ 上一次房间配置发布结果尚未确认，请先重新确认权威快照。'
        : roomAction.reason === 'unknown'
          ? '⚠️ 上一次多人生成启动结果尚未确认，请等待服务器状态恢复，不要重复提交。'
          : roomAction.reason === 'connection'
            ? '⚠️ 房间连接尚未恢复，暂不能启动多人生成。'
            : '⚠️ 当前房间已有生成任务，请等待其结束。';
      setError(message);
      return;
    }
    if (isCooldown) {
      setError(`冷却中，请等待 ${remainingTime} 秒后再生成。`);
      return;
    }

    const shouldUseScenario = battleMode === 'scenario' && Boolean(scenario.content);

    // 计算总角色数（包括占位符，因为它们会被解析为真实角色）
    const totalCombatants = combatants.length;
    const basicReadinessIssues = evaluateArenaBasicGenerationReadiness({
      battleMode,
      combatantCount: totalCombatants,
      hasScenario: Boolean(scenario.content),
    });

    const combatantIssue = basicReadinessIssues.find((issue) => (
      issue.code === 'GENERATION_COMBATANTS_EMPTY'
      || issue.code === 'GENERATION_COMBATANTS_INSUFFICIENT'
    ));
    if (!roomAction.inRoom && combatantIssue) {
      const required = ARENA_CANONICAL_CAPABILITIES.minCombatantsByMode[battleMode];
      setError(`⚠️ 该模式至少需要 ${required} 位角色。`);
      return;
    }

    if (
      !roomAction.inRoom
      && basicReadinessIssues.some((issue) => issue.code === 'GENERATION_SCENARIO_REQUIRED')
    ) {
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
    setStreamReasoning(null);
    setStreamUpdateMetaDebug(null);
    setStreamSoftTimeoutWarning(null);
    setLatestAiImpacts(null);
    setLastGenerationRepairContext(null);

    try {
      // 房间房主与单人模式共用随机角色解析；随后的 bundle 对比会把
      // 新角色视为本地草稿，只有权威 revision/提案/冲突门禁均满足时才自动发布。
      await handleResolveRandomPlaceholders();

      const freshCombatants = useBattleStore.getState().combatants.filter((item): item is CombatantData => 'data' in item);

      const sensitiveTargets = [
        JSON.stringify(freshCombatants.map((c) => c.data)),
        settings.userGuidance,
        JSON.stringify(freshCombatants.map((c) => (typeof (c as any).characterGuidance === 'string' ? (c as any).characterGuidance : ''))),
        selectedQuestionnaires
          .filter((selection) => selection.useLore !== false)
          .map((selection) => selection.questionnaire.loreMarkdown ?? '')
          .join('\n\n'),
        shouldUseScenario ? JSON.stringify(scenario.content) : '',
        shouldUseScenario && auxScenarios.length > 0 ? JSON.stringify(auxScenarios.map((s) => s.content)) : '',
        materials.length > 0 ? JSON.stringify(materials.map((item) => item.content)) : '',
      ];

      if (!roomAction.inRoom) {
        for (const payload of sensitiveTargets) {
          if (payload && (await checkSensitivePayload(payload, { onRedirect: redirectToArrested }))) {
            return;
          }
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
      const localNarrativeHistory = materializeArenaNarrativeHistoryForRequest(
        settings,
        useNarrativeHistoryStore.getState().entries,
      );
      const narrativeHistoryReadLimit = localNarrativeHistory.readLimit;
      const narrativeHistoryForRequest = localNarrativeHistory.entries;

      const generationRequestId = crypto.randomUUID();
      const questionnaireSelections = selectedQuestionnaires.length > 0
        ? selectedQuestionnaires.map((selection) => ({
          source: selection.source,
          kind: selection.questionnaire.kind,
          presetId: selection.source === 'preset' ? selection.questionnaire.id : undefined,
          dataCardId: selection.source === 'database' ? selection.dataCardId : undefined,
          useLore: selection.useLore === false ? false : undefined,
        }))
        : undefined;
      const questionnaires = selectedQuestionnaires.length > 0
        ? selectedQuestionnaires.map((selection) => ({
          id: selection.questionnaire.id,
          title: selection.questionnaire.title,
          kind: selection.questionnaire.kind,
          useLore: selection.useLore === false ? false : undefined,
          loreMarkdown: selection.questionnaire.loreMarkdown ?? undefined,
        }))
        : undefined;
      const customProviderPayload = buildCustomProviderRequestPayload(userProviderConfig);
      const generationProviderSnapshot = customProviderPayload ? {
        ...customProviderPayload,
        ...(customProviderPayload.generationOverrides ? {
          generationOverrides: {
            ...customProviderPayload.generationOverrides,
            ...(customProviderPayload.generationOverrides.thinking ? {
              thinking: { ...customProviderPayload.generationOverrides.thinking },
            } : {}),
          },
        } : {}),
      } : null;
      let capturedGenerationId: string | null = null;
      const captureGenerationRepairContext = (generationId: string): void => {
        const normalizedGenerationId = generationId.trim();
        if (!normalizedGenerationId) return;
        if (capturedGenerationId && capturedGenerationId !== normalizedGenerationId) {
          throw new Error('生成响应返回了冲突的 generationId，已拒绝保存角色修复上下文。');
        }
        capturedGenerationId = normalizedGenerationId;
        setLastGenerationRepairContext({
          generationId: normalizedGenerationId,
          customProvider: generationProviderSnapshot,
        });
      };
      const requestBody = roomAction.inRoom ? null : {
        generationRequestId,
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
        mode: battleMode,
        arenaFreeRankingEnabled,
        userGuidance: settings.userGuidance,
        scenario: shouldUseScenario ? scenario.content : undefined,
        auxScenarios: shouldUseScenario && auxScenarios.length > 0 ? auxScenarios.map((s) => s.content) : undefined,
        materials: materials.length > 0 ? materials : undefined,
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
        narrativeHistoryReadLimit,
        narrativeHistory: narrativeHistoryForRequest,
        isDowngrade: false,
        adjudicationEvents,
        storyLength,
        customStoryLength: normalizeCustomStoryLength(customStoryLength) || undefined,
        questionnaireSelections,
        questionnaires,
        customProvider: customProviderPayload ?? undefined,
      };

      if (roomAction.inRoom && arenaRoomRuntime) {
        if (!isArenaRoomGenerationSyncSettled(arenaRoomRuntime.hostReconciliation.state.kind)) {
          throw new Error(arenaRoomGenerationSyncGateMessage(arenaRoomRuntime.hostReconciliation.state.kind));
        }
        const capturedAuthority = arenaRoomHostWorkspaceAuthorityFromSession(
          arenaRoomRuntime.state.session,
        );
        if (!capturedAuthority) {
          throw new Error('当前房间权威已变化，请同步后重试。');
        }
        let bundle: Awaited<ReturnType<typeof buildArenaRoomHostWorkspaceBundleFromBattleState>> | null = null;
        try {
          bundle = await buildArenaRoomHostWorkspaceBundleFromBattleState(useBattleStore.getState());
        } catch {
          // A stale or partial local draft must not prevent the host from selecting
          // an already-published Room baseline.
        }
        const preflightState = arenaRoomRuntime.controller.getSnapshot();
        const authority = arenaRoomHostWorkspaceAuthorityFromSession(preflightState.session);
        if (
          !authority
          || authority.roomId !== capturedAuthority.roomId
          || authority.roomEpoch !== capturedAuthority.roomEpoch
          || authority.ownerUserId !== capturedAuthority.ownerUserId
          || authority.revision !== capturedAuthority.revision
        ) {
          throw new Error('构建多人生成输入时房间权威已变化，请确认最新状态后重试。');
        }
        const proposalFingerprint = pendingProposalFingerprint(
          preflightState.session?.snapshot.proposals ?? [],
        );
        const pendingProposalCount = preflightState.session?.snapshot.proposals.length ?? 0;

        let startInputs: ArenaRoomGenerationStartInputs | null = null;
        let startAuthority = authority;
        if (!bundle) {
          const choice = await requestArenaRoomGenerationPreflight({
            reasons: ['working-copy-invalid'],
            canPublish: false,
            pendingProposalCount,
          });
          if (choice === 'cancel') return;
          if (choice === 'sync-room') {
            // 本地草稿无法安全投影：放弃本地草稿方向，把房间权威同步到
            // Arena 编辑区；不自动开始生成，房主确认眼前配置后再次点击。
            await arenaRoomRuntime.hostReconciliation.syncRoom();
            return;
          }
          throw new Error('本地编辑草稿无法发布，已取消本次生成。');
        } else {
          const comparison = arenaRoomRuntime.hostWorkspace.compare(authority, bundle);
          startInputs = comparison.kind === 'clean' ? comparison.start : null;
          if (comparison.kind === 'clean' && pendingProposalCount > 0) {
            const choice = await requestArenaRoomGenerationPreflight({
              reasons: [],
              canPublish: false,
              canConfirmStart: true,
              pendingProposalCount,
            });
            if (choice === 'cancel') return;
            if (choice !== 'confirm-start') {
              throw new Error('请先确认待处理提案，再选择是否开始生成。');
            }
          }
          if (comparison.kind === 'dirty') {
            const automaticallyPublish = canAutoPublishArenaRoomHostDraft({
              pendingProposalCount,
              reconciliationKind: arenaRoomRuntime.hostReconciliation.state.kind,
              workspaceAllows: arenaRoomRuntime.hostWorkspace.canAutoPublish(authority, bundle),
            });
            const generationPublishReady = () => canPublishArenaRoomGenerationDraft({
              reconciliationKind: arenaRoomRuntime.hostReconciliation.state.kind,
              authority,
              // settledAuthority 读取 workspace 内部基线（非 React 状态）：
              // 即使本闭包捕获的 reconciliation kind 已过期，也能同步判定
              // 「落定基线是否已追上当前权威」，封死 render→effect 微窗口。
              settledAuthority: arenaRoomRuntime.hostWorkspace.settledAuthority(),
            });
            const choice = automaticallyPublish
              ? 'publish'
              : await requestArenaRoomGenerationPreflight({
                  reasons: comparison.reasons,
                  // reconciliation error 期间本地与房间权威的关系不可信：
                  // 此时禁止把本地 working copy 发布出去覆盖房间权威，
                  // 只允许显式同步房间配置或取消。
                  canPublish: generationPublishReady(),
                  pendingProposalCount,
                });
            if (choice === 'cancel') return;
            if (choice === 'sync-room') {
              // 眼—手一致硬不变量：本地与房间权威不一致时不得直接生成。
              // 同步把房间权威物化到 Arena 编辑区（放弃未发布本地修改），
              // 完成后由房主再次点击生成。
              await arenaRoomRuntime.hostReconciliation.syncRoom();
              return;
            }
            if (!generationPublishReady()) {
              // Preflight 打开期间同步可能已开始或已失败，或权威已前进到
              // 落定基线之外；此时发布本地草稿会覆盖尚未安装/关系不明的
              // 房间权威，必须拒绝并让 reconciliation 先落定。
              throw new Error(arenaRoomGenerationSyncGateMessage(arenaRoomRuntime.hostReconciliation.state.kind));
            }
            const beforePublishState = arenaRoomRuntime.controller.getSnapshot();
            const beforePublishAuthority = arenaRoomHostWorkspaceAuthorityFromSession(
              beforePublishState.session,
            );
            const beforePublishProposalFingerprint = pendingProposalFingerprint(
              beforePublishState.session?.snapshot.proposals ?? [],
            );
            const beforePublishControlSeq = beforePublishState.session?.snapshot.controlSeq;
            if (
              beforePublishState.configPublishPending
              || beforePublishState.configPublishResultUnknown
              || beforePublishControlSeq === undefined
              || !beforePublishAuthority
              || beforePublishAuthority.roomId !== authority.roomId
              || beforePublishAuthority.roomEpoch !== authority.roomEpoch
              || beforePublishAuthority.ownerUserId !== authority.ownerUserId
              || beforePublishAuthority.revision !== authority.revision
              || beforePublishProposalFingerprint !== proposalFingerprint
            ) {
              throw new Error('房间配置或提案列表已变化，请确认最新状态后重试。');
            }
            await arenaRoomRuntime.controller.publishConfig({
              expectedRoomEpoch: authority.roomEpoch,
              expectedRevision: authority.revision,
              expectedControlSeq: beforePublishControlSeq,
              sharedConfig: comparison.current.sharedConfig,
            });
            const publishedState = arenaRoomRuntime.controller.getSnapshot();
            const publishedAuthority = arenaRoomHostWorkspaceAuthorityFromSession(publishedState.session);
            if (
              publishedState.configPublishPending
              || publishedState.configPublishResultUnknown
              || !publishedAuthority
              || publishedAuthority.roomId !== authority.roomId
              || publishedAuthority.roomEpoch !== authority.roomEpoch
              || publishedAuthority.ownerUserId !== authority.ownerUserId
              || publishedAuthority.revision !== authority.revision + 1
              || !areArenaRoomSharedConfigsEqual(
                publishedAuthority.sharedConfig,
                comparison.current.sharedConfig,
              )
            ) {
              throw new Error('房间配置发布结果无法确认，请先同步房间权威状态。');
            }
            arenaRoomRuntime.hostWorkspace.capturePublished(publishedAuthority, bundle);
            startInputs = comparison.current;
            startAuthority = publishedAuthority;
          }
        }
        if (!startInputs) throw new Error('无法读取多人生成所需的当前房间配置。');
        const beforeStartState = arenaRoomRuntime.controller.getSnapshot();
        const beforeStartProposalFingerprint = pendingProposalFingerprint(
          beforeStartState.session?.snapshot.proposals ?? [],
        );
        if (beforeStartProposalFingerprint !== proposalFingerprint) {
          throw new Error('待处理提案列表已变化，请重新确认后再开始生成。');
        }
        assertArenaRoomGenerationReady(startInputs.sharedConfig);
        const roomNarrativeHistory = materializeArenaNarrativeHistoryForRequest(
          startInputs.sharedConfig.historySettings,
          useNarrativeHistoryStore.getState().entries,
        );

        const selectedSensitiveTargets = [
          JSON.stringify(startInputs.sharedConfig),
          ...startInputs.hostLocalPayloads.map((payload) => JSON.stringify(payload.payload)),
          roomNarrativeHistory.entries ? JSON.stringify(roomNarrativeHistory.entries) : '',
          adjudicationEvents.length > 0 ? JSON.stringify(adjudicationEvents) : '',
          questionnaires ? JSON.stringify(questionnaires) : '',
        ];
        for (const payload of selectedSensitiveTargets) {
          if (payload && await checkSensitivePayload(payload, { onRedirect: redirectToArrested })) {
            return;
          }
        }

        const generation = ArenaRoomHostRuntimeGenerationSchema.parse({
          arenaFreeRankingEnabled,
          customProvider: customProviderPayload,
          isDowngrade: false,
          narrativeHistory: roomNarrativeHistory.entries,
          adjudicationEvents,
          questionnaireSelections,
          questionnaires,
        });
        const dispatchState = arenaRoomRuntime.controller.getSnapshot();
        const dispatchAuthority = arenaRoomHostWorkspaceAuthorityFromSession(dispatchState.session);
        if (!isArenaRoomGenerationFenceCurrent({
          expectedAuthority: startAuthority,
          currentAuthority: dispatchAuthority,
          proposals: dispatchState.session?.snapshot.proposals ?? [],
          proposalFingerprint,
        })) {
          throw new Error('房间配置或待处理提案已变化，请重新确认后再开始生成。');
        }
        const outcome = await dispatchArenaRoomGenerationStart({
          controller: arenaRoomRuntime.controller,
          state: dispatchState,
          sharedConfig: startInputs.sharedConfig,
          hostLocalPayloads: startInputs.hostLocalPayloads,
          generationRequestId,
          generation,
        });
        if (outcome !== 'submitted') {
          throw new Error(
            outcome === 'stale'
              ? '房间实例或配置版本已变化，请确认最新房间状态后再试。'
              : '当前房间状态不允许启动生成。',
          );
        }
        return;
      }
      if (!requestBody) throw new Error('无法构造单人生成请求。');

      const authHeader = await authStorage.getAuthHeader();
      const baseRequestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeader) baseRequestHeaders.Authorization = authHeader;
      Object.assign(baseRequestHeaders, await authStorage.getActivityHeaders());
      const requestHeaders = Object.fromEntries(
        withArenaGenerationActorToken(baseRequestHeaders).entries(),
      );

      const applyBattleResult = async (result: BattleApiResponse, origin: 'battle' | 'battle-stream') => {
        if (typeof result.generationId === 'string' && result.generationId.trim()) {
          captureGenerationRepairContext(result.generationId);
        }

        const backupItems = buildBattleBackupItems(
          freshCombatants,
          shouldUseScenario ? scenario.content : null,
          shouldUseScenario ? scenario.fileName : null,
          shouldUseScenario ? scenario.isNative : false,
          shouldUseScenario ? scenarioDisplayName : null,
          shouldUseScenario ? auxScenarios.map((s) => ({ content: s.content, fileName: s.fileName, isNative: s.isNative })) : [],
          materials.map((material) => ({
            content: material.content,
            fileName: material.fileName,
            isNative: material.isNative,
            name: material.name,
          })),
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
        const normalizedImpacts = normalizeBattleAiImpacts(result.impacts);
        setLatestAiImpacts(normalizedImpacts.length > 0 ? normalizedImpacts : null);
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

        if (settings.writeNarrativeHistory) {
          await appendArenaNarrativeHistoryResult({
            title: reportWithScenario.headline,
            contentMarkdown: toBattleReportMarkdown(reportWithScenario),
            generationId: result.generationId ?? null,
          });
        }

        return false;
      };

	      if (generationMode === 'stream') {
	        const abortController = new AbortController();
	        sharedGenerationAbortController?.abort(STREAM_ABORT_REASON_USER);
	        sharedGenerationAbortController = abortController;
	        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

		        try {
		          setStreamCharacterGuidances(null);
		          const debugSseQuery = (() => {
		            try {
		              if (typeof window === 'undefined') return '';
		              const raw = new URLSearchParams(window.location.search).get('debugSse') || '';
		              const normalized = raw.trim().toLowerCase();
		              if (normalized === '1' || normalized === 'true') return 'debugSse=1';
		              return '';
		            } catch {
		              return '';
		            }
		          })();
		          const debugSseEnabled = Boolean(debugSseQuery);
              const query = new URLSearchParams();
              query.set('format', 'sse');
              if (debugSseQuery) {
                query.set('debugSse', '1');
              }
              const endpoint = `/api/arena/generate-stream${query.toString() ? `?${query.toString()}` : ''}`;
              requestHeaders.Accept = 'text/event-stream';
              let generationIntent: GenerationApiIntent | null = null;
              let pinnedReadDispatcher: {
                placement: 'hono-primary' | 'next-dr';
                dispatcher: ReturnType<typeof createPinnedGenerationApiSafeReadDispatcher>;
              } | null = null;
              const response = await openArenaGenerationStream({
                  endpoint,
                  body: requestBody,
                  generationRequestId,
                  headers: requestHeaders,
                  signal: abortController.signal,
                  fetcher: (input, init, routePin, onRoutePinSelected) => {
                    if (routePin) {
                      if (pinnedReadDispatcher?.placement !== routePin.placement) {
                        pinnedReadDispatcher = {
                          placement: routePin.placement,
                          dispatcher: createPinnedGenerationApiSafeReadDispatcher(routePin),
                        };
                      }
                      return pinnedReadDispatcher.dispatcher.dispatch(input, init);
                    }
                    if (input === endpoint && (init?.method ?? 'GET').toUpperCase() === 'POST') {
                      generationIntent ??= generationApiIntentLatch.tryAcquire();
                      if (!generationIntent) {
                        throw new Error('已有生成请求正在处理中，请勿重复提交。');
                      }
                      const unsubscribe = onRoutePinSelected
                        ? generationIntent.subscribeRoutePinSelected(onRoutePinSelected)
                        : null;
                      const dispatched = generationIntent.dispatch(input, init);
                      return unsubscribe ? dispatched.finally(unsubscribe) : dispatched;
                    }
                    return createGenerationApiIntent().dispatch(input, init);
                  },
                  isInitialCreateOutcomeAmbiguous: (error) => (
                    isGenerationApiClientErrorCode(error, 'AMBIGUOUS_OPERATION_OUTCOME')
                  ),
                  getInitialRoutePin: () => generationIntent?.getRoutePin() ?? null,
                  onStateChange: (state) => {
                    const previousState = lastArenaConnectionState;
                    lastArenaConnectionState = state;
                    if (
                      state === 'generating'
                      && previousState
                      && ['recovering_initial', 'reconnecting', 'resuming'].includes(previousState)
                    ) {
                      recoveryNoticeActive = true;
                      setError('连接已恢复，继续接收同一场战报。');
                      return;
                    }
                    if (state === 'completed' && recoveryNoticeActive) {
                      recoveryNoticeActive = false;
                      setError(null);
                      return;
                    }
                    const notice = arenaGenerationConnectionNotice(state);
                    if (notice) setError(notice);
                  },
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
              const resumableGenerationId = response.headers
                .get('x-mahoshojo-generation-id')
                ?.trim();
              if (resumableGenerationId) captureGenerationRepairContext(resumableGenerationId);
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
                captureGenerationRepairContext(generationId);
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
	          let isInterruptedAbort = false;
	          let interruptedMessage: string | null = null;
	          let sseEndedWithoutDone = false;
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
	            mode: 'soft',
	            idleTimeoutMs: STREAM_READ_IDLE_TIMEOUT_MS,
	            totalTimeoutMs: STREAM_READ_TOTAL_TIMEOUT_MS,
	            onSoftTimeout: (event) => {
	              if (debugSseEnabled) {
	                console.warn('SSE 调试：读流软超时（仅提示，不切断）', {
	                  kind: event.kind,
	                  timeoutMs: event.timeoutMs,
	                  elapsedMs: event.elapsedMs,
	                });
	              }
	              setStreamSoftTimeoutWarning(buildStreamSoftTimeoutMessage(event));
	            },
	          });
          const streamBackupItems = buildBattleBackupItems(
            freshCombatants,
            shouldUseScenario ? scenario.content : null,
            shouldUseScenario ? scenario.fileName : null,
            shouldUseScenario ? scenario.isNative : false,
            shouldUseScenario && scenarioDisplayName ? sanitizeTextByShieldWords(scenarioDisplayName) : null,
            shouldUseScenario ? auxScenarios.map((s) => ({ content: s.content, fileName: s.fileName, isNative: s.isNative })) : [],
            materials.map((material) => ({
              content: material.content,
              fileName: material.fileName,
              isNative: material.isNative,
              name: material.name,
            })),
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

            const resolveReasoningSource = (value: unknown): AIReasoningSource => {
              const normalized = normalizeReasoningSource(value);
              return normalized === 'unknown' ? 'sdk' : normalized;
            };

            const appendReasoningChunkToStore = (chunk: string, source: AIReasoningSource) => {
              const previous = useBattleStore.getState().streamReasoning;
              const next = appendReasoningDelta(previous, sanitizeTextByShieldWords(chunk), {
                source,
                status: 'thinking',
              });
              setStreamReasoning(next);
            };

            const markReasoningStatusInStore = (
              nextStatus: 'thinking' | 'done' | 'error' | 'unavailable',
              options?: { source?: AIReasoningSource; summary?: string | null; errorMessage?: string | null }
            ) => {
              const previous = useBattleStore.getState().streamReasoning;
              const next = updateReasoningStatus(previous, {
                status: nextStatus,
                ...(options?.source ? { source: options.source } : {}),
                ...(typeof options?.summary === 'string' || options?.summary === null
                  ? { summary: options.summary }
                  : {}),
                ...(typeof options?.errorMessage === 'string' ? { errorMessage: options.errorMessage } : {}),
              });
              setStreamReasoning(next);
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
              abortController.abort(STREAM_ABORT_REASON_CONTENT_POLICY);
              return true;
            };

	            const handleSseEvent = async (event: string, data: string) => {
              let payload: any = null;
              try {
                payload = data ? JSON.parse(data) : null;
              } catch {
                payload = null;
              }

              if (event === 'reasoning') {
                const source = resolveReasoningSource(payload?.source);
                const chunk = typeof payload?.chunk === 'string' ? payload.chunk : '';
                if (chunk) {
                  appendReasoningChunkToStore(chunk, source);
                } else {
                  markReasoningStatusInStore('thinking', { source });
                }
                return;
              }

              if (event === 'reasoning_done') {
                const source = resolveReasoningSource(payload?.source);
                const statusValue = typeof payload?.status === 'string' ? payload.status : '';
                const nextStatus =
                  statusValue === 'unavailable'
                    ? 'unavailable'
                    : statusValue === 'error'
                      ? 'error'
                      : 'done';
                const summary =
                  typeof payload?.summary === 'string' ? sanitizeTextByShieldWords(payload.summary) : undefined;
                const errorMessage =
                  typeof payload?.errorMessage === 'string'
                    ? sanitizeTextByShieldWords(payload.errorMessage)
                    : undefined;

                markReasoningStatusInStore(nextStatus, {
                  source,
                  ...(typeof summary === 'string' ? { summary } : {}),
                  ...(typeof errorMessage === 'string' ? { errorMessage } : {}),
                });
                return;
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

              if (event === 'snapshot') {
                const markdown = typeof payload?.markdown === 'string' ? payload.markdown : '';
                const reasoning = typeof payload?.reasoning === 'string' ? payload.reasoning : '';
                const mergedMarkdown = mergeArenaGenerationSnapshotMarkdown(
                  accumulatedText,
                  markdown,
                );
                if (mergedMarkdown !== accumulatedText || !accumulatedText) {
                  accumulatedText = mergedMarkdown;
                  lastCheckedLength = 0;
                  setStreamingMarkdown(sanitizeTextByShieldWords(mergedMarkdown));
                }
                setStreamReasoning(reasoning
                  ? appendReasoningDelta(null, sanitizeTextByShieldWords(reasoning), {
                    source: 'sdk',
                    status: payload?.status === 'completed' ? 'done' : 'thinking',
                  })
                  : null);
                return;
              }

              if (event === 'telemetry') {
                const usage = normalizeUsage(payload?.usage ?? null);
                setStreamAiUsage(usage);
                if (usage && typeof usage.reasoningTokens === 'number') {
                  const previous = useBattleStore.getState().streamReasoning;
                  if (previous) {
                    const next = {
                      ...previous,
                      reasoningTokens: usage.reasoningTokens,
                    };
                    setStreamReasoning(next);
                  }
                }
                const narrativeCount =
                  typeof payload?.narrativeHistoryReadCount === 'number' ? payload.narrativeHistoryReadCount : null;
                setStreamNarrativeHistoryReadCount(narrativeCount);
                // 兼容过渡期：新契约字段为 aiModel；旧 replay 存量/未升级 origin 仍可能发内部字段 model
                const aiModelRaw = typeof payload?.aiModel === 'string' && payload.aiModel.trim()
                  ? payload.aiModel
                  : typeof payload?.model === 'string'
                    ? payload.model
                    : '';
                const aiModel = aiModelRaw.trim();
                if (aiModel) {
                  setStreamAiModel(sanitizeTextByShieldWords(aiModel));
                }
                return;
              }

              if (event === 'meta') {
                if (payload?.parseOk && payload?.meta && typeof payload.meta === 'object') {
                  const meta = payload.meta as any;
                  const impacts = normalizeBattleAiImpacts(meta.impacts);
                  metaOverrideFromSse = {
                    ...(meta.report ? { report: meta.report } : {}),
                    ...(impacts.length > 0 ? { impacts } : {}),
                  };
                  if (impacts.length > 0) {
                    setLatestAiImpacts(impacts);
                  }
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

              if (event === 'ranking') {
                const ranking = parseGenerationRankingResponse(payload);
                if (ranking) {
                  queryClient.setQueryData<GenerationRankingResponse>(
                    ['arenaGenerationRanking', ranking.generationId],
                    ranking,
                  );
                }
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
	                const message = resolveApiErrorMessage({
	                  payload,
	                  fallback: '服务器流式响应异常',
	                });
	                const interruptedFromServer = isServerInterruptedPayload(payload, message);
	                if (interruptedFromServer) {
	                  isInterruptedAbort = true;
	                  interruptedMessage = sanitizeTextByShieldWords(message);
	                  setError(buildStreamInterruptedMessage(interruptedMessage));
	                } else {
	                  setError(`✨ 生成失败：${sanitizeTextByShieldWords(message)}`);
	                }
	                markReasoningStatusInStore('error', {
	                  source: resolveReasoningSource(payload?.source),
	                  errorMessage: sanitizeTextByShieldWords(message),
	                });
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
                if (typeof payload?.persistenceWarning === 'string') {
                  setError('⚠️ 战报已生成并保留当前正文，但保存或断线恢复能力暂时不可用。');
                }
                const currentReasoning = useBattleStore.getState().streamReasoning;
                if (!currentReasoning) {
                  markReasoningStatusInStore('unavailable', { source: 'sdk' });
                } else if (currentReasoning.status === 'thinking') {
                  const hasReasoningText =
                    typeof currentReasoning.text === 'string' && currentReasoning.text.trim().length > 0;
                  markReasoningStatusInStore(hasReasoningText ? 'done' : 'unavailable');
                }
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

	            if (!shouldAbort && !sawDoneEvent) {
	              sseEndedWithoutDone = true;
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
                abortController.abort(STREAM_ABORT_REASON_CONTENT_POLICY);
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

	          if (sseEndedWithoutDone) {
	            setError(arenaGenerationConnectionNotice(lastArenaConnectionState ?? 'unknown')
	              ?? buildStreamInterruptedMessage('连接结束但未收到 done 事件'));
	            startCooldown();
	            return;
	          }

	          if (shouldAbort) {
	            if (isInterruptedAbort) {
	              if (interruptedMessage) {
	                setError(buildStreamInterruptedMessage(interruptedMessage));
	              }
	              startCooldown();
	            }
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
                const usage = normalizeUsage(telemetryExtracted.meta.usage ?? null);
                const narrativeCount =
                  typeof telemetryExtracted.meta.narrativeHistoryReadCount === 'number'
                    ? telemetryExtracted.meta.narrativeHistoryReadCount
                    : null;
                setStreamAiUsage(usage);
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
                  const impacts = normalizeBattleAiImpacts(extracted.meta.impacts);
                  metaOverride = {
                    ...(extracted.meta.report ? { report: extracted.meta.report } : {}),
                    ...(impacts.length > 0 ? { impacts } : {}),
                  };
                  if (impacts.length > 0) {
                    setLatestAiImpacts(impacts);
                  }
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

          if (settings.writeNarrativeHistory) {
            await appendArenaNarrativeHistoryResult({
              title: extractTitleFromBattleMarkdown(markdownForUi),
              contentMarkdown: markdownForUi,
              generationId: resumableGenerationId ?? null,
            });
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
                metaOverride,
                resumableGenerationId,
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

      const generationIntent = generationApiIntentLatch.tryAcquire();
      if (!generationIntent) return;
      const response = await generationIntent.dispatch('/api/generate-battle-story', {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
      });
      captureArenaGenerationActorToken(response);
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
	      const shouldTreatAsInterrupted = generationMode === 'stream' && isStreamInterruptedError(error);
	      if (shouldTreatAsInterrupted) {
          const abortReason = sharedGenerationAbortController?.signal.reason;
          if (abortReason === STREAM_ABORT_REASON_USER) {
            setError(arenaGenerationConnectionNotice(lastArenaConnectionState ?? 'unknown')
              ?? '停止请求状态尚未确认；生成可能仍在后台继续，请稍后检查。');
          } else {
            const details = error instanceof Error ? error.message : '连接被中断';
            setError(buildStreamInterruptedMessage(details));
          }
	        startCooldown();
	      } else {
	        setError(`✨ 魔法失效了！${error instanceof Error ? error.message : '发生未知错误，请重试。'}`);
	        setNewsReport(null);
	      }
	    } finally {
        sharedGenerationAbortController = null;
	      setArenaRoomGenerationPreflight(null);
	      setIsGenerating(false);
	      setIsStreaming(false);
	      setStreamSoftTimeoutWarning(null);
	    }
  }, [
    generationApiIntentLatch,
    queryClient,
    isCooldown,
    remainingTime,
    battleMode,
    generationMode,
    arenaFreeRankingEnabled,
    combatants,
    scenario,
    auxScenarios,
    materials,
    selectedQuestionnaires,
    userProviderConfig,
    settings,
    selectedLanguage,
    storyLength,
    customStoryLength,
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
    setStreamReasoning,
    setStreamUpdateMetaDebug,
    setStreamSoftTimeoutWarning,
    setLatestAiImpacts,
    setLastGenerationRepairContext,
    setCombatants,
    handleResolveRandomPlaceholders,
    arenaRoomRuntime,
    requestArenaRoomGenerationPreflight,
    redirectToArrested,
    startCooldown,
    updateFromMarkdown,
  ]);

  const stopGeneration = useCallback(() => {
    sharedGenerationAbortController?.abort(STREAM_ABORT_REASON_USER);
  }, []);

  const handleRetryUpdates = useCallback(async () => {
    const state = useBattleStore.getState();
    const lastGenerationId = state.lastGenerationId?.trim();
    const roster = state.combatants.filter((item): item is CombatantData => 'data' in item);

    if (arenaRoomRuntime?.controller.getSnapshot().session) {
      setError('⚠️ 多人房间内的角色更新由 Room 权威流程处理，不能在本地重试。');
      return;
    }
    if (roster.length === 0) {
      setError('⚠️ 没有可更新的参战角色。');
      return;
    }
    if (!lastGenerationId) {
      setError('⚠️ 本次战报缺少 generationId，无法安全重试角色更新。');
      return;
    }
    if (state.repairAppliedGenerationId === lastGenerationId) {
      setError('⚠️ 当前角色已应用本次战报的自定义修复，基线已变化，无法再执行同 generation 的服务器权威重试。');
      return;
    }
    if (!state.tryBeginCombatantMutation()) {
      setError('⚠️ 角色更新正在进行，请等待当前操作完成后再试。');
      return;
    }

    setIsRedoingUpdates(true);
    setError(null);
    try {
      await retryGenerationUpdate(lastGenerationId, roster, () => {
        if (arenaRoomRuntime?.controller.getSnapshot().session) return false;
        const currentState = useBattleStore.getState();
        if (currentState.lastGenerationId?.trim() !== lastGenerationId) return false;
        if (currentState.repairAppliedGenerationId === lastGenerationId) return false;
        if (!currentState.isCombatantMutationPending) return false;
        const currentRoster = currentState.combatants.filter(
          (item): item is CombatantData => 'data' in item,
        );
        return currentRoster.length === roster.length
          && currentRoster.every((combatant, index) => combatant === roster[index]);
      });
    } catch (error) {
      setError(`⚠️ 重试角色更新失败：${error instanceof Error ? error.message : '发生未知错误，请重试。'}`);
    } finally {
      useBattleStore.getState().endCombatantMutation();
      setIsRedoingUpdates(false);
    }
  }, [
    arenaRoomRuntime,
    retryGenerationUpdate,
    setError,
    setIsRedoingUpdates,
  ]);

  return {
    handleGenerate,
    stopGeneration,
    handleRetryUpdates,
    isGenerating,
    isRedoingUpdates,
    isCooldown,
    remainingTime,
    providerCooldownMode,
    otherRemainingTime,
    streamSoftTimeoutWarning,
    arenaRoomGenerationPreflight,
    resolveArenaRoomGenerationPreflight,
  };
};
