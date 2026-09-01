import { ARENA_CANONICAL_CAPABILITIES } from '@mahoshojo/contracts/arena-capabilities';
import { ARENA_RESOURCE_BUDGET } from '@mahoshojo/hosted-api/arena-generation/resource-budget';
import { z } from 'zod/v3';
import type { NextRequest } from 'next/server';

import { generateWithAI, LoadBalanceStrategy } from '@/lib/ai';
import type { GenerationConfig } from '@/lib/ai';
import { buildChannelContextFromPayload } from '@/lib/ai/availability';
import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '@/lib/ai/constants';
import { CustomProviderSchema } from '@/lib/arena/schemas';
import {
  buildRepairCombatantMetaSchema,
  createRepairCombatantMetaPrompt,
  precheckBattleReportForRedo,
} from '@/lib/arena/redo-updates';
import { buildPolicySafetyCheckText } from '@/lib/content-safety/server';
import { config as appConfig } from '@/lib/config';
import type { AIProvider, SafetyCheckPolicy } from '@/lib/config';
import { getLogger } from '@/lib/logger';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { verifySignature } from '@/lib/signature';
import { recordUserActivityFromRequest } from '@/lib/user-activity/record';

const log = getLogger('api-arena-repair-combatant-meta');

const combatantSchema = z.object({
  type: z.string().min(1).max(100),
  data: z.record(z.unknown()),
  isNative: z.boolean().optional(),
  isPreset: z.boolean().optional(),
}).passthrough();

const requestSchema = z.object({
  generationId: z.string().min(1).max(128).optional(),
  combatants: z.array(combatantSchema)
    .min(1)
    .max(ARENA_CANONICAL_CAPABILITIES.maxCombatants),
  battleReportMarkdown: z.string().min(1),
  mode: z.enum(['classic', 'kizuna', 'daily', 'scenario']).default('classic'),
  userGuidance: z.string().max(32_768).nullish(),
  scenario: z.record(z.unknown()).nullish(),
  writeArenaHistory: z.boolean().default(true),
  writeCurrentState: z.boolean().default(true),
  customProvider: z.unknown().optional(),
}).strict();

type RepairImpact = {
  combatantIndex: number;
  characterName: string;
  impact?: string;
  currentStateSummary?: string;
};

type RepairDraft = { impacts: RepairImpact[] };

const jsonResponse = (
  body: Record<string, unknown>,
  status: number,
): Response => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  },
});

const rejectInput = (error: string, code = 'ARENA_REPAIR_META_INPUT_INVALID') =>
  jsonResponse({ error, code }, 400);

const getRequestBody = async (req: NextRequest): Promise<unknown> => {
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > ARENA_RESOURCE_BUDGET.hardBodyBytes) {
    throw new Error('ARENA_REPAIR_META_BODY_TOO_LARGE');
  }
  const body: unknown = await req.json();
  const bytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
  if (bytes > ARENA_RESOURCE_BUDGET.hardBodyBytes) {
    throw new Error('ARENA_REPAIR_META_BODY_TOO_LARGE');
  }
  return body;
};

