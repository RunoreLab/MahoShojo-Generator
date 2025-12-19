// pages/api/generate-battle-story.ts

import { z } from 'zod/v3';
import { generateWithAI, GenerationConfig, LoadBalanceStrategy } from '@/lib/ai';
import { getLogger } from '@/lib/logger';
import questionnaire from '@/public/questionnaire.json';
import { getRandomJournalist } from '@/lib/random-choose-journalist';
import { config as appConfig, SafetyCheckPolicy, type AIProvider } from '@/lib/config';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { NextRequest } from 'next/server';
import { AdjudicationResult } from '@/types/arena';
import { generateSignature, verifySignature } from '@/lib/signature';
import type { NewsReport } from '@/components/BattleReportCard';
import { getSystemPrompt } from '@/lib/arena/constants';
import { buildBattleReportSchema, CustomProviderSchema } from '@/lib/arena/schemas';
import { createPromptBuilder, processAdjudicationChain } from '@/lib/arena/logic';
import { applyPostBattleUpdates, updateBattleStats } from '@/lib/arena/service';

const log = getLogger('api-gen-battle-story');
const MAX_COMBATANTS = 10;

export const config = {
    runtime: 'edge',
};

interface BattleApiResponse {
    report: NewsReport;
    updatedCombatants: any[];
    adjudicationResults?: AdjudicationResult[];
}

async function handler(req: NextRequest): Promise<Response> {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    try {
        const body = await req.json();
        const {
            combatants,
            selectedLevel,
            mode = 'classic',
            userGuidance,
            scenario,
            teams,
            language = 'zh-CN',
            useArenaHistory,
            arenaHistoryReadLimit,
            readArenaHistory,
            writeArenaHistory,
            readCurrentState,
            writeCurrentState,
            isDowngrade = false,
            adjudicationEvents,
            storyLength,
            customProvider: customProviderPayload
        } = body;

        const resolvedReadArenaHistory = typeof readArenaHistory === 'boolean'
            ? readArenaHistory
            : (typeof useArenaHistory === 'boolean' ? useArenaHistory : true);
        const resolvedWriteArenaHistory = typeof writeArenaHistory === 'boolean'
            ? writeArenaHistory
            : (typeof useArenaHistory === 'boolean' ? useArenaHistory : true);
        const resolvedReadCurrentState = typeof readCurrentState === 'boolean' ? readCurrentState : true;
        const resolvedWriteCurrentState = typeof writeCurrentState === 'boolean' ? writeCurrentState : true;
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
        const resolvedModelOverride = customModelOverride ?? (isDowngrade ? "gemini-2.5-flash-lite" : undefined);

        const minParticipants = (mode === 'daily' || mode === 'scenario') ? 1 : 2;
        if (!Array.isArray(combatants) || combatants.length < minParticipants || combatants.length > MAX_COMBATANTS) {
            const errorMessage = `该模式需要 ${minParticipants} 到 ${MAX_COMBATANTS} 位角色`;
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
        const finalUserGuidance = userGuidance?.trim() || null;
        if (finalUserGuidance) {
            inputsToCheck.push({ type: 'userGuidance', content: finalUserGuidance, isNative: false });
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
        const policy = appConfig.SAFETY_CHECK_POLICY;
        const contentsToAIFlag = inputsToCheck.filter(input => {
            const checkPolicy = policy[input.type];
            return checkPolicy === 'all' || (checkPolicy === 'non-native-only' && !input.isNative);
        });

        const textForFinalCheck: string[] = [];

        // 3. 应用“连坐”机制 (SRS 3.1.2)
        if (contentsToAIFlag.length > 0 && appConfig.ENABLE_BUNDLE_SAFETY_CHECK) {
            log.info('触发“连坐”机制，打包所有非原生内容进行检查。');
            const nonNativeContents = inputsToCheck.filter(i => !i.isNative).map(i => i.content);
            textForFinalCheck.push(...nonNativeContents);
        } else {
            textForFinalCheck.push(...contentsToAIFlag.map(i => i.content));
        }

        const combinedText = textForFinalCheck.join('\n\n');
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

        const generationConfig: GenerationConfig<BattleReportResult, any> = {
            systemPrompt,
            temperature: 0.9,
            promptBuilder: createPromptBuilder(
                questionnaire.questions,
                finalUserGuidance,
                needsWorldviewWarning,
                language,
                selectedLevel,
                mode,
                scenario,
                teams,
                resolvedReadArenaHistory,
                resolvedHistoryReadLimit,
                resolvedReadCurrentState,
                resolvedWriteCurrentState,
                adjudicationResults,
                storyLength
            ),
            schema: battleReportSchema,
            taskName: `生成${mode}模式故事`,
            maxOutputTokens: 8192,
            modelOverride: resolvedModelOverride, // 使用轻量模型或自定义覆盖模型
        };

        const aiResult = await generateWithAI<BattleReportResult, { combatants: any[] }>({ combatants }, generationConfig, providerOptions);

        // 组合成完整的前端报告对象
        const impactsFromAI = shouldRequestImpacts && Array.isArray((aiResult as any).impacts)
            ? (aiResult as any).impacts
            : [];

        const report: NewsReport = {
            ...(aiResult as Record<string, unknown>),
            reporterInfo: getRandomJournalist(),
            userGuidance: finalUserGuidance || undefined,
            mode: mode,
        } as NewsReport;

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
            adjudicationResults: adjudicationResults || undefined // v0.4.0 新增
        };

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
