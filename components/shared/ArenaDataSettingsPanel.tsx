'use client';

import type { ReactNode } from 'react';

export type ArenaDataSettingsValue = {
  readArenaHistory: boolean;
  readArenaHistoryLimit: number;
  isArenaHistoryUnlimited: boolean;
  writeArenaHistory: boolean;
  readCurrentState: boolean;
  writeCurrentState: boolean;
};

type Props = {
  value: ArenaDataSettingsValue;
  onChange: (patch: Partial<ArenaDataSettingsValue>) => void;
  disabled?: boolean;
  combatantCountForEstimate?: number;
  footerNote?: ReactNode;
};

export function ArenaDataSettingsPanel({ value, onChange, disabled, combatantCountForEstimate = 0, footerNote }: Props) {
  const numericLimit = value.isArenaHistoryUnlimited ? Infinity : Math.max(1, Number(value.readArenaHistoryLimit) || 1);
  const estimatedHistoryTotal = value.readArenaHistory
    ? numericLimit === Infinity
      ? Infinity
      : numericLimit * Math.max(0, combatantCountForEstimate)
    : 0;
  const shouldWarnHistoryLimit =
    value.readArenaHistory &&
    combatantCountForEstimate > 0 &&
    (numericLimit === Infinity || estimatedHistoryTotal > 20);

  return (
    <div className="input-group">
      <label className="input-label">资料读写策略</label>
      <div className="grid gap-4 md:grid-cols-2">
        <fieldset className="border border-gray-200 rounded-lg p-3">
          <legend className="text-xs font-semibold text-gray-600 px-1">历战记录</legend>
          <label className="flex items-center text-sm text-gray-700 mt-2">
            <input
              type="checkbox"
              className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
              checked={value.readArenaHistory}
              onChange={(e) => onChange({ readArenaHistory: e.target.checked })}
              disabled={disabled}
            />
            生成时读取
          </label>
          <label className="flex items-center text-sm text-gray-700 mt-2">
            <input
              type="checkbox"
              className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
              checked={value.writeArenaHistory}
              onChange={(e) => onChange({ writeArenaHistory: e.target.checked })}
              disabled={disabled}
            />
            战报后写入
          </label>
          {value.readArenaHistory && (
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-semibold text-gray-600">单个角色读取条数</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="input-field w-24"
                  value={Number.isFinite(value.readArenaHistoryLimit) ? value.readArenaHistoryLimit : 1}
                  onChange={(e) =>
                    onChange({ readArenaHistoryLimit: Math.max(1, Math.floor(Number(e.target.value) || 1)) })
                  }
                  disabled={disabled || value.isArenaHistoryUnlimited}
                />
                <label className="flex items-center text-xs text-gray-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
                    checked={value.isArenaHistoryUnlimited}
                    onChange={(e) => onChange({ isArenaHistoryUnlimited: e.target.checked })}
                    disabled={disabled}
                  />
                  无上限
                </label>
              </div>
            </div>
          )}
          <p className="text-[11px] text-gray-500 mt-1">关闭读取后，将不会参考角色历战；关闭写入后，本次战绩不会被记录。</p>
        </fieldset>

        <fieldset className="border border-gray-200 rounded-lg p-3">
          <legend className="text-xs font-semibold text-gray-600 px-1">当前状态</legend>
          <label className="flex items-center text-sm text-gray-700 mt-2">
            <input
              type="checkbox"
              className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
              checked={value.readCurrentState}
              onChange={(e) => onChange({ readCurrentState: e.target.checked })}
              disabled={disabled}
            />
            生成时读取
          </label>
          <label className="flex items-center text-sm text-gray-700 mt-2">
            <input
              type="checkbox"
              className="h-4 w-4 mr-2 text-pink-600 border-gray-300 rounded"
              checked={value.writeCurrentState}
              onChange={(e) => onChange({ writeCurrentState: e.target.checked })}
              disabled={disabled}
            />
            战报后写入
          </label>
          <p className="text-[11px] text-gray-500 mt-1">当前状态可记录角色身体状况、物品、人际等实时信息。</p>
        </fieldset>
      </div>
      {shouldWarnHistoryLimit && (
        <p className="text-xs text-orange-600 mt-2">
          ⚠️ 当前设置预计将读取
          {numericLimit === Infinity ? '无限制数量的' : `约 ${Math.ceil(estimatedHistoryTotal)} 条`}历战记录，超过 20 条可能显著提升生成失败或超时概率。
        </p>
      )}
      {footerNote ?? <p className="text-xs text-gray-500 mt-2">偏好会自动保存到浏览器，下次进入竞技场会沿用当前设置。</p>}
    </div>
  );
}

