import type { BattleSettings } from '../types';

export type BattleReportCardWidthMode = 'auto' | 'manual';

export const BATTLE_REPORT_CARD_WIDTH_MIN = 360;
export const BATTLE_REPORT_CARD_WIDTH_MAX = 1200;
export const LEGACY_BATTLE_REPORT_CARD_WIDTH = 500;

export const BATTLE_REPORT_CARD_WIDTH_PRESETS = [
  {
    label: '旧版窄卡',
    description: '500px，复原大屏改版前的常见宽度',
    widthPx: LEGACY_BATTLE_REPORT_CARD_WIDTH,
  },
  {
    label: '紧凑',
    description: '640px，适合保留较紧凑的阅读节奏',
    widthPx: 640,
  },
  {
    label: '标准',
    description: '760px，兼顾大屏阅读与截图紧凑度',
    widthPx: 760,
  },
  {
    label: '宽卡',
    description: '920px，适合表格较多或长段落较多的战报',
    widthPx: 920,
  },
] as const;

export const DEFAULT_BATTLE_REPORT_CARD_WIDTH_MODE: BattleReportCardWidthMode = 'auto';
export const DEFAULT_BATTLE_REPORT_CARD_WIDTH_PX = LEGACY_BATTLE_REPORT_CARD_WIDTH;

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value);
};

export const normalizeBattleReportCardWidthMode = (value: unknown): BattleReportCardWidthMode => {
  return value === 'manual' ? 'manual' : DEFAULT_BATTLE_REPORT_CARD_WIDTH_MODE;
};

export const normalizeBattleReportCardWidthPx = (value: unknown): number => {
  if (!isFiniteNumber(value)) return DEFAULT_BATTLE_REPORT_CARD_WIDTH_PX;
  const rounded = Math.round(value);
  if (rounded < BATTLE_REPORT_CARD_WIDTH_MIN) return BATTLE_REPORT_CARD_WIDTH_MIN;
  if (rounded > BATTLE_REPORT_CARD_WIDTH_MAX) return BATTLE_REPORT_CARD_WIDTH_MAX;
  return rounded;
};

export const resolveBattleReportCardManualWidthPx = (
  settings: Pick<BattleSettings, 'battleReportCardWidthMode' | 'battleReportCardWidthPx'> | null | undefined
): number | null => {
  if (normalizeBattleReportCardWidthMode(settings?.battleReportCardWidthMode) !== 'manual') {
    return null;
  }
  return normalizeBattleReportCardWidthPx(settings?.battleReportCardWidthPx);
};

export const resolveBattleReportCardPresetWidth = (value: unknown): number | null => {
  const normalized = normalizeBattleReportCardWidthPx(value);
  return BATTLE_REPORT_CARD_WIDTH_PRESETS.some((preset) => preset.widthPx === normalized) ? normalized : null;
};
