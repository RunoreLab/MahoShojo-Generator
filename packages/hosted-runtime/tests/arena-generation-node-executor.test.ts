import { describe, expect, it, vi } from 'vitest';
import { isArenaGenerationAuditableRejection } from '@mahoshojo/hosted-api/arena-generation/service';

import { createArenaGenerationFinalizer } from '../src/arena-generation/finalization';
import {
  canonicalizeNodeArenaGenerationSemanticPayload,
  createNodeArenaGenerationExecutor,
} from '../src/arena-generation/node-executor';
import type { SignatureService } from '../src/signature';

const validPayload = {
  combatants: [
    { type: 'magical-girl', isNative: true, data: { name: 'A' } },
    { type: 'magical-girl', isNative: true, data: { name: 'B', signature: 'valid' } },
  ],
  mode: 'classic',
  internalGuidance: 'browser supplied authority',
};

const finalizer = createArenaGenerationFinalizer({
  storeOutput: vi.fn(async () => ({ resultRef: 'r2://test/output' })),
  claimTerminal: vi.fn(async () => ({
    kind: 'created' as const,
    resultRef: 'r2://test/output',
    finalized: false,
  })),
  completeTerminal: vi.fn(async () => undefined),
  failTerminal: vi.fn(async () => undefined),
  persistCombatants: vi.fn(async () => undefined),
  applyStoryImpacts: vi.fn(async () => undefined),
  settleRatings: vi.fn(async () => undefined),
  readRanking: vi.fn(async () => null),
});

const signatureService: SignatureService = {
  generateSignature: vi.fn(async () => 'generated'),
  verifySignature: vi.fn(async (value) => (
    Boolean(value)
    && typeof value === 'object'
    && ['valid', 'generated'].includes(String((value as { signature?: unknown }).signature ?? ''))
  )),
};

