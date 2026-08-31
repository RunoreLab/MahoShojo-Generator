import { describe, expect, test } from 'vitest';

import {
  BattleReportRenderSnapshotV1Schema,
  MAX_BATTLE_REPORT_RENDER_SNAPSHOT_BYTES,
  parseBattleReportRenderSnapshotV1,
} from '../src';

const validSnapshot = {
  version: 1 as const,
  reporterInfo: { name: '测试记者', publication: 'A.R.E.N.A.' },
  userGuidance: '保持克制',
  characterGuidances: [{ characterName: '角色甲', guidance: '保护队友' }],
  adjudicationResults: [{
    depth: 0,
    description: '攻击是否命中？',
    type: 'binary' as const,
    roll: 42,
    outcome: '成功',
    details: '掷骰(42) vs 成功率(65%)',
  }],
  narrativeHistoryReadCount: 3,
};

describe('BattleReportRenderSnapshotV1', () => {
  test('接受个人页重建所需的安全渲染元数据', () => {
    expect(parseBattleReportRenderSnapshotV1(validSnapshot)).toEqual(validSnapshot);
  });

  test.each([
    { ...validSnapshot, apiKey: 'secret' },
    { ...validSnapshot, rawReasoning: 'private chain of thought' },
    { ...validSnapshot, adjudicationResults: [{ ...validSnapshot.adjudicationResults[0], type: 'unknown' }] },
  ])('拒绝未声明字段或非法判定结果', (snapshot) => {
    expect(BattleReportRenderSnapshotV1Schema.safeParse(snapshot).success).toBe(false);
    expect(parseBattleReportRenderSnapshotV1(snapshot)).toBeNull();
  });

  test('拒绝超过快照 UTF-8 总量上限的内容', () => {
    const oversized = {
      ...validSnapshot,
      userGuidance: '你'.repeat(MAX_BATTLE_REPORT_RENDER_SNAPSHOT_BYTES),
    };

    expect(parseBattleReportRenderSnapshotV1(oversized)).toBeNull();
  });
});
