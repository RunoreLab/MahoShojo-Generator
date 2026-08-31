import { STRICT_RANKED_MODEL_FALLBACKS } from '@mahoshojo/domain/arena-ranked-model-policy';

import type {
  ArenaGenerationAuditableRejection,
  ArenaGenerationExecutor,
  ArenaGenerationObserver,
  ArenaTrustedPvpContext,
} from '@mahoshojo/hosted-api/arena-generation/service';
import {
  buildArenaGenerationPrompt,
  isStrictRankedArenaRequest,
  resolveArenaGenerationOutputContract,
} from './prompt';
import { getSystemPrompt } from './compatibility-prompt';
import { buildArenaStructuredReportSchema } from './structured-report';
import { normalizeNodeArenaMaterials } from './materials';
import {
  evaluateArenaPromptBudget,
  type ArenaHostedFundingMode,
} from '@mahoshojo/hosted-api/arena-generation/resource-budget';
import type { ArenaSeasonContext } from './season-context';
import {
  createArenaInternalGuidanceAuthority,
  createArenaPvpGenerationAuthority,
} from './internal-authority';
import {
  resolveArenaCustomProvider,
  type ResolvedArenaCustomProvider,
} from './custom-provider';
import {
  createArenaGenerationRuntime,
  redactArenaGenerationSemanticPayload,
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
import { parseAIProvidersFromEnv } from '../node-runtime/providers';
import { createNodeRawStreamAiRuntime } from '../node-runtime/raw-stream-ai';
import { createNodeStructuredAiRuntime } from '../node-runtime/structured-ai';
import { quickCheckForServer } from '../node-runtime/sensitive-word-filter';
import { isAiPreDispatchRetrySafe } from '../node-runtime/retry-safety';
import type { SignatureService } from '../signature';
import {
  LoadBalanceStrategy,
  type AiTelemetry,
  type GenerationConfig,
  type GenerateWithAIOptions,
  type RawGenerationConfig,
} from '../node-runtime/types';

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
  pvpSignatureService?: SignatureService;
  generateWithStreamAI?: GenerateWithStreamAI;
  generateWithStructuredAI?(
    _input: unknown,
    _config: unknown,
    _options?: GenerateWithAIOptions,
  ): Promise<unknown>;
  enforceSafety?(_input: NodeArenaSafetyInput): Promise<Response | null>;
  resolveTrustedInternalGuidance?(_input: {
    request: Request;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<string | null>;
  resolveTrustedPvpContext?(_input: {
    request: Request;
    generationRequestId: string;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<ArenaTrustedPvpContext | null>;
  readinessCheck?(): Promise<Response | null>;
  readSeasonContext?(): Promise<ArenaSeasonContext>;
  requireSeasonAuthority?: boolean;
  finalizer(
    _input: ArenaGenerationFinalizationInput,
  ): Promise<ArenaGenerationFinalizationResult>;
  observer?: ArenaGenerationObserver;
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

const arenaRequestAuditContext = (request: Request): {
  endpoint: string;
  deliveryMode: 'stream' | 'non-stream';
} => {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/api/arena/generate') {
    return { endpoint: 'api/arena/generate', deliveryMode: 'non-stream' };
  }
  if (pathname === '/api/generate-battle-story') {
    return { endpoint: 'api/generate-battle-story', deliveryMode: 'non-stream' };
  }
  if (pathname === '/api/arena/session/generate-next') {
    return { endpoint: 'api/arena/session/generate-next', deliveryMode: 'stream' };
  }
  return { endpoint: 'api/arena/generate-stream', deliveryMode: 'stream' };
};

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
  const rawMaterials = Array.isArray(payload.materials) ? payload.materials : [];
  payload.materials = normalizeNodeArenaMaterials(rawMaterials);
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
): ResolvedArenaCustomProvider | Response | null => {
  const resolved = resolveArenaCustomProvider(value);
  return resolved.ok
    ? resolved.value
    : jsonResponse({ code: resolved.code, error: resolved.error }, resolved.status);
};

const normalizeNativeAuthority = async (
  payload: Record<string, unknown>,
  signatures: SignatureService,
): Promise<void> => {
  if (Array.isArray(payload.combatants)) {
    payload.combatants = await Promise.all(payload.combatants.map(async (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const combatant = { ...(value as Record<string, unknown>) };
      const data = combatant.data && typeof combatant.data === 'object' && !Array.isArray(combatant.data)
        ? { ...(combatant.data as Record<string, unknown>) }
        : combatant.data;
      combatant.data = data;
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

type NodeArenaGenerationSemanticAuthorityInput = {
  readonly payload: Record<string, unknown>;
  readonly signatures: SignatureService;
  readonly trustedInternalGuidance: string | null;
  readonly trustedPvpContext: ArenaTrustedPvpContext | null;
};

const applyNodeArenaGenerationSemanticAuthority = async (
  input: NodeArenaGenerationSemanticAuthorityInput,
): Promise<void> => {
  if (input.trustedPvpContext) input.payload.pvpContext = input.trustedPvpContext;
  else delete input.payload.pvpContext;
  await normalizeNativeAuthority(input.payload, input.signatures);
  delete input.payload.internalGuidance;
  if (input.trustedInternalGuidance?.trim()) {
    input.payload.internalGuidance = input.trustedInternalGuidance.trim();
  }
};

export const canonicalizeNodeArenaGenerationSemanticPayload = async (
  input: Readonly<{
    payload: Readonly<Record<string, unknown>>;
    signatures: SignatureService;
    trustedInternalGuidance: string | null;
    trustedPvpContext: ArenaTrustedPvpContext | null;
  }>,
): Promise<Record<string, unknown>> => {
  const normalized = clonePayload(input.payload as Record<string, unknown>);
  normalizeLegacyPayloadDefaults(normalized);
  await applyNodeArenaGenerationSemanticAuthority({
    payload: normalized,
    signatures: input.signatures,
    trustedInternalGuidance: input.trustedInternalGuidance,
    trustedPvpContext: input.trustedPvpContext,
  });
  return redactArenaGenerationSemanticPayload(normalized);
};

const buildSafetyText = async (
  payload: Record<string, unknown>,
  signatures: SignatureService,
  policy: SafetyCheckPolicy,
  enableBundle: boolean,
): Promise<string> => {
  const preserveLegacyNonStreamBounds = resolveArenaGenerationOutputContract(payload)
    === 'structured-report';
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
    const guidance = readString(combatant.characterGuidance).slice(0, 100);
    if (guidance) inputs.push({ type: 'userGuidance', content: guidance, isNative: false });
  }
  const rawUserGuidance = readString(payload.userGuidance);
  const userGuidance = preserveLegacyNonStreamBounds
    ? rawUserGuidance.slice(0, 200)
    : rawUserGuidance;
  if (userGuidance) inputs.push({ type: 'userGuidance', content: userGuidance, isNative: false });
  if (payload.readNarrativeHistory === true && Array.isArray(payload.narrativeHistory)) {
    inputs.push({
      type: 'userGuidance',
      content: serializeForSafety(payload.narrativeHistory),
      isNative: false,
    });
  }
  if (Array.isArray(payload.adjudicationEvents)) {
    inputs.push({
      type: 'userGuidance',
      content: serializeForSafety(payload.adjudicationEvents),
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
  const pvpGenerationAuthority = options.pvpSignatureService
    ? createArenaPvpGenerationAuthority(options.pvpSignatureService)
    : null;
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
  const enableAiSafetyCheck = readBoolean(env, 'NEXT_PUBLIC_ENABLE_AI_SAFETY_CHECK', false);
  const contentSafety = createContentSafetyService({
    defaults: {
      enableSensitiveWordFilter: readBoolean(
        env,
        'NEXT_PUBLIC_ENABLE_SENSITIVE_WORD_FILTER',
        true,
      ),
      enableAiSafetyCheck,
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
    preparePayload: async ({ request, actorKey, generationRequestId, payload }) => {
      const readinessFailure = await options.readinessCheck?.() ?? null;
      if (readinessFailure) return readinessFailure;
      const startedAt = now().toISOString();
      const requestAuditContext = arenaRequestAuditContext(request);
      const trustedGuidance = await (
        options.resolveTrustedInternalGuidance ?? internalGuidanceAuthority.resolve
      )({
        request,
        payload,
      });
      const trustedPvpContext = await (
        options.resolveTrustedPvpContext
        ?? ((input) => pvpGenerationAuthority
          ? pvpGenerationAuthority.resolve({
            request: input.request,
            generationRequestId: input.generationRequestId,
            payload: input.payload,
          })
          : Promise.resolve(null))
      )({ request, generationRequestId, payload });
      const normalized = clonePayload(payload);
      normalizeLegacyPayloadDefaults(normalized);
      const customProviderResolution = resolveArenaCustomProvider(normalized.customProvider);
      if (!customProviderResolution.ok) {
        const response = jsonResponse({
          code: customProviderResolution.code,
          error: customProviderResolution.error,
        }, customProviderResolution.status);
        if (!trustedPvpContext) return response;
        const rejection: ArenaGenerationAuditableRejection = {
          kind: 'auditable-rejection',
          response,
          actorKey,
          generationRequestId,
          code: customProviderResolution.code,
          stage: 'custom-provider-validation',
          fingerprintPayload: redactArenaGenerationSemanticPayload(normalized),
          audit: {
            endpoint: requestAuditContext.endpoint,
            generationMode: requestAuditContext.deliveryMode,
            startedAt,
            mode: typeof normalized.mode === 'string' ? normalized.mode : 'classic',
            pvpContext: trustedPvpContext,
          },
        };
        return rejection;
      }
      if (normalized.pvpContext !== undefined && !trustedPvpContext) {
        return jsonResponse({
          code: 'ARENA_PVP_AUTHORITY_INVALID',
          error: 'PVP generation authority is invalid',
        }, 400);
      }
      await applyNodeArenaGenerationSemanticAuthority({
        payload: normalized,
        signatures,
        trustedInternalGuidance: trustedGuidance,
        trustedPvpContext,
      });
      const season = await options.readSeasonContext?.().catch(() => null) ?? null;
      if (options.requireSeasonAuthority && season?.authorityAvailable !== true) {
        return jsonResponse({
          code: 'ARENA_SEASON_AUTHORITY_UNAVAILABLE',
          error: 'Arena season authority unavailable',
        }, 503);
      }
      const fundingMode: ArenaHostedFundingMode = customProviderResolution.value
        && customProviderResolution.value.provider.id !== 'system'
        ? 'hosted-byok'
        : 'hosted-system';
      normalized.__arenaServerContextV1 = {
        startedAt,
        ipAnonymized: anonymizeIp(requestIp(request)),
        ...requestAuditContext,
        fundingMode,
        ...(trustedPvpContext ? { trustedPvpContext } : {}),
        season,
        scenarioNative: normalized.scenario
          ? await signatures.verifySignature(normalized.scenario)
          : true,
      };
      if (resolveArenaGenerationOutputContract(normalized) === 'structured-report') {
        normalized.userGuidance = readString(normalized.userGuidance).slice(0, 200) || null;
      }
      return normalized;
    },
    checkSafety: async ({ request, actorKey, payload }) => {
      const combinedText = await buildSafetyText(payload, signatures, safetyPolicy, enableBundle);
      if (!combinedText) return null;
      if (enableAiSafetyCheck && !options.enforceSafety) {
        const safetyBudget = evaluateArenaPromptBudget({
          fundingMode: 'hosted-system',
          prompt: combinedText,
        });
        if (!safetyBudget.allowed) {
          return jsonResponse({
            code: 'ARENA_SAFETY_PROMPT_BUDGET_EXCEEDED',
            error: '安全检查输入超过默认渠道允许的估算 token 预算',
            estimatedPromptTokens: safetyBudget.estimatedPromptTokens,
            maxEstimatedPromptTokens: safetyBudget.maxEstimatedPromptTokens,
          }, 413);
        }
      }
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
        ...(customProvider ? {
          generationSettingsContext: {
            providerId: customProvider.providerId,
            ...(customProvider.generationOverrides
              ? { userOverrides: customProvider.generationOverrides }
              : {}),
          },
        } : {}),
      };
      const generationOptions: GenerateWithAIOptions = {
        abortSignal: signal,
        streamReadTimeoutMode: 'hard',
        telemetry,
        onReasoningEvent: (event) => onReasoning(event),
        ...(providerOverride ? { providerOverride } : {}),
        ...(loadBalanceStrategy ? { loadBalanceStrategy } : {}),
        ...(customProvider ? {
          channelContext: {
            providerId: customProvider.providerId,
            modelId: customProvider.modelId,
          },
        } : {}),
      };
      const modelFallbacks: Array<string | undefined> = modelOverride
        ? [modelOverride]
        : isStrictRankedArenaRequest(payload) && !customProvider
          ? [...STRICT_RANKED_MODEL_FALLBACKS]
          : payload.isDowngrade === true && !customProvider
            ? ['gemini-2.5-flash-lite']
            : [undefined];
      if (resolveArenaGenerationOutputContract(payload) === 'structured-report') {
        const mode = readString(payload.mode) || 'classic';
        const combatants = Array.isArray(payload.combatants) ? payload.combatants : [];
        const systemPrompt = getSystemPrompt(mode, combatants);
        const combinedPrefix = `${systemPrompt}\n\n`;
        const taskPrompt = prompt.startsWith(combinedPrefix)
          ? prompt.slice(combinedPrefix.length)
          : prompt;
        const schema = buildArenaStructuredReportSchema({
          enableImpacts: payload.writeArenaHistory === true || payload.writeCurrentState === true,
          enableImpactText: payload.writeArenaHistory === true,
          enableCurrentState: payload.writeCurrentState === true,
        });
        const structuredInput = { combatants };
        const baseStructuredConfig: GenerationConfig<
          Record<string, unknown>,
          typeof structuredInput
        > = {
          systemPrompt,
          temperature: 0.9,
          promptBuilder: () => taskPrompt,
          schema,
          taskName: `生成${mode}模式故事`,
          ...(customProvider ? {
            generationSettingsContext: {
              providerId: customProvider.providerId,
              ...(customProvider.generationOverrides
                ? { userOverrides: customProvider.generationOverrides }
                : {}),
            },
          } : {}),
        };
        let structuredResult: unknown = null;
        let lastStructuredError: unknown = null;
        for (const fallback of modelFallbacks) {
          try {
            const structuredConfig = {
              ...baseStructuredConfig,
              ...(fallback ? { modelOverride: fallback } : {}),
            };
            structuredResult = await (options.generateWithStructuredAI
              ? options.generateWithStructuredAI(
                structuredInput,
                structuredConfig,
                generationOptions,
              )
              : structuredRuntime!.generateWithAI(
                structuredInput,
                structuredConfig,
                generationOptions,
              ));
            break;
          } catch (error) {
            lastStructuredError = error;
            if (signal.aborted) throw error;
            if (!isAiPreDispatchRetrySafe(error)) throw error;
          }
        }
        if (!structuredResult || typeof structuredResult !== 'object') {
          throw lastStructuredError ?? new Error('ARENA_PROVIDER_UNAVAILABLE');
        }
        const validatedStructuredResult = schema.parse(structuredResult);
        const body = new Response(JSON.stringify(validatedStructuredResult)).body;
        if (!body) throw new Error('ARENA_PROVIDER_STRUCTURED_RESULT_MISSING');
        return {
          body,
          telemetry: telemetry as Record<string, unknown>,
        };
      }
      let result: StreamAiResult | null = null;
      let lastError: unknown = null;
      for (const fallback of modelFallbacks) {
        try {
          result = await generateWithStreamAI({
            ...config,
            ...(fallback ? { modelOverride: fallback } : {}),
          }, generationOptions);
          break;
        } catch (error) {
          lastError = error;
          if (signal.aborted) throw error;
          if (!isAiPreDispatchRetrySafe(error)) throw error;
        }
      }
      if (!result) throw lastError ?? new Error('ARENA_PROVIDER_UNAVAILABLE');
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
