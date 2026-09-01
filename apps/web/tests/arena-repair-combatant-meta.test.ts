import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateWithAI: vi.fn(),
  quickCheck: vi.fn(),
  buildPolicySafetyCheckText: vi.fn(),
  verifySignature: vi.fn(),
  recordUserActivityFromRequest: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({
  generateWithAI: mocks.generateWithAI,
  LoadBalanceStrategy: {
    CUSTOM: 'custom',
    SEQUENTIAL: 'sequential',
  },
}));
vi.mock('@/lib/config', () => ({
  config: {
    SAFETY_CHECK_POLICY: {},
    ENABLE_BUNDLE_SAFETY_CHECK: true,
    ENABLE_SENSITIVE_WORD_FILTER: true,
  },
}));
vi.mock('@/lib/sensitive-word-filter', () => ({ quickCheck: mocks.quickCheck }));
vi.mock('@/lib/content-safety/server', () => ({
  buildPolicySafetyCheckText: mocks.buildPolicySafetyCheckText,
}));
vi.mock('@/lib/signature', () => ({ verifySignature: mocks.verifySignature }));
vi.mock('@/lib/user-activity/record', () => ({
  recordUserActivityFromRequest: mocks.recordUserActivityFromRequest,
}));

const { appRouteHandler } = await import(
  '@/app/api/arena/repair-combatant-meta/handler'
);

const battleReportMarkdown = `# 终局战报

## 胜利者

- 角色 A

## 正文

${'两位角色在魔法竞技场完成了漫长而明确的一轮交锋。'.repeat(8)}`;

const combatants = [
  {
    type: 'magical-girl',
    data: { name: '角色 A', signature: 'signed-a', current_state: { summary: '旧状态 A' } },
    isNative: true,
  },
  {
    type: 'general-character',
    data: { name: '角色 B', current_state: { summary: '旧状态 B' } },
    isNative: false,
  },
];

const request = (overrides: Record<string, unknown> = {}) => new Request(
  'http://localhost/api/arena/repair-combatant-meta',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationId: 'generation-repair-001',
      combatants,
      battleReportMarkdown,
      mode: 'classic',
      userGuidance: '保持角色既有性格',
      writeArenaHistory: true,
      writeCurrentState: true,
      ...overrides,
    }),
  },
);

describe('Arena AI repair metadata endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.quickCheck.mockResolvedValue({ hasSensitiveWords: false });
    mocks.buildPolicySafetyCheckText.mockReturnValue({
      combinedText: '安全检查内容',
      usedBundle: true,
    });
    mocks.verifySignature.mockResolvedValue(true);
    mocks.generateWithAI.mockResolvedValue({
      impacts: [
        {
          combatantIndex: 1,
          characterName: '角色 B',
          impact: 'B 的新影响',
          currentStateSummary: 'B 的新状态',
        },
        {
          combatantIndex: 0,
          characterName: '角色 A',
          impact: 'A 的新影响',
          currentStateSummary: 'A 的新状态',
        },
      ],
    });
  });

  it('只返回按 roster index 排序的内容 patch，不返回或应用角色卡', async () => {
    const response = await appRouteHandler(request() as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      impacts: [
        {
          combatantIndex: 0,
          characterName: '角色 A',
          impact: 'A 的新影响',
          currentStateSummary: 'A 的新状态',
        },
        {
          combatantIndex: 1,
          characterName: '角色 B',
          impact: 'B 的新影响',
          currentStateSummary: 'B 的新状态',
        },
      ],
    });
    expect(mocks.generateWithAI).toHaveBeenCalledOnce();
    expect(mocks.recordUserActivityFromRequest).toHaveBeenCalledOnce();
    expect(mocks.verifySignature).toHaveBeenCalledWith(combatants[0]!.data);

    const handlerSource = readFileSync('app/api/arena/repair-combatant-meta/handler.ts', 'utf8');
    expect(handlerSource).not.toContain('applyPostBattleUpdates');
    expect(handlerSource).not.toContain('generateSignature');
    expect(handlerSource).not.toContain('updatedCombatants');
  });

  it('不相信 claimed native，验签失败后按 non-native 输入执行内容安全', async () => {
    mocks.verifySignature.mockResolvedValue(false);

    const response = await appRouteHandler(request() as never);

    expect(response.status).toBe(200);
    const safetyInputs = mocks.buildPolicySafetyCheckText.mock.calls[0]?.[0] as Array<{
      type: string;
      isNative: boolean;
    }>;
    expect(safetyInputs.filter((item) => item.type === 'character')).toEqual([
      expect.objectContaining({ isNative: false }),
      expect.objectContaining({ isNative: false }),
    ]);
  });

  it('拒绝 AI 返回的重复 index 或角色名错绑', async () => {
    mocks.generateWithAI.mockResolvedValueOnce({
      impacts: [
        { combatantIndex: 0, characterName: '角色 A', impact: '一', currentStateSummary: '一' },
        { combatantIndex: 0, characterName: '角色 B', impact: '二', currentStateSummary: '二' },
      ],
    });

    const response = await appRouteHandler(request() as never);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: 'ARENA_REPAIR_META_OUTPUT_INVALID',
    });
    expect(mocks.recordUserActivityFromRequest).not.toHaveBeenCalled();
  });

  it('拒绝关闭全部 repair 字段、过量 roster 与不完整战报', async () => {
    const noFields = await appRouteHandler(request({
      writeArenaHistory: false,
      writeCurrentState: false,
    }) as never);
    expect(noFields.status).toBe(400);

    const tooMany = await appRouteHandler(request({
      combatants: Array.from({ length: 33 }, (_, index) => ({
        type: 'general-character',
        data: { name: `角色 ${index}` },
        isNative: false,
      })),
    }) as never);
    expect(tooMany.status).toBe(400);

    const incompleteReport = await appRouteHandler(request({ battleReportMarkdown: '# 太短' }) as never);
    expect(incompleteReport.status).toBe(400);
    expect(mocks.generateWithAI).not.toHaveBeenCalled();
  });

  it('沿用内容安全拒绝语义，并保持 method 边界', async () => {
    mocks.quickCheck.mockResolvedValueOnce({ hasSensitiveWords: true });
    const blocked = await appRouteHandler(request() as never);
    expect(blocked.status).toBe(400);
    await expect(blocked.json()).resolves.toMatchObject({
      code: 'ARENA_REPAIR_META_CONTENT_REJECTED',
      shouldRedirect: true,
    });
    expect(mocks.generateWithAI).not.toHaveBeenCalled();

    const get = await appRouteHandler(new Request(
      'http://localhost/api/arena/repair-combatant-meta',
    ) as never);
    expect(get.status).toBe(405);
  });
});
