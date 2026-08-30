import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const repository = vi.hoisted(() => ({
  insertBattleReportGenerationCombatants: vi.fn(),
  listBattleReportGenerationCombatantsByGenerationId: vi.fn(),
}));

vi.mock('@/lib/db/drizzle', () => ({
  getDrizzleDbFromRuntime: () => ({ kind: 'test-db' }),
}));

vi.mock('@/lib/db/repositories/battle-report-generation-combatants', () => repository);

import {
  createBattleReportGenerationCombatants,
  getBattleReportGenerationCombatantsByGenerationId,
} from '@/lib/database/battle-report-generation-combatants';

const PRIVATE_CANARY = 'private-combatant-canary';

describe('battle report generation combatants database wrapper', () => {
  beforeEach(() => {
    repository.insertBattleReportGenerationCombatants.mockReset();
    repository.listBattleReportGenerationCombatantsByGenerationId.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('写入失败只返回并记录固定低基数错误代码', async () => {
    const error = Object.assign(
      new Error(`Failed query; params: ${PRIVATE_CANARY}`),
      { requestBodyValues: PRIVATE_CANARY },
    );
    repository.insertBattleReportGenerationCombatants.mockRejectedValue(error);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await createBattleReportGenerationCombatants([{
      generationId: 'generation-1',
      name: PRIVATE_CANARY,
      sortIndex: 0,
    }]);

    expect(result).toEqual({
      errorMessage: 'combatants-write-failed',
      ok: false,
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(PRIVATE_CANARY);
    expect(errorSpy).toHaveBeenCalledWith(
      '写入 battle_report_generation_combatants 失败:',
      { errorClass: 'combatants-write-failed' },
    );
  });

  test('读取失败不把原始错误字段写入日志', async () => {
    repository.listBattleReportGenerationCombatantsByGenerationId.mockRejectedValue(
      Object.assign(new Error('read failed'), { requestBodyValues: PRIVATE_CANARY }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      getBattleReportGenerationCombatantsByGenerationId('generation-1'),
    ).resolves.toEqual([]);

    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(PRIVATE_CANARY);
    expect(errorSpy).toHaveBeenCalledWith(
      '读取 battle_report_generation_combatants 失败:',
      { errorClass: 'combatants-read-failed' },
    );
  });
});
