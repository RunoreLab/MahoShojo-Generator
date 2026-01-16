import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import type { AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { createBlankDataCard } from '@/lib/data-card-converter';
import { getLogger } from '@/lib/logger';
import { buildMagicTeaPartyChoicesPrompt, buildWorldbookText } from '@/lib/magic-tea-party/prompts';
import { getMagicTeaPartyPreset } from '@/lib/magic-tea-party/presets';
import type { MagicTeaPartyRole, MagicTeaPartyScenario } from '@/lib/magic-tea-party/types';
import { generateWithStreamAI, LoadBalanceStrategy, type GenerateWithAIOptions } from '@/lib/stream/raw-ai';

const log = getLogger('api-magic-tea-party-generate-choices');

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

const RoleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    source: z.string().optional(),
    card: z.record(z.unknown()).default({}),
  })
  .passthrough();

const ScenarioSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    presetId: z.string().optional(),
    source: z.string().optional(),
    card: z.record(z.unknown()).default({}),
  })
  .passthrough();

const SettingsSchema = z
  .object({
    temperature: z.number().min(0).max(1.2).optional(),
    language: z.enum(['zh-CN', 'ja-JP', 'en-US']).optional().default('zh-CN'),
    choiceCount: z.number().int().min(2).max(4).optional().default(3),
    presetId: z.string().optional(),
    worldbookPresetId: z.string().optional(),
    userDisplayName: z.string().optional(),
    readArenaHistory: z.boolean().optional(),
    readArenaHistoryLimit: z.number().int().min(1).max(999).optional(),
    isArenaHistoryUnlimited: z.boolean().optional(),
    readCurrentState: z.boolean().optional(),
  })
  .passthrough();

const RequestBodySchema = z.object({
  sessionId: z.string().min(1),
  messages: z.array(MessageSchema).max(200),
  roles: z.array(RoleSchema).max(20).default([]),
  scenario: ScenarioSchema.nullish(),
  auxScenarios: z.array(ScenarioSchema).max(12).optional().default([]),
  playerRoleId: z.string().nullable().optional().default(null),
  summary: z.string().optional().nullable(),
  settings: SettingsSchema,
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

  const modelConfig = providerConfig.models.find((model) => model.value === modelId);
  if (!modelConfig) return json({ error: '未知的模型 ID' }, { status: 400 });

  const baseUrl = providerConfig.baseUrl?.trim() ?? '';
  if (!baseUrl) return json({ error: '该供应商未配置 baseUrl，无法在 BYOK 模式下使用' }, { status: 400 });

  return {
    providerId,
    providerOverride: {
      name: providerConfig.name,
      apiKey,
      baseUrl,
      model: modelConfig.value,
      type: providerConfig.type,
      mode: providerConfig.mode || 'auto',
      retryCount: 1,
      skipProbability: 0,
    },
  };
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

    const { sessionId, messages, roles, scenario: scenarioInput, auxScenarios, playerRoleId, summary, settings, customProvider } = parsedBody.data;

    const overMessage = messages.find((message) => typeof message.content === 'string' && message.content.length > MAX_MESSAGE_CHARS);
    if (overMessage) {
      return json({ error: `单条消息内容超过 ${MAX_MESSAGE_CHARS} 字，请先精简。` }, { status: 400 });
    }

    const providerOverrideResult = buildProviderOverride(customProvider);
    if (providerOverrideResult instanceof Response) return providerOverrideResult;
    const { providerOverride, providerId } = providerOverrideResult;

    const preset = getMagicTeaPartyPreset(settings.presetId);

    const scenario: MagicTeaPartyScenario | undefined =
      scenarioInput && typeof scenarioInput === 'object'
        ? (scenarioInput as unknown as MagicTeaPartyScenario)
        : preset
          ? {
            id: 'preset-scenario',
            title: preset.defaultScenario.title,
            presetId: preset.id,
            source: 'preset',
            card: {
              ...createBlankDataCard('general-scenario'),
              title: preset.defaultScenario.title,
              content: preset.defaultScenario.content,
            },
          }
          : undefined;

    const normalizedRoles: MagicTeaPartyRole[] = Array.isArray(roles)
      ? (roles as unknown as MagicTeaPartyRole[]).map((role) => ({
        ...role,
        source: (role as any).source || 'cloud',
        card: typeof (role as any).card === 'object' && (role as any).card ? (role as any).card : {},
      }))
      : [];

    const worldbookText = preset ? buildWorldbookText(preset.worldbook) : '';
    const stylePrompt = preset ? preset.systemPrompt : '';

    const prompt = buildMagicTeaPartyChoicesPrompt({
      session: {
        playerRoleId,
        summary: summary ?? undefined,
        settings: {
          providerId,
          modelId: customProvider.modelId.trim(),
          temperature: settings.temperature,
          language: settings.language,
          choiceCount: settings.choiceCount,
          presetId: settings.presetId,
          worldbookPresetId: settings.worldbookPresetId,
          userDisplayName: typeof settings.userDisplayName === 'string' ? settings.userDisplayName.trim().slice(0, 20) : undefined,
          readArenaHistory: settings.readArenaHistory,
          readArenaHistoryLimit: settings.readArenaHistoryLimit,
          isArenaHistoryUnlimited: settings.isArenaHistoryUnlimited,
          readCurrentState: settings.readCurrentState,
        },
      },
      roles: normalizedRoles,
      scenario,
      auxScenarios: auxScenarios as unknown as MagicTeaPartyScenario[],
      worldbookText,
      messages: messages as any,
      stylePrompt,
      choiceCount: settings.choiceCount,
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
        temperature: typeof settings.temperature === 'number' ? settings.temperature : 0.5,
        maxOutputTokens: 1024,
      },
      providerOptions
    );

    return streamResult.response;
  } catch (error) {
    log.error('魔法茶会生成选项失败', { error });
    const message = error instanceof Error ? error.message : '未知错误';
    return json({ error: '生成失败', message }, { status: 500 });
  }
}
