import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveActor = vi.fn();
const getD1Client = vi.fn();
const readOwnedReconciliation = vi.fn();
const resolveNativeAuthority = vi.fn();
const isCanonicalPreset = vi.fn();
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
  isCanonicalArenaCharacterPreset: isCanonicalPreset,
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
    templateId: 'magical-girl:a',
    nativeSignature: 'valid',
    isNative: true,
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
    isCanonicalPreset.mockResolvedValue(false);
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
      data: {
        name: 'A（本地改名）',
        templateId: 'magical-girl:a',
        note: 'generation 后新增正文',
        signature: 'valid',
      },
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
      [{
        type: combatants[0]!.type,
        data: combatants[0]!.data,
        isNative: true,
        characterGuidance: null,
      }],
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
      [{
        type: combatants[0]!.type,
        data: combatants[0]!.data,
        isNative: false,
        characterGuidance: null,
      }],
      expect.anything(),
      [expect.objectContaining({ characterName: '内置角色', impact: 'B 的服务器影响' })],
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ combatantIndices: [0] }),
    );
  });

  it('canonical bundled preset 以服务器 digest 绑定 frozen filename 后保留 native', async () => {
    readOwnedReconciliation.mockResolvedValueOnce({
      kind: 'found',
      reconciliation: {
        ...authoritativePayload,
        roster: [{
          sortIndex: 0,
          name: '内置角色',
          type: 'general-character',
          templateId: 'C01_bundled.json',
          isPreset: true,
          isNative: true,
        }],
        impacts: [{ combatantIndex: 0, characterName: '内置角色', impact: '冻结影响' }],
      },
    });
    resolveNativeAuthority.mockResolvedValueOnce(true);
    isCanonicalPreset.mockResolvedValueOnce(true);
    const combatants = [{
      type: 'general-character',
      filename: 'C01_bundled.json',
      isPreset: true,
      data: { name: '内置角色', templateId: '通用角色' },
    }];

    const response = await appRouteHandler(request({ generationId, combatants }) as never);

    expect(response.status).toBe(200);
    expect(applyPostBattleUpdates.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ isNative: true }),
    ]);
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

  it('不读取卡片正文内可伪造的 dataCardId 作为 roster identity', async () => {
    const response = await appRouteHandler(request({
      generationId,
      combatants: [{
        type: 'magical-girl',
        data: { name: '陌生角色', dataCardId: 'card-a', signature: 'valid' },
      }],
    }) as never);

    expect(response.status).toBe(409);
    expect(applyPostBattleUpdates).not.toHaveBeenCalled();
  });

  it('多个 current 同时声明一个 frozen identity 时全部按 ambiguous 跳过', async () => {
    const response = await appRouteHandler(request({
      generationId,
      combatants: [{
        type: 'magical-girl',
        sourceDataCardId: 'card-a',
        data: { name: 'A', templateId: 'magical-girl:a', signature: 'valid' },
      }, {
        type: 'magical-girl',
        sourceDataCardId: 'card-a',
        data: { name: '伪造声明', templateId: 'magical-girl:other', signature: 'valid' },
      }],
    }) as never);

    expect(response.status).toBe(409);
    const result = await response.json();
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ combatantIndex: 0 }),
      expect.objectContaining({ combatantIndex: 1 }),
    ]));
    expect(applyPostBattleUpdates).not.toHaveBeenCalled();
  });

  it('无稳定 identity 的同名同 type 重复角色不按 slot 猜测', async () => {
    readOwnedReconciliation.mockResolvedValueOnce({
      kind: 'found',
      reconciliation: {
        ...authoritativePayload,
        roster: [{ sortIndex: 0, name: '同名', type: 'magical-girl', isNative: false }, {
          sortIndex: 1,
          name: '同名',
          type: 'magical-girl',
          isNative: false,
        }],
      },
    });

    const response = await appRouteHandler(request({
      generationId,
      combatants: [{ type: 'magical-girl', data: { name: '同名' } }, {
        type: 'magical-girl',
        data: { name: '同名' },
      }],
    }) as never);

    expect(response.status).toBe(409);
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
      {
        type: combatants[0]!.type,
        data: combatants[0]!.data,
        isNative: false,
        characterGuidance: null,
      },
      {
        type: combatants[1]!.type,
        data: combatants[1]!.data,
        isNative: false,
        characterGuidance: null,
      },
    ]);
  });

  it('客户端包装 ID 只能定位候选，不能把另一张有效签名卡变成可重签目标', async () => {
    readOwnedReconciliation.mockResolvedValueOnce({
      kind: 'found',
      reconciliation: {
        ...authoritativePayload,
        roster: [{
          sortIndex: 0,
          name: 'A',
          type: 'magical-girl',
          dataCardId: 'card-a',
          templateId: 'magical-girl:a',
          nativeSignature: 'signature-a',
          isNative: true,
          characterGuidance: '生成时冻结的引导',
        }],
        impacts: [{ combatantIndex: 0, characterName: 'A', impact: '冻结影响' }],
      },
    });
    const combatants = [{
      type: 'magical-girl',
      sourceDataCardId: 'card-a',
      characterGuidance: '客户端事后注入的引导',
      data: {
        name: '另一张卡',
        templateId: 'magical-girl:a',
        signature: 'valid',
      },
    }];

    const response = await appRouteHandler(request({ generationId, combatants }) as never);

    expect(response.status).toBe(200);
    expect(applyPostBattleUpdates.mock.calls[0]?.[0]).toEqual([{
      type: 'magical-girl',
      data: combatants[0]!.data,
      isNative: false,
      characterGuidance: '生成时冻结的引导',
    }]);
  });

  it('局部提交仍使用完整 frozen roster 计算参与者与原生冲突', async () => {
    readOwnedReconciliation.mockResolvedValueOnce({
      kind: 'found',
      reconciliation: {
        ...authoritativePayload,
        roster: [{
          sortIndex: 0,
          name: '双生',
          type: 'magical-girl',
          dataCardId: 'card-native',
          templateId: 'magical-girl:twin',
          nativeSignature: 'valid',
          isNative: true,
        }, {
          sortIndex: 1,
          name: '双生',
          type: 'magical-girl',
          dataCardId: 'card-local',
          isNative: false,
        }],
        impacts: [{ combatantIndex: 0, characterName: '双生', impact: '冻结影响' }],
      },
    });
    const combatants = [{
      type: 'magical-girl',
      sourceDataCardId: 'card-native',
      data: { name: '双生', templateId: 'magical-girl:twin', signature: 'valid' },
    }];

    const response = await appRouteHandler(request({ generationId, combatants }) as never);

    expect(response.status).toBe(200);
    expect(applyPostBattleUpdates.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ isNative: false }),
    ]);
    expect(applyPostBattleUpdates.mock.calls[0]?.[5]).toMatchObject({
      participantNames: ['双生', '双生'],
      nonNativeDataInvolved: true,
      conflictingNativeNames: ['双生'],
    });
  });

  it('旧 name-only impact 按完整 frozen roster 判重，不猜给局部提交的同名角色', async () => {
    readOwnedReconciliation.mockResolvedValueOnce({
      kind: 'found',
      reconciliation: {
        ...authoritativePayload,
        roster: [{
          sortIndex: 0,
          name: '同名角色',
          type: 'magical-girl',
          dataCardId: 'card-one',
          isNative: false,
        }, {
          sortIndex: 1,
          name: '同名角色',
          type: 'magical-girl',
          dataCardId: 'card-two',
          isNative: false,
        }],
        impacts: [{ characterName: '同名角色', impact: '无法唯一归属的旧影响' }],
      },
    });

    const response = await appRouteHandler(request({
      generationId,
      combatants: [{
        type: 'magical-girl',
        sourceDataCardId: 'card-one',
        data: { name: '同名角色' },
      }],
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toMatchObject({
      warnings: expect.arrayContaining([expect.objectContaining({
        code: 'ARENA_RECONCILIATION_IMPACT_AMBIGUOUS',
        characterName: '同名角色',
      })]),
    });
    expect(applyPostBattleUpdates.mock.calls[0]?.[2]).toEqual([{
      combatantIndex: 0,
      characterName: '同名角色',
    }]);
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
