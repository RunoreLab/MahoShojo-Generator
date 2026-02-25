// pages/api/arena/generate-stream.ts

import { getLogger } from '@/lib/logger';
import magicalGirlQuestionnaire from '@/public/questionnaires/presets/magical-girl-default.json';
import canshouQuestionnaire from '@/public/questionnaires/presets/canshou-default.json';
import { config as appConfig, SafetyCheckPolicy, type AIProvider } from '@/lib/config';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { buildPolicySafetyCheckText } from '@/lib/content-safety/server';
import { NextRequest } from 'next/server';
import { AdjudicationResult, NarrativeHistoryEntry } from '@/types/arena';
import { verifySignature, generateSignature } from '@/lib/signature';
import { getSystemPrompt } from '@/lib/arena/constants';
import { CustomProviderSchema } from '@/lib/arena/schemas';
import { STRICT_RANKED_MODEL_FALLBACKS } from '@/lib/arena/ranked-model-policy';
	import { processAdjudicationChain, createStreamPromptBuilder } from '@/lib/arena/logic';
	import {
    generateWithStreamAI,
    LoadBalanceStrategy,
    RawGenerationConfig,
    GenerateWithAIOptions,
    RawReasoningStreamEvent
} from '@/lib/stream/raw-ai';
import {
    createStreamReadWithTimeout,
    STREAM_READ_IDLE_TIMEOUT_MS,
    STREAM_READ_TOTAL_TIMEOUT_MS,
    StreamReadTimeoutError,
} from '@/lib/stream/timeout';
import { getRandomJournalist } from '@/lib/random-choose-journalist';
import {
    createBattleReportGenerationRecord,
    createBattleReportGenerationCombatants,
    updateBattleReportGenerationExtraJson,
    updateBattleReportGenerationCombatantsWriteResult,
    updateBattleReportGenerationOutputPreview,
    upsertLargeObjectByOwnerRef,
    generateUUID
} from '@/lib/d1';
import { applyShieldWords } from '@/lib/shield-word-filter';
import {
    anonymizeIp,
    buildCombatantsFallbackForExtraJson,
    buildContentPreview,
    extractHeadlineFromMarkdown,
    extractWinnerFromText,
    getClientIpFromHeaders,
    normalizeErrorMessage,
    compactExtraJson,
    normalizeUsage,
} from '@/lib/arena/battle-report-log-utils';
import { fetchCurrentSeasonFromOrigin } from '@/lib/seasons-config';
import { deriveSeasonStrictRules } from '@/lib/seasons';
import { createOutputPreviewCollector } from '@/lib/arena/output-preview';
import { settleArenaRatingsForGeneration } from '@/lib/database/arena-ratings';
import { storeBattleReportGenerationOutputStreamToR2 } from '@/lib/arena/battle-report-output-storage';
import { deleteObject } from '@/lib/r2';
import { createRequestAuthUserResolver } from '@/lib/auth/request-auth-user';
	import { extractStreamUpdateMeta, findStreamUpdateMetaStart } from '@/lib/arena/stream-meta';

const log = getLogger('api-gen-battle-stream');

const isInterruptedStreamError = (error: unknown): boolean => {
    if (error instanceof StreamReadTimeoutError) return true;
    if (!error) return false;
    const errorRecord = error as { name?: unknown; message?: unknown };
    const name = typeof errorRecord.name === 'string' ? errorRecord.name.toLowerCase() : '';
    const message = typeof errorRecord.message === 'string' ? errorRecord.message.toLowerCase() : '';
    if (name === 'aborterror' || name === 'streamreadtimeouterror') return true;
    if (message.includes('timeout') || message.includes('timed out')) return true;
    if (message.includes('流式读取超时') || message.includes('流式生成超时')) return true;
    if (message.includes('aborted') || message.includes('中断')) return true;
    return false;
};

export const config = {
    runtime: 'edge',
};

type RequestQuestionnaire = {
    id: string;
    title: string;
    kind: 'magical-girl' | 'canshou';
    loreMarkdown?: string;
};

const normalizeQuestionnaires = (raw: unknown): RequestQuestionnaire[] => {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const record = item as Record<string, unknown>;
            const kind = record.kind === 'magical-girl' || record.kind === 'canshou' ? record.kind : null;
            if (!kind) return null;
            const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : '';
            const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : '';
            if (!id || !title) return null;
            const useLore = typeof record.useLore === 'boolean' ? record.useLore : true;
            const loreMarkdown = useLore && typeof record.loreMarkdown === 'string' && record.loreMarkdown.trim()
                ? record.loreMarkdown
                : undefined;
            const payload: RequestQuestionnaire = {
                id,
                title,
                kind,
                ...(loreMarkdown ? { loreMarkdown } : {}),
            };
            return payload;
        })
        .filter((item): item is RequestQuestionnaire => Boolean(item));
};

const buildQuestionnaireLoreText = (questionnaires: RequestQuestionnaire[]): string => {
    const blocks = questionnaires
        .map((questionnaire) => ({
            title: questionnaire.title,
            lore: questionnaire.loreMarkdown?.trim() ?? '',
        }))
        .filter((item) => Boolean(item.lore))
        .map((item) => `【设定来源：${item.title}】\n${item.lore}`);
    return blocks.length > 0 ? blocks.join('\n\n') : '';
};

