// pages/api/generate-battle-story.ts

import { z } from 'zod/v3';
import { generateWithAI, GenerationConfig, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/ai';
import { getLogger } from '@/lib/logger';
import magicalGirlQuestionnaire from '@/public/questionnaires/presets/magical-girl-default.json';
import canshouQuestionnaire from '@/public/questionnaires/presets/canshou-default.json';
import { getRandomJournalist } from '@/lib/random-choose-journalist';
import { config as appConfig, SafetyCheckPolicy, type AIProvider } from '@/lib/config';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { buildPolicySafetyCheckText } from '@/lib/content-safety/server';
import { NextRequest } from 'next/server';
import { AdjudicationResult, NarrativeHistoryEntry } from '@/types/arena';
import { generateSignature, verifySignature } from '@/lib/signature';
import { NewsReport } from '@/components/BattleReportCard';
import { getSystemPrompt } from '@/lib/arena/constants';
import { buildBattleReportSchema, CustomProviderSchema } from '@/lib/arena/schemas';
import { STRICT_RANKED_MODEL_FALLBACKS } from '@/lib/arena/ranked-model-policy';
import { createPromptBuilder, processAdjudicationChain } from '@/lib/arena/logic';
import { applyPostBattleUpdates, updateBattleStats } from '@/lib/arena/service';
import {
    createBattleReportGenerationRecord,
    updateBattleReportGenerationExtraJson,
    updateBattleReportGenerationCombatantsWriteResult,
    updateBattleReportGenerationOutputPreview,
} from '@/lib/database/battle-report-generations';
import { createBattleReportGenerationCombatants } from '@/lib/database/battle-report-generation-combatants';
import { generateUUID } from '@/lib/database/core';
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
import { normalizeCustomStoryLength, resolveEffectiveStoryLength } from '@/lib/story-length';
import { storeBattleReportGenerationOutputTextToR2 } from '@/lib/arena/battle-report-output-storage';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';
import { createRequestAuthUserResolver } from '@/lib/auth/request-auth-user';
import { createBattleReportWriteContext } from '@/lib/arena/battle-report-write-context';

const log = getLogger('api-gen-battle-story');

export const config = {
    runtime: 'edge',
};

interface BattleApiResponse {
    report: NewsReport;
    updatedCombatants: any[];
    adjudicationResults?: AdjudicationResult[];
    impacts?: BattleAiImpact[];
}

type BattleAiImpact = {
    characterName: string;
    impact?: string;
    currentStateSummary?: string;
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
    const battleReportWriteContext = createBattleReportWriteContext({
        requestUrl: req.url,
        authUserResolver,
    });

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
            mode = 'classic',
            arenaFreeRankingEnabled,
            userGuidance,
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
            isDowngrade = false,
            adjudicationEvents,
            storyLength,
            customStoryLength,
            customProvider: customProviderPayload,
            scenarioTitle,
            scenarioFileName,
            scenarioSourceDataCardId,
            scenarioSourceDataCardUpdatedAt,
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
        const providerOptions = (customProviderOverride || shouldDisablePolling)
            ? {
                ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
                ...(shouldDisablePolling ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM } : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
            }
            : undefined;
        const isStrictRankedMatchRequest =
            mode === 'classic'
            && String(language ?? '').trim() === 'zh-CN'
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
        const shouldPreferLiteModelInStrict =
            isStrictRankedMatchRequest && !customProviderOverride && !shouldDisablePolling && !customModelOverride;
        const baseModelOverride = customModelOverride ?? (isDowngrade ? 'gemini-2.5-flash-lite' : undefined);
        const modelOverrideFallbacks: Array<string | undefined> = shouldPreferLiteModelInStrict
            ? [...STRICT_RANKED_MODEL_FALLBACKS]
            : [baseModelOverride];

        const minParticipants = (mode === 'daily' || mode === 'scenario') ? 1 : 2;
        if (!Array.isArray(combatants) || combatants.length < minParticipants) {
            const errorMessage = `该模式至少需要 ${minParticipants} 位角色`;
            return new Response(JSON.stringify({ error: errorMessage }), { status: 400 });
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
        // 检查情景模式下的情景文件内容
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
                return new Response(JSON.stringify({ error: '输入内容不合规', shouldRedirect: true, reason: '使用危险符文' }), { status: 400 });
            }
        }

        const systemPrompt = getSystemPrompt(mode, combatants);

        type BattleReportResult = z.infer<typeof battleReportSchema>;

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

        const generationConfig: GenerationConfig<BattleReportResult, any> = {
            systemPrompt,
            temperature: 0.9,
            promptBuilder: createPromptBuilder(
                fallbackQuestions,
                finalUserGuidance,
                null,
                needsWorldviewWarning,
                language,
                mode,
                scenario,
                normalizedAuxScenarios,
                teams,
                teamNames,
                resolvedReadArenaHistory,
                resolvedHistoryReadLimit,
                resolvedReadCurrentState,
                resolvedWriteCurrentState,
                adjudicationResults,
                storyLength,
                normalizeCustomStoryLength(customStoryLength),
                narrativeHistoryForPrompt,
                loreText,
                includeQuestionnaireAnswersInPrompt
            ),
            schema: battleReportSchema,
            taskName: `生成${mode}模式故事`,
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
        recordUserActivityFromRequest(req);
        if (!usedModelOverride && typeof aiTelemetry.model === 'string' && aiTelemetry.model.trim()) {
            usedModelOverride = aiTelemetry.model.trim();
        }
        const usage = normalizeUsage(aiTelemetry.usage);
        const narrativeHistoryReadCount = resolvedReadNarrativeHistory ? (narrativeHistoryForPrompt?.length ?? 0) : undefined;

        // 组合成完整的前端报告对象
        const impactsFromAI: BattleAiImpact[] = shouldRequestImpacts && Array.isArray((aiResult as any).impacts)
            ? (aiResult as any).impacts
                .map((item: any) => {
                    const characterName = typeof item?.characterName === 'string' ? item.characterName.trim() : '';
                    if (!characterName) return null;
                    const impact = typeof item?.impact === 'string' ? item.impact.trim() : '';
                    const currentStateSummary = typeof item?.currentStateSummary === 'string' ? item.currentStateSummary.trim() : '';
                    return {
                        characterName,
                        ...(impact ? { impact } : {}),
                        ...(currentStateSummary ? { currentStateSummary } : {}),
                    } satisfies BattleAiImpact;
                })
                .filter((item: BattleAiImpact | null): item is BattleAiImpact => Boolean(item))
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
        if (aiTelemetry.reasoning) {
            report.aiReasoning = aiTelemetry.reasoning;
        }

        // 异步更新数据库统计，不阻塞响应
        // 仅在写入历战记录时更新统计，避免污染数据
        if (resolvedWriteArenaHistory) {
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

        const apiResponse: BattleApiResponse = {
            report,
            updatedCombatants,
            adjudicationResults: adjudicationResults || undefined, // v0.4.0 新增
            impacts: impactsFromAI.length > 0 ? impactsFromAI : undefined,
        };

        // 生成成功：异步写入战报生成记录，不阻塞响应
        const endedAtMs = Date.now();
        const endedAtIso = new Date(endedAtMs).toISOString();
        const durationMs = Math.max(0, endedAtMs - startedAtMs);

        const ip = getClientIpFromHeaders(req.headers);
        const ipAnonymized = anonymizeIp(ip);
        const reportJson = JSON.stringify(report);
        const outputBytes = new TextEncoder().encode(reportJson).length;
        const outputPreview = buildOutputPreviewForStorage(reportJson);
        const shieldResult = applyShieldWords(outputPreview);
        const outputSensitive = appConfig.ENABLE_SENSITIVE_WORD_FILTER
            ? await quickCheck(outputPreview)
            : { hasSensitiveWords: false };
        const combatantsFallback = buildCombatantsFallbackForExtraJson(combatants);

        const inputJson = JSON.stringify({
            combatants,
            userGuidance: finalUserGuidance,
            scenario,
            teams,
        });
        const inputBytes = new TextEncoder().encode(inputJson).length;

        const recordPromise = (async () => {
            const user = await battleReportWriteContext.getAuthUser();
            const recordId = generateUUID();
            const [currentSeason, seasonStrictRules] = await Promise.all([
                battleReportWriteContext.getCurrentSeason(),
                battleReportWriteContext.getSeasonStrictRules(),
            ]);

            const normalizedScenarioFileName = (() => {
              if (typeof scenarioFileName !== 'string') return null;
              const trimmed = scenarioFileName.trim();
              if (!trimmed) return null;
              if (trimmed.length > 128) return trimmed.slice(0, 128);
              if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return null;
              return trimmed;
            })();
            const auxScenarioCount = normalizedAuxScenarios ? normalizedAuxScenarios.length : 0;

	            const createdId = await createBattleReportGenerationRecord({
                id: recordId,
                startedAt: startedAtIso,
                endedAt: endedAtIso,
                durationMs,
                status: 'completed',
                generationMode: 'non-stream',
                endpoint: 'api/arena/generate',
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
	                selectedLevel: null,
	                storyLength: resolveEffectiveStoryLength(normalizeOptionalString(storyLength), customStoryLength) ?? null,
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
	                extraJson: compactExtraJson({
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
                        combatantsFallback,
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
                    await settleArenaRatingsForGeneration(recordId);
                } catch (error) {
                    log.warn('排位结算失败（非阻塞）', { recordId, error });
                }
            }
        })();

        const executionContext = (req as any).context;
        if (executionContext?.waitUntil) {
            executionContext.waitUntil(recordPromise);
        } else {
            await recordPromise;
        }

        return new Response(JSON.stringify(apiResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        log.error('生成战斗故事时发生顶层错误', { error });
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        return new Response(JSON.stringify({ error: '生成失败，当前服务器可能正忙，请稍后重试', message: errorMessage }), {
            status: 500,
        });
    }
}

export default handler;