describe('Node Arena generation executor', () => {
  it('canonicalizes retry identity with legacy defaults and server-derived native authority', async () => {
    const base = {
      combatants: [{
        type: 'magical-girl',
        isNative: true,
        data: { name: 'A', signature: 'valid' },
      }],
      customProvider: { apiKey: 'byok-secret' },
      internalGuidance: 'browser authority',
      pvpContext: { roomId: 'forged', matchId: 'forged', roundId: 'forged' },
    };
    const canonicalize = (payload: Record<string, unknown>) => (
      canonicalizeNodeArenaGenerationSemanticPayload({
        payload,
        signatures: signatureService,
        trustedInternalGuidance: 'server guidance',
        trustedPvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
      })
    );

    const implicitDefaults = await canonicalize(base);
    const explicitDefaults = await canonicalize({
      ...base,
      mode: 'classic',
      language: 'zh-CN',
      readArenaHistory: true,
      writeArenaHistory: true,
      readCurrentState: true,
      writeCurrentState: true,
      readNarrativeHistory: false,
      arenaFreeRankingEnabled: false,
    });
    expect(implicitDefaults).toEqual(explicitDefaults);
    expect(implicitDefaults).toMatchObject({
      internalGuidance: 'server guidance',
      pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
      combatants: [{ isNative: true, data: { name: 'A' } }],
    });
    expect(JSON.stringify(implicitDefaults)).not.toMatch(/byok-secret|signature/u);

    const forged = await canonicalize({
      ...base,
      combatants: [{
        type: 'magical-girl',
        isNative: true,
        data: { name: 'A', signature: 'forged' },
      }],
    });
    expect(forged).toMatchObject({ combatants: [{ isNative: false }] });
    expect(forged).not.toEqual(implicitDefaults);
  });

  it('classifies a trusted PVP safety rejection as auditable without dispatching Provider', async () => {
    const generateWithStreamAI = vi.fn();
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      resolveTrustedPvpContext: vi.fn(async () => ({
        roomId: 'room-1',
        matchId: 'match-1',
        roundId: 'round-1',
      })),
      enforceSafety: vi.fn(async () => Response.json({
        error: '输入内容不合规',
        shouldRedirect: true,
        reason: '使用危险符文',
      }, { status: 400 })),
      generateWithStreamAI,
    });

    const result = await executor.prepare!({
      request: new Request('https://example.test/api/generate-battle-story'),
      actorKey: 'user:42',
      generationRequestId: 'pvp_request_1234',
      payload: {
        ...validPayload,
        pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
      },
    });

    expect(isArenaGenerationAuditableRejection(result)).toBe(true);
    if (!isArenaGenerationAuditableRejection(result)) throw new Error('expected auditable rejection');
    expect(result).toMatchObject({
      code: 'ARENA_CONTENT_POLICY_REJECTED',
      stage: 'safety-policy',
      audit: {
        endpoint: 'api/generate-battle-story',
        generationMode: 'non-stream',
        pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
      },
    });
    expect(result.response.status).toBe(400);
    expect(generateWithStreamAI).not.toHaveBeenCalled();
  });

  it('keeps operational readiness failures non-auditable even for trusted PVP input', async () => {
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      readinessCheck: vi.fn(async () => Response.json({
        code: 'ARENA_GENERATION_CAPABILITY_UNAVAILABLE',
      }, { status: 503 })),
      resolveTrustedPvpContext: vi.fn(async () => ({
        roomId: 'room-1', matchId: 'match-1', roundId: 'round-1',
      })),
      generateWithStreamAI: vi.fn(),
    });

    const result = await executor.prepare!({
      request: new Request('https://example.test/api/generate-battle-story'),
      actorKey: 'user:42',
      generationRequestId: 'pvp_request_1234',
      payload: {
        ...validPayload,
        pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
      },
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(503);
  });

  it('keeps non-policy safety failures non-auditable for trusted PVP input', async () => {
    const generateWithStreamAI = vi.fn();
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      resolveTrustedPvpContext: vi.fn(async () => ({
        roomId: 'room-1', matchId: 'match-1', roundId: 'round-1',
      })),
      enforceSafety: vi.fn(async () => Response.json({
        code: 'ARENA_SAFETY_SERVICE_UNAVAILABLE',
      }, { status: 503 })),
      generateWithStreamAI,
    });

    const result = await executor.prepare!({
      request: new Request('https://example.test/api/generate-battle-story'),
      actorKey: 'user:42',
      generationRequestId: 'pvp_request_1234',
      payload: {
        ...validPayload,
        pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
      },
    });

    expect(result).toBeInstanceOf(Response);
    expect(isArenaGenerationAuditableRejection(result)).toBe(false);
    expect((result as Response).status).toBe(503);
    expect(generateWithStreamAI).not.toHaveBeenCalled();
  });

  it('redacts a trusted PVP custom-provider rejection fingerprint before audit', async () => {
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      resolveTrustedPvpContext: vi.fn(async () => ({
        roomId: 'room-1', matchId: 'match-1', roundId: 'round-1',
      })),
      generateWithStreamAI: vi.fn(),
    });

    const result = await executor.prepare!({
      request: new Request('https://example.test/api/generate-battle-story'),
      actorKey: 'user:42',
      generationRequestId: 'pvp_request_1234',
      payload: {
        ...validPayload,
        pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
        customProvider: {
          providerId: 'unknown',
          modelId: 'model',
          apiKey: 'must-not-enter-audit',
        },
      },
    });

    expect(isArenaGenerationAuditableRejection(result)).toBe(true);
    if (!isArenaGenerationAuditableRejection(result)) throw new Error('expected auditable rejection');
    expect(result.code).toBe('ARENA_PROVIDER_UNKNOWN');
    expect(result.stage).toBe('custom-provider-validation');
    expect(JSON.stringify(result.fingerprintPayload)).not.toContain('must-not-enter-audit');
    expect(JSON.stringify(result.fingerprintPayload)).not.toContain('signature');
  });

  it('classifies trusted PVP business validation failures without trusting body context alone', async () => {
    const trustedExecutor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      resolveTrustedPvpContext: vi.fn(async () => ({
        roomId: 'room-1', matchId: 'match-1', roundId: 'round-1',
      })),
      enforceSafety: vi.fn(async () => null),
      generateWithStreamAI: vi.fn(),
    });
    const untrustedExecutor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      resolveTrustedPvpContext: vi.fn(async () => null),
      enforceSafety: vi.fn(async () => null),
      generateWithStreamAI: vi.fn(),
    });
    const input = {
      request: new Request('https://example.test/api/generate-battle-story'),
      actorKey: 'user:42',
      generationRequestId: 'pvp_request_1234',
      payload: {
        ...validPayload,
        combatants: [],
        pvpContext: { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' },
      },
    };

    const trusted = await trustedExecutor.prepare!(input);
    const untrusted = await untrustedExecutor.prepare!(input);

    expect(isArenaGenerationAuditableRejection(trusted)).toBe(true);
    if (!isArenaGenerationAuditableRejection(trusted)) throw new Error('expected auditable rejection');
    expect(trusted).toMatchObject({
      code: 'ARENA_PARTICIPANTS_INVALID',
      stage: 'payload-validation',
    });
    expect(untrusted).toBeInstanceOf(Response);
    expect((untrusted as Response).status).toBe(400);
  });

  it('rejects unsigned PVP context and overwrites signed input with the trusted exact context', async () => {
    const unsignedExecutor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      resolveTrustedPvpContext: vi.fn(async () => null),
      enforceSafety: vi.fn(async () => null),
      generateWithStreamAI: vi.fn(),
    });
    const unsigned = await unsignedExecutor.prepare!({
      request: new Request('https://example.test/api/generate-battle-story'),
      actorKey: 'user:42',
      generationRequestId: 'pvp_request_1234',
      payload: {
        ...validPayload,
        pvpContext: { roomId: 'forged-room', matchId: 'match-1', roundId: 'round-1' },
      },
    });

    expect(unsigned).toBeInstanceOf(Response);
    await expect((unsigned as Response).json()).resolves.toMatchObject({
      code: 'ARENA_PVP_AUTHORITY_INVALID',
    });

    const trustedContext = { roomId: 'room-1', matchId: 'match-1', roundId: 'round-1' };
    const signedExecutor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      resolveTrustedPvpContext: vi.fn(async () => trustedContext),
      enforceSafety: vi.fn(async () => null),
      generateWithStreamAI: vi.fn(),
    });
    const signed = await signedExecutor.prepare!({
      request: new Request('https://example.test/api/generate-battle-story'),
      actorKey: 'pvp-room:room-1',
      generationRequestId: 'pvp_request_1234',
      payload: {
        ...validPayload,
        pvpContext: { roomId: 'body-room', matchId: 'body-match', roundId: 'body-round' },
      },
    });

    expect(signed).not.toBeInstanceOf(Response);
    if (signed instanceof Response || isArenaGenerationAuditableRejection(signed)) {
      throw new Error('unexpected response');
    }
    expect(signed.executionPayload.pvpContext).toEqual(trustedContext);
    expect(signed.executionPayload.__arenaServerContextV1).toEqual(expect.objectContaining({
      trustedPvpContext: trustedContext,
    }));
  });

  it('preserves the configured AI safety gate before reservation', async () => {
    const generateWithStreamAI = vi.fn();
    const generateWithStructuredAI = vi.fn(async () => ({
      isUnsafe: true,
      reason: 'test-policy',
    }));
    const executor = createNodeArenaGenerationExecutor({
      env: {
        NEXT_PUBLIC_ENABLE_SENSITIVE_WORD_FILTER: 'false',
        NEXT_PUBLIC_ENABLE_AI_SAFETY_CHECK: 'true',
      },
      finalizer,
      signatureService,
      generateWithStructuredAI,
      generateWithStreamAI,
    });

    const result = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'anonymous:test',
      generationRequestId: 'request-direct-node',
      payload: validPayload,
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
    expect(generateWithStructuredAI).toHaveBeenCalledTimes(1);
    expect(generateWithStreamAI).not.toHaveBeenCalled();
  });

  it('keeps built-in AI safety on the system-channel prompt budget for BYOK requests', async () => {
    const generateWithStructuredAI = vi.fn();
    const executor = createNodeArenaGenerationExecutor({
      env: {
        NEXT_PUBLIC_ENABLE_SENSITIVE_WORD_FILTER: 'false',
        NEXT_PUBLIC_ENABLE_AI_SAFETY_CHECK: 'true',
      },
      finalizer,
      signatureService,
      generateWithStructuredAI,
      generateWithStreamAI: vi.fn(),
    });

    const result = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'anonymous:test',
      generationRequestId: 'request-byok-safety-budget',
      payload: {
        ...validPayload,
        userGuidance: '安'.repeat(130_000),
        customProvider: {
          providerId: 'chatbox',
          modelId: 'gpt-5.4',
          apiKey: 'secret-value',
        },
      },
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
    await expect((result as Response).json()).resolves.toMatchObject({
      code: 'ARENA_SAFETY_PROMPT_BUDGET_EXCEEDED',
      maxEstimatedPromptTokens: 128_000,
    });
    expect(generateWithStructuredAI).not.toHaveBeenCalled();
  });

  it('keeps legacy non-stream guidance bounds before safety and prompting', async () => {
    let inspectedText = '';
    const inspected = vi.fn(async (input: { combinedText: string }) => {
      inspectedText = input.combinedText;
      return null;
    });
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: inspected,
      generateWithStructuredAI: vi.fn(),
      generateWithStreamAI: vi.fn(),
    });
    const userGuidance = `${'用'.repeat(200)}USER_TAIL`;
    const characterGuidance = `${'角'.repeat(100)}CHARACTER_TAIL`;

    const prepared = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate'),
      actorKey: 'anonymous:test',
      generationRequestId: 'request-guidance-bounds',
      payload: {
        ...validPayload,
        userGuidance,
        combatants: validPayload.combatants.map((combatant, index) => ({
          ...combatant,
          ...(index === 0 ? { characterGuidance } : {}),
        })),
      },
    });

    if (
      prepared instanceof Response
      || isArenaGenerationAuditableRejection(prepared)
    ) throw new Error('unexpected response');
    expect(prepared.executionPayload.userGuidance).toBe('用'.repeat(200));
    expect(inspected).toHaveBeenCalledWith(expect.objectContaining({
      combinedText: expect.not.stringContaining('USER_TAIL'),
    }));
    expect(inspectedText).not.toContain('CHARACTER_TAIL');
  });

  it('stream safety keeps full user guidance but bounds character guidance to prompt parity', async () => {
    let inspectedText = '';
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async ({ combinedText }) => {
        inspectedText = combinedText;
        return null;
      }),
      generateWithStreamAI: vi.fn(),
    });
    const userGuidance = `${'用'.repeat(200)}STREAM_USER_TAIL`;
    const characterGuidance = `${'角'.repeat(100)}STREAM_CHARACTER_TAIL`;

    const prepared = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'anonymous:test',
      generationRequestId: 'request-stream-guidance-bounds',
      payload: {
        ...validPayload,
        userGuidance,
        combatants: validPayload.combatants.map((combatant, index) => ({
          ...combatant,
          ...(index === 0 ? { characterGuidance } : {}),
        })),
      },
    });

    if (
      prepared instanceof Response
      || isArenaGenerationAuditableRejection(prepared)
    ) throw new Error('unexpected response');
    expect(prepared.executionPayload.userGuidance).toBe(userGuidance);
    expect(inspectedText).toContain('STREAM_USER_TAIL');
    expect(inspectedText).not.toContain('STREAM_CHARACTER_TAIL');
  });

  it('fail-closes invalid custom provider before reservation/provider dispatch', async () => {
    const generateWithStreamAI = vi.fn();
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async () => null),
      generateWithStreamAI,
    });

    const result = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream', {
        headers: { 'cf-connecting-ip': '192.0.2.44' },
      }),
      actorKey: 'anonymous:test',
      generationRequestId: 'request-direct-node',
      payload: {
        ...validPayload,
        customProvider: {
          providerId: 'unknown',
          modelId: 'model',
          apiKey: 'secret',
        },
      },
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(400);
    expect(generateWithStreamAI).not.toHaveBeenCalled();
  });

  it('does not trust client native/internal fields and keeps BYOK only at provider boundary', async () => {
    const safetyPayloads: Array<Record<string, unknown>> = [];
    const generateWithStreamAI = vi.fn(async (config, options) => {
      expect(options.providerOverride.apiKey).toBe('secret-value');
      expect(config.modelOverride).toBe('gpt-5.4');
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
      return {
        response: new Response('body'),
        telemetry: options.telemetry,
        usagePromise: Promise.resolve({ totalTokens: 9 }),
        finishReasonPromise: Promise.resolve('stop'),
      };
    });
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async ({ payload }) => {
        safetyPayloads.push(payload);
        return null;
      }),
      generateWithStreamAI,
    });
    const prepared = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream', {
        headers: { 'cf-connecting-ip': '192.0.2.44' },
      }),
      actorKey: 'anonymous:test',
      generationRequestId: 'request-direct-node',
      payload: {
        ...validPayload,
        customProvider: {
          providerId: 'chatbox',
          modelId: 'gpt-5.4',
          apiKey: 'secret-value',
        },
        isDowngrade: true,
      },
    });

    expect(prepared).not.toBeInstanceOf(Response);
    if (
      prepared instanceof Response
      || isArenaGenerationAuditableRejection(prepared)
    ) throw new Error('unexpected response');
    const combatants = safetyPayloads[0]?.combatants as Array<{ isNative: boolean }>;
    expect(combatants.map((item) => item.isNative)).toEqual([false, true]);
    expect(signatureService.generateSignature).not.toHaveBeenCalled();
    expect(safetyPayloads[0]?.internalGuidance).toBeUndefined();
    expect(JSON.stringify(prepared.semanticPayload)).not.toContain('secret-value');
    expect(JSON.stringify(prepared.semanticPayload)).not.toContain('__arenaServerContextV1');
    expect(prepared.executionPayload.__arenaServerContextV1).toEqual(expect.objectContaining({
      ipAnonymized: '192.0.2.0',
      endpoint: 'api/arena/generate-stream',
      deliveryMode: 'stream',
    }));

    const controller = new AbortController();
    const terminal = await executor.execute({
      generationId: 'generation-1',
      generationRequestId: 'request-1',
      actorKey: 'anonymous:test',
      producerToken: 'producer-token-1',
      payloadHash: 'payload-hash-1',
      payload: prepared.executionPayload,
      signal: controller.signal,
      emit: vi.fn(async () => undefined),
      claimFinalization: vi.fn(async () => ({ kind: 'claimed' as const })),
    });
    expect(terminal.status).toBe('completed');
    expect(generateWithStreamAI).toHaveBeenCalledTimes(1);
  });

  it('normalizes raw Arena materials before safety and prompt construction', async () => {
    const safetyPayloads: Array<Record<string, unknown>> = [];
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async ({ payload }) => {
        safetyPayloads.push(payload);
        return null;
      }),
      generateWithStreamAI: vi.fn(),
    });

    const prepared = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'anonymous:test',
      generationRequestId: 'request-direct-node',
      payload: {
        ...validPayload,
        materials: [
          {
            templateId: '通用情景',
            title: '雨夜站台',
            content: '末班车停靠。',
            _cardId: 'card-1',
            _cardName: '雨夜站台卡',
            _updatedAt: '2026-08-25T04:00:00.000Z',
          },
          'primitive material',
          { cardKind: 'lore', name: 'Wantu lore', content: 'world setting' },
        ],
      },
    });

    expect(prepared).not.toBeInstanceOf(Response);
    const materials = safetyPayloads[0]?.materials as Array<Record<string, unknown>>;
    expect(materials).toEqual([
      expect.objectContaining({
        name: '雨夜站台卡',
        sourceKind: 'mahoshojo-data-card',
        sourceType: '通用情景',
        sourceDataCardId: 'card-1',
        sourceDataCardUpdatedAt: '2026-08-25T04:00:00.000Z',
        content: {
          templateId: '通用情景',
          title: '雨夜站台',
          content: '末班车停靠。',
        },
      }),
      expect.objectContaining({
        name: '未命名素材',
        sourceKind: 'raw-json',
        sourceType: 'raw-json',
        content: 'primitive material',
      }),
      expect.objectContaining({
        name: 'Wantu lore',
        sourceKind: 'wantu-card',
        sourceType: 'lore',
        content: expect.objectContaining({ content: 'world setting' }),
      }),
    ]);
  });

  it('allows reference collections above legacy per-type caps and rejects only aggregate sanity overflow', async () => {
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async () => null),
      generateWithStreamAI: vi.fn(),
    });
    const relaxed = await executor.prepare!({
      request: new Request('https://example.test/api/generate-battle-story'),
      actorKey: 'anonymous:test',
      generationRequestId: 'request-direct-node',
      payload: {
        ...validPayload,
        auxScenarios: Array.from({ length: 12 }, () => ({})),
        materials: Array.from({ length: 12 }, () => ({})),
      },
    });
    const overflow = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate'),
      actorKey: 'anonymous:test',
      generationRequestId: 'request-direct-node',
      payload: {
        ...validPayload,
        narrativeHistory: Array.from({ length: 250 }, (_, index) => ({
          content: `history-${index}`,
          createdAt: new Date(index).toISOString(),
        })),
        narrativeHistoryReadLimit: 10,
        readNarrativeHistory: true,
        materials: Array.from({ length: 7 }, () => ({})),
      },
    });

    expect(relaxed).not.toBeInstanceOf(Response);
    expect(overflow).toBeInstanceOf(Response);
    expect((overflow as Response).status).toBe(413);
    expect(await (overflow as Response).json()).toMatchObject({
      code: 'ARENA_REFERENCE_ITEMS_LIMIT',
    });
  });

  it('uses the strict-ranked model fallback order after an explicit pre-dispatch failure', async () => {
    const generateWithStreamAI = vi.fn()
      .mockRejectedValueOnce(Object.assign(
        new Error('first model unavailable before dispatch'),
        { retrySafety: 'pre-dispatch-safe' as const },
      ))
      .mockResolvedValueOnce({ response: new Response('body') });
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async () => null),
      generateWithStreamAI,
    });
    const prepared = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'anonymous:test',
      generationRequestId: 'request-direct-node',
      payload: {
        ...validPayload,
        internalGuidance: undefined,
        readArenaHistory: false,
        readCurrentState: false,
        readNarrativeHistory: false,
        writeArenaHistory: false,
        writeCurrentState: false,
        isDowngrade: true,
      },
    });
    if (
      prepared instanceof Response
      || isArenaGenerationAuditableRejection(prepared)
    ) throw new Error('unexpected response');
    const terminal = await executor.execute({
      generationId: 'generation-strict',
      generationRequestId: 'request-strict',
      actorKey: 'anonymous:test',
      producerToken: 'producer-token-strict',
      payloadHash: 'payload-hash-strict',
      payload: prepared.executionPayload,
      signal: new AbortController().signal,
      emit: vi.fn(async () => undefined),
      claimFinalization: vi.fn(async () => ({ kind: 'claimed' as const })),
    });

    expect(terminal.status).toBe('completed');
    expect(generateWithStreamAI).toHaveBeenCalledTimes(2);
    expect(generateWithStreamAI.mock.calls.map(([config]) => config.modelOverride)).toEqual([
      'gemma-4-31b-it',
      'gemma-3-27b-it',
    ]);
  });

  it('does not try a second strict-ranked stream model after an unclassified dispatch failure', async () => {
    const generateWithStreamAI = vi.fn()
      .mockRejectedValueOnce(new Error('provider returned 500 after dispatch'))
      .mockResolvedValueOnce({ response: new Response('must not be used') });
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async () => null),
      generateWithStreamAI,
    });
    const prepared = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate-stream'),
      actorKey: 'anonymous:test',
      generationRequestId: 'request-no-replay-stream',
      payload: {
        ...validPayload,
        readArenaHistory: false,
        readCurrentState: false,
        readNarrativeHistory: false,
        writeArenaHistory: false,
        writeCurrentState: false,
        isDowngrade: true,
      },
    });
    if (prepared instanceof Response || isArenaGenerationAuditableRejection(prepared)) {
      throw new Error('unexpected response');
    }

    const terminal = await executor.execute({
      generationId: 'generation-no-replay-stream',
      generationRequestId: 'request-no-replay-stream',
      actorKey: 'anonymous:test',
      producerToken: 'producer-token-no-replay-stream',
      payloadHash: 'payload-hash-no-replay-stream',
      payload: prepared.executionPayload,
      signal: new AbortController().signal,
      emit: vi.fn(async () => undefined),
      claimFinalization: vi.fn(async () => ({ kind: 'claimed' as const })),
    });

    expect(terminal.status).toBe('failed');
    expect(generateWithStreamAI).toHaveBeenCalledTimes(1);
  });

  it('does not try a second strict-ranked structured model after an unclassified dispatch failure', async () => {
    const generateWithStructuredAI = vi.fn()
      .mockRejectedValueOnce(new Error('provider returned 500 after dispatch'))
      .mockResolvedValueOnce({
        headline: 'must not be used',
        article: { body: 'must not be used', analysis: 'must not be used' },
        officialReport: { winner: 'A', conclusion: 'must not be used' },
        impacts: [],
      });
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async () => null),
      generateWithStructuredAI,
      generateWithStreamAI: vi.fn(),
    });
    const prepared = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate'),
      actorKey: 'anonymous:test',
      generationRequestId: 'request-no-replay-structured',
      payload: {
        ...validPayload,
        readArenaHistory: false,
        readCurrentState: false,
        readNarrativeHistory: false,
        writeArenaHistory: false,
        writeCurrentState: false,
        isDowngrade: true,
      },
    });
    if (prepared instanceof Response || isArenaGenerationAuditableRejection(prepared)) {
      throw new Error('unexpected response');
    }

    const terminal = await executor.execute({
      generationId: 'generation-no-replay-structured',
      generationRequestId: 'request-no-replay-structured',
      actorKey: 'anonymous:test',
      producerToken: 'producer-token-no-replay-structured',
      payloadHash: 'payload-hash-no-replay-structured',
      payload: prepared.executionPayload,
      signal: new AbortController().signal,
      emit: vi.fn(async () => undefined),
      claimFinalization: vi.fn(async () => ({ kind: 'claimed' as const })),
    });

    expect(terminal.status).toBe('failed');
    expect(generateWithStructuredAI).toHaveBeenCalledTimes(1);
  });

  it('preserves the public non-strict downgrade model contract', async () => {
    const generateWithStreamAI = vi.fn();
    let receivedStructuredConfig: unknown = null;
    const generateWithStructuredAI = vi.fn(async (_input: unknown, config: unknown) => {
      receivedStructuredConfig = config;
      return {
        headline: '结构化战报',
        article: { body: '正文', analysis: '记者点评' },
        officialReport: { winner: 'A', conclusion: '结论' },
        impacts: [],
      };
    });
    const executor = createNodeArenaGenerationExecutor({
      env: {},
      finalizer,
      signatureService,
      enforceSafety: vi.fn(async () => null),
      generateWithStructuredAI,
      generateWithStreamAI,
    });
    const prepared = await executor.prepare!({
      request: new Request('https://example.test/api/arena/generate'),
      actorKey: 'anonymous:test',
      generationRequestId: 'request-direct-node',
      payload: {
        ...validPayload,
        userGuidance: '非排位叙事',
        isDowngrade: true,
      },
    });
    if (
      prepared instanceof Response
      || isArenaGenerationAuditableRejection(prepared)
    ) throw new Error('unexpected response');
    const streamMeta = JSON.parse(decodeURIComponent(
      prepared.responseHeaders?.['X-Mahoshojo-Stream-Meta'] ?? '',
    )) as Record<string, unknown>;
    expect(streamMeta.outputContract).toBe('structured-report');

    const terminal = await executor.execute({
      generationId: 'generation-downgrade',
      generationRequestId: 'request-downgrade',
      actorKey: 'anonymous:test',
      producerToken: 'producer-token-downgrade',
      payloadHash: 'payload-hash-downgrade',
      payload: prepared.executionPayload,
      signal: new AbortController().signal,
      emit: vi.fn(async () => undefined),
      claimFinalization: vi.fn(async () => ({ kind: 'claimed' as const })),
    });

    expect(terminal.status).toBe('completed');
    expect(generateWithStreamAI).not.toHaveBeenCalled();
    expect(generateWithStructuredAI).toHaveBeenCalledTimes(1);
    expect(receivedStructuredConfig).toMatchObject({
      modelOverride: 'gemini-2.5-flash-lite',
      taskName: '生成classic模式故事',
    });
  });
});
