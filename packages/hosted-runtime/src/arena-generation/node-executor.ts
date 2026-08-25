import { z } from 'zod/v3';

import type {
  ArenaGenerationExecutor,
  ArenaGenerationObserver,
} from '@mahoshojo/hosted-api/arena-generation/service';
import { buildArenaGenerationPrompt } from './prompt';
import type { ArenaSeasonContext } from './season-context';
import { createArenaInternalGuidanceAuthority } from './internal-authority';
import {
  createArenaGenerationRuntime,
  type ArenaGenerationFinalizationInput,
  type ArenaGenerationFinalizationResult,
} from './runtime';
import {
  buildPolicySafetyCheckText,
  createContentSafetyService,
  type ContentSafetyDependencies,
  type SafetyCheckPolicy,
} from '../node-runtime/content-safety';
import { createEnvSignatureService } from '../node-runtime/env-signature';
import { silentLogger, type NodeAiLogger } from '../node-runtime/logger';
import { AI_PROVIDER_CATALOG, resolveAIProviderModel } from '../node-runtime/provider-catalog';
import { parseAIProvidersFromEnv } from '../node-runtime/providers';
import { createNodeRawStreamAiRuntime } from '../node-runtime/raw-stream-ai';
import { createNodeStructuredAiRuntime } from '../node-runtime/structured-ai';
import { quickCheckForServer } from '../node-runtime/sensitive-word-filter';
import type { SignatureService } from '../signature';
import {
  LoadBalanceStrategy,
  type AiTelemetry,
  type GenerateWithAIOptions,
  type RawGenerationConfig,
} from '../node-runtime/types';

const MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS = 1_000_000;

const ThinkingSchema = z.union([
  z.object({ mode: z.literal('default') }).strict(),
  z.object({ mode: z.literal('disabled') }).strict(),
  z.object({
    mode: z.literal('enabled'),
    effort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']).optional(),
  }).strict(),
]);

const GenerationOverridesSchema = z.object({
  maxOutputTokens: z.number().int().min(1).max(MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS).optional(),
  temperature: z.number().finite().min(0).optional(),
  thinking: ThinkingSchema.optional(),
}).strict();

const CustomProviderSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
  maxOutputTokens: z.number().int().min(1).max(MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS).optional(),
  generationOverrides: GenerationOverridesSchema.optional(),
}).strict();

type StreamAiResult = {
  response: Response;
  usagePromise?: Promise<unknown>;
  finishReasonPromise?: Promise<unknown>;
  telemetry?: AiTelemetry;
};

type GenerateWithStreamAI = (
  _config: RawGenerationConfig,
  _options?: GenerateWithAIOptions,
) => Promise<StreamAiResult>;

export type NodeArenaSafetyInput = {
  request: Request;
  actorKey: string;
  payload: Record<string, unknown>;
  combinedText: string;
};

export type NodeArenaGenerationExecutorOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  logger?: NodeAiLogger;
  now?: () => Date;
  signatureService?: SignatureService;
  generateWithStreamAI?: GenerateWithStreamAI;
  generateWithStructuredAI?(
    _input: string,
    _config: unknown,
  ): Promise<unknown>;
  enforceSafety?(_input: NodeArenaSafetyInput): Promise<Response | null>;
  resolveTrustedInternalGuidance?(_input: {
    request: Request;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<string | null>;
  readSeasonContext?(): Promise<ArenaSeasonContext>;
  finalizer(
    _input: ArenaGenerationFinalizationInput,
  ): Promise<ArenaGenerationFinalizationResult>;
  observer?: ArenaGenerationObserver;
};

type ParsedCustomProvider = z.infer<typeof CustomProviderSchema> & {
  provider: (typeof AI_PROVIDER_CATALOG)[number];
  modelId: string;
};

const jsonResponse = (payload: unknown, status: number): Response => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  },
);

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
  const raw = env.NEXT_PUBLIC_SAFETY_CHECK_POLICY;
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as Partial<SafetyCheckPolicy>;
    const allowed = new Set(['non-native-only', 'all', 'none']);
    return {
      character: allowed.has(value.character ?? '') ? value.character! : fallback.character,
      scenario: allowed.has(value.scenario ?? '') ? value.scenario! : fallback.scenario,
      userGuidance: allowed.has(value.userGuidance ?? '')
        ? value.userGuidance!
        : fallback.userGuidance,
    };
  } catch {
    return fallback;
  }
};

