// pages/api/generate-battle-story.ts

import { z } from 'zod/v3';
import { generateWithAI, GenerationConfig, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/ai';
import { getLogger } from '@/lib/logger';
import questionnaire from '@/public/questionnaire.json';
import { getRandomJournalist } from '@/lib/random-choose-journalist';
import { config as appConfig, SafetyCheckPolicy, type AIProvider } from '@/lib/config';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { buildPolicySafetyCheckText } from '@/lib/content-safety/server';
import { NextRequest } from 'next/server';
import { AdjudicationResult, NarrativeHistoryEntry } from '@/types/arena';
import { generateSignature, verifySignature } from '@/lib/signature';
import type { NewsReport } from '@/components/BattleReportCard';
import { getSystemPrompt } from '@/lib/arena/constants';
import { buildBattleReportSchema, CustomProviderSchema } from '@/lib/arena/schemas';
import { createPromptBuilder, processAdjudicationChain } from '@/lib/arena/logic';
import { applyPostBattleUpdates, updateBattleStats } from '@/lib/arena/service';
import {
    createBattleReportGenerationRecord,
    createBattleReportGenerationCombatants,
    generateUUID,
    updateBattleReportGenerationExtraJson,
    updateBattleReportGenerationCombatantsWriteResult,
    updateBattleReportGenerationOutputPreview,
    getUserByAuthKey
} from '@/lib/d1';
import { applyShieldWords } from '@/lib/shield-word-filter';
import {
    anonymizeIp,
    buildCombatantsFallbackForExtraJson,
    buildContentPreview,
    getClientIpFromHeaders,
    compactExtraJson,
    normalizeUsage,
} from '@/lib/arena/battle-report-log-utils';
import { buildOutputPreviewForStorage } from '@/lib/arena/output-preview';
import { settleArenaRatingsForGeneration } from '@/lib/database/arena-ratings';
import { storeBattleReportGenerationOutputTextToR2 } from '@/lib/arena/battle-report-output-storage';
import { buildRankedMatchExtraJson, validateRankedMatchTicketForRequest } from '@/lib/arena/ranked-match';

const log = getLogger('api-gen-battle-story');
const MAX_COMBATANTS = 10;

export const config = {
    runtime: 'edge',
};

interface BattleApiResponse {
    report: NewsReport;
    updatedCombatants: any[];
    adjudicationResults?: AdjudicationResult[];
    generationId?: string;
}

async function handler(req: NextRequest): Promise<Response> {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    const startedAtMs = Date.now();
    const startedAtIso = new Date(startedAtMs).toISOString();

    // 用于在异常/提前返回时补齐 battle_report_generations 记录（避免“失败没有记录”）。
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

	        const body = await req.json();
	        const {
	            combatants,
	            selectedLevel,
            mode = 'classic',
            userGuidance,
            scenario,
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
            isDowngrade = false,
            adjudicationEvents,
            storyLength,
            rankedMatch,
            customProvider: customProviderPayload,
            scenarioTitle,
            scenarioSourceDataCardId,
            scenarioSourceDataCardUpdatedAt,
            pvpContext,
            internalGuidance,
	        } = body;

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
        const isPvpRequest = Boolean(snapshotPvpMatchId && snapshotPvpRoundId);

        const resolvedInternalGuidance = (() => {
            if (!isPvpRequest) return null;
            if (internalGuidance === null || internalGuidance === undefined) return null;
            if (typeof internalGuidance !== 'string') return null;
            const trimmed = internalGuidance.trim();
            if (!trimmed) return null;
            if (trimmed.length > 2000) {
                return trimmed.slice(0, 2000);
            }
            return trimmed;
        })();

        const writeFailedRecordIfNeeded = async (payload: { statusCode: number; message: string; stage: string }): Promise<Response> => {
            if (!isPvpRequest) {
                return new Response(JSON.stringify({ error: payload.message }), { status: payload.statusCode });
            }

            const endedAtMs = Date.now();
            const endedAtIso = new Date(endedAtMs).toISOString();
            const durationMs = Math.max(0, endedAtMs - startedAtMs);
            const ip = getClientIpFromHeaders(req.headers);
            const ipAnonymized = anonymizeIp(ip);
            const authHeader = req.headers.get('authorization');
            const authKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
            const user = authKey ? await getUserByAuthKey(authKey) : null;

            const recordId = await createBattleReportGenerationRecord({
                startedAt: startedAtIso,
                endedAt: endedAtIso,
                durationMs,
                status: 'failed',
                generationMode: 'non-stream',
                endpoint: 'api/generate-battle-story',
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
                combatantCount: Array.isArray(combatants) ? combatants.length : null,
                hasScenario: Boolean(scenario),
                hasUserGuidance: typeof userGuidance === 'string' ? Boolean(userGuidance.trim()) : false,
                hasAdjudicationEvents: Array.isArray(adjudicationEvents) && adjudicationEvents.length > 0,
                hasTeams: Boolean(teams && typeof teams === 'object' && Object.keys(teams).length > 0),
                pvpRoomId: snapshotPvpRoomId,
                pvpMatchId: snapshotPvpMatchId,
                pvpRoundId: snapshotPvpRoundId,
                extraJson: {
                    errorMessage: payload.message,
                    stage: payload.stage,
                },
            });

            return new Response(JSON.stringify({ error: payload.message, generationId: recordId }), { status: payload.statusCode });
        };

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
        const shouldRequestImpacts = resolvedWriteArenaHistory || resolvedWriteCurrentState;
        const battleReportSchema = buildBattleReportSchema({
            enableImpacts: shouldRequestImpacts,
            enableImpactText: resolvedWriteArenaHistory,
            enableCurrentState: resolvedWriteCurrentState
        });

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

        let customProviderOverride: AIProvider | null = null;
        let customProviderId: string | null = null;
        let customModelOverride: string | undefined;
        if (customProviderPayload) {
            const parsedResult = CustomProviderSchema.safeParse(customProviderPayload);
            if (!parsedResult.success) {
                log.warn('自定义 AI 供应商配置校验失败', { providerId: customProviderPayload?.providerId, issues: parsedResult.error.issues });
                return await writeFailedRecordIfNeeded({ statusCode: 400, message: '自定义 AI 供应商配置无效', stage: 'custom-provider-validate' });
            }

            const parsed = parsedResult.data;
            customProviderId = parsed.providerId;
            const providerConfig = AI_PROVIDER_CATALOG.find(item => item.id === parsed.providerId);
            if (!providerConfig) {
                return await writeFailedRecordIfNeeded({ statusCode: 400, message: '未知的模型供应商 ID', stage: 'custom-provider-providerId' });
            }

            const modelConfig = providerConfig.models.find(model => model.value === parsed.modelId);
            if (!modelConfig) {
                return await writeFailedRecordIfNeeded({ statusCode: 400, message: '未知的模型 ID', stage: 'custom-provider-modelId' });
            }

            const sanitizedApiKey = parsed.apiKey.trim();
            if (!sanitizedApiKey && providerConfig.id !== 'system') {
                return await writeFailedRecordIfNeeded({ statusCode: 400, message: 'API Key 不能为空', stage: 'custom-provider-apiKey' });
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
        const providerOptions = (customProviderOverride || shouldDisablePolling)
            ? {
                ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
                ...(shouldDisablePolling ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM } : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
            }
            : undefined;
        const isStrictRankedMatchRequest =
            Boolean(rankedMatch) && typeof rankedMatch === 'object' && (rankedMatch as any).queue === 'strict';
        const shouldPreferLiteModelInStrict =
            isStrictRankedMatchRequest && !customProviderOverride && !shouldDisablePolling && !customModelOverride;
        const baseModelOverride = customModelOverride ?? (isDowngrade ? 'gemini-2.5-flash-lite' : undefined);
        const modelOverrideFallbacks: Array<string | undefined> = shouldPreferLiteModelInStrict
            ? ['gemini-2.5-flash-lite', 'gemini-2.5-flash']
            : [baseModelOverride];

        const minParticipants = (mode === 'daily' || mode === 'scenario') ? 1 : 2;
        if (!Array.isArray(combatants) || combatants.length < minParticipants || combatants.length > MAX_COMBATANTS) {
            const errorMessage = `该模式需要 ${minParticipants} 到 ${MAX_COMBATANTS} 位角色`;
            return await writeFailedRecordIfNeeded({ statusCode: 400, message: errorMessage, stage: 'combatants-count' });
        }

        // 在进行操作之前，先为客户端生成的随机角色补上签名。
        for (const combatant of combatants) {
            // 条件：被标记为原生(`isNative: true`)，但数据中没有 `signature` 字段
            if (combatant.isNative && !combatant.data.signature) {
                log.info(`为客户端生成的原生角色 ${combatant.data.codename || combatant.data.name} 进行补签...`);
                // 生成签名并直接修改 combatant 对象
                combatant.data.signature = await generateSignature(combatant.data);
            }
        }

        // v0.4.0 新增: 在调用AI前执行所有判定
        let adjudicationResults: AdjudicationResult[] | null = null;
        if (adjudicationEvents && Array.isArray(adjudicationEvents) && adjudicationEvents.length > 0) {
            log.info('开始处理随机判定器事件链...');
            adjudicationResults = processAdjudicationChain(adjudicationEvents);
            log.info('判定器事件链处理完成', { results: adjudicationResults });
        }


        // [v0.2.1 更新] 一体化内容安全检查 (SRS 3.1)
        const inputsToCheck: { type: keyof SafetyCheckPolicy, content: string, isNative: boolean }[] = [];

        // 1. 收集所有用户输入及其元数据
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
        if (resolvedInternalGuidance) {
            inputsToCheck.push({ type: 'userGuidance', content: resolvedInternalGuidance, isNative: false });
        }
        if (resolvedReadNarrativeHistory && narrativeHistoryForPrompt && narrativeHistoryForPrompt.length > 0) {
            const narrativeText = narrativeHistoryForPrompt
                .map((entry) => `# ${entry.title}\n${entry.content}`.trim())
                .join('\n\n');
            if (narrativeText) {
                inputsToCheck.push({ type: 'userGuidance', content: narrativeText, isNative: false });
            }
        }
        // 检查情景模式下的情景文件内容
        if (scenario) {
            const isNative = await verifySignature(scenario);
            inputsToCheck.push({ type: 'scenario', content: JSON.stringify(scenario), isNative });
        }
        combatants.forEach((c: any) => {
            inputsToCheck.push({ type: 'character', content: JSON.stringify(c.data), isNative: c.isNative });
        });

	        // 2. 根据策略决定哪些内容需要检查 (SRS 3.1.1)
	        const { combinedText, usedBundle } = buildPolicySafetyCheckText(inputsToCheck, {
	            policy: appConfig.SAFETY_CHECK_POLICY,
	            enableBundle: appConfig.ENABLE_BUNDLE_SAFETY_CHECK,
	        });
	        if (usedBundle) {
	            log.info('触发“连坐”机制，打包所有非原生内容进行检查。');
	        }
	        const needsWorldviewWarning = false;

        // 4. 执行检查
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
                        const recordId = await createBattleReportGenerationRecord({
                            startedAt: startedAtIso,
                            endedAt: endedAtIso,
                            durationMs,
                            status: 'failed',
                            generationMode: 'non-stream',
                            endpoint: 'api/generate-battle-story',
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
	                            pvpRoomId: snapshotPvpRoomId,
	                            pvpMatchId: snapshotPvpMatchId,
	                            pvpRoundId: snapshotPvpRoundId,
	                            extraJson: compactExtraJson({
	                                errorMessage: 'rejected by sensitive input filter',
	                                rejectedBy: 'sensitive-input',
	                                readNarrativeHistory: resolvedReadNarrativeHistory,
	                                narrativeHistoryReadCount: resolvedReadNarrativeHistory ? (narrativeHistoryForPrompt?.length ?? 0) : 0,
	                            }),
	                        });
                        return recordId;
                    } catch (writeError) {
                        log.warn('战报生成记录：写入失败（敏感词拒绝）', { writeError });
                        return null;
                    }
                })();

                const executionContext = (req as any).context;
                const shouldAwait = isPvpRequest || !executionContext?.waitUntil;
                const generationId = shouldAwait ? await recordPromise : null;
                if (!shouldAwait) executionContext.waitUntil(recordPromise);

                return new Response(
                    JSON.stringify({
                        error: '输入内容不合规',
                        shouldRedirect: true,
                        reason: '使用危险符文',
                        ...(generationId ? { generationId } : {}),
                    }),
                    { status: 400 }
                );
            }
        }

        const systemPrompt = getSystemPrompt(mode, combatants);

        type BattleReportResult = z.infer<typeof battleReportSchema>;

        const generationConfig: GenerationConfig<BattleReportResult, any> = {
            systemPrompt,
            temperature: 0.9,
            promptBuilder: createPromptBuilder(
                questionnaire.questions,
                finalUserGuidance,
                resolvedInternalGuidance,
                needsWorldviewWarning,
                language,
                selectedLevel,
                mode,
                scenario,
                null,
                teams,
                teamNames,
                resolvedReadArenaHistory,
                resolvedHistoryReadLimit,
                resolvedReadCurrentState,
                resolvedWriteCurrentState,
                adjudicationResults,
                storyLength,
                narrativeHistoryForPrompt
            ),
            schema: battleReportSchema,
            taskName: `生成${mode}模式故事`,
            maxOutputTokens: 8192,
        };

        const aiTelemetry: NonNullable<GenerateWithAIOptions['telemetry']> = {};
        const aiOptions = providerOptions ? { ...providerOptions, telemetry: aiTelemetry } : { telemetry: aiTelemetry };
        let usedModelOverride: string | undefined;
        let aiResult: BattleReportResult | null = null;
        let lastModelOverrideError: unknown = null;
        for (const modelOverride of modelOverrideFallbacks) {
            try {
                const attemptConfig: GenerationConfig<BattleReportResult, any> = {
                    ...generationConfig,
                    modelOverride,
                };
                aiResult = await generateWithAI<BattleReportResult, { combatants: any[] }>({ combatants }, attemptConfig, aiOptions);
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
        if (!aiResult) {
            throw lastModelOverrideError;
        }
        if (!usedModelOverride && typeof aiTelemetry.model === 'string' && aiTelemetry.model.trim()) {
            usedModelOverride = aiTelemetry.model.trim();
        }
        const usage = normalizeUsage(aiTelemetry.usage);
        const narrativeHistoryReadCount = resolvedReadNarrativeHistory ? (narrativeHistoryForPrompt?.length ?? 0) : undefined;

        // 组合成完整的前端报告对象
        const impactsFromAI = shouldRequestImpacts && Array.isArray((aiResult as any).impacts)
            ? (aiResult as any).impacts
            : [];

        const report: NewsReport = {
            ...(aiResult as Record<string, unknown>),
            reporterInfo: getRandomJournalist(),
            userGuidance: finalUserGuidance || undefined,
            ...(characterGuidancesForReport.length > 0 ? { characterGuidances: characterGuidancesForReport } : {}),
            mode: mode,
        } as NewsReport;

        if (usage) {
            report.aiUsage = usage;
        }
        if (typeof narrativeHistoryReadCount === 'number') {
            report.narrativeHistoryReadCount = narrativeHistoryReadCount;
        }
        if (typeof aiTelemetry.model === 'string' && aiTelemetry.model.trim()) {
            report.aiModel = aiTelemetry.model.trim();
        }

        // 异步更新数据库统计，不阻塞响应
        // 仅在写入历战记录时更新统计，避免污染数据
        if (resolvedWriteArenaHistory && !isPvpRequest) {
            const updateStatsPromise = updateBattleStats(report.officialReport.winner, combatants);
            const executionContext = (req as any).context;
            if (executionContext?.waitUntil) {
                executionContext.waitUntil(updateStatsPromise);
            } else {
                updateStatsPromise.catch(err => log.error('更新战斗统计失败（非阻塞）', err));
            }
        }

        // 更新所有参战者的历战记录
        const updatedCombatants = await applyPostBattleUpdates(
            combatants,
            report,
            impactsFromAI,
            finalUserGuidance,
            scenario,
            { writeArenaHistory: resolvedWriteArenaHistory, writeCurrentState: resolvedWriteCurrentState }
        );

        const recordId = generateUUID();

        const apiResponse: BattleApiResponse = {
            report,
            updatedCombatants,
            adjudicationResults: adjudicationResults || undefined, // v0.4.0 新增
            generationId: recordId,
        };

        const endedAtMs = Date.now();
        const endedAtIso = new Date(endedAtMs).toISOString();
        const durationMs = Math.max(0, endedAtMs - startedAtMs);

        const ip = getClientIpFromHeaders(req.headers);
        const ipAnonymized = anonymizeIp(ip);
        const authHeader = req.headers.get('authorization');
        const authKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

        const reportJson = JSON.stringify(report);
        const outputBytes = new TextEncoder().encode(reportJson).length;
        const outputPreview = buildOutputPreviewForStorage(reportJson);
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

        const recordPromise = (async () => {
            const user = authKey ? await getUserByAuthKey(authKey) : null;
            const rankedMatchValidation = await validateRankedMatchTicketForRequest({
                ticket: rankedMatch,
                userId: user?.id ?? null,
                combatants,
                mode,
                selectedLevel,
                language,
                storyLength,
                nowMs: startedAtMs,
            });
            const rankedMatchExtraJson = buildRankedMatchExtraJson(rankedMatchValidation);

            const createdId = await createBattleReportGenerationRecord({
                id: recordId,
                startedAt: startedAtIso,
                endedAt: endedAtIso,
                durationMs,
                status: 'completed',
                generationMode: 'non-stream',
                endpoint: 'api/generate-battle-story',
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
                customProviderId,
                customModelId: customProviderPayload?.modelId ?? null,
                isDowngrade: Boolean(isDowngrade),
                aiProviderName: aiTelemetry.providerName ?? null,
                aiProviderType: aiTelemetry.providerType ?? null,
                aiModel: aiTelemetry.model ?? null,
                headline: typeof report?.headline === 'string' ? report.headline : null,
                winner: typeof report?.officialReport?.winner === 'string' ? report.officialReport.winner : null,
                outputChars: reportJson.length,
                outputBytes,
                promptTokens: usage?.promptTokens ?? null,
                completionTokens: usage?.completionTokens ?? null,
                totalTokens: usage?.totalTokens ?? null,
                cachedTokens: usage?.cachedTokens ?? null,
                reasoningTokens: usage?.reasoningTokens ?? null,
                outputPreview,
                outputHasSensitiveWords: Boolean((outputSensitive as any)?.hasSensitiveWords),
                outputHasShieldWords: shieldResult.hasShieldWords,
	                pvpRoomId: snapshotPvpRoomId,
	                pvpMatchId: snapshotPvpMatchId,
	                pvpRoundId: snapshotPvpRoundId,
	                extraJson: compactExtraJson({
	                    resolvedModelOverride: usedModelOverride ?? null,
	                    readNarrativeHistory: resolvedReadNarrativeHistory,
	                    narrativeHistoryReadCount: resolvedReadNarrativeHistory ? (narrativeHistoryForPrompt?.length ?? 0) : 0,
                        ...(rankedMatchExtraJson ?? {}),
	                }),
	            });

            if (createdId) {
                const storePromise = (async () => {
                    const stored = await storeBattleReportGenerationOutputTextToR2({
                        generationId: recordId,
                        startedAtIso: startedAtIso,
                        ownerUserId: user?.id ?? null,
                        format: 'json',
                        text: reportJson,
                    });
                    if (stored.ok && !stored.persistPreviewInD1) {
                        await updateBattleReportGenerationOutputPreview(recordId, null);
                    }
                })();

                const executionContext = (req as any).context;
                if (executionContext?.waitUntil) {
                    executionContext.waitUntil(storePromise);
                } else {
                    await storePromise;
                }
            }

            if (createdId && Array.isArray(combatants)) {
                const toBytes = (value: string) => new TextEncoder().encode(value).length;
                const rows = combatants.map((c: any, index: number) => {
                    const name = c?.data?.codename || c?.data?.name || `未知角色#${index + 1}`;
                    const payload = typeof c?.data === 'object' ? JSON.stringify(c.data) : '';
                    const characterGuidance =
                        typeof c?.characterGuidance === 'string' ? c.characterGuidance.trim().slice(0, 100) : '';
                    const isPreset = typeof c?.isPreset === 'boolean' ? c.isPreset : false;
                    const presetFilename = isPreset && typeof c?.filename === 'string' ? c.filename.trim() : '';
                    return {
                        generationId: recordId,
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
                            resolvedModelOverride: usedModelOverride ?? null,
                            combatantsFallbackReason: 'combatants-table-write-failed',
                            combatantsFallback: buildCombatantsFallbackForExtraJson(combatants),
                        })
                    );
                }
            }

            if (createdId) {
                try {
                    const settlePromise = settleArenaRatingsForGeneration(recordId);
                    const executionContext = (req as any).context;
                    if (executionContext?.waitUntil) {
                        executionContext.waitUntil(settlePromise);
                    } else {
                        await settlePromise;
                    }
                } catch (error) {
                    log.warn('排位结算失败（非阻塞）', { recordId, error });
                }
            }

            return createdId;
        })();

        const executionContext = (req as any).context;
        const shouldAwait = isPvpRequest || !executionContext?.waitUntil;
        const generationId = shouldAwait ? await recordPromise : null;
        if (!shouldAwait) executionContext.waitUntil(recordPromise);
        if (generationId) {
            (apiResponse as any).generationId = generationId;
        }

        return new Response(JSON.stringify(apiResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
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
                const recordId = await createBattleReportGenerationRecord({
                    startedAt: startedAtIso,
                    endedAt: endedAtIso,
                    durationMs,
                    status: 'failed',
                    generationMode: 'non-stream',
                    endpoint: 'api/generate-battle-story',
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
                return recordId;
            } catch (writeError) {
                log.warn('战报生成记录：写入失败（顶层错误）', { writeError });
                return null;
            }
        })();

        const executionContext = (req as any).context;
        const shouldAwait = Boolean(snapshotPvpMatchId && snapshotPvpRoundId) || !executionContext?.waitUntil;
        const generationId = shouldAwait ? await recordPromise : null;
        if (!shouldAwait) executionContext.waitUntil(recordPromise);

        return new Response(
            JSON.stringify({
                error: '生成失败',
                message: errorMessage,
                ...(generationId ? { generationId } : {}),
            }),
            {
                status: 500,
            }
        );
    }
}

export default handler;
