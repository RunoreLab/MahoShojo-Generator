import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveActor = vi.fn();
const getD1Client = vi.fn();
const readOwnedReconciliation = vi.fn();
const resolveNativeAuthority = vi.fn();
const applyPostBattleUpdates = vi.fn();

vi.mock('@/app/api/arena/generation-runtime', () => ({
  resolveCloudflareDrArenaGenerationActor: resolveActor,
}));
vi.mock('@/lib/hosted-dr/database-provider', () => ({
  getNextHostedD1Client: getD1Client,
}));
vi.mock('@mahoshojo/hosted-runtime/arena-generation', () => ({
  readOwnedNodeArenaGenerationReconciliation: readOwnedReconciliation,
  resolveArenaCombatantNativeAuthority: resolveNativeAuthority,
}));
vi.mock('@/lib/signature', () => ({ verifySignature: vi.fn() }));
vi.mock('@/lib/arena/service', () => ({ applyPostBattleUpdates }));

const { appRouteHandler } = await import(
  '@/app/api/arena/update-combatants-after-stream/handler'
);

const generationId = 'generation-1234';
const client = { prepare: vi.fn() };
const roster = [
  {
    sortIndex: 0,
    name: 'A',
    type: 'magical-girl',
    dataCardId: 'card-a',
    isPreset: false,
  },
  {
    sortIndex: 1,
    name: 'B',
    type: 'general-character',
    templateId: 'C01_bundled.json',
    isPreset: true,
  },
];
const authoritativePayload = {
  report: {
    headline: '服务器战报',
    mode: 'classic',
    officialReport: { winner: 'A' },
  },
  impacts: [
    { combatantIndex: 0, characterName: 'A', impact: 'A 的服务器影响' },
    { combatantIndex: 1, characterName: 'B', impact: 'B 的服务器影响' },
  ],
  roster,
  userGuidance: '服务器引导',
  scenario: { title: '服务器情景', isNative: true },
  writeArenaHistory: true,
  writeCurrentState: false,
};

const request = (body: Record<string, unknown>) => new Request(
  'http://localhost/api/arena/update-combatants-after-stream',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Mahoshojo-Generation-Actor-Token': 'signed.actor',
    },
    body: JSON.stringify(body),
  },
);

