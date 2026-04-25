import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import type { AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { getLogger } from '@/lib/logger';
import { buildMagicTeaPartySummarizePrompt, type MagicTeaPartySummarizeMode } from '@/lib/magic-tea-party/prompts';
import { generateWithStreamAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

const log = getLogger('api-magic-tea-party-summarize');

export const config = {
  runtime: 'edge',
};

const MAX_SAFETY_TEXT_CHARS = 50_000;
const MAX_MESSAGE_CHARS = 8_000;

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string().min(1),
});

const MessageSchema = z
  .object({
    id: z.string().min(1),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })
  .passthrough();

const RequestBodySchema = z.object({
  sessionId: z.string().min(1),
  messages: z.array(MessageSchema).max(200),
  language: z.enum(['zh-CN', 'ja-JP', 'en-US']).optional().default('zh-CN'),
  mode: z.enum(['summary', 'title']).optional().default('summary'),
  userDisplayName: z.string().optional(),
  customProvider: CustomProviderSchema,
});

const json = (payload: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

const buildProviderOverride = (payload: z.infer<typeof CustomProviderSchema>): { providerOverride: AIProvider; providerId: string } | Response => {
  const providerId = payload.providerId.trim();
  const modelId = payload.modelId.trim();
  const apiKey = payload.apiKey.trim();

  if (!apiKey) return json({ error: '缺少 API Key' }, { status: 401 });
  if (providerId === 'system') return json({ error: '魔法茶会仅支持自备 Key（已禁用 system）' }, { status: 403 });

  const providerConfig = AI_PROVIDER_CATALOG.find((item) => item.id === providerId);
  if (!providerConfig) return json({ error: '未知的模型供应商 ID' }, { status: 400 });

  const modelResolution = resolveAIProviderModel(providerConfig, modelId);
  if (!modelResolution) return json({ error: '未知的模型 ID' }, { status: 400 });

  const baseUrl = providerConfig.baseUrl?.trim() ?? '';
  if (!baseUrl) return json({ error: '该供应商未配置 baseUrl，无法在 BYOK 模式下使用' }, { status: 400 });

  return {
    providerId,
    providerOverride: {
      name: providerConfig.name,
      apiKey,
      baseUrl,
      model: modelResolution.modelId,
      type: providerConfig.type,
      mode: providerConfig.mode || 'auto',
      retryCount: 1,
      skipProbability: 0,
    },
  };
};

const normalizeTitle = (raw: string): string => {
  const firstLine = raw.split('\n')[0]?.trim() ?? '';
  return firstLine
    .replace(/[《》"“”'。]/g, '')
    .trim()
    .slice(0, 60);
};

export default async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const parsedBody = RequestBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return json({ error: '请求参数无效' }, { status: 400 });
    }

    const { sessionId, messages, mode, language, userDisplayName, customProvider } = parsedBody.data;

    const overMessage = messages.find((message) => typeof message.content === 'string' && message.content.length > MAX_MESSAGE_CHARS);
    if (overMessage) {
      return json({ error: `单条消息内容超过 ${MAX_MESSAGE_CHARS} 字，请先精简。` }, { status: 400 });
    }

    const providerOverrideResult = buildProviderOverride(customProvider);
    if (providerOverrideResult instanceof Response) return providerOverrideResult;
    const { providerOverride, providerId } = providerOverrideResult;

    const prompt = buildMagicTeaPartySummarizePrompt({
      messages: messages as any,
      mode: mode as MagicTeaPartySummarizeMode,
      language,
      userDisplayName,
    });

    const safetyText = prompt.length > MAX_SAFETY_TEXT_CHARS ? prompt.slice(0, MAX_SAFETY_TEXT_CHARS) : prompt;
    const safetyResponse = await enforceTextSafety({
      text: safetyText,
      log,
      logMeta: { sessionId, providerId, modelId: customProvider.modelId },
      sensitiveWordReason: '使用危险符文',
      aiPromptTemplate: 'free',
      enableAiSafetyCheck: false,
    });
    if (safetyResponse) return safetyResponse;

    const providerOptions: GenerateWithAIOptions = {
      providerOverride,
      loadBalanceStrategy: LoadBalanceStrategy.CUSTOM,
    };

    const streamResult = await generateWithStreamAI(
      {
        prompt,
        temperature: mode === 'title' ? 0.2 : 0.3,
      },
      providerOptions
    );
    recordUserActivityFromRequest(req);

    const text = (await streamResult.response.text()).trim();
    if (!text) {
      return json({ error: '生成失败', message: '模型返回空内容' }, { status: 500 });
    }

    if (mode === 'title') {
      const title = normalizeTitle(text);
      if (!title) return json({ error: '生成失败', message: '标题为空' }, { status: 500 });
      return json({ title });
    }

    return json({ summary: text });
  } catch (error) {
    log.error('魔法茶会摘要生成失败', { error });
    const message = error instanceof Error ? error.message : '未知错误';
    return json({ error: '生成失败', message }, { status: 500 });
  }
}
