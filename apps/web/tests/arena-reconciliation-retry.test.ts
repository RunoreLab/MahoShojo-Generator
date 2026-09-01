import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildArenaReconciliationRetryPayload } from '@/lib/arena/reconciliation-retry';

describe('Arena 角色更新恢复', () => {
  it('仅使用同一 generation 与当前卡片基线重试服务端冻结的对账 effect', async () => {
    const payload = await buildArenaReconciliationRetryPayload('generation-retry-001', [
      {
        type: 'magical-girl',
        data: { name: '小锦', signature: 'signed' },
        isValid: true,
        isPreset: false,
        characterGuidance: '保持冷静',
      },
    ]);

    expect(payload).toEqual({
      generationId: 'generation-retry-001',
      baseRevisionHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      combatants: [
        {
          type: 'magical-girl',
          data: { name: '小锦', signature: 'signed' },
          isNative: true,
          isPreset: false,
          characterGuidance: '保持冷静',
        },
      ],
    });
    expect(payload).not.toHaveProperty('report');
    expect(payload).not.toHaveProperty('impacts');
    expect(payload).not.toHaveProperty('writeArenaHistory');
  });

  it('UI 只重试服务端权威对账，不再重新生成或手工覆盖 meta', () => {
    const engineSource = readFileSync('components/arena/hooks/useBattleEngine.ts', 'utf8');
    const resultSource = readFileSync('components/arena/components/BattleResult.tsx', 'utf8');

    expect(engineSource).toContain('retryGenerationUpdate(lastGenerationId, roster)');
    expect(engineSource).not.toContain("fetch('/api/arena/redo-combatant-updates'");
    expect(engineSource).not.toContain('handleApplyManualMetaUpdates');
    expect(engineSource).not.toContain('本次无需重试角色更新');
    expect(resultSource).toContain('重试角色更新');
    expect(resultSource).toContain('重试应用本次服务器已生成的角色更新');
    expect(resultSource).toContain('canWriteUpdates || Boolean(lastGenerationId) || updatedCombatants.length > 0');
    expect(resultSource).not.toContain('重做角色更新');
    expect(resultSource).not.toContain('手动修正并应用');
    expect(resultSource).not.toContain('应用手动修改');
    expect(resultSource).not.toContain('precheckBattleReportForRedo');
    expect(resultSource).not.toMatch(/disabled=\{[^}]*isCooldown/u);
  });
});