const resolveProviderOptions = (
  customProviderPayload: unknown,
):
  | { ok: false; response: Response }
  | {
    ok: true;
    customModelOverride?: string;
    generationSettingsContext?: {
      providerId: string;
      userOverrides?: z.infer<typeof CustomProviderSchema>['generationOverrides'];
    };
    options: Parameters<typeof generateWithAI>[2];
  } => {
  if (!customProviderPayload) {
    return {
      ok: true,
      options: { channelContext: buildChannelContextFromPayload(undefined) },
    };
  }

  const parsedResult = CustomProviderSchema.safeParse(customProviderPayload);
  if (!parsedResult.success) {
    return { ok: false, response: rejectInput('自定义 AI 供应商配置无效') };
  }

  const parsed = parsedResult.data;
  const providerConfig = AI_PROVIDER_CATALOG.find((item) => item.id === parsed.providerId);
  if (!providerConfig) {
    return { ok: false, response: rejectInput('未知的模型供应商 ID') };
  }
  const modelResolution = resolveAIProviderModel(providerConfig, parsed.modelId);
  if (!modelResolution) {
    return { ok: false, response: rejectInput('未知的模型 ID') };
  }

  const sanitizedApiKey = parsed.apiKey.trim();
  if (!sanitizedApiKey && providerConfig.id !== 'system') {
    return { ok: false, response: rejectInput('API Key 不能为空') };
  }

  let customProviderOverride: AIProvider | null = null;
  let customModelOverride: string | undefined;
  const sanitizedBaseUrl = providerConfig.baseUrl?.trim() ?? '';
  if (!sanitizedBaseUrl) {
    customModelOverride = modelResolution.modelId === 'default'
      ? undefined
      : modelResolution.modelId;
  } else {
    customProviderOverride = {
      name: providerConfig.name,
      apiKey: sanitizedApiKey,
      baseUrl: sanitizedBaseUrl,
      model: modelResolution.modelId,
      type: providerConfig.type,
      mode: providerConfig.mode || 'auto',
      retryCount: 1,
      skipProbability: 0,
      ...(typeof parsed.maxOutputTokens === 'number'
        ? { defaultMaxOutputTokens: parsed.maxOutputTokens }
        : {}),
      providerId: parsed.providerId,
      ...(parsed.generationOverrides
        ? { generationOverrides: parsed.generationOverrides }
        : {}),
    };
  }

  const shouldDisablePolling = parsed.providerId !== 'system';
  return {
    ok: true,
    customModelOverride,
    generationSettingsContext: {
      providerId: parsed.providerId,
      ...(parsed.generationOverrides
        ? { userOverrides: parsed.generationOverrides }
        : {}),
    },
    options: {
      ...(customProviderOverride ? { providerOverride: customProviderOverride } : {}),
      ...(shouldDisablePolling
        ? { loadBalanceStrategy: LoadBalanceStrategy.CUSTOM }
        : { loadBalanceStrategy: LoadBalanceStrategy.SEQUENTIAL }),
      channelContext: buildChannelContextFromPayload(parsed, customModelOverride),
    },
  };
};

