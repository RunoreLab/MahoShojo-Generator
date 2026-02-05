import { z } from 'zod/v3';
import { NextRequest } from 'next/server';

import { AI_PROVIDER_CATALOG } from '@/lib/ai/constants';
import type { AIProvider } from '@/lib/config';
import { enforceTextSafety } from '@/lib/content-safety/server';
import { getLogger } from '@/lib/logger';
import { buildMagicTeaPartyUpdatePrompt } from '@/lib/magic-tea-party/prompts';
import type { MagicTeaPartyMessage, MagicTeaPartyRole, MagicTeaPartyScenario, MagicTeaPartyUpdateDraft } from '@/lib/magic-tea-party/types';
import { generateWithAI, LoadBalanceStrategy } from '@/lib/ai';
import { applyShieldWords } from '@/lib/shield-word-filter';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

const log = getLogger('api-magic-tea-party-generate-updates');

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
    templateId: z.string().optional(),
    dataCardId: z.string().optional(),
    source: z.string().optional(),
    card: z.record(z.unknown()).default({}),
  })
  .passthrough();

const ChoiceSchema = z
  .object({
    id: z.string().optional(),
    text: z.string().min(1),
  })
  .passthrough();

const SettingsSchema = z.object({
  writeArenaHistory: z.boolean().optional(),
  writeCurrentState: z.boolean().optional(),
  language: z.enum(['zh-CN', 'ja-JP', 'en-US']).optional(),
  userDisplayName: z.string().optional(),
});

const RequestBodySchema = z.object({
  sessionId: z.string().min(1),
  sessionTitle: z.string().optional(),
  messages: z.array(MessageSchema).max(200),
  summary: z.string().optional().nullable(),
  roles: z.array(RoleSchema).max(20).default([]),
  scenario: ScenarioSchema.nullish(),
  auxScenarios: z.array(ScenarioSchema).max(12).optional().default([]),
  lastChoices: z.array(ChoiceSchema).optional(),
  messageRange: z
    .object({
      fromMessageId: z.string().min(1),
      toMessageId: z.string().min(1),
      count: z.number().int().min(1),
    })
    .optional(),
  settings: SettingsSchema,
  customProvider: CustomProviderSchema,
});

const UpdateSchema = z
  .object({
    roleId: z.string().optional(),
    characterName: z.string().min(1),
    impact: z.string().optional(),
    currentStateSummary: z.string().optional(),
    hasWinner: z.boolean().optional(),
    winner: z.string().optional(),
  })
  .passthrough();

const UpdateResponseSchema = z.object({
  updates: z.array(UpdateSchema),
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

const sanitizeText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return applyShieldWords(trimmed).filteredText;
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

    const { sessionId, messages, summary, roles, scenario, auxScenarios, lastChoices, messageRange, settings, customProvider } = parsedBody.data;
    const writeArenaHistory = Boolean(settings.writeArenaHistory);
    const writeCurrentState = Boolean(settings.writeCurrentState);

    if (!writeArenaHistory && !writeCurrentState) {
      return json({ error: '未开启写入开关' }, { status: 400 });
    }

    const overMessage = messages.find((message) => typeof message.content === 'string' && message.content.length > MAX_MESSAGE_CHARS);
    if (overMessage) {
      return json({ error: `单条消息内容超过 ${MAX_MESSAGE_CHARS} 字，请先精简。` }, { status: 400 });
    }

    const providerOverrideResult = buildProviderOverride(customProvider);
    if (providerOverrideResult instanceof Response) return providerOverrideResult;
    const { providerOverride, providerId } = providerOverrideResult;

    const normalizedRoles: MagicTeaPartyRole[] = Array.isArray(roles)
      ? (roles as unknown as MagicTeaPartyRole[]).map((role) => ({
          ...role,
          source: (role as any).source || 'cloud',
          card: typeof (role as any).card === 'object' && (role as any).card ? (role as any).card : {},
        }))
      : [];

    const normalizedScenario: MagicTeaPartyScenario | undefined =
      scenario && typeof scenario === 'object'
        ? ({
            ...scenario,
            source: (scenario as any).source || 'cloud',
            card: typeof (scenario as any).card === 'object' && (scenario as any).card ? (scenario as any).card : {},
          } as MagicTeaPartyScenario)
        : undefined;

    const normalizedAuxScenarios: MagicTeaPartyScenario[] = Array.isArray(auxScenarios)
      ? (auxScenarios as unknown as MagicTeaPartyScenario[]).map((item) => ({
          ...item,
          source: (item as any).source || 'cloud',
          card: typeof (item as any).card === 'object' && (item as any).card ? (item as any).card : {},
        }))
      : [];

    const normalizedLastChoices =
      Array.isArray(lastChoices) && lastChoices.length > 0
        ? lastChoices.map((choice, index) => ({
            id: typeof choice.id === 'string' && choice.id.trim() ? choice.id.trim() : `c${index + 1}`,
            text: typeof choice.text === 'string' ? choice.text : '',
          }))
        : undefined;

    const promptInput = {
      roles: normalizedRoles,
      scenario: normalizedScenario,
      auxScenarios: normalizedAuxScenarios,
      lastChoices: normalizedLastChoices,
      messages: messages as MagicTeaPartyMessage[],
      summary: summary ?? undefined,
      language: settings.language ?? 'zh-CN',
      userDisplayName: settings.userDisplayName,
      writeArenaHistory,
      writeCurrentState,
    };

    const prompt = buildMagicTeaPartyUpdatePrompt(promptInput);

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

    const result = await generateWithAI(promptInput, {
      systemPrompt: '你是魔法茶会的角色更新助手。',
      temperature: 0.2,
      promptBuilder: buildMagicTeaPartyUpdatePrompt,
      schema: UpdateResponseSchema as any,
      taskName: '魔法茶会角色更新',
    }, {
      providerOverride,
      loadBalanceStrategy: LoadBalanceStrategy.CUSTOM,
    });
    recordUserActivityFromRequest(req);

    const updates = Array.isArray((result as any)?.updates) ? (result as any).updates : [];
    const updateList: MagicTeaPartyUpdateDraft[] = normalizedRoles.map((role) => {
      const matched = updates.find((item: any) => item?.roleId === role.id || item?.characterName === role.name);
      const impact = writeArenaHistory ? sanitizeText(matched?.impact) : undefined;
      const currentStateSummary = writeCurrentState ? sanitizeText(matched?.currentStateSummary) : undefined;
      const hasWinner = Boolean(matched?.hasWinner && typeof matched?.winner === 'string' && matched.winner.trim());
      const winner = hasWinner ? sanitizeText(matched?.winner) ?? '不适用' : '不适用';
      return {
        roleId: role.id,
        characterName: role.name,
        ...(writeArenaHistory && impact ? { impact } : {}),
        ...(writeCurrentState && currentStateSummary ? { currentStateSummary } : {}),
        hasWinner,
        winner,
        meta: {
          sessionId,
          ...(messageRange ? { messageRange } : {}),
          generatedAt: Date.now(),
        },
      };
    });

    return json({
      drafts: updateList,
      meta: {
        usedSummary: Boolean(summary && String(summary).trim()),
        ...(messageRange ? { messageRange } : {}),
      },
    });
  } catch (error) {
    log.error('魔法茶会生成更新草案失败', { error });
    const message = error instanceof Error ? error.message : '未知错误';
    return json({ error: '生成失败', message }, { status: 500 });
  }
}
