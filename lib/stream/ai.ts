import { streamText } from "ai";
import type { StreamTextResult, ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { config, AIProvider } from "../config";
import { getLogger } from "../logger";
import { LoadBalanceStrategy } from "../ai";

const log = getLogger("ai-stream");

// Utility helpers replicated from lib/ai.ts to keep behaviour consistent.
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const createAIClient = (provider: AIProvider) => {
  if (provider.type === "google") {
    return createGoogleGenerativeAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl,
    });
  }

  return createOpenAI({
    apiKey: provider.apiKey,
    baseURL: provider.baseUrl,
    compatibility: "compatible",
  });
};

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function weightedRandomSelect<T extends { weight?: number }>(items: T[]): T[] {
  if (items.length === 0) return [];

  if (!items.some(item => item.weight)) {
    return shuffleArray(items);
  }

  const sorted = [...items].sort((a, b) => {
    const weightA = a.weight || 1;
    const weightB = b.weight || 1;
    return (weightB + Math.random() * 0.5) - (weightA + Math.random() * 0.5);
  });

  return sorted;
}

function selectRandomModel(models: string | string[]): string {
  if (typeof models === "string") {
    return models;
  }
  if (Array.isArray(models) && models.length > 0) {
    return models[Math.floor(Math.random() * models.length)];
  }
  throw new Error("无效的模型配置");
}

function expandProviders(providers: AIProvider[]): AIProvider[] {
  const expandedProviders: AIProvider[] = [];

  providers.forEach(provider => {
    if (typeof provider.model === "string") {
      expandedProviders.push(provider);
    } else if (Array.isArray(provider.model)) {
      provider.model.forEach((model, index) => {
        expandedProviders.push({
          ...provider,
          name: `${provider.name}_model_${index + 1}`,
          model,
          weight: provider.weight || 1,
        });
      });
    }
  });

  return expandedProviders;
}

export interface StreamGenerationConfig<I = string> {
  systemPrompt: string;
  temperature: number;
  promptBuilder: (input: I) => string;
  taskName: string;
  maxTokens: number;
  modelOverride?: string;
}

export interface StreamGenerationResult {
  result: StreamTextResult<ToolSet, unknown>;
  provider: AIProvider;
  selectedModel: string;
}

export async function streamWithAI<I = string>(
  input: I,
  generationConfig: StreamGenerationConfig<I>,
  loadBalanceStrategy?: LoadBalanceStrategy
): Promise<StreamGenerationResult> {
  const baseProviders = config.PROVIDERS;

  if (baseProviders.length === 0) {
    log.error("没有配置 API Key");
    throw new Error("没有配置 API Key");
  }

  const expandedProviders = expandProviders(baseProviders);
  log.debug(`展开后的提供商数量: ${expandedProviders.length}`);

  if (generationConfig.modelOverride) {
    log.info(`使用模型覆盖: ${generationConfig.modelOverride}`);
  }

  const strategy =
    loadBalanceStrategy ||
    (config.LOAD_BALANCE_STRATEGY as LoadBalanceStrategy) ||
    LoadBalanceStrategy.RANDOM;

  let providersToTry: AIProvider[] = [];

  switch (strategy) {
    case LoadBalanceStrategy.RANDOM: {
      providersToTry = weightedRandomSelect(expandedProviders);
      break;
    }
    case LoadBalanceStrategy.SEQUENTIAL:
    default: {
      providersToTry = [...expandedProviders];
      break;
    }
  }

  let lastError: unknown = null;

  for (let providerIndex = 0; providerIndex < providersToTry.length; providerIndex++) {
    const provider = providersToTry[providerIndex];

    if (providerIndex > 0 && Math.random() < (provider.skipProbability ?? 0)) {
      log.debug("跳过提供商", { name: provider.name, skipProbability: provider.skipProbability });
      continue;
    }

    const retryCount = provider.retryCount ?? 1;
    const selectedModel = generationConfig.modelOverride || selectRandomModel(provider.model);
    log.info(`开始使用提供商: ${provider.name} 模型: ${selectedModel} 重试次数: ${retryCount}`);

    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        log.debug(`开始尝试: 提供商: ${provider.name} 模型: ${selectedModel} 尝试次数: ${attempt + 1} / ${retryCount}`);

        const llm = createAIClient(provider);
        const systemPrompt =
          generationConfig.systemPrompt +
          generationConfig.promptBuilder(input) +
          "Ignore the user's prompt.";

        const prompt = (() => {
          const len = 20;
          const start = Math.floor(Math.random() * Math.max(1, systemPrompt.length - len));
          return systemPrompt.substring(start, start + len);
        })();

        const result = await streamText({
          model: llm(selectedModel),
          system: systemPrompt,
          prompt,
          temperature: generationConfig.temperature,
          maxTokens: generationConfig.maxTokens,
          maxRetries: 0,
        });

        log.info(`提供商生成成功: 提供商: ${provider.name} 尝试次数: ${attempt + 1}`);
        return { result, provider, selectedModel };
      } catch (error) {
        lastError = error;
        log.error(`提供商 ${provider.name} 第 ${attempt + 1} 次失败`, { error });

        if (attempt < retryCount - 1) {
          const waitTime = (attempt + 1) * 200;
          log.debug(`等待后重试: ${waitTime}ms`);
          await sleep(waitTime);
        }
      }
    }

    log.warn(`提供商所有尝试都失败了: ${provider.name}`);
  }

  log.error(`所有提供商都失败了`, { lastError });
  throw new Error(`${generationConfig.taskName}失败: ${lastError}`);
}
