import {
  buildRepairCombatantMetaSchema,
  createRepairCombatantMetaPrompt,
  precheckArenaBattleReportForRepair,
} from '@mahoshojo/ai-core/arena-repair-meta';
import { ARENA_CANONICAL_CAPABILITIES } from '@mahoshojo/contracts/arena-capabilities';
import {
  evaluateArenaPromptBudget,
  ARENA_RESOURCE_BUDGET,
} from '@mahoshojo/hosted-api/arena-generation/resource-budget';
import {
  buildHostedGenerationErrorPayload,
  readSafePublicAiError,
} from '@mahoshojo/hosted-api/regular-generation';
import { z } from 'zod/v3';

import {
  resolveArenaCustomProvider,
  type ResolvedArenaCustomProvider,
} from '../arena-generation/custom-provider';
import { resolveArenaCombatantNativeAuthority } from '../arena-generation/native-authority';
import {
  buildPolicySafetyCheckText,
  createContentSafetyService,
  type ContentSafetyDependencies,
  type SafetyCheckPolicy,
} from '../node-runtime/content-safety';
import { silentLogger, type NodeAiLogger } from '../node-runtime/logger';
import { parseAIProvidersFromEnv } from '../node-runtime/providers';
import { quickCheckForServer } from '../node-runtime/sensitive-word-filter';
import { createNodeStructuredAiRuntime } from '../node-runtime/structured-ai';
import {
  LoadBalanceStrategy,
  type AIProvider,
  type GenerateWithAIOptions,
  type GenerationConfig,
} from '../node-runtime/types';

type ArenaRepairDraft = {
  impacts: Array<{
    combatantIndex: number;
    characterName: string;
    impact?: string;
    currentStateSummary?: string;
  }>;
};

export type ArenaRepairGenerationProvenance = Readonly<{
  customProviderId: string | null;
  customModelId: string | null;
  aiProviderName: string;
  aiProviderType: AIProvider['type'];
  aiModel: string;
}>;

export type ArenaRepairGenerationProvenanceResult =
  | Readonly<{ kind: 'found'; provenance: ArenaRepairGenerationProvenance }>
  | Readonly<{ kind: 'not-found'; reason: 'row_missing' | 'owner_mismatch' }>
  | Readonly<{
    kind: 'unavailable';
    reason: 'generation_not_completed' | 'finalization_pending' | 'provenance_missing';
  }>;

export type ArenaRepairMetaSafetyInput = Readonly<{
  request: Request;
  actorKey: string;
  combinedText: string;
}>;

type GenerateWithStructuredAI = (
  _input: unknown,
  _config: GenerationConfig<unknown, unknown>,
  _options?: GenerateWithAIOptions,
) => Promise<unknown>;

export type NodeArenaRepairMetaServiceOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  logger?: NodeAiLogger;
  providers?: readonly AIProvider[];
  resolveActor(_request: Request): Promise<{ actorKey: string } | null>;
  readProvenance(_input: {
    generationId: string;
    actorKey: string;
  }): Promise<ArenaRepairGenerationProvenanceResult>;
  verifySignature(_value: unknown): Promise<boolean>;
  enforceSafety?(_input: ArenaRepairMetaSafetyInput): Promise<Response | null>;
  generateWithStructuredAI?: GenerateWithStructuredAI;
  recordActivity?(_request: Request): void;
};

export interface ArenaRepairMetaService {
  generate(_request: Request): Promise<Response>;
}

const combatantSchema = z.object({
  type: z.string().min(1).max(100),
  filename: z.string().max(300).nullish(),
  data: z.record(z.unknown()),
  isNative: z.boolean().optional(),
  isPreset: z.boolean().optional(),
}).passthrough();

const requestSchema = z.object({
  generationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u),
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

const json = (payload: unknown, status: number): Response => new Response(JSON.stringify(payload), {
  status,
  headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  },
});

const rejectInput = (error: string, code = 'ARENA_REPAIR_META_INPUT_INVALID'): Response => (
  json({ code, error }, 400)
);