const clonePayload = (payload: Record<string, unknown>): Record<string, unknown> => (
  structuredClone(payload)
);

const normalizeLegacyPayloadDefaults = (payload: Record<string, unknown>): void => {
  payload.mode = readString(payload.mode) || 'classic';
  payload.language = readString(payload.language) || 'zh-CN';
  const useArenaHistory = typeof payload.useArenaHistory === 'boolean'
    ? payload.useArenaHistory
    : true;
  payload.readArenaHistory = typeof payload.readArenaHistory === 'boolean'
    ? payload.readArenaHistory
    : useArenaHistory;
  payload.writeArenaHistory = typeof payload.writeArenaHistory === 'boolean'
    ? payload.writeArenaHistory
    : useArenaHistory;
  payload.readCurrentState = typeof payload.readCurrentState === 'boolean'
    ? payload.readCurrentState
    : true;
  payload.writeCurrentState = typeof payload.writeCurrentState === 'boolean'
    ? payload.writeCurrentState
    : true;
  payload.readNarrativeHistory = payload.readNarrativeHistory === true;
  payload.arenaFreeRankingEnabled = payload.arenaFreeRankingEnabled === true;

  const normalizeLimit = (value: unknown, fallback: number): number | null => {
    if (value === null) return null;
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(1, Math.floor(value))
      : fallback;
  };
  payload.arenaHistoryReadLimit = payload.readArenaHistory === true
    ? normalizeLimit(payload.arenaHistoryReadLimit, 3)
    : 0;
  payload.narrativeHistoryReadLimit = payload.readNarrativeHistory === true
    ? normalizeLimit(payload.narrativeHistoryReadLimit, 10)
    : 0;

  payload.userGuidance = readString(payload.userGuidance) || null;
  payload.auxScenarios = Array.isArray(payload.auxScenarios)
    ? payload.auxScenarios.filter((value) => value && typeof value === 'object' && !Array.isArray(value))
    : [];
  payload.materials = Array.isArray(payload.materials) ? payload.materials : [];
  payload.questionnaires = Array.isArray(payload.questionnaires)
    ? payload.questionnaires.filter((value) => value && typeof value === 'object' && !Array.isArray(value))
    : [];

  if (payload.readNarrativeHistory === true) {
    const history = Array.isArray(payload.narrativeHistory)
      ? payload.narrativeHistory.flatMap((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
        const entry = value as Record<string, unknown>;
        const content = readString(entry.content);
        if (!content) return [];
        const createdAt = readString(entry.createdAt) || readString(entry['created_at'])
          || new Date(0).toISOString();
        return [{
          ...entry,
          title: readString(entry.title) || '未命名战报',
          content,
          createdAt,
          updatedAt: readString(entry.updatedAt) || readString(entry['updated_at']) || createdAt,
        }];
      }).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      : [];
    const limit = payload.narrativeHistoryReadLimit;
    payload.narrativeHistory = limit === null ? history : history.slice(-Number(limit));
    payload.narrativeHistoryReadCount = (payload.narrativeHistory as unknown[]).length;
  } else {
    payload.narrativeHistory = [];
    payload.narrativeHistoryReadCount = 0;
  }
  payload.questionnaireLoreEnabled = (payload.questionnaires as unknown[]).some((value) => (
    readString((value as Record<string, unknown>).loreMarkdown).length > 0
  ));
  payload.questionnaireLoreIds = (payload.questionnaires as unknown[]).flatMap((value) => {
    const entry = value as Record<string, unknown>;
    return readString(entry.loreMarkdown) && readString(entry.id) ? [readString(entry.id)] : [];
  }).slice(0, 20);
  payload.materialSourceTypes = Array.from(new Set(
    (payload.materials as unknown[]).flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const entry = value as Record<string, unknown>;
      const kind = readString(entry.sourceType) || readString(entry.sourceKind);
      return kind ? [kind] : [];
    }),
  )).slice(0, 10);
};