describe('Arena stream reconciliation handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1Client.mockReturnValue(client);
    resolveActor.mockResolvedValue({ actorKey: 'user:42' });
    readOwnedReconciliation.mockResolvedValue({
      kind: 'found',
      reconciliation: authoritativePayload,
    });
    resolveNativeAuthority.mockImplementation(async (
      value: { data?: { signature?: string } },
    ) => value.data?.signature === 'valid');
    applyPostBattleUpdates.mockImplementation(async (
      combatants: Array<{ data: Record<string, unknown> }>,
      _report: unknown,
      _impacts: unknown,
      _guidance: unknown,
      _scenario: unknown,
      options: { combatantIndices: number[] },
    ) => combatants.map((combatant, index) => ({
      combatantIndex: options.combatantIndices[index],
      data: { ...combatant.data, updated: true },
    })));
  });

  it('卡片正文发生无害变化后仍按 data card 身份更新', async () => {
    const combatants = [{
      type: 'magical-girl',
      sourceDataCardId: 'card-a',
      isNative: true,
      data: { name: 'A（本地改名）', note: 'generation 后新增正文', signature: 'valid' },
    }];

    const response = await appRouteHandler(request({ generationId, combatants }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      updatedCombatants: [{
        combatantIndex: 0,
        data: { name: 'A（本地改名）', updated: true },
      }],
      warnings: [{
        rosterIndex: 1,
        characterName: 'B',
        code: 'ARENA_RECONCILIATION_ROSTER_COMBATANT_MISSING',
      }],
    });
    expect(applyPostBattleUpdates).toHaveBeenCalledWith(
      [{ ...combatants[0], isNative: true }],
      authoritativePayload.report,
      [{ combatantIndex: 0, characterName: 'A（本地改名）', impact: 'A 的服务器影响' }],
      authoritativePayload.userGuidance,
      { title: authoritativePayload.scenario.title },
      expect.objectContaining({ generationId, combatantIndices: [0] }),
    );
  });

  it('真实 retry 保留 bundled preset filename 并且不再因 authority 变化 409', async () => {
    const combatants = [{
      type: 'general-character',
      filename: 'C01_bundled.json',
      isPreset: true,
      isNative: true,
      data: { name: '内置角色' },
    }];
    resolveNativeAuthority.mockResolvedValue(false);

    const response = await appRouteHandler(request({ generationId, combatants }) as never);

    expect(response.status).toBe(200);
    expect(applyPostBattleUpdates).toHaveBeenCalledWith(
      [{ ...combatants[0], isNative: false }],
      expect.anything(),
      [expect.objectContaining({ characterName: '内置角色', impact: 'B 的服务器影响' })],
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ combatantIndices: [0] }),
    );
  });

  it('mixed roster 局部更新可信匹配并逐角色返回 warning', async () => {
    const combatants = [
      {
        type: 'magical-girl',
        sourceDataCardId: 'card-a',
        data: { name: 'A', signature: 'valid' },
      },
      {
        type: 'general-character',
        sourceDataCardId: 'unknown-card',
        data: { name: '陌生角色' },
      },
    ];

    const response = await appRouteHandler(request({ generationId, combatants }) as never);

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      updatedCombatants: [{ combatantIndex: 0 }],
    });
    expect(result.warnings).toEqual(expect.arrayContaining([{
        combatantIndex: 1,
        code: 'ARENA_RECONCILIATION_COMBATANT_UNMATCHED',
        message: expect.any(String),
      }, {
        rosterIndex: 1,
        characterName: 'B',
        code: 'ARENA_RECONCILIATION_ROSTER_COMBATANT_MISSING',
        message: expect.any(String),
      }]));
    expect(resolveNativeAuthority).toHaveBeenCalledTimes(1);
  });

  it('0 个可信匹配时才整体 409', async () => {
    const response = await appRouteHandler(request({
      generationId,
      combatants: [{
        type: 'canshou',
        sourceDataCardId: 'unknown-card',
        data: { name: '陌生角色' },
      }],
    }) as never);

    expect(response.status).toBe(409);
    const result = await response.json();
    expect(result.code).toBe('ARENA_RECONCILIATION_ROSTER_MISMATCH');
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ combatantIndex: 0 }),
      expect.objectContaining({ rosterIndex: 0, characterName: 'A' }),
    ]));
    expect(applyPostBattleUpdates).not.toHaveBeenCalled();
  });

  it('伪造 isNative 或 authority 检查异常都降级为 false 后继续', async () => {
    const combatants = [
      {
        type: 'magical-girl',
        sourceDataCardId: 'card-a',
        isNative: true,
        data: { name: 'A', signature: 'forged' },
      },
      {
        type: 'general-character',
        filename: 'C01_bundled.json',
        isPreset: true,
        isNative: true,
        data: { name: 'B' },
      },
    ];
    resolveNativeAuthority
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('authority unavailable'));

    const response = await appRouteHandler(request({ generationId, combatants }) as never);

    expect(response.status).toBe(200);
    expect(applyPostBattleUpdates.mock.calls[0]?.[0]).toEqual([
      { ...combatants[0], isNative: false },
      { ...combatants[1], isNative: false },
    ]);
  });

  it('requires an owned completed generation before claiming the effect', async () => {
    readOwnedReconciliation.mockResolvedValue({
      kind: 'unavailable',
      reason: 'generation_not_completed',
    });

    const response = await appRouteHandler(request({
      generationId,
      combatants: [{ type: 'magical-girl', data: { name: 'A' } }],
    }) as never);

    expect(response.status).toBe(409);
    expect(applyPostBattleUpdates).not.toHaveBeenCalled();
  });

  it('keeps missing and wrong-owner generations non-enumerable', async () => {
    for (const reason of ['row_missing', 'owner_mismatch']) {
      readOwnedReconciliation.mockResolvedValueOnce({ kind: 'not-found', reason });
      const response = await appRouteHandler(request({
        generationId,
        combatants: [{ type: 'magical-girl', data: { name: 'A' } }],
      }) as never);
      expect(response.status).toBe(404);
    }
  });

  it('distinguishes durable finalization pending and D1 read failure', async () => {
    const body = {
      generationId,
      combatants: [{ type: 'magical-girl', data: { name: 'A' } }],
    };
    readOwnedReconciliation.mockResolvedValueOnce({
      kind: 'unavailable',
      reason: 'finalization_pending',
    });
    expect((await appRouteHandler(request(body) as never)).status).toBe(503);

    readOwnedReconciliation.mockRejectedValueOnce(new Error('D1_TRANSPORT_FAILURE'));
    expect((await appRouteHandler(request(body) as never)).status).toBe(503);
  });

  it('rejects requests whose generation actor cannot be authenticated', async () => {
    resolveActor.mockResolvedValueOnce(null);
    const response = await appRouteHandler(request({
      generationId,
      combatants: [{ type: 'magical-girl', data: { name: 'A' } }],
    }) as never);
    expect(response.status).toBe(401);
  });
});