const readJsonBody = async (request: Request): Promise<unknown | Response> => {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > ARENA_RESOURCE_BUDGET.hardBodyBytes) {
    return json({
      code: 'ARENA_REPAIR_META_BODY_TOO_LARGE',
      error: '请求体过大',
    }, 413);
  }
  try {
    const body = await request.json() as unknown;
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > ARENA_RESOURCE_BUDGET.hardBodyBytes) {
      return json({
        code: 'ARENA_REPAIR_META_BODY_TOO_LARGE',
        error: '请求体过大',
      }, 413);
    }
    return body;
  } catch {
    return rejectInput('请求 JSON 无效');
  }
};

const readBoolean = (
  env: Readonly<Record<string, string | undefined>>,
  key: string,
  fallback: boolean,
): boolean => {
  const value = env[key]?.trim().toLowerCase();
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return fallback;
};

const readSafetyPolicy = (
  env: Readonly<Record<string, string | undefined>>,
): SafetyCheckPolicy => {
  const fallback: SafetyCheckPolicy = {
    character: 'non-native-only',
    scenario: 'non-native-only',
    userGuidance: 'all',
  };
  try {
    const parsed = JSON.parse(env.NEXT_PUBLIC_SAFETY_CHECK_POLICY ?? '') as Partial<SafetyCheckPolicy>;
    const allowed = new Set(['non-native-only', 'all', 'none']);
    return {
      character: allowed.has(parsed.character ?? '') ? parsed.character! : fallback.character,
      scenario: allowed.has(parsed.scenario ?? '') ? parsed.scenario! : fallback.scenario,
      userGuidance: allowed.has(parsed.userGuidance ?? '')
        ? parsed.userGuidance!
        : fallback.userGuidance,
    };
  } catch {
    return fallback;
  }
};

const stringOf = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const providerModels = (provider: AIProvider): readonly string[] => (
  typeof provider.model === 'string' ? [provider.model] : provider.model
);

const findRecordedSystemProvider = (
  providers: readonly AIProvider[],
  provenance: ArenaRepairGenerationProvenance,
): AIProvider | null => {
  for (const provider of providers) {
    const models = providerModels(provider);
    for (let index = 0; index < models.length; index += 1) {
      const model = models[index]!;
      const recordedName = models.length > 1 ? `${provider.name}_model_${index + 1}` : provider.name;
      if (
        recordedName === provenance.aiProviderName
        && provider.type === provenance.aiProviderType
        && model === provenance.aiModel
      ) {
        return {
          ...provider,
          name: recordedName,
          model,
          retryCount: 1,
          skipProbability: 0,
          providerId: 'system',
        };
      }
    }
  }
  return null;
};

type PinnedProvider = Readonly<{
  config: Pick<GenerationConfig<ArenaRepairDraft, null>,
  'modelOverride' | 'generationSettingsContext'>;
  options: GenerateWithAIOptions;
  fundingMode: 'hosted-system' | 'hosted-byok';
}>;

