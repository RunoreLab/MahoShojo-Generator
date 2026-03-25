import { describe, expect, it } from 'bun:test';

import {
  BATTLE_REPORT_CARD_WIDTH_MAX,
  BATTLE_REPORT_CARD_WIDTH_MIN,
  DEFAULT_BATTLE_REPORT_CARD_WIDTH_PX,
  LEGACY_BATTLE_REPORT_CARD_WIDTH,
  normalizeBattleReportCardWidthPx,
  resolveBattleReportCardManualWidthPx,
  resolveBattleReportCardPresetWidth,
} from '@/components/arena/utils/battleReportCardWidth';

describe('battle report card width utils', () => {
  it('auto 模式不返回手动宽度', () => {
    expect(
      resolveBattleReportCardManualWidthPx({
        battleReportCardWidthMode: 'auto',
        battleReportCardWidthPx: LEGACY_BATTLE_REPORT_CARD_WIDTH,
      }),
    ).toBeNull();
  });

  it('manual 模式会对宽度做兜底与钳制', () => {
    expect(
      resolveBattleReportCardManualWidthPx({
        battleReportCardWidthMode: 'manual',
        battleReportCardWidthPx: undefined,
      }),
    ).toBe(DEFAULT_BATTLE_REPORT_CARD_WIDTH_PX);

    expect(
      resolveBattleReportCardManualWidthPx({
        battleReportCardWidthMode: 'manual',
        battleReportCardWidthPx: BATTLE_REPORT_CARD_WIDTH_MIN - 80,
      }),
    ).toBe(BATTLE_REPORT_CARD_WIDTH_MIN);

    expect(
      resolveBattleReportCardManualWidthPx({
        battleReportCardWidthMode: 'manual',
        battleReportCardWidthPx: BATTLE_REPORT_CARD_WIDTH_MAX + 120,
      }),
    ).toBe(BATTLE_REPORT_CARD_WIDTH_MAX);
  });

  it('只能识别预设宽度，非预设视为自定义', () => {
    expect(resolveBattleReportCardPresetWidth(LEGACY_BATTLE_REPORT_CARD_WIDTH)).toBe(LEGACY_BATTLE_REPORT_CARD_WIDTH);
    expect(resolveBattleReportCardPresetWidth(777)).toBeNull();
  });

  it('宽度归一化会处理非法数字', () => {
    expect(normalizeBattleReportCardWidthPx(Number.NaN)).toBe(DEFAULT_BATTLE_REPORT_CARD_WIDTH_PX);
    expect(normalizeBattleReportCardWidthPx(638.6)).toBe(639);
  });
});
