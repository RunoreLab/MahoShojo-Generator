'use client';

import type { BattleSettings } from '../types';

type Props = {
  value: BattleSettings;
  onChange: (patch: Partial<BattleSettings>) => void;
  disabled?: boolean;
};

export function NarrativeHistorySettings({ value, onChange, disabled }: Props) {
  return (
    <div className="input-group">
      <label className="input-label">叙事历史（战报正文）</label>
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="border border-gray-200 rounded-lg p-3">
          <legend className="text-xs font-semibold text-gray-600 px-1">读写开关</legend>
          <label className="flex items-center text-sm text-gray-700 mt-2">
            <input
              type="checkbox"
              className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
              checked={value.readNarrativeHistory}
              onChange={(e) => onChange({ readNarrativeHistory: e.target.checked })}
              disabled={disabled}
            />
            生成时读取（用于延续剧情）
          </label>
          <label className="flex items-center text-sm text-gray-700 mt-2">
            <input
              type="checkbox"
              className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
              checked={value.writeNarrativeHistory}
              onChange={(e) => onChange({ writeNarrativeHistory: e.target.checked })}
              disabled={disabled}
            />
            战报后写入（自动累积）
          </label>
          {value.readNarrativeHistory && (
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-semibold text-gray-600">读取条数（最新）</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="input-field w-24"
                  value={Number.isFinite(value.readNarrativeHistoryLimit) ? value.readNarrativeHistoryLimit : 1}
                  onChange={(e) =>
                    onChange({ readNarrativeHistoryLimit: Math.max(1, Math.floor(Number(e.target.value) || 1)) })
                  }
                  disabled={disabled || value.isNarrativeHistoryUnlimited}
                />
                <label className="flex items-center text-xs text-gray-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
                    checked={value.isNarrativeHistoryUnlimited}
                    onChange={(e) => onChange({ isNarrativeHistoryUnlimited: e.target.checked })}
                    disabled={disabled}
                  />
                  无上限
                </label>
              </div>
            </div>
          )}
          <p className="text-[11px] text-gray-500 mt-1">叙事历史会自动缓存到浏览器（localStorage），用于防止崩溃丢失。</p>
        </fieldset>

        <fieldset className="border border-gray-200 rounded-lg p-3">
          <legend className="text-xs font-semibold text-gray-600 px-1">提示</legend>
          <p className="text-[11px] text-gray-600 mt-2">
            开启读取后，系统会把叙事历史插入到提示词中（位于“角色定义”之后、“当前轮次指令”之前），便于模型看到完整剧情发展。
          </p>
          {value.readNarrativeHistory && value.readArenaHistory && (
            <p className="text-[11px] text-orange-600 mt-2">
              建议：已开启叙事历史读取，可考虑关闭“历战记录”读取，避免信息重复或冲突（你也可以坚持保持开启）。
            </p>
          )}
        </fieldset>
      </div>
    </div>
  );
}
