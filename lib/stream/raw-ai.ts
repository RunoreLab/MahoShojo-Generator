import { streamText, NoObjectGeneratedError } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { config, AIProvider } from "../config";
import { getLogger } from "../logger";
import { getProviderFetch } from "@/lib/ai/middleware/provider-fetch";
import { extractUpstreamErrorMessage, enhanceErrorWithUpstreamMessage } from "@/lib/ai/utils/error-extraction";
import { createStreamReadWithTimeout, STREAM_READ_IDLE_TIMEOUT_MS, STREAM_READ_TOTAL_TIMEOUT_MS } from "@/lib/stream/timeout";

// 延迟函数
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const log = getLogger('ai');

// 生成配置接口
export interface RawGenerationConfig {
    prompt: string;
    temperature: number;
    maxOutputTokens?: number;
    modelOverride?: string; // 新增：可选的模型覆盖参数
}

const createAIClient = (provider: AIProvider) => {
    if (provider.type === 'google') {
        return createGoogleGenerativeAI({
            apiKey: provider.apiKey,
            baseURL: provider.baseUrl,
        });
    } else if (provider.type === 'deepseek') {
        return createDeepSeek({
            apiKey: provider.apiKey,
            baseURL: provider.baseUrl,
        });
    }
    else {
        return createOpenAI({
            apiKey: provider.apiKey,
            baseURL: provider.baseUrl,
            fetch: getProviderFetch(provider)
        });
    }
};

/**
 * 随机打乱数组的函数 (Fisher-Yates shuffle)
 */
function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * 根据权重随机选择元素
 */
function weightedRandomSelect<T extends { weight?: number }>(items: T[]): T[] {
    if (items.length === 0) return [];

    // 如果没有权重，返回随机打乱的数组
    if (!items.some(item => item.weight)) {
        return shuffleArray(items);
    }

    const sorted = [...items].sort((a, b) => {
        const weightA = a.weight || 1;
        const weightB = b.weight || 1;
        // 添加随机因子，权重高的更容易被选中，但不是绝对的
        return (weightB + Math.random() * 0.5) - (weightA + Math.random() * 0.5);
    });

    return sorted;
}

/**
 * 从模型数组中随机选择一个模型
 */
function selectRandomModel(models: string | string[]): string {
    if (typeof models === 'string') {
        return models;
    }
    if (Array.isArray(models) && models.length > 0) {
        return models[Math.floor(Math.random() * models.length)];
    }
    throw new Error('无效的模型配置');
}

/**
 * 展开提供商的多模型配置，为每个模型创建单独的提供商实例
 */
function expandProviders(providers: AIProvider[]): AIProvider[] {
    const expandedProviders: AIProvider[] = [];

    providers.forEach(provider => {
        if (typeof provider.model === 'string') {
            // 单个模型，直接添加
            expandedProviders.push(provider);
        } else if (Array.isArray(provider.model)) {
            // 多个模型，为每个模型创建单独的提供商实例
            provider.model.forEach((model, index) => {
                expandedProviders.push({
                    ...provider,
                    name: `${provider.name}_model_${index + 1}`,
                    model,
                    weight: provider.weight || 1
                });
            });
        }
    });

    return expandedProviders;
}

/**
 * 负载均衡策略枚举
 */
export enum LoadBalanceStrategy {
    SEQUENTIAL = 'sequential',  // 顺序执行（原有逻辑）
    RANDOM = 'random',         // 随机选择
    ROUND_ROBIN = 'round_robin', // 轮询（暂时不实现）
    CUSTOM = 'custom'        // 自定义（使用用户自定义模型，不进行轮询）
}

// 全局轮询计数器（用于轮询策略）
let roundRobinCounter = 0;

export type RawReasoningStreamEvent =
    | {
        type: 'reasoning-start';
        id?: string;
    }
    | {
        type: 'reasoning-delta';
        id?: string;
        text: string;
    }
    | {
        type: 'reasoning-end';
        id?: string;
    };

type RawUnifiedStreamChunk =
    | {
        type: 'text-delta';
        id?: string;
        text: string;
    }
    | RawReasoningStreamEvent;