const pinnedProviderFromProvenance = (
  provenance: ArenaRepairGenerationProvenance,
  customProviderPayload: unknown,
  providers: readonly AIProvider[],
): PinnedProvider | Response => {
  const rawCustomProvider = customProviderPayload
    && typeof customProviderPayload === 'object'
    && !Array.isArray(customProviderPayload)
    ? customProviderPayload as Record<string, unknown>
    : null;
  const storedProviderId = provenance.customProviderId;
  const isByok = Boolean(storedProviderId && storedProviderId !== 'system');

  if (isByok) {
    if (
      !rawCustomProvider
      || stringOf(rawCustomProvider.providerId) !== storedProviderId
      || stringOf(rawCustomProvider.modelId) !== provenance.customModelId
    ) {
      return json({
        code: 'ARENA_REPAIR_META_PROVIDER_PROVENANCE_MISMATCH',
        error: '战报生成时的 BYOK Provider 凭据快照已不可用或已变化',
      }, 409);
    }
    const resolved = resolveArenaCustomProvider(customProviderPayload);
    if (!resolved.ok) return rejectInput(resolved.error, resolved.code);
    const provider = resolved.value;
    if (
      !provider
      || provider.providerId !== storedProviderId
      || provider.modelId !== provenance.aiModel
      || provider.provider.name !== provenance.aiProviderName
      || provider.provider.type !== provenance.aiProviderType
    ) {
      return json({
        code: 'ARENA_REPAIR_META_PROVIDER_PROVENANCE_MISMATCH',
        error: '角色修复 Provider 与原战报生成来源不一致',
      }, 409);
    }
    return {
      fundingMode: 'hosted-byok',
      config: {
        modelOverride: provenance.aiModel,
        generationSettingsContext: {
          providerId: provider.providerId,
          ...(provider.generationOverrides
            ? { userOverrides: provider.generationOverrides }
            : {}),
        },
      },
      options: {
        loadBalanceStrategy: LoadBalanceStrategy.CUSTOM,
        providerOverride: {
          name: provenance.aiProviderName,
          apiKey: provider.apiKey.trim(),
          baseUrl: provider.provider.baseUrl.trim(),
          model: provenance.aiModel,
          type: provenance.aiProviderType,
          mode: provider.provider.mode ?? 'auto',
          retryCount: 1,
          skipProbability: 0,
          providerId: provider.providerId,
          ...(provider.maxOutputTokens
            ? { defaultMaxOutputTokens: provider.maxOutputTokens }
            : {}),
          ...(provider.generationOverrides
            ? { generationOverrides: provider.generationOverrides }
            : {}),
        },
        channelContext: {
          providerId: provider.providerId,
          modelId: stringOf(rawCustomProvider.modelId),
        },
      },
    };
  }

  let resolvedSystemSelection: ResolvedArenaCustomProvider | null = null;
  if (storedProviderId === 'system') {
    const resolved = resolveArenaCustomProvider(customProviderPayload);
    if (
      !rawCustomProvider
      || stringOf(rawCustomProvider.providerId) !== 'system'
      || stringOf(rawCustomProvider.modelId) !== provenance.customModelId
      || !resolved.ok
      || !resolved.value
      || resolved.value.providerId !== 'system'
    ) {
      return json({
        code: 'ARENA_REPAIR_META_PROVIDER_PROVENANCE_MISMATCH',
        error: '战报生成时的 system Provider 配置快照已不可用或已变化',
      }, 409);
    }
    resolvedSystemSelection = resolved.value;
  } else if (customProviderPayload !== undefined) {
    return json({
      code: 'ARENA_REPAIR_META_PROVIDER_PROVENANCE_MISMATCH',
      error: '角色修复 Provider 与原战报生成来源不一致',
    }, 409);
  }

  const providerOverride = findRecordedSystemProvider(providers, provenance);
  if (!providerOverride) {
    return json({
      code: 'ARENA_REPAIR_META_PROVIDER_UNAVAILABLE',
      error: '原战报使用的系统 Provider 或模型当前不可用',
    }, 503);
  }
  return {
    fundingMode: 'hosted-system',
    config: {
      modelOverride: provenance.aiModel,
      generationSettingsContext: {
        providerId: 'system',
        ...(resolvedSystemSelection?.generationOverrides
          ? { userOverrides: resolvedSystemSelection.generationOverrides }
          : {}),
      },
    },
    options: {
      loadBalanceStrategy: LoadBalanceStrategy.CUSTOM,
      providerOverride,
      channelContext: {
        providerId: 'system',
        modelId: provenance.aiModel,
      },
    },
  };
};

const provenanceResponse = (result: Exclude<
ArenaRepairGenerationProvenanceResult,
{ kind: 'found' }
>): Response => {
  if (result.kind === 'not-found') {
    return json({
      code: 'ARENA_REPAIR_META_GENERATION_NOT_FOUND',
      error: 'Generation not found',
    }, 404);
  }
  if (result.reason === 'finalization_pending') {
    return json({
      code: 'ARENA_REPAIR_META_FINALIZATION_PENDING',
      error: 'Generation finalization remains pending',
    }, 503);
  }
  return json({
    code: 'ARENA_REPAIR_META_GENERATION_UNAVAILABLE',
    error: result.reason === 'generation_not_completed'
      ? 'Generation is not completed'
      : 'Generation Provider provenance is unavailable',
  }, 409);
};

const providerFailureResponse = (error: unknown): Response => {
  const projection = readSafePublicAiError(error);
  const timeout = projection?.code === 'AI_UPSTREAM_TIMEOUT';
  const payload = buildHostedGenerationErrorPayload(error, '生成角色修复草稿失败');
  return json({
    ...payload,
    code: timeout
      ? 'ARENA_REPAIR_META_PROVIDER_TIMEOUT'
      : 'ARENA_REPAIR_META_PROVIDER_FAILED',
  }, timeout ? 504 : 502);
};