const serializeForSafety = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
};

const readString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const anonymizeIp = (value: string): string | null => {
  const input = value.split(',', 1)[0]?.trim() ?? '';
  const ipv4 = input.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }
  if (input.includes(':')) {
    const head = (input.toLowerCase().split('::', 1)[0] ?? '')
      .split(':')
      .filter(Boolean)
      .slice(0, 4)
      .join(':');
    return head ? `${head}::` : null;
  }
  return null;
};

const requestIp = (request: Request): string => (
  request.headers.get('cf-connecting-ip')
  ?? request.headers.get('x-forwarded-for')
  ?? request.headers.get('x-real-ip')
  ?? ''
);

const parseCustomProvider = (
  value: unknown,
): ParsedCustomProvider | Response | null => {
  if (value === undefined || value === null) return null;
  const parsed = CustomProviderSchema.safeParse(value);
  if (!parsed.success) {
    return jsonResponse({
      code: 'ARENA_CUSTOM_PROVIDER_INVALID',
      error: '自定义 AI 供应商配置无效',
    }, 400);
  }
  const provider = AI_PROVIDER_CATALOG.find((item) => item.id === parsed.data.providerId);
  if (!provider) {
    return jsonResponse({ code: 'ARENA_PROVIDER_UNKNOWN', error: '未知的模型供应商 ID' }, 400);
  }
  const model = resolveAIProviderModel(provider, parsed.data.modelId);
  if (!model) {
    return jsonResponse({ code: 'ARENA_MODEL_UNKNOWN', error: '未知的模型 ID' }, 400);
  }
  if (provider.id !== 'system' && !parsed.data.apiKey.trim()) {
    return jsonResponse({ code: 'ARENA_PROVIDER_KEY_EMPTY', error: 'API Key 不能为空' }, 400);
  }
  return { ...parsed.data, provider, modelId: model.modelId };
};

const normalizeNativeAuthority = async (
  payload: Record<string, unknown>,
  signatures: SignatureService,
): Promise<void> => {
  if (Array.isArray(payload.combatants)) {
    payload.combatants = await Promise.all(payload.combatants.map(async (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const combatant = { ...(value as Record<string, unknown>) };
      const data = combatant.data;
      combatant.isNative = await signatures.verifySignature(data);
      return combatant;
    }));
  }
  if (Array.isArray(payload.materials)) {
    payload.materials = await Promise.all(payload.materials.map(async (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const material = { ...(value as Record<string, unknown>) };
      material.isNative = await signatures.verifySignature(material.content);
      return material;
    }));
  }
};