export interface GenerateWithAIOptions {
    loadBalanceStrategy?: LoadBalanceStrategy;
    providerOverride?: AIProvider;
    telemetry?: {
        providerName?: string;
        providerType?: AIProvider['type'];
        providerBaseUrl?: string;
        model?: string;
        providerIndex?: number;
        attempt?: number;
    };
    onReasoningEvent?: (event: RawReasoningStreamEvent) => void;
}

// 通用 AI 生成函数
export async function generateWithStreamAI(
    generationConfig: RawGenerationConfig,
    options?: GenerateWithAIOptions
): Promise<{
    response: Response;
    usagePromise?: Promise<unknown>;
    telemetry?: GenerateWithAIOptions['telemetry'];
}> {
    const baseProviders: AIProvider[] = [
        ...(options?.providerOverride ? [options.providerOverride] : []),
        ...config.PROVIDERS,
    ];

    if (baseProviders.length === 0) {
        log.error("没有配置 API Key");
        throw new Error("没有配置 API Key");
    }

    if (options?.providerOverride) {
        log.info(`优先使用用户自定义提供商: ${options.providerOverride.name}`);
    }

    // 展开多模型配置
    const expandedProviders = expandProviders(baseProviders);

    // 如果有模型覆盖，记录日志
    if (generationConfig.modelOverride) {
        log.info(`使用模型覆盖: ${generationConfig.modelOverride}`);
    }

    // 如果没有指定策略，从配置中读取
    const strategy = options?.loadBalanceStrategy || (config.LOAD_BALANCE_STRATEGY as LoadBalanceStrategy) || LoadBalanceStrategy.RANDOM;

    let lastError: unknown = null;
    let providersToTry: AIProvider[] = [];

    // 根据负载均衡策略决定提供商顺序
    switch (strategy) {
        case LoadBalanceStrategy.RANDOM:
            // 使用权重随机选择
            providersToTry = weightedRandomSelect(expandedProviders);
            log.debug('使用加权随机策略', {
                order: providersToTry.map(p => `${p.name}(${typeof p.model === 'string' ? p.model : 'multi'})`)
            });
            break;

        case LoadBalanceStrategy.ROUND_ROBIN:
            // 轮询选择提供商
            const startIndex = roundRobinCounter % expandedProviders.length;
            providersToTry = [
                ...expandedProviders.slice(startIndex),
                ...expandedProviders.slice(0, startIndex)
            ];
            roundRobinCounter++;
            log.debug('使用轮询策略', {
                startIndex: startIndex + 1,
                order: providersToTry.map(p => `${p.name}(${typeof p.model === 'string' ? p.model : 'multi'})`)
            });
            break;
        case LoadBalanceStrategy.CUSTOM:
            // 自定义策略：优先使用用户自定义模型，不进行轮询
            providersToTry = [expandedProviders[0]];
            log.debug('使用自定义策略', {
                order: providersToTry.map(p => `${p.name}(${typeof p.model === 'string' ? p.model : 'multi'})`)
            });
            break;
        case LoadBalanceStrategy.SEQUENTIAL:
        default:
            // 顺序执行（原有逻辑）
            providersToTry = [...expandedProviders];
            log.debug('使用顺序策略', {
                order: providersToTry.map(p => `${p.name}(${typeof p.model === 'string' ? p.model : 'multi'})`)
            });
            break;
    }

    // 遍历所有提供商
    for (let providerIndex = 0; providerIndex < providersToTry.length; providerIndex++) {
        const provider = providersToTry[providerIndex];

        // 检查是否跳过此提供商（第一个提供商不跳过）
        if (providerIndex > 0 && Math.random() < (provider.skipProbability ?? 0)) {
            log.debug('跳过提供商', { name: provider.name, skipProbability: provider.skipProbability });
            continue;
        }

        const retryCount = provider.retryCount ?? 1;
        // 从可能的多个模型中选择一个，如果有模型覆盖则使用覆盖的模型
        const selectedModel = generationConfig.modelOverride || selectRandomModel(provider.model);
        log.info(`开始使用提供商: ${provider.name} 模型: ${selectedModel} 重试次数: ${retryCount}`);

        // 对当前提供商进行重试
	        for (let attempt = 0; attempt < retryCount; attempt++) {
	            try {
                log.debug(`开始尝试: 提供商: ${provider.name} 模型: ${selectedModel} 尝试次数: ${attempt + 1} / ${retryCount}`);

                if (options?.telemetry) {
                    options.telemetry.providerName = provider.name;
                    options.telemetry.providerType = provider.type;
                    options.telemetry.providerBaseUrl = provider.baseUrl;
                    options.telemetry.model = selectedModel;
                    options.telemetry.providerIndex = providerIndex;
                    options.telemetry.attempt = attempt + 1;
                }

	                const llm = createAIClient(provider);
	                const maxOutputTokensOption =
	                    typeof generationConfig.maxOutputTokens === 'number'
	                        ? { maxOutputTokens: generationConfig.maxOutputTokens }
	                        : {};
	                const shouldEnableGoogleThinking =
	                    provider.type === 'google' && typeof selectedModel === 'string' && /^gemini/i.test(selectedModel.trim());
	                const googleThinkingOptions =
	                    shouldEnableGoogleThinking
	                        ? {
	                            providerOptions: {
	                                google: {
	                                    thinkingConfig: {
	                                        includeThoughts: true,
	                                    },
	                                },
	                            },
	                        }
	                        : {};

		                const looksLikeTrivialEmptyOutput = (text: string) => {
		                    const trimmed = text.trim().replace(/^\uFEFF/, '');
		                    if (!trimmed) return true;
		                    if (trimmed === 'null' || trimmed === 'undefined') return true;
		                    if (/^\{\s*\}$/.test(trimmed)) return true;
		                    if (/^\[\s*\]$/.test(trimmed)) return true;
		                    return false;
		                };

		                const EMPTY_OUTPUT_ERROR_MESSAGE =
		                    'AI 返回空对象/空内容（{} / [] / 空白），未收到有效正文，请重试或切换模型。';

		                // 捕获 onError 回调中的错误，用于后续提取错误信息
		                let capturedError: any = null;

	                const result = streamText({
	                    model: provider.type === 'openai' ? llm.chat(selectedModel) : llm(selectedModel),
                    prompt: [
                        {
                            role: 'user',
                            content: generationConfig.prompt,
                        },
                    ],
                    temperature: generationConfig.temperature,
                    maxRetries: 0,
                    ...maxOutputTokensOption,
                    ...googleThinkingOptions,
                    onError: ({ error }) => {
                        capturedError = error;
                        log.error(`流式传输过程中出错: 提供商: ${provider.name} 模型: ${selectedModel}`, { error });
                    },
	                });

	                const mapToUnifiedChunk = (part: unknown): RawUnifiedStreamChunk | null => {
	                    if (!part || typeof part !== 'object') return null;
	                    const type = (part as any).type;

	                    if (type === 'text-delta') {
	                        const text =
	                            typeof (part as any).text === 'string'
	                                ? (part as any).text
	                                : (typeof (part as any).delta === 'string' ? (part as any).delta : '');
	                        return { type: 'text-delta', id: typeof (part as any).id === 'string' ? (part as any).id : undefined, text };
	                    }
	                    if (type === 'reasoning-start') {
	                        return { type: 'reasoning-start', id: typeof (part as any).id === 'string' ? (part as any).id : undefined };
	                    }
	                    if (type === 'reasoning-delta') {
	                        const text =
	                            typeof (part as any).text === 'string'
	                                ? (part as any).text
	                                : (typeof (part as any).delta === 'string' ? (part as any).delta : '');
	                        return { type: 'reasoning-delta', id: typeof (part as any).id === 'string' ? (part as any).id : undefined, text };
	                    }
	                    if (type === 'reasoning-end') {
	                        return { type: 'reasoning-end', id: typeof (part as any).id === 'string' ? (part as any).id : undefined };
	                    }
	                    return null;
	                };

	                const emitReasoningEvent = (chunk: RawUnifiedStreamChunk) => {
	                    if (chunk.type !== 'reasoning-start' && chunk.type !== 'reasoning-delta' && chunk.type !== 'reasoning-end') {
	                        return;
	                    }
	                    try {
	                        options?.onReasoningEvent?.(chunk);
	                    } catch (reasoningError) {
	                        log.warn('reasoning 回调执行失败（已忽略）', { reasoningError });
	                    }
	                };

	                // 预检流：仅做“连接可用”探测，避免等待正文首字导致流式首屏阻塞。
	                const reader = result.fullStream.getReader();
                const readWithTimeout = createStreamReadWithTimeout({
                    label: `上游流式(${provider.name}/${selectedModel})`,
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
	                const prefetchedChunks: RawUnifiedStreamChunk[] = [];
	                let prefetchedText = '';
	                let prefetchedDone = false;
	                const MAX_PREFETCH_PARTS = 16;

		                for (let i = 0; i < MAX_PREFETCH_PARTS; i++) {
		                    const part = await readWithTimeout(reader);
		                    if (part.done) {
	                        prefetchedDone = true;
	                        break;
	                    }
	                    const mapped = mapToUnifiedChunk(part.value);
	                    if (!mapped) continue;
	                    prefetchedChunks.push(mapped);
	                    if (mapped.type === 'text-delta') {
	                        prefetchedText += mapped.text;
	                    }
	                    // 低延迟优先：拿到首个有效 chunk（文本或 reasoning）后立即交由上层持续消费。
	                    break;
	                }

		                if (prefetchedDone && looksLikeTrivialEmptyOutput(prefetchedText)) {
		                    try {
		                        void reader.cancel('empty-output').catch(() => {});
		                    } catch {
		                        // ignore
		                    }
		                    throw new Error(extractUpstreamErrorMessage(capturedError, result, EMPTY_OUTPUT_ERROR_MESSAGE));
		                }

	                // 创建一个新的 ReadableStream，将已预取 part 与剩余流合并；正文走 text-delta，reasoning 走回调。
	                const combinedStream = new ReadableStream<RawUnifiedStreamChunk>({
                    start(controller) {
                        for (const chunk of prefetchedChunks) {
                            emitReasoningEvent(chunk);
                            controller.enqueue(chunk);
                        }
                    },
                    async pull(controller) {
                        while (true) {
                            const { done, value } = await readWithTimeout(reader);
                            if (done) {
                                controller.close();
                                return;
                            }

                            const mapped = mapToUnifiedChunk(value);
                            if (!mapped) continue;
                            emitReasoningEvent(mapped);
                            controller.enqueue(mapped);
                            return;
                        }
                    },
                    cancel(reason) {
                        try {
                            void reader.cancel(reason).catch(() => {});
                        } catch {
                            // ignore
                        }
                    }
                });

	                const textOnlyStream = combinedStream.pipeThrough(
	                    new TransformStream<RawUnifiedStreamChunk, string>({
	                        transform(chunk, controller) {
	                            if (chunk.type !== 'text-delta') return;
	                            if (!chunk.text) return;
	                            controller.enqueue(chunk.text);
	                        },
	                    })
	                );

                log.info(`提供商生成成功: 提供商: ${provider.name} 尝试次数: ${attempt + 1}`);

                return {
                    response: new Response(textOnlyStream.pipeThrough(new TextEncoderStream()), {
                        headers: {
                            'Content-Type': 'text/plain; charset=utf-8',
                        },
                    }),
                    usagePromise: (result as any).usage,
                    telemetry: options?.telemetry,
                };
            } catch (error) {
                // 使用工具函数增强错误信息
                const enhancedError = enhanceErrorWithUpstreamMessage(error);
                lastError = enhancedError;
                log.error(`提供商 ${provider.name} 第 ${attempt + 1} 次失败`, { error: enhancedError });

                if (NoObjectGeneratedError.isInstance(error)) {
                    log.debug(`NoObjectGeneratedError 详情: 提供商: ${provider.name}`, {
                        cause: error.cause,
                        text: error.text,
                        response: error.response,
                        usage: error.usage,
                        finishReason: error.finishReason
                    });
                }

                // 如果不是最后一次尝试，等待后再重试
                if (attempt < retryCount - 1) {
                    const waitTime = (attempt + 1) * 200; // 递增等待时间
                    log.debug(`等待后重试: ${waitTime}ms`);
                    await sleep(waitTime);
                }
            }
        }

        log.warn(`提供商所有尝试都失败了: ${provider.name}`);
    }

    log.error(`所有提供商都失败了: ${lastError}`);
    throw new Error(`失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
