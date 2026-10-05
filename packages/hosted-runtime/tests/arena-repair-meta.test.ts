import { describe, expect, it, vi } from 'vitest';

import { createSafePublicAiError } from '@mahoshojo/hosted-api/regular-generation';
import {
  createNodeArenaRepairMetaService,
  type ArenaRepairGenerationProvenanceResult,
} from '../src/arena-companion/repair-meta';

const battleReportMarkdown = `# 终局战报

## 胜利者

- 角色 A

## 正文

${'两位角色在魔法竞技场完成了漫长而明确的一轮交锋。'.repeat(8)}`;

const body = (overrides: Record<string, unknown> = {}) => ({
  generationId: 'generation-repair-001',
  combatants: [{
    type: 'magical-girl',
    filename: 'custom.json',
    data: { name: '角色 A', current_state: { summary: '旧状态' } },
    isNative: false,
    isPreset: false,
  }],
  battleReportMarkdown,
  mode: 'classic',
  userGuidance: '保持角色既有性格',
  writeArenaHistory: true,
  writeCurrentState: true,
  ...overrides,
});

const request = (overrides: Record<string, unknown> = {}) => new Request(
  'https://example.test/api/arena/repair-combatant-meta',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body(overrides)),
  },
);

const systemProvenance: ArenaRepairGenerationProvenanceResult = {
  kind: 'found',
  provenance: {
    customProviderId: null,
    customModelId: null,
    aiProviderName: 'provider-b',
    aiProviderType: 'openai',
    aiModel: 'model-y',
  },
};

const providers = [
  {
    name: 'provider-a',
    apiKey: 'server-a',
    baseUrl: 'https://a.example.test/v1',
    model: 'model-x',
    type: 'openai' as const,
  },
  {
    name: 'provider-b',
    apiKey: 'server-b',
    baseUrl: 'https://b.example.test/v1',
    model: 'model-y',
    type: 'openai' as const,
  },
];

const validDraft = {
  impacts: [{
    combatantIndex: 0,
    characterName: '角色 A',
    impact: '新的影响',
    currentStateSummary: '新的状态',
  }],
};