const buildSafetyText = async (
  payload: Record<string, unknown>,
  signatures: SignatureService,
  policy: SafetyCheckPolicy,
  enableBundle: boolean,
): Promise<string> => {
  const inputs: Array<{
    type: keyof SafetyCheckPolicy;
    content: string;
    isNative: boolean;
  }> = [];
  for (const raw of Array.isArray(payload.combatants) ? payload.combatants : []) {
    if (!raw || typeof raw !== 'object') continue;
    const combatant = raw as Record<string, unknown>;
    inputs.push({
      type: 'character',
      content: serializeForSafety(combatant.data),
      isNative: combatant.isNative === true,
    });
    const guidance = readString(combatant.characterGuidance);
    if (guidance) inputs.push({ type: 'userGuidance', content: guidance, isNative: false });
  }
  const userGuidance = readString(payload.userGuidance);
  if (userGuidance) inputs.push({ type: 'userGuidance', content: userGuidance, isNative: false });
  if (payload.readNarrativeHistory === true && Array.isArray(payload.narrativeHistory)) {
    inputs.push({
      type: 'userGuidance',
      content: serializeForSafety(payload.narrativeHistory),
      isNative: false,
    });
  }
  if (Array.isArray(payload.questionnaires)) {
    inputs.push({
      type: 'userGuidance',
      content: serializeForSafety(payload.questionnaires),
      isNative: false,
    });
  }
  if (payload.scenario && typeof payload.scenario === 'object') {
    inputs.push({
      type: 'scenario',
      content: serializeForSafety(payload.scenario),
      isNative: await signatures.verifySignature(payload.scenario),
    });
  }
  for (const scenario of Array.isArray(payload.auxScenarios) ? payload.auxScenarios : []) {
    inputs.push({
      type: 'scenario',
      content: serializeForSafety(scenario),
      isNative: await signatures.verifySignature(scenario),
    });
  }
  for (const material of Array.isArray(payload.materials) ? payload.materials : []) {
    if (!material || typeof material !== 'object') continue;
    const record = material as Record<string, unknown>;
    inputs.push({
      type: 'userGuidance',
      content: serializeForSafety(record.content),
      isNative: record.isNative === true,
    });
  }
  return buildPolicySafetyCheckText(inputs, { policy, enableBundle }).combinedText;
};

