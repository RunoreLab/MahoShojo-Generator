// pages/api/arena/generate-stream.ts

import { getLogger } from '@/lib/logger';
import questionnaire from '@/public/questionnaire.json';
import { config as appConfig, SafetyCheckPolicy, type AIProvider } from '@/lib/config';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { NextRequest } from 'next/server';
import { AdjudicationResult, NarrativeHistoryEntry } from '@/types/arena';
import { verifySignature, generateSignature } from '@/lib/signature';
import { getSystemPrompt } from '@/lib/arena/constants';
import { CustomProviderSchema } from '@/lib/arena/schemas';
import { processAdjudicationChain, createStreamPromptBuilder } from '@/lib/arena/logic';
import { generateWithStreamAI, LoadBalanceStrategy, RawGenerationConfig, GenerateWithAIOptions } from '@/lib/stream/raw-ai';
import { getRandomJournalist } from '@/lib/random-choose-journalist';
import {
    createBattleReportGenerationRecord,
    createBattleReportGenerationCombatants,
    updateBattleReportGenerationExtraJson,
    updateBattleReportGenerationCombatantsWriteResult,
    getUserByAuthKey
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
import { createOutputPreviewCollector } from '@/lib/arena/output-preview';

const log = getLogger('api-gen-battle-stream');
const MAX_COMBATANTS = 10;

export const config = {
    runtime: 'edge',
};

async function handler(req: NextRequest): Promise<Response> {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

	    const startedAtMs = Date.now();
	    const startedAtIso = new Date(startedAtMs).toISOString();

	    // 用于在异常/提前返回时补齐 battle_report_generations 记录（避免“失败/敏感词拦截没有记录”）。
	    let snapshotMode: string = 'classic';
	    let snapshotLanguage: string | null = null;
	    let snapshotSelectedLevel: string | null = null;
	    let snapshotStoryLength: string | null = null;
	    let snapshotPvpRoomId: string | null = null;
	    let snapshotPvpMatchId: string | null = null;
	    let snapshotPvpRoundId: string | null = null;

	    try {
	        const body = await req.json();
	        const {
	            combatants,
            selectedLevel,
            mode = 'classic',
            userGuidance,
            internalGuidance,
            scenario,
            teams,
            language = 'zh-CN',
            useArenaHistory,
            arenaHistoryReadLimit,
            readArenaHistory,
            writeArenaHistory,
            readCurrentState,
            writeCurrentState,
            readNarrativeHistory,
            narrativeHistory,
            adjudicationEvents,
            storyLength,
            customProvider: customProviderPayload,
            scenarioTitle,
            scenarioSourceDataCardId,
	            scenarioSourceDataCardUpdatedAt,
              pvpContext,
              forceStreamMeta,
	        } = body;

	        snapshotMode = typeof mode === 'string' ? mode : 'classic';
	        snapshotLanguage = typeof language === 'string' ? language : null;
	        snapshotSelectedLevel = typeof selectedLevel === 'string' ? selectedLevel : null;
	        snapshotStoryLength = typeof storyLength === 'string' ? storyLength : null;

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
            ? normalizeNarrativeHistoryForPrompt(narrativeHistory)
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
        if (!Array.isArray(combatants) || combatants.length < minParticipants || combatants.length > MAX_COMBATANTS) {
            const errorMessage = `该模式需要 ${minParticipants} 到 ${MAX_COMBATANTS} 位角色`;
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

        const finalUserGuidance = userGuidance?.trim() || null;
        if (finalUserGuidance) {
            inputsToCheck.push({ type: 'userGuidance', content: finalUserGuidance, isNative: false });
        }
        if (resolvedReadNarrativeHistory && narrativeHistoryForPrompt && narrativeHistoryForPrompt.length > 0) {
            const narrativeText = narrativeHistoryForPrompt
                .map((entry) => `# ${entry.title}\n${entry.content}`.trim())
                .join('\n\n');
            if (narrativeText) {
                inputsToCheck.push({ type: 'userGuidance', content: narrativeText, isNative: false });
            }
        }
        if (scenario) {
            const isNative = await verifySignature(scenario);
            inputsToCheck.push({ type: 'scenario', content: JSON.stringify(scenario), isNative });
        }
        combatants.forEach((c: any) => {
            inputsToCheck.push({ type: 'character', content: JSON.stringify(c.data), isNative: c.isNative });
        });

        const policy = appConfig.SAFETY_CHECK_POLICY;
        const contentsToAIFlag = inputsToCheck.filter(input => {
            const checkPolicy = policy[input.type];
            return checkPolicy === 'all' || (checkPolicy === 'non-native-only' && !input.isNative);
        });

        const textForFinalCheck: string[] = [];

        if (contentsToAIFlag.length > 0 && appConfig.ENABLE_BUNDLE_SAFETY_CHECK) {
            log.info('触发"连坐"机制，打包所有非原生内容进行检查。');
            const nonNativeContents = inputsToCheck.filter(i => !i.isNative).map(i => i.content);
            textForFinalCheck.push(...nonNativeContents);
        } else {
            textForFinalCheck.push(...contentsToAIFlag.map(i => i.content));
        }

        const combinedText = textForFinalCheck.join('\n\n');
        const needsWorldviewWarning = false;

	        if (combinedText) {
	            if (appConfig.ENABLE_SENSITIVE_WORD_FILTER && (await quickCheck(combinedText)).hasSensitiveWords) {
	                log.warn('检测到敏感词 (本地过滤)，请求被拒绝', { text: combinedText });

	                const endedAtMs = Date.now();
	                const endedAtIso = new Date(endedAtMs).toISOString();
	                const durationMs = Math.max(0, endedAtMs - startedAtMs);
	                const ip = getClientIpFromHeaders(req.headers);
	                const ipAnonymized = anonymizeIp(ip);
	                const authHeader = req.headers.get('authorization');
	                const authKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

	                const recordPromise = (async () => {
	                    try {
	                        const user = authKey ? await getUserByAuthKey(authKey) : null;
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
	                                : (typeof scenario?.title === 'string' ? scenario.title.trim() : null),
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
	                            extraJson: {
	                                errorMessage: 'rejected by sensitive input filter',
	                                rejectedBy: 'sensitive-input',
	                            },
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

        log.info('📝 构建提示词', { mode, combatantsCount: combatants.length, hasScenario: !!scenario });

        const reporterInfo = getRandomJournalist();
        const streamMeta = {
            reporterInfo,
            userGuidance: finalUserGuidance || undefined,
            adjudicationResults: adjudicationResults || undefined,
        };

        const prompt = createStreamPromptBuilder(
            questionnaire.questions,
            finalUserGuidance,
            finalInternalGuidance,
            needsWorldviewWarning,
            language,
            selectedLevel,
            mode,
            scenario,
            teams,
            resolvedReadArenaHistory,
            resolvedHistoryReadLimit,
            resolvedReadCurrentState,
            resolvedWriteArenaHistory,
            resolvedWriteCurrentState,
            shouldForceStreamMeta,
            adjudicationResults,
            storyLength,
            narrativeHistoryForPrompt,
        )({ combatants });

        const generationConfig: RawGenerationConfig = {
            prompt: `${systemPrompt}\n\n${prompt}`,
            temperature: 0.9,
            maxOutputTokens: 8192,
            modelOverride: customModelOverride,
        };

        const aiTelemetry: NonNullable<GenerateWithAIOptions['telemetry']> = {};
        const aiOptions = providerOptions ? { ...providerOptions, telemetry: aiTelemetry } : { telemetry: aiTelemetry };
        const streamResult = await generateWithStreamAI(generationConfig, aiOptions);
        const streamResponse = streamResult.response;
        const usagePromise = streamResult.usagePromise;
        const resolvedUsagePromise = (async () => normalizeUsage(await usagePromise?.catch(() => null)))();

        log.info('✅ 流式响应已生成，准备返回');

        const headers = new Headers(streamResponse.headers);
        try {
            const encodedMeta = encodeURIComponent(JSON.stringify({
                ...streamMeta,
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
        const authHeader = req.headers.get('authorization');
        const authKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

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
                const user = authKey ? await getUserByAuthKey(authKey) : null;
                const usage = await resolvedUsagePromise;

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

                const recordId = await createBattleReportGenerationRecord({
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
                        : (typeof scenario?.title === 'string' ? scenario.title.trim() : null),
                    scenarioDataCardId: typeof scenarioSourceDataCardId === 'string' ? scenarioSourceDataCardId : null,
                    scenarioDataCardUpdatedAt: typeof scenarioSourceDataCardUpdatedAt === 'string' ? scenarioSourceDataCardUpdatedAt : null,
                    language: typeof language === 'string' ? language : null,
                    selectedLevel: typeof selectedLevel === 'string' ? selectedLevel : null,
                    storyLength: typeof storyLength === 'string' ? storyLength : null,
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
                    }),
                });

                if (recordId && Array.isArray(combatants) && normalizedStatus !== 'failed') {
                    const toBytes = (value: string) => new TextEncoder().encode(value).length;
                    const rows = combatants.map((c: any, index: number) => {
                        const name = c?.data?.codename || c?.data?.name || `未知角色#${index + 1}`;
                        const payload = typeof c?.data === 'object' ? JSON.stringify(c.data) : '';
                        return {
                            generationId: recordId,
                            sortIndex: index,
                            name,
                            type: typeof c?.type === 'string' ? c.type : null,
                            templateId: typeof c?.data?.templateId === 'string' ? c.data.templateId : null,
                            isNative: typeof c?.isNative === 'boolean' ? c.isNative : null,
                            isPreset: typeof c?.isPreset === 'boolean' ? c.isPreset : null,
                            teamId: typeof c?.teamId === 'number' ? c.teamId : null,
                            dataCardId: typeof c?.sourceDataCardId === 'string' ? c.sourceDataCardId : null,
                            dataCardUpdatedAt: typeof c?.sourceDataCardUpdatedAt === 'string' ? c.sourceDataCardUpdatedAt : null,
                            sizeChars: payload ? payload.length : null,
                            sizeBytes: payload ? toBytes(payload) : null,
                        };
                    });
                    const combatantsWrite = await createBattleReportGenerationCombatants(rows);
                    if (!combatantsWrite.ok) {
                        log.warn('战报生成记录：角色明细写入失败', { recordId, errorMessage: combatantsWrite.errorMessage });
                    }
                    await updateBattleReportGenerationCombatantsWriteResult(recordId, {
                        ok: combatantsWrite.ok,
                        expectedRows: rows.length,
                        errorMessage: combatantsWrite.errorMessage ?? null,
                    });

                    if (!combatantsWrite.ok) {
                        await updateBattleReportGenerationExtraJson(
                            recordId,
                            compactExtraJson({
                                errorMessage: normalizeErrorMessage(normalizedErrorMessage),
                                combatantsFallbackReason: 'combatants-table-write-failed',
                                combatantsFallback: buildCombatantsFallbackForExtraJson(combatants),
                            })
                        );
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

        const reader = originalBody.getReader();
        const wrappedBody = new ReadableStream<Uint8Array>({
            async pull(controller) {
                try {
                    const { done, value } = await reader.read();
                    if (done) {
                        appendText(decoder.decode());

                        // 在流式末尾追加一段系统 telemetry 注释，用于前端展示 token 与叙事历史读取条数。
                        const usageForTelemetry = await Promise.race([
                            resolvedUsagePromise,
                            new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
                        ]);
                        const shouldIncludeTelemetry =
                            (usageForTelemetry != null &&
                                (typeof usageForTelemetry.promptTokens === 'number' ||
                                    typeof usageForTelemetry.completionTokens === 'number' ||
                                    typeof usageForTelemetry.reasoningTokens === 'number')) ||
                            typeof narrativeHistoryReadCount === 'number';

                        if (shouldIncludeTelemetry) {
                            const telemetryPayload = {
                                version: 1,
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
                                ...(typeof narrativeHistoryReadCount === 'number'
                                    ? { narrativeHistoryReadCount }
                                    : {}),
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
                    await finalizeOnce('failed', streamError instanceof Error ? streamError.message : 'stream error');
                }
            },
            async cancel(reason) {
                try {
                    await reader.cancel(reason);
                } catch {
                    // 忽略取消时的二次错误
                }
                await finalizeOnce('aborted', reason instanceof Error ? reason.message : String(reason ?? 'aborted'));
            }
        });

        return new Response(wrappedBody, {
            status: streamResponse.status,
            headers,
        });
	    } catch (error) {
	        log.error('生成战斗故事时发生顶层错误', { error });
	        const errorMessage = error instanceof Error ? error.message : '未知错误';

	        const endedAtMs = Date.now();
	        const endedAtIso = new Date(endedAtMs).toISOString();
	        const durationMs = Math.max(0, endedAtMs - startedAtMs);
	        const ip = getClientIpFromHeaders(req.headers);
	        const ipAnonymized = anonymizeIp(ip);
	        const authHeader = req.headers.get('authorization');
	        const authKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

	        const recordPromise = (async () => {
	            try {
	                const user = authKey ? await getUserByAuthKey(authKey) : null;
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
	                    language: snapshotLanguage,
	                    selectedLevel: snapshotSelectedLevel,
	                    storyLength: snapshotStoryLength,
	                    pvpRoomId: snapshotPvpRoomId,
	                    pvpMatchId: snapshotPvpMatchId,
	                    pvpRoundId: snapshotPvpRoundId,
	                    extraJson: {
	                        errorMessage,
	                        stage: 'top-level-catch',
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

	        return new Response(JSON.stringify({ error: '生成失败，请稍后重试', message: errorMessage }), {
	            status: 500,
	        });
	    }
	}

export default handler;
