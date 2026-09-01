import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildArenaReconciliationRetryPayload } from '@/lib/arena/reconciliation-retry';

describe('Arena 角色更新恢复', () => {
  it('仅使用同一 generation 与保留稳定身份 wrapper 的当前卡片重试冻结 effect', async () => {
    const payload = await buildArenaReconciliationRetryPayload('generation-retry-001', [
      {
        type: 'magical-girl',
        data: { name: '小锦', signature: 'signed' },
        isValid: true,
        isPreset: true,
        filename: 'C01_egg.json',
        sourceDataCardId: 'card-1',
        roomCombatantKey: 'data-card:card-1',
        characterGuidance: '保持冷静',
      },
    ]);

    expect(payload).toEqual({
      generationId: 'generation-retry-001',
      combatants: [
        {
          type: 'magical-girl',
          data: { name: '小锦', signature: 'signed' },
          isPreset: true,
          filename: 'C01_egg.json',
          sourceDataCardId: 'card-1',
          roomCombatantKey: 'data-card:card-1',
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
    expect(repairSource).toContain("generationIntent.dispatch('/api/arena/repair-combatant-meta'");
    expect(repairSource).toContain('lastGenerationRepairContext');
    expect(repairSource).not.toContain('/api/arena/redo-combatant-updates');
    expect(repairSource).toContain('startCooldown()');
  });

  it('角色对账 transport 与 domain exports 不再包含完整卡片 baseRevisionHash', () => {
    const sources = [
      'app/api/arena/update-combatants-after-stream/handler.ts',
      'components/arena/hooks/useStreamCombatantUpdater.ts',
      'components/arena/hooks/useBattleStorySession.ts',
      'lib/arena/reconciliation-retry.ts',
      '../../packages/domain/package.json',
      '../../packages/domain/src/index.ts',
      '../../packages/hosted-runtime/src/arena-generation/d1-finalization.ts',
    ].map((path) => readFileSync(path, 'utf8'));

    expect(sources.join('\n')).not.toContain('baseRevisionHash');
  });
});