export const createNodeArenaRepairMetaService = (
  options: NodeArenaRepairMetaServiceOptions,
): ArenaRepairMetaService => {
  const env = options.env ?? process.env;
  const logger = options.logger ?? silentLogger;
  const providers = options.providers ?? parseAIProvidersFromEnv(env);
  const structuredRuntime = options.generateWithStructuredAI
    ? null
    : createNodeStructuredAiRuntime({
      providers,
      loadBalanceStrategy: env.AI_LOAD_BALANCE_STRATEGY || 'random',
      logger,
      fetch: options.fetch ?? globalThis.fetch,
    });
  const generateWithStructuredAI = options.generateWithStructuredAI
    ?? structuredRuntime!.generateWithAI;
  const contentSafety = createContentSafetyService({
    defaults: {
      enableSensitiveWordFilter: readBoolean(
        env,
        'NEXT_PUBLIC_ENABLE_SENSITIVE_WORD_FILTER',
        true,
      ),
      enableAiSafetyCheck: readBoolean(env, 'NEXT_PUBLIC_ENABLE_AI_SAFETY_CHECK', false),
    },
    quickCheck: quickCheckForServer,
    generateWithAI: async <T>(
      input: Parameters<ContentSafetyDependencies['generateWithAI']>[0],
      config: Parameters<ContentSafetyDependencies['generateWithAI']>[1],
    ): Promise<T> => (
      await generateWithStructuredAI(
        input,
        config as unknown as GenerationConfig<unknown, unknown>,
      )
    ) as T,
  });
  const safetyPolicy = readSafetyPolicy(env);
  const enableBundle = readBoolean(env, 'NEXT_PUBLIC_ENABLE_BUNDLE_SAFETY_CHECK', true);

  return Object.freeze({
    async generate(request: Request): Promise<Response> {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      const rawBody = await readJsonBody(request);
      if (rawBody instanceof Response) return rawBody;
      const parsed = requestSchema.safeParse(rawBody);
      if (!parsed.success) return rejectInput('角色修复请求格式无效');
      const body = parsed.data;
      if (!body.writeArenaHistory && !body.writeCurrentState) {
        return rejectInput('至少需要选择一个修复字段');
      }
      const reportMarkdown = body.battleReportMarkdown.trim();
      const report = precheckArenaBattleReportForRepair(reportMarkdown, body.mode);
      if (!report.ok) return rejectInput(report.error);

      let actor: { actorKey: string } | null;
      try {
        actor = await options.resolveActor(request);
      } catch {
        return json({
          code: 'ARENA_REPAIR_META_ACTOR_UNAVAILABLE',
          error: 'Arena repair actor unavailable',
        }, 503);
      }
      if (!actor) return json({ code: 'UNAUTHORIZED', error: 'Unauthorized' }, 401);

      let provenanceResult: ArenaRepairGenerationProvenanceResult;
      try {
        provenanceResult = await options.readProvenance({
          generationId: body.generationId,
          actorKey: actor.actorKey,
        });
      } catch {
        return json({
          code: 'ARENA_REPAIR_META_DURABLE_READ_FAILED',
          error: 'Generation Provider provenance read failed',
        }, 503);
      }
      if (provenanceResult.kind !== 'found') return provenanceResponse(provenanceResult);
      const pinnedProvider = pinnedProviderFromProvenance(
        provenanceResult.provenance,
        body.customProvider,
        providers,
      );
      if (pinnedProvider instanceof Response) return pinnedProvider;

      let verifiedCombatants: Array<typeof body.combatants[number] & { isNative: boolean }>;
      try {
        verifiedCombatants = await Promise.all(body.combatants.map(async (combatant) => ({
          ...combatant,
          isNative: await resolveArenaCombatantNativeAuthority(
            combatant,
            options.verifySignature,
          ),
        })));
      } catch {
        return json({
          code: 'ARENA_REPAIR_META_AUTHORITY_UNAVAILABLE',
          error: '角色来源权威验证暂时不可用',
        }, 503);
      }
      const participantNames = verifiedCombatants.map((combatant) => {
        const data = combatant.data;
        return stringOf(data.codename) || stringOf(data.name);
      });
      if (participantNames.some((name) => !name)) return rejectInput('参战角色缺少名称');

      const inputsToCheck: Array<{
        type: keyof SafetyCheckPolicy;
        content: string;
        isNative: boolean;
      }> = [];
      const userGuidance = body.userGuidance?.trim() ?? '';
      if (userGuidance) inputsToCheck.push({
        type: 'userGuidance',
        content: userGuidance,
        isNative: false,
      });
      inputsToCheck.push({
        type: 'userGuidance',
        content: reportMarkdown,
        isNative: false,
      });
      if (body.scenario) {
        let isNativeScenario: boolean;
        try {
          isNativeScenario = await options.verifySignature(body.scenario);
        } catch {
          return json({
            code: 'ARENA_REPAIR_META_AUTHORITY_UNAVAILABLE',
            error: '情景来源权威验证暂时不可用',
          }, 503);
        }
        inputsToCheck.push({
          type: 'scenario',
          content: JSON.stringify(body.scenario),
          isNative: isNativeScenario,
        });
      }
      for (const combatant of verifiedCombatants) inputsToCheck.push({
        type: 'character',
        content: JSON.stringify(combatant.data),
        isNative: combatant.isNative,
      });
      const { combinedText } = buildPolicySafetyCheckText(inputsToCheck, {
        policy: safetyPolicy,
        enableBundle,
      });
      let safetyFailure: Response | null;
      try {
        safetyFailure = options.enforceSafety
          ? await options.enforceSafety({ request, actorKey: actor.actorKey, combinedText })
          : combinedText
            ? await contentSafety.enforceTextSafety({
              text: combinedText,
              sensitiveWordReason: '使用危险符文',
            })
            : null;
      } catch {
        return json({
          code: 'ARENA_REPAIR_META_SAFETY_UNAVAILABLE',
          error: '角色修复内容安全检查暂时不可用',
        }, 503);
      }
      if (safetyFailure) return safetyFailure;

      const schema = buildRepairCombatantMetaSchema({
        combatantNames: participantNames,
        enableImpactText: body.writeArenaHistory,
        enableCurrentState: body.writeCurrentState,
      });
      const prompt = createRepairCombatantMetaPrompt({
        battleReportMarkdown: reportMarkdown,
        combatants: verifiedCombatants.map((combatant, index) => ({
          name: participantNames[index]!,
          type: combatant.type,
          currentState: combatant.data.current_state ?? null,
        })),
        mode: body.mode,
        winner: report.parsed.winner,
        writeArenaHistory: body.writeArenaHistory,
        writeCurrentState: body.writeCurrentState,
      });
      const promptBudget = evaluateArenaPromptBudget({
        fundingMode: pinnedProvider.fundingMode,
        prompt,
      });
      if (!promptBudget.allowed) {
        return json({
          code: 'ARENA_REPAIR_META_PROMPT_BUDGET_EXCEEDED',
          error: '角色修复输入超过当前 Provider 通道预算',
          estimatedPromptTokens: promptBudget.estimatedPromptTokens,
          maxEstimatedPromptTokens: promptBudget.maxEstimatedPromptTokens,
        }, 413);
      }

      let generated: ArenaRepairDraft;
      try {
        generated = await generateWithStructuredAI(null, {
          systemPrompt: '你只生成符合 schema 的 Arena 角色修复草稿 JSON。',
          temperature: 0.4,
          promptBuilder: () => prompt,
          schema,
          taskName: '生成角色元数据修复草稿',
          ...pinnedProvider.config,
        }, pinnedProvider.options) as ArenaRepairDraft;
      } catch (error) {
        logger.error('[arena-repair-meta] provider generation failed');
        return providerFailureResponse(error);
      }
      const validated = schema.safeParse(generated);
      if (!validated.success) {
        return json({
          code: 'ARENA_REPAIR_META_OUTPUT_INVALID',
          error: 'AI 返回的角色修复草稿格式无效',
        }, 502);
      }
      const impacts = [...validated.data.impacts]
        .sort((left, right) => left.combatantIndex - right.combatantIndex);
      try {
        options.recordActivity?.(request);
      } catch {
        // 活动记录不得改变成功响应。
      }
      return json({ success: true, impacts }, 200);
    },
  });
};