async function handler(req: NextRequest): Promise<Response> {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

	    const startedAtMs = Date.now();
	    const startedAtIso = new Date(startedAtMs).toISOString();
    const authUserResolver = createRequestAuthUserResolver(req);
    const requestUrl = new URL(req.url);
    const wantsSse =
        requestUrl.searchParams.get('format') === 'sse' ||
        (req.headers.get('accept') || '').includes('text/event-stream');
    const debugSseRequested =
        requestUrl.searchParams.get('debug') === '1' ||
        requestUrl.searchParams.get('debug') === 'true' ||
        requestUrl.searchParams.get('debugSse') === '1' ||
        requestUrl.searchParams.get('debugSse') === 'true';

	    // 用于在异常/提前返回时补齐 battle_report_generations 记录（避免“失败/敏感词拦截没有记录”）。
	    let snapshotMode: string = 'classic';
	    let snapshotLanguage: string | null = null;
	    let snapshotSelectedLevel: string | null = null;
	    let snapshotStoryLength: string | null = null;
	    let snapshotPvpRoomId: string | null = null;
        let snapshotPvpMatchId: string | null = null;
        let snapshotPvpRoundId: string | null = null;

        try {
            const normalizeOptionalString = (value: unknown): string | null => {
                if (typeof value !== 'string') return null;
                const trimmed = value.trim();
                return trimmed ? trimmed : null;
            };

            const normalizeOptionalBoolean = (value: unknown, fallback: boolean): boolean => {
                if (typeof value === 'boolean') return value;
                if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
                if (typeof value === 'string') {
                    const normalized = value.trim().toLowerCase();
                    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
                    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
                }
                return fallback;
            };

            const body = await req.json();
            const {
                combatants,
            selectedLevel,
            mode = 'classic',
            arenaFreeRankingEnabled,
            userGuidance,
            internalGuidance,
            scenario,
            auxScenarios,
            teams,
            teamNames,
            language = 'zh-CN',
            useArenaHistory,
            arenaHistoryReadLimit,
            readArenaHistory,
            writeArenaHistory,
            readCurrentState,
            writeCurrentState,
            readNarrativeHistory,
            narrativeHistory,
            narrativeHistoryReadLimit,
            adjudicationEvents,
            storyLength,
            customProvider: customProviderPayload,
            scenarioTitle,
            scenarioFileName,
            scenarioSourceDataCardId,
	            scenarioSourceDataCardUpdatedAt,
              pvpContext,
              forceStreamMeta,
              questionnaires: rawQuestionnaires,
	        } = body;

	            const resolvedArenaFreeRankingEnabled = normalizeOptionalBoolean(arenaFreeRankingEnabled, false);
	            const normalizedQuestionnaires = normalizeQuestionnaires(rawQuestionnaires);
	            const loreText = buildQuestionnaireLoreText(normalizedQuestionnaires).trim();
	            const hasQuestionnaireLore = Boolean(loreText);
	            const questionnaireLoreIds = normalizedQuestionnaires
	                .filter((questionnaire) => typeof questionnaire.loreMarkdown === 'string' && Boolean(questionnaire.loreMarkdown.trim()))
	                .map((questionnaire) => questionnaire.id);

	          const normalizedAuxScenarios = Array.isArray(auxScenarios)
	              ? auxScenarios.filter((item) => item && typeof item === 'object')
	              : null;
          if (normalizedAuxScenarios && normalizedAuxScenarios.length > 10) {
              return new Response(JSON.stringify({ error: '辅助情景最多 10 个' }), { status: 400 });
          }

		        snapshotMode = typeof mode === 'string' ? mode : 'classic';
		        snapshotLanguage = normalizeOptionalString(language);
		        snapshotSelectedLevel = normalizeOptionalString(selectedLevel);
		        snapshotStoryLength = normalizeOptionalString(storyLength);

          const parsePvpContext = (value: unknown): { roomId: string; matchId: string; roundId: string } | null => {
              if (!value || typeof value !== 'object') return null;
              const roomId = typeof (value as any).roomId === 'string' ? (value as any).roomId.trim() : '';
              const matchId = typeof (value as any).matchId === 'string' ? (value as any).matchId.trim() : '';
              const roundId = typeof (value as any).roundId === 'string' ? (value as any).roundId.trim() : '';
              if (!roomId || !matchId || !roundId) return null;
              if (roomId.length > 128 || matchId.length > 128 || roundId.length > 128) return null;
              return { roomId, matchId, roundId };
          };
          const parsedPvpContext = pvpContext !== undefined ? parsePvpContext(pvpContext) : null;
          if (pvpContext !== undefined && !parsedPvpContext) {
              return new Response(JSON.stringify({ error: 'pvpContext 无效' }), { status: 400 });
          }
          snapshotPvpRoomId = parsedPvpContext?.roomId ?? null;
          snapshotPvpMatchId = parsedPvpContext?.matchId ?? null;
          snapshotPvpRoundId = parsedPvpContext?.roundId ?? null;

          const finalInternalGuidance =
              typeof internalGuidance === 'string' ? internalGuidance.trim().slice(0, 4000) : null;
          const shouldForceStreamMeta = forceStreamMeta === true;

        const resolvedReadArenaHistory = typeof readArenaHistory === 'boolean'
            ? readArenaHistory
            : (typeof useArenaHistory === 'boolean' ? useArenaHistory : true);
        const resolvedWriteArenaHistory = typeof writeArenaHistory === 'boolean'
            ? writeArenaHistory
            : (typeof useArenaHistory === 'boolean' ? useArenaHistory : true);
        const resolvedReadCurrentState = typeof readCurrentState === 'boolean' ? readCurrentState : true;
        const resolvedWriteCurrentState = typeof writeCurrentState === 'boolean' ? writeCurrentState : true;
        const resolvedReadNarrativeHistory = typeof readNarrativeHistory === 'boolean' ? readNarrativeHistory : false;
        const resolvedNarrativeHistoryReadLimit = resolvedReadNarrativeHistory
            ? (() => {
                if (narrativeHistoryReadLimit === null) return Infinity;
                if (typeof narrativeHistoryReadLimit === 'number' && Number.isFinite(narrativeHistoryReadLimit)) {
                    return Math.max(1, Math.floor(narrativeHistoryReadLimit));
                }
                return 10;
            })()
            : 0;
        const resolvedHistoryReadLimit = resolvedReadArenaHistory
            ? (() => {
                if (arenaHistoryReadLimit === null) return Infinity;
                if (typeof arenaHistoryReadLimit === 'number' && Number.isFinite(arenaHistoryReadLimit)) {
                    return Math.max(1, Math.floor(arenaHistoryReadLimit));
                }
                return 3;
            })()
            : 0;

        const normalizeNarrativeHistoryForPrompt = (input: unknown): NarrativeHistoryEntry[] => {
            if (!Array.isArray(input)) return [];
            return input
                .map((entry) => {
                    if (!entry || typeof entry !== 'object') return null;
                    const rawTitle = typeof (entry as any).title === 'string' ? (entry as any).title.trim() : '';
                    const rawContent = typeof (entry as any).content === 'string' ? (entry as any).content.trim() : '';
                    if (!rawContent) return null;
                    const createdAt = typeof (entry as any).createdAt === 'string'
                        ? (entry as any).createdAt
                        : (typeof (entry as any).created_at === 'string' ? (entry as any).created_at : new Date(0).toISOString());
                    const updatedAt = typeof (entry as any).updatedAt === 'string'
                        ? (entry as any).updatedAt
                        : (typeof (entry as any).updated_at === 'string' ? (entry as any).updated_at : createdAt);
                    return {
                        id: typeof (entry as any).id === 'string' ? (entry as any).id : `${createdAt}:${rawTitle}`,
                        title: rawTitle || '未命名战报',
                        content: rawContent,
                        createdAt,
                        updatedAt,
                    } satisfies NarrativeHistoryEntry;
                })
                .filter((item): item is NarrativeHistoryEntry => Boolean(item));
        };

        const narrativeHistoryForPrompt: NarrativeHistoryEntry[] | null = resolvedReadNarrativeHistory
            ? (() => {
                const normalized = normalizeNarrativeHistoryForPrompt(narrativeHistory);
                if (normalized.length === 0) return [];
                const parseTime = (entry: NarrativeHistoryEntry): number => {
                    const t = Date.parse(entry.createdAt || entry.updatedAt);
                    return Number.isFinite(t) ? t : 0;
                };
                normalized.sort((a, b) => parseTime(a) - parseTime(b));
                if (resolvedNarrativeHistoryReadLimit === Infinity) return normalized;
                const sliceLimit = Math.max(1, Math.floor(resolvedNarrativeHistoryReadLimit));
                return normalized.slice(Math.max(0, normalized.length - sliceLimit));
            })()
            : null;
        const narrativeHistoryReadCount = resolvedReadNarrativeHistory ? (narrativeHistoryForPrompt?.length ?? 0) : undefined;

        let customProviderOverride: AIProvider | null = null;
        let customProviderId: string | null = null;
        let customModelOverride: string | undefined;
        if (customProviderPayload) {
            const parsedResult = CustomProviderSchema.safeParse(customProviderPayload);
            if (!parsedResult.success) {
                log.warn('自定义 AI 供应商配置校验失败', { providerId: customProviderPayload?.providerId, issues: parsedResult.error.issues });
                return new Response(JSON.stringify({ error: '自定义 AI 供应商配置无效' }), { status: 400 });
            }

            const parsed = parsedResult.data;
            customProviderId = parsed.providerId;
            const providerConfig = AI_PROVIDER_CATALOG.find(item => item.id === parsed.providerId);
            if (!providerConfig) {
                return new Response(JSON.stringify({ error: '未知的模型供应商 ID' }), { status: 400 });
            }

            const modelConfig = providerConfig.models.find(model => model.value === parsed.modelId);
            if (!modelConfig) {
                return new Response(JSON.stringify({ error: '未知的模型 ID' }), { status: 400 });
            }

            const sanitizedApiKey = parsed.apiKey.trim();
            if (!sanitizedApiKey && providerConfig.id !== 'system') {
                return new Response(JSON.stringify({ error: 'API Key 不能为空' }), { status: 400 });
            }

            const sanitizedBaseUrl = providerConfig.baseUrl?.trim() ?? '';
            if (!sanitizedBaseUrl) {
                customModelOverride = modelConfig.value;
                log.info('检测到 baseUrl 为空的自定义供应商，改用系统默认通道，仅覆盖模型参数', {
                    providerId: providerConfig.id,
                    model: modelConfig.value,
                });
            } else {
                customProviderOverride = {
                    name: providerConfig.name,
                    apiKey: sanitizedApiKey,
                    baseUrl: sanitizedBaseUrl,
                    model: modelConfig.value,
                    type: providerConfig.type,
                    mode: providerConfig.mode || 'auto',
                    retryCount: 1,
                    skipProbability: 0,
                };
            }
        }

        const shouldDisablePolling = customProviderId !== null && customProviderId !== 'system';
        const providerOptions: GenerateWithAIOptions = (customProviderOverride || shouldDisablePolling)
            ? {
                ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
                ...(shouldDisablePolling ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM } : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
            }
            : {};

        const minParticipants = (mode === 'daily' || mode === 'scenario') ? 1 : 2;
        if (!Array.isArray(combatants) || combatants.length < minParticipants) {
            const errorMessage = `该模式至少需要 ${minParticipants} 位角色`;
            return new Response(JSON.stringify({ error: errorMessage }), { status: 400 });
        }

        // 为客户端生成的随机角色补上签名
        for (const combatant of combatants) {
            if (combatant.isNative && !combatant.data.signature) {
                log.info(`为客户端生成的原生角色 ${combatant.data.codename || combatant.data.name} 进行补签...`);
                combatant.data.signature = await generateSignature(combatant.data);
            }
        }

        // 执行判定
        let adjudicationResults: AdjudicationResult[] | null = null;
        if (adjudicationEvents && Array.isArray(adjudicationEvents) && adjudicationEvents.length > 0) {
            log.info('开始处理随机判定器事件链...');
            adjudicationResults = processAdjudicationChain(adjudicationEvents);
            log.info('判定器事件链处理完成', { results: adjudicationResults });
        }

        // 内容安全检查
        const inputsToCheck: { type: keyof SafetyCheckPolicy, content: string, isNative: boolean }[] = [];

        const finalUserGuidance = typeof userGuidance === 'string' ? userGuidance.trim().slice(0, 200) || null : null;
        const characterGuidancesForReport =
            Array.isArray(combatants)
                ? (combatants as any[])
                    .map((c) => {
                        const characterName = (c?.data?.codename || c?.data?.name || '').toString().trim();
                        const guidance = typeof c?.characterGuidance === 'string' ? c.characterGuidance.trim().slice(0, 100) : '';
                        if (!characterName || !guidance) return null;
                        return { characterName, guidance };
                    })
                    .filter(Boolean) as Array<{ characterName: string; guidance: string }>
                : [];
        if (finalUserGuidance) {
            inputsToCheck.push({ type: 'userGuidance', content: finalUserGuidance, isNative: false });
        }
        if (characterGuidancesForReport.length > 0) {
            for (const item of characterGuidancesForReport) {
                inputsToCheck.push({
                    type: 'userGuidance',
                    content: `【角色行动引导】${item.characterName}：${item.guidance}`,
                    isNative: false,
                });
            }
        }
        if (resolvedReadNarrativeHistory && narrativeHistoryForPrompt && narrativeHistoryForPrompt.length > 0) {
            const narrativeText = narrativeHistoryForPrompt
                .map((entry) => `# ${entry.title}\n${entry.content}`.trim())
                .join('\n\n');
            if (narrativeText) {
                inputsToCheck.push({ type: 'userGuidance', content: narrativeText, isNative: false });
            }
        }
        if (hasQuestionnaireLore) {
            inputsToCheck.push({
                type: 'userGuidance',
                content: `【参考设定（问卷/设定卡 Lore）】\n${loreText}`,
                isNative: false,
            });
        }
        if (scenario) {
            const isNative = await verifySignature(scenario);
            inputsToCheck.push({ type: 'scenario', content: JSON.stringify(scenario), isNative });
        }
        if (normalizedAuxScenarios && normalizedAuxScenarios.length > 0) {
            for (const aux of normalizedAuxScenarios) {
                const isNative = await verifySignature(aux);
                inputsToCheck.push({ type: 'scenario', content: JSON.stringify(aux), isNative });
            }
        }
        combatants.forEach((c: any) => {
            inputsToCheck.push({ type: 'character', content: JSON.stringify(c.data), isNative: c.isNative });
        });

		    const { combinedText, usedBundle } = buildPolicySafetyCheckText(inputsToCheck, {
		        policy: appConfig.SAFETY_CHECK_POLICY,
		        enableBundle: appConfig.ENABLE_BUNDLE_SAFETY_CHECK,
		    });
	        if (usedBundle) {
	            log.info('触发"连坐"机制，打包所有非原生内容进行检查。');
	        }
	        const needsWorldviewWarning = false;

	        if (combinedText) {
	            if (appConfig.ENABLE_SENSITIVE_WORD_FILTER && (await quickCheck(combinedText)).hasSensitiveWords) {
	                log.warn('检测到敏感词 (本地过滤)，请求被拒绝', { text: combinedText });

	                const endedAtMs = Date.now();
	                const endedAtIso = new Date(endedAtMs).toISOString();
	                const durationMs = Math.max(0, endedAtMs - startedAtMs);
	                const ip = getClientIpFromHeaders(req.headers);
	                const ipAnonymized = anonymizeIp(ip);
	                const recordPromise = (async () => {
	                    try {
	                        const user = await authUserResolver.getUser();
	                        await createBattleReportGenerationRecord({
	                            startedAt: startedAtIso,
	                            endedAt: endedAtIso,
	                            durationMs,
	                            status: 'failed',
	                            generationMode: 'stream',
	                            endpoint: 'api/arena/generate-stream',
	                            ip,
	                            ipAnonymized,
	                            userAgent: req.headers.get('user-agent'),
	                            referer: req.headers.get('referer'),
	                            acceptLanguage: req.headers.get('accept-language'),
	                            cfRay: req.headers.get('cf-ray'),
	                            cfCountry: req.headers.get('cf-ipcountry'),
	                            userId: user?.id ?? null,
	                            username: user?.username ?? null,
	                            userPrefix: user?.prefix ?? null,
	                            mode: snapshotMode,
	                            scenarioTitle: typeof scenarioTitle === 'string'
	                                ? scenarioTitle.trim() || null
	                                : (typeof scenario?.title === 'string'
	                                    ? scenario.title.trim()
	                                    : (typeof scenario?.name === 'string' ? scenario.name.trim() : null)),
	                            scenarioDataCardId: typeof scenarioSourceDataCardId === 'string' ? scenarioSourceDataCardId : null,
	                            scenarioDataCardUpdatedAt: typeof scenarioSourceDataCardUpdatedAt === 'string' ? scenarioSourceDataCardUpdatedAt : null,
	                            language: snapshotLanguage,
	                            selectedLevel: snapshotSelectedLevel,
	                            storyLength: snapshotStoryLength,
	                            pvpRoomId: snapshotPvpRoomId,
	                            pvpMatchId: snapshotPvpMatchId,
	                            pvpRoundId: snapshotPvpRoundId,
	                            readArenaHistory: typeof resolvedReadArenaHistory === 'boolean' ? resolvedReadArenaHistory : null,
	                            arenaHistoryReadLimit: resolvedReadArenaHistory
	                                ? (Number.isFinite(resolvedHistoryReadLimit) ? (resolvedHistoryReadLimit === Infinity ? null : resolvedHistoryReadLimit) : null)
	                                : null,
	                            writeArenaHistory: typeof resolvedWriteArenaHistory === 'boolean' ? resolvedWriteArenaHistory : null,
	                            readCurrentState: typeof resolvedReadCurrentState === 'boolean' ? resolvedReadCurrentState : null,
	                            writeCurrentState: typeof resolvedWriteCurrentState === 'boolean' ? resolvedWriteCurrentState : null,
	                            combatantCount: Array.isArray(combatants) ? combatants.length : null,
	                            hasScenario: Boolean(scenario),
	                            hasUserGuidance: typeof userGuidance === 'string' ? Boolean(userGuidance.trim()) : false,
	                            hasAdjudicationEvents: Array.isArray(adjudicationEvents) && adjudicationEvents.length > 0,
	                            hasTeams: Boolean(teams && typeof teams === 'object' && Object.keys(teams).length > 0),
		                            extraJson: compactExtraJson({
		                                errorMessage: 'rejected by sensitive input filter',
		                                rejectedBy: 'sensitive-input',
		                                arenaFreeRankingEnabled: resolvedArenaFreeRankingEnabled,
		                                readNarrativeHistory: resolvedReadNarrativeHistory,
                                        narrativeHistoryReadLimit: resolvedReadNarrativeHistory
                                            ? (Number.isFinite(resolvedNarrativeHistoryReadLimit)
                                                ? (resolvedNarrativeHistoryReadLimit === Infinity ? null : resolvedNarrativeHistoryReadLimit)
                                                : null)
                                            : null,
		                                narrativeHistoryReadCount: resolvedReadNarrativeHistory ? (narrativeHistoryForPrompt?.length ?? 0) : 0,
		                            }),
		                        });
	                    } catch (writeError) {
	                        log.warn('战报生成记录：写入失败（敏感词拒绝）', { writeError });
	                    }
	                })();

	                const executionContext = (req as any).context;
	                if (executionContext?.waitUntil) {
	                    executionContext.waitUntil(recordPromise);
	                } else {
	                    await recordPromise;
	                }

	                return new Response(JSON.stringify({ error: '输入内容不合规', shouldRedirect: true, reason: '使用危险符文' }), { status: 400 });
	            }
	        }

        const systemPrompt = getSystemPrompt(mode, combatants);

        log.info('📝 构建提示词', { mode, combatantsCount: combatants.length, hasScenario: !!scenario, auxScenarioCount: normalizedAuxScenarios?.length || 0 });

        const reporterInfo = getRandomJournalist();
        const streamMeta = {
            reporterInfo,
            userGuidance: finalUserGuidance || undefined,
            ...(characterGuidancesForReport.length > 0 ? { characterGuidances: characterGuidancesForReport } : {}),
            adjudicationResults: adjudicationResults || undefined,
        };

	        const magicalGirlFallbackQuestions = Array.isArray((magicalGirlQuestionnaire as any)?.questions)
	            ? ((magicalGirlQuestionnaire as any).questions as unknown[])
	                .map((item) => (typeof item === 'string' ? item : (item as any)?.question))
	                .filter((item) => typeof item === 'string' && item.trim())
	            : [];
	        const canshouFallbackQuestions = Array.isArray((canshouQuestionnaire as any)?.questions)
	            ? ((canshouQuestionnaire as any).questions as unknown[])
	                .map((item) => (typeof item === 'string' ? item : (item as any)?.question))
	                .filter((item) => typeof item === 'string' && item.trim())
	            : [];

	        const fallbackQuestions = {
	            magicalGirl: magicalGirlFallbackQuestions,
	            canshou: canshouFallbackQuestions,
	            default: magicalGirlFallbackQuestions,
	        };

	        const isStrictRankedMatchRequest =
	            mode === 'classic'
	            && String(language ?? '').trim() === 'zh-CN'
	            && !String(selectedLevel ?? '').trim()
	            && !String(userGuidance ?? '').trim()
	            && !hasQuestionnaireLore
	            && resolvedReadArenaHistory === false
	            && resolvedReadCurrentState === false
	            && resolvedReadNarrativeHistory === false
	            && (!Array.isArray(adjudicationEvents) || adjudicationEvents.length === 0)
	            && Array.isArray(combatants)
	            && combatants.length === 2
	            && combatants.every((c: any) => !String(c?.characterGuidance ?? '').trim());
	        const includeQuestionnaireAnswersInPrompt = !isStrictRankedMatchRequest;

	        const prompt = createStreamPromptBuilder(
	            fallbackQuestions,
	            finalUserGuidance,
	            finalInternalGuidance,
            needsWorldviewWarning,
            language,
            selectedLevel,
            mode,
            scenario,
            normalizedAuxScenarios,
            teams,
            teamNames,
            resolvedReadArenaHistory,
            resolvedHistoryReadLimit,
            resolvedReadCurrentState,
            resolvedWriteArenaHistory,
            resolvedWriteCurrentState,
            shouldForceStreamMeta,
	            adjudicationResults,
	            storyLength,
	            narrativeHistoryForPrompt,
	            loreText,
	            includeQuestionnaireAnswersInPrompt,
	        )({ combatants });

        const aiTelemetry: NonNullable<GenerateWithAIOptions['telemetry']> = {};
        const reasoningEventQueue: RawReasoningStreamEvent[] = [];
        let flushReasoningQueueNow: (() => void) | null = null;
        const aiOptions: GenerateWithAIOptions = {
            ...(providerOptions ?? {}),
            telemetry: aiTelemetry,
            ...(wantsSse
                ? {
                    onReasoningEvent: (event) => {
                        reasoningEventQueue.push(event);
                        flushReasoningQueueNow?.();
                    },
                }
                : {}),
        };
	        const shouldPreferLiteModelInStrict =
	            isStrictRankedMatchRequest && !customProviderOverride && !shouldDisablePolling && !customModelOverride;
        const modelOverrideFallbacks: Array<string | undefined> = customModelOverride
            ? [customModelOverride]
            : (shouldPreferLiteModelInStrict
                ? [...STRICT_RANKED_MODEL_FALLBACKS]
                : [undefined]);

        const generationConfig: RawGenerationConfig = {
            prompt: `${systemPrompt}\n\n${prompt}`,
            temperature: 0.9,
        };

        let usedModelOverride: string | undefined;
        let streamResult: Awaited<ReturnType<typeof generateWithStreamAI>> | null = null;
        let lastModelOverrideError: unknown = null;
        for (const modelOverride of modelOverrideFallbacks) {
            try {
                const attemptConfig: RawGenerationConfig = {
                    ...generationConfig,
                    modelOverride,
                };
                streamResult = await generateWithStreamAI(attemptConfig, aiOptions);
                usedModelOverride = modelOverride;
                break;
            } catch (error) {
                lastModelOverrideError = error;
                if (modelOverrideFallbacks.length > 1) {
                    log.warn('模型生成失败，将尝试下一备选', {
                        modelOverride: modelOverride ?? null,
                        error,
                    });
                }
            }
        }
        if (!streamResult) {
            throw lastModelOverrideError;
        }
        if (!usedModelOverride && typeof aiTelemetry.model === 'string' && aiTelemetry.model.trim()) {
            usedModelOverride = aiTelemetry.model.trim();
        }
        const streamResponse = streamResult.response;
        const usagePromise = streamResult.usagePromise;
        const finishReasonPromise = streamResult.finishReasonPromise;
        const resolvedUsagePromise = (async () => normalizeUsage(await usagePromise?.catch(() => null)))();
        const resolvedFinishReasonPromise = (async () => {
            const value = await finishReasonPromise?.catch(() => null);
            if (typeof value !== 'string') return null;
            const trimmed = value.trim();
            return trimmed || null;
        })();

        log.info('✅ 流式响应已生成，准备返回');

        const generationId = generateUUID();

        const headers = new Headers(streamResponse.headers);
        try {
            const encodedMeta = encodeURIComponent(JSON.stringify({
                ...streamMeta,
                generationId,
                ai: {
                    providerName: aiTelemetry.providerName,
                    providerType: aiTelemetry.providerType,
                    model: aiTelemetry.model,
                },
            }));
            headers.set('x-mahoshojo-stream-meta', encodedMeta);
        } catch (metaError) {
            log.warn('流式战报元信息写入失败，将继续返回正文流', { metaError });
        }

        const originalBody = streamResponse.body;
        if (!originalBody) {
            return new Response(JSON.stringify({ error: '无法读取响应流' }), { status: 500 });
        }

        // 包装流：一边转发给客户端，一边收集少量预览与统计信息；在完成/中断后异步写入 battle_report_generations。
        const ip = getClientIpFromHeaders(req.headers);
        const ipAnonymized = anonymizeIp(ip);
        let r2UploadPromise: Promise<Awaited<ReturnType<typeof storeBattleReportGenerationOutputStreamToR2>>> | null = null;

        let outputBytes = 0;
        let outputChars = 0;
        const previewCollector = createOutputPreviewCollector();

        const decoder = new TextDecoder();
        const appendText = (text: string) => {
            if (!text) return;
            outputChars += text.length;
            previewCollector.append(text);
        };

        let finalized = false;
        const executionContext = (req as any).context;

        const finalizeOnce = async (status: 'completed' | 'aborted' | 'failed', errorMessage?: string) => {
            if (finalized) return;
            finalized = true;

            const endedAtMs = Date.now();
            const endedAtIso = new Date(endedAtMs).toISOString();
            const durationMs = Math.max(0, endedAtMs - startedAtMs);

            // 统一记录：completed / aborted / failed 都写入（即便输出为空），避免“失败/中断没有记录”。
            const normalizedStatus: 'completed' | 'aborted' | 'failed' =
              status === 'completed' && outputBytes <= 0 ? 'failed' : status;
            const normalizedErrorMessage =
              normalizedStatus !== status ? (errorMessage || 'empty output') : errorMessage;

            const { outputPreview } = previewCollector.finish();
            const previewSource = outputPreview;

            const recordPromise = (async () => {
                const user = await authUserResolver.getUser();
                const usage = await resolvedUsagePromise;
                const finishReason = await resolvedFinishReasonPromise;
                const currentSeason = await fetchCurrentSeasonFromOrigin(new URL(req.url).origin);
                const seasonStrictRules = deriveSeasonStrictRules(currentSeason);

                const normalizedScenarioFileName = (() => {
                  if (typeof scenarioFileName !== 'string') return null;
                  const trimmed = scenarioFileName.trim();
                  if (!trimmed) return null;
                  if (trimmed.length > 128) return trimmed.slice(0, 128);
                  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return null;
                  return trimmed;
                })();
                const auxScenarioCount = normalizedAuxScenarios ? normalizedAuxScenarios.length : 0;

                const shieldResult = applyShieldWords(outputPreview);
                const outputSensitive = appConfig.ENABLE_SENSITIVE_WORD_FILTER
                    ? await quickCheck(outputPreview)
                    : { hasSensitiveWords: false };

                const inputJson = JSON.stringify({
                    combatants,
                    userGuidance: finalUserGuidance,
                    scenario,
                    teams,
                });
                const inputBytes = new TextEncoder().encode(inputJson).length;

                const createdId = await createBattleReportGenerationRecord({
                    id: generationId,
                    startedAt: startedAtIso,
                    endedAt: endedAtIso,
                    durationMs,
                    status: normalizedStatus,
                    generationMode: 'stream',
                    endpoint: 'api/arena/generate-stream',
                    ip,
                    ipAnonymized,
                    userAgent: req.headers.get('user-agent'),
                    referer: req.headers.get('referer'),
                    acceptLanguage: req.headers.get('accept-language'),
                    cfRay: req.headers.get('cf-ray'),
                    cfCountry: req.headers.get('cf-ipcountry'),
                    userId: user?.id ?? null,
                    username: user?.username ?? null,
                    userPrefix: user?.prefix ?? null,
                    mode,
                    scenarioTitle: typeof scenarioTitle === 'string'
                        ? scenarioTitle.trim() || null
                        : (typeof scenario?.title === 'string'
                            ? scenario.title.trim()
                            : (typeof scenario?.name === 'string' ? scenario.name.trim() : null)),
                    scenarioDataCardId: typeof scenarioSourceDataCardId === 'string' ? scenarioSourceDataCardId : null,
                    scenarioDataCardUpdatedAt: typeof scenarioSourceDataCardUpdatedAt === 'string' ? scenarioSourceDataCardUpdatedAt : null,
	                    language: normalizeOptionalString(language),
	                    selectedLevel: normalizeOptionalString(selectedLevel),
	                    storyLength: normalizeOptionalString(storyLength),
                    pvpRoomId: snapshotPvpRoomId,
                    pvpMatchId: snapshotPvpMatchId,
                    pvpRoundId: snapshotPvpRoundId,
                    readArenaHistory: typeof resolvedReadArenaHistory === 'boolean' ? resolvedReadArenaHistory : null,
                    arenaHistoryReadLimit: resolvedReadArenaHistory
                        ? (Number.isFinite(resolvedHistoryReadLimit) ? (resolvedHistoryReadLimit === Infinity ? null : resolvedHistoryReadLimit) : null)
                        : null,
                    writeArenaHistory: typeof resolvedWriteArenaHistory === 'boolean' ? resolvedWriteArenaHistory : null,
                    readCurrentState: typeof resolvedReadCurrentState === 'boolean' ? resolvedReadCurrentState : null,
                    writeCurrentState: typeof resolvedWriteCurrentState === 'boolean' ? resolvedWriteCurrentState : null,
                    combatantCount: Array.isArray(combatants) ? combatants.length : null,
                    hasScenario: Boolean(scenario),
                    hasUserGuidance: Boolean(finalUserGuidance),
                    hasAdjudicationEvents: Array.isArray(adjudicationEvents) && adjudicationEvents.length > 0,
                    hasTeams: Boolean(teams && typeof teams === 'object' && Object.keys(teams).length > 0),
                    inputChars: inputJson.length,
                    inputBytes,
                    userGuidancePreview: finalUserGuidance ? buildContentPreview(finalUserGuidance, { headChars: 300, tailChars: 300 }) : null,
                    adjudicationEventsPreview: Array.isArray(adjudicationEvents)
                        ? buildContentPreview(JSON.stringify(adjudicationEvents), { headChars: 300, tailChars: 300 })
                        : null,
                    customProviderId: customProviderId ?? null,
                    customModelId: customProviderPayload?.modelId ?? null,
                    isDowngrade: null,
                    aiProviderName: aiTelemetry.providerName ?? null,
                    aiProviderType: aiTelemetry.providerType ?? null,
                    aiModel: aiTelemetry.model ?? null,
                    headline: extractHeadlineFromMarkdown(previewSource),
                    winner: extractWinnerFromText(previewSource),
                    outputChars,
                    outputBytes,
                    promptTokens: usage?.promptTokens ?? null,
                    completionTokens: usage?.completionTokens ?? null,
                    totalTokens: usage?.totalTokens ?? null,
                    cachedTokens: usage?.cachedTokens ?? null,
                    reasoningTokens: usage?.reasoningTokens ?? null,
	                    outputPreview,
	                    outputHasSensitiveWords: Boolean((outputSensitive as any)?.hasSensitiveWords),
	                    outputHasShieldWords: shieldResult.hasShieldWords,
	                    extraJson: compactExtraJson({
	                        errorMessage: normalizeErrorMessage(normalizedErrorMessage),
                            finishReason,
                            arenaFreeRankingEnabled: resolvedArenaFreeRankingEnabled,
                            arenaStrictPolicy: '1+3:v1',
                            seasonId: typeof currentSeason?.id === 'string' ? currentSeason.id : null,
                            seasonMode: seasonStrictRules.mode !== 'classic' ? seasonStrictRules.mode : null,
                            seasonStoryGuidance: seasonStrictRules.storyGuidance || null,
                            seasonScenarioPreset: seasonStrictRules.scenarioPresetFilename ?? null,
                            seasonQuestionnaireLoreAllowed: seasonStrictRules.questionnaireLoreAllowed ? true : null,
                            questionnaireLoreEnabled: hasQuestionnaireLore ? true : null,
                            seasonQuestionnaireLorePresetIds: seasonStrictRules.questionnaireLorePresetIds,
                            questionnaireLoreIds,
                            scenarioFileName: normalizedScenarioFileName,
                            auxScenarioCount: auxScenarioCount > 0 ? auxScenarioCount : null,
	                        resolvedModelOverride: usedModelOverride ?? null,
	                        readNarrativeHistory: resolvedReadNarrativeHistory,
                            narrativeHistoryReadLimit: resolvedReadNarrativeHistory
                                ? (Number.isFinite(resolvedNarrativeHistoryReadLimit)
                                    ? (resolvedNarrativeHistoryReadLimit === Infinity ? null : resolvedNarrativeHistoryReadLimit)
                                    : null)
                                : null,
	                        narrativeHistoryReadCount: resolvedReadNarrativeHistory ? (narrativeHistoryForPrompt?.length ?? 0) : 0,
	                    }),
	                });

                if (createdId && Array.isArray(combatants) && normalizedStatus !== 'failed') {
                    const toBytes = (value: string) => new TextEncoder().encode(value).length;
                    const rows = combatants.map((c: any, index: number) => {
                        const name = c?.data?.codename || c?.data?.name || `未知角色#${index + 1}`;
                        const payload = typeof c?.data === 'object' ? JSON.stringify(c.data) : '';
                        const characterGuidance =
                            typeof c?.characterGuidance === 'string' ? c.characterGuidance.trim().slice(0, 100) : '';
                        const isPreset = typeof c?.isPreset === 'boolean' ? c.isPreset : false;
                        const presetFilename = isPreset && typeof c?.filename === 'string' ? c.filename.trim() : '';
                        return {
                            generationId: generationId,
                            sortIndex: index,
                            name,
                            type: typeof c?.type === 'string' ? c.type : null,
                            templateId: presetFilename || (typeof c?.data?.templateId === 'string' ? c.data.templateId : null),
                            isNative: typeof c?.isNative === 'boolean' ? c.isNative : null,
                            isPreset: isPreset ? true : null,
                            teamId: typeof c?.teamId === 'number' ? c.teamId : null,
                            characterGuidance: characterGuidance || null,
                            dataCardId: typeof c?.sourceDataCardId === 'string' ? c.sourceDataCardId : null,
                            dataCardUpdatedAt: typeof c?.sourceDataCardUpdatedAt === 'string' ? c.sourceDataCardUpdatedAt : null,
                            sizeChars: payload ? payload.length : null,
                            sizeBytes: payload ? toBytes(payload) : null,
                        };
                    });
                    const combatantsWrite = await createBattleReportGenerationCombatants(rows);
                    if (!combatantsWrite.ok) {
                        log.warn('战报生成记录：角色明细写入失败', { recordId: generationId, errorMessage: combatantsWrite.errorMessage });
                    }
	                    await updateBattleReportGenerationCombatantsWriteResult(generationId, {
	                        ok: combatantsWrite.ok,
	                        expectedRows: rows.length,
	                        errorMessage: combatantsWrite.errorMessage ?? null,
	                    });

		                    if (!combatantsWrite.ok) {
		                        await updateBattleReportGenerationExtraJson(
		                            generationId,
		                            compactExtraJson({
		                                errorMessage: normalizeErrorMessage(normalizedErrorMessage),
		                                combatantsFallbackReason: 'combatants-table-write-failed',
		                                combatantsFallback: buildCombatantsFallbackForExtraJson(combatants),
		                            })
		                        );
		                    }
		                }

	                    if (createdId) {
	                        try {
	                            await settleArenaRatingsForGeneration(generationId);
	                        } catch (error) {
	                            log.warn('排位结算失败（非阻塞）', { recordId: generationId, error });
	                        }
	                    }

	                    const stored = r2UploadPromise ? await r2UploadPromise.catch(() => null) : null;
		                    if (stored?.ok && stored.r2Key) {
		                        if (normalizedStatus === 'completed') {
		                            const indexed = await upsertLargeObjectByOwnerRef({
                                kind: 'battle_report_generation_output',
                                ownerRefId: generationId,
                                ownerUserId: user?.id ?? null,
                                r2Key: stored.r2Key,
                                bytes: stored.bytes,
                                storedBytes: stored.storedBytes,
                                contentType: stored.contentType,
                                contentEncoding: stored.contentEncoding,
                                sha256: null,
                            });
                            if (indexed.ok && !stored.persistPreviewInD1) {
                                await updateBattleReportGenerationOutputPreview(generationId, null);
                            }
                        } else {
		                            await deleteObject(stored.r2Key);
		                        }
		                    }
		            })();

            try {
                if (executionContext?.waitUntil) {
                    executionContext.waitUntil(recordPromise);
                } else {
                    await recordPromise;
                }
            } catch (writeError) {
                log.warn('战报生成记录：写入失败', { writeError });
            }
        };

        const shouldAllowStreamMeta = shouldForceStreamMeta || resolvedWriteArenaHistory || resolvedWriteCurrentState;

	        if (wantsSse) {
	            const sseHeaders = new Headers(headers);
	            sseHeaders.set('Content-Type', 'text/event-stream; charset=utf-8');
	            sseHeaders.set('Cache-Control', 'no-cache, no-transform');
	            const debugSse = debugSseRequested;

		            const encoder = new TextEncoder();
                    const HEARTBEAT_INTERVAL_MS = 15_000;
		            const encodeEvent = (event: string, payload: unknown) => {
	                let data: string;
	                try {
	                    data = JSON.stringify(payload ?? null);
                } catch (error) {
                    data = JSON.stringify({
                        ok: false,
                        error: error instanceof Error ? error.message : String(error ?? 'json stringify failed'),
                    });
                }
	                return encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
	            };
		            const enqueueDebug = (controller: ReadableStreamDefaultController<Uint8Array>, payload: unknown) => {
		                if (!debugSse) return;
		                controller.enqueue(encodeEvent('debug', payload));
		            };
                    const HEARTBEAT_PAYLOAD = encoder.encode(': keepalive\n\n');

		            const META_GUARD_CHARS = 256;
		            const META_FALLBACK_TAIL_CHARS = 120_000;

            const [clientUpstream, r2Body] = originalBody.tee();
            r2UploadPromise = storeBattleReportGenerationOutputStreamToR2({
                generationId,
                startedAtIso,
                stream: r2Body,
            });

            const reader = clientUpstream.getReader();
            const readWithTimeout = createStreamReadWithTimeout({
                label: 'api/arena/generate-stream SSE 上游读取',
                idleTimeoutMs: STREAM_READ_IDLE_TIMEOUT_MS,
                totalTimeoutMs: STREAM_READ_TOTAL_TIMEOUT_MS,
                onTimeout: () => {
                    try {
                        void reader.cancel('timeout').catch(() => {});
                    } catch {
                        // ignore
                    }
                },
            });

		            let pendingMarkdownTail = '';
		            let metaBuffer = '';
			            let metaFallbackTail = '';
			            let inMeta = false;
			            let markdownCharsSent = 0;
			            let hasMeaningfulMarkdown = false;
                let reasoningCharsSent = 0;
                let hasReasoningStarted = false;
                let hasReasoningDelta = false;
	                let reasoningCompleted = false;
	                let activeSseController: ReadableStreamDefaultController<Uint8Array> | null = null;
	                let sseStreamClosed = false;
                    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
                    const clearHeartbeatTimer = () => {
                        if (!heartbeatTimer) return;
                        clearInterval(heartbeatTimer);
                        heartbeatTimer = null;
                    };
                    const startHeartbeatTimer = (controller: ReadableStreamDefaultController<Uint8Array>) => {
                        clearHeartbeatTimer();
                        heartbeatTimer = setInterval(() => {
                            if (sseCancelled || sseStreamClosed || activeSseController !== controller) {
                                clearHeartbeatTimer();
                                return;
                            }
                            try {
                                controller.enqueue(HEARTBEAT_PAYLOAD);
                            } catch {
                                clearHeartbeatTimer();
                            }
                        }, HEARTBEAT_INTERVAL_MS);
                    };

		            const flushMarkdown = (controller: ReadableStreamDefaultController<Uint8Array>, chunk: string) => {
		                if (!chunk) return;
		                markdownCharsSent += chunk.length;
		                if (!hasMeaningfulMarkdown && /\S/.test(chunk)) {
		                    hasMeaningfulMarkdown = true;
		                }
		                controller.enqueue(encodeEvent('markdown', { chunk }));
		            };

                const flushReasoningQueue = (controller: ReadableStreamDefaultController<Uint8Array>) => {
                    while (reasoningEventQueue.length > 0) {
                        const event = reasoningEventQueue.shift();
                        if (!event) continue;

                        if (event.type === 'reasoning-start') {
                            hasReasoningStarted = true;
                            controller.enqueue(
                                encodeEvent('reasoning', {
                                    source: 'sdk',
                                    status: 'thinking',
                                    chunk: '',
                                })
                            );
                            continue;
                        }

                        if (event.type === 'reasoning-delta') {
                            const chunk = typeof event.text === 'string' ? event.text : '';
                            if (!chunk) continue;
                            hasReasoningStarted = true;
                            hasReasoningDelta = true;
                            reasoningCharsSent += chunk.length;
                            controller.enqueue(
                                encodeEvent('reasoning', {
                                    source: 'sdk',
                                    status: 'thinking',
                                    chunk,
                                })
                            );
                            continue;
                        }

                        if (event.type === 'reasoning-end') {
                            hasReasoningStarted = true;
                            reasoningCompleted = true;
                            controller.enqueue(
                                encodeEvent('reasoning_done', {
                                    source: 'sdk',
                                    status: hasReasoningDelta ? 'done' : 'unavailable',
                                    chars: reasoningCharsSent,
                                })
                            );
                        }
                    }
                };
                const flushReasoningQueueIfReady = () => {
                    if (!activeSseController || sseStreamClosed) return;
                    flushReasoningQueue(activeSseController);
                };
                flushReasoningQueueNow = flushReasoningQueueIfReady;

	            const processText = (controller: ReadableStreamDefaultController<Uint8Array>, text: string) => {
	                if (!text) return;
	                if (shouldAllowStreamMeta) {
	                    metaFallbackTail += text;
	                    if (metaFallbackTail.length > META_FALLBACK_TAIL_CHARS) {
	                        metaFallbackTail = metaFallbackTail.slice(-META_FALLBACK_TAIL_CHARS);
	                    }
	                }
	                if (inMeta) {
	                    metaBuffer += text;
	                    const metaEnd = metaBuffer.indexOf('-->');
	                    if (metaEnd !== -1) {
	                        const metaComment = metaBuffer.slice(0, metaEnd + 3);
	                        const afterMeta = metaBuffer.slice(metaEnd + 3);
	                        metaBuffer = metaComment;
	                        inMeta = false;
	                        if (afterMeta) {
	                            processText(controller, afterMeta);
	                        }
	                    }
	                    return;
		                }

		                pendingMarkdownTail += text;
		                const metaStart = findStreamUpdateMetaStart(pendingMarkdownTail);
		                if (metaStart) {
		                    const start = metaStart.index;
		                    const before = pendingMarkdownTail.slice(0, start);
		                    if (before) flushMarkdown(controller, before);
		                    metaBuffer = pendingMarkdownTail.slice(start);
		                    pendingMarkdownTail = '';
		                    inMeta = true;
		                    enqueueDebug(controller, {
		                        phase: 'meta_start',
		                        kind: metaStart.kind,
		                        marker: metaStart.marker,
		                        startIndex: start,
		                        pendingTailLength: pendingMarkdownTail.length,
		                        metaBufferLength: metaBuffer.length,
		                    });
		                    return;
		                }

                if (pendingMarkdownTail.length > META_GUARD_CHARS) {
                    const safePart = pendingMarkdownTail.slice(0, pendingMarkdownTail.length - META_GUARD_CHARS);
                    pendingMarkdownTail = pendingMarkdownTail.slice(-META_GUARD_CHARS);
                    if (safePart) flushMarkdown(controller, safePart);
                }
            };

		            let sseCancelled = false;
		            let pumpStarted = false;

			            const finalizeSseAndClose = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
                        clearHeartbeatTimer();
			                // flush TextDecoder：避免最后一个 chunk 以多字节字符结尾时丢字
			                const flushed = decoder.decode();
		                if (flushed) {
		                    appendText(flushed);
		                    processText(controller, flushed);
		                }
                        flushReasoningQueue(controller);

		                if (!inMeta && pendingMarkdownTail) {
		                    flushMarkdown(controller, pendingMarkdownTail);
		                    pendingMarkdownTail = '';
		                }

		                enqueueDebug(controller, {
		                    phase: 'done_before_meta',
		                    outputBytes,
		                    outputChars,
		                    markdownCharsSent,
		                    hasMeaningfulMarkdown,
		                    inMeta,
		                    pendingMarkdownTailLength: pendingMarkdownTail.length,
		                    metaBufferLength: metaBuffer.length,
		                    metaFallbackTailLength: metaFallbackTail.length,
                        reasoningCharsSent,
                        hasReasoningStarted,
                        hasReasoningDelta,
                        reasoningCompleted,
		                });

			                // 在 SSE 模式下以事件发送 telemetry（不再通过尾部注释注入正文）。
			                const usageForTelemetry = await Promise.race([
			                    resolvedUsagePromise,
			                    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
			                ]);
                        const finishReasonForTelemetry = await Promise.race([
                            resolvedFinishReasonPromise,
                            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
                        ]);
			                const shouldIncludeTelemetry =
			                    (usageForTelemetry != null &&
			                        (typeof usageForTelemetry.promptTokens === 'number' ||
			                            typeof usageForTelemetry.completionTokens === 'number' ||
			                            typeof usageForTelemetry.reasoningTokens === 'number')) ||
                                (typeof finishReasonForTelemetry === 'string' && Boolean(finishReasonForTelemetry.trim())) ||
			                    typeof narrativeHistoryReadCount === 'number' ||
			                    (typeof aiTelemetry.model === 'string' && Boolean(aiTelemetry.model.trim()));

		                if (shouldIncludeTelemetry) {
		                    const aiModelForTelemetry =
		                        typeof aiTelemetry.model === 'string' && aiTelemetry.model.trim() ? aiTelemetry.model.trim() : null;
			                    const telemetryPayload = {
			                        version: 1,
			                        ...(aiModelForTelemetry ? { aiModel: aiModelForTelemetry } : {}),
                                    ...(typeof finishReasonForTelemetry === 'string' && finishReasonForTelemetry.trim()
                                        ? { finishReason: finishReasonForTelemetry.trim() }
                                        : {}),
			                        ...(usageForTelemetry
			                            ? {
			                                usage: {
		                                    promptTokens: usageForTelemetry.promptTokens ?? null,
		                                    reasoningTokens: usageForTelemetry.reasoningTokens ?? null,
		                                    completionTokens: usageForTelemetry.completionTokens ?? null,
		                                    totalTokens: usageForTelemetry.totalTokens ?? null,
		                                    cachedTokens: usageForTelemetry.cachedTokens ?? null,
		                                },
		                            }
		                            : {}),
		                        ...(typeof narrativeHistoryReadCount === 'number' ? { narrativeHistoryReadCount } : {}),
		                    };
		                    controller.enqueue(encodeEvent('telemetry', telemetryPayload));
		                }

                        flushReasoningQueue(controller);
                        if (!reasoningCompleted) {
                            reasoningCompleted = true;
                            controller.enqueue(
                                encodeEvent('reasoning_done', {
                                    source: 'sdk',
                                    status: hasReasoningDelta ? 'done' : 'unavailable',
                                    chars: reasoningCharsSent,
                                })
                            );
                        }

		                let metaHasImpacts = false;
		                if (shouldAllowStreamMeta) {
		                    const metaCandidate = metaBuffer && metaBuffer.trim() ? metaBuffer : metaFallbackTail;
		                    if (metaCandidate && metaCandidate.trim()) {
		                        try {
		                            const extracted = await extractStreamUpdateMeta(metaCandidate);
		                            if (extracted?.meta) {
		                                metaHasImpacts = Array.isArray(extracted.meta.impacts) && extracted.meta.impacts.length > 0;
		                                const raw = extracted.rawComment ?? metaCandidate;
		                                const rawMax = 8_000;
		                                const rawTrimmed = raw.length > rawMax ? raw.slice(0, rawMax) : raw;
		                                controller.enqueue(
		                                    encodeEvent('meta', {
		                                        parseOk: true,
		                                        meta: extracted.meta,
		                                        raw: rawTrimmed,
		                                        rawTruncated: raw.length > rawMax,
		                                    })
		                                );
		                            } else {
		                                controller.enqueue(
		                                    encodeEvent('meta_error', {
		                                        parseOk: false,
		                                        error: '未能识别 MAHOSHOJO_*_META 块（marker 缺失或格式不匹配）',
		                                        raw: metaCandidate.slice(0, 2_000),
		                                        rawTruncated: metaCandidate.length > 2_000,
		                                    })
		                                );
		                            }
		                        } catch (error) {
		                            controller.enqueue(
		                                encodeEvent('meta_error', {
		                                    parseOk: false,
		                                    error: error instanceof Error ? error.message : String(error ?? 'meta parse failed'),
		                                    raw: metaCandidate.slice(0, 2_000),
		                                    rawTruncated: metaCandidate.length > 2_000,
		                                })
		                            );
		                        }
		                    } else {
		                        controller.enqueue(
		                            encodeEvent('meta_error', {
		                                parseOk: false,
		                                error: '未检测到 MAHOSHOJO_*_META（模型可能漏写，或未按末行追加）',
		                                raw: null,
		                            })
		                        );
		                    }
		                }

		                // 若未下发任何有效正文（非空白），且也没有可用的 impacts，则视为异常：AI 返回空输出 / 或正文被吞掉。
			                if (!hasMeaningfulMarkdown && !metaHasImpacts) {
			                    const metaCandidate = metaBuffer && metaBuffer.trim() ? metaBuffer : metaFallbackTail;
			                    const rawPreview = metaCandidate && metaCandidate.trim() ? metaCandidate.slice(0, 400) : null;
		                    controller.enqueue(
		                        encodeEvent('error', {
		                            ok: false,
		                            error: 'AI 返回空对象/空内容（{} / [] / 空白），未收到有效正文，请重试或切换模型。',
		                            debug: debugSse
		                                ? {
		                                    outputBytes,
		                                    outputChars,
		                                    markdownCharsSent,
		                                    hasMeaningfulMarkdown,
		                                    metaHasImpacts,
		                                    inMeta,
		                                    pendingMarkdownTailLength: pendingMarkdownTail.length,
		                                    metaBufferLength: metaBuffer.length,
		                                    metaFallbackTailLength: metaFallbackTail.length,
		                                    rawPreview,
		                                  }
		                                : null,
		                        })
			                    );
			                    await finalizeOnce('failed', 'empty stream output');
                                sseStreamClosed = true;
                                activeSseController = null;
                                flushReasoningQueueNow = null;
			                    controller.close();
			                    return;
			                }

			                controller.enqueue(encodeEvent('done', { ok: true }));
			                await finalizeOnce('completed');
                            sseStreamClosed = true;
                            activeSseController = null;
                            flushReasoningQueueNow = null;
			                controller.close();
			            };

		            const pumpSse = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
		                if (pumpStarted) return;
		                pumpStarted = true;

		                enqueueDebug(controller, { phase: 'pump_start' });

		                while (!sseCancelled) {
		                    try {
		                        // 简单背压：队列满时暂停读取上游，避免无界缓存
		                        while (!sseCancelled && typeof controller.desiredSize === 'number' && controller.desiredSize <= 0) {
		                            await new Promise((resolve) => setTimeout(resolve, 5));
		                        }

		                        const { done, value } = await readWithTimeout(reader);
		                        if (sseCancelled) return;

		                        if (done) {
		                            await finalizeSseAndClose(controller);
		                            return;
		                        }

		                        if (value) {
		                            outputBytes += value.byteLength;
		                            const decoded = decoder.decode(value, { stream: true });
		                            appendText(decoded);
		                            processText(controller, decoded);
                                flushReasoningQueue(controller);
		                        }
			                    } catch (streamError) {
			                        if (sseCancelled) return;
                            flushReasoningQueue(controller);
			                        const message =
			                            streamError instanceof Error ? streamError.message : String(streamError ?? 'stream error');
                            const interrupted = isInterruptedStreamError(streamError);
                            const statusForRecord: 'aborted' | 'failed' = interrupted ? 'aborted' : 'failed';
			                        try {
			                            controller.enqueue(encodeEvent('error', {
                                    ok: false,
                                    error: message,
                                    status: statusForRecord,
                                    interrupted,
                                    ...(interrupted ? { errorCode: 'stream_interrupted' } : {}),
                                }));
			                        } catch {
			                            // ignore
			                        }
					                        await finalizeOnce(statusForRecord, message);
					                        try {
                                    clearHeartbeatTimer();
                                    sseStreamClosed = true;
                                    activeSseController = null;
                                    flushReasoningQueueNow = null;
			                            controller.close();
			                        } catch {
			                            // ignore
		                        }
		                        return;
		                    }
		                }
		            };

			            const sseBody = new ReadableStream<Uint8Array>({
				                start(controller) {
                                activeSseController = controller;
                                sseStreamClosed = false;
                                startHeartbeatTimer(controller);
				                    enqueueDebug(controller, {
				                        phase: 'open',
				                        generationId,
		                        shouldAllowStreamMeta,
		                        idleTimeoutMs: STREAM_READ_IDLE_TIMEOUT_MS,
		                        totalTimeoutMs: STREAM_READ_TOTAL_TIMEOUT_MS,
		                    });
                        flushReasoningQueue(controller);
			                    void pumpSse(controller);
			                },
				                async cancel(reason) {
                                clearHeartbeatTimer();
				                    sseCancelled = true;
                                sseStreamClosed = true;
                                activeSseController = null;
                                flushReasoningQueueNow = null;
			                    try {
			                        void reader.cancel(reason).catch(() => {});
			                    } catch {
		                        // 忽略取消时的二次错误
		                    }
		                    await finalizeOnce(
		                        'aborted',
		                        reason instanceof Error ? reason.message : String(reason ?? 'aborted')
		                    );
		                },
		            });

            return new Response(sseBody, {
                status: streamResponse.status,
                headers: sseHeaders,
            });
        }

        const reader = originalBody.getReader();
        const readWithTimeout = createStreamReadWithTimeout({
            label: 'api/arena/generate-stream 上游读取',
            idleTimeoutMs: STREAM_READ_IDLE_TIMEOUT_MS,
            totalTimeoutMs: STREAM_READ_TOTAL_TIMEOUT_MS,
            onTimeout: () => {
                try {
                    void reader.cancel('timeout').catch(() => {});
                } catch {
                    // ignore
                }
            },
        });
        const wrappedBody = new ReadableStream<Uint8Array>({
            async pull(controller) {
                try {
                    const { done, value } = await readWithTimeout(reader);
                    if (done) {
                        appendText(decoder.decode());

	                        // 在流式末尾追加一段系统 telemetry 注释，用于前端展示 token 与叙事历史读取条数。
	                        const usageForTelemetry = await Promise.race([
	                            resolvedUsagePromise,
	                            new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
	                        ]);
                        const finishReasonForTelemetry = await Promise.race([
                            resolvedFinishReasonPromise,
                            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
                        ]);
	                        const shouldIncludeTelemetry =
	                            (usageForTelemetry != null &&
	                                (typeof usageForTelemetry.promptTokens === 'number' ||
	                                    typeof usageForTelemetry.completionTokens === 'number' ||
	                                    typeof usageForTelemetry.reasoningTokens === 'number')) ||
                                (typeof finishReasonForTelemetry === 'string' && Boolean(finishReasonForTelemetry.trim())) ||
	                            typeof narrativeHistoryReadCount === 'number' ||
	                            (typeof aiTelemetry.model === 'string' && Boolean(aiTelemetry.model.trim()));

                        if (shouldIncludeTelemetry) {
                            const aiModelForTelemetry =
                                typeof aiTelemetry.model === 'string' && aiTelemetry.model.trim() ? aiTelemetry.model.trim() : null;
	                            const telemetryPayload = {
	                                version: 1,
	                                ...(aiModelForTelemetry ? { aiModel: aiModelForTelemetry } : {}),
                                ...(typeof finishReasonForTelemetry === 'string' && finishReasonForTelemetry.trim()
                                    ? { finishReason: finishReasonForTelemetry.trim() }
                                    : {}),
	                                ...(usageForTelemetry
	                                    ? {
	                                        usage: {
                                            promptTokens: usageForTelemetry.promptTokens ?? null,
                                            reasoningTokens: usageForTelemetry.reasoningTokens ?? null,
                                            completionTokens: usageForTelemetry.completionTokens ?? null,
                                            totalTokens: usageForTelemetry.totalTokens ?? null,
                                            cachedTokens: usageForTelemetry.cachedTokens ?? null,
                                        },
                                    }
                                    : {}),
                                ...(typeof narrativeHistoryReadCount === 'number' ? { narrativeHistoryReadCount } : {}),
                            };

                            const telemetryComment = `\n\n<!-- MAHOSHOJO_TELEMETRY_META ${JSON.stringify(telemetryPayload)} -->\n`;
                            const encoded = new TextEncoder().encode(telemetryComment);
                            outputBytes += encoded.byteLength;
                            appendText(telemetryComment);
                            controller.enqueue(encoded);
                        }

                        await finalizeOnce('completed');
                        controller.close();
                        return;
                    }

                    if (value) {
                        outputBytes += value.byteLength;
                        appendText(decoder.decode(value, { stream: true }));
                        controller.enqueue(value);
                    }
                } catch (streamError) {
                    controller.error(streamError);
                    const statusForRecord: 'aborted' | 'failed' = isInterruptedStreamError(streamError) ? 'aborted' : 'failed';
                    await finalizeOnce(statusForRecord, streamError instanceof Error ? streamError.message : 'stream error');
                }
            },
            async cancel(reason) {
                try {
                    void reader.cancel(reason).catch(() => {});
                } catch {
                    // 忽略取消时的二次错误
                }
                await finalizeOnce('aborted', reason instanceof Error ? reason.message : String(reason ?? 'aborted'));
            },
        });

        const [clientBody, r2Body] = wrappedBody.tee();
        r2UploadPromise = storeBattleReportGenerationOutputStreamToR2({
            generationId,
            startedAtIso,
            stream: r2Body,
        });

        return new Response(clientBody, {
            status: streamResponse.status,
            headers,
        });
	    } catch (error) {
	        log.error('生成战斗故事时发生顶层错误', { error });
	        const errorMessage = error instanceof Error ? error.message : '未知错误';

	        const debugSse = debugSseRequested;

	        const endedAtMs = Date.now();
	        const endedAtIso = new Date(endedAtMs).toISOString();
	        const durationMs = Math.max(0, endedAtMs - startedAtMs);
            const statusForRecord: 'aborted' | 'failed' = isInterruptedStreamError(error) ? 'aborted' : 'failed';
	        const ip = getClientIpFromHeaders(req.headers);
	        const ipAnonymized = anonymizeIp(ip);
	        const recordPromise = (async () => {
	            try {
	                const user = await authUserResolver.getUser();
	                await createBattleReportGenerationRecord({
	                    startedAt: startedAtIso,
	                    endedAt: endedAtIso,
	                    durationMs,
	                    status: statusForRecord,
	                    generationMode: 'stream',
	                    endpoint: 'api/arena/generate-stream',
	                    ip,
	                    ipAnonymized,
	                    userAgent: req.headers.get('user-agent'),
	                    referer: req.headers.get('referer'),
	                    acceptLanguage: req.headers.get('accept-language'),
	                    cfRay: req.headers.get('cf-ray'),
	                    cfCountry: req.headers.get('cf-ipcountry'),
	                    userId: user?.id ?? null,
	                    username: user?.username ?? null,
	                    userPrefix: user?.prefix ?? null,
	                    mode: snapshotMode,
	                    language: snapshotLanguage,
	                    selectedLevel: snapshotSelectedLevel,
	                    storyLength: snapshotStoryLength,
	                    pvpRoomId: snapshotPvpRoomId,
	                    pvpMatchId: snapshotPvpMatchId,
	                    pvpRoundId: snapshotPvpRoundId,
	                    extraJson: {
	                        errorMessage,
	                        stage: 'top-level-catch',
                            status: statusForRecord,
	                    },
	                });
	            } catch (writeError) {
	                log.warn('战报生成记录：写入失败（顶层错误）', { writeError });
	            }
	        })();

	        const executionContext = (req as any).context;
	        if (executionContext?.waitUntil) {
	            executionContext.waitUntil(recordPromise);
	        } else {
	            await recordPromise;
	        }

	        if (wantsSse) {
	            const encoder = new TextEncoder();
	            const encodeEvent = (event: string, payload: unknown) => {
	                let data: string;
	                try {
	                    data = JSON.stringify(payload ?? null);
	                } catch (jsonError) {
	                    data = JSON.stringify({
	                        ok: false,
	                        error: jsonError instanceof Error ? jsonError.message : String(jsonError ?? 'json stringify failed'),
	                    });
	                }
	                return encoder.encode(`event: ${event}\ndata: ${data}\n\n`);
	            };

	            const sseHeaders = new Headers();
	            sseHeaders.set('Content-Type', 'text/event-stream; charset=utf-8');
	            sseHeaders.set('Cache-Control', 'no-cache, no-transform');

	            const body = new ReadableStream<Uint8Array>({
	                start(controller) {
	                    if (debugSse) {
	                        controller.enqueue(
	                            encodeEvent('debug', {
	                                phase: 'top_level_error',
	                                error: errorMessage,
	                                ...(error instanceof Error && typeof error.name === 'string' ? { errorName: error.name } : {}),
	                            })
	                        );
	                    }
	                    controller.enqueue(encodeEvent('error', {
                            ok: false,
                            error: errorMessage,
                            status: statusForRecord,
                            interrupted: statusForRecord === 'aborted',
                            ...(statusForRecord === 'aborted' ? { errorCode: 'stream_interrupted' } : {}),
                        }));
	                    controller.enqueue(encodeEvent('done', { ok: false, status: statusForRecord }));
	                    controller.close();
	                },
	            });

	            return new Response(body, {
	                status: 200,
	                headers: sseHeaders,
	            });
	        }

	        return new Response(JSON.stringify({ error: '生成失败，请稍后重试', message: errorMessage }), {
	            status: 500,
	        });
	    }
	}

export default handler;
