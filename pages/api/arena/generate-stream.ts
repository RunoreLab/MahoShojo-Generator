// pages/api/arena/generate-stream.ts

import { getLogger } from '@/lib/logger';
import questionnaire from '@/public/questionnaire.json';
import { config as appConfig, SafetyCheckPolicy, type AIProvider } from '@/lib/config';
import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { NextRequest } from 'next/server';
import { AdjudicationResult } from '@/types/arena';
import { verifySignature, generateSignature } from '@/lib/signature';
import { getSystemPrompt } from '@/lib/arena/constants';
import { CustomProviderSchema } from '@/lib/arena/schemas';
import { processAdjudicationChain, createStreamPromptBuilder } from '@/lib/arena/logic';
import { generateWithStreamAI, LoadBalanceStrategy, RawGenerationConfig, GenerateWithAIOptions } from '@/lib/stream/raw-ai';
import { getRandomJournalist } from '@/lib/random-choose-journalist';

const log = getLogger('api-gen-battle-stream');
const MAX_COMBATANTS = 10;

export const config = {
    runtime: 'edge',
};

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
            // writeArenaHistory,
            readCurrentState,
            writeCurrentState,
            adjudicationEvents,
            storyLength,
            customProvider: customProviderPayload
        } = body;

        const resolvedReadArenaHistory = typeof readArenaHistory === 'boolean'
            ? readArenaHistory
            : (typeof useArenaHistory === 'boolean' ? useArenaHistory : true);
        // const resolvedWriteArenaHistory = typeof writeArenaHistory === 'boolean'
        //     ? writeArenaHistory
        //     : (typeof useArenaHistory === 'boolean' ? useArenaHistory : true);
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
            storyLength,
        )({ combatants });

        const generationConfig: RawGenerationConfig = {
            prompt: `${systemPrompt}\n\n${prompt}`,
            temperature: 0.9,
            maxOutputTokens: 8192,
            modelOverride: customModelOverride,
        };

        const streamResponse = await generateWithStreamAI(generationConfig, providerOptions);

        log.info('✅ 流式响应已生成，准备返回');

        const headers = new Headers(streamResponse.headers);
        try {
            const encodedMeta = encodeURIComponent(JSON.stringify(streamMeta));
            headers.set('x-mahoshojo-stream-meta', encodedMeta);
        } catch (metaError) {
            log.warn('流式战报元信息写入失败，将继续返回正文流', { metaError });
        }

        return new Response(streamResponse.body, {
            status: streamResponse.status,
            headers,
        });
    } catch (error) {
        log.error('生成战斗故事时发生顶层错误', { error });
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        return new Response(JSON.stringify({ error: '生成失败，请稍后重试', message: errorMessage }), {
            status: 500,
        });
    }
}

export default handler;
