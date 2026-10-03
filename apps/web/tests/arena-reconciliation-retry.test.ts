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

  /**
 * 本文件只守**权威重试这一侧**。「repair 那一侧」由
 * `tests/arena-combatant-repair.test.ts:189-202` 负责（`generationIntent.dispatch(
 * '/api/arena/repair-combatant-meta')`、`lastGenerationRepairContext`、
 * `AI 重新生成修复草稿` / `应用修复` 等）。
 *
 * 原来这里有 20 条 grep，其中 **6 条与那个文件逐字重复**（重试角色更新 /
 * AI 重新生成修复草稿 / 应用修复 / repair-combatant-meta / lastGenerationRepairContext /
 * redo-combatant-updates 不再引用）。同一性质有两份会各自腐烂的副本，是净负担，已删。
 *
 * 同时删掉的还有这些——它们钉的不是性质，只是实现文本的样子：
 *
 * - **文案**：`重试应用本次服务器已生成的角色更新`、`本次无需重试角色更新`、`重做角色更新`。
 *   改一个字就红，而「重试按钮在什么条件下可用」跟提示语是哪个词无关。
 * - **JSX 布局**：`headerRight={!combatantRepair.isInRoom ?`。`cn()` 重排、props 换行或
 *   格式化都会误报，与行为无关。
 * - **布尔表达式文本**：`canWriteUpdates || Boolean(lastGenerationId) ||
 *   updatedCombatants.length > 0`。为了可读性调整一下顺序或加一个括号就红。
 * - **子串重复**：`state.repairAppliedGenerationId === lastGenerationId` 是
 *   `currentState.repairAppliedGenerationId === lastGenerationId` 的子串，两条断言恒等。
 *
 * 留下的是能与「repair 那一侧」对照出差异的东西：重试必须走 updater 的重试原语、
 * 必须读房间权威快照、必须在 mutation permit 下进行、必须有幂等守卫；
 * 已退役的 `redo-combatant-updates` / `precheckBattleReportForRedo` 不得复活；
 * 以及两条路径**副作用不同**——repair 进入 cooldown，重试不进入。
 */
  it('权威重试走 updater 重试原语与房间权威快照，且不进入 repair 的 cooldown 副作用', () => {
    const engineSource = readFileSync('components/arena/hooks/useBattleEngine.ts', 'utf8');
    const resultSource = readFileSync('components/arena/components/BattleResult.tsx', 'utf8');
    const repairSource = readFileSync('components/arena/hooks/useCombatantRepair.ts', 'utf8');

    // 权威重试委派给 updater 的重试原语，而不是自己拼请求
    expect(engineSource).toContain('retryGenerationUpdate(');
    // 依据房间权威快照，而不是本地乐观状态
    expect(engineSource).toContain('arenaRoomRuntime?.controller.getSnapshot().session');
    // 写入必须经过 mutation permit（这是并发护栏，少了它就是一条真实回归）
    expect(engineSource).toContain('state.tryBeginCombatantMutation()');
    // 幂等守卫：本次 generation 已经应用过修复就不再重试
    expect(engineSource).toContain('currentState.repairAppliedGenerationId === lastGenerationId');

    // 已退役的两条路径不得复活
    expect(engineSource).not.toContain("fetch('/api/arena/redo-combatant-updates'");
    expect(engineSource).not.toContain('handleApplyManualMetaUpdates');
    expect(resultSource).not.toContain('precheckBattleReportForRedo');
    expect(repairSource).not.toContain('/api/arena/redo-combatant-updates');

    /**
     * 「两条路径副作用不同」是本用例声称要守的性质，所以这一段是**唯一**保留 `indexOf`
     * 切片的地方：engine 整体确实用 cooldown（生成失败要进），因此「重试不进 cooldown」
     * 只有在 `handleRetryUpdates` 这一个函数体内才成立，切片是必要的，不是偷懒。
     * repair 侧进 cooldown 由 `useCombatantRepair` 的 `startCooldown()` 对照。
     */
    const retryStart = engineSource.indexOf('const handleRetryUpdates');
    expect(retryStart).toBeGreaterThan(-1);
    const retryEnd = engineSource.indexOf('\n  return {', retryStart);
    expect(retryEnd).toBeGreaterThan(retryStart);
    const retrySource = engineSource.slice(retryStart, retryEnd);
    expect(retrySource).not.toContain('Cooldown');
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