async function handler(req: NextRequest): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    let untrustedBody: unknown;
    try {
      untrustedBody = await getRequestBody(req);
    } catch (error) {
      if (error instanceof Error && error.message === 'ARENA_REPAIR_META_BODY_TOO_LARGE') {
        return jsonResponse({
          error: '请求体过大',
          code: 'ARENA_REPAIR_META_BODY_TOO_LARGE',
        }, 413);
      }
      return rejectInput('请求 JSON 无效');
    }

    const parsedBody = requestSchema.safeParse(untrustedBody);
    if (!parsedBody.success) {
      return rejectInput('角色修复请求格式无效');
    }
    const body = parsedBody.data;
    if (!body.writeArenaHistory && !body.writeCurrentState) {
      return rejectInput('至少需要选择一个修复字段');
    }

    const reportMarkdown = body.battleReportMarkdown.trim();
    const reportPrecheck = precheckBattleReportForRedo(reportMarkdown, body.mode);
    if (!reportPrecheck.ok) {
      return rejectInput(reportPrecheck.error);
    }

    const verifiedCombatants = await Promise.all(body.combatants.map(async (combatant) => {
      if (!combatant.isNative) return { ...combatant, isNative: false };
      const isNative = await verifySignature(combatant.data);
      if (!isNative) {
        log.warn('请求中的角色原生声明未通过验签，将按 non-native 输入检查', {
          characterName: combatant.data.codename ?? combatant.data.name,
        });
      }
      return { ...combatant, isNative };
    }));

    const participantNames = verifiedCombatants.map((combatant) => {
      const rawName = combatant.data.codename ?? combatant.data.name;
      return typeof rawName === 'string' ? rawName.trim() : '';
    });
    if (participantNames.some((name) => !name)) {
      return rejectInput('参战角色缺少名称');
    }

    const finalUserGuidance = body.userGuidance?.trim() ?? '';
    const isScenarioNative = body.scenario
      ? await verifySignature(body.scenario)
      : true;
    const inputsToCheck: Array<{
      type: keyof SafetyCheckPolicy;
      content: string;
      isNative: boolean;
    }> = [];
    if (finalUserGuidance) {
      inputsToCheck.push({
        type: 'userGuidance',
        content: finalUserGuidance,
        isNative: false,
      });
    }
    inputsToCheck.push({
      type: 'userGuidance',
      content: reportMarkdown,
      isNative: false,
    });
    if (body.scenario) {
      inputsToCheck.push({
        type: 'scenario',
        content: JSON.stringify(body.scenario),
        isNative: isScenarioNative,
      });
    }
    verifiedCombatants.forEach((combatant) => {
      inputsToCheck.push({
        type: 'character',
        content: JSON.stringify(combatant.data),
        isNative: combatant.isNative,
      });
    });

    const { combinedText } = buildPolicySafetyCheckText(inputsToCheck, {
      policy: appConfig.SAFETY_CHECK_POLICY,
      enableBundle: appConfig.ENABLE_BUNDLE_SAFETY_CHECK,
    });
    if (
      combinedText
      && appConfig.ENABLE_SENSITIVE_WORD_FILTER
      && (await quickCheck(combinedText)).hasSensitiveWords
    ) {
      return jsonResponse({
        error: '输入内容不合规',
        code: 'ARENA_REPAIR_META_CONTENT_REJECTED',
        shouldRedirect: true,
        reason: '使用危险符文',
      }, 400);
    }

    const provider = resolveProviderOptions(body.customProvider);
    if (!provider.ok) return provider.response;

    const schema = buildRepairCombatantMetaSchema({
      combatantNames: participantNames,
      enableImpactText: body.writeArenaHistory,
      enableCurrentState: body.writeCurrentState,
    });
    const generationConfig: GenerationConfig<RepairDraft, null> = {
      systemPrompt: '你只生成符合 schema 的 Arena 角色修复草稿 JSON。',
      temperature: 0.4,
      promptBuilder: () => createRepairCombatantMetaPrompt({
        battleReportMarkdown: reportMarkdown,
        combatants: verifiedCombatants.map((combatant, index) => ({
          name: participantNames[index]!,
          type: combatant.type,
          currentState: combatant.data.current_state ?? null,
        })),
        mode: body.mode,
        winner: reportPrecheck.parsed.winner,
        writeArenaHistory: body.writeArenaHistory,
        writeCurrentState: body.writeCurrentState,
      }),
      schema,
      taskName: '生成角色元数据修复草稿',
      modelOverride: provider.customModelOverride,
      ...(provider.generationSettingsContext
        ? { generationSettingsContext: provider.generationSettingsContext }
        : {}),
    };

    const generated = await generateWithAI<RepairDraft, null>(
      null,
      generationConfig,
      provider.options,
    );
    const validatedOutput = schema.safeParse(generated);
    if (!validatedOutput.success) {
      log.warn('AI 返回的角色修复草稿未通过 roster 对齐校验', {
        issues: validatedOutput.error.issues,
      });
      return jsonResponse({
        error: 'AI 返回的角色修复草稿格式无效',
        code: 'ARENA_REPAIR_META_OUTPUT_INVALID',
      }, 502);
    }

    const impacts = [...validatedOutput.data.impacts]
      .sort((left, right) => left.combatantIndex - right.combatantIndex);
    recordUserActivityFromRequest(req);
    return jsonResponse({ success: true, impacts }, 200);
  } catch (error) {
    log.error('生成 Arena 角色修复草稿失败', { error });
    return jsonResponse({
      error: '生成角色修复草稿失败',
      code: 'ARENA_REPAIR_META_GENERATION_FAILED',
    }, 500);
  }
}

export const appRouteHandler = handler;
export default appRouteHandler;
