import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashArenaCombatantBaseRevision } from '@mahoshojo/domain/arena-reconciliation';

const status = vi.fn();
const getD1Client = vi.fn();
const readReconciliation = vi.fn();
const verifySignature = vi.fn();
const applyPostBattleUpdates = vi.fn();

vi.mock('@/app/api/arena/generation-runtime', () => ({
  getCloudflareDrArenaGenerationService: () => ({ status }),
}));
vi.mock('@/lib/hosted-dr/database-provider', () => ({
  getNextHostedD1Client: getD1Client,
}));
vi.mock('@mahoshojo/hosted-runtime/arena-generation', () => ({
  readNodeArenaGenerationReconciliation: readReconciliation,
}));
vi.mock('@/lib/signature', () => ({ verifySignature }));
vi.mock('@/lib/arena/service', () => ({ applyPostBattleUpdates }));

const { appRouteHandler } = await import(
  '@/app/api/arena/update-combatants-after-stream/handler'
);

const generationId = 'generation-1234';
const client = { prepare: vi.fn() };
const combatants = [
  { data: { name: 'A', signature: 'a' }, isNative: true },
  { data: { name: 'B', signature: 'b' }, isNative: true },
];
const baseRevisionHash = await hashArenaCombatantBaseRevision(combatants);
const authoritativePayload = {
  report: {
    headline: '服务器战报',
    mode: 'classic',
    officialReport: { winner: 'A' },
  },
  impacts: [{ characterName: 'A', impact: '服务器影响' }],
  rosterCount: 2,
  baseRevisionHash,
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
    body: JSON.stringify({ baseRevisionHash, ...body }),
  },
);

describe('Arena stream reconciliation handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getD1Client.mockReturnValue(client);
    status.mockResolvedValue(new Response(JSON.stringify({ status: 'completed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    readReconciliation.mockResolvedValue(authoritativePayload);
    verifySignature.mockResolvedValue(true);
    applyPostBattleUpdates.mockResolvedValue([{ name: 'A', arena_history: {} }]);
  });

  it('ignores forged client report/effects and applies the server-owned effect once', async () => {
    const response = await appRouteHandler(request({
      generationId,
      combatants,
      report: { headline: '伪造', officialReport: { winner: 'B' } },
      impacts: [{ characterName: 'B', impact: '伪造影响' }],
      writeArenaHistory: false,
      writeCurrentState: true,
    }) as never);

    expect(response.status).toBe(200);
    expect(status).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET' }),
      { generationId },
    );
    expect(applyPostBattleUpdates).toHaveBeenCalledWith(
      combatants,
      authoritativePayload.report,
      authoritativePayload.impacts,
      authoritativePayload.userGuidance,
      { title: authoritativePayload.scenario.title },
      {
        generationId,
        baseRevisionHash,
        scenarioNativeOverride: true,
        writeArenaHistory: true,
        writeCurrentState: false,
      },
    );
    expect(readReconciliation).toHaveBeenCalledWith({ client, generationId });
  });

  it('reapplies the bounded manifest without persisting complete client cards', async () => {
    const response = await appRouteHandler(request({ generationId, combatants }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      updatedCombatants: [{ name: 'A', arena_history: {} }],
      success: true,
    });
    expect(applyPostBattleUpdates).toHaveBeenCalledOnce();
  });

  it('rejects local cards that no longer match the frozen base revision', async () => {
    const response = await appRouteHandler(request({
      generationId,
      combatants: [combatants[0]],
    }) as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'ARENA_RECONCILIATION_BASE_REVISION_MISMATCH',
    });
    expect(applyPostBattleUpdates).not.toHaveBeenCalled();
  });

  it('requires an owned completed generation before claiming the effect', async () => {
    status.mockResolvedValue(new Response(JSON.stringify({ status: 'running' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const response = await appRouteHandler(request({ generationId, combatants }) as never);

    expect(response.status).toBe(409);
    expect(readReconciliation).not.toHaveBeenCalled();
  });

  it('production 无 native binding 时即使 Gateway 已配置也在 ownership 查询前 fail closed', async () => {
    vi.stubEnv('NEXT_PUBLIC_HOSTED_API_ENVIRONMENT', 'production');
    vi.stubEnv('D1_GATEWAY_URL', 'https://gateway-secret-canary.example.test');
    getD1Client.mockReturnValue(null);

    const response = await appRouteHandler(request({ generationId, combatants }) as never);

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.not.toContain('gateway-secret-canary');
    expect(status).not.toHaveBeenCalled();
    expect(readReconciliation).not.toHaveBeenCalled();
    expect(applyPostBattleUpdates).not.toHaveBeenCalled();
  });
});
