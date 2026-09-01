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

  it('权威重试与非权威 repair 保持为独立动作', () => {
    const engineSource = readFileSync('components/arena/hooks/useBattleEngine.ts', 'utf8');
    const resultSource = readFileSync('components/arena/components/BattleResult.tsx', 'utf8');
    const repairSource = readFileSync('components/arena/hooks/useCombatantRepair.ts', 'utf8');
    const retryStart = engineSource.indexOf('const handleRetryUpdates');
    const retryEnd = engineSource.indexOf('\n  return {', retryStart);
    const retrySource = engineSource.slice(retryStart, retryEnd);

    expect(engineSource).toContain('retryGenerationUpdate(lastGenerationId, roster, () =>');
    expect(engineSource).toContain('arenaRoomRuntime?.controller.getSnapshot().session');
    expect(engineSource).toContain('state.tryBeginCombatantMutation()');
    expect(engineSource).toContain('currentState.repairAppliedGenerationId === lastGenerationId');
    expect(engineSource).not.toContain("fetch('/api/arena/redo-combatant-updates'");
    expect(engineSource).not.toContain('handleApplyManualMetaUpdates');
    expect(engineSource).not.toContain('本次无需重试角色更新');
    expect(engineSource).toContain('state.repairAppliedGenerationId === lastGenerationId');
    expect(resultSource).toContain('重试角色更新');
    expect(resultSource).toContain('headerRight={!combatantRepair.isInRoom ?');
    expect(resultSource).toContain('重试应用本次服务器已生成的角色更新');
    expect(resultSource).toContain('canWriteUpdates || Boolean(lastGenerationId) || updatedCombatants.length > 0');
    expect(resultSource).not.toContain('重做角色更新');
    expect(resultSource).not.toContain('precheckBattleReportForRedo');
    expect(retrySource).not.toContain('isCooldown');
    expect(retrySource).not.toContain('startCooldown');
    expect(resultSource).toContain('AI 重新生成修复草稿');
    expect(resultSource).toContain('手动编辑修复草稿');
    expect(resultSource).toContain('应用修复');
    expect(repairSource).toContain("fetch('/api/arena/repair-combatant-meta'");
    expect(repairSource).not.toContain('/api/arena/redo-combatant-updates');
    expect(repairSource).toContain('startCooldown()');
  });
});