const wrapTelemetry = (
  body: ReadableStream<Uint8Array>,
  telemetry: Record<string, unknown>,
  usagePromise: Promise<unknown> | undefined,
  finishReasonPromise: Promise<unknown> | undefined,
): ReadableStream<Uint8Array> => {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (!next.done) {
          controller.enqueue(next.value);
          return;
        }
        const [usage, finishReason] = await Promise.all([
          usagePromise?.catch(() => null) ?? null,
          finishReasonPromise?.catch(() => null) ?? null,
        ]);
        if (usage !== null) telemetry.usage = usage;
        if (typeof finishReason === 'string' && finishReason.trim()) {
          telemetry.finishReason = finishReason.trim();
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
};

export const createNodeArenaGenerationExecutor = (
  options: NodeArenaGenerationExecutorOptions,
): ArenaGenerationExecutor => {
  const env = options.env ?? process.env;
  const logger = options.logger ?? silentLogger;
  const signatures = options.signatureService ?? createEnvSignatureService({ env, logger });
  const now = options.now ?? (() => new Date());
  const internalGuidanceAuthority = createArenaInternalGuidanceAuthority(signatures);
  const aiDependencies = {
    providers: parseAIProvidersFromEnv(env),
    loadBalanceStrategy: env.AI_LOAD_BALANCE_STRATEGY || 'random',
    logger,
    fetch: options.fetch ?? globalThis.fetch,
  };
  const rawRuntime = options.generateWithStreamAI
    ? null
    : createNodeRawStreamAiRuntime(aiDependencies);
  const structuredRuntime = options.generateWithStructuredAI
    ? null
    : createNodeStructuredAiRuntime(aiDependencies);
  const generateWithStreamAI = options.generateWithStreamAI
    ?? rawRuntime!.generateWithStreamAI;
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
      await (options.generateWithStructuredAI
        ? options.generateWithStructuredAI(input, config)
        : structuredRuntime!.generateWithAI(input, config))
    ) as T,
  });
  const safetyPolicy = readSafetyPolicy(env);
  const enableBundle = readBoolean(env, 'NEXT_PUBLIC_ENABLE_BUNDLE_SAFETY_CHECK', true);

  return createArenaGenerationRuntime({
    observer: options.observer,
    preparePayload: async ({ request, payload }) => {
      const normalized = clonePayload(payload);
      normalizeLegacyPayloadDefaults(normalized);
      const customProvider = parseCustomProvider(normalized.customProvider);
      if (customProvider instanceof Response) return customProvider;
      await normalizeNativeAuthority(normalized, signatures);
      delete normalized.internalGuidance;
      const trustedGuidance = await (
        options.resolveTrustedInternalGuidance ?? internalGuidanceAuthority.resolve
      )({
        request,
        payload,
      });
      if (trustedGuidance?.trim()) normalized.internalGuidance = trustedGuidance.trim();
      const season = await options.readSeasonContext?.().catch(() => null) ?? null;
      normalized.__arenaServerContextV1 = {
        startedAt: now().toISOString(),
        ipAnonymized: anonymizeIp(requestIp(request)),
        season,
      };
      return normalized;
    },
    checkSafety: async ({ request, actorKey, payload }) => {
      const combinedText = await buildSafetyText(payload, signatures, safetyPolicy, enableBundle);
      if (!combinedText) return null;
      if (options.enforceSafety) {
        return options.enforceSafety({ request, actorKey, payload, combinedText });
      }
      return contentSafety.enforceTextSafety({
        text: combinedText,
        sensitiveWordReason: '使用危险符文',
      });
    },
    buildPrompt: buildArenaGenerationPrompt,
    generate: async ({ payload, prompt, signal, onReasoning }) => {
      const customProvider = parseCustomProvider(payload.customProvider);
      if (customProvider instanceof Response) throw new Error('ARENA_CUSTOM_PROVIDER_INVALID');
      const telemetry: AiTelemetry = {};
      let modelOverride: string | undefined;
      let providerOverride: GenerateWithAIOptions['providerOverride'];
      let loadBalanceStrategy: GenerateWithAIOptions['loadBalanceStrategy'];
      if (customProvider) {
        modelOverride = customProvider.modelId === 'default' ? undefined : customProvider.modelId;
        if (customProvider.provider.baseUrl.trim()) {
          providerOverride = {
            name: customProvider.provider.name,
            apiKey: customProvider.apiKey.trim(),
            baseUrl: customProvider.provider.baseUrl.trim(),
            model: customProvider.modelId,
            type: customProvider.provider.type,
            mode: customProvider.provider.mode ?? 'auto',
            retryCount: 1,
            skipProbability: 0,
            providerId: customProvider.providerId,
            ...(customProvider.maxOutputTokens
              ? { defaultMaxOutputTokens: customProvider.maxOutputTokens }
              : {}),
            ...(customProvider.generationOverrides
              ? { generationOverrides: customProvider.generationOverrides }
              : {}),
          };
        }
        loadBalanceStrategy = customProvider.providerId === 'system'
          ? LoadBalanceStrategy.SEQUENTIAL
          : LoadBalanceStrategy.CUSTOM;
      }
      const config: RawGenerationConfig = {
        prompt,
        temperature: 0.9,
        ...(modelOverride ? { modelOverride } : {}),
        ...(customProvider ? {
          generationSettingsContext: {
            providerId: customProvider.providerId,
            ...(customProvider.generationOverrides
              ? { userOverrides: customProvider.generationOverrides }
              : {}),
          },
        } : {}),
      };
      const result = await generateWithStreamAI(config, {
        abortSignal: signal,
        streamReadTimeoutMode: 'hard',
        telemetry,
        onReasoningEvent: (event) => {
          void onReasoning(event);
        },
        ...(providerOverride ? { providerOverride } : {}),
        ...(loadBalanceStrategy ? { loadBalanceStrategy } : {}),
        ...(customProvider ? {
          channelContext: {
            providerId: customProvider.providerId,
            modelId: customProvider.modelId,
          },
        } : {}),
      });
      if (!result.response.body) throw new Error('ARENA_PROVIDER_STREAM_MISSING');
      return {
        body: wrapTelemetry(
          result.response.body,
          telemetry as Record<string, unknown>,
          result.usagePromise,
          result.finishReasonPromise,
        ),
        telemetry: telemetry as Record<string, unknown>,
      };
    },
    finalize: options.finalizer,
  });
};
