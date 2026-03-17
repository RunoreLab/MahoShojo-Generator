'use client';

import type { BattleSettings } from '../types';
import {
  BATTLE_REPORT_CARD_WIDTH_MAX,
  BATTLE_REPORT_CARD_WIDTH_MIN,
  BATTLE_REPORT_CARD_WIDTH_PRESETS,
  normalizeBattleReportCardWidthMode,
  normalizeBattleReportCardWidthPx,
  resolveBattleReportCardPresetWidth,
} from '../utils/battleReportCardWidth';

type Props = {
  value: BattleSettings;
  onChange: (patch: Partial<BattleSettings>) => void;
  disabled?: boolean;
};

export function BattleReportCardWidthSettings({ value, onChange, disabled }: Props) {
  const widthMode = normalizeBattleReportCardWidthMode(value.battleReportCardWidthMode);
  const widthPx = normalizeBattleReportCardWidthPx(value.battleReportCardWidthPx);
  const matchedPresetWidth = resolveBattleReportCardPresetWidth(widthPx);

  return (
    <div className="input-group">
      <label className="input-label">战报卡片宽度</label>
      <fieldset className="border border-gray-200 rounded-lg p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
            <input
              type="radio"
              name="battle-report-card-width-mode"
              className="mt-0.5 h-4 w-4 border-gray-300 text-pink-600"
              checked={widthMode === 'auto'}
              onChange={() => onChange({ battleReportCardWidthMode: 'auto' })}
              disabled={disabled}
            />
            <span>
              <span className="block font-semibold text-gray-800">自动宽度</span>
            </span>
          </label>

          <label className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
            <input
              type="radio"
              name="battle-report-card-width-mode"
              className="mt-0.5 h-4 w-4 border-gray-300 text-pink-600"
              checked={widthMode === 'manual'}
              onChange={() =>
                onChange({
                  battleReportCardWidthMode: 'manual',
                  battleReportCardWidthPx: widthPx,
                })
              }
              disabled={disabled}
            />
            <span>
              <span className="block font-semibold text-gray-800">手动指定宽度</span>
            </span>
          </label>
        </div>

        {widthMode === 'manual' && (
          <div className="mt-4 space-y-3">
            <div>
              <div className="text-xs font-semibold text-gray-600">快速预设</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {BATTLE_REPORT_CARD_WIDTH_PRESETS.map((preset) => {
                  const isActive = matchedPresetWidth === preset.widthPx;
                  return (
                    <button
                      key={preset.widthPx}
                      type="button"
                      onClick={() => onChange({ battleReportCardWidthPx: preset.widthPx })}
                      disabled={disabled}
                      className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        isActive
                          ? 'border-pink-300 bg-pink-50 text-pink-700'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span className="block font-semibold">
                        {preset.label} · {preset.widthPx}px
                      </span>
                      <span className="mt-0.5 block text-[11px] text-gray-500">{preset.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600">自定义宽度（px）</label>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <input
                  type="number"
                  min={BATTLE_REPORT_CARD_WIDTH_MIN}
                  max={BATTLE_REPORT_CARD_WIDTH_MAX}
                  step={10}
                  inputMode="numeric"
                  className="input-field w-32"
                  value={widthPx}
                  onChange={(event) =>
                    onChange({
                      battleReportCardWidthPx: normalizeBattleReportCardWidthPx(Number(event.target.value)),
                    })
                  }
                  disabled={disabled}
                />
                <span className="text-xs text-gray-500">
                  可选范围：{BATTLE_REPORT_CARD_WIDTH_MIN}px - {BATTLE_REPORT_CARD_WIDTH_MAX}px
                </span>
              </div>
            </div>

          </div>
        )}
      </fieldset>
    </div>
  );
}