describe('Node Arena repair metadata service', () => {
  it('pins system repair to the exact provider and model recorded by the generation', async () => {
    const generateWithStructuredAI = vi.fn(async (
      _input: unknown,
      _config: unknown,
      _options?: unknown,
    ) => validDraft);
    const service = createNodeArenaRepairMetaService({
      providers,
      resolveActor: vi.fn(async () => ({ actorKey: 'user:42' })),
      readProvenance: vi.fn(async () => systemProvenance),
      verifySignature: vi.fn(async () => false),
      enforceSafety: vi.fn(async () => null),
      generateWithStructuredAI,
    });

    const response = await service.generate(request());

    expect(response.status).toBe(200);
    const [, config, options] = generateWithStructuredAI.mock.calls[0]!;
    expect(config).toMatchObject({ modelOverride: 'model-y' });
    expect(options).toMatchObject({
      loadBalanceStrategy: 'custom',
      providerOverride: {
        name: 'provider-b',
        model: 'model-y',
        apiKey: 'server-b',
      },
    });
  });

  it('reuses the generation BYOK snapshot and rejects a later UI provider switch', async () => {
    const generateWithStructuredAI = vi.fn(async (
      _input: unknown,
      _config: unknown,
      _options?: unknown,
    ) => validDraft);
    const readProvenance = vi.fn(async (): Promise<ArenaRepairGenerationProvenanceResult> => ({
      kind: 'found',
      provenance: {
        customProviderId: 'kourichat',
        customModelId: 'gpt-5.5',
        aiProviderName: 'KouriChat',
        aiProviderType: 'openai',
        aiModel: 'gpt-5.5',
      },
    }));
    const service = createNodeArenaRepairMetaService({
      providers,
      resolveActor: vi.fn(async () => ({ actorKey: 'user:42' })),
      readProvenance,
      verifySignature: vi.fn(async () => false),
      enforceSafety: vi.fn(async () => null),
      generateWithStructuredAI,
    });

    const accepted = await service.generate(request({
      customProvider: {
        providerId: 'kourichat',
        modelId: 'gpt-5.5',
        apiKey: 'generation-key-canary',
      },
    }));
    expect(accepted.status).toBe(200);
    expect(generateWithStructuredAI.mock.calls[0]?.[2]).toMatchObject({
      providerOverride: {
        providerId: 'kourichat',
        model: 'gpt-5.5',
        apiKey: 'generation-key-canary',
      },
    });

    generateWithStructuredAI.mockClear();
    const rejected = await service.generate(request({
      customProvider: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        apiKey: 'later-ui-key',
      },
    }));
    expect(rejected.status).toBe(409);
    expect(generateWithStructuredAI).not.toHaveBeenCalled();
    const rejectedBody = await rejected.text();
    expect(rejectedBody).not.toContain('generation-key-canary');
    expect(rejectedBody).not.toContain('later-ui-key');
  });

  it('fails closed before Provider dispatch when generation ownership is unavailable', async () => {
    const generateWithStructuredAI = vi.fn();
    const service = createNodeArenaRepairMetaService({
      providers,
      resolveActor: vi.fn(async () => ({ actorKey: 'user:42' })),
      readProvenance: vi.fn(async (): Promise<ArenaRepairGenerationProvenanceResult> => ({
        kind: 'not-found',
        reason: 'owner_mismatch',
      })),
      verifySignature: vi.fn(async () => false),
      enforceSafety: vi.fn(async () => null),
      generateWithStructuredAI,
    });

    const response = await service.generate(request());

    expect(response.status).toBe(404);
    expect(generateWithStructuredAI).not.toHaveBeenCalled();
  });

  it('maps Provider timeout and invalid output to stable non-500 responses', async () => {
    const generateWithStructuredAI = vi.fn(async (
      _input: unknown,
      _config: unknown,
      _options?: unknown,
    ): Promise<unknown> => validDraft)
      .mockRejectedValueOnce(createSafePublicAiError({
        code: 'AI_UPSTREAM_TIMEOUT',
        message: '上游响应超时',
      }))
      .mockResolvedValueOnce({ impacts: [] });
    const service = createNodeArenaRepairMetaService({
      providers,
      resolveActor: vi.fn(async () => ({ actorKey: 'user:42' })),
      readProvenance: vi.fn(async () => systemProvenance),
      verifySignature: vi.fn(async () => false),
      enforceSafety: vi.fn(async () => null),
      generateWithStructuredAI,
    });

    const timeout = await service.generate(request());
    expect(timeout.status).toBe(504);
    await expect(timeout.json()).resolves.toMatchObject({
      code: 'ARENA_REPAIR_META_PROVIDER_TIMEOUT',
    });

    const invalid = await service.generate(request());
    expect(invalid.status).toBe(502);
    await expect(invalid.json()).resolves.toMatchObject({
      code: 'ARENA_REPAIR_META_OUTPUT_INVALID',
    });
  });

  it('maps authority and safety infrastructure failures to stable 503 responses', async () => {
    const authorityService = createNodeArenaRepairMetaService({
      providers,
      resolveActor: vi.fn(async () => ({ actorKey: 'user:42' })),
      readProvenance: vi.fn(async () => systemProvenance),
      verifySignature: vi.fn(async () => {
        throw new Error('secret verifier details');
      }),
      enforceSafety: vi.fn(async () => null),
      generateWithStructuredAI: vi.fn(async () => validDraft),
    });
    const authorityFailure = await authorityService.generate(request());
    expect(authorityFailure.status).toBe(503);
    await expect(authorityFailure.json()).resolves.toMatchObject({
      code: 'ARENA_REPAIR_META_AUTHORITY_UNAVAILABLE',
    });

    const safetyService = createNodeArenaRepairMetaService({
      providers,
      resolveActor: vi.fn(async () => ({ actorKey: 'user:42' })),
      readProvenance: vi.fn(async () => systemProvenance),
      verifySignature: vi.fn(async () => false),
      enforceSafety: vi.fn(async () => {
        throw new Error('secret safety details');
      }),
      generateWithStructuredAI: vi.fn(async () => validDraft),
    });
    const safetyFailure = await safetyService.generate(request());
    expect(safetyFailure.status).toBe(503);
    await expect(safetyFailure.json()).resolves.toMatchObject({
      code: 'ARENA_REPAIR_META_SAFETY_UNAVAILABLE',
    });
  });
});
